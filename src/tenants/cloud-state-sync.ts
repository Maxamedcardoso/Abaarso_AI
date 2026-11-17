import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

export interface CloudSnapshotRow {
  scopeKey: string;
  payloadGz: Buffer;
  updatedAt: number;
}

export interface ICloudSnapshotStore {
  initialize(): Promise<void>;
  upsertSnapshot(scopeKey: string, payloadGz: Buffer, updatedAt: number): Promise<void>;
  listSnapshots(): Promise<CloudSnapshotRow[]>;
  deleteSnapshotsByPrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

function shouldUseSsl(connStr: string): boolean {
  const lower = connStr.toLowerCase();
  if (lower.includes('sslmode=disable')) return false;
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) return false;
  return true;
}

export class PostgresSnapshotStore implements ICloudSnapshotStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
      max: 3,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  public async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cardoso_cloud_snapshots (
        scope_key TEXT PRIMARY KEY,
        payload_gz BYTEA NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
  }

  public async upsertSnapshot(scopeKey: string, payloadGz: Buffer, updatedAt: number): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO cardoso_cloud_snapshots (scope_key, payload_gz, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (scope_key) DO UPDATE SET
          payload_gz = EXCLUDED.payload_gz,
          updated_at = EXCLUDED.updated_at
      `,
      [scopeKey, payloadGz, updatedAt]
    );
  }

  public async listSnapshots(): Promise<CloudSnapshotRow[]> {
    const res = await this.pool.query('SELECT scope_key, payload_gz, updated_at FROM cardoso_cloud_snapshots');
    return (res.rows || []).map((r: any) => ({
      scopeKey: String(r.scope_key),
      payloadGz: Buffer.isBuffer(r.payload_gz) ? r.payload_gz : Buffer.from(r.payload_gz),
      updatedAt: Number(r.updated_at || 0),
    }));
  }

  public async deleteSnapshotsByPrefix(prefix: string): Promise<void> {
    await this.pool.query('DELETE FROM cardoso_cloud_snapshots WHERE scope_key LIKE $1', [`${prefix}%`]);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CloudStateSyncOptions {
  store: ICloudSnapshotStore;
  baseDataDir: string;
  registryDbPath: string;
  ownerDbPath: string;
  ownerAuthDir: string;
  debounceMs?: number;
}

export class CloudStateSync {
  private readonly store: ICloudSnapshotStore;
  private readonly baseDataDir: string;
  private readonly registryDbPath: string;
  private readonly ownerDbPath: string;
  private readonly ownerAuthDir: string;
  private readonly debounceMs: number;
  private dirtyScopes: Set<string> = new Set();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private initialized: boolean = false;
  public lastSyncedAt: number | null = null;
  public lastError: string | null = null;

  constructor(options: CloudStateSyncOptions) {
    this.store = options.store;
    this.baseDataDir = options.baseDataDir;
    this.registryDbPath = options.registryDbPath;
    this.ownerDbPath = options.ownerDbPath;
    this.ownerAuthDir = options.ownerAuthDir;
    this.debounceMs = options.debounceMs ?? 10_000;
  }

  public async initialize(): Promise<void> {
    await this.store.initialize();
    this.initialized = true;
  }

  private safeTenantId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  private resolveDbPath(tenantId: string): string {
    if (tenantId === 'owner') return this.ownerDbPath;
    return path.join(this.baseDataDir, 'tenants', this.safeTenantId(tenantId), 'tenant.db');
  }

  private resolveAuthDir(tenantId: string): string {
    if (tenantId === 'owner') return this.ownerAuthDir;
    return path.join(this.baseDataDir, 'tenants', this.safeTenantId(tenantId), 'auth');
  }

  private resolveMetaPaths(tenantId: string): { postedStatuses: string; statusReactor: string } {
    if (tenantId === 'owner') {
      return {
        postedStatuses: path.join(this.baseDataDir, 'posted-statuses.json'),
        statusReactor: path.join(this.baseDataDir, 'status_reactor_config.json'),
      };
    }
    const dir = path.join(this.baseDataDir, 'tenants', this.safeTenantId(tenantId));
    return {
      postedStatuses: path.join(dir, 'posted-statuses.json'),
      statusReactor: path.join(dir, 'status_reactor.json'),
    };
  }

  private writeFileAtomic(targetPath: string, content: Buffer | string): void {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${targetPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, targetPath);
  }

  private readSqliteSnapshotBytes(dbPath: string): Buffer | null {
    if (!fs.existsSync(dbPath)) return null;
    const tmpSnap = `${dbPath}.cloudsnap.${Date.now()}.db`;
    let conn: DatabaseSync | null = null;
    try {
      conn = new DatabaseSync(dbPath);
      conn.exec('PRAGMA busy_timeout = 3000;');
      const escaped = tmpSnap.replace(/'/g, "''");
      conn.exec(`VACUUM INTO '${escaped}'`);
      conn.close();
      conn = null;
      return fs.readFileSync(tmpSnap);
    } catch {
      try {
        return fs.readFileSync(dbPath);
      } catch {
        return null;
      }
    } finally {
      try { conn?.close(); } catch {}
      try { if (fs.existsSync(tmpSnap)) fs.unlinkSync(tmpSnap); } catch {}
    }
  }

  private readAuthDirBundle(authDir: string): Buffer | null {
    if (!fs.existsSync(authDir)) return null;
    const credsPath = path.join(authDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;

    // Ensure only paired/registered auth sessions are synced to cloud storage
    try {
      const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      if (!parsed || (!parsed.registered && !parsed.account)) {
        return null;
      }
    } catch {
      return null;
    }

    const bundle: Record<string, string> = {};
    for (const file of fs.readdirSync(authDir)) {
      if (
        file.endsWith('.tmp') ||
        file.startsWith('sender-key-memory-')
      ) {
        continue;
      }
      const full = path.join(authDir, file);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        bundle[file] = fs.readFileSync(full, 'utf8');
      } catch {}
    }

    if (!bundle['creds.json']) return null;
    return Buffer.from(JSON.stringify(bundle), 'utf8');
  }

  private readMetaBundle(tenantId: string): Buffer | null {
    const paths = this.resolveMetaPaths(tenantId);
    const out: Record<string, string> = {};
    if (fs.existsSync(paths.postedStatuses)) {
      try { out.postedStatuses = fs.readFileSync(paths.postedStatuses, 'utf8'); } catch {}
    }
    if (fs.existsSync(paths.statusReactor)) {
      try { out.statusReactor = fs.readFileSync(paths.statusReactor, 'utf8'); } catch {}
    }
    if (Object.keys(out).length === 0) return null;
    return Buffer.from(JSON.stringify(out), 'utf8');
  }

  public async restoreAllIfMissing(force: boolean = false): Promise<{ restoredCount: number }> {
    if (!this.initialized) return { restoredCount: 0 };
    const rows = await this.store.listSnapshots();
    let restoredCount = 0;

    for (const row of rows) {
      try {
        const raw = zlib.gunzipSync(row.payloadGz);

        if (row.scopeKey === 'registry') {
          if (force || !fs.existsSync(this.registryDbPath) || fs.statSync(this.registryDbPath).size < 100) {
            this.writeFileAtomic(this.registryDbPath, raw);
            restoredCount++;
          }
          continue;
        }

        const match = row.scopeKey.match(/^tenant:([a-zA-Z0-9_-]+):(db|auth|meta)$/);
        if (!match) continue;
        const tenantId = match[1];
        const kind = match[2];

        if (kind === 'db') {
          const dbTarget = this.resolveDbPath(tenantId);
          if (force || !fs.existsSync(dbTarget) || fs.statSync(dbTarget).size < 100) {
            this.writeFileAtomic(dbTarget, raw);
            restoredCount++;
          }
        } else if (kind === 'auth') {
          const authDir = this.resolveAuthDir(tenantId);
          const hasLocalCreds = fs.existsSync(path.join(authDir, 'creds.json'));
          if (force || !hasLocalCreds) {
            const bundle = JSON.parse(raw.toString('utf8')) as Record<string, string>;
            if (!fs.existsSync(authDir)) {
              fs.mkdirSync(authDir, { recursive: true });
            }
            for (const [name, content] of Object.entries(bundle)) {
              const safeName = path.basename(name);
              if (!safeName || safeName === '.' || safeName === '..') continue;
              this.writeFileAtomic(path.join(authDir, safeName), content);
            }
            restoredCount++;
          }
        } else if (kind === 'meta') {
          const metaPaths = this.resolveMetaPaths(tenantId);
          const meta = JSON.parse(raw.toString('utf8')) as Record<string, string>;
          let wrote = false;
          if (meta.postedStatuses && (force || !fs.existsSync(metaPaths.postedStatuses))) {
            this.writeFileAtomic(metaPaths.postedStatuses, meta.postedStatuses);
            wrote = true;
          }
          if (meta.statusReactor && (force || !fs.existsSync(metaPaths.statusReactor))) {
            this.writeFileAtomic(metaPaths.statusReactor, meta.statusReactor);
            wrote = true;
          }
          if (wrote) restoredCount++;
        }
      } catch (err: any) {
        console.warn(`⚠️ [CloudStateSync] Failed restoring scope "${row.scopeKey}":`, err?.message || err);
      }
    }

    if (restoredCount > 0) {
      console.log(`☁️ [CloudStateSync] Restored ${restoredCount} persistent snapshot(s) cleanly from cloud DB!`);
    }
    return { restoredCount };
  }

  public markDirty(scopeKey: string, urgent: boolean = false): void {
    if (!this.initialized) return;
    this.dirtyScopes.add(scopeKey);

    if (urgent) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.flushDirtyNow().catch(() => {});
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushDirtyNow().catch(() => {});
      }, this.debounceMs);
      if (typeof this.flushTimer.unref === 'function') {
        this.flushTimer.unref();
      }
    }
  }

  private async uploadScope(scopeKey: string): Promise<boolean> {
    let raw: Buffer | null = null;
    if (scopeKey === 'registry') {
      raw = this.readSqliteSnapshotBytes(this.registryDbPath);
    } else {
      const match = scopeKey.match(/^tenant:([a-zA-Z0-9_-]+):(db|auth|meta)$/);
      if (match) {
        const tenantId = match[1];
        const kind = match[2];
        if (kind === 'db') raw = this.readSqliteSnapshotBytes(this.resolveDbPath(tenantId));
        else if (kind === 'auth') raw = this.readAuthDirBundle(this.resolveAuthDir(tenantId));
        else if (kind === 'meta') raw = this.readMetaBundle(tenantId);
      }
    }

    if (!raw || raw.length === 0) return false;
    const gz = zlib.gzipSync(raw, { level: 6 });
    await this.store.upsertSnapshot(scopeKey, gz, Date.now());
    return true;
  }

  public async flushDirtyNow(): Promise<{ synced: number }> {
    if (!this.initialized) return { synced: 0 };
    if (this.flushing) {
      await this.flushing;
    }

    const keys = Array.from(this.dirtyScopes);
    if (keys.length === 0) return { synced: 0 };
    this.dirtyScopes.clear();

    let synced = 0;
    const job = (async () => {
      for (const key of keys) {
        try {
          const uploaded = await this.uploadScope(key);
          if (uploaded) synced++;
        } catch (err: any) {
          this.lastError = err?.message || String(err);
          console.warn(`⚠️ [CloudStateSync] Sync failed for "${key}":`, this.lastError);
          this.dirtyScopes.add(key);
        }
      }
      if (synced > 0) {
        this.lastSyncedAt = Date.now();
        this.lastError = null;
      }
    })();

    this.flushing = job;
    try {
      await job;
    } finally {
      this.flushing = null;
    }
    return { synced };
  }

  public async syncAllActiveNow(tenantIds: string[]): Promise<{ synced: number }> {
    if (!this.initialized) return { synced: 0 };
    this.dirtyScopes.add('registry');
    const allIds = Array.from(new Set(['owner', ...tenantIds]));
    for (const id of allIds) {
      const safe = id === 'owner' ? 'owner' : this.safeTenantId(id);
      this.dirtyScopes.add(`tenant:${safe}:db`);
      this.dirtyScopes.add(`tenant:${safe}:auth`);
      this.dirtyScopes.add(`tenant:${safe}:meta`);
    }
    return this.flushDirtyNow();
  }

  public async deleteTenantSnapshots(tenantId: string): Promise<void> {
    if (!this.initialized || !tenantId || tenantId === 'owner') return;
    const safe = this.safeTenantId(tenantId);
    this.dirtyScopes.delete(`tenant:${safe}:db`);
    this.dirtyScopes.delete(`tenant:${safe}:auth`);
    this.dirtyScopes.delete(`tenant:${safe}:meta`);
    await this.store.deleteSnapshotsByPrefix(`tenant:${safe}:`);
  }

  public async deleteAuthSnapshot(tenantId: string): Promise<void> {
    if (!this.initialized || !tenantId) return;
    const safe = tenantId === 'owner' ? 'owner' : this.safeTenantId(tenantId);
    this.dirtyScopes.delete(`tenant:${safe}:auth`);
    await this.store.deleteSnapshotsByPrefix(`tenant:${safe}:auth`);
  }

  public getStatus(): {
    initialized: boolean;
    lastSyncedAt: number | null;
    lastError: string | null;
    pendingDirtyCount: number;
  } {
    return {
      initialized: this.initialized,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      pendingDirtyCount: this.dirtyScopes.size,
    };
  }

  public async shutdown(tenantIds: string[] = []): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.initialized) {
      try {
        await this.syncAllActiveNow(tenantIds);
      } catch {}
      await this.store.close().catch(() => {});
      this.initialized = false;
    }
  }
}
