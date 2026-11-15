/**
 * @file test-analyzer.js
 * @description Regression tests for the repository analyzer service detector functions.
 * Covers: Electron detection, Express backend detection, env var extraction.
 * These are pure functions that don't require GitHub API calls.
 */
import assert from 'assert/strict';
import {
  detectElectronApp,
  detectExpressBackend,
  extractRequiredEnvVars,
} from '../server/src/services/analyzer.service.js';

let pass = 0, fail = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`FAIL: ${name} -> ${e.message}`);
  }
}

// ── Unit tests for detector functions ──────────────────────────

await test('detectElectronApp returns null for non-Electron package.json', async () => {
  const result = detectElectronApp({
    name: 'my-app',
    dependencies: { express: '^4.18.0' },
    main: 'index.js',
  });
  assert.equal(result, null, 'Should return null for non-Electron package.json');
});

await test('detectElectronApp detects Electron app', async () => {
  const result = detectElectronApp({
    name: 'my-desktop-app',
    dependencies: { electron: '^25.0.0' },
    main: 'electron/main.js',
  });
  assert.ok(result, 'Should detect Electron app');
  assert.equal(result.isElectron, true);
  assert.equal(result.mainEntry, 'electron/main.js');
});

await test('detectElectronApp returns null for package.json without electron dep', async () => {
  const result = detectElectronApp({
    name: 'my-app',
    dependencies: { express: '^4.18.0' },
    main: 'index.js',
  });
  assert.equal(result, null, 'Should return null when no electron dependency');
});

await test('detectExpressBackend detects Express app', async () => {
  const result = detectExpressBackend({
    name: 'my-api',
    dependencies: { express: '^4.18.0' },
    scripts: { start: 'node index.js --port $PORT' },
  });
  assert.ok(result, 'Should detect Express backend');
  assert.equal(result.isExpressBackend, true);
  assert.equal(result.framework, 'EXPRESS_NODE');
  assert.ok(result.listensOnPortEnv, 'Should detect PORT in start script');
});

await test('detectExpressBackend returns null for non-Express package.json', async () => {
  const result = detectExpressBackend({
    name: 'my-app',
    dependencies: { react: '^18.0.0' },
    scripts: { start: 'react-scripts start' },
  });
  assert.equal(result, null, 'Should return null for non-Express package.json');
});

await test('extractRequiredEnvVars returns PORT and NODE_ENV', async () => {
  const result = extractRequiredEnvVars({
    scripts: { start: 'node index.js --port $PORT' },
  });
  assert.ok(result.some((e) => e.key === 'PORT'), 'Should include PORT');
  assert.ok(result.some((e) => e.key === 'NODE_ENV'), 'Should include NODE_ENV');
});

console.log(`\nAnalyzer regression tests: ${pass} passed, ${fail} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
  process.exit(1);
}
