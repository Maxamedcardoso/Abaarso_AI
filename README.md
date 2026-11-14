# ABARSO AI — Your Smart Student Advisor
> **Barasho, Dhiirigelin, iyo Horumar** (Education, Motivation, and Growth)

ABARSO AI is a production-grade, bilingual (Somali, English, and Mixed code-switching) academic advisor bot designed for students and learners. Built with Google Gemini Flash AI intelligence, a secure local SQLite memory engine, and a pluggable messaging transport supporting local Console simulation, WhatsApp Multi-Device (Baileys), and official Meta Cloud API Webhooks.

---

## 🌟 Key Features

1. **Bilingual Intelligence (Somali & English):**
   - Natural Somali language understanding, including informal spelling, student contractions (`asc`, `sxb`, `wll`, `waxan`, `i caawi`), and dialect nuances.
   - Fluid mixed-language handling (e.g., *"Sideen Python ugu qoraa loop?"*).
   - Technical Vocabulary Glossary translating complex computing terms (*Variable*, *Loop*, *Database*, *API*, *Async*) into simple, intuitive Somali analogies.

2. **Core Student Advising Domains:**
   - **Programming Assistance:** Step-by-step debugging, clean code blocks, and syntax explanations across Python, JavaScript, HTML/CSS, React, Node.js, and Flutter/Dart.
   - **Socratic Homework Guidance:** Helps students understand underlying concepts and guides them step-by-step rather than simply dumping answers to copy.
   - **Academic Planning:** Pomodoro study schedules, active recall revision strategies, and university major guidance.
   - **Responsible Motivation:** Encourages academic consistency with clear ethical boundaries (redirects crisis or depression queries to real human counselors).

3. **Student Privacy & Right to be Forgotten:**
   - Hashed phone numbers (`SHA-256`) to protect student identity in the database.
   - Strict student session isolation (Student A can never see Student B's conversations).
   - Instant Right-to-be-Forgotten command (`!tirtir` or `!clear`) that permanently purges student records.
   - Automated 30-day data retention cleanup.

4. **Zero-Cost Safeguards & Anti-Spam:**
   - Strict daily free quota threshold (1,400 daily requests buffer below the 1,500 daily quota).
   - Requests-per-minute sliding window (14 RPM) to prevent transient 429 rate limits.
   - Pauses AI requests when free limits are approached, guaranteeing **ZERO accidental cloud billing**.
   - Optional local `llama.cpp` fallback with real health verification.
   - In-memory message deduplication and per-student sliding rate limiting.

5. **Multi-Transport Architecture:**
   - **Console Simulator:** Test everything locally in your terminal without needing WhatsApp or risking bans (`npm run sim`).
   - **WhatsApp Multi-Device (Baileys):** Companion protocol linking via terminal QR code for existing groups with anti-ban mention filters and typing delays.
   - **Meta WhatsApp Cloud API:** Official 1-to-1 webhook server with HMAC verification and Graph API integration.

---

## 🚀 Quick Start (Local Windows)

### 1. Prerequisites
- **Node.js**: v22+ LTS installed
- **Terminal**: PowerShell or VS Code Integrated Terminal
- **Google AI Studio API Key**: Free tier from [aistudio.google.com](https://aistudio.google.com/)

### 2. Setup
```powershell
# 1. Clone or navigate to the project directory
cd c:\Users\mohamed\Desktop\BOT

# 2. Copy the environment configuration template
copy .env.example .env

# 3. Open .env and add your free Gemini key:
# GEMINI_API_KEY=your_actual_key_here
```

### 3. Run Interactive Console Simulator (Instant Testing)
```powershell
npm run sim
```
You can immediately ask questions in Somali or English:
- `asc sxb i caawi sideen Python u bartaa?`
- `How can I organize my university study schedule?`
- `Sideen React useState ugu shaqeeyaa?`
- `!tirtir` (clears your memory)

### 4. Run Automated Test Suite
```powershell
npm test
```
Executes all 31 unit, integration, and master end-to-end test cases.

---

## 📂 Project Structure

```
c:\Users\mohamed\Desktop\BOT\
├── .env.example                # Environment configuration template
├── package.json                # Project dependencies and npm scripts
├── tsconfig.json               # TypeScript configuration
├── data/                       # Local SQLite storage (gitignored)
│   └── abarso.db
├── src/
│   ├── index.ts                # Application startup orchestrator
│   ├── config/                 # Configuration & limits
│   │   ├── env.ts              # Environment loader & validator
│   │   └── limits.ts           # Free-tier quota & backoff constants
│   ├── ai/                     # AI Provider layer (Decoupled)
│   │   ├── ai-provider.interface.ts # Pluggable AI contract
│   │   ├── gemini.provider.ts  # Google Gemini Flash engine
│   │   ├── llama.provider.ts   # Local llama.cpp fallback engine
│   │   ├── quota-tracker.ts    # Zero-cost quota monitor
│   │   ├── retry-handler.ts    # Exponential backoff retry engine
│   │   └── ai-orchestrator.ts  # AI dispatcher and fallback coordinator
│   ├── advisor/                # Student Advising Logic
│   │   ├── language-detector.ts # Somali/English/Mixed detector
│   │   ├── somali-dictionary.ts # Tech glossary & slang normalizer
│   │   ├── prompt-builder.ts   # Dynamic contextual system prompts
│   │   ├── intent-classifier.ts # Intent parser (code, hw, academic, etc.)
│   │   ├── academic-advisor.ts # Study schedules & university advice
│   │   ├── homework-helper.ts  # Socratic tutoring & quiz generator
│   │   ├── motivation-coach.ts # Encouragement & crisis guardrail
│   │   └── advisor-engine.ts   # Central advising coordinator
│   ├── memory/                 # Database & Student Privacy
│   │   ├── memory.interface.ts # Pluggable storage contract
│   │   └── sqlite-memory.ts    # Node 22 native SQLite implementation
│   ├── pipeline/               # Ingestion & Security
│   │   ├── deduplicator.ts     # LRU message deduplication
│   │   ├── rate-limiter.ts     # Per-student sliding window rate limiter
│   │   └── message-router.ts   # Message router & admin authorization
│   ├── transports/             # Pluggable Messaging Transports
│   │   ├── transport.interface.ts # Standard messaging contract
│   │   ├── console-simulator.ts   # Local interactive test CLI
│   │   ├── whatsapp-baileys.ts    # WhatsApp Web multi-device client
│   │   └── meta-cloud-webhook.ts  # Meta Cloud API webhook gateway
│   └── admin/                  # Administration & Monitoring
│       ├── admin-service.ts    # Admin query & health service
│       └── admin-cli.ts        # Admin command-line utility
└── tests/                      # Automated Test Suites
    ├── runner.ts               # Test suite harness
    ├── all.ts                  # Master runner for all 31 tests
    ├── phase2.test.ts          # Foundation & limits tests
    ├── phase3.test.ts          # Gemini & zero-cost tests
    ├── phase4.test.ts          # Bilingual & slang tests
    ├── phase5.test.ts          # Student memory & privacy tests
    ├── phase6.test.ts          # Advisor features & safety tests
    ├── phase7.test.ts          # Messaging transports & router tests
    └── e2e-master.test.ts      # End-to-end integration tests
```

---

## 📱 WhatsApp 100% Management & Status Intelligence (Awoodda Buuxda)

Bot-ka waxaa lagu qalabeeyay awood buuxda oo 100% ah oo uu ku maamuli karo WhatsApp-ka, Stories/Status-ka, fariimaha tooska ah, iyo kooxaha (Groups-ka):

### 1. WhatsApp Status (Stories) Management
- **`!status <fariin>`** — Daabac WhatsApp Status qoraal ah oo leh midabbo soo jiidasho leh.
- **`!status` (Sawir/Cod/Video la socdo)** — Daabac sawir, cod (Voice status), ama muuqaal toos ugu baxa WhatsApp Status.
- **`!status-ai [mawduuc]`** — AI ayaa curinaya xigmad ama dhiirigelin Soomaali ah oo toos ugu daabacaya WhatsApp Status.
- **`!autoview on/off`** — Daaro ama dami in bot-ku si toos ah u daawado status kasta oo ay dadka contacts-ka ahi soo dhigaan (Auto Seen 24/7).

### 2. Reply & Direct Messaging ("Reply u gali karo qofka")
- **`!reply <lambar> <fariin>` / `!send <lambar> <fariin>`** — U dir fariin toos ah qof kasta (waxaa kale oo la socon kara sawir ama cod).
- **`!reply <fariin>`** (adigoo qof fariintiisa quote ku haya) — Toos ugu celi jawaabta qofkaas.
- **`!cod <lambar> <fariin>`** — Fariin cod Soomaali ah (Voice Note) oo dabiici ah toos ugu dir lambarkaas.
- **`!autoreply add <erey> | <jawaab>`** — Sameyso jawaabo degdeg ah oo toos ah adoon AI isticmaalin.
- **`!autoreply list`** — Eeg liiska dhammaan jawaabaha tooska ah ee kaydsan.
- **`!autoreply delete <erey>`** — Tirtir jawaab toos ah.

### 3. Group Management (100% Control)
- **`!tagall [fariin]` / `!dhammaan`** — Hal mar wada tag-garee dhammaan xubnaha kooxda.
- **`!kick @user` / `!ka-saar`** — Qofka ka saar kooxda.
- **`!add <lambar>` / `!soo-geli`** — Qofka ku dar kooxda.
- **`!promote @user` / `!dalacsii`** — Qofka ka dhig Admin kooxda.
- **`!demote @user` / `!hoos-u-dhig`** — Qofka maamulnimada ka qaad.
- **`!mute` / `!xidh`** — Xidh kooxda (Admins oo kaliya ayaa qori kara).
- **`!unmute` / `!fur`** — Fur kooxda (Dhammaan xubnuhu way qori karaan).
- **`!link` / `!grouplink`** — Soo qaad link-ga kooxda lagu soo galo.
- **`!groupinfo`** — Soo bandhig faahfaahinta kooxda.

### 4. Profile & Message Tools
- **`!setname <magac>`** — Beddel magaca WhatsApp-ka ee bot-ka.
- **`!setbio <qoraal>`** — Beddel WhatsApp Bio / About.
- **`!setpp`** (sawir la socdo) — Beddel sawirka profile-ka bot-ka.
- **`!block <lambar>`** — Block garee qof.
- **`!unblock <lambar>`** — Unblock ka qaad qof.
- **`!delete` / `!tirtir`** (quote fariin) — Delete for everyone ku samee fariintaas.
- **`!react <emoji>`** (quote fariin) — Emoji ku dhufo fariintaas.
- **`!pin`** (quote fariin) — Pin garee fariintaas.
- **`!maamul`** — Soo bandhig dhammaan amarrada maamulka WhatsApp-ka.

---

## 🛠️ Admin CLI

View live database statistics, active student counts, token usage, and system health:
```powershell
npm run admin stats
```

Purge old conversation records:
```powershell
npm run admin purge 30
```

---

## 📖 Complete Documentation Guides

- [INSTALLATION.md](file:///c:/Users/mohamed/Desktop/BOT/INSTALLATION.md) — Step-by-step setup guide for Windows beginners.
- [DEPLOYMENT.md](file:///c:/Users/mohamed/Desktop/BOT/DEPLOYMENT.md) — Free-tier cloud hosting evaluation (Render, Railway, Fly.io, Oracle Free).
- [SECURITY.md](file:///c:/Users/mohamed/Desktop/BOT/SECURITY.md) — Student privacy, prompt injection mitigation, and API key protection.
- [TEST_REPORT.md](file:///c:/Users/mohamed/Desktop/BOT/TEST_REPORT.md) — Comprehensive execution logs for all 31 automated tests.
- [TROUBLESHOOTING.md](file:///c:/Users/mohamed/Desktop/BOT/TROUBLESHOOTING.md) — Common errors, WhatsApp disconnections, and remedies.

