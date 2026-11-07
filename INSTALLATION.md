# ABARSO AI — Local Installation & Setup Guide (Windows)

This guide takes you step-by-step through setting up, configuring, and testing **ABARSO AI** on a Windows laptop.

---

## 1. System Requirements

- **Operating System:** Windows 10 or Windows 11 (64-bit)
- **Node.js:** Version 22.0 or newer (Run `node -v` in PowerShell to check)
- **Editor:** Visual Studio Code (recommended)
- **Google Account:** Free Google AI Studio account to obtain your API key

---

## 2. Step-by-Step Installation

### Step 1: Open Terminal in Project Folder
1. Open Visual Studio Code.
2. Select **File > Open Folder...** and choose `c:\Users\mohamed\Desktop\BOT`.
3. Open the Integrated Terminal by pressing ``Ctrl + ` `` (Backtick) or selecting **Terminal > New Terminal**.

### Step 2: Install Dependencies
The project dependencies are already installed. If you ever need to reinstall or move to another machine, simply run:
```powershell
npm install
```
*(Node 22 comes with built-in SQLite, so no Visual Studio C++ compilers or Python builds are needed on Windows!)*

### Step 3: Get Your Free Google Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/) in your browser.
2. Sign in with your Google account.
3. Click **Get API key** in the top navigation.
4. Click **Create API key in new project** and copy your generated key string.
   > **Note:** The free tier provides ~1,500 requests per day at zero cost. Never enter billing details or credit cards if you only want the 100% free tier.

### Step 4: Configure Your `.env` File
In your VS Code terminal, create your local configuration by copying `.env.example`:
```powershell
copy .env.example .env
```
Now open `.env` and configure your settings:
```ini
# Paste your Gemini API key here:
GEMINI_API_KEY=AIzaSyD...your_actual_key_here

# Recommended fastest free Flash model:
GEMINI_MODEL=gemini-2.0-flash

# Safe daily limit to prevent quota exhaustion:
DAILY_REQUEST_LIMIT=1400

# Choose your messaging transport:
# Options: 'console' (for local testing), 'baileys' (WhatsApp Web), 'webhook' (Meta Cloud API)
MESSAGING_MODE=console

# Your WhatsApp phone number for admin commands (e.g., 252610000000):
ADMIN_PHONE_NUMBERS=252610000000
```

---

## 3. Running & Verifying ABARSO AI

### Mode A: Interactive Console Simulator (Recommended for Testing)
To test all conversations, language switching, homework logic, and coding assistance locally without needing WhatsApp:
```powershell
npm run sim
```
Or start the main application with `MESSAGING_MODE=console` in `.env`:
```powershell
npm start
```
You can immediately type student questions:
- *"Asc sxb i caawi sideen Python u bartaa?"*
- *"Sideen React useState ugu shaqeeyaa?"*
- *"How do I prepare a revision schedule for exams?"*
- *"!tirtir"* (Test privacy deletion)

### Mode B: WhatsApp Multi-Device (Baileys)
To connect your existing WhatsApp account to an existing student group:
1. In your `.env` file, change:
   ```ini
   MESSAGING_MODE=baileys
   GROUP_RESPONSE_MODE=mention_only
   ```
2. Start the bot:
   ```powershell
   npm start
   ```
3. A QR code will appear in your terminal.
4. Open WhatsApp on your phone:
   - Tap **Settings** (or 3 dots on Android) > **Linked Devices**.
   - Tap **Link a Device** and scan the terminal QR code.
5. In your WhatsApp group, tag the bot:
   - `@Abarso sideen loop ugu qoraa Python?`
   - Or send `!abarso help`

### Mode C: Run Admin Diagnostics
To view system statistics, token counts, and student memory size:
```powershell
npm run admin stats
```

---

## 4. Running the Automated Test Suite
To verify that all 31 system tests pass cleanly:
```powershell
npm test
```
Every component (Quota tracker, Retry backoff, Somali detector, SQLite memory, Privacy isolation, Router) will be verified in under 5 seconds.

