import crypto from 'crypto';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { IStudentMemory, VerifiedReceiptRecord } from '../memory/memory.interface.js';

export type ReceiptImageKind = 'PAYMENT_RECEIPT' | 'PRODUCT_OR_OTHER_IMAGE' | 'SUSPICIOUS_OR_UNREADABLE';
export type ReceiptTxType = 'SENT_PAYMENT' | 'RECEIVED_PAYMENT' | 'FAILED_OR_PENDING' | 'BALANCE_ONLY' | 'UNKNOWN';
export type ReceiptProvider = 'ZAAD' | 'eDahab' | 'EVC_Plus' | 'Sahal' | 'Premier_Wallet' | 'UNKNOWN';
export type ReceiptCurrency = 'USD' | 'SLSH' | 'SOS' | 'ETB' | 'KES' | 'UNKNOWN';

export interface ParsedReceiptJson {
  image_kind: ReceiptImageKind;
  is_valid_receipt: boolean;
  transaction_type: ReceiptTxType;
  provider: ReceiptProvider;
  tix: string | null;
  amount: number | null;
  currency: ReceiptCurrency;
  receiver_name: string | null;
  receiver_account: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  transaction_date_text: string | null;
  fraud_flags: string[];
  rejection_reason: string | null;
}

export interface MerchantReceivers {
  names: string[];
  accounts: string[];
}

export interface ReceiptVerificationOutcome {
  classification: 'non_receipt' | 'verified' | 'rejected';
  parsed?: ParsedReceiptJson;
  normalizedTix: string;
  imageHash: string;
  fraudCode?: string;
  rejectionReasonSomali?: string;
  advisorGuidanceBlock?: string;
}

const GENERIC_MERCHANT_WORDS = new Set([
  'store',
  'shop',
  'dukaan',
  'company',
  'ltd',
  'llc',
  'enterprise',
  'enterprises',
  'trading',
  'group',
  'service',
  'services',
  'berbera',
  'hargeysa',
  'hargeisa',
  'burco',
  'burao',
  'muqdisho',
  'mogadishu',
  'boosaaso',
  'bosaso',
  'garowe',
  'garoowe',
  'borama',
  'boorama',
  'laascaanood',
  'somaliland',
  'somalia',
  'zaad',
  'edahab',
  'sahal',
  'evc',
  'merchant',
  'account',
  'center',
  'centre',
  'academy',
  'institute',
  'school',
  'machad',
  'dugsi',
]);

const CRITICAL_FRAUD_FLAG_PATTERN =
  /(?:EDIT|PHOTOSHOP|PATCH|FONT|TAMPER|FORGED|FAKE|CROPPED|MISSING_TIX|MISSING_RECEIVER|BLURRY|UNREADABLE|WRONG_DIRECTION|RECEIVED_NOT_SENT|FAILED|PENDING|CANCELLED|BALANCE_ONLY)/i;

export function computeImageSha256(base64Data: string): string {
  try {
    return crypto.createHash('sha256').update(Buffer.from(base64Data || '', 'base64')).digest('hex');
  } catch {
    return crypto.createHash('sha256').update(String(base64Data || '')).digest('hex');
  }
}

export function normalizeTix(rawTix: string | null | undefined): string {
  const cleaned = String(rawTix || '')
    .trim()
    .replace(/^(?:tix|ref|trx|id|no|num|#)[:.\s#-]*/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return cleaned.length >= 4 ? cleaned : '';
}

function normalizeTextTokens(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAccountDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

/**
 * Dynamically extracts allowed merchant names, merchant codes (e.g. 69497),
 * and payment phone numbers (ZAAD/eDahab/Sahal/EVC) from the store's config & knowledge base.
 */
export function extractMerchantReceivers(
  businessName: string = '',
  knowledgeBase: string = '',
  systemRole: string = ''
): MerchantReceivers {
  const nameSet = new Set<string>();
  const accountSet = new Set<string>();

  if (businessName.trim().length >= 2) {
    nameSet.add(businessName.trim());
  }

  const combined = `${businessName}\n${systemRole}\n${knowledgeBase}`;
  for (const line of combined.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Extract explicit Magaca / Merchant labels
    const nameLabelMatch = trimmed.match(
      /(?:magaca(?:\s+meheradda|\s+dukaanka)?|merchant(?:\s+name)?|receiver|zaad|edahab|e-dahab|sahal|evc(?:\s*plus)?|premier)\s*[:=\-]\s*([A-Za-z0-9\s&'._-]{3,50})/i
    );
    if (nameLabelMatch) {
      const candidate = nameLabelMatch[1]
        .replace(/\b(?:0?\d{5,12})\b/g, '')
        .replace(/[,/;|()].*$/, '')
        .trim();
      if (candidate.length >= 3 && !/^\d+$/.test(candidate)) {
        nameSet.add(candidate);
      }
    }

    // Extract merchant names in parentheses on payment lines: e.g. "0634123456 (ASKAR STORE BERBERA)"
    if (/(?:zaad|edahab|e-dahab|sahal|evc|merchant|lacag|payment|dir)/i.test(trimmed)) {
      const parenMatches = trimmed.matchAll(/\(([^()]{3,50})\)/g);
      for (const m of parenMatches) {
        const inner = m[1].trim();
        if (inner.length >= 3 && !/^\$?\d/.test(inner)) {
          nameSet.add(inner);
        }
      }
    }

    // Extract phone numbers or merchant IDs on payment/merchant lines (e.g., 69497, 0634123456, 252634123456)
    if (/(?:zaad|edahab|e-dahab|sahal|evc|merchant|code|tix|lacag|payment|xiriir|contact|tel)/i.test(trimmed)) {
      const numMatches = trimmed.matchAll(/(?:\+?252|0)?\d{5,12}/g);
      for (const m of numMatches) {
        const digits = normalizeAccountDigits(m[0]);
        if (digits.length >= 4 && digits.length <= 15) {
          accountSet.add(digits);
        }
      }
    }
  }

  return {
    names: Array.from(nameSet).filter((n) => n.trim().length >= 2),
    accounts: Array.from(accountSet),
  };
}

export function matchesAllowedReceiver(
  receiverName: string | null | undefined,
  receiverAccount: string | null | undefined,
  receivers: MerchantReceivers
): boolean {
  const normRxAccount = normalizeAccountDigits(receiverAccount || '');
  const normRxName = normalizeTextTokens(receiverName || '');

  // Check digit match against stored merchant codes / phones (handles "69497", "0634...", "252634...")
  if (normRxAccount.length >= 4 && receivers.accounts.length > 0) {
    for (const acc of receivers.accounts) {
      if (acc.length <= 7) {
        if (normRxAccount === acc || normRxAccount.endsWith(acc)) return true;
      } else {
        const tailA = acc.slice(-9);
        const tailB = normRxAccount.slice(-9);
        if (tailA.length >= 7 && (tailA === tailB || tailA.endsWith(tailB) || tailB.endsWith(tailA))) {
          return true;
        }
      }
    }
  }

  // Also check if an allowed merchant code appears directly inside receiverName (e.g., "69497 ASKAR STORE")
  if (normRxName && receivers.accounts.length > 0) {
    for (const acc of receivers.accounts) {
      if (acc.length >= 4 && normRxName.includes(acc)) {
        return true;
      }
    }
  }

  // Check normalized store/merchant name overlap using distinctive brand tokens (prevents "ALI STORE" matching "ASKAR STORE")
  if (normRxName && receivers.names.length > 0) {
    for (const allowedName of receivers.names) {
      const normAllowed = normalizeTextTokens(allowedName);
      if (!normAllowed) continue;
      if (normRxName === normAllowed || normRxName.includes(normAllowed) || normAllowed.includes(normRxName)) {
        return true;
      }
      const allowedBrandTokens = normAllowed
        .split(' ')
        .filter((w) => w.length >= 3 && !GENERIC_MERCHANT_WORDS.has(w));
      const rxTokens = new Set(normRxName.split(' ').filter((w) => w.length >= 2));
      if (
        allowedBrandTokens.length > 0 &&
        allowedBrandTokens.every((tok) => rxTokens.has(tok) || normRxName.includes(tok))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Builds the hardened, fraud-resistant Receipt Verification Parser prompt
 * tailored dynamically to ANY configured store (e.g. ASKAR STORE / 69497 / etc.).
 */
export function buildStrictReceiptParserPrompt(
  businessName: string = 'this business',
  knowledgeBase: string = '',
  systemRole: string = ''
): string {
  const receivers = extractMerchantReceivers(businessName, knowledgeBase, systemRole);
  const storeLabel = businessName.trim() || receivers.names[0] || 'this store';
  const expectedNames = receivers.names.length > 0 ? receivers.names.map((n) => `"${n}"`).join(', ') : `"${storeLabel}"`;
  const expectedAccounts = receivers.accounts.length > 0 ? receivers.accounts.map((a) => `"${a}"`).join(', ') : 'as listed in store details';

  return `You are a strict forensic financial receipt verification parser for ${storeLabel} (Somalia / Somaliland mobile money payments).
Your ONLY job is to inspect the attached image and output a single pure JSON object classifying whether it is a genuine, unaltered payment receipt and extracting its EXACT printed fields.

FIRST CHECK IMAGE TYPE:
- If the image is a normal photo of a product (clothes, shoes, electronics, food), a person/selfie, an ID card, or general question screenshot (NOT a mobile-money / bank payment transfer confirmation), set:
  "image_kind": "PRODUCT_OR_OTHER_IMAGE", "is_valid_receipt": false, and set payment fields to null/"UNKNOWN".

STRICT ANTI-FRAUD RULES FOR PAYMENT SCREENSHOTS (ZAAD, eDahab, EVC Plus, Sahal, Premier Wallet, Waafi):
1. NEVER guess or infer ANY number, currency, name, or ID from context. Extract ONLY exact characters/digits visibly printed inside the screenshot pixels.
2. CURRENCY DISTINCTION (CRITICAL — SCAM PREVENTION):
   - "SLSH", "Sl.Sh", "Shilling", "Sh.So", or "SOS" is Shillings, NEVER USD!
     Example: "SLSH1,000" / "SLSH 1,000" / "1,000 Sl.Sh" => "amount": 1000, "currency": "SLSH" (NOT USD!).
   - "$", "USD", or "Dollar" => "currency": "USD" (e.g., "$12.00" => "amount": 12, "currency": "USD").
   - Watch for thousands commas/dots ("SLSH 50,000" or "SLSH 50.000" = 50000 SLSH). Never conflate Shillings with US Dollars!
3. DIRECTION & STATUS CHECK (SENT vs RECEIVED / FAILED / BALANCE):
   - Confirm the screenshot is an actual COMPLETED OUTGOING payment sent by the customer ("Waad u dirtay", "You have sent", "Sent to", "Paid to", "Success", "Mahadsanid").
   - If it shows money RECEIVED BY the customer ("Waad ka heshay", "Received from"), an account balance check ("Haraagaagu waa"), or a FAILED / PENDING / CANCELLED / INSUFFICIENT BALANCE screen, set "transaction_type" accordingly, set "is_valid_receipt": false, and add the flag to "fraud_flags".
4. VERIFY EXACT RECEIVER (DO NOT CONFUSE SENDER OR MEMO FOR RECEIVER):
   - Expected store receiver names: ${expectedNames}
   - Expected store merchant codes / phones: ${expectedAccounts}
   - Extract the actual recipient into "receiver_name" and "receiver_account". If someone wrote the store's name only inside a personal note/comment while sending money to a different receiver/phone, set "is_valid_receipt": false and flag "WRONG_RECEIVER".
5. EXTRACT TRANSACTION ID & DATE:
   - Extract exact Transaction ID ("Tix:", "Ref:", "Trx ID", etc.) into "tix". If missing or cropped out, set "is_valid_receipt": false and add "MISSING_TIX" to "fraud_flags".
   - Extract exact visible timestamp/date string into "transaction_date_text" (or null if hidden).
6. FORGERY, CROP & TAMPER DETECTION:
   - Inspect carefully for signs of image manipulation: mismatched font size/sharpness/color on amount/receiver/Tix, solid painted rectangle patches over old text, missing status bar/cropped borders hiding the Tix or receiver, blurry/unreadable digits, or fake plain WhatsApp text pretending to be an SMS screenshot.
   - If blurry, unreadable, incomplete/cropped, or edited suspiciously, set "is_valid_receipt": false, add clear codes to "fraud_flags" (e.g., "EDITED_OR_PATCHED", "FONT_MISMATCH", "CROPPED_HEADER_OR_TIX", "BLURRY_UNREADABLE"), and explain clearly in "rejection_reason".
7. Return ONLY valid JSON. No markdown, no \`\`\`json fences, no extra text before or after the JSON object.

EXACT JSON SCHEMA:
{
  "image_kind": "PAYMENT_RECEIPT" | "PRODUCT_OR_OTHER_IMAGE" | "SUSPICIOUS_OR_UNREADABLE",
  "is_valid_receipt": boolean,
  "transaction_type": "SENT_PAYMENT" | "RECEIVED_PAYMENT" | "FAILED_OR_PENDING" | "BALANCE_ONLY" | "UNKNOWN",
  "provider": "ZAAD" | "eDahab" | "EVC_Plus" | "Sahal" | "Premier_Wallet" | "UNKNOWN",
  "tix": string | null,
  "amount": number | null,
  "currency": "USD" | "SLSH" | "SOS" | "ETB" | "KES" | "UNKNOWN",
  "receiver_name": string | null,
  "receiver_account": string | null,
  "sender_name": string | null,
  "sender_phone": string | null,
  "transaction_date_text": string | null,
  "fraud_flags": string[],
  "rejection_reason": string | null
}`;
}

function parseSafeAmount(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.,]/g, '').trim();
    if (!cleaned) return null;
    // Handle comma thousands (e.g., "1,000" or "12,500.00") vs decimal comma
    const noThousands =
      /,\d{3}(?:\.\d+)?$/.test(cleaned) || /,\d{3},\d{3}/.test(cleaned)
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(',', '.');
    const num = Number(noThousands);
    return Number.isFinite(num) && num > 0 ? num : null;
  }
  return null;
}

function normalizeCurrency(raw: unknown): ReceiptCurrency {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return 'UNKNOWN';
  if (s.includes('SLSH') || s.includes('SL.SH') || s.includes('SOMALILAND SHILLING')) return 'SLSH';
  if (s === 'SOS' || s.includes('SH.SO') || s.includes('SO.SH') || s === 'SHILLING' || s === 'SHILLINGS') {
    return s.includes('SL') ? 'SLSH' : 'SOS';
  }
  if (s === 'USD' || s === '$' || s.includes('DOLLAR')) return 'USD';
  if (s === 'ETB' || s.includes('BIRR')) return 'ETB';
  if (s === 'KES' || s.includes('KSH')) return 'KES';
  return 'UNKNOWN';
}

function extractFirstJsonObject(rawText: string): Record<string, any> | null {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;

  // Strip optional markdown code fences defensively
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const obj = JSON.parse(withoutFences);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch {}

  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const sliced = JSON.parse(withoutFences.slice(start, end + 1));
      if (sliced && typeof sliced === 'object' && !Array.isArray(sliced)) return sliced;
    } catch {}
  }

  return null;
}

export function parseReceiptJsonResponse(rawText: string): ParsedReceiptJson | null {
  const obj = extractFirstJsonObject(rawText);
  if (!obj) return null;

  const rawKind = String(obj.image_kind || '').toUpperCase();
  const image_kind: ReceiptImageKind =
    rawKind === 'PRODUCT_OR_OTHER_IMAGE'
      ? 'PRODUCT_OR_OTHER_IMAGE'
      : rawKind === 'SUSPICIOUS_OR_UNREADABLE'
      ? 'SUSPICIOUS_OR_UNREADABLE'
      : 'PAYMENT_RECEIPT';

  const rawTx = String(obj.transaction_type || '').toUpperCase();
  const transaction_type: ReceiptTxType =
    rawTx === 'SENT_PAYMENT'
      ? 'SENT_PAYMENT'
      : rawTx === 'RECEIVED_PAYMENT'
      ? 'RECEIVED_PAYMENT'
      : rawTx === 'FAILED_OR_PENDING'
      ? 'FAILED_OR_PENDING'
      : rawTx === 'BALANCE_ONLY'
      ? 'BALANCE_ONLY'
      : 'UNKNOWN';

  const rawProvider = String(obj.provider || '').trim();
  let provider: ReceiptProvider = 'UNKNOWN';
  if (/zaad/i.test(rawProvider)) provider = 'ZAAD';
  else if (/edahab|e-dahab/i.test(rawProvider)) provider = 'eDahab';
  else if (/evc/i.test(rawProvider)) provider = 'EVC_Plus';
  else if (/sahal/i.test(rawProvider)) provider = 'Sahal';
  else if (/premier/i.test(rawProvider)) provider = 'Premier_Wallet';

  return {
    image_kind,
    is_valid_receipt: Boolean(obj.is_valid_receipt),
    transaction_type,
    provider,
    tix: obj.tix ? String(obj.tix).trim() : null,
    amount: parseSafeAmount(obj.amount),
    currency: normalizeCurrency(obj.currency),
    receiver_name: obj.receiver_name ? String(obj.receiver_name).trim() : null,
    receiver_account: obj.receiver_account ? String(obj.receiver_account).trim() : null,
    sender_name: obj.sender_name ? String(obj.sender_name).trim() : null,
    sender_phone: obj.sender_phone ? String(obj.sender_phone).trim() : null,
    transaction_date_text: obj.transaction_date_text ? String(obj.transaction_date_text).trim() : null,
    fraud_flags: Array.isArray(obj.fraud_flags)
      ? obj.fraud_flags.map((f: any) => String(f || '').trim()).filter(Boolean)
      : [],
    rejection_reason: obj.rejection_reason ? String(obj.rejection_reason).trim() : null,
  };
}

/**
 * Performs strict deterministic TypeScript verification on the isolated AI extraction
 * + checks SQLite for duplicate Tix/Ref and duplicate Screenshot image hashes.
 */
export function verifyReceiptDeterministically(
  parsed: ParsedReceiptJson,
  receivers: MerchantReceivers,
  existingByTix: VerifiedReceiptRecord | null,
  existingByHash: VerifiedReceiptRecord | null,
  imageHash: string
): ReceiptVerificationOutcome {
  const normalizedTix = normalizeTix(parsed.tix);

  if (parsed.image_kind === 'PRODUCT_OR_OTHER_IMAGE') {
    return {
      classification: 'non_receipt',
      parsed,
      normalizedTix,
      imageHash,
    };
  }

  if (existingByHash && existingByHash.status === 'verified') {
    return {
      classification: 'rejected',
      parsed,
      normalizedTix,
      imageHash,
      fraudCode: 'DUPLICATE_SCREENSHOT',
      rejectionReasonSomali: `Sawirkan rasiidka ah (Tix: ${existingByHash.tix || 'hore'}) horay ayaa loogu soo diray dalab kale. Fadlan soo dir sawir rasiid cusub ah.`,
      advisorGuidanceBlock: buildRejectedGuidanceBlock('DUPLICATE_SCREENSHOT', parsed, 'Sawirkan rasiidka ah mar hore ayaa la isticmaalay (Replay Fraud).'),
    };
  }

  if (parsed.image_kind === 'SUSPICIOUS_OR_UNREADABLE') {
    const reason = parsed.rejection_reason || 'Sawirku ma cadda ama waxaa laga shakiyay in wax laga beddelay.';
    return {
      classification: 'rejected',
      parsed,
      normalizedTix,
      imageHash,
      fraudCode: 'SUSPICIOUS_OR_UNREADABLE',
      rejectionReasonSomali: reason,
      advisorGuidanceBlock: buildRejectedGuidanceBlock('SUSPICIOUS_OR_UNREADABLE', parsed, reason),
    };
  }

  const criticalFlag = parsed.fraud_flags.find((f) => CRITICAL_FRAUD_FLAG_PATTERN.test(f));
  if (criticalFlag) {
    const reason = parsed.rejection_reason || `Rasiidka waxaa lagu arkay calaamad shaki ah (${criticalFlag}).`;
    return {
      classification: 'rejected',
      parsed,
      normalizedTix,
      imageHash,
      fraudCode: criticalFlag,
      rejectionReasonSomali: reason,
      advisorGuidanceBlock: buildRejectedGuidanceBlock(criticalFlag, parsed, reason),
    };
  }

  if (parsed.transaction_type !== 'SENT_PAYMENT') {
    const reason =
      parsed.transaction_type === 'RECEIVED_PAYMENT'
        ? 'Rasiidkani wuxuu muujinayaa lacag adiga laguu soo diray, maaha lacag aad adigu soo dirtay.'
        : parsed.transaction_type === 'FAILED_OR_PENDING'
        ? 'Lacag-bixintani weli ma dhammaystirmin ama way fashilantay (Failed/Pending).'
        : 'Sawirkani maaha caddeyn lacag-diris dhammaystiran ah.';
    return {
      classification: 'rejected',
      parsed,
      normalizedTix,
      imageHash,
      fraudCode: `INVALID_TX_TYPE_${parsed.transaction_type}`,
      rejectionReasonSomali: reason,
      advisorGuidanceBlock: buildRejectedGuidanceBlock('INVALID_TX_TYPE', parsed, reason),
    };
  }

  if (!parsed.is_valid_receipt) {
    const reason = parsed.rejection_reason || 'Rasiidku ma buuxin shuruudaha xaqiijinta.';
    return {
      classification: 'rejected',
      parsed,
      normalizedTix,
      imageHash,
      fraudCode: 'AI_INVALID_RECEIPT',
      rejectionReasonSomali: reason,
      advisorGuidanceBlock: buildRejectedGuidanceBlock('AI_INVALID_RECEIPT', parsed, reason),
    };
  }

  if (!normalizedTix) {
    const reason = 'Rasiidka lagama helin lambarka caddeynta (Tix / Ref ID). Fadlan soo dir sawirka oo dhammaystiran oo muujinaya Tix-ka.';
    return {
      classification: 'rejected',
      parsed,
      normalizedTix: '',
      imageHash,
      fraudCode: 'MISSING_TIX',
      rejectionReasonSomali: reason,
      advisorGuidanceBlock: buildRejectedGuidanceBlock('MISSING_TIX', parsed, reason),
    };
  }

  if (existingByTix) {
    const reason = `Lambarka rasiidka (Tix/Ref: ${parsed.tix || normalizedTix}) horay ayaa loogu diiwaangeliyay dalab kale — laba jeer lama isticmaali karo hal rasiid.`;
    return {
      classification: 'rejected',
      parsed,
      normalizedTix,
      imageHash,
      fraudCode: 'DUPLICATE_TIX',
      rejectionReasonSomali: reason,
      advisorGuidanceBlock: buildRejectedGuidanceBlock('DUPLICATE_TIX', parsed, reason),
    };
  }

  if (parsed.amount === null || parsed.amount <= 0 || parsed.currency === 'UNKNOWN') {
    const reason = 'Cadadka lacagta ama nooca lacagta (USD / SLSH) si cad ugama muuqdo rasiidka.';
    return {
      classification: 'rejected',
      parsed,
      normalizedTix,
      imageHash,
      fraudCode: 'INVALID_AMOUNT_OR_CURRENCY',
      rejectionReasonSomali: reason,
      advisorGuidanceBlock: buildRejectedGuidanceBlock('INVALID_AMOUNT_OR_CURRENCY', parsed, reason),
    };
  }

  const hasReceiverConfigured = receivers.names.length > 0 || receivers.accounts.length > 0;
  if (hasReceiverConfigured) {
    if (!parsed.receiver_name && !parsed.receiver_account) {
      const reason = 'Magaca ama lambarka cidda lacagta loo diray kama muuqdo sawirka (lama xaqiijin karo inuu akoonka saxda ah galay).';
      return {
        classification: 'rejected',
        parsed,
        normalizedTix,
        imageHash,
        fraudCode: 'MISSING_RECEIVER',
        rejectionReasonSomali: reason,
        advisorGuidanceBlock: buildRejectedGuidanceBlock('MISSING_RECEIVER', parsed, reason),
      };
    }

    if (!matchesAllowedReceiver(parsed.receiver_name, parsed.receiver_account, receivers)) {
      const shown = [parsed.receiver_name, parsed.receiver_account].filter(Boolean).join(' / ');
      const reason = `Lacagtan waxaa loo diray "${shown}", maaha magaca ama lambarka rasmiga ah ee meheraddan.`;
      return {
        classification: 'rejected',
        parsed,
        normalizedTix,
        imageHash,
        fraudCode: 'WRONG_RECEIVER',
        rejectionReasonSomali: reason,
        advisorGuidanceBlock: buildRejectedGuidanceBlock('WRONG_RECEIVER', parsed, reason),
      };
    }
  }

  // All anti-fraud checks passed! Build immutable verified summary block (with strict SLSH vs USD warning)
  const currencyNote =
    parsed.currency === 'SLSH' || parsed.currency === 'SOS'
      ? `CRITICAL CURRENCY WARNING: This payment is in ${parsed.currency} (${parsed.amount.toLocaleString('en-US')} ${parsed.currency} Shillings), NOT US Dollars ($)! NEVER count ${parsed.amount} ${parsed.currency} as $${parsed.amount} USD! Check if this Shilling amount genuinely matches the item's price before confirming full payment.`
      : `Currency confirmed as ${parsed.currency} (${parsed.amount} ${parsed.currency}). Verify against the customer's ordered item price in the catalog before confirming if fully paid or partial deposit.`;

  return {
    classification: 'verified',
    parsed,
    normalizedTix,
    imageHash,
    advisorGuidanceBlock: `[OFFICIAL RECEIPT VERIFICATION RESULT — AUTHENTICATED]:
- Status: VALID_RECEIPT_STRUCTURE (Tix is unique, receiver verified, not duplicated)
- Provider: ${parsed.provider}
- Tix / Ref ID: ${parsed.tix}
- Exact Printed Amount: ${parsed.amount} ${parsed.currency}
- Receiver Shown: ${[parsed.receiver_name, parsed.receiver_account].filter(Boolean).join(' / ')}
${parsed.transaction_date_text ? `- Receipt Date/Time: ${parsed.transaction_date_text}\n` : ''}- ${currencyNote}
- INSTRUCTION: State the EXACT verified amount ("${parsed.amount} ${parsed.currency}") and Tix ("${parsed.tix}") warmly. If "${parsed.amount} ${parsed.currency}" is LESS than the product price (for example, SLSH 1,000 when product costs $15 USD!), politely inform them of the exact amount received and the remaining balance — NEVER mark an underpaid Shilling transfer as fully paid! Append hidden lead tag at the very end: <!-- lead: payment_verified | ${parsed.provider} Tix:${parsed.tix} - ${parsed.amount} ${parsed.currency} to ${parsed.receiver_name || parsed.receiver_account} -->`,
  };
}

function buildRejectedGuidanceBlock(
  fraudCode: string,
  parsed: ParsedReceiptJson | undefined,
  reasonSomali: string
): string {
  return `[OFFICIAL RECEIPT VERIFICATION RESULT — REJECTED / DO NOT ACCEPT PAYMENT]:
- Fraud / Rejection Code: ${fraudCode}
- Reason: ${reasonSomali}
${parsed?.tix ? `- Tix Seen: ${parsed.tix}\n` : ''}${parsed?.amount ? `- Amount Seen: ${parsed.amount} ${parsed.currency}\n` : ''}- Receiver Seen: ${parsed ? [parsed.receiver_name, parsed.receiver_account].filter(Boolean).join(' / ') || 'None' : 'None'}
- STRICT SECURITY INSTRUCTION: Do NOT confirm payment and do NOT confirm order dispatch! Politely explain the exact issue above in Somali and ask the customer to send a clear, uncropped, original, unused payment screenshot sent directly to the store's official Zaad/eDahab account.
- Also append a hidden fraud alert lead tag at the end so management sees this attempt in Orders Inbox: <!-- lead: payment_rejected_fraud | [${fraudCode}] ${reasonSomali} -->`;
}

/**
 * Runs isolated zero-history receipt verification on incoming customer images for Business/Education bots.
 */
export async function inspectCustomerImageForPayment(params: {
  ai: AIOrchestrator;
  memory: IStudentMemory;
  media: { mimeType: string; dataBase64: string };
  chatId: string;
  senderPhone: string;
  businessName: string;
  knowledgeBase: string;
  systemRole: string;
}): Promise<ReceiptVerificationOutcome> {
  const { ai, memory, media, chatId, senderPhone, businessName, knowledgeBase, systemRole } = params;
  const imageHash = computeImageSha256(media.dataBase64);

  // 1. Zero-cost duplicate image hash block BEFORE calling Vision AI!
  if (memory.findReceiptByImageHash) {
    const dupHash = await memory.findReceiptByImageHash(imageHash).catch(() => null);
    if (dupHash && dupHash.status === 'verified') {
      const reason = `Sawirkan rasiidka ah (Tix: ${dupHash.tix || 'hore'}) horay ayaa loogu soo diray dalab kale. Fadlan soo dir sawir rasiid cusub ah.`;
      if (memory.recordReceiptVerification) {
        await memory.recordReceiptVerification({
          provider: dupHash.provider,
          tix: dupHash.tix,
          normalizedTix: dupHash.normalizedTix,
          imageHash,
          amount: dupHash.amount,
          currency: dupHash.currency,
          receiverName: dupHash.receiverName,
          receiverAccount: dupHash.receiverAccount,
          chatId,
          senderPhone,
          status: 'rejected',
          rejectionReason: `DUPLICATE_SCREENSHOT: ${reason}`,
        });
      }
      return {
        classification: 'rejected',
        normalizedTix: dupHash.normalizedTix,
        imageHash,
        fraudCode: 'DUPLICATE_SCREENSHOT',
        rejectionReasonSomali: reason,
        advisorGuidanceBlock: buildRejectedGuidanceBlock('DUPLICATE_SCREENSHOT', undefined, reason),
      };
    }
  }

  // 2. Skip if AI provider is offline
  const primaryAvail =
    typeof (ai as any).getPrimaryProvider === 'function' ? Boolean(ai.getPrimaryProvider()?.isAvailable) : true;
  const fallbackAvail =
    typeof (ai as any).getFallbackProvider === 'function' ? Boolean(ai.getFallbackProvider()?.isAvailable) : false;
  if (!primaryAvail && !fallbackAvail) {
    return {
      classification: 'non_receipt',
      normalizedTix: '',
      imageHash,
    };
  }

  // 3. Isolated ZERO-HISTORY Vision Extraction call (temperature = 0, JSON mode)
  const parserPrompt = buildStrictReceiptParserPrompt(businessName, knowledgeBase, systemRole);
  const extractResult = await ai.generateResponse(
    'Inspect the attached image strictly under the system parser rules and return pure JSON only.',
    [], // CRITICAL: ZERO chat history prevents amount/context hallucination!
    {
      systemInstruction: parserPrompt,
      temperature: 0,
      maxOutputTokens: 500,
      responseMimeType: 'application/json',
      media: { mimeType: media.mimeType, dataBase64: media.dataBase64 },
    }
  );

  // If JSON didn't parse (e.g. non-JSON offline mock response), treat cleanly as normal visual image
  const parsed = parseReceiptJsonResponse(extractResult.text);
  if (!parsed) {
    return {
      classification: 'non_receipt',
      normalizedTix: '',
      imageHash,
    };
  }

  if (parsed.image_kind === 'PRODUCT_OR_OTHER_IMAGE') {
    return {
      classification: 'non_receipt',
      parsed,
      normalizedTix: '',
      imageHash,
    };
  }

  // 4. Deterministic validation + SQLite Tix replay check
  const receivers = extractMerchantReceivers(businessName, knowledgeBase, systemRole);
  const normalizedTix = normalizeTix(parsed.tix);
  const existingByTix =
    normalizedTix && memory.findReceiptByTix
      ? await memory.findReceiptByTix(normalizedTix).catch(() => null)
      : null;

  const outcome = verifyReceiptDeterministically(parsed, receivers, existingByTix, null, imageHash);

  // 5. Persist verification log (both verified Tix locks & rejected fraud logs)
  if (memory.recordReceiptVerification && (outcome.classification === 'verified' || outcome.classification === 'rejected')) {
    await memory.recordReceiptVerification({
      provider: parsed.provider,
      tix: parsed.tix || '',
      normalizedTix,
      imageHash,
      amount: parsed.amount,
      currency: parsed.currency,
      receiverName: parsed.receiver_name || '',
      receiverAccount: parsed.receiver_account || '',
      chatId,
      senderPhone,
      status: outcome.classification === 'verified' ? 'verified' : 'rejected',
      rejectionReason: outcome.rejectionReasonSomali || '',
    });
  }

  return outcome;
}
