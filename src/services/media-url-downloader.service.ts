import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { VoiceReplyService } from './voice-reply.service.js';

const execFileAsync = promisify(execFile);

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * MediaUrlDownloaderService
 *
 * Production-grade universal audio/video link extractor that converts ANY link
 * (TikTok, YouTube, YouTube Shorts, Facebook, Instagram, Twitter/X, SoundCloud,
 * Google Drive, Dropbox, direct MP4/MP3/M4A/WAV/OGG/WEBM) into a verified,
 * WhatsApp-playable Ogg Opus Voice Note (PTT) buffer ("OggS" header, 48kHz mono).
 */
export class MediaUrlDownloaderService {
  private static cachedYtDlpPath: string | null = null;
  private static ytDlpBootstrapPromise: Promise<string | null> | null = null;

  /**
   * Extracts the first http(s) URL from raw input (handles mobile app share text
   * like "Daawo videogan https://vm.tiktok.com/ZMh12345/").
   */
  public static extractUrl(rawInput: string): string {
    const trimmed = String(rawInput || '').trim();
    const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
    if (match) {
      return match[0].replace(/[),.;!?]+$/, '');
    }
    if (/^(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|soundcloud\.com)\S+/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  }

  /**
   * Checks whether a buffer looks like an HTML error/challenge page instead of media.
   */
  private static isHtmlBuffer(buf: Buffer): boolean {
    if (!buf || buf.length === 0) return true;
    const head = buf.slice(0, 512).toString('utf8').trim().toLowerCase();
    return (
      head.startsWith('<!doctype') ||
      head.startsWith('<html') ||
      head.startsWith('<head') ||
      head.startsWith('<script') ||
      head.includes('<html')
    );
  }

  /**
   * Safely parses JSON from a fetch Response without ever throwing
   * "Unexpected end of JSON input" on empty or HTML bodies.
   */
  private static async safeReadJson(res: Response): Promise<{ ok: boolean; data?: any; rawSnippet: string }> {
    const text = await res.text().catch(() => '');
    const trimmed = text.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
      return { ok: false, rawSnippet: trimmed.slice(0, 120) };
    }
    try {
      return { ok: true, data: JSON.parse(trimmed), rawSnippet: trimmed.slice(0, 120) };
    } catch {
      return { ok: false, rawSnippet: trimmed.slice(0, 120) };
    }
  }

  /**
   * Downloads a media file from a resolved direct CDN URL with validation.
   */
  private static async fetchMediaBuffer(
    mediaUrl: string,
    extraHeaders?: Record<string, string>,
    timeoutMs: number = 45000
  ): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(mediaUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'audio/*,video/*,application/octet-stream,*/*',
          ...(extraHeaders || {}),
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) {
        throw new Error(`Faylku aad ayuu u yar yahay (${buf.length} bytes)`);
      }
      if (this.isHtmlBuffer(buf)) {
        throw new Error('Link-gu wuxuu soo celiyay bog HTML ah, cod/video ma aha');
      }
      return buf;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ensures a standalone yt-dlp executable is available (checks PATH first, then
   * auto-bootstraps the official PyInstaller standalone release into os.tmpdir()/cardoso-bin).
   * Works on both Render Linux x64 and Windows x64 without requiring Python!
   */
  private static async ensureYtDlpBinary(): Promise<string | null> {
    if (this.cachedYtDlpPath && fs.existsSync(this.cachedYtDlpPath)) {
      return this.cachedYtDlpPath;
    }
    if (this.ytDlpBootstrapPromise) {
      return this.ytDlpBootstrapPromise;
    }

    this.ytDlpBootstrapPromise = (async () => {
      // 1. Check if yt-dlp is already installed in PATH
      try {
        await execFileAsync('yt-dlp', ['--version'], { timeout: 5000 });
        this.cachedYtDlpPath = 'yt-dlp';
        return 'yt-dlp';
      } catch {}

      // 2. Determine standalone binary filename for current platform/arch
      let assetName = 'yt-dlp_linux';
      if (process.platform === 'win32') {
        assetName = 'yt-dlp.exe';
      } else if (process.platform === 'darwin') {
        assetName = 'yt-dlp_macos';
      } else if (process.arch === 'arm64') {
        assetName = 'yt-dlp_linux_aarch64';
      }

      const binDir = path.join(os.tmpdir(), 'cardoso-bin');
      const binPath = path.join(binDir, assetName);

      if (fs.existsSync(binPath)) {
        try {
          const stat = fs.statSync(binPath);
          if (stat.size > 1_000_000) {
            if (process.platform !== 'win32') {
              await fs.promises.chmod(binPath, 0o755).catch(() => {});
            }
            this.cachedYtDlpPath = binPath;
            return binPath;
          }
        } catch {}
      }

      // 3. Download official standalone binary from GitHub Releases
      const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
      const partPath = `${binPath}.${Date.now()}.part`;
      try {
        console.log(`⬇️ [MediaDownloader] Bootstrapping standalone ${assetName} from GitHub Releases...`);
        await fs.promises.mkdir(binDir, { recursive: true });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000);
        try {
          const res = await fetch(downloadUrl, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'User-Agent': BROWSER_UA },
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 1_000_000) {
            throw new Error(`Downloaded binary too small (${buf.length} bytes)`);
          }
          await fs.promises.writeFile(partPath, buf);
          if (process.platform !== 'win32') {
            await fs.promises.chmod(partPath, 0o755);
          }
          await fs.promises.rename(partPath, binPath);
          console.log(`✅ [MediaDownloader] ${assetName} ready (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
          this.cachedYtDlpPath = binPath;
          return binPath;
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        await fs.promises.unlink(partPath).catch(() => {});
        console.warn(`⚠️ [MediaDownloader] Failed to bootstrap yt-dlp: ${err?.message}`);
        return null;
      } finally {
        this.ytDlpBootstrapPromise = null;
      }
    })();

    return this.ytDlpBootstrapPromise;
  }

  /**
   * Downloads best available audio/media from ANY supported URL via standalone yt-dlp.
   */
  private static async downloadViaYtDlp(url: string, isYouTube: boolean = false): Promise<Buffer> {
    const bin = await this.ensureYtDlpBinary();
    if (!bin) {
      throw new Error('yt-dlp engine lama helin');
    }

    const tmpPrefix = `cardoso_ytdlp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const outTemplate = path.join(os.tmpdir(), `${tmpPrefix}.%(ext)s`);

    const args: string[] = [
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--max-filesize',
      '45M',
      '-f',
      'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best[filesize<45M]/best',
      '-o',
      outTemplate,
    ];

    const ffmpegPath = VoiceReplyService.getFfmpegPath();
    if (ffmpegPath) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    if (isYouTube) {
      args.push('--extractor-args', 'youtube:player_client=android,ios,tv_embedded,web');
    }

    args.push(url);

    let createdFiles: string[] = [];
    try {
      console.log(`🚀 [MediaDownloader] Running yt-dlp for: ${url.slice(0, 70)}`);
      await execFileAsync(bin, args, {
        timeout: 90000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const tmpEntries = await fs.promises.readdir(os.tmpdir());
      createdFiles = tmpEntries
        .filter((name) => name.startsWith(tmpPrefix) && !name.endsWith('.part'))
        .map((name) => path.join(os.tmpdir(), name));

      if (createdFiles.length === 0) {
        throw new Error('yt-dlp ma soo saarin fayl cod ama video ah');
      }

      const buf = await fs.promises.readFile(createdFiles[0]);
      if (buf.length < 512) {
        throw new Error('Faylka yt-dlp soo dejiyay waa faaruq');
      }
      return buf;
    } finally {
      for (const f of createdFiles) {
        await fs.promises.unlink(f).catch(() => {});
      }
    }
  }

  /**
   * Resolves shortened TikTok URLs (vm.tiktok.com, vt.tiktok.com, tiktok.com/t/...).
   */
  private static async resolveTikTokShortUrl(url: string): Promise<string> {
    if (!/vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com\/t\//i.test(url)) {
      return url;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': BROWSER_UA },
        });
        if (res.url && /tiktok\.com\/.*(?:video|photo)\/\d+/i.test(res.url)) {
          return res.url.split('?')[0];
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {}
    return url;
  }

  /**
   * Downloads TikTok audio/video using a 4-tier resilient waterfall:
   *  1. SSSTik (fresh s_tt token + cookies -> music MP3 or no-watermark MP4)
   *  2. TikWM (GET + POST with safe text parsing, rate-limit retry & relative URL fix)
   *  3. Direct TikTok HTML hydration scrape (__UNIVERSAL_DATA_FOR_REHYDRATION__)
   *  4. Standalone yt-dlp engine
   */
  private static async downloadTikTokMedia(rawUrl: string): Promise<{ buffer: Buffer; source: string }> {
    const targetUrl = await this.resolveTikTokShortUrl(rawUrl);
    const errors: string[] = [];

    // ── Tier 1: SSSTik (with fresh s_tt token & cookies) ──
    try {
      const initRes = await fetch('https://ssstik.io/en-1', {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      });
      const initHtml = await initRes.text();
      const ttMatch = initHtml.match(/s_tt\s*=\s*['"]([^'"]+)['"]/i);
      const tt = ttMatch ? ttMatch[1] : '';
      const rawSetCookie =
        typeof (initRes.headers as any).getSetCookie === 'function'
          ? (initRes.headers as any).getSetCookie().map((c: string) => c.split(';')[0]).join('; ')
          : (initRes.headers.get('set-cookie') || '').split(',')[0].split(';')[0];

      if (tt) {
        const dlRes = await fetch('https://ssstik.io/abc?url=dl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': BROWSER_UA,
            Origin: 'https://ssstik.io',
            Referer: 'https://ssstik.io/en-1',
            ...(rawSetCookie ? { Cookie: rawSetCookie } : {}),
          },
          body: `id=${encodeURIComponent(targetUrl)}&locale=en&tt=${encodeURIComponent(tt)}`,
        });
        const dlHtml = await dlRes.text();

        const candidates: string[] = [];
        // Match <a ...> tags containing download_link (attribute-order agnostic!)
        const anchorRegex = /<a\b[^>]*>/gi;
        const anchors = dlHtml.match(anchorRegex) || [];
        for (const tag of anchors) {
          const hrefM = tag.match(/href=["'](https?:\/\/[^"']+)["']/i);
          if (!hrefM) continue;
          const href = hrefM[1].replace(/&amp;/g, '&');
          if (/download_link[^>]*music|music[^>]*download_link/i.test(tag)) {
            candidates.unshift(href); // highest priority: pure audio track
          } else if (/without_watermark|download_link/i.test(tag) && !/ssstik\.io/i.test(href)) {
            candidates.push(href); // fallback: clean mp4 video
          }
        }

        for (const candidateUrl of candidates) {
          try {
            const buf = await this.fetchMediaBuffer(candidateUrl, { Referer: 'https://ssstik.io/' });
            console.log(`✅ [MediaDownloader] TikTok downloaded via SSSTik (${buf.length} bytes)`);
            return { buffer: buf, source: 'TikTok (SSSTik)' };
          } catch (e: any) {
            errors.push(`SSSTik CDN: ${e?.message}`);
          }
        }
      }
    } catch (e: any) {
      errors.push(`SSSTik: ${e?.message}`);
    }

    // ── Tier 2: TikWM (GET & POST with safe JSON parsing + rate-limit retry) ──
    const tryTikWm = async (method: 'GET' | 'POST'): Promise<string[]> => {
      const res =
        method === 'GET'
          ? await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`, {
              headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*' },
            })
          : await fetch('https://www.tikwm.com/api/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': BROWSER_UA,
                Accept: 'application/json, text/plain, */*',
              },
              body: `url=${encodeURIComponent(targetUrl)}&hd=1`,
            });

      const parsed = await this.safeReadJson(res);
      if (!parsed.ok || !parsed.data) {
        throw new Error(`HTTP ${res.status} non-JSON response`);
      }
      if (parsed.data.code !== 0 || !parsed.data.data) {
        const msg = String(parsed.data.msg || 'Unknown TikWM error');
        if (/limit|second|too many/i.test(msg)) {
          throw new Error(`RATE_LIMIT:${msg}`);
        }
        throw new Error(msg);
      }

      const d = parsed.data.data;
      const rawUrls = [d.music, d.music_info?.play, d.play, d.wmplay, d.hdplay]
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        .map((u) => (u.startsWith('/') ? `https://www.tikwm.com${u}` : u));
      return Array.from(new Set(rawUrls));
    };

    for (const method of ['GET', 'POST'] as const) {
      try {
        let urls: string[] = [];
        try {
          urls = await tryTikWm(method);
        } catch (err: any) {
          if (String(err?.message || '').startsWith('RATE_LIMIT:')) {
            await new Promise((r) => setTimeout(r, 1600));
            urls = await tryTikWm(method);
          } else {
            throw err;
          }
        }
        for (const u of urls) {
          try {
            const buf = await this.fetchMediaBuffer(u, { Referer: 'https://www.tiktok.com/' });
            console.log(`✅ [MediaDownloader] TikTok downloaded via TikWM ${method} (${buf.length} bytes)`);
            return { buffer: buf, source: `TikTok (TikWM ${method})` };
          } catch (cdnErr: any) {
            errors.push(`TikWM CDN: ${cdnErr?.message}`);
          }
        }
      } catch (e: any) {
        errors.push(`TikWM ${method}: ${e?.message}`);
      }
    }

    // ── Tier 3: Direct TikTok HTML Hydration Scrape ──
    try {
      const pageRes = await fetch(targetUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const cookies =
        typeof (pageRes.headers as any).getSetCookie === 'function'
          ? (pageRes.headers as any).getSetCookie().map((c: string) => c.split(';')[0]).join('; ')
          : '';
      const html = await pageRes.text();
      const rehydMatch = html.match(
        /<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"\s+type="application\/json">([\s\S]*?)<\/script>/i
      );
      if (rehydMatch && rehydMatch[1]) {
        const json = JSON.parse(rehydMatch[1]);
        const item = json?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
        const directCandidates = [item?.music?.playUrl, item?.video?.playAddr, item?.video?.downloadAddr].filter(
          (u): u is string => typeof u === 'string' && u.startsWith('http')
        );
        for (const u of directCandidates) {
          try {
            const buf = await this.fetchMediaBuffer(u, {
              Referer: 'https://www.tiktok.com/',
              ...(cookies ? { Cookie: cookies } : {}),
            });
            console.log(`✅ [MediaDownloader] TikTok downloaded via direct scrape (${buf.length} bytes)`);
            return { buffer: buf, source: 'TikTok (Direct)' };
          } catch {}
        }
      }
    } catch (e: any) {
      errors.push(`TikTok Direct: ${e?.message}`);
    }

    // ── Tier 4: Standalone yt-dlp Engine ──
    try {
      const buf = await this.downloadViaYtDlp(targetUrl, false);
      console.log(`✅ [MediaDownloader] TikTok downloaded via yt-dlp (${buf.length} bytes)`);
      return { buffer: buf, source: 'TikTok (yt-dlp)' };
    } catch (e: any) {
      errors.push(`yt-dlp: ${e?.message}`);
    }

    throw new Error(`TikTok codkiisa lama soo dejin karin (${errors.slice(-2).join(' | ')})`);
  }

  /**
   * Downloads YouTube / Shorts / YouTube Music audio using a 2-tier waterfall:
   *  1. @distube/ytdl-core v5 (Ytdl)
   *  2. Standalone yt-dlp with android/ios/tv_embedded player clients (bypasses datacenter IP blocks!)
   */
  private static async downloadYouTubeMedia(rawUrl: string): Promise<{ buffer: Buffer; source: string }> {
    let targetUrl = rawUrl;
    const shortsMatch = rawUrl.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/i);
    if (shortsMatch) {
      targetUrl = `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
    } else {
      const youtuBeMatch = rawUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/i);
      if (youtuBeMatch) {
        targetUrl = `https://www.youtube.com/watch?v=${youtuBeMatch[1]}`;
      }
    }

    const errors: string[] = [];

    // ── Tier 1: @distube/ytdl-core v5 ──
    try {
      const { Ytdl } = await import('@distube/ytdl-core');
      const ytdl = new Ytdl();

      const streamDownload = (filterCriteria: any): Promise<Buffer> =>
        new Promise<Buffer>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('YouTube stream timeout (45s)')), 45000);
          try {
            const stream = ytdl.download(targetUrl, {
              filter: filterCriteria,
              quality: 'lowestaudio',
            });
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => {
              clearTimeout(timer);
              resolve(Buffer.concat(chunks));
            });
            stream.on('error', (err: any) => {
              clearTimeout(timer);
              reject(err);
            });
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        });

      let rawBuf: Buffer;
      try {
        rawBuf = await streamDownload({ hasAudio: true, hasVideo: false });
      } catch {
        rawBuf = await streamDownload({ hasAudio: true });
      }

      if (rawBuf && rawBuf.length > 512) {
        console.log(`✅ [MediaDownloader] YouTube downloaded via ytdl-core v5 (${rawBuf.length} bytes)`);
        return { buffer: rawBuf, source: 'YouTube (ytdl-core)' };
      }
    } catch (e: any) {
      errors.push(`ytdl-core: ${e?.message}`);
      console.warn(`⚠️ [MediaDownloader] ytdl-core failed, falling back to yt-dlp: ${e?.message}`);
    }

    // ── Tier 2: Standalone yt-dlp Engine ──
    try {
      const buf = await this.downloadViaYtDlp(targetUrl, true);
      console.log(`✅ [MediaDownloader] YouTube downloaded via yt-dlp (${buf.length} bytes)`);
      return { buffer: buf, source: 'YouTube (yt-dlp)' };
    } catch (e: any) {
      errors.push(`yt-dlp: ${e?.message}`);
    }

    throw new Error(`YouTube codkiisa lama soo dejin karin (${errors.join(' | ')})`);
  }

  /**
   * Rewrites Google Drive / Dropbox share links into direct downloadable URLs.
   */
  private static normalizeCloudShareUrl(url: string): string {
    // Google Drive: https://drive.google.com/file/d/<ID>/view...
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
    if (driveMatch) {
      return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
    }
    const driveOpenMatch = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/i);
    if (driveOpenMatch) {
      return `https://drive.google.com/uc?export=download&id=${driveOpenMatch[1]}`;
    }
    // Dropbox: ?dl=0 -> ?dl=1
    if (/dropbox\.com/i.test(url)) {
      if (/[?&]dl=0/i.test(url)) return url.replace(/([?&])dl=0/i, '$1dl=1');
      if (!/[?&]dl=1/i.test(url)) return url + (url.includes('?') ? '&dl=1' : '?dl=1');
    }
    return url;
  }

  /**
   * Downloads audio from ANY URL (TikTok, YouTube, Shorts, Facebook, Instagram,
   * Twitter/X, SoundCloud, Google Drive, Dropbox, direct MP4/MP3/WAV/M4A/OGG)
   * and converts it into a strictly validated WhatsApp Ogg Opus Voice Note ("OggS").
   */
  public static async downloadAsOggOpus(rawInput: string): Promise<{ buffer: Buffer; source: string }> {
    const cleanUrl = this.extractUrl(rawInput);
    if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
      throw new Error('Fadlan geli link sax ah oo ka bilowda https://');
    }

    let rawMedia: { buffer: Buffer; source: string };

    const isTikTok = /tiktok\.com/i.test(cleanUrl);
    const isYouTube = /youtu\.be|youtube\.com/i.test(cleanUrl);
    const isSocialVideoSite =
      /facebook\.com|fb\.watch|instagram\.com|instagr\.am|twitter\.com|x\.com|soundcloud\.com|vimeo\.com|reddit\.com|redd\.it|twitch\.tv|dailymotion\.com|t\.me|pinterest\.com|snapchat\.com/i.test(
        cleanUrl
      );

    if (isTikTok) {
      rawMedia = await this.downloadTikTokMedia(cleanUrl);
    } else if (isYouTube) {
      rawMedia = await this.downloadYouTubeMedia(cleanUrl);
    } else if (isSocialVideoSite) {
      try {
        const buf = await this.downloadViaYtDlp(cleanUrl, false);
        rawMedia = { buffer: buf, source: 'Social Video (yt-dlp)' };
      } catch (ytDlpErr: any) {
        // Fallback: check HTML og:video / og:audio meta tags
        const pageRes = await fetch(cleanUrl, {
          redirect: 'follow',
          headers: { 'User-Agent': BROWSER_UA },
        });
        const html = await pageRes.text();
        const ogMatch =
          html.match(/<meta[^>]+property=["']og:(?:audio|video(?::secure_url|:url)?)["'][^>]+content=["'](https?:\/\/[^"']+)["']/i) ||
          html.match(/<meta[^>]+content=["'](https?:\/\/[^"']+)["'][^>]+property=["']og:(?:audio|video(?::secure_url|:url)?)["']/i);
        if (ogMatch && ogMatch[1]) {
          const mediaUrl = ogMatch[1].replace(/&amp;/g, '&');
          const buf = await this.fetchMediaBuffer(mediaUrl, { Referer: cleanUrl });
          rawMedia = { buffer: buf, source: 'Social Meta Extractor' };
        } else {
          throw new Error(`Link-gan lagama soo saari karin cod/video: ${ytDlpErr?.message}`);
        }
      }
    } else {
      // Direct media URL (or unknown website -> auto fallback to yt-dlp!)
      const normalizedUrl = this.normalizeCloudShareUrl(cleanUrl);
      try {
        const buf = await this.fetchMediaBuffer(normalizedUrl);
        rawMedia = { buffer: buf, source: 'Direct Media URL' };
      } catch (directErr: any) {
        // If direct URL returned an HTML webpage (e.g. a video hosting page), try yt-dlp!
        console.log(`🔄 [MediaDownloader] Direct fetch failed (${directErr?.message}), trying yt-dlp...`);
        try {
          const buf = await this.downloadViaYtDlp(cleanUrl, false);
          rawMedia = { buffer: buf, source: 'Universal Extractor (yt-dlp)' };
        } catch (ytErr: any) {
          throw new Error(`Link-ga codka lama soo dejin karin: ${directErr?.message}`);
        }
      }
    }

    // Always convert via seekable temp-file FFmpeg to strict WhatsApp-native Ogg Opus (48kHz mono)
    // (Even if input already starts with OggS, re-encoding guarantees WhatsApp PTT compatibility
    //  when source is Vorbis/Theora OGG rather than 48kHz mono Opus!)
    console.log(`🎙️ [MediaDownloader] Converting ${rawMedia.source} (${rawMedia.buffer.length} bytes) -> WhatsApp OGG Opus PTT...`);
    const opusBuffer = await VoiceReplyService.convertMediaToOggOpusStrict(rawMedia.buffer);
    console.log(`✅ [MediaDownloader] Ready WhatsApp Voice Note (${opusBuffer.length} bytes, header=${opusBuffer.slice(0, 4).toString('ascii')})`);
    return { buffer: opusBuffer, source: rawMedia.source };
  }
}
