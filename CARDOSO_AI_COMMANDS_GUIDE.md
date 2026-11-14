# 📱 CARDOSO AI — BUUG-TILMAAMEEDKA RASMIGA AH EE AMARRADA BOT-KA
> **Nooca:** v1.0.0 Pro | **Amniga:** 100% Xidhan & Ilaalsan | **Mulkiilaha:** Maxamed Daahir  
> **PDF Version:** Waxaa la socda faylka PDF-ka ah ee [CARDOSO_AI_COMMANDS_GUIDE.pdf](file:///c:/Users/mohamed/Desktop/BOT/CARDOSO_AI_COMMANDS_GUIDE.pdf)

---

## 📑 Tusmada Buugga (Table of Contents)
1. [Nidaamka Amniga & Kala Saaridda Awoodaha (Security Architecture)](#1-nidaamka-amniga--kala-saaridda-awoodaha)
2. [Amarrada Gaarka u ah Maamulka (ADMIN ONLY COMMANDS)](#2-amarrada-gaarka-u-ah-maamulka-admin-only)
   - [A. Maamulka WhatsApp Status (Stories)](#a-maamulka-whatsapp-status-stories)
   - [B. Fariimaha Tooska ah & Auto-Replies](#b-fariimaha-tooska-ah--auto-replies)
   - [C. Maamulka Groups-ka (Group Management)](#c-maamulka-groups-ka-group-management)
   - [D. Maamulka Profile-ka & Xiriirrada (Profile & Contacts)](#d-maamulka-profile-ka--xiriirrada)
   - [E. Kontroolka Fariimaha (Message Control)](#e-kontroolka-fariimaha-message-control)
3. [Amarrada Dadweynaha & Ardayda (PUBLIC / EVERYONE COMMANDS)](#3-amarrada-dadweynaha--ardayda-public--everyone)
4. [Shaxda Kooban ee Dhammaan Amarrada (Complete Command Matrix)](#4-shaxda-kooban-ee-dhammaan-amarrada)
5. [Sida Loo Cusboonaysiiyo PDF-ka Mar Kasta (PDF Auto-Generation)](#5-sida-loo-cusboonaysiiyo-pdf-ka-mar-kasta)

---

## 1. Nidaamka Amniga & Kala Saaridda Awoodaha

Bot-kan waxaa lagu dhisay nidaam ammaan oo heer sare ah (**Strict Role-Based Access Control**). Qof kasta oo farriin soo qora ma isticmaali karo amarrada maamulka.

### 🛡️ Yaa Isticmaali Kara Amarrada Admin-ka?
1. **Taleefanka Bot-ka ku xidhan (Host / Owner):**  
   Marka aad ka qorto taleefanka WhatsApp-ka ee bot-ku ku rakiban yahay (`msg.key.fromMe = true`), bot-ku wuxuu isla markiiba kuu aqoonsanayaa **Mulkiilaha Guud (Host Admin)**.
2. **Lambarrada Admin-ka ee Whitelist-ka ku jira (`ADMIN_PHONE_NUMBERS`):**  
   Taleefannada kale ee lagu daro faylka `.env` (tusaale: `ADMIN_PHONE_NUMBERS=252634949642,25261xxxxxxx`). Lambarradani waxay leeyihiin awood maamul oo buuxda xitaa haddii aysan gacanta ku hayn taleefanka bot-ka.

### ⛔ Maxaa Dhacaya Haddii Qof Aan Admin Ahayn Amar Bixiyo?
* Haddii arday, qof qariib ah, ama xubin caadi ah oo group ku jirta ay isku dayaan inay qoraan amar maamul (sida `!kick`, `!status`, `!mute`, iwm.):
* **Bot-ku ma fulinayo amarka.**
* Wuxuu soo celinayaa fariin digniin amni ah:
  > `⛔ *CUDHURDAAR:* Amarkan waxa u oggol kaliya Maamulaha Bot-ka (Admin). Ma lihid awood aad ku fuliso amarkan.`

---

## 2. Amarrada Gaarka u ah Maamulka (ADMIN ONLY)

### A. Maamulka WhatsApp Status (Stories)

| Amarka | Sida Loo Isticmaalo | Waxa Uu Qabanayo | Cidda Isticmaalaysa |
| :--- | :--- | :--- | :--- |
| `!status <qoraal>` | `!status Soo dhawaada asxaabtayda!` | Waxay WhatsApp Status u soo dhigaysaa qoraalkaaga oo midab qurux badan leh. | **Admin Only** |
| `!status #color <qoraal>` | `!status #10b981 Jimce Mubaarak!` | Status leh midab aad adigu dooratay (HEX Color). | **Admin Only** |
| `!status-ai <dulucda>` | `!status-ai dhiirrigelin ganacsi` | Gemini AI ayaa soo saaraysa xikmad/oraah heer sare ah oo Soomaali ah kuna dhigaysa status-kaaga. | **Admin Only** |
| `!autoview on` | `!autoview on` | Bot-ku wuxuu si toos ah u daawanayaa (Auto-Seen) dhammaan stories-ka dadkaaga isla markiiba. | **Admin Only** |
| `!autoview off` | `!autoview off` | Daminta daawashada tooska ah ee stories-ka. | **Admin Only** |

---

### B. Fariimaha Tooska ah & Auto-Replies

| Amarka | Sida Loo Isticmaalo | Waxa Uu Qabanayo | Cidda Isticmaalaysa |
| :--- | :--- | :--- | :--- |
| `!reply <jid> <fariin>` | `!reply 252634949642@s.whatsapp.net Salaamu calaykum` | Bot-ka oo fariin toos ah u diraya qof gaar ah adigoon la hadlin. | **Admin Only** |
| `!autoreply add <k> -> <j>` | `!autoreply add qiimaha -> Qiimaha semistarku waa $350` | Samaynta fariin toos ah oo qofkii eraygaas soo qora isla markiiba loogu jawaabo. | **Admin Only** |
| `!autoreply list` | `!autoreply list` | Liiska dhammaan fariimaha tooska ah ee aad horay u kaydisay. | **Admin Only** |
| `!autoreply del <k>` | `!autoreply del qiimaha` | Tirtiridda fariin toos ah oo hore loo keydiyay. | **Admin Only** |

---

### C. Maamulka Groups-ka (Group Management)

| Amarka | Sida Loo Isticmaalo | Waxa Uu Qabanayo | Cidda Isticmaalaysa |
| :--- | :--- | :--- | :--- |
| `!tagall <fariin>` | `!tagall Ogeysiis shir degdeg ah` | Wuxuu wada tag-gareeyaa (mention) dhammaan xubnaha group-ka ku jira fariintaada. | **Admin Only** |
| `!kick @qofka` | `!kick @252634949642` ama reply fariintooda | Qofka group-ka laga saarayo (Kick member). | **Admin Only** |
| `!add <taleefan>` | `!add 252634949642` | Ku darista qof cusub group-ka adigoo adeegsanaya lambarkiisa. | **Admin Only** |
| `!promote @qofka` | `!promote @252634949642` | Qofka oo laga dhigo Admin group-ka. | **Admin Only** |
| `!demote @qofka` | `!demote @252634949642` | Ka qaadista xilka Admin-nimo ee qof group-ka ku jira. | **Admin Only** |
| `!mute` | `!mute` | Group-ka oo la xidho si kaliya Admins-ku wax ugu qori karaan. | **Admin Only** |
| `!unmute` | `!unmute` | Group-ka oo dib loo furo si dadka oo dhan wax u qori karaan. | **Admin Only** |
| `!link` | `!link` | Soo saarista link-ga casumaadda ee group-ka (Invite Link). | **Admin Only** |
| `!groupinfo` | `!groupinfo` | Faahfaahinta xubnaha, admins-ka, iyo sharaxaadda group-ka. | **Admin Only** |

---

### D. Maamulka Profile-ka & Xiriirrada

| Amarka | Sida Loo Isticmaalo | Waxa Uu Qabanayo | Cidda Isticmaalaysa |
| :--- | :--- | :--- | :--- |
| `!setname <magac>` | `!setname Cardoso AI Bot Pro` | Beddelista magaca profile-ka WhatsApp-ka ee bot-ka. | **Admin Only** |
| `!setbio <status>` | `!setbio Waxbarasho & Caqli Macmal ah 24/7` | Beddelista About/Bio-ga profile-ka bot-ka. | **Admin Only** |
| `!block <taleefan>` | `!block 252634949642` | Qofka laga xannibayo WhatsApp-ka bot-ka. | **Admin Only** |
| `!unblock <taleefan>` | `!unblock 252634949642` | Ka qaadista xayiraadda qof hore loo xannibay. | **Admin Only** |
| `!maamul` | `!maamul` | Tusmada guud iyo menu-ga dhammaan amarrada maamulka WhatsApp. | **Admin Only** |

---

### E. Kontroolka Fariimaha (Message Control)

| Amarka | Sida Loo Isticmaalo | Waxa Uu Qabanayo | Cidda Isticmaalaysa |
| :--- | :--- | :--- | :--- |
| `!delete` | Reply dheh fariin kasta oo qor `!delete` | Tirtirista fariinta qofka ama fariintaada (Delete for Everyone). | **Admin Only** |
| `!react <emoji>` | Reply dheh fariin oo qor `!react 🔥` | Saaridda falcelin emoji ah fariin kasta (Reaction). | **Admin Only** |

---

## 3. Amarrada Dadweynaha & Ardayda (PUBLIC / EVERYONE)

Amarradan waxaa loogu talagalay ardayda, macallimiinta, iyo cid kasta oo la hadlaysa bot-ka (Private Chat ama Group):

| Amarka | Sida Loo Isticmaalo | Waxa Uu Qabanayo | Cidda Isticmaalaysa |
| :--- | :--- | :--- | :--- |
| `!help` | `!help` | Tusmada buuxda ee adeegyada bot-ka iyo sida loo isticmaalo. | **Qof Kasta** |
| `!shax` | `!shax` | Jadwalka iyo shaxda semistarka ardayga (Lectures, Days, Rooms). | **Qof Kasta** |
| `!ogaansho` | `!ogaansho` | Xogta diiwaangashan ee ardayga (Magaca, ID-ga, Kuliyadda). | **Qof Kasta** |
| `!kuliyadaha` | `!kuliyadaha` | Liiska dhammaan kuliyadaha iyo takhasusyada jaamacadda. | **Qof Kasta** |
| `!kharashka` | `!kharashka` | Xogta lacagaha waxbarashada (Tuition fees) iyo habka bixinta. | **Qof Kasta** |
| `!shuruudaha` | `!shuruudaha` | Shuruudaha looga baahan yahay ardayga cusub ee is-diiwaangelinaya. | **Qof Kasta** |
| `!contact` | `!contact` | Cinwaanka, xafiisyada, iyo xiriirrada rasmiga ah ee jaamacadda. | **Qof Kasta** |
| `!cod` | `!cod` | Daarka/deminta in bot-ku cod Soomaali ah (Edge TTS) kugu soo jawaabo. | **Qof Kasta** |
| `!reset` | `!reset` | Tir-tiridda xusuusta wada-hadalka hore si dooda loo bilaabo mar kale. | **Qof Kasta** |
| `!abaarso` | `!abaarso` | Ogeysiiska rasmiga ah iyo xayeysiiska guud ee jaamacadda. | **Qof Kasta** |
| *Wada-hadal Caadi ah* | `Iiga warran computer science?` | Gemini AI oo ku siinaysa jawaab xikmad leh oo cilmiyeysan. | **Qof Kasta** |

---

## 4. Shaxda Kooban ee Dhammaan Amarrada

```
+-------------------+-----------------+------------------------------------------+-------------------------------------+
| AMARKA            | CIDA U OGOL     | SHAQADA UU QABANAYO                      | TUSAALE                             |
+-------------------+-----------------+------------------------------------------+-------------------------------------+
| !status <txt>     | Admin Only      | Soo dhigista WhatsApp Status (Stories)   | !status Soo dhawaada dhamaantiin    |
| !status-ai <dul>  | Admin Only      | AI oo xikmad soo saaraysa kuna dhigeysa  | !status-ai dhiirrigelin ganacsi     |
| !autoview on/off  | Admin Only      | Si toos ah u daawashada stories-ka       | !autoview on                        |
| !reply <jid> <f>  | Admin Only      | Fariin toos ah u dir qof gaar ah         | !reply 252634949642@s.wa... Salaan  |
| !autoreply add/del| Admin Only      | Fariin toos ah (Auto-responder)          | !autoreply add lacagta -> $350      |
| !tagall <fariin>  | Admin Only      | Tag-garee dhammaan xubnaha group-ka      | !tagall Shir degdeg ah 8:00pm       |
| !kick @qofka      | Admin Only      | Ka saaridda qofka group-ka               | !kick @252634949642                 |
| !add <taleefan>   | Admin Only      | Ku darista xubin cusub group-ka          | !add 252634949642                   |
| !promote @qofka   | Admin Only      | Xubin group-ka ka dhig Admin             | !promote @252634949642              |
| !demote @qofka    | Admin Only      | Ka qaadista xilka Admin-ka               | !demote @252634949642               |
| !mute / !unmute   | Admin Only      | Xidhitaanka ama furista group-ka         | !mute                               |
| !link             | Admin Only      | Soo saarista invite link-ga group-ka     | !link                               |
| !groupinfo        | Admin Only      | Xogta iyo xubnaha group-ka               | !groupinfo                          |
| !setname <magac>  | Admin Only      | Beddel magaca profile-ka bot-ka          | !setname Cardoso AI Bot             |
| !setbio <status>  | Admin Only      | Beddel Bio-ga profile-ka bot-ka          | !setbio Caqli Macmal Ah             |
| !block / !unblock | Admin Only      | Xannib ama ka qaad xayiraadda            | !block 252634949642                 |
| !delete           | Admin Only      | Fariin kasta tirtir (Delete for Everyone)| Reply + !delete                     |
| !react <emoji>    | Admin Only      | Falcelin emoji fariin kasta saar         | Reply + !react 🔥                   |
| !maamul           | Admin Only      | Tusmada amarrada maamulka                | !maamul                             |
| !help             | Qof Kasta       | Liiska caawinta ardayda & dadweynaha     | !help                               |
| !shax             | Qof Kasta       | Jadwalka casharrada ardayga              | !shax                               |
| !ogaansho         | Qof Kasta       | Xogta ardayga ee diiwaangashan           | !ogaansho                           |
| !kuliyadaha       | Qof Kasta       | Liiska kuliyadaha jaamacadda             | !kuliyadaha                         |
| !kharashka        | Qof Kasta       | Lacagaha iyo kharashka waxbarashada      | !kharashka                          |
| !shuruudaha       | Qof Kasta       | Shuruudaha diiwaangelinta cusub          | !shuruudaha                         |
| !contact          | Qof Kasta       | Cinwaanka & xafiisyada jaamacadda        | !contact                            |
| !cod              | Qof Kasta       | Daarka ama deminta codka bot-ka          | !cod                                |
| !reset            | Qof Kasta       | Dib u bilaabidda xusuusta wada-hadalka   | !reset                              |
| !abaarso          | Qof Kasta       | Ogeysiiska rasmiga ah ee jaamacadda      | !abaarso                            |
+-------------------+-----------------+------------------------------------------+-------------------------------------+
```

---

## 5. Sida Loo Cusboonaysiiyo PDF-ka Mar Kasta

Marka aad amar cusub ku soo darto bot-ka ama aad wax ka beddesho hab-dhaqankiisa, waxaad si toos ah u cusboonaysiin kartaa buugga PDF-ka ah adigoo isticmaalaya amarkan:

```bash
npm run generate-pdf
```
ama:
```bash
node scripts/generate-commands-pdf.js
```

### 💡 Maxaa Dhacaya Markaad Amarkaas Qorto?
1. Script-ku wuxuu si toos ah u dhisayaa PDF 6 bog ah oo leh:
   - Jaantusyo iyo midabbo casri ah.
   - Header, Footer, iyo Bog-tiris (Page Numbers).
   - Shaxyo nidaamsan oo u kala saaran Admin iyo Qof Kasta.
   - Xeerarka amniga iyo sharraxaadda qodobbada cusub.
2. Waxaa isla markiiba la cusboonaysiinayaa faylka [CARDOSO_AI_COMMANDS_GUIDE.pdf](file:///c:/Users/mohamed/Desktop/BOT/CARDOSO_AI_COMMANDS_GUIDE.pdf).

---
*U diyaariyay: Maxamed Daahir & Cardoso AI Bot Team*

