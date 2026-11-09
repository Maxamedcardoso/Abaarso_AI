import fs from 'fs';
import path from 'path';
import { SQLiteStudentMemory } from '../src/memory/sqlite-memory.js';
import { broadcastService } from '../src/services/broadcast.service.js';

async function main() {
  console.log('\n======================================================');
  console.log('   CARDOSO AI — BULK CONTACTS IMPORTER (2000+ CONTACTS)');
  console.log('======================================================\n');

  const filePath = process.argv[2] || './data/contacts.vcf';

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Cillad: Faylka lagama helin wadada: "${filePath}"`);
    console.log('\nSida loo isticmaalo:');
    console.log('  npx tsx scripts/import-contacts.ts <wadada-faylka-vcf-ama-txt>');
    console.log('Tusaale:');
    console.log('  npx tsx scripts/import-contacts.ts C:\\Users\\mohamed\\Downloads\\contacts.vcf\n');
    process.exit(1);
  }

  console.log(`📁 Akhrinaya faylka: ${path.resolve(filePath)}...`);
  const content = fs.readFileSync(filePath, 'utf8');

  // Initialize SQLite database
  const memory = new SQLiteStudentMemory('./data/abarso.db');
  await memory.initialize();
  broadcastService.setMemory(memory);
  await broadcastService.loadPersistedContacts();

  console.log(`🔍 Baaraya contacts-ka ku jira faylka...`);
  const result = broadcastService.importFromText(content);
  const stats = broadcastService.getStats();

  console.log('\n======================================================');
  console.log('  🎉 WARBIXINTA SOO GUDBINTA (IMPORT SUMMARY)');
  console.log('======================================================');
  console.log(`• Wadarta laga helay faylka:  ${result.totalParsed} contacts`);
  console.log(`• Cusub oo lagu daray bot-ka:  ${result.added} qof`);
  console.log(`• Wadarta Guud ee Bot-ka:      ${stats.total} qof`);
  console.log('======================================================');
  console.log('\n✅ GUUL: Dhammaan contacts-ku hadda waxay ku jiraan database-ka bot-ka!');
  console.log('Waxaad hadda WhatsApp kaga diri kartaa: !fariin <fariintaada>\n');

  await memory.close();
}

main().catch(err => {
  console.error('❌ Cillad ku dhacday soo gudbinta:', err);
  process.exit(1);
});

