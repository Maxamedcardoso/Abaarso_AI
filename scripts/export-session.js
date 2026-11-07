import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const authDir = path.join(process.cwd(), 'baileys_auth_info');
const credsPath = path.join(authDir, 'creds.json');

if (!fs.existsSync(credsPath)) {
  console.error('❌ Khalad: Faylka baileys_auth_info/creds.json lama helin!');
  console.error('Fadlan marka hore bot-ka ku kici kombuyuutarkaaga oo scan-garee QR code-ka.');
  process.exit(1);
}

// 1. Pack all auth keys (creds, pre-keys, sender-keys, session keys) excluding huge app-state-sync files
const allFiles = fs.readdirSync(authDir).filter(f => !f.startsWith('app-state-sync'));
const bundle = {};

for (const f of allFiles) {
  bundle[f] = fs.readFileSync(path.join(authDir, f), 'utf8');
}

const jsonStr = JSON.stringify(bundle);
const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));
const bundleBase64 = compressed.toString('base64');

console.log('\n========================================================================');
console.log('   🎉 RENDER.COM COMPLETE SESSION BUNDLE (GUUSHA UGU HUBAN):             ');
console.log('========================================================================\n');
console.log('Gudaha Render.com > Dashboard > abaarso-ai > Environment Variables:\n');
console.log('Key:');
console.log('SESSION_BUNDLE_BASE64\n');
console.log('Value (Koobi garee xogtan hoose oo dhan adigoon waxba ka goyn):');
console.log(bundleBase64);
console.log('\n========================================================================');
console.log(`ℹ️ Bundle-ku wuxuu wataa ${allFiles.length} keys oo dhameystiran (Size: ${bundleBase64.length} bytes).`);
console.log('========================================================================\n');
