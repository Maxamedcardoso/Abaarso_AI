import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { StudentAdvisorEngine } from '../advisor/advisor-engine.js';
import { MessageRouter } from '../pipeline/message-router.js';
import { AdminService } from './admin-service.js';
import { config } from '../config/env.js';

async function runAdminCLI() {
  const memory = new SQLiteStudentMemory(config.database.path);
  await memory.initialize();

  const ai = new AIOrchestrator(config);
  await ai.initialize();

  const engine = new StudentAdvisorEngine(memory, ai);
  const router = new MessageRouter(engine, config);
  const admin = new AdminService(memory, ai, router);

  const command = process.argv[2] || 'stats';

  console.log(`\n======================================================`);
  console.log(`  ABARSO AI — Admin Control CLI                       `);
  console.log(`======================================================\n`);

  if (command === 'stats') {
    const stats = await admin.getSystemStats();
    console.log(`System Health: ${stats.systemHealth.toUpperCase()}`);
    console.log(`Uptime: ${stats.uptimeSeconds} seconds`);
    console.log(`\n[Database]:`);
    console.log(`  - Total Registered Students: ${stats.database.totalStudents}`);
    console.log(`  - Total Messages Stored:     ${stats.database.totalMessages}`);
    console.log(`  - Oldest Message:            ${stats.database.oldestMessageDate || 'None'}`);
    console.log(`\n[AI & Zero-Cost Quota]:`);
    console.log(`  - Daily Free Requests Used:  ${stats.ai.quotaStats.dailyRequests} / ${stats.ai.quotaStats.dailyLimit}`);
    console.log(`  - Remaining Free Requests:   ${stats.ai.quotaStats.remainingDailyRequests}`);
    console.log(`  - Free Quota Exhausted:      ${stats.ai.quotaStats.isDailyQuotaExhausted ? 'YES (AI Paused)' : 'NO (Active)'}`);
    console.log(`  - Primary Gemini Model:      ${stats.ai.geminiStatus.model}`);
    console.log(`  - Local Llama Fallback:      ${stats.ai.fallbackStatus.healthy ? 'ONLINE' : 'OFFLINE'}`);
  } else if (command === 'purge') {
    const days = parseInt(process.argv[3] || '30', 10);
    console.log(`Purging messages older than ${days} days...`);
    const count = await admin.purgeOldData(days);
    console.log(`✅ Successfully deleted ${count} stale conversation records.`);
  } else {
    console.log(`Usage:`);
    console.log(`  npm run admin stats       - View system stats and quota usage`);
    console.log(`  npm run admin purge <days> - Purge messages older than N days`);
  }

  await memory.close();
}

runAdminCLI().catch(console.error);

