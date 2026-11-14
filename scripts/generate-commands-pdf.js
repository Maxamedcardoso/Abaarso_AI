import fs from 'fs';
import path from 'path';

/**
 * CARDOSO AI — Professional Zero-Dependency PDF Generator
 * Creates a pixel-perfect, publication-grade PDF reference guide.
 */

class PDFBuilder {
  constructor() {
    this.pageWidth = 595.28;  // A4 standard width
    this.pageHeight = 841.89; // A4 standard height
    this.margin = 36;
    this.pages = [];
    this.currentPageOps = [];
    this.currentY = this.pageHeight - this.margin - 45;
  }

  startNewPage() {
    if (this.currentPageOps.length > 0) {
      this.pages.push(this.currentPageOps.join('\n'));
      this.currentPageOps = [];
    }
    this.currentY = this.pageHeight - this.margin - 45;
  }

  ensureSpace(neededPoints) {
    if (this.currentY - neededPoints < this.margin + 40) {
      this.startNewPage();
    }
  }

  // PDF Graphics Helpers
  setColorRGB(r, g, b, isFill = true) {
    const op = isFill ? 'rg' : 'RG';
    this.currentPageOps.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} ${op}`);
  }

  drawRect(x, y, w, h, fillColor = null, strokeColor = null, lineWidth = 1) {
    if (strokeColor) {
      this.setColorRGB(strokeColor[0], strokeColor[1], strokeColor[2], false);
      this.currentPageOps.push(`${lineWidth} w`);
    }
    if (fillColor) {
      this.setColorRGB(fillColor[0], fillColor[1], fillColor[2], true);
    }
    const op = fillColor && strokeColor ? 'B' : fillColor ? 'f' : 'S';
    this.currentPageOps.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
  }

  drawRoundedRect(x, y, w, h, r, fillColor = null, strokeColor = null) {
    // Approximate with rect for clean rendering
    this.drawRect(x, y, w, h, fillColor, strokeColor);
  }

  escapeText(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[\r\n]+/g, ' ');
  }

  drawText(text, x, y, options = {}) {
    const font = options.bold ? '/F2' : options.mono ? '/F3' : '/F1';
    const size = options.size || 10;
    const color = options.color || [15, 23, 42];

    this.setColorRGB(color[0], color[1], color[2], true);
    const escaped = this.escapeText(text);
    this.currentPageOps.push(`BT ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escaped}) Tj ET`);
  }

  // Draw header and footer on every page
  drawChrome(pageIndex, totalPages) {
    const w = this.pageWidth;
    const h = this.pageHeight;
    const m = this.margin;

    // Top Header Banner
    this.drawRect(m, h - m - 24, w - m * 2, 24, [15, 23, 42]);
    this.drawRect(m, h - m - 26, w - m * 2, 2, [6, 182, 212]); // Teal accent line

    this.drawText('CARDOSO AI — WHATSAPP BOT PLATFORM', m + 10, h - m - 16, {
      bold: true,
      size: 9,
      color: [255, 255, 255],
    });
    this.drawText('BUUG-TILMAAMEEDKA AMARRADA (OFFICIAL COMMAND GUIDE)', m + 230, h - m - 16, {
      bold: false,
      size: 8,
      color: [148, 163, 184],
    });

    // Bottom Footer
    this.drawRect(m, m + 16, w - m * 2, 1, null, [226, 232, 240]);
    this.drawText('CARDOSO AI v1.0.0 — Barasho, Dhiirigelin, iyo Horumar | Waxaa diyaariyay Maxamed Daahir', m, m + 4, {
      size: 8,
      color: [100, 116, 139],
    });
    this.drawText(`Bogga ${pageIndex + 1} ee ${totalPages}`, w - m - 60, m + 4, {
      bold: true,
      size: 8,
      color: [15, 23, 42],
    });
  }

  // UI Component: Section Title
  addSectionHeader(title, subtitle = null) {
    this.ensureSpace(60);
    this.currentY -= 15;

    // Left accent bar
    this.drawRect(this.margin, this.currentY - 14, 4, 18, [6, 182, 212]);

    this.drawText(title, this.margin + 12, this.currentY - 10, {
      bold: true,
      size: 13,
      color: [15, 23, 42],
    });

    this.currentY -= 20;

    if (subtitle) {
      this.drawText(subtitle, this.margin + 12, this.currentY - 4, {
        size: 9,
        color: [100, 116, 139],
      });
      this.currentY -= 14;
    }
  }

  // UI Component: Command Card
  addCommandCard(cmd, who, desc, example, note = null) {
    this.ensureSpace(56 + (note ? 14 : 0));

    const w = this.pageWidth - this.margin * 2;
    const cardH = 48 + (note ? 14 : 0);
    const cardY = this.currentY - cardH;

    // Card container
    this.drawRect(this.margin, cardY, w, cardH, [248, 250, 252], [226, 232, 240], 1);

    // Command Pill / Code block
    this.drawRect(this.margin + 8, cardY + cardH - 18, 140, 14, [15, 23, 42]);
    this.drawText(cmd, this.margin + 14, cardY + cardH - 14, {
      bold: true,
      mono: true,
      size: 8.5,
      color: [56, 189, 248],
    });

    // Badge: Admin vs General User
    const isAdmin = who.includes('Admin');
    const badgeColor = isAdmin ? [239, 68, 68] : [16, 185, 129];
    const badgeBg = isAdmin ? [254, 242, 242] : [236, 253, 245];
    const badgeW = isAdmin ? 80 : 70;

    this.drawRect(this.margin + w - badgeW - 8, cardY + cardH - 18, badgeW, 14, badgeBg, badgeColor, 1);
    this.drawText(who, this.margin + w - badgeW - 2, cardY + cardH - 14, {
      bold: true,
      size: 7.5,
      color: badgeColor,
    });

    // Description
    this.drawText(desc, this.margin + 12, cardY + cardH - 32, {
      bold: false,
      size: 8.5,
      color: [30, 41, 59],
    });

    // Example
    this.drawText(`Tusaale: ${example}`, this.margin + 12, cardY + cardH - 44, {
      size: 8,
      mono: true,
      color: [100, 116, 139],
    });

    if (note) {
      this.drawText(`Xog: ${note}`, this.margin + 12, cardY + cardH - 56, {
        size: 7.5,
        color: [180, 83, 9],
      });
    }

    this.currentY = cardY - 8;
  }

  // Compile final PDF binary buffer
  buildPDFBuffer() {
    if (this.currentPageOps.length > 0) {
      this.pages.push(this.currentPageOps.join('\n'));
      this.currentPageOps = [];
    }

    const totalPages = this.pages.length;
    const objects = [];

    function addObj(content) {
      objects.push(content);
      return objects.length;
    }

    // 1: Catalog
    addObj('<< /Type /Catalog /Pages 2 0 R >>');

    // 2: Pages (Kids array filled later)
    const pagesObjIndex = 1; // 2 0 obj
    objects.push(''); // placeholder for Pages

    // 3: Font Helvetica
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    // 4: Font Helvetica-Bold
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    // 5: Font Courier (monospace)
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');

    const pageObjIds = [];

    for (let i = 0; i < totalPages; i++) {
      // Prepend Chrome (header & footer)
      const savedY = this.currentY;
      this.currentPageOps = [];
      this.drawChrome(i, totalPages);
      const chromeStream = this.currentPageOps.join('\n');
      this.currentY = savedY;

      const fullPageStream = chromeStream + '\n' + this.pages[i];
      const streamBuf = Buffer.from(fullPageStream, 'binary');

      const streamObjId = addObj(`<< /Length ${streamBuf.length} >>\nstream\n${fullPageStream}\nendstream`);

      const pageObjId = addObj(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Contents ${streamObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>`
      );
      pageObjIds.push(pageObjId);
    }

    // Replace Pages object with actual kids
    objects[pagesObjIndex] = `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${totalPages} >>`;

    // Serialize PDF
    let pdf = '%PDF-1.4\n';
    const offsets = [0];

    for (let i = 0; i < objects.length; i++) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';

    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, 'binary');
  }
}

// ─── DOCUMENT COMPILATION ───────────────────────────────────────────────────

export function generateCommandsPDF() {
  const doc = new PDFBuilder();

  // ════════════════════════════════════════════════════════════════════════════
  // BOGGA 1: COVER & NIDAAMKA AMNIGA (SECURITY ARCHITECTURE)
  // ════════════════════════════════════════════════════════════════════════════

  // Large Hero Banner
  doc.currentY -= 10;
  const m = doc.margin;
  const w = doc.pageWidth - m * 2;

  doc.drawRect(m, doc.currentY - 95, w, 95, [10, 25, 47], [30, 41, 59], 1);
  doc.drawRect(m, doc.currentY - 97, w, 2, [6, 182, 212]); // Accent line

  doc.drawText('CARDOSO AI — WHATSAPP BOT PLATFORM', m + 16, doc.currentY - 24, {
    bold: true,
    size: 15,
    color: [255, 255, 255],
  });

  doc.drawText('BUUG-TILMAAMEEDKA RASMIGA AH EE AMARRADA', m + 16, doc.currentY - 44, {
    bold: true,
    size: 13,
    color: [56, 189, 248],
  });

  doc.drawText('Hagaha Dhammaystiran ee Kala Saaridda Amarrada Admin-ka & Kuwa Dadweynaha Guud', m + 16, doc.currentY - 62, {
    size: 9.5,
    color: [203, 213, 225],
  });

  doc.drawText('Taariikhda: November 2026 | Nooca: v1.0.0 Pro | Mulkiilaha: Maxamed Daahir | Xeerka: 100% Amni Xidhan', m + 16, doc.currentY - 82, {
    size: 8,
    color: [148, 163, 184],
  });

  doc.currentY -= 115;

  // Security Architecture Card
  doc.addSectionHeader(
    '1. Nidaamka Amniga & Kala Saaridda Awoodaha (Security & Permissions)',
    'Sidee ayuu bot-ku u kala saaraa cida amarka bixin karta iyo cida loo diidayo?'
  );

  doc.drawRect(m, doc.currentY - 110, w, 110, [241, 245, 249], [203, 213, 225], 1);

  doc.drawText('AWOODDA MAAMULKA (ADMIN ONLY):', m + 12, doc.currentY - 16, {
    bold: true,
    size: 9,
    color: [220, 38, 38],
  });
  doc.drawText('1. Taleefanka WhatsApp-ka ku xidhan (Host / Owner): Marka aad taleefankaaga bot-ka ku xidhan wax ka qorto', m + 12, doc.currentY - 30, { size: 8.5 });
  doc.drawText('   ama amarka ka bixiso (isFromMe=true), bot-ku 100% wuxuu u aqoonsanayaa Mulkiilaha rasmiga ah.', m + 12, doc.currentY - 42, { size: 8.5 });
  doc.drawText('2. Lambarada ku jira ADMIN_PHONE_NUMBERS: Lambarkaaga gaarka ah (sida 252634949642 ee ku qoran .env)', m + 12, doc.currentY - 56, { size: 8.5 });
  doc.drawText('   xataa haddii aad WhatsApp kale ama taleefan kale ka soo qorto, wuxuu leeyahay awood buuxda.', m + 12, doc.currentY - 68, { size: 8.5 });

  doc.drawText('AMNIGA DADKA CAADIGA AH (NON-ADMIN BLOCK):', m + 12, doc.currentY - 84, {
    bold: true,
    size: 9,
    color: [15, 23, 42],
  });
  doc.drawText('Qof kasta oo kale oo qora amarrada maamulka (sida !status, !kick, !mute, !tagall, !block, !delete), bot-ku', m + 12, doc.currentY - 96, { size: 8.5, color: [71, 85, 105] });
  doc.drawText('isla markiiba wuu xannibayaa mana fulinayo, isagoo ku celinaya digniin ah in amarkan uu Admin-ka u xidhan yahay.', m + 12, doc.currentY - 108, { size: 8.5, color: [71, 85, 105] });

  doc.currentY -= 125;

  // Overview Table Box
  doc.addSectionHeader(
    '2. Dulmar Guud: Qaybaha Amarrada Bot-ka',
    'Amarrada bot-ka waxay u kala baxaan laba qaybood oo aad u kala fog:'
  );

  doc.drawRect(m, doc.currentY - 65, w / 2 - 6, 65, [254, 242, 242], [252, 165, 165], 1);
  doc.drawText('🔴 AMARRADA ADMIN-KA (OWNER ONLY)', m + 10, doc.currentY - 16, { bold: true, size: 9, color: [185, 28, 28] });
  doc.drawText('• WhatsApp Status (Stories) & Auto-View', m + 10, doc.currentY - 30, { size: 8, color: [51, 65, 85] });
  doc.drawText('• Maamulka Groups-ka (Kick, Mute, Tagall)', m + 10, doc.currentY - 42, { size: 8, color: [51, 65, 85] });
  doc.drawText('• Direct Reply & Cod toos ah', m + 10, doc.currentY - 54, { size: 8, color: [51, 65, 85] });

  doc.drawRect(m + w / 2 + 6, doc.currentY - 65, w / 2 - 6, 65, [236, 253, 245], [110, 231, 183], 1);
  doc.drawText('🟢 AMARRADA DADWEYNAHA (EVERYONE)', m + w / 2 + 16, doc.currentY - 16, { bold: true, size: 9, color: [4, 120, 87] });
  doc.drawText('• Barashada & Caawinta Casharrada AI', m + w / 2 + 16, doc.currentY - 30, { size: 8, color: [51, 65, 85] });
  doc.drawText('• Codadka Voice Notes & Sawirrada', m + w / 2 + 16, doc.currentY - 42, { size: 8, color: [51, 65, 85] });
  doc.drawText('• Diidmada Fariimaha (jooji) & Tirtiridda (tirtir)', m + w / 2 + 16, doc.currentY - 54, { size: 8, color: [51, 65, 85] });

  doc.currentY -= 80;

  // ════════════════════════════════════════════════════════════════════════════
  // BOGGA 2: AMARRADA ADMIN-KA (WHATSAPP STATUS & REPLY)
  // ════════════════════════════════════════════════════════════════════════════
  doc.startNewPage();

  doc.addSectionHeader(
    'QAYBTA 1: AMARRADA ADMIN-KA & MULKIILAHA (ADMIN ONLY)',
    'Amarradan waxaa isticmaali kara oo kaliya taleefanka bot-ku ku xidhan yahay ama lambarada Admin-ka.'
  );

  doc.drawText('📱 1.1 WHATSAPP STATUS (STORIES) MANAGEMENT:', doc.margin, doc.currentY - 4, {
    bold: true,
    size: 10.5,
    color: [15, 23, 42],
  });
  doc.currentY -= 16;

  doc.addCommandCard(
    '!status <fariin>',
    '[ADMIN KALIYA]',
    'Waxay toos WhatsApp Status ugu soo dhigaysaa qoraal midabbo qurxoon leh oo ay dadka oo dhami arkaan.',
    '!status Barasho wacan dhammaan ardayda Soomaaliyeed! 🚀',
    'Midabka waxaa loo xushaa si automatic ah ama waxaad raacin kartaa hex code sida #0f5132.'
  );

  doc.addCommandCard(
    '!status (Sawir / Cod / Video)',
    '[ADMIN KALIYA]',
    'Soo dir sawir, cod (Voice status), ama muuqaal adigoo qoraal ahaan ku soo raacinaya !status.',
    'Soo dir sawirkaaga adoo caption ku qoraya "!status Maalin wacan"',
    'Codadka waxaa toos loogu soo dhigaa WhatsApp Audio Status oo leh background color.'
  );

  doc.addCommandCard(
    '!status-ai [mawduuc]',
    '[ADMIN KALIYA]',
    'AI-da ayaa si dabiici ah u curinaysa fariin dhiirigelin, guul ama xikmad ah oo toos u soo dhigaysa Status.',
    '!status-ai dhiirigelin   ama   !status-ai waxbarasho',
    'Waxay soo saaraysaa 1-2 weedhood oo aad u qoto dheer oo ay ku jiraan emojis qurux badan.'
  );

  doc.addCommandCard(
    '!autoview on / off',
    '[ADMIN KALIYA]',
    'Shid ama dami in bot-ku si toos ah u daawado dhammaan status-yada cusub ee ay dadku soo dhigaan (Auto Seen).',
    '!autoview on   ama   !autoview off',
    'Marka ay furan tahay, bot-ku wuxuu qofka u muujinayaa inuu status-kiisa arkay (Seen 24/7).'
  );

  doc.addCommandCard(
    '!statusreact on / off',
    '[ADMIN KALIYA]',
    'Shid ama dami falcelinta tooska ah ee emoji-ga (❤️, 😂, 👏, 🔥, 🤲) marka bot-ku daawado status-ka qofka.',
    '!statusreact on   ama   !statusreact off',
    'Bot-ku wuxuu fahmayaa dareenka status-ka (hambalyo, aroos, qosol, ganacsi, jimce) wuxuuna ku dhufanayaa emoji ku habboon.'
  );

  doc.addCommandCard(
    '!statuscomment on / off',
    '[ADMIN KALIYA]',
    'Shid ama dami faallada tooska ah ee AI (Human Status Comment) oo qofka loogu reply-gareynayo status-kiisa.',
    '!statuscomment on   ama   !statuscomment off',
    'Bot-ku wuxuu qofka u dirayaa faallo kooban oo Soomaali diirran ah isagoo quote ku samaynaya status-kiisa.'
  );

  doc.currentY -= 10;
  doc.drawText('💬 1.2 U JAWAABIDDA QOFKA & FARIIMAHA TOOSKA AH (REPLY & DIRECT MESSAGING):', doc.margin, doc.currentY - 4, {
    bold: true,
    size: 10.5,
    color: [15, 23, 42],
  });
  doc.currentY -= 16;

  doc.addCommandCard(
    '!reply <lambar> <fariin>',
    '[ADMIN KALIYA]',
    'Qof kasta oo WhatsApp haysta fariin toos ah ugu dir adoo magaca bot-ka u adeegsanaya (waxaa la socon kara sawir/cod).',
    '!reply 252615000000 Salaan walaal, dalabkaagii waa diyaar!',
    'Haddii aad sawir soo raaciso, sawirka iyo qoraalkaba wuxuu u dirayaa lambarkaas.'
  );

  doc.addCommandCard(
    '!reply <fariin> (Quote)',
    '[ADMIN KALIYA]',
    'Qof fariintiisa quote ku qabo (swipe reply), bot-kuna toos buu qofkaas fariinta ugu celinayaa.',
    '(Quote fariinta qofka) !reply Waan helnay fariintaada, mahadsanid.',
    'Waxay si toos ah u beegsanaysaa qofka fariintiisa la quote-gareeyay.'
  );

  doc.addCommandCard(
    '!cod <lambar> <fariin>',
    '[ADMIN KALIYA]',
    'Bot-ka ayaa qoraalkaaga u rogaya Cod Soomaali dabiici ah (Voice Note) oo toos ugu diraya lambarkaas.',
    '!cod 252615000000 Asc walaal, sidee tahay maanta? Shaqadu sidee tahay?',
    'Qofku wuxuu helayaa Voice Note la maqli karo oo leh waveform dhab ah.'
  );

  doc.addCommandCard(
    '!autoreply add <key> | <ans>',
    '[ADMIN KALIYA]',
    'Sameyso ereyo gaar ah oo bot-ku isla markiiba ugu jawaabo macaamiisha adoon AI isticmaalin (0ms latency).',
    '!autoreply add goobta | Xafiiskeenu wuxuu ku yaallaa Suuqa Hoose.',
    'Eeg dhammaan kuwa kaydsan adoo qoraya: !autoreply list ama tirtir adoo qoraya: !autoreply delete goobta'
  );

  // ════════════════════════════════════════════════════════════════════════════
  // BOGGA 3: AMARRADA ADMIN-KA (GROUPS & PROFILE MANAGEMENT)
  // ════════════════════════════════════════════════════════════════════════════
  doc.startNewPage();

  doc.drawText('👥 1.3 MAAMULKA KOOXAHA (GROUP MANAGEMENT 100% CONTROL):', doc.margin, doc.currentY - 4, {
    bold: true,
    size: 10.5,
    color: [15, 23, 42],
  });
  doc.currentY -= 16;

  doc.addCommandCard(
    '!tagall [fariin] / !dhammaan',
    '[ADMIN KALIYA]',
    'Dhammaan xubnaha kooxda hal mar tag ku wada dhufo si qof kasta fariinta ogeysiiska ah u gaarto.',
    '!tagall Shir degdeg ah ayaa bilaabmaya 8:00 Habeenimo!',
    'Bot-ku wuxuu soo saarayaa liiska xubnaha oo dhan isagoo mid kasta @tag ku dhufanaya.'
  );

  doc.addCommandCard(
    '!kick @user / !kick <lambar>',
    '[ADMIN KALIYA]',
    'Xubin ka saar kooxda WhatsApp-ka. Wuxuu u qorayaa: 👋 Macasalaama [Magaca/Number]!',
    '!kick @252615123456   ama   !kick 252615123456   ama   quote fariintooda',
    'Bot-ku wuxuu si xushmad leh u sagootinayaa qofka isagoo magaciisa ama lambarkiisa ugu yeedhaya.'
  );

  doc.addCommandCard(
    '!add <lambar> / !add @user',
    '[ADMIN KALIYA]',
    'Xubin cusub ku dar kooxda adigoo isticmaalaya lambarkiisa taleefanka ama @mention, wuxuuna u dirayaa fariinta rasmiga ah ee soo dhawaynta.',
    '!add 252615123456   ama   !add @252615123456',
    'Fariinta soo dhawaynta: "Soo dhawoow walaal [Magaca]! Ku soo dhawow group..."'
  );

  doc.addCommandCard(
    '!promote @user / !dalacsii',
    '[ADMIN KALIYA]',
    'Xubin caadi ah ka dhig Admin kooxda dhexdeeda.',
    '!promote @252615123456',
    'Qofka wuxuu markiiba noqonayaa Group Admin.'
  );

  doc.addCommandCard(
    '!demote @user / !hoos-u-dhig',
    '[ADMIN KALIYA]',
    'Maamulnimada ka qaad Admin kooxda ku jira oo xubin caadi ah ka dhig.',
    '!demote @252615123456',
    'Awooddii maamulnimo ayaa laga qaadayaa.'
  );

  doc.addCommandCard(
    '!mute / !xidh   &   !unmute / !fur',
    '[ADMIN KALIYA]',
    '!mute waxay kooxda ka dhigaysaa mid Admins oo kaliya hadli karaan; !unmute waxay u furaysaa dhammaan xubnaha.',
    '!mute   (Kooxda waa la xidhay)   /   !unmute   (Kooxda waa la furay)',
    'Aad bay u faa\'iido badan tahay marka casharro ama ogeysiisyo socdaan.'
  );

  doc.addCommandCard(
    '!grouplink / !link',
    '[ADMIN KALIYA]',
    'Soo qaad link-ga tooska ah ee kooxda lagu soo galo (WhatsApp Invite Link).',
    '!grouplink   ama   !link',
    'Wuxuu soo saarayaa link-ga sida: https://chat.whatsapp.com/...'
  );

  doc.currentY -= 10;
  doc.drawText('⚙️ 1.4 PROFILE-KA BOT-KA, FARIIMAHA & BROADCAST:', doc.margin, doc.currentY - 4, {
    bold: true,
    size: 10.5,
    color: [15, 23, 42],
  });
  doc.currentY -= 16;

  doc.addCommandCard(
    '!setname <magac> / !setbio <bio>',
    '[ADMIN KALIYA]',
    'Beddel magaca rasmiga ah ee bot-ka WhatsApp-ka ama qoraalka About/Bio-ga.',
    '!setname CARDOSO AI PRO   /   !setbio Barasho, Dhiirigelin, iyo Horumar',
    'Magaca iyo Bio-ga WhatsApp profile-ka ayaa isla markiiba is beddelaya.'
  );

  doc.addCommandCard(
    '!setpp (Sawir la socdo)',
    '[ADMIN KALIYA]',
    'Beddel sawirka Profile Picture-ka ee bot-ka adigoo sawir cusub soo diraya.',
    'Sawirkaaga soo dir adoo qoraal ku soo raacinaya: !setpp',
    'Profile-ka bot-ka ayaa isla markiiba sawirkaas qaadanaya.'
  );

  doc.addCommandCard(
    '!delete / !tirtir   &   !react <emoji>',
    '[ADMIN KALIYA]',
    '!delete waxay fariinta u tirtiraysaa dhammaan dadka (Delete for Everyone); !react waxay ku dhufanaysaa emoji.',
    '(Quote fariinta) !delete   ama   (Quote fariinta) !react ❤️',
    'Kaliya quote ku qabo fariinta aad rabto inaad tirtirto ama emoji ku dhufato.'
  );

  doc.addCommandCard(
    '!fariin <qoraal>   &   !contacts',
    '[ADMIN KALIYA]',
    '!fariin waxay 50 qof oo cusub u diraysaa fariin shakhsiyeed; !contacts waxay soo bandhigaysaa xogta dadka kaydsan.',
    '!fariin Salaan dhammaan, waxaan haynaa ogeysiis cusub.   /   !contacts',
    'Smart Broadcast wuxuu fariinta ugu yeerayaa magaca qof kasta (Personalized).'
  );

  // ════════════════════════════════════════════════════════════════════════════
  // BOGGA 4: AMARRADA DADWEYNAHA GUUD & ARDAYDA (PUBLIC & STUDENT COMMANDS)
  // ════════════════════════════════════════════════════════════════════════════
  doc.startNewPage();

  doc.addSectionHeader(
    'QAYBTA 2: AMARRADA DADWEYNAHA GUUD & ARDAYDA (PUBLIC COMMANDS)',
    'Amarradan iyo adeegyadan waxaa si xor ah u isticmaali kara qof kasta, macmiil kasta, ama arday kasta.'
  );

  doc.drawText('🎓 2.1 WADA-HADALKA AI-DA & CAAWINTA CASHARRADA (STUDENT ADVISING):', doc.margin, doc.currentY - 4, {
    bold: true,
    size: 10.5,
    color: [15, 23, 42],
  });
  doc.currentY -= 16;

  doc.addCommandCard(
    'Qor Su\'aashaada (Chat toos ah)',
    '[QOF KASTA]',
    'Chat-ka gaarka ah (1-on-1): Qofku wuxuu qori karaa su\'aal kasta oo cashar, xisaab, programming, ama nolosha ah.',
    'Asc walaal, sideen Python ugu qoraa For Loop? I sharax.',
    'Bot-ku wuxuu ku jawaabayaa Af-Soomaali dabiici ah oo asluub leh, sharaxaad dhammaystiran leh.'
  );

  doc.addCommandCard(
    '@cardoso <su\'aal> (Kooxaha dhexdeeda)',
    '[QOF KASTA]',
    'Kooxaha (Groups-ka) dhexdeeda, qofku marka uu rabo inuu bot-ka la hadlo wuxuu ku xusayaa @cardoso ama !cardoso.',
    '@cardoso waa maxay farqiga u dhexeeya Variable iyo Function?',
    'Xeerka Muhiimka ah: Marka @cardoso la qoro, bot-ku MARNARBA cod kuma jawaabayo, wuxuu ku jawaabayaa qoraal.'
  );

  doc.currentY -= 10;
  doc.drawText('🎙️ 2.2 CODADKA (VOICE NOTES) & SAWIRRADA (IMAGES):', doc.margin, doc.currentY - 4, {
    bold: true,
    size: 10.5,
    color: [15, 23, 42],
  });
  doc.currentY -= 16;

  doc.addCommandCard(
    'Soo Duub Cod (Voice Note)',
    '[QOF KASTA]',
    'Qofku cod kasta hadduu soo duubo, bot-ku si toos ah ayuu u dhagaysanayaa, wuxuuna ugu jawaabayaa Cod ama Qoraal.',
    'Qofku wuxuu soo duubayaa: "Walaal waxaan rabaa inaad xisaabtan iga caawiso..."',
    'Xataa haddii codka la soo diro isagoo View-Once (1️⃣) ah, bot-ku wuu furayaa oo dhagaysanayaa.'
  );

  doc.addCommandCard(
    '@cod / !cod (Cod Dalbo)',
    '[QOF KASTA]',
    'Marka qofku rabo in bot-ku uu cod Soomaali ah ugu soo jawaabo, wuxuu su\'aashiisa ku darayaa @cod ama !cod.',
    '@cod iiga warran muhiimadda waxbarashada jaamacadda',
    'Bot-ku isla markiiba wuxuu soo duubayaa Voice Note Soomaali ah oo cod dabiici ah ku hadlaya.'
  );

  doc.addCommandCard(
    '@sawir / !sawir (Sawir Samee)',
    '[QOF KASTA]',
    'Bot-ka ayaa qoraalkaaga u rogaya sawir farshaxan ah oo qurux badan oo AI ku samaysay.',
    '@sawir arday Soomaaliyeed oo buug akhrisanaya galabtii',
    'Bot-ku wuxuu soo celinayaa sawir tayo sare leh oo ku salaysan sharaxaaddaada.'
  );

  doc.currentY -= 10;
  doc.drawText('🔒 2.3 AMNIGA SHAKHSIGA AH, DIIDMADA & XAYEYSIISKA:', doc.margin, doc.currentY - 4, {
    bold: true,
    size: 10.5,
    color: [15, 23, 42],
  });
  doc.currentY -= 16;

  doc.addCommandCard(
    'jooji / stop / unsubscribe',
    '[QOF KASTA]',
    'Haddii macmiilku uusan rabin in fariimo broadcast ah loo soo diro, wuxuu qorayaa "jooji", dib dambena looma dhibayo.',
    'jooji   ama   ha ii soo dirin fariimaha',
    'Bot-ku wuxuu xaqiijinayaa in fariin dambe aan loo diri doonin, liiska fariimahana waa laga saarayaa.'
  );

  doc.addCommandCard(
    '!tirtir / !clear (Right-to-be-Forgotten)',
    '[QOF KASTA]',
    'Qofku wuxuu xaq u leeyahay inuu tirtiro dhammaan wixii wada-sheekaysi ama xog ah ee bot-ku ka hayay.',
    '!tirtir   ama   !clear',
    'Database-ka SQLite ayaa isla markiiba laga masaxayaa dhammaan xogta iyo taariikhda qofkaas.'
  );

  doc.addCommandCard(
    '!abaarso / @abaarso',
    '[QOF KASTA]',
    'Waxay toos u soo bandhigaysaa xayeysiiska rasmiga ah ee codka iyo qoraalka ah ee Jaamacadda Abaarso.',
    '!abaarso   ama   @abaarso',
    'Waxaa la soo dirayaa cod rasmi ah oo sharaxaya kulliyadaha, deeqaha waxbarasho, iyo diiwaangelinta.'
  );

  // ════════════════════════════════════════════════════════════════════════════
  // BOGGA 5: SHAXDA GUUD EE ISBARBARDHIGGA (MASTER COMMAND REFERENCE TABLE)
  // ════════════════════════════════════════════════════════════════════════════
  doc.startNewPage();

  doc.addSectionHeader(
    'SHAXDA GUUD EE DHAMMAAN AMARRADA (MASTER REFERENCE TABLE)',
    'Shax kooban oo muujinaysa amar kasta, cida isticmaalaysa, iyo shaqada uu qabanayo.'
  );

  // Table Header
  const colX = [m, m + 110, m + 210, m + 380];
  const colW = [110, 100, 170, w - 380];
  const rowH = 16;

  doc.drawRect(m, doc.currentY - rowH, w, rowH, [15, 23, 42]);
  doc.drawText('AMARKA (COMMAND)', colX[0] + 6, doc.currentY - 11, { bold: true, size: 8, color: [255, 255, 255] });
  doc.drawText('CIDA LEH (AUTH)', colX[1] + 6, doc.currentY - 11, { bold: true, size: 8, color: [255, 255, 255] });
  doc.drawText('SHAQADA UU QABANAYO', colX[2] + 6, doc.currentY - 11, { bold: true, size: 8, color: [255, 255, 255] });
  doc.drawText('TUSAALE', colX[3] + 6, doc.currentY - 11, { bold: true, size: 8, color: [255, 255, 255] });

  doc.currentY -= rowH;

  const tableData = [
    ['!status <fariin>', 'Admin Only', 'WhatsApp Status qoraal ah soo dhig', '!status Maalin wacan'],
    ['!status (Media)', 'Admin Only', 'Sawir/Cod/Video Status ka dhig', 'Sawir + caption !status'],
    ['!status-ai', 'Admin Only', 'AI Status dhiirigelin ah curi', '!status-ai waxbarasho'],
    ['!autoview on/off', 'Admin Only', 'Daawashada tooska ah ee status-ka', '!autoview on'],
    ['!statusreact on/off', 'Admin Only', 'Falcelinta emoji-ga ee status-ka', '!statusreact on'],
    ['!statuscomment on/off', 'Admin Only', 'Faallada tooska ah ee status-ka', '!statuscomment on'],
    ['!reply <num> <msg>', 'Admin Only', 'Fariin toos ah u dir qof kasta', '!reply 252615... Asc'],
    ['!reply (Quote)', 'Admin Only', 'Fariin qof quote ugu celi toos', '!reply Waan helnay'],
    ['!cod <num> <msg>', 'Admin Only', 'Cod Soomaali ah u dir qofka', '!cod 252615... Asc'],
    ['!autoreply add', 'Admin Only', 'Sameyso jawaab toos ah oo degdeg ah', '!autoreply add goobta | ...'],
    ['!tagall / !dhammaan', 'Admin Only', 'Kooxda oo dhan hal mar tag garee', '!tagall Shir degdeg ah'],
    ['!kick / !ka-saar', 'Admin Only', 'Xubin ka saar kooxda', '!kick @25261...'],
    ['!add / !soo-geli', 'Admin Only', 'Xubin ku dar kooxda', '!add 25261...'],
    ['!promote / !demote', 'Admin Only', 'Admin ka dhig ama ka qaad xubin', '!promote @user'],
    ['!mute / !unmute', 'Admin Only', 'Kooxda xidh ama fur dhammaan', '!mute / !unmute'],
    ['!link / !grouplink', 'Admin Only', 'Soo saar WhatsApp invite link', '!link'],
    ['!setname / !setbio', 'Admin Only', 'Beddel magaca ama bio-ga bot-ka', '!setname CARDOSO'],
    ['!setpp (Image)', 'Admin Only', 'Beddel sawirka profile picture-ka', 'Sawir + !setpp'],
    ['!block / !unblock', 'Admin Only', 'Block garee ama unblock ka qaad', '!block 25261...'],
    ['!delete (Quote)', 'Admin Only', 'Delete for everyone ku tirtir fariin', '!delete (fariin quote)'],
    ['!react <emoji>', 'Admin Only', 'Emoji ku dhufo fariinta quote-ka', '!react ❤️'],
    ['!fariin / !contacts', 'Admin Only', '50 qof fariin wadareed u dir', '!fariin Salaan dhammaan'],
    ['Chat Caadi ah', 'Qof Kasta', 'Su\'aalo weydii bot-ka 1-on-1', 'Python loop ii sharax'],
    ['@cardoso <su\'aal>', 'Qof Kasta', 'Kooxaha dhexdeeda bot-ka kula hadal', '@cardoso xisaabtan xalli'],
    ['Cod Soo Duub', 'Qof Kasta', 'Cod u soo dir, bot-kuna cod buu kuugu celin', 'Soo duub voice note'],
    ['@cod / !cod', 'Qof Kasta', 'Cod dabiici ah kaga dalbo bot-ka', '@cod i dhiiri-geli'],
    ['@sawir / !sawir', 'Qof Kasta', 'Sawir AI ah ka codso bot-ka', '@sawir arday dugsi jooga'],
    ['jooji / stop', 'Qof Kasta', 'Ka bax fariin-wadareedka (Opt-out)', 'jooji'],
    ['!tirtir / !clear', 'Qof Kasta', 'Xogtaada oo dhan tirtir (Privacy)', '!tirtir'],
    ['!abaarso', 'Qof Kasta', 'Xayeysiiska rasmiga ah ee jaamacadda', '!abaarso'],
  ];

  for (let idx = 0; idx < tableData.length; idx++) {
    const row = tableData[idx];
    const isEven = idx % 2 === 0;
    const bg = isEven ? [255, 255, 255] : [248, 250, 252];
    const rH = 14;

    doc.drawRect(m, doc.currentY - rH, w, rH, bg, [226, 232, 240], 0.5);

    const isAdmin = row[1] === 'Admin Only';
    const tagColor = isAdmin ? [220, 38, 38] : [16, 185, 129];

    doc.drawText(row[0], colX[0] + 4, doc.currentY - 10, { bold: true, mono: true, size: 7, color: [15, 23, 42] });
    doc.drawText(row[1], colX[1] + 4, doc.currentY - 10, { bold: true, size: 7, color: tagColor });
    doc.drawText(row[2], colX[2] + 4, doc.currentY - 10, { size: 7, color: [51, 65, 85] });
    doc.drawText(row[3], colX[3] + 4, doc.currentY - 10, { mono: true, size: 6.8, color: [100, 116, 139] });

    doc.currentY -= rH;
  }

  // Bottom Notice
  doc.currentY -= 15;
  doc.drawRect(m, doc.currentY - 26, w, 26, [240, 253, 250], [94, 234, 212], 1);
  doc.drawText('🔄 SIDA LOO CUSBOONAYSIIN KARO PDF-KAN MAR KASTA OO AMAR CUSUB LA SOO DARO:', m + 10, doc.currentY - 10, {
    bold: true,
    size: 7.5,
    color: [13, 148, 136],
  });
  doc.drawText('Kaliya terminal-ka ka dhex qor: "npm run generate-pdf" ama "node scripts/generate-commands-pdf.js". Isla markiiba PDF-ka dib buu u dhisayaa.', m + 10, doc.currentY - 20, {
    size: 7,
    color: [15, 23, 42],
  });

  const pdfBuffer = doc.buildPDFBuffer();
  const outputPath = path.resolve('./CARDOSO_AI_COMMANDS_GUIDE.pdf');
  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`✅ [PDF Generated] ${outputPath} (${pdfBuffer.length} bytes, ${doc.pages.length} pages)`);
  return outputPath;
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('generate-commands-pdf.js')) {
  generateCommandsPDF();
}
