/**
 * @file test-backoff.js
 * @description Unit tests for exponential backoff and jitter timing algorithm.
 */

import assert from 'assert/strict';
import { calculateBackoff, retryWithBackoff } from './src/utils/backoff.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL: ${name} -> ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL: ${name} -> ${err.message}`);
  }
}

console.log('Running backoff and retry unit tests...\n');

test('calculateBackoff returns value between 0 and baseMs on attempt 0', () => {
  for (let i = 0; i < 50; i++) {
    const delay = calculateBackoff(0, { baseMs: 500, maxMs: 10000 });
    assert.ok(delay >= 0 && delay <= 500, `Delay ${delay} out of bounds [0, 500]`);
  }
});

test('calculateBackoff respects maxMs ceiling', () => {
  for (let i = 0; i < 50; i++) {
    const delay = calculateBackoff(10, { baseMs: 1000, maxMs: 5000 });
    assert.ok(delay >= 0 && delay <= 5000, `Delay ${delay} exceeded maxMs 5000`);
  }
});

test('calculateBackoff handles negative attempt safely', () => {
  const delay = calculateBackoff(-5, { baseMs: 1000 });
  assert.ok(delay >= 0 && delay <= 1000);
});

await asyncTest('retryWithBackoff returns result immediately on first attempt success', async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    return 'ok';
  }, { maxAttempts: 3, baseMs: 10 });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

await asyncTest('retryWithBackoff succeeds after transient failures', async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    if (calls < 3) throw new Error('Transient network error');
    return 'recovered';
  }, { maxAttempts: 5, baseMs: 5, maxMs: 20 });
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
});

await asyncTest('retryWithBackoff throws last error when maxAttempts exhausted', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await retryWithBackoff(async () => {
      calls++;
      throw new Error('Persistent provider failure');
    }, { maxAttempts: 3, baseMs: 5, maxMs: 15 });
  }, /Persistent provider failure/);
  assert.equal(calls, 3);
});

await asyncTest('retryWithBackoff respects shouldRetry predicate', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await retryWithBackoff(async () => {
      calls++;
      const err = new Error('Fatal 401 Unauthorized');
      err.status = 401;
      throw err;
    }, {
      maxAttempts: 5,
      baseMs: 5,
      shouldRetry: (err) => err.status !== 401,
    });
  }, /Fatal 401/);
  assert.equal(calls, 1, 'Should abort immediately on fatal error without retrying');
});

console.log(`\nBackoff unit tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
