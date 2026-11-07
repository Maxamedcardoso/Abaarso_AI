/**
 * ABARSO AI Test Suite Runner
 * Lightweight, robust test harness that runs all unit, integration, and security tests.
 */

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export class TestSuite {
  private name: string;
  private tests: Array<{ name: string; fn: () => Promise<void> | void }> = [];

  constructor(name: string) {
    this.name = name;
  }

  public test(name: string, fn: () => Promise<void> | void): void {
    this.tests.push({ name, fn });
  }

  public async run(): Promise<{ total: number; passed: number; failed: number; results: TestResult[] }> {
    console.log(`\n========================================`);
    console.log(`RUNNING TEST SUITE: ${this.name}`);
    console.log(`========================================`);

    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const t of this.tests) {
      const start = Date.now();
      try {
        await t.fn();
        const duration = Date.now() - start;
        console.log(`  [PASS] ${t.name} (${duration}ms)`);
        results.push({ name: t.name, passed: true, durationMs: duration });
        passed++;
      } catch (err: any) {
        const duration = Date.now() - start;
        const errMsg = err?.message || String(err);
        console.error(`  [FAIL] ${t.name} (${duration}ms)`);
        console.error(`         Error: ${errMsg}`);
        results.push({ name: t.name, passed: false, error: errMsg, durationMs: duration });
        failed++;
      }
    }

    console.log(`----------------------------------------`);
    console.log(`Suite "${this.name}" Summary: ${passed} Passed, ${failed} Failed`);
    console.log(`----------------------------------------\n`);

    return { total: this.tests.length, passed, failed, results };
  }
}

export function assert(condition: boolean, message: string = 'Condition must be true'): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string = 'Values must be equal'): void {
  if (actual !== expected) {
    throw new Error(`Assertion Failed: ${message}. Expected: [${expected}], Got: [${actual}]`);
  }
}

export function assertTrue(condition: boolean, message: string = 'Expected true'): void {
  assert(condition === true, message);
}

export function assertFalse(condition: boolean, message: string = 'Expected false'): void {
  assert(condition === false, message);
}

