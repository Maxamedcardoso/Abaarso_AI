import { IncomingMessage, IMessagingTransport } from '../transports/transport.interface.js';
import { BotCategory, PlanTier } from './plan-catalog.js';
import { normalizeSubscriptionPhone, TenantRecord } from './tenant-registry.js';
import type { TenantManager } from './tenant-manager.js';

type JoinStep = 'name' | 'pin';

interface JoinDraftSession {
  step: JoinStep;
  data: {
    category: BotCategory;
    name?: string;
    phone: string;
  };
  updatedAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

function formatCategoryLabel(cat: BotCategory): string {
  if (cat === 'business') return '🛍️ Ganacsi & Dukaan (Business)';
  if (cat === 'education') return '🎓 Waxbarasho & Machad (Education)';
  return '👤 Qof Caadi ah (Personal)';
}

/**
 * Handles streamlined WhatsApp `!join` onboarding (Personal bot only: auto-registers the
 * sender's WhatsApp number, asks ONLY Name + 4-digit numeric PIN, forwards the form ONLY
 * to the Owner, and tells the applicant to wait for approval), plus Owner approval
 * (`!approve`, `!aqbal`, `!reject`, `!pending`), `!pair`, and `!pdf`.
 */
export class WhatsAppOnboardingService {
  private readonly manager: TenantManager;
  private readonly sessions: Map<string, JoinDraftSession> = new Map();

  constructor(manager: TenantManager) {
    this.manager = manager;
  }

  private pruneExpired(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [k, s] of this.sessions.entries()) {
      if (s.updatedAt < cutoff) this.sessions.delete(k);
    }
  }

  private extractSenderWhatsAppPhone(message: IncomingMessage): string {
    if (message.senderPhone) {
      const clean = normalizeSubscriptionPhone(message.senderPhone);
      if (clean.length >= 8 && clean.length <= 15) return clean;
    }
    const candidates = [message.chatId, message.senderId];
    for (const raw of candidates) {
      if (raw && raw.endsWith('@s.whatsapp.net')) {
        const clean = normalizeSubscriptionPhone(raw);
        if (clean.length >= 8 && clean.length <= 15) return clean;
      }
    }
    return '';
  }

  private resolveSubscriberForChat(message: IncomingMessage): TenantRecord | null {
    const chatId = message.chatId || message.senderId;
    const phone = this.extractSenderWhatsAppPhone(message);
    return (
      this.manager.registry.getTenantByApplicantChatId(chatId) ||
      (phone ? this.manager.registry.getTenantByPhone(phone) : null) ||
      this.manager.registry.getTenantByPhone(message.senderId) ||
      this.manager.registry.getTenantByPhone(chatId)
    );
  }

  private resolveTargetForAdminCommand(rawArg: string, onlyStatus?: TenantRecord['status']): {
    tenant?: TenantRecord;
    ambiguous?: TenantRecord[];
  } {
    const arg = (rawArg || '').trim();
    if (arg) {
      const hit = this.manager.registry.getTenantByIdOrPhone(arg);
      return { tenant: hit || undefined };
    }
    const candidates = this.manager.registry
      .listTenants(false)
      .filter((t) => (!onlyStatus ? true : t.status === onlyStatus));
    if (candidates.length === 1) {
      return { tenant: candidates[0] };
    }
    if (candidates.length > 1) {
      return { ambiguous: candidates };
    }
    return {};
  }

  public async handleMessage(
    message: IncomingMessage,
    transport: IMessagingTransport,
    isAdminUser: boolean
  ): Promise<{ handled: boolean; reason?: string }> {
    this.pruneExpired();

    const text = (message.content || '').trim();
    const lower = text.toLowerCase();
    const chatId = message.chatId || message.senderId;

    // ─── 1. Owner/Admin WhatsApp Approval / Pending / Reject Commands ───────
    if (isAdminUser && /^[!./#]?(?:pending|codsiyada)\b/i.test(lower)) {
      const pending = this.manager.registry.listTenants(false).filter((t) => t.status === 'pending');
      if (pending.length === 0) {
        await transport.sendMessage(chatId, '✅ Hadda ma jiraan codsiyo cusub oo sugaya (0 pending).');
        return { handled: true, reason: 'Admin checked empty pending list' };
      }
      const lines = [
        `📋 *[CARDOSO AI — CODSIYADA SUGAYA (${pending.length})]*\n`,
        ...pending.slice(0, 15).map((t, i) =>
          `${i + 1}. *${t.name}* (+${t.allowedPhone}) — ${formatCategoryLabel(t.category)}\n` +
          `   ID: \`${t.id}\`\n` +
          `   👉 Aqbal: \`!approve ${t.id}\` | Diid: \`!reject ${t.id}\``
        ),
      ];
      await transport.sendMessage(chatId, lines.join('\n'));
      return { handled: true, reason: 'Admin listed pending signups' };
    }

    const approveMatch = text.match(/^[!./#]?(?:approve|aqbal|ogolow)(?:\s+(.+))?$/i);
    if (isAdminUser && approveMatch) {
      const tokens = (approveMatch[1] || '').trim().split(/\s+/).filter(Boolean);
      const targetArg = tokens[0] || '';
      const maybeTier = tokens[1] && ['trial_free', 'starter', 'business', 'education'].includes(tokens[1].toLowerCase())
        ? (tokens[1].toLowerCase() as PlanTier)
        : 'trial_free';

      const resolved = this.resolveTargetForAdminCommand(targetArg, 'pending');
      if (resolved.ambiguous) {
        const list = resolved.ambiguous
          .slice(0, 10)
          .map((t) => `• *${t.name}* (+${t.allowedPhone}) -> \`!approve ${t.id}\``)
          .join('\n');
        await transport.sendMessage(
          chatId,
          `ℹ️ Waxaa jira *${resolved.ambiguous.length}* codsi oo sugaya. Fadlan dooro ID-ga midka aad ogolaanayso:\n\n${list}`
        );
        return { handled: true, reason: 'Ambiguous approve without ID' };
      }

      const target = resolved.tenant;
      if (!target || target.id === 'owner') {
        await transport.sendMessage(
          chatId,
          '⚠️ Lama helin codsi ku habboon. Qor `!pending` si aad u aragto ID-yada sugaya.'
        );
        return { handled: true, reason: 'Approve target not found' };
      }

      const approved = await this.manager.approveAndStartTenant(target.id, {
        planTier: maybeTier,
        durationDays: 30,
      });
      if (!approved) {
        await transport.sendMessage(chatId, '❌ Waa la waayay in codsigan la furo.');
        return { handled: true, reason: 'Approve failed' };
      }

      const codeText = approved.generatedPairingCode
        ? `🔑 *Koodhka 8-da God:* \`${approved.generatedPairingCode}\` (waa loo diray qofka)`
        : `ℹ️ *Koodhka Pairing:* Qofku wuxuu heli karaa via \`!pair\` ama Dashboard-ka`;

      const portalLink = this.manager.getTenantPortalUrl(approved);
      await transport.sendMessage(
        chatId,
        `✅ *[CARDOSO AI — CODSIGA WAA LA OGOLAADAY]*\n\n` +
          `• *Magaca:* ${approved.name}\n` +
          `• *Lambarka:* +${approved.allowedPhone}\n` +
          `• *Qaybta:* ${formatCategoryLabel(approved.category)}\n` +
          `• ${codeText}\n` +
          `• 🌐 *Link-ga Dashboard-ka:* ${portalLink}\n` +
          `• 📄 *Buugga PDF-ka:* Waa loo diray WhatsApp-kiisa!\n` +
          `• *ID:* \`${approved.id}\``
      );
      return { handled: true, reason: 'Admin approved signup via WhatsApp' };
    }

    const rejectMatch = text.match(/^[!./#]?(?:reject|diid)(?:\s+(.+))?$/i);
    if (isAdminUser && rejectMatch) {
      const targetArg = (rejectMatch[1] || '').trim().split(/\s+/)[0] || '';
      // If the target is 'all', 'dhammaan', or a phone number, pass through to Call Reject handler
      if (/^(?:all|dhammaan|dhamaan|kulligood)$/i.test(targetArg) || /^[0-9+]{7,16}$/.test(targetArg)) {
        return { handled: false, reason: 'Pass to call reject handler' };
      }
      const resolved = this.resolveTargetForAdminCommand(targetArg, 'pending');
      if (resolved.ambiguous) {
        await transport.sendMessage(
          chatId,
          `ℹ️ Waxaa jira dhowr codsi — ku qor \`!reject <ID>\`. Eeg \`!pending\`.`
        );
        return { handled: true, reason: 'Ambiguous reject' };
      }
      const target = resolved.tenant;
      if (!target || target.id === 'owner') {
        await transport.sendMessage(chatId, '⚠️ Lama helin codsi la diido. Qor `!pending` si aad u aragto.');
        return { handled: true, reason: 'Reject target not found' };
      }
      const updated = this.manager.registry.rejectTenant(target.id);
      if (updated) {
        this.manager.markRegistryDirty(true);
        const replyTargets = Array.from(
          new Set(
            [
              updated.applicantChatId,
              normalizeSubscriptionPhone(updated.allowedPhone)
                ? `${normalizeSubscriptionPhone(updated.allowedPhone)}@s.whatsapp.net`
                : '',
            ].filter((s): s is string => Boolean(s))
          )
        );
        for (const rJid of replyTargets) {
          await transport
            .sendMessage(
              rJid,
              `ℹ️ *[CARDOSO AI]*: Waan ka xunnahay *${updated.name}*, codsigaagii hadda lama oggolaan. Fadlan la xidhiidh maamulka haddii aad su'aal qabto.`
            )
            .catch(() => {});
        }
      }
      await transport.sendMessage(chatId, `❌ Codsiga *${target.name}* (\`${target.id}\`) waa la diiday.`);
      return { handled: true, reason: 'Admin rejected signup via WhatsApp' };
    }

    // ─── 2. Applicant/Subscriber !pair & !pdf Self-Service ──────────────────
    if (!message.isGroup && /^[!./#]?(?:pair|code|koodh)\b/i.test(lower)) {
      const sub = this.resolveSubscriberForChat(message);
      if (!sub) {
        await transport.sendMessage(
          chatId,
          'ℹ️ Lambarkaagan weli ma diiwaangashana. Qor *!join* si aad u furato bot-kaaga Personal!'
        );
        return { handled: true, reason: 'Pair command for unregistered user' };
      }
      if (sub.status === 'pending') {
        await transport.sendMessage(
          chatId,
          `⏳ Codsigaagu (*${sub.id}*) weli wuxuu sugayaa ogolaanshaha maamulka. Fadlan sug inta la aqbalayo!`
        );
        return { handled: true, reason: 'Pair requested while pending' };
      }
      if (!this.manager.registry.isTenantActive(sub)) {
        await transport.sendMessage(
          chatId,
          '⛔ Akoonkaagu hadda ma firfircoona. Fadlan la xidhiidh maamulka si dib loogu shido.'
        );
        return { handled: true, reason: 'Pair requested for inactive tenant' };
      }

      await transport.sendMessage(chatId, '⏳ Waxaa la soo saarayaa lambarka 8-da god ee WhatsApp Pairing Code...');
      const pairRes = await this.manager.requestPairingCode(sub.id, sub.allowedPhone);
      if (pairRes.success && pairRes.formattedCode) {
        await transport.sendMessage(
          chatId,
          `🔑 *[CARDOSO AI — KOODHKAAGA CUSUB]*\n\n` +
            `👉 *${pairRes.formattedCode}*\n\n` +
            `📲 *Sida Loo Geliyo (2 daqiiqo gudahood):*\n` +
            `1. Fur WhatsApp ➔ *Linked Devices*\n` +
            `2. Taabo *Link a Device* ➔ hoosta dooro *"Link with phone number instead"*\n` +
            `3. Geli koodhkan: *${pairRes.formattedCode}*`
        );
      } else {
        await transport.sendMessage(
          chatId,
          `⚠️ ${pairRes.error || 'Koodhka hadda lama soo saari karin — fadlan furo Dashboard-kaaga link-ga hoose ama mar kale !pair qor.'}`
        );
      }
      return { handled: true, reason: 'Fresh pairing code sent via WhatsApp' };
    }

    if (!message.isGroup && /^[!./#]?(?:pdf|buug|guide|amarada)\b/i.test(lower)) {
      const sub = this.resolveSubscriberForChat(message) || (isAdminUser ? this.manager.registry.getTenant('owner') : null);
      if (!sub) {
        await transport.sendMessage(chatId, 'ℹ️ Marka hore iska diiwaangeli adigoo qoraya *!join* si aad u hesho buuggaaga PDF-ka.');
        return { handled: true, reason: 'Guide PDF requested by unknown user' };
      }
      await this.manager.sendSubscriberGuidePdf(sub, chatId, null, transport);
      return { handled: true, reason: 'Subscriber guide PDF sent on demand' };
    }

    // ─── 3. Streamlined !join Form (Personal Only, Sender Number Auto-Registered, Name + 4-Digit PIN) ─
    if (/^[!./#]?join\b|^!isdiiwaangeli\b/i.test(lower)) {
      if (message.isGroup) {
        await transport.sendMessage(
          chatId,
          'ℹ️ Walaal, si ammaanka lambarkaaga loo ilaaliyo, fadlan fariinta *!join* iigu soo dir DM (Private Chat) toos ah!',
          { replyToMessageId: message.id }
        );
        return { handled: true, reason: '!join redirected from group to DM' };
      }

      const senderPhone = this.extractSenderWhatsAppPhone(message);
      if (!senderPhone) {
        await transport.sendMessage(
          chatId,
          '⚠️ WhatsApp-ku ma soo gudbin lambarkaaga rasmiga ah (Privacy LID). Fadlan lambarkaaga rasmiga ah ka soo dir fariin toos ah ama iska diiwaangeli bogga web-ka.'
        );
        return { handled: true, reason: 'Unable to resolve sender phone automatically' };
      }

      const existing = this.resolveSubscriberForChat(message);
      if (existing?.status === 'pending') {
        await transport.sendMessage(
          chatId,
          `⏳ *Codsigaagu horey ayuu u diiwaangashanaa!* (\`${existing.id}\`)\n\n` +
            `• *Magaca:* ${existing.name}\n` +
            `• *Lambarka:* +${existing.allowedPhone}\n` +
            `• *Nooca:* 👤 *Personal (Qof Caadi ah)*\n\n` +
            `Fadlan *sug* inta codsigaaga la aqbalayo. Isla marka la oggolaado, waxaad heli doontaa lambarka 8-da god & buugga PDF!`
        );
        return { handled: true, reason: '!join reminded user already pending' };
      }
      if (existing && this.manager.registry.isTenantActive(existing)) {
        await transport.sendMessage(
          chatId,
          `✅ Lambarkan (*+${existing.allowedPhone}*) horey ayuu bot firfircoon ugu leeyahay!\n` +
            `Qor *!pair* haddii aad rabto koodh cusub oo WhatsApp ah, ama *!pdf* si aad u hesho buugga amarrada.`
        );
        return { handled: true, reason: '!join user already active' };
      }

      this.sessions.set(chatId, {
        step: 'name',
        data: { category: 'personal', phone: senderPhone },
        updatedAt: Date.now(),
      });

      await transport.sendMessage(
        chatId,
        `👤 *ISDIIWAANGELINTA BOT-KA PERSONAL — CARDOSO AI*\n\n` +
          `Waxaa laguu diiwaangelinayaa adeegga *Personal Assistant (Qof Caadi ah)* adigoo isticmaalaya isla lambarkaaga WhatsApp (*+${senderPhone}*).\n\n` +
          `1️⃣ Qor *Magacaaga*:\n_(Ama qor *!cancel* haddii aad joojinayso)_`
      );
      return { handled: true, reason: '!join personal started (asking name)' };
    }

    const active = this.sessions.get(chatId);
    if (!active || message.isGroup) {
      return { handled: false };
    }

    if (/^[!./#]?(?:cancel|jooji-codsi|bax)\b/i.test(lower)) {
      this.sessions.delete(chatId);
      await transport.sendMessage(chatId, '❌ Codsigaagii waa la joojiyay. Mar kasta oo aad rabto waxaad soo qori kartaa *!join*.');
      return { handled: true, reason: '!join cancelled by user' };
    }

    active.updatedAt = Date.now();

    // Step 1: Name -> immediately ask 4-digit PIN (nothing else!)
    if (active.step === 'name') {
      if (text.length < 2) {
        await transport.sendMessage(chatId, '⚠️ Fadlan qor magac sax ah (ugu yaraan 2 xaraf).');
        return { handled: true, reason: '!join name too short' };
      }
      active.data.name = text.slice(0, 80);
      active.step = 'pin';
      await transport.sendMessage(
        chatId,
        `2️⃣ Sameyso *PIN ka kooban 4 lambar* (tusaale: \`2026\`):`
      );
      return { handled: true, reason: '!join moved to 4-digit PIN step' };
    }

    // Step 2: Strict 4-digit PIN -> submit immediately, notify ONLY Owner, tell applicant to wait!
    if (active.step === 'pin') {
      const cleanPin = text.replace(/\s+/g, '');
      if (!/^\d{4}$/.test(cleanPin)) {
        await transport.sendMessage(
          chatId,
          '⚠️ PIN-ku waa inuu noqdaa *4 lambar oo keliya* (tusaale: `1234` ama `2026`). Fadlan geli 4 lambar:'
        );
        return { handled: true, reason: '!join invalid 4-digit PIN retry' };
      }

      const draft = { ...active.data };
      this.sessions.delete(chatId);

      try {
        const res = await this.manager.registerPublicSignup({
          name: draft.name || 'User',
          phone: draft.phone,
          category: 'personal',
          pin: cleanPin,
          applicantChatId: chatId,
          ownerOnlyNotification: true,
        });

        await transport.sendMessage(
          chatId,
          `⏳ *FADLAN SUG — CODSIGAAGA WAA LA GUDBIYAY!*\n\n` +
            `• *Nooca:* 👤 *Personal (Qof Caadi ah)*\n` +
            `• *Magaca:* ${res.tenant.name}\n` +
            `• *Lambarka:* +${res.tenant.allowedPhone}\n` +
            `• *PIN-ka:* \`****\` *(Waala kaydiyay)*\n` +
            `• *ID-ga Codsiga:* \`${res.tenant.id}\`\n\n` +
            `🙏 *Fadlan sug inta codsigaaga la aqbalayo.* Isla marka la oggolaado, isla halkan WhatsApp ayaad si toos ah uga heli doontaa:\n` +
            `1️⃣ Lambarka *8-da god* si aad WhatsApp-kaaga ugu xidho\n` +
            `2️⃣ Buugga *PDF* ee ay ku qoran yihiin amarrada & sida loo isticmaalo.`
        );
        return { handled: true, reason: '!join personal completed and forwarded ONLY to owner' };
      } catch (err: any) {
        await transport.sendMessage(
          chatId,
          `❌ ${err?.message || 'Codsiga lama diiwaangelin karin. Fadlan mar kale isku day adigoo qoraya !join'}`
        );
        return { handled: true, reason: '!join submission error' };
      }
    }

    return { handled: false };
  }
}
