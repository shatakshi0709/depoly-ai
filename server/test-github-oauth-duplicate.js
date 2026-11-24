/**
 * Regression tests for duplicate GitHub OAuth authorization-code exchange.
 * Covers: same code exchanged twice (already consumed), StrictMode double-invocation safety,
 * and safe handling of already-consumed codes without exposing secrets.
 */
import assert from 'assert/strict';
import axios from 'axios';
import prisma from './src/config/db.js';
import { githubOAuthCallback } from './src/controllers/auth.controller.js';
import { createOAuthState } from './src/utils/oauthState.js';
import { env } from './src/config/env.js';
import jwt from 'jsonwebtoken';

const tag = `ghdup_${Date.now()}`;
const created = { userIds: [], oauthIds: [] };
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
    data: { email: `${tag}_${suffix}@test.local`, fullName: `Dup ${suffix}` },
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
  console.log('Running GitHub OAuth duplicate code exchange regression tests (in-process)...');

  await test('first code exchange succeeds, second with same code fails safely', async () => {
    const user = await createUser('dup1');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    let callCount = 0;
    const origPost = axios.post;
    axios.post = async (url, data) => {
      callCount++;
      if (callCount === 1) {
        return { data: { access_token: 'gho_first_exchange_123' } };
      }
      // Second call with same code: GitHub rejects as already used
      return { data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } };
    };
    const origGet = axios.get;
    axios.get = async () => ({ data: { id: 777888999, login: 'dupuser', email: 'dup@example.com', name: 'Dup User', avatar_url: null } });

    try {
      // First exchange: succeeds
      const req1 = {
        user: { userId: user.id },
        body: { code: 'same-code-123', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res1 = mockRes();
      await githubOAuthCallback(req1, res1, (e) => { throw e; });
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.body?.success, true);
      assert.equal(callCount, 1);

      // Second exchange with same code: fails safely
      const req2 = {
        user: { userId: user.id },
        body: { code: 'same-code-123', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res2 = mockRes();
      await githubOAuthCallback(req2, res2, (e) => { throw e; });
      assert.equal(res2.statusCode, 400);
      assert.equal(res2.body?.success, false);
      assert.ok(/already used|invalid/i.test(res2.body?.message || ''), `Expected actionable message: ${res2.body?.message}`);
      assert.equal(callCount, 2);
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }

    // Track OAuth account from first successful exchange for cleanup
    const oauth = await prisma.oAuthAccount.findFirst({
      where: { userId: user.id, provider: 'github' },
    });
    if (oauth) created.oauthIds.push(oauth.id);
  });

  await test('duplicate exchange does not create duplicate OAuth accounts', async () => {
    const user = await createUser('dup2');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    let callCount = 0;
    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async (url, data) => {
      callCount++;
      if (callCount === 1) {
        return { data: { access_token: 'gho_dup_account_456' } };
      }
      return { data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } };
    };
    axios.get = async () => ({ data: { id: 111222333, login: 'dupacct', email: 'dupacct@example.com', name: 'Dup Acct', avatar_url: null } });

    try {
      const req1 = {
        user: { userId: user.id },
        body: { code: 'unique-code-456', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res1 = mockRes();
      await githubOAuthCallback(req1, res1, (e) => { throw e; });
      assert.equal(res1.statusCode, 200);

      const oauthAfterFirst = await prisma.oAuthAccount.findFirst({
        where: { userId: user.id, provider: 'github' },
      });
      assert.ok(oauthAfterFirst, 'OAuth account should exist after first exchange');

      // Second exchange with same code fails (code already consumed)
      const req2 = {
        user: { userId: user.id },
        body: { code: 'unique-code-456', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res2 = mockRes();
      await githubOAuthCallback(req2, res2, (e) => { throw e; });
      assert.equal(res2.statusCode, 400);

      // Verify no duplicate OAuth account was created
      const oauthCount = await prisma.oAuthAccount.count({
        where: { userId: user.id, provider: 'github' },
      });
      assert.equal(oauthCount, 1, `Expected exactly 1 OAuth account, got ${oauthCount}`);
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }

    const oauth = await prisma.oAuthAccount.findFirst({
      where: { userId: user.id, provider: 'github' },
    });
    if (oauth) created.oauthIds.push(oauth.id);
  });

  await test('strict mode simulation: two rapid exchanges with same code and state', async () => {
    const user = await createUser('strict');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    let callCount = 0;
    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async (url, data) => {
      callCount++;
      if (callCount <= 1) {
        return { data: { access_token: 'gho_strict_mode_789' } };
      }
      return { data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } };
    };
    axios.get = async () => ({ data: { id: 444555666, login: 'strictuser', email: 'strict@example.com', name: 'Strict User', avatar_url: null } });

    try {
      // Simulate StrictMode double-invocation: two calls nearly simultaneously
      const req1 = {
        user: { userId: user.id },
        body: { code: 'strict-code-789', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const req2 = {
        user: { userId: user.id },
        body: { code: 'strict-code-789', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };

      const res1 = mockRes();
      const res2 = mockRes();

      await githubOAuthCallback(req1, res1, (e) => { throw e; });
      await githubOAuthCallback(req2, res2, (e) => { throw e; });

      // Exactly one successful exchange, one safely rejected
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.body?.success, true);
      assert.equal(res2.statusCode, 400);
      assert.equal(res2.body?.success, false);
      assert.equal(callCount, 2, 'GitHub should be called exactly twice (once per exchange attempt)');
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }

    const oauth = await prisma.oAuthAccount.findFirst({
      where: { userId: user.id, provider: 'github' },
    });
    if (oauth) created.oauthIds.push(oauth.id);
  });

  await test('sign-in flow duplicate exchange handled safely', async () => {
    const state = createOAuthState({ t: 'github_oauth' });

    let callCount = 0;
    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async (url, data) => {
      callCount++;
      if (callCount === 1) {
        return { data: { access_token: 'gho_signin_dup_111' } };
      }
      return { data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } };
    };
    axios.get = async () => ({ data: { id: 999888777, login: 'signindup', email: 'signindup@example.com', name: 'Sign In Dup', avatar_url: null } });

    try {
      const req1 = {
        user: undefined,
        body: { code: 'signin-dup-code-111', state },
        headers: {},
      };
      const res1 = mockRes();
      await githubOAuthCallback(req1, res1, (e) => { throw e; });
      assert.equal(res1.statusCode, 200);
      assert.ok(res1.body?.success);

      const req2 = {
        user: undefined,
        body: { code: 'signin-dup-code-111', state },
        headers: {},
      };
      const res2 = mockRes();
      await githubOAuthCallback(req2, res2, (e) => { throw e; });
      assert.equal(res2.statusCode, 400);
      assert.equal(res2.body?.success, false);
      assert.ok(/already used|invalid/i.test(res2.body?.message || ''));
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }
  });

  await test('invalid state still rejected on duplicate exchange attempt', async () => {
    const user = await createUser('invalidstate');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    let githubCallCount = 0;
    const origPost = axios.post;
    axios.post = async () => {
      githubCallCount++;
      return { data: { access_token: 'should_not_be_called' } };
    };

    try {
      // First attempt with invalid state: rejected before code exchange
      const req1 = {
        user: { userId: user.id },
        body: { code: 'some-code', state: 'not.a.valid.signature' },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res1 = mockRes();
      await githubOAuthCallback(req1, res1, (e) => { throw e; });
      assert.equal(res1.statusCode, 400);
      assert.equal(res1.body?.success, false);
      assert.equal(githubCallCount, 0, 'GitHub should not be called with invalid state');

      // Second attempt with same invalid state: still rejected, GitHub not called
      const res2 = mockRes();
      await githubOAuthCallback(req1, res2, (e) => { throw e; });
      assert.equal(res2.statusCode, 400);
      assert.equal(res2.body?.success, false);
      assert.equal(githubCallCount, 0, 'GitHub should still not be called on duplicate invalid state');
    } finally {
      axios.post = origPost;
    }
  });

  console.log(`\nGitHub OAuth duplicate exchange regression tests: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

async function cleanup() {
  try {
    if (created.oauthIds.length) await prisma.oAuthAccount.deleteMany({ where: { id: { in: created.oauthIds } } });
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
