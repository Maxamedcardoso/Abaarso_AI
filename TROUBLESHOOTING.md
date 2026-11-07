# ABARSO AI — Troubleshooting & Common Issues Guide

This guide helps you identify, understand, and fix any issue that may arise while developing, testing, or deploying **ABARSO AI**.

---

## 1. Google Gemini AI Issues

### A. "⚠️ Google Gemini API key is missing or invalid"
- **Cause:** `GEMINI_API_KEY` is empty in your `.env` file, or the `.env` file does not exist.
- **Fix:**
  1. Make sure you copied `.env.example` to `.env`.
  2. Open `.env` and verify that `GEMINI_API_KEY=AIzaSy...` is set without any surrounding quotes or spaces.
  3. Ensure you have an active key from [aistudio.google.com](https://aistudio.google.com/).

### B. "⚠️ Rate limit reached on Google AI Studio free tier (HTTP 429)"
- **Cause:** Google AI Studio free tier limits requests to ~15 requests per minute (RPM).
- **Fix:**
  - ABARSO AI automatically performs exponential backoff and retries.
  - If several students in a group spam the bot at once, the per-student rate limiter (`src/pipeline/rate-limiter.ts`) asks the student to wait 10–15 seconds before retrying.

### C. "⚠️ [ABARSO AI Zero-Cost Safeguard]: Daily free quota reached"
- **Cause:** You have reached your configured `DAILY_REQUEST_LIMIT` (default: 1,400 requests/day).
- **Protection:** This is an intentional safeguard to ensure **ZERO accidental charges**.
- **Fix:**
  - Requests will automatically resume at `00:00 UTC` when your free quota resets.
  - To inspect current daily counts, run: `npm run admin stats`.

---

## 2. WhatsApp Multi-Device (Baileys) Issues

### A. Terminal QR Code Is Not Displaying or Is Scrambled
- **Cause:** Your terminal window width is too narrow, causing the QR code ascii characters to wrap.
- **Fix:**
  1. Enlarge or maximize your VS Code terminal window.
  2. Alternatively, view the QR code in Windows Terminal or PowerShell.

### B. "Connection closed (status: 401 / 403 / Logged Out)"
- **Cause:** You unlinked the device from your WhatsApp mobile app, or WhatsApp refreshed the session keys.
- **Fix:**
  1. Stop the bot with `Ctrl + C`.
  2. Delete the session folder:
     ```powershell
     Remove-Item -Recurse -Force baileys_auth_info
     ```
  3. Restart the bot (`npm start`). A fresh QR code will appear for pairing.

### C. Ban Risk Prevention Tips
- **Rule 1:** Use `GROUP_RESPONSE_MODE=mention_only` so the bot only speaks when tagged (`@Abarso`).
- **Rule 2:** Do not add the bot to dozens of unknown public groups.
- **Rule 3:** Never send mass unsolicited broadcast messages.
- **Rule 4:** Keep the built-in 1.5–2.0 second typing delay enabled.

---

## 3. Meta Cloud API (Webhook) Issues

### A. Webhook Verification Failed (HTTP 403)
- **Cause:** The `WEBHOOK_VERIFY_TOKEN` in your `.env` does not match the verification token entered in the Meta App Dashboard.
- **Fix:**
  1. Open `.env` and note the value of `WEBHOOK_VERIFY_TOKEN`.
  2. In Meta App Dashboard > WhatsApp > Configuration > Callback URL:
     - Set the Callback URL to your public HTTPS address (e.g. `https://your-domain.com/webhook`).
     - Set the Verify Token to match the exact string in your `.env`.

### B. Cannot Reach Webhook on Local Windows Laptop
- **Cause:** Meta's servers require a publicly accessible HTTPS endpoint and cannot send webhooks directly to `localhost`.
- **Fix:**
  - Use a free tunnel tool such as **Cloudflare Tunnels** or **ngrok**:
    ```powershell
    ngrok http 3000
    ```
  - Use the generated HTTPS URL as your callback URL in Meta's dashboard.

---

## 4. SQLite Database & Node 22 Warnings

### A. `ExperimentalWarning: SQLite is an experimental feature and might change at any time`
- **Explanation:** This is a standard Node.js informational notice indicating that `node:sqlite` is currently in Node's core experimental module phase.
- **Impact:** **Zero negative impact.** The database is fully functional, supports ACID transactions, and uses SQLite WAL mode for high performance without needing native C++ build tools on Windows.
- **How to Silence:** To silence the warning, you can run Node with `--no-warnings`:
  ```powershell
  node --no-warnings --import tsx src/index.ts
  ```

### B. Database Locked Error (`SQLITE_BUSY`)
- **Cause:** Another process or SQLite viewer has opened `./data/abarso.db` with an exclusive lock.
- **Fix:**
  - Close any external SQLite desktop viewers (e.g. DB Browser for SQLite).
  - ABARSO AI uses `PRAGMA journal_mode = WAL;` which allows concurrent readers while writing safely.

