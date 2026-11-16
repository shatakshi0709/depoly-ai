/**
 * @file test-sanitize-security.js
 * @description Unit tests for input sanitization, slug generation, branch validation, and credential masking.
 */

import assert from 'assert/strict';
import {
  sanitizeLogMessage,
  sanitizeText,
  generateProjectSlug,
  sanitizeBranchName,
  maskSensitiveValues,
} from './src/utils/sanitize.js';

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

console.log('Running sanitization and security unit tests...\n');

// 1. Slug generator
test('generateProjectSlug transforms spaces and special chars into hyphens', () => {
  assert.equal(generateProjectSlug('My Awesome App! 2.0'), 'my-awesome-app-2-0');
  assert.equal(generateProjectSlug('---Moviez---'), 'moviez');
  assert.equal(generateProjectSlug(''), 'deplo-app');
  assert.equal(generateProjectSlug(null), 'deplo-app');
});

test('generateProjectSlug enforces max length', () => {
  const longName = 'a'.repeat(100);
  assert.equal(generateProjectSlug(longName, 20).length, 20);
});

// 2. Branch sanitization
test('sanitizeBranchName strips invalid git ref characters', () => {
  assert.equal(sanitizeBranchName('feature/my~branch:v1'), 'feature/mybranchv1');
  assert.equal(sanitizeBranchName('/release/v1.0/'), 'release/v1.0');
  assert.equal(sanitizeBranchName('..'), 'main');
  assert.equal(sanitizeBranchName(''), 'main');
});

// 3. Credential masking in log messages
test('sanitizeLogMessage redacts Bearer tokens', () => {
  const log = 'Authorization failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz for user';
  const sanitized = sanitizeLogMessage(log);
  assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'Must redact Bearer token');
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('sanitizeLogMessage redacts GitHub tokens', () => {
  const log = 'Cloning with token ghp_1234567890abcdefghij1234567890';
  const sanitized = sanitizeLogMessage(log);
  assert.ok(!sanitized.includes('ghp_1234567890'), 'Must redact GitHub token');
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('sanitizeLogMessage redacts Render tokens', () => {
  const log = 'Calling Render API with rnd_1234567890abcdefghij1234';
  const sanitized = sanitizeLogMessage(log);
  assert.ok(!sanitized.includes('rnd_1234567890'), 'Must redact Render token');
});

test('sanitizeLogMessage redacts key-value passwords', () => {
  const log = 'Connecting with password=SuperSecretPassword123! to database';
  const sanitized = sanitizeLogMessage(log);
  assert.ok(!sanitized.includes('SuperSecretPassword123!'), 'Must redact password');
  assert.ok(sanitized.includes('password=[REDACTED]'));
});

test('maskSensitiveValues custom key redaction', () => {
  const text = 'Config: DATABASE_URL=postgres://user:pass@host/db and PORT=5001';
  const masked = maskSensitiveValues(text, ['DATABASE_URL']);
  assert.ok(!masked.includes('postgres://user:pass@host/db'));
  assert.ok(masked.includes('PORT=5001'), 'Must preserve non-sensitive keys');
});

console.log(`\nSanitization unit tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
