# ABARSO AI — Free-Tier Cloud Deployment Guide

This document analyzes suitable free hosting options, explains runtime and networking limitations, and outlines how to host **ABARSO AI** at **zero financial cost**.

---

## 1. Hosting Architecture Reality Check

Before choosing a cloud provider, understand how the two messaging transports behave in the cloud:

| Feature | WhatsApp Multi-Device (Baileys) | Meta Cloud API (Webhook) |
| :--- | :--- | :--- |
| **Connection Type** | Continuous WebSocket connection to WhatsApp servers | Stateless HTTP webhook receiver (`GET/POST /webhook`) |
| **Idle Behavior** | **Must run 24/7 as a background daemon.** If the server goes to sleep, the bot disconnects from WhatsApp. | Can handle wake-on-request HTTP calls. |
| **Storage Need** | Requires persistent disk for `./baileys_auth_info` (session tokens) and `./data/abarso.db`. | Only requires persistent disk for `./data/abarso.db` (or external free PostgreSQL). |
| **Suitable Free Hosts** | VPS or non-sleeping container (e.g. Oracle Always Free VM, Fly.io, or Railway free credit). | Render, Koyeb, Vercel, or Fly.io. |

---

## 2. Evaluation of Popular Free Hosting Providers

### Option 1: Oracle Cloud Infrastructure (OCI) Always Free VM (Recommended for 24/7 WhatsApp)
- **Free Tier Allowance:** 4 ARM Ampere CPU cores, 24 GB RAM, 200 GB persistent block storage — completely free forever.
- **Suitability for ABARSO AI:** **⭐⭐⭐⭐⭐ (Best)**
- **Pros:** True persistent virtual machine. Runs 24/7 without sleeping. Supports continuous WebSocket connections for Baileys. Local SQLite is fully persistent.
- **Cons:** Requires a credit card during signup for identity verification (zero charge incurred).

### Option 2: Render.com (Web Service Free Tier — Zero Credit Card Required!)
- **Free Tier Allowance:** 512 MB RAM, free Web Service.
- **Credit Card Required:** **NO** (Sign up with GitHub or Google).
- **Solved Challenges for WhatsApp Baileys on Render:**
  1. **Anti-Sleep / 24/7 Awake:** Built-in HTTP server on `/health`. With `RENDER_EXTERNAL_URL` or a free UptimeRobot monitor pinging every 10 minutes, Render never goes to sleep!
  2. **Session Persistence:** Solved via `SESSION_CREDS_BASE64` environment variable. Run `npm run export-session` locally and paste into Render. The bot connects immediately on boot without re-scanning QR codes.
- **Suitability for ABARSO AI:** **⭐⭐⭐⭐⭐ (Easiest & Free)**

### Option 3: Fly.io (Hobby Tier)
- **Free Tier Allowance:** Up to 3 shared-cpu-1x VMs, 3 GB persistent storage volumes.
- **Suitability for ABARSO AI:** **⭐⭐⭐⭐ (Very Good)**
- **Pros:** Supports persistent volumes (`fly volumes create`). Can keep a single small instance running 24/7 without automatic sleep if configured with `min_machines_running = 1`.

### Option 4: Koyeb / Railway
- **Railway:** Provides $5 one-time free credit for hobbyists. After the credit is exhausted, the service stops. Excellent developer experience, but not indefinitely free.
- **Koyeb:** Free micro-instance (512MB RAM), but sleeps on inactivity.

---

## 3. Recommended Deployment: Oracle Always Free VM (Step-by-Step)

### Step 1: Launch Ubuntu Instance
1. Create a free account at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
2. Create an **Ampere A1 Compute Instance** (Ubuntu 24.04, 1 OCPU, 6 GB RAM).
3. Connect via SSH from your Windows terminal:
   ```powershell
   ssh -i your_ssh_key.key ubuntu@YOUR_VM_PUBLIC_IP
   ```

### Step 2: Install Node.js 22 LTS & Git
```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Verify version
node -v # Should show v22.x
```

### Step 3: Clone & Install ABARSO AI
```bash
git clone https://github.com/your-username/abarso-ai.git
cd abarso-ai
npm install
```

### Step 4: Configure Production `.env`
```bash
cp .env.example .env
nano .env
```
Fill in:
- `GEMINI_API_KEY`: Your free Gemini API key
- `MESSAGING_MODE=baileys` (or `webhook`)
- `ADMIN_PHONE_NUMBERS=252610000000`
- `DATA_RETENTION_DAYS=30`

### Step 5: Run with PM2 (24/7 Process Manager & Auto-Restart)
```bash
# Install PM2 process supervisor
sudo npm install -g pm2

# Start ABARSO AI
pm2 start npm --name "abarso-ai" -- run start

# Setup auto-start on server reboot
pm2 startup
pm2 save
```

### Step 6: Scan the WhatsApp Pairing QR Code
To view the terminal QR code in PM2 logs:
```bash
pm2 logs abarso-ai --lines 100
```
Scan the QR code with your phone's WhatsApp app. ABARSO AI is now live 24/7!

---

## 4. Zero-Cost Protection Guarantees

ABARSO AI includes built-in protective logic so you never get billed:
1. **Hard Request Cap:** Monitored by `src/ai/quota-tracker.ts`. Outbound calls stop at 1,400 daily requests.
2. **Never Upgrades to Paid:** The code does not contain any logic to enable paid Gemini plans or switch to paid models.
3. **Daily Reset:** Quotas automatically reset each day at `00:00 UTC`.
4. **Honest Reporting:** When limits are reached, the bot informs users that it is in free-tier sleep mode rather than hanging indefinitely.

