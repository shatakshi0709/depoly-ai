/**
 * GitHub OAuth callback error handling tests (in-process, no real GitHub API calls).
 * Covers: bad_verification_code (code already used), redirect_uri_mismatch,
 * generic GitHub errors, no access token returned, and connect flow with code reuse.
 */
import assert from 'assert/strict';
import axios from 'axios';
import prisma from './src/config/db.js';
import { githubOAuthCallback } from './src/controllers/auth.controller.js';
import { createOAuthState } from './src/utils/oauthState.js';
import { env } from './src/config/env.js';
import jwt from 'jsonwebtoken';

const tag = `gherr_${Date.now()}`;
const created = { userIds: [] };
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

async function createUser(suffix) {
  const user = await prisma.user.create({
    data: { email: `${tag}_${suffix}@test.local`, fullName: `Err ${suffix}` },
  });
  created.userIds.push(user.id);
  return user;
}

function makeToken(userId) {
  return jwt.sign({ userId, email: `test@test.local`, fullName: 'Test' }, env.JWT_SECRET, { expiresIn: '7d' });
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

async function main() {
  console.log('Running GitHub OAuth callback error handling tests (in-process)...');

  await test('connect callback returns actionable message for bad_verification_code', async () => {
    const user = await createUser('badcode');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    const origPost = axios.post;
    axios.post = async () => ({ data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } });

    try {
      const req = {
        user: { userId: user.id },
        body: { code: 'used-code', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.success, false);
      assert.ok(/already used|invalid/i.test(res.body?.message || ''), `Expected actionable message: ${res.body?.message}`);
    } finally {
      axios.post = origPost;
    }
  });

  await test('connect callback returns sanitized redirect_uri_mismatch error', async () => {
    const user = await createUser('redirect');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    const origPost = axios.post;
    axios.post = async () => ({ data: { error: 'redirect_uri_mismatch', error_description: 'The redirect_uri MUST match the registered callback URL for this application.' } });

    try {
      const req = {
        user: { userId: user.id },
        body: { code: 'some-code', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.success, false);
      assert.ok(/redirect_uri|callback/i.test(res.body?.message || ''), `Expected redirect_uri detail: ${res.body?.message}`);
    } finally {
      axios.post = origPost;
    }
  });

  await test('connect callback returns generic error when no description provided', async () => {
    const user = await createUser('generic');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    const origPost = axios.post;
    axios.post = async () => ({ data: { error: 'unsupported_response_type' } });

    try {
      const req = {
        user: { userId: user.id },
        body: { code: 'some-code', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.success, false);
      assert.ok(/Failed to exchange GitHub authorization code/i.test(res.body?.message || ''), `Expected generic message: ${res.body?.message}`);
    } finally {
      axios.post = origPost;
    }
  });

  await test('connect callback returns error when no access token in response', async () => {
    const user = await createUser('notoken');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    const origPost = axios.post;
    axios.post = async () => ({ data: {} });

    try {
      const req = {
        user: { userId: user.id },
        body: { code: 'some-code', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.success, false);
      assert.ok(/Failed to exchange GitHub authorization code/i.test(res.body?.message || ''), `Expected generic message: ${res.body?.message}`);
    } finally {
      axios.post = origPost;
    }
  });

  await test('connect callback rejects invalid state before code exchange', async () => {
    const user = await createUser('invalidstate');
    const req = {
      user: { userId: user.id },
      body: { code: 'some-code', state: 'not.a.valid.state' },
      headers: { authorization: `Bearer ${makeToken(user.id)}` },
    };
    const res = mockRes();
    await githubOAuthCallback(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.success, false);
    assert.ok(/invalid|expired/i.test(res.body?.message || ''), `Expected state error: ${res.body?.message}`);
  });

  await test('connect callback does not expose GitHub error detail in production mode', async () => {
    const user = await createUser('prod');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    const origIsProduction = env.isProduction;
    const origPost = axios.post;
    axios.post = async () => ({ data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } });

    try {
      // Temporarily override isProduction for this test
      Object.defineProperty(env, 'isProduction', { value: true, configurable: true });
      const req = {
        user: { userId: user.id },
        body: { code: 'used-code', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.success, false);
      // Production should NOT include GitHub error description
      assert.ok(!res.body?.message?.includes('incorrect or expired'), 'Production should not leak GitHub error description');
      assert.ok(/already used|invalid/i.test(res.body?.message || ''), `Expected actionable message: ${res.body?.message}`);
    } finally {
      Object.defineProperty(env, 'isProduction', { value: origIsProduction, configurable: true });
      axios.post = origPost;
    }
  });

  await test('sign-in flow (github_oauth state) also gets actionable error for bad code', async () => {
    const state = createOAuthState({ t: 'github_oauth' });

    const origPost = axios.post;
    axios.post = async () => ({ data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } });

    try {
      const req = {
        user: undefined,
        body: { code: 'used-code', state },
        headers: {},
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.success, false);
      assert.ok(/already used|invalid/i.test(res.body?.message || ''), `Expected actionable message: ${res.body?.message}`);
    } finally {
      axios.post = origPost;
    }
  });

  console.log(`\nGitHub OAuth callback error tests: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

async function cleanup() {
  try {
    if (created.userIds.length) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  } catch (e) {
    console.error('Cleanup warning:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main().then(async () => { await cleanup(); process.exit(fail ? 1 : 0); }).catch(async (e) => {
  console.error('FATAL', e);
  await cleanup();
  process.exit(1);
});
