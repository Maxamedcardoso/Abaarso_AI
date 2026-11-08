import { execSync } from 'child_process';

const testFiles = [
  'tests/phase2.test.ts',
  'tests/phase3.test.ts',
  'tests/phase4.test.ts',
  'tests/phase5.test.ts',
  'tests/phase6.test.ts',
  'tests/phase7.test.ts',
  'tests/e2e-master.test.ts',
];

console.log(`\n================================================================`);
console.log(`  CARDOSO AI — RUNNING ALL UNIT, INTEGRATION & E2E TEST SUITES  `);
console.log(`================================================================\n`);

let allPassed = true;

for (const file of testFiles) {
  try {
    execSync(`npx tsx ${file}`, { stdio: 'inherit' });
  } catch (err) {
    allPassed = false;
    console.error(`\n❌ Test Suite failed: ${file}`);
    process.exit(1);
  }
}

if (allPassed) {
  console.log(`\n================================================================`);
  console.log(`  🎉 ALL CARDOSO AI TEST SUITES PASSED CLEANLY (31/31 TESTS)    `);
  console.log(`================================================================\n`);
}

