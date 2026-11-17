/**
 * Comprehensive Somali Cities, Districts (Degmooyin) & Neighborhoods (Xaafado) Knowledge Base.
 * Used by CARDOSO AI so every bot accurately recognizes all Somali cities, their districts,
 * popular neighborhoods, and commercial hubs for delivery, local pickup, and customer chats.
 */

export interface DistrictEntry {
  name: string;
  aliases?: string[];
  notes?: string;
}

export interface CityGeography {
  city: string;
  aliases: string[];
  region: string;
  districts: DistrictEntry[];
}

export const SOMALI_GEOGRAPHY: CityGeography[] = [
  // ─── SOMALILAND ─────────────────────────────────────────────────────────────
  {
    city: 'Hargeysa',
    aliases: ['hargeisa', 'hergeysa', 'hargaisa', 'harg', 'hrg'],
    region: 'Maroodi Jeex (Somaliland)',
    districts: [
      { name: '26 June', aliases: ['26 juun', 'labaatan iyo lixda june', '26ka june', '26-june'] },
      { name: 'Axmed Dhagax', aliases: ['ahmed dhagax', 'axmed dhagax'] },
      { name: 'Gacan Libaax', aliases: ['gacan libah', 'gacan libax'] },
      { name: 'Ibraahim Koodbuur', aliases: ['ibrahim koodbuur', 'koodbuur', 'kodbuur'] },
      { name: 'Maxamuud Haybe', aliases: ['mahamuud haybe', 'maxamud haybe'] },
      { name: 'Macallin Haaruun', aliases: ['macalin haruun', 'haaruun'] },
      { name: 'Maxamed Mooge', aliases: ['mohamed mooge', 'mooge'] },
      { name: '31 May', aliases: ['31ka may', 'kow iyo soddonka may'] },
      { name: 'New Hargeysa', aliases: ['new hargeisa', 'new harg'] },
      { name: 'Jigjiga Yar', aliases: ['jigjigayar', 'jigjiga-yar', 'jijiga yar'] },
      { name: 'Xero Awr', aliases: ['xera awr', 'xero-awr'] },
      { name: 'Shacabka', aliases: ['shaab', "sha'ab", 'state house', 'madaxtooyada'] },
      { name: 'Octoobar', aliases: ['oktoobar', 'october', 'aktoobar'] },
      { name: 'Daami', aliases: ['dami'] },
      { name: 'Siinaay (Hargeysa)', aliases: ['sinaay'] },
      { name: 'Masalaha', aliases: ['masala', 'masallaha'] },
      { name: 'Boqol Jire', aliases: ['boqoljire', '100 jire'] },
      { name: 'Goljano', aliases: ['gol jano'] },
      { name: 'Cali Mataan', aliases: ['ali mataan'] },
      { name: 'Idaacadda', aliases: ['idaacada'] },
      { name: 'Xawaadle' },
      { name: 'Cabaaye' },
      { name: 'Qudhac Dheer', aliases: ['qudhacdheer'] },
      { name: 'Isha Boorama', aliases: ['ishaborama'] },
      { name: 'Pepsi Area', aliases: ['pepsi', 'kililka', 'garoonka'] },
      { name: 'Suuqa Gobonimo', aliases: ['gobonimo', 'suuqa hoose', 'waaheen'] },
      { name: 'Dararweyne' },
      { name: 'Geed Deeble', aliases: ['geedeeble'] },
      { name: 'Haleeya' },
    ],
  },
  {
    city: 'Burco',
    aliases: ['burao', 'burco'],
    region: 'Togdheer (Somaliland)',
    districts: [
      { name: 'Xaafadda Koowaad (1aad)', aliases: ['xaafada 1aad', '1aad', 'xaafadda koowaad'] },
      { name: 'Xaafadda Labaad (2aad)', aliases: ['xaafada 2aad', '2aad', 'xaafadda labaad'] },
      { name: 'Xaafadda Saddexaad (3aad)', aliases: ['xaafada 3aad', '3aad', 'xaafadda saddexaad'] },
      { name: 'Xaafadda Afraad (4aad)', aliases: ['xaafada 4aad', '4aad', 'xaafadda afraad'] },
      { name: 'Lixle', aliases: ['xaafada lixle', 'degmada lixle'] },
      { name: 'Faarax Oomaar', aliases: ['farax oomaar', 'oomaar'] },
      { name: 'Maxamed Cali', aliases: ['mohamed ali'] },
      { name: 'Oktoobar (Burco)', aliases: ['octoobar burco', 'october'] },
      { name: 'Hodan (Burco)', aliases: ['hodan qoyta'] },
      { name: 'Barwaaqo (Burco)', aliases: ['barwaqo'] },
      { name: 'Cali Xuseen', aliases: ['ali xuseen'] },
      { name: 'Nairobi (Burco)' },
      { name: 'Kenya (Burco)' },
      { name: 'Qoyta', aliases: ['kosar'] },
      { name: 'Tuurka' },
      { name: 'Xero Hilib', aliases: ['suuqa burco', 'bartamaha burco'] },
    ],
  },
  {
    city: 'Berbera',
    aliases: ['berbera', 'barbara'],
    region: 'Saaxil (Somaliland)',
    districts: [
      { name: 'Barwaaqo (Berbera)', aliases: ['barwaqo'] },
      { name: 'Daruura', aliases: ['daaruura'] },
      { name: 'Jamhuuriya', aliases: ['jamhuriya'] },
      { name: 'Daaroole' },
      { name: 'Badda Cas', aliases: ['red sea'] },
      { name: 'Baalade (Berbera)', aliases: ['buuraha'] },
      { name: 'Moscow (Berbera)', aliases: ['mosko'] },
      { name: 'Finland (Berbera)' },
      { name: 'Batalaale', aliases: ['batalale'] },
      { name: 'Dubur' },
      { name: 'Dekedda & Suuqa Berbera', aliases: ['dekeda berbera', 'suuqa berbera'] },
    ],
  },
  {
    city: 'Boorama',
    aliases: ['borama', 'boorama', 'borame'],
    region: 'Awdal (Somaliland)',
    districts: [
      { name: 'Sheekh Cali Jawhar', aliases: ['cali jawhar', 'sh cali jawhar'] },
      { name: 'Sheekh Cismaan', aliases: ['sheekh osman'] },
      { name: 'Sheekh Axmed Salaan', aliases: ['axmed salaan'] },
      { name: 'Shabeelle (Boorama)', aliases: ['shabelle'] },
      { name: 'Xaafadda Jaamacadda (Camuud)', aliases: ['camuud', 'amoud'] },
      { name: 'Hodan (Boorama)' },
      { name: 'Shacabka (Boorama)' },
      { name: 'Haldoor' },
      { name: 'Dooxada' },
      { name: 'Suuqa Boorama', aliases: ['bartamaha boorama'] },
    ],
  },
  {
    city: 'Laascaanood',
    aliases: ['las anod', 'lascanood', 'laascanood', 'laascaanood'],
    region: 'Sool',
    districts: [
      { name: 'Canjiid' },
      { name: 'Nugaal (Laascaanood)' },
      { name: 'Farxaskulle' },
      { name: 'Gooja-Cadde', aliases: ['goojocadde'] },
      { name: 'Hawl-Wadaag (Laascaanood)' },
      { name: 'Hodan (Laascaanood)' },
      { name: 'Badhan-Yare' },
      { name: 'Daba-Hilaac' },
      { name: 'Suuqa Laascaanood', aliases: ['bartamaha laascaanood'] },
    ],
  },
  {
    city: 'Ceerigaabo',
    aliases: ['erigavo', 'ceerigabo', 'cerigabo'],
    region: 'Sanaag',
    districts: [
      { name: 'Daallo', aliases: ['daalo'] },
      { name: 'Dayaxa' },
      { name: 'Tabca' },
      { name: 'Shacabka (Ceerigaabo)' },
      { name: 'Xaafadda Masaajidka' },
      { name: 'Xaafadda Garoonka (Ceerigaabo)' },
      { name: 'Suuqa Ceerigaabo' },
    ],
  },
  {
    city: 'Gabiley',
    aliases: ['gabileh', 'gabiley'],
    region: 'Gabiley (Somaliland)',
    districts: [
      { name: 'Bartamaha Gabiley', aliases: ['suuqa gabiley'] },
      { name: 'Isha Gabiley' },
      { name: 'Arabsiyo' },
      { name: 'Agabar' },
      { name: 'Allaybaday', aliases: ['alleybaday'] },
      { name: 'Kalabaydh' },
    ],
  },
  {
    city: 'Tog-Wajaale',
    aliases: ['wajaale', 'tog wajaale', 'togwajaale', 'wajale'],
    region: 'Xadka Somaliland & Itoobiya',
    districts: [
      { name: 'Suuqa Wajaale', aliases: ['suuqa weyn wajaale'] },
      { name: 'Xadka (Border Side)', aliases: ['xuduudda'] },
      { name: 'Bakhaarada' },
      { name: 'New Wajaale' },
      { name: 'Dhinaca Somaliland' },
      { name: 'Dhinaca Itoobiya (DDS)' },
    ],
  },
  {
    city: 'Oodweyne & Caynabo & Sheekh & Saylac & Buuhoodle',
    aliases: ['oodweyne', 'odweyne', 'caynabo', 'aynabo', 'sheekh', 'saylac', 'zeila', 'buuhoodle', 'buhoodle', 'ceel afweyn', 'badhan', 'dhahar', 'baligubadle', 'salaxley'],
    region: 'Magaalooyinka kale ee Waqooyiga',
    districts: [
      { name: 'Oodweyne (Suuqa & Xaafadda Koonfur/Waqooyi)' },
      { name: 'Caynabo (Bartamaha & Xaafadaha)' },
      { name: 'Sheekh (Goolis / Magaalada Hoose)' },
      { name: 'Saylac & Lughaya' },
      { name: 'Ceel Afweyn' },
      { name: 'Buuhoodle (Nabad-doon, Horseed, Suuqa)' },
      { name: 'Badhan & Dhahar & Taleex & Xudun' },
      { name: 'Baligubadle & Salaxley' },
    ],
  },

  // ─── MUQDISHO & KOONFURTA / BARTAMAHA SOOMAALIYA ────────────────────────────
  {
    city: 'Muqdisho',
    aliases: ['mogadishu', 'xamar', 'banadir', 'banaadir', 'muqdisho', 'muqdishu'],
    region: 'Banaadir (Caasimadda Soomaaliya)',
    districts: [
      { name: 'Hodan', aliases: ['km4', 'km5', 'zoobe', 'soobe', 'taleex', 'digfeer', 'banaadir', 'banadir', 'seybiyaano', 'tarabuunka', 'siigaale', 'kpp'] },
      { name: 'Howl-Wadaag', aliases: ['howlwadaag', 'hawl wadaag', 'bakaaraha', 'suuqa bakaaraha', 'bakaro', 'black sea', 'xamar jadiid', 'sayidka'] },
      { name: 'Warta Nabadda (Wardhiigley)', aliases: ['wardhiigley', 'warta nabada', 'xamar bile', 'florensa', 'geed jaceyl', 'labadhagax', 'bar ubax'] },
      { name: 'Yaqshiid', aliases: ['yaqshid', 'towfiiq', 'suuq bacaad', 'suuq bacaad', 'jungal', 'fagax', 'carafaat'] },
      { name: 'Huriwaa (Heliwaa)', aliases: ['heliwaa', 'huriwaa', 'suuqa xoolaha', 'sos', 'waxar cade', 'barwaaqo muqdisho', 'ex control balcad'] },
      { name: 'Kaaraan', aliases: ['karan', 'siisii', 'jamhuuriya kaaraan', 'nasiib buundo', 'mirinaayada', 'faanoole kaaraan'] },
      { name: 'Cabdicasiis', aliases: ['abdi aziz', 'cabdi casiis', 'liido', 'lido beach', 'xeebta liido'] },
      { name: 'Shibis', aliases: ['xaaji baasto', 'jubba'] },
      { name: 'Boondheere', aliases: ['bondhere', 'siinaay muqdisho', 'daljirka dahsoon', 'baar fiat'] },
      { name: 'Shangaani', aliases: ['shangani', 'xamar qadiim'] },
      { name: 'Xamar Weyne', aliases: ['xamarweyne', 'hamar weyne', 'via roma', 'ceel gaabta'] },
      { name: 'Xamar Jajab', aliases: ['xamarjajab', 'via liberia', 'ansalooti', 'ceel hindi'] },
      { name: 'Waaberi', aliases: ['waberi', '21 oktoobar', 'buulo eelay', 'buundooyinka', 'maka al mukarama', 'maka al-mukarama'] },
      { name: 'Wadajir (Madiina)', aliases: ['madiina', 'madina', 'nastexo', 'nasteexo', 'buulo xuubey', 'ceel qalow', 'danwadaagta', 'macallin nuur', 'aden adde', 'garoonka muqdisho'] },
      { name: 'Dharkenley', aliases: ['dharkeynley', 'suuqa boocle', 'xoosh', 'dabakaayo madow', 'salaama'] },
      { name: 'Dayniile', aliases: ['deyniile', 'bangariya', 'raadeerka', 'ex control afgooye'] },
      { name: 'Kaxda', aliases: ['kahda'] },
      { name: 'Garasbaaley & Daarusalaam', aliases: ['garasbaley', 'darusalaam', 'daarusalaam', 'ceelasha biyaha'] },
    ],
  },
  {
    city: 'Baydhabo',
    aliases: ['baidoa', 'baydhabo', 'baydhabo'],
    region: 'Baay (Koonfur Galbeed)',
    districts: [
      { name: 'Isha Baydhabo', aliases: ['isha'] },
      { name: 'Berdaale', aliases: ['bardaale'] },
      { name: 'Horseed (Baydhabo)' },
      { name: 'Howl-Wadaag (Baydhabo)' },
      { name: 'Wadajir (Baydhabo)' },
      { name: 'Salaamey', aliases: ['salamey'] },
      { name: 'Towfiiq (Baydhabo)' },
      { name: 'Bakiin' },
      { name: 'Suuqa Baydhabo' },
    ],
  },
  {
    city: 'Kismaayo',
    aliases: ['kismayo', 'kismaayo'],
    region: 'Jubbada Hoose (Jubbaland)',
    districts: [
      { name: 'Faanoole', aliases: ['fanole'] },
      { name: 'Calanley', aliases: ['alanley'] },
      { name: 'Farjano' },
      { name: 'Shaqaalaha (Kismaayo)' },
      { name: 'Guulwade' },
      { name: 'Siinaay (Kismaayo)' },
      { name: 'Via Afmadow', aliases: ['afmadow road'] },
      { name: 'Dalcadda' },
    ],
  },
  {
    city: 'Beledweyne',
    aliases: ['beledweyne', 'beletweyne', 'beledweyn'],
    region: 'Hiiraan (Hirshabelle)',
    districts: [
      { name: 'Howl-Wadaag (Beledweyne)' },
      { name: 'Kooshin' },
      { name: 'Buunda-weyn', aliases: ['buundoweyn'] },
      { name: 'Xaawo Taako', aliases: ['hawo tako'] },
      { name: 'Ceel Jaalle', aliases: ['ceeljale'] },
    ],
  },
  {
    city: 'Jowhar & Marka & Afgooye & Balcad',
    aliases: ['jowhar', 'jawhar', 'marka', 'merca', 'afgooye', 'afgoye', 'balcad', 'barawe', 'baraawe', 'wanlaweyn'],
    region: 'Shabeellaha Dhexe & Shabeellaha Hoose',
    districts: [
      { name: 'Jowhar: Hanti-wadaag, Buulo Sheekh, Kulmis, Horseed' },
      { name: 'Marka: Rusaayo, Aw-Balle, Waaberi, Buufow, Juubba' },
      { name: 'Afgooye: Dhagaxtuur, Xaawo Taako, Raqayle, Ceelasha' },
      { name: 'Baraawe & Balcad & Wanlaweyn' },
    ],
  },
  {
    city: 'Dhuusamareeb & Cadaado & Guriceel & Cabudwaaq',
    aliases: ['dhuusamareeb', 'dhusamareb', 'cadaado', 'adado', 'guriceel', 'guricel', 'cabudwaaq', 'abudwak'],
    region: 'Galguduud (Galmudug)',
    districts: [
      { name: 'Dhuusamareeb: Waaberi, Horseed, Dayax, Hantiwadaag, Ceel Dheer' },
      { name: 'Cadaado: Karaan, Waaberi, Hodan, Howl-Wadaag' },
      { name: 'Guriceel: Bartamaha, Hanti-wadaag, Tawakal' },
      { name: 'Cabudwaaq: Waaberi, Ubax, Horseed, Oktoobar' },
    ],
  },
  {
    city: 'Gedo (Baardheere, Beled Xaawo, Luuq, Doolow, Garbahaarey)',
    aliases: ['baardheere', 'bardhere', 'beled xaawo', 'bula hawo', 'luuq', 'doolow', 'dolow', 'garbahaarey', 'xudur'],
    region: 'Gedo & Bakool',
    districts: [
      { name: 'Beled Xaawo: Suuqa, Xaafadda Buunda, Xadka' },
      { name: 'Baardheere: Kurmaan, Kaskey, Horseed, Bulsho' },
      { name: 'Luuq & Doolow & Garbahaarey & Xudur' },
    ],
  },

  // ─── PUNTLAND & MUDUG ──────────────────────────────────────────────────────
  {
    city: 'Boosaaso',
    aliases: ['bosaso', 'boosaaso', 'bandar qasim'],
    region: 'Bari (Puntland)',
    districts: [
      { name: 'New Bosaso', aliases: ['new boosaaso'] },
      { name: 'Raxiis', aliases: ['rahis'] },
      { name: 'Laanta Hawada', aliases: ['laanta hawada'] },
      { name: 'Biyo Kulule' },
      { name: 'Raf & Raaxo', aliases: ['raf iyo raaxo'] },
      { name: 'Baalade (Boosaaso)' },
      { name: 'Ridwaan' },
      { name: 'Xaafadda Xafajir', aliases: ['xafajir'] },
      { name: 'Gacayte' },
      { name: 'Mingis' },
      { name: 'Dekedda & Suuqa Boosaaso', aliases: ['suuqa boosaaso'] },
    ],
  },
  {
    city: 'Garoowe',
    aliases: ['garowe', 'garoowe'],
    region: 'Nugaal (Puntland)',
    districts: [
      { name: 'Waaberi (Garoowe)' },
      { name: 'Hodan (Garoowe)' },
      { name: '1-da August', aliases: ['1da august', 'kowda agoosto', '1-august'] },
      { name: 'Hanti-wadaag (Garoowe)', aliases: ['hantiwadaag'] },
      { name: 'Horseed (Garoowe)' },
      { name: 'Israac (Garoowe)' },
      { name: 'Injineerada', aliases: ['xaafada injineerada'] },
      { name: 'Shabeelle (Garoowe)' },
      { name: 'Bartamaha Garoowe', aliases: ['suuqa garoowe'] },
    ],
  },
  {
    city: 'Gaalkacyo',
    aliases: ['galkayo', 'gaalkacyo', 'galkacyo'],
    region: 'Mudug',
    districts: [
      { name: 'Israac (Gaalkacyo)' },
      { name: 'Horseed (Gaalkacyo)' },
      { name: 'Garsoor' },
      { name: 'Wadajir (Gaalkacyo)' },
      { name: 'Baraxley', aliases: ['barahley'] },
      { name: 'Siinaay (Gaalkacyo)' },
      { name: 'New Galkacyo' },
    ],
  },
  {
    city: 'Qardho',
    aliases: ['qardho', 'gardo'],
    region: 'Karkaar (Puntland)',
    districts: [
      { name: 'Hanti-wadaag (Qardho)' },
      { name: 'Qoryacad', aliases: ['qoryo cad'] },
      { name: 'Xaafadda Garoonka (Qardho)' },
      { name: 'Kubo' },
      { name: 'Shacabka (Qardho)' },
    ],
  },

  // ─── JABUUTI (DJIBOUTI) ────────────────────────────────────────────────────
  {
    city: 'Jabuuti (Djibouti City & Gobollada)',
    aliases: ['jabuuti', 'djibouti', 'jabuti'],
    region: 'Jamhuuriyadda Jabuuti',
    districts: [
      { name: 'Balbala', aliases: ['pk12', 'pk 12', 'hayableh', 'layta', 'cheik moussa', 'wahle daba'] },
      { name: 'Quartier 1–7 (Q1, Q2, Q3, Q4, Q5, Q6, Q7)', aliases: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'quartier'] },
      { name: 'Ambouli & Haramous', aliases: ['ambouli', 'haramous'] },
      { name: 'Arhiba & Boulaos', aliases: ['arhiba', 'boulaos'] },
      { name: 'Gabode & Cité Hodan & Héron', aliases: ['gabode', 'cite hodan', 'heron', 'einguela', 'plateau'] },
      { name: 'Cali Sabiix, Tajuura, Obokh, Dikhil & Carta', aliases: ['ali sabieh', 'cali sabiix', 'tadjourah', 'tajuura', 'obock', 'dikhil', 'arta'] },
    ],
  },

  // ─── DOWLAD DEEGAANKA SOOMAALIDA (DDS) & KENYA / NFD ───────────────────────
  {
    city: 'Jigjiga & Magaalooyinka DDS (Itoobiya)',
    aliases: ['jigjiga', 'jijiga', 'dhagaxbuur', 'degahbur', 'godey', 'gode', 'qabridahar', 'kebri dahar', 'diridhaba', 'dire dawa', 'fiiq', 'wardeer', 'shilaabo', 'mooyaale', 'moyale'],
    region: 'Dowlad Deegaanka Soomaalida (DDS)',
    districts: [
      { name: 'Jigjiga: Qabalee 01–20, Kaaraamardha, Dudahidi, Garabcase, Xaafadda Taiwan, Jaamacadda Jigjiga', aliases: ['qabalee', 'kaaraamardha', 'dudahidi', 'garabcase', 'xaafada taiwan'] },
      { name: 'Diridhaba: Xaafadda Soomaalida, Kafira, Taiwan, Ashawa', aliases: ['kafira', 'ashawa'] },
      { name: 'Dhagaxbuur, Godey, Qabridahar, Fiiq, Wardeer & Shilaabo' },
    ],
  },
  {
    city: 'Islii (Nairobi) & Magaalooyinka NFD (Kenya)',
    aliases: ['islii', 'eastleigh', 'garissa', 'gaarisa', 'wajir', 'wajeer', 'mandera', 'mandheera'],
    region: 'Kenya & NFD',
    districts: [
      { name: 'Islii / Eastleigh (Nairobi): 1st Avenue, 2nd Avenue, 6th–12th Street, Amal Plaza, Garissa Lodge, BBS Mall, California', aliases: ['1st avenue', '2nd avenue', '6th street', 'amal plaza', 'garissa lodge', 'bbs mall'] },
      { name: 'Garissa: Bulla Iftin, Bulla Mzuri, Garissa Ndogo, Galbet', aliases: ['bulla iftin', 'garissa ndogo'] },
      { name: 'Wajir & Mandera' },
    ],
  },
];

function normalizeGeoText(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(normalizedHaystack: string, normalizedNeedle: string): boolean {
  if (!normalizedNeedle || normalizedNeedle.length < 2) return false;
  const rx = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedNeedle)}(?:$|\\s)`, 'i');
  return rx.test(normalizedHaystack);
}

/**
 * Compact regional overview so the AI knows all major Somali cities when asked
 * generally about cities, delivery zones, or coverage.
 */
export function getSomaliGeographyOverview(): string {
  return SOMALI_GEOGRAPHY.map((entry) => {
    const sampleDistricts = entry.districts.slice(0, 8).map((d) => d.name).join(', ');
    const more = entry.districts.length > 8 ? `, iyo ${entry.districts.length - 8}+ xaafadood oo kale` : '';
    return `• **${entry.city}** (${entry.region}): ${sampleDistricts}${more}`;
  }).join('\n');
}

/**
 * Detects any Somali city or neighborhood/district mentioned in user text (or general delivery/city queries)
 * and builds an exact, compact disambiguation + district reference note for PromptBuilder.
 */
export function buildSomaliGeographyPromptHint(
  userText: string,
  businessKnowledge: string = ''
): string | null {
  const normMsg = normalizeGeoText(userText);
  if (!normMsg) return null;

  const isBroadLocationOrDeliveryQuery =
    /\b(delivery|keenis|gaarsiin|dirid|diraa|keentaan|magaalo|magaalooyin|magaalooyinkee|xaafad|xaafado|xaafadahaa|degmo|degmooyin|degmada|gobol|gobolo|gobollada|meel|meesha|halkee|xagee|xaggee|joogaa|joogtaa|ku yaal|ku taallaa|address|location|cinwaan)\b/i.test(
      normMsg
    );

  const matchedCities: Array<{ cityEntry: CityGeography; matchedDistricts: string[]; matchedCityDirect: boolean }> = [];

  for (const cityEntry of SOMALI_GEOGRAPHY) {
    const cityTerms = [cityEntry.city.split('(')[0].trim(), ...cityEntry.aliases].map(normalizeGeoText);
    const matchedCityDirect = cityTerms.some((t) => containsTerm(normMsg, t));

    const matchedDistricts: string[] = [];
    for (const d of cityEntry.districts) {
      const districtTerms = [d.name.split('(')[0].trim(), ...(d.aliases || [])].map(normalizeGeoText);
      if (districtTerms.some((t) => containsTerm(normMsg, t))) {
        matchedDistricts.push(d.name);
      }
    }

    if (matchedCityDirect || matchedDistricts.length > 0) {
      matchedCities.push({ cityEntry, matchedDistricts, matchedCityDirect });
    }
  }

  // Also detect home city from the business/institution knowledge base if configured
  let homeCityHint = '';
  if (businessKnowledge.trim()) {
    const normKb = normalizeGeoText(businessKnowledge);
    for (const cityEntry of SOMALI_GEOGRAPHY) {
      const baseCity = normalizeGeoText(cityEntry.city.split('(')[0].trim());
      if (baseCity && containsTerm(normKb, baseCity)) {
        homeCityHint = cityEntry.city;
        break;
      }
    }
  }

  if (matchedCities.length === 0 && !isBroadLocationOrDeliveryQuery) {
    return null;
  }

  const lines: string[] = [
    '[Somali Cities & Neighborhoods Geography Reference]:',
  ];

  if (homeCityHint) {
    lines.push(`- Business/User Primary Base City: ${homeCityHint}`);
  }

  if (matchedCities.length > 0) {
    for (const item of matchedCities) {
      const distList = item.cityEntry.districts.map((d) => d.name).join(', ');
      const hitNote =
        item.matchedDistricts.length > 0
          ? ` (Mentioned xaafad/degmo: ${item.matchedDistricts.join(', ')})`
          : '';
      lines.push(`- ${item.cityEntry.city} [${item.cityEntry.region}]${hitNote} — Xaafadaha & Degmooyinka: ${distList}`);
    }
    if (matchedCities.length > 1 && matchedCities.every((m) => !m.matchedCityDirect)) {
      const cityNames = matchedCities.map((m) => m.cityEntry.city).join(' / ');
      lines.push(`- NOTE: That district name exists in multiple cities (${cityNames}). Use business context or ask politely to confirm the exact city before dispatching delivery!`);
    }
  } else {
    // Broad query about cities / delivery / neighborhoods -> give complete compact directory
    lines.push(getSomaliGeographyOverview());
  }

  lines.push(
    '- Instruction: Always recognize Somali cities & exact neighborhoods naturally (never say you do not know a district!). For delivery, treat intra-city neighborhoods as local delivery and other cities as inter-city delivery if the Knowledge Base supports Both.'
  );

  return lines.join('\n');
}
