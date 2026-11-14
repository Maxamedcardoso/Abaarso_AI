import { WASocket, proto } from '@whiskeysockets/baileys';
import { broadcastService } from './broadcast.service.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { OutgoingMedia, IMessagingTransport } from '../transports/transport.interface.js';

export interface PostStatusOptions {
  backgroundColor?: string;
  font?: number;
  statusJidList?: string[];
}

export interface GroupInfo {
  id: string;
  subject: string;
  owner?: string;
  creation?: number;
  participantsCount: number;
  adminCount: number;
  desc?: string;
}

export class WhatsAppManagerService {
  private socket: WASocket | null = null;
  private autoViewStatus: boolean = true;
  private botJid: string = '';
  private aiOrchestrator: AIOrchestrator | null = null;

  public setSocket(socket: WASocket | null): void {
    this.socket = socket;
    if (socket?.user?.id) {
      this.botJid = socket.user.id.split(':')[0].split('@')[0];
    }
  }

  public setBotJid(jid: string): void {
    this.botJid = jid.split(':')[0].split('@')[0];
  }

  public setAIOrchestrator(ai: AIOrchestrator): void {
    this.aiOrchestrator = ai;
  }

  public isAutoViewStatusEnabled(): boolean {
    return this.autoViewStatus;
  }

  public setAutoViewStatus(enabled: boolean): void {
    this.autoViewStatus = enabled;
    console.log(`👁️ [WhatsAppManager] Auto-View Status is now: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  public isConnected(): boolean {
    return Boolean(this.socket);
  }

  /**
   * Builds the recipient JID list for status posts (Stories).
   * WhatsApp requires statusJidList to know which contacts can decrypt the status.
   */
  public getStatusRecipients(): string[] {
    const jidSet = new Set<string>();
    const contacts = broadcastService.getContacts();

    for (const c of contacts) {
      if (c.jid && c.jid.endsWith('@s.whatsapp.net')) {
        jidSet.add(c.jid);
      }
    }

    if (this.botJid) {
      jidSet.add(`${this.botJid}@s.whatsapp.net`);
    }

    if (this.socket?.user?.id) {
      const cleanMe = this.socket.user.id.split(':')[0].split('@')[0];
      if (cleanMe) jidSet.add(`${cleanMe}@s.whatsapp.net`);
    }

    const envAdmins = (process.env.ADMIN_PHONE_NUMBERS || '')
      .split(',')
      .map(n => n.trim().replace(/[^0-9]/g, ''))
      .filter(Boolean);
    for (const a of envAdmins) {
      jidSet.add(`${a}@s.whatsapp.net`);
    }

    return Array.from(jidSet);
  }

  // ─── 1. WHATSAPP STATUS (STORIES) MANAGEMENT ──────────────────────────────

  /**
   * Posts a text status update to WhatsApp (status@broadcast) with styling.
   */
  public async postTextStatus(
    text: string,
    options?: PostStatusOptions
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda (Socket not connected).' };
    }

    const cleanText = text.trim();
    if (!cleanText) {
      return { success: false, message: 'Qoraalka status-ka ma noqon karo mid maran.' };
    }

    try {
      const statusJidList = options?.statusJidList && options.statusJidList.length > 0
        ? options.statusJidList
        : this.getStatusRecipients();

      const vibrantColors = [
        '#1e3c72', // Royal Navy Blue
        '#0f5132', // Deep Forest Green
        '#4a154b', // Imperial Purple
        '#0d6efd', // Vibrant Blue
        '#b02a37', // Crimson Red
        '#198754', // Emerald Green
        '#6f42c1', // Royal Violet
        '#0b7285', // Teal Ocean
        '#d63384', // Magenta Rose
      ];
      const chosenColor = options?.backgroundColor || vibrantColors[Math.floor(Math.random() * vibrantColors.length)];
      const chosenFont = options?.font || 1;

      const sent = await this.socket.sendMessage(
        'status@broadcast',
        {
          text: cleanText,
          backgroundColor: chosenColor,
          font: chosenFont,
        } as any,
        {
          statusJidList: statusJidList.length > 0 ? statusJidList : undefined,
        }
      );

      console.log(`📢 [WhatsApp Status] Status text posted successfully! (${cleanText.slice(0, 45)}...)`);
      return {
        success: true,
        message: `✅ Status-kaaga si guul leh ayaa loogu daabacay WhatsApp!\n• Fariinta: "${cleanText}"\n• Midabka: ${chosenColor}\n• Dadka u muuqanaya: ${statusJidList.length > 0 ? `${statusJidList.length} qof` : 'Dhammaan contacts-ka'}`,
        messageId: sent?.key?.id || undefined,
      };
    } catch (err: any) {
      console.error('❌ [WhatsApp Status] Error posting text status:', err);
      return { success: false, message: `Cilad ayaa ku timid soo dhigista status-ka: ${err.message}` };
    }
  }

  /**
   * Posts an image, video, or voice status to WhatsApp (status@broadcast).
   */
  public async postMediaStatus(
    media: { buffer: Buffer; mimeType: string; caption?: string; type: 'image' | 'video' | 'audio' },
    options?: { backgroundColor?: string; statusJidList?: string[] }
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda (Socket not connected).' };
    }

    try {
      const statusJidList = options?.statusJidList && options.statusJidList.length > 0
        ? options.statusJidList
        : this.getStatusRecipients();

      let sent: any = undefined;

      if (media.type === 'image') {
        sent = await this.socket.sendMessage(
          'status@broadcast',
          {
            image: media.buffer,
            caption: media.caption || '',
          },
          {
            statusJidList: statusJidList.length > 0 ? statusJidList : undefined,
          }
        );
      } else if (media.type === 'video') {
        sent = await this.socket.sendMessage(
          'status@broadcast',
          {
            video: media.buffer,
            caption: media.caption || '',
          },
          {
            statusJidList: statusJidList.length > 0 ? statusJidList : undefined,
          }
        );
      } else if (media.type === 'audio') {
        const colors = ['#1e3c72', '#0f5132', '#4a154b', '#0d6efd', '#6f42c1'];
        const chosenColor = options?.backgroundColor || colors[Math.floor(Math.random() * colors.length)];
        sent = await this.socket.sendMessage(
          'status@broadcast',
          {
            audio: media.buffer,
            mimetype: 'audio/mp4',
            ptt: true,
            backgroundColor: chosenColor,
          } as any,
          {
            statusJidList: statusJidList.length > 0 ? statusJidList : undefined,
          }
        );
      }

      console.log(`📢 [WhatsApp Status] Media status (${media.type}) posted successfully!`);
      return {
        success: true,
        message: `✅ Sawirka/Codka/Muuqaalka si guul leh ayaa loogu soo dhigay WhatsApp Status!`,
        messageId: sent?.key?.id || undefined,
      };
    } catch (err: any) {
      console.error('❌ [WhatsApp Status] Error posting media status:', err);
      return { success: false, message: `Cilad ayaa ku timid soo dhigista media status: ${err.message}` };
    }
  }

  /**
   * Uses Gemini AI to craft an inspiring, educational status in natural Somali and posts it.
   */
  public async generateAndPostAIStatus(
    topic?: string
  ): Promise<{ success: boolean; message: string; generatedText?: string }> {
    try {
      const promptTopic = topic?.trim() || 'dhiirigelin, guul, waxbarasho, iyo horumarka ardayda Soomaaliyeed';
      let statusText = '';

      if (this.aiOrchestrator) {
        const prompt = `Waxaad tahay qoraa Soomaali ah oo aad ugu xeeldheer qoraallada dhiirigelinta iyo xigmadda WhatsApp Status.
Mawduuca: "${promptTopic}".
Soo saar hal fariin oo aad u gaaban (1 ilaa 2 weedhood oo kaliya), macno qoto dheer leh, qalbiga taabanaysa, ku qoran af-Soomaali dabiici ah oo heer sare ah, oo ay ku jiraan 2-3 emoji oo qurux badan.
Marnaba ha ku darin hordhac ama faahfaahin dambe, soo celi QORAALKA STATUS-KA OO KELIYA.`;

        const response = await this.aiOrchestrator.generateResponse(prompt);
        statusText = (response.text || '').replace(/^["']|["']$/g, '').trim();
      }

      if (!statusText) {
        const quotes = [
          '✨ "Guushu maaha wax kugu yimaada si kadis ah, waa miraha dadaalkaaga joogtada ah ee maalinlaha ah." 📚🚀',
          '💡 "Ha sugin waqti ku habboon, qaado waqtiga hadda jira oo ka dhig mid ku habboon." 🌱🌟',
          '🎯 "Caqabadaha maanta waxay dhisayaan awooddaada berri. Waligaa ha quusan!" 💪🔥',
          '📖 "Aqoontu waa iftiinka kaliya ee qofka ka saara mugdiga jahliga una horseeda mustaqbal ifaya." 🎓✨',
          '⏳ "Waqtigu waa raasamaalkaaga ugu qaalisan, u maal-gali waxyaabaha mustaqbalkaaga dhisaya." ⏰💎',
        ];
        statusText = quotes[Math.floor(Math.random() * quotes.length)];
      }

      const postResult = await this.postTextStatus(statusText);
      if (postResult.success) {
        return {
          success: true,
          message: `🌟 *[AI WhatsApp Status]*\n\nFariintan dhiirigelinta ah ayaa toos loogu soo dhigay WhatsApp Status:\n\n"${statusText}"`,
          generatedText: statusText,
        };
      } else {
        return {
          success: false,
          message: postResult.message,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: `Cilad ayaa ku timid abuurista AI Status: ${err.message}`,
      };
    }
  }

  /**
   * Marks incoming status update as read (Auto View Status / Mark Seen).
   */
  public async markStatusSeen(key: proto.IMessageKey): Promise<boolean> {
    if (!this.socket || !this.autoViewStatus) return false;
    try {
      await this.socket.readMessages([key]);
      return true;
    } catch (err: any) {
      console.warn(`[WhatsAppManager] Failed to mark status seen: ${err?.message}`);
      return false;
    }
  }

  // ─── 2. REPLY & DIRECT MESSAGING CONTROL ──────────────────────────────────

  /**
   * Normalizes any raw phone number or JID to standard WhatsApp JID format.
   * Seamlessly handles @252634949642, plain numbers, 061/063 local formats, and full JIDs.
   */
  public normalizeToJid(raw: string): string {
    const clean = (raw || '').trim();
    if (!clean) return '';
    // If it's already a full WhatsApp JID like 252634949642@s.whatsapp.net or 252634949642:5@s.whatsapp.net
    if (clean.includes('@s.whatsapp.net') || clean.includes('@lid')) {
      const parts = clean.split('@');
      const user = parts[0].split(':')[0].replace(/[^0-9]/g, '');
      const server = parts[1];
      return `${user}@${server}`;
    }
    // Clean out all non-digits (handles leading @, +, spaces, hyphens, parentheses, etc.)
    const digits = clean.replace(/[^0-9]/g, '');
    let normalized = digits;
    if (/^0[69]\d{8}$/.test(digits)) {
      normalized = '252' + digits.slice(1);
    } else if (/^[69]\d{8}$/.test(digits)) {
      normalized = '252' + digits;
    }
    return normalized ? `${normalized}@s.whatsapp.net` : '';
  }

  /**
   * Sends a direct reply or new message to any specified contact number.
   */
  public async sendDirectReply(
    targetPhoneOrJid: string,
    text: string,
    transport?: IMessagingTransport,
    options?: { replyToMessageId?: string; media?: OutgoingMedia }
  ): Promise<{ success: boolean; message: string }> {
    const targetJid = this.normalizeToJid(targetPhoneOrJid);

    try {
      if (options?.media && transport?.sendMedia) {
        const sent = await transport.sendMedia(targetJid, options.media, {
          replyToMessageId: options.replyToMessageId,
        });
        if (sent) {
          return { success: true, message: `✅ Fariinta media-da ah si guul leh ayaa loogu diray ${targetJid}!` };
        }
      }

      if (transport) {
        const sent = await transport.sendMessage(targetJid, text, {
          replyToMessageId: options?.replyToMessageId,
        });
        if (sent) {
          return { success: true, message: `✅ Fariintaada si guul leh ayaa loogu diray ${targetJid}!` };
        }
      } else if (this.socket) {
        await this.socket.sendMessage(targetJid, { text });
        return { success: true, message: `✅ Fariintaada si guul leh ayaa loogu diray ${targetJid}!` };
      }

      return { success: false, message: 'Ma suurtogalin in fariinta la diro (Transport not available).' };
    } catch (err: any) {
      return { success: false, message: `Cilad dirista: ${err.message}` };
    }
  }

  // ─── 3. GROUP MANAGEMENT (FULL 100% CONTROL) ──────────────────────────────

  /**
   * Mentions and tags all participants in a group chat.
   */
  public async tagAll(
    groupJid: string,
    customMessage?: string
  ): Promise<{ success: boolean; message: string; count: number }> {
    if (!this.socket) {
      return { success: false, message: 'WhatsApp ma xirna hadda.', count: 0 };
    }

    try {
      const meta = await this.socket.groupMetadata(groupJid);
      const participants = meta.participants.map(p => p.id);

      let text = `📢 *[OGEYSIIS DHAMMAAN — ${meta.subject}]*\n\n`;
      if (customMessage?.trim()) {
        text += `💬 *Fariinta:* ${customMessage.trim()}\n\n`;
      }
      text += `👥 *Xubnaha Kooxda (${participants.length}):*\n`;
      for (const p of participants) {
        const num = p.split('@')[0].split(':')[0];
        text += `• @${num}\n`;
      }

      await this.socket.sendMessage(groupJid, {
        text,
        mentions: participants,
      });

      return {
        success: true,
        message: `✅ Waxaa la tag-gareeyay ${participants.length} xubnood oo kooxda ku jira!`,
        count: participants.length,
      };
    } catch (err: any) {
      console.error('[WhatsAppManager] tagAll error:', err);
      return { success: false, message: `Cilad tag-garaynta kooxda: ${err.message}`, count: 0 };
    }
  }

  /**
   * Removes (kicks) a participant from the group.
   * Supports @mention, raw number, local 061/063 format, or JID.
   */
  public async kickMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan. Fadlan qor lambar sax ah ama @ mention.' };
    }

    try {
      await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
      const num = participantJid.split('@')[0];
      return {
        success: true,
        message: `👞 Qofka (@${num}) si guul leh ayaa looga saaray kooxda.`,
        jid: participantJid,
      };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin kooxda si uu dadka uga saari karo.` };
      }
      return { success: false, message: `Cilad ka-saaridda xubinta: ${err.message}` };
    }
  }

  /**
   * Adds a new member to the group.
   * Supports @mention, raw number, local 061/063 format, or JID.
   */
  public async addMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan. Fadlan qor lambar sax ah ama @ mention.' };
    }

    try {
      const res: any = await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'add');
      const status = res?.[0]?.status;
      const num = participantJid.split('@')[0];

      if (status === '403') {
        return {
          success: false,
          message: `⚠️ Qofka (@${num}) wuxuu xidhay Privacy-ga ku-darista kooxaha (Direct Add). Fadlan u dir link-ga kooxda si uu isagu u soo galo.`,
          jid: participantJid,
        };
      } else if (status === '409') {
        return {
          success: false,
          message: `ℹ️ Qofka (@${num}) durba wuxuu ku jiraa kooxda!`,
          jid: participantJid,
        };
      }

      return {
        success: true,
        message: `✅ Qofka (@${num}) waxaa lagu daray kooxda.`,
        jid: participantJid,
      };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin kooxda si uu dadka ugu dari karo.` };
      }
      return { success: false, message: `Cilad ku-daridda kooxda: ${err.message}` };
    }
  }

  /**
   * Promotes a group member to Admin.
   */
  public async promoteMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan.' };
    }

    try {
      await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'promote');
      const num = participantJid.split('@')[0];
      return { success: true, message: `👑 Qofka (@${num}) waxaa laga dhigay Admin!`, jid: participantJid };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin.` };
      }
      return { success: false, message: `Cilad dalacsiinta Admin: ${err.message}` };
    }
  }

  /**
   * Demotes a group Admin to regular member.
   */
  public async demoteMember(
    groupJid: string,
    participantPhoneOrJid: string
  ): Promise<{ success: boolean; message: string; jid?: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const participantJid = this.normalizeToJid(participantPhoneOrJid);
    if (!participantJid) {
      return { success: false, message: 'Lambar khaldan ama lama aqoonsan.' };
    }

    try {
      await this.socket.groupParticipantsUpdate(groupJid, [participantJid], 'demote');
      const num = participantJid.split('@')[0];
      return { success: true, message: `👤 Qofka (@${num}) maamulnimadii waa laga qaaday.`, jid: participantJid };
    } catch (err: any) {
      const isForbidden = err?.message?.includes('forbidden') || err?.message?.includes('403') || err?.output?.statusCode === 403;
      if (isForbidden) {
        return { success: false, message: `⚠️ Bot-ku maaha Admin kooxdan! Fadlan marka hore bot-ka ka dhig Admin.` };
      }
      return { success: false, message: `Cilad hoos-u-dhigidda: ${err.message}` };
    }
  }

  /**
   * Mutes or Unmutes the group (Announcement mode vs All members).
   */
  public async setGroupMute(
    groupJid: string,
    mute: boolean
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.groupSettingUpdate(groupJid, mute ? 'announcement' : 'not_announcement');
      return {
        success: true,
        message: mute
          ? '🔒 Kooxda waa la xidhay: Maamulka (Admins) oo kaliya ayaa qori kara fariimaha.'
          : '🔓 Kooxda waa la furay: Dhammaan xubnuhu way qori karaan fariimaha.',
      };
    } catch (err: any) {
      return { success: false, message: `Cilad beddelidda setting-ka kooxda: ${err.message}` };
    }
  }

  /**
   * Retrieves the invite link for a group.
   */
  public async getGroupInviteLink(
    groupJid: string
  ): Promise<{ success: boolean; link?: string; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const code = await this.socket.groupInviteCode(groupJid);
      const link = `https://chat.whatsapp.com/${code}`;
      return {
        success: true,
        link,
        message: `🔗 *Link-ga Kooxda:*\n${link}`,
      };
    } catch (err: any) {
      return { success: false, message: `Cilad helidda link-ga kooxda: ${err.message}` };
    }
  }

  /**
   * Fetches full metadata and member count of a group.
   */
  public async getGroupInfo(
    groupJid: string
  ): Promise<{ success: boolean; info?: GroupInfo; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const meta = await this.socket.groupMetadata(groupJid);
      const adminCount = meta.participants.filter(p => Boolean(p.admin)).length;

      const info: GroupInfo = {
        id: meta.id,
        subject: meta.subject,
        owner: meta.owner,
        creation: meta.creation,
        participantsCount: meta.participants.length,
        adminCount,
        desc: meta.desc,
      };

      const msg =
        `📋 *[XOGTA KOOXDA — ${meta.subject}]*\n` +
        `• ID-ga: \`${meta.id}\`\n` +
        `• Xubnaha: *${meta.participants.length} qof*\n` +
        `• Admins-ka: *${adminCount} qof*\n` +
        (meta.desc ? `• Sharaxaadda: ${meta.desc}\n` : '');

      return { success: true, info, message: msg };
    } catch (err: any) {
      return { success: false, message: `Cilad xogta kooxda: ${err.message}` };
    }
  }

  // ─── 4. PROFILE & ACCOUNT MANAGEMENT ──────────────────────────────────────

  /**
   * Changes the bot's WhatsApp display name.
   */
  public async updateProfileName(
    name: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.updateProfileName(name.trim());
      return { success: true, message: `✅ Magaca bot-ka WhatsApp-ka waxaa loo beddelay: *${name.trim()}*` };
    } catch (err: any) {
      return { success: false, message: `Cilad magac beddelka: ${err.message}` };
    }
  }

  /**
   * Changes the bot's WhatsApp bio / About text.
   */
  public async updateProfileBio(
    bioText: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.updateProfileStatus(bioText.trim());
      return { success: true, message: `✅ Bio-ga / About-ka bot-ka waxaa loo beddelay:\n"${bioText.trim()}"` };
    } catch (err: any) {
      return { success: false, message: `Cilad bio beddelka: ${err.message}` };
    }
  }

  /**
   * Updates the bot's profile picture.
   */
  public async updateProfilePicture(
    imageBuffer: Buffer
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const meJid = this.socket.user?.id || '';
      await this.socket.updateProfilePicture(meJid, imageBuffer);
      return { success: true, message: '✅ Sawirka profile-ka bot-ka si guul leh ayaa loo beddelay!' };
    } catch (err: any) {
      return { success: false, message: `Cilad sawir beddelka: ${err.message}` };
    }
  }

  /**
   * Blocks a contact on WhatsApp.
   */
  public async blockUser(
    phoneOrJid: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const jid = this.normalizeToJid(phoneOrJid);
    try {
      await this.socket.updateBlockStatus(jid, 'block');
      return { success: true, message: `🚫 Lambarka (${jid}) waa la block-gareeyay.` };
    } catch (err: any) {
      return { success: false, message: `Cilad block-garaynta: ${err.message}` };
    }
  }

  /**
   * Unblocks a contact on WhatsApp.
   */
  public async unblockUser(
    phoneOrJid: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    const jid = this.normalizeToJid(phoneOrJid);
    try {
      await this.socket.updateBlockStatus(jid, 'unblock');
      return { success: true, message: `✅ Lambarka (${jid}) block-gii waa laga qaaday.` };
    } catch (err: any) {
      return { success: false, message: `Cilad unblock-garaynta: ${err.message}` };
    }
  }

  // ─── 5. MESSAGE MANAGEMENT (DELETE, REACT, PIN) ───────────────────────────

  /**
   * Deletes a message for everyone (Revoke).
   */
  public async deleteMessage(
    chatId: string,
    messageKey: proto.IMessageKey
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.sendMessage(chatId, { delete: messageKey });
      return { success: true, message: '🗑️ Fariintii waa la tirtiray dhammaan (Delete for everyone).' };
    } catch (err: any) {
      return { success: false, message: `Cilad tirtiridda fariinta: ${err.message}` };
    }
  }

  /**
   * Reacts to a message with an emoji.
   */
  public async reactToMessage(
    chatId: string,
    messageKey: proto.IMessageKey,
    emoji: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      await this.socket.sendMessage(chatId, {
        react: {
          text: emoji,
          key: messageKey,
        },
      });
      return { success: true, message: `✅ React-ga (${emoji}) waa la diray!` };
    } catch (err: any) {
      return { success: false, message: `Cilad reaction-ka: ${err.message}` };
    }
  }

  /**
   * Pins a message in the chat.
   */
  public async pinMessage(
    chatId: string,
    messageKey: proto.IMessageKey,
    durationSeconds: number = 86400
  ): Promise<{ success: boolean; message: string }> {
    if (!this.socket) return { success: false, message: 'WhatsApp ma xirna hadda.' };

    try {
      const validTime: 86400 | 604800 | 2592000 = durationSeconds >= 604800 ? 604800 : 86400;
      await this.socket.sendMessage(chatId, {
        pin: messageKey,
        type: 1,
        time: validTime,
      } as any);
      return { success: true, message: '📌 Fariintii si guul leh ayaa loo pin-gareeyay!' };
    } catch (err: any) {
      return { success: false, message: `Cilad pin-garaynta: ${err.message}` };
    }
  }
}

export const whatsappManagerService = new WhatsAppManagerService();
