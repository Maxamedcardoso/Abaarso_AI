import fs from 'fs';
import path from 'path';

const credsPath = path.join(process.cwd(), 'baileys_auth_info', 'creds.json');

if (!fs.existsSync(credsPath)) {
  console.error('❌ Khalad: Faylka baileys_auth_info/creds.json lama helin!');
  console.error('Fadlan marka hore bot-ka ku kici kombuyuutarkaaga oo scan-garee QR code-ka.');
  process.exit(1);
}

const credsJson = fs.readFileSync(credsPath, 'utf8');
const base64Creds = Buffer.from(credsJson, 'utf8').toString('base64');

console.log('\n========================================================================');
console.log('   🎉 RENDER.COM SESSION CREDENTIALS READY (KOOBI GAREE XOGTAN):        ');
console.log('========================================================================\n');
console.log('Gudaha Render.com > Dashboard > Your Service > Environment Variables:\n');
console.log('Key:');
console.log('SESSION_CREDS_BASE64\n');
console.log('Value (Koobi garee khadka hoose oo dhan):');
console.log(base64Creds);
console.log('\n========================================================================\n');

