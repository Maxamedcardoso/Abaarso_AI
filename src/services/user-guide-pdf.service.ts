import { BotCategory } from '../tenants/plan-catalog.js';

export interface SubscriberGuidePdfInput {
  subscriberName: string;
  phone: string;
  category: BotCategory;
  portalUrl?: string;
  pairingCode?: string | null;
}

/**
 * Strips non-Latin1 characters (e.g. emojis) and normalizes Unicode punctuation
 * so built-in PDF Type1 /Helvetica and /Courier fonts render crisply in every PDF viewer.
 */
function toPdfSafeText(raw: string): string {
  return String(raw || '')
    .replace(/[—–]/g, '-')
    .replace(/[➔➜➝➞➡]/g, '->')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, '*')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfLiteral(str: string): string {
  return toPdfSafeText(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapLine(text: string, maxChars: number): string[] {
  const words = toPdfSafeText(text).split(' ').filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ` ${w}`;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

class CleanPdfDoc {
  private readonly pageWidth = 595.28;
  private readonly pageHeight = 841.89;
  private readonly margin = 36;
  private pages: string[] = [];
  private ops: string[] = [];
  private currentY = 841.89 - 36 - 44;

  public startNewPage(): void {
    if (this.ops.length > 0) {
      this.pages.push(this.ops.join('\n'));
      this.ops = [];
    }
    this.currentY = this.pageHeight - this.margin - 44;
  }

  public ensureSpace(needed: number): void {
    if (this.currentY - needed < this.margin + 32) {
      this.startNewPage();
    }
  }

  private setRgb(r: number, g: number, b: number, fill = true): void {
    this.ops.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} ${fill ? 'rg' : 'RG'}`);
  }

  public drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    fillColor: [number, number, number] | null,
    strokeColor: [number, number, number] | null = null,
    lineWidth = 1
  ): void {
    if (strokeColor) {
      this.setRgb(strokeColor[0], strokeColor[1], strokeColor[2], false);
      this.ops.push(`${lineWidth} w`);
    }
    if (fillColor) {
      this.setRgb(fillColor[0], fillColor[1], fillColor[2], true);
    }
    const op = fillColor && strokeColor ? 'B' : fillColor ? 'f' : 'S';
    this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
  }

  public drawText(
    text: string,
    x: number,
    y: number,
    options: { bold?: boolean; mono?: boolean; size?: number; color?: [number, number, number] } = {}
  ): void {
    const font = options.bold ? '/F2' : options.mono ? '/F3' : '/F1';
    const size = options.size ?? 9.5;
    const color = options.color ?? [15, 23, 42];
    this.setRgb(color[0], color[1], color[2], true);
    const escaped = escapePdfLiteral(text);
    this.ops.push(`BT ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escaped}) Tj ET`);
  }

  public addSectionHeader(title: string, subtitle?: string): void {
    this.ensureSpace(46);
    this.currentY -= 10;
    this.drawRect(this.margin, this.currentY - 14, 4, 16, [6, 182, 212]);
    this.drawText(title, this.margin + 10, this.currentY - 10, { bold: true, size: 11.5, color: [15, 23, 42] });
    this.currentY -= 18;
    if (subtitle) {
      this.drawText(subtitle, this.margin + 10, this.currentY - 3, { size: 8.5, color: [71, 85, 105] });
      this.currentY -= 12;
    }
  }

  public addInfoBox(title: string, bodyLines: string[], accent: [number, number, number] = [6, 182, 212]): void {
    const wrapped: string[] = [];
    for (const raw of bodyLines) {
      wrapped.push(...wrapLine(raw, 88));
    }
    const h = 24 + wrapped.length * 12;
    this.ensureSpace(h + 8);
    const w = this.pageWidth - this.margin * 2;
    const y = this.currentY - h;
    this.drawRect(this.margin, y, w, h, [248, 250, 252], [203, 213, 225], 0.8);
    this.drawRect(this.margin, y, 4, h, accent);
    this.drawText(title, this.margin + 12, this.currentY - 14, { bold: true, size: 9.5, color: [15, 23, 42] });
    let lineY = this.currentY - 28;
    for (const line of wrapped) {
      this.drawText(line, this.margin + 12, lineY, { size: 8.5, color: [30, 41, 59] });
      lineY -= 12;
    }
    this.currentY = y - 8;
  }

  public addCommandCard(cmd: string, who: string, desc: string, example: string): void {
    const descLines = wrapLine(desc, 86).slice(0, 2);
    const cardH = 38 + descLines.length * 11;
    this.ensureSpace(cardH + 6);
    const w = this.pageWidth - this.margin * 2;
    const cardY = this.currentY - cardH;

    this.drawRect(this.margin, cardY, w, cardH, [248, 250, 252], [226, 232, 240], 0.8);
    this.drawRect(this.margin + 8, cardY + cardH - 17, 170, 13, [15, 23, 42]);
    this.drawText(cmd, this.margin + 13, cardY + cardH - 13.5, { bold: true, mono: true, size: 8, color: [56, 189, 248] });

    const isAdmin = /ADMIN/i.test(who);
    const badgeColor: [number, number, number] = isAdmin ? [185, 28, 28] : [5, 150, 105];
    const badgeBg: [number, number, number] = isAdmin ? [254, 242, 242] : [236, 253, 245];
    this.drawRect(this.margin + w - 92, cardY + cardH - 17, 84, 13, badgeBg, badgeColor, 0.7);
    this.drawText(who, this.margin + w - 86, cardY + cardH - 13.5, { bold: true, size: 7, color: badgeColor });

    let dy = cardY + cardH - 29;
    for (const dl of descLines) {
      this.drawText(dl, this.margin + 10, dy, { size: 8.2, color: [30, 41, 59] });
      dy -= 11;
    }
    this.drawText(`Tusaale: ${example}`, this.margin + 10, cardY + 6, { mono: true, size: 7.5, color: [100, 116, 139] });

    this.currentY = cardY - 6;
  }

  public addCover(title: string, subtitle: string, metaLine: string): void {
    const w = this.pageWidth - this.margin * 2;
    const h = 82;
    const y = this.currentY - h;
    this.drawRect(this.margin, y, w, h, [15, 23, 42], [30, 41, 59], 1);
    this.drawRect(this.margin, y - 2, w, 2, [6, 182, 212]);
    this.drawText(title, this.margin + 14, this.currentY - 24, { bold: true, size: 14, color: [255, 255, 255] });
    this.drawText(subtitle, this.margin + 14, this.currentY - 43, { bold: true, size: 10.5, color: [56, 189, 248] });
    this.drawText(metaLine, this.margin + 14, this.currentY - 64, { size: 8, color: [203, 213, 225] });
    this.currentY = y - 14;
  }

  public getCursorY(): number {
    return this.currentY;
  }

  public setCursorY(nextY: number): void {
    this.currentY = nextY;
  }

  public getContentWidth(): number {
    return this.pageWidth - this.margin * 2;
  }

  public getMargin(): number {
    return this.margin;
  }

  private renderChrome(pageIndex: number, totalPages: number): string {
    const savedOps = this.ops;
    const savedY = this.currentY;
    this.ops = [];

    const w = this.pageWidth;
    const h = this.pageHeight;
    const m = this.margin;
    this.drawRect(m, h - m - 22, w - m * 2, 22, [15, 23, 42]);
    this.drawRect(m, h - m - 24, w - m * 2, 2, [6, 182, 212]);
    this.drawText('CARDOSO AI - HAGAHA RASMIGA AH EE ISTICMAALKA', m + 10, h - m - 15, {
      bold: true,
      size: 8.5,
      color: [255, 255, 255],
    });
    this.drawText(`Bogga ${pageIndex + 1} / ${totalPages}`, w - m - 55, h - m - 15, {
      bold: true,
      size: 8,
      color: [56, 189, 248],
    });

    this.drawRect(m, m + 14, w - m * 2, 0.8, null, [203, 213, 225]);
    this.drawText('CARDOSO AI Multi-Tenant WhatsApp SaaS | Kaydso Buuggan (PDF)', m, m + 4, {
      size: 7.5,
      color: [100, 116, 139],
    });

    const chromeStr = this.ops.join('\n');
    this.ops = savedOps;
    this.currentY = savedY;
    return chromeStr;
  }

  public buildBuffer(): Buffer {
    if (this.ops.length > 0) {
      this.pages.push(this.ops.join('\n'));
      this.ops = [];
    }

    const totalPages = this.pages.length;
    const objects: string[] = [];
    const addObj = (content: string): number => {
      objects.push(content);
      return objects.length;
    };

    addObj('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('');
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');

    const pageIds: number[] = [];
    for (let i = 0; i < totalPages; i++) {
      const chrome = this.renderChrome(i, totalPages);
      const stream = `${chrome}\n${this.pages[i]}`;
      const len = Buffer.byteLength(stream, 'latin1');
      const streamId = addObj(`<< /Length ${len} >>\nstream\n${stream}\nendstream`);
      const pageId = addObj(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Contents ${streamId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>`
      );
      pageIds.push(pageId);
    }

    objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${totalPages} >>`;

    const chunks: string[] = ['%PDF-1.4\n'];
    const offsets: number[] = [0];
    let byteCursor = Buffer.byteLength(chunks[0], 'latin1');

    for (let i = 0; i < objects.length; i++) {
      offsets.push(byteCursor);
      const entry = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
      chunks.push(entry);
      byteCursor += Buffer.byteLength(entry, 'latin1');
    }

    const xrefOffset = byteCursor;
    chunks.push(`xref\n0 ${objects.length + 1}\n`);
    chunks.push('0000000000 65535 f \n');
    for (let i = 1; i <= objects.length; i++) {
      chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    }
    chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.from(chunks.join(''), 'latin1');
  }
}

/**
 * Generates a personalized, zero-dependency Somali/English PDF User Guide
 * containing WhatsApp pairing steps, Dashboard login tips, and all Bot commands.
 */
export function generateSubscriberGuidePdfBuffer(input: SubscriberGuidePdfInput): Buffer {
  const doc = new CleanPdfDoc();
  const catLabel =
    input.category === 'business'
      ? 'Ganacsato & Dukaamo (Business Bot)'
      : input.category === 'education'
      ? 'Waxbarasho & Machadyo (Education Bot)'
      : 'Qof Caadi ah (Personal Assistant)';

  doc.addCover(
    'CARDOSO AI - BUUGGA AMARRADA & ISTICMAALKA',
    `Soo Dhawoow: ${input.subscriberName} | Nooca: ${catLabel}`,
    `Lambarka Akoonka: +${input.phone || '--'}  |  La Diyaariyay: ${new Date().toISOString().slice(0, 10)}`
  );

  doc.addSectionHeader(
    '1. SIDA WHATSAPP-KA LOOGU XIDHO (8-LAMBAR PAIRING CODE)',
    'Raac 4-tan tallaabo si aad bot-kaaga WhatsApp ugu shiddo daqiiqad gudaheed:'
  );

  doc.addInfoBox('Tallaabooyinka Ku Xidhista WhatsApp:', [
    '1) Fur WhatsApp-ka taleefankaaga -> Saddexda dhibcood (ama Settings) -> Linked Devices.',
    '2) Taabo "Link a Device" kadibna hoosta ka dooro "Link with phone number instead".',
    input.pairingCode
      ? `3) Geli koodhkan 8-da god ah: ${input.pairingCode} (Haddii koodhku dhaco, WhatsApp qor !pair ama ka soo saar Dashboard-ka).`
      : '3) Geli koodhka 8-da lambar ah ee laguugu soo diray fariinta (ama WhatsApp-ka ku qor !pair si aad mid cusub u hesho).',
    `4) Dashboard-kaaga Gaarka ah: ${input.portalUrl || 'Waxaad ka gali kartaa /portal adigoo isticmaalaya lambarkaaga & PIN-kaaga'}`,
  ], [16, 185, 129]);

  const roleNotes =
    input.category === 'business'
      ? [
          '* Gali alaabta, qiimaha & Zaad/eDahab gudaha Dashboard-ka (xitaa CSV/TXT/JSON ayaad Import ku soo gelin kartaa).',
          '* Delivery Labadaba: Bot-ku wuxuu yaqaan dhammaan magaalooyinka & xaafadaha Soomaalida.',
          '* Ka Hortagga Tuugada Rasiidhada: Bot-ku wuxuu hubiyaa SLSH vs USD, magaca/lambarka meheradda & Tix-ka (hal rasiid 2 jeer ma maro!).',
          '* Orders Inbox: Dalab kasta & rasiid kasta Dashboard-ka ayuu toos ugu kaydsamaa.',
        ]
      : input.category === 'education'
      ? [
          '* Gali koorsooyinka, jadwalka, shuruudaha & kharashka gudaha Dashboard-ka.',
          '* Ardayda & waalidiinta ayuu u sharaxaa barnaamijyada, isagoo diiwaangelinaya ardayga raba inuu isqoro.',
        ]
      : [
          '* Away Mode: Markaad mashquul tahay shid Away Mode, bot-ku asxaabta & ehelka ayuu si xushmad leh ugu jawaabayaa.',
          '* People Memory: Magaca & qofka uu yahay qofku wuu xasuusanayaa sheekadiisuna way xidhnaanaysaa.',
        ];

  doc.addInfoBox(`2. Waxqabadka Gaarka ah ee Qaybtaada (${catLabel}):`, roleNotes, [139, 92, 246]);

  // Page 2: Core Admin Commands
  doc.startNewPage();
  doc.addSectionHeader(
    '3. AMARRADA MAAMULKA (ADMIN COMMANDS - TALEEFANKAAGA)',
    'Amarradan adiga (iyo Staff Admins-kaaga) oo keliya ayaa ka isticmaali kara taleefankiina.'
  );

  doc.addCommandCard('!view on / !view off', '[ADMIN ONLY]', 'Hal amar oo wada jira: Daawashada Status-ka (Seen) + Emoji Reaction + Faallada AI.', '!view on   ama   !view off');
  doc.addCommandCard('!status <qoraal / media>', '[ADMIN ONLY]', 'Status cusub soo dhig WhatsApp (qoraal, ama sawir/video/cod wata caption !status).', '!status Maalin wanaagsan dhammaan!');
  doc.addCommandCard('!status-ai [mawduuc]', '[ADMIN ONLY]', 'Bot-ka ayaa qoraaya status cusub oo xikmad ama xayeysiis ah kadibna soo dhigaya.', '!status-ai ganacsi cusub');
  doc.addCommandCard('!statusviews', '[ADMIN ONLY]', 'Soo saar liiska dadka daawatay status-kaaga (magaca, lambarka, waqtiga).', '!statusviews');
  doc.addCommandCard('!deletestatus', '[ADMIN ONLY]', 'Tirtir status-kaagii ugu dambeeyay ee WhatsApp (Delete for everyone).', '!deletestatus');
  doc.addCommandCard('!reply <lambar> <fariin>', '[ADMIN ONLY]', 'U dir fariin toos ah qof kasta, ama qof fariintiisa quote ku qabo oo qor !reply <jawaab>.', '!reply 252634xxxxxx Dalabkaagii waa diyaar!');
  doc.addCommandCard('!cod <lambar> <fariin>', '[ADMIN ONLY]', 'Qoraalkaaga u rog Cod Soomaali dabiici ah (Voice Note) oo u dir lambarkaas.', '!cod 252634xxxxxx Asc walaal sidee tahay?');
  doc.addCommandCard('!autoreply add <erey> | <jawaab>', '[ADMIN ONLY]', 'Samee jawaab degdeg ah oo AI la aan u shaqaysa marka ereygaas la soo qoro.', '!autoreply add zaad | Zaad: 0634xxxxxx');
  doc.addCommandCard('!autoreply list / delete', '[ADMIN ONLY]', 'Eeg dhammaan auto-replies-ka kaydsan ama mid gaar ah tirtir.', '!autoreply list   /   !autoreply delete zaad');
  doc.addCommandCard('!fariin <qoraal> / !contacts', '[ADMIN ONLY]', 'U dir fariin shakhsiyeed (Broadcast) ilaa 50 qof oo contacts-kaaga ah, ama eeg tirada.', '!fariin Salaan {name}, alaab cusub baa timi!');
  doc.addCommandCard('!pair / !pdf', '[ADMIN / MILKIILAHA]', 'Soo saar 8-lambar pairing code cusub (!pair) ama dib u soo dejiso buuggan PDF-ka (!pdf).', '!pair   ama   !pdf');

  // Page 3: Group Management + Profile + General User Commands
  doc.startNewPage();
  doc.addSectionHeader(
    '4. AMARRADA KOOXAHA (GROUPS), PROFILE & DADWEYNAHA',
    'Xakamee Groups-kaaga oo dhan & adeegyada qof kasta isticmaali karo.'
  );

  doc.addCommandCard('!tagall [fariin]', '[ADMIN ONLY]', 'Dhammaan xubnaha kooxda (Group) hal mar @tag ku wada dhufo si fariintu wada gaadho.', '!tagall Shir degdeg ah caawa 8:00 PM');
  doc.addCommandCard('!add <lambar> / !kick @user', '[ADMIN ONLY]', 'Xubin cusub ku dar kooxda (+ fariin soo dhawayn ah) ama qof ka saar kooxda.', '!add 252634xxxxxx   /   !kick @user');
  doc.addCommandCard('!promote / !demote @user', '[ADMIN ONLY]', 'Qof ka dhig Group Admin ama ka qaad maamulnimada kooxda.', '!promote @user   /   !demote @user');
  doc.addCommandCard('!mute / !unmute', '[ADMIN ONLY]', 'Xidh kooxda (Admins oo kaliya ayaa qori kara) ama dib u fur dhammaan xubnaha.', '!mute   /   !unmute');
  doc.addCommandCard('!link / !groupinfo', '[ADMIN ONLY]', 'Soo qaad invite link-ga kooxda ama xogta xubnaha kooxda.', '!link   /   !groupinfo');
  doc.addCommandCard('!setname / !setbio / !setpp', '[ADMIN ONLY]', 'Beddel magaca WhatsApp-ka, Bio-ga, ama sawirka profile-ka (sawir + !setpp).', '!setbio Adeeg 24/7 ah');
  doc.addCommandCard('!block / !unblock <lambar>', '[ADMIN ONLY]', 'Block saar ama ka qaad lambar dhib badan.', '!block 252634xxxxxx');
  doc.addCommandCard('@cardoso <suaal>', '[QOF KASTA]', 'Groups-ka dhexdeeda kula hadal bot-ka adigoo @cardoso ku bilaabaya.', '@cardoso qiimaha waa imisa?');
  doc.addCommandCard('@cod / Voice Note', '[QOF KASTA]', 'Cod soo duub ama ku dar @cod fariintaada si bot-ku cod Soomaali ah ugu soo jawaabo.', '@cod i caawi fadlan');
  doc.addCommandCard('@sawir <faahfaahin>', '[QOF KASTA]', 'U sheeg bot-ka sawirka aad rabto, AI ayaa isla markiiba kuu sawiraya.', '@sawir dukaanka casriga ah ee Berbera');
  doc.addCommandCard('jooji / !tirtir', '[QOF KASTA]', 'Ka bax fariin-wadareedka (jooji) ama masax taariikhda sheekadaada (!tirtir).', 'jooji   ama   !tirtir');

  return doc.buildBuffer();
}

