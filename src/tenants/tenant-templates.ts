import { BotCategory } from './plan-catalog.js';

export interface CategoryTemplateConfig {
  category: BotCategory;
  botName: string;
  businessName: string;
  systemRole: string;
  knowledgeBase: string;
}

export interface CategoryStructuredInput {
  ownerOrBrandName?: string;
  location?: string;
  hours?: string;
  paymentInfo?: string;
  deliveryOrRegistration?: string;
  catalogOrCourses?: string;
  extraNotes?: string;
}

export function getCategoryStarterTemplate(
  category: BotCategory,
  ownerOrBrandName: string = ''
): CategoryTemplateConfig {
  const cleanBrand = ownerOrBrandName.trim();

  if (category === 'business') {
    const brand = cleanBrand || 'Meheraddayda';
    return {
      category: 'business',
      botName: brand,
      businessName: brand,
      systemRole:
        `Waxaad tahay kaaliyaha iibka iyo adeegga macaamiisha ee ${brand}. ` +
        `Macaamiisha u soo dhawee si diirran oo ixtiraam leh, ka jawaab qiimaha alaabta, ` +
        `delivery-ga, iyo saacadaha shaqada adigoo ku salaynaya xogta rasmiga ah, ` +
        `hubina dalabaadka & rasiidhada lacag bixinta (Zaad/eDahab/Sahal).`,
      knowledgeBase:
        `• Magaca Meheradda: ${brand}\n` +
        `• Goobta / Magaalada & Xaafadda: [Ku qor magaalada, xaafadda ama suuqa]\n` +
        `• Saacadaha Shaqada: Sabti–Khamiis (8:00 AM – 9:00 PM)\n` +
        `• Lacag Bixinta (Zaad / eDahab / Sahal): [Ku qor lambarka merchant-ka ama taleefanka]\n` +
        `• Adeegga Delivery-ga: Labadaba — Magaalada gudaheeda (xaafadaha oo dhan: 30–60 daqiiqo) iyo Magaalooyinka kale ee dalka!\n\n` +
        `Alaabta & Qiimaha:\n` +
        `- [Magaca Alaabta 1] — $[Qiimaha]\n` +
        `- [Magaca Alaabta 2] — $[Qiimaha]\n`,
    };
  }

  if (category === 'education') {
    const brand = cleanBrand || 'Akadeemiyadda Aqoonta';
    return {
      category: 'education',
      botName: brand,
      businessName: brand,
      systemRole:
        `Waxaad tahay la-taliyaha waxbarashada iyo isdiiwaangelinta ee ${brand}. ` +
        `Ardayda iyo waalidiinta ugu sharax si cad koorsooyinka, jadwalka, shuruudaha, ` +
        `iyo kharashka waxbarashada, kana caawi su'aalaha casharrada adigoo dhiirrigelinaya.`,
      knowledgeBase:
        `• Magaca Xarunta / Iskuulka: ${brand}\n` +
        `• Goobta: [Ku qor magaalada / xaafadda]\n` +
        `• Waqtiga Diiwaangelinta: 8:00 AM – 12:30 PM & 4:00 PM – 8:00 PM\n` +
        `• Xiriirka Maamulka: [Ku qor lambarka maamulka]\n\n` +
        `Koorsooyinka & Barnaamijyada:\n` +
        `- [Koorso 1] — Muddo: [X bilood] | Lacagta: $[Qiime]\n` +
        `- [Koorso 2] — Muddo: [X bilood] | Lacagta: $[Qiime]\n`,
    };
  }

  // Default: personal (Qof Caadi ah)
  const owner = cleanBrand || 'Milkiilaha';
  return {
    category: 'personal',
    botName: `${owner} AI`,
    businessName: owner,
    systemRole:
      `Waxaad tahay caawiyaha gaarka ah iyo saaxiibka dhaw ee ${owner} ku maamula WhatsApp-kan. ` +
      `Dadka u garo si dabiici ah (saaxiibo, qoys, macaamiil), si xushmad iyo kaftan xalaal ah leh ula hadal, ` +
      `markii ${owner} maqan yahay ama mashquulsan yahayna si edeb leh fariimaha muhiimka ah u qabo.`,
    knowledgeBase:
      `• Milkiilaha Lambarka: ${owner}\n` +
      `• Habka Jawaabta: Saaxiibtinimo, kooban, Af-Soomaali dabiici ah\n` +
      `• Xaaladda Maqnaanshaha: Haddii ${owner} mashquulsan yahay, weydii fariinta muhiimka ah si uu dib ugula soo xidhiidho.\n`,
  };
}

export function buildKnowledgeFromStructuredInput(
  category: BotCategory,
  input: CategoryStructuredInput
): string {
  const lines: string[] = [];
  if (input.ownerOrBrandName?.trim()) {
    lines.push(
      category === 'personal'
        ? `• Milkiilaha: ${input.ownerOrBrandName.trim()}`
        : `• Magaca: ${input.ownerOrBrandName.trim()}`
    );
  }
  if (input.location?.trim()) lines.push(`• Goobta: ${input.location.trim()}`);
  if (input.hours?.trim()) lines.push(`• Saacadaha: ${input.hours.trim()}`);
  if (input.paymentInfo?.trim()) lines.push(`• Lacag Bixinta (Zaad/eDahab): ${input.paymentInfo.trim()}`);
  if (input.deliveryOrRegistration?.trim()) {
    lines.push(
      category === 'education'
        ? `• Diiwaangelinta: ${input.deliveryOrRegistration.trim()}`
        : `• Delivery / Adeegga: ${input.deliveryOrRegistration.trim()}`
    );
  }
  if (input.catalogOrCourses?.trim()) {
    lines.push('');
    lines.push(category === 'education' ? 'Koorsooyinka & Qiimaha:' : 'Alaabta / Adeegyada & Qiimaha:');
    lines.push(input.catalogOrCourses.trim());
  }
  if (input.extraNotes?.trim()) {
    lines.push('');
    lines.push(input.extraNotes.trim());
  }
  return lines.join('\n').trim();
}

