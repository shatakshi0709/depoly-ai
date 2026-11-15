/**
 * GitHub OAuth connect flow tests (in-process, no real GitHub API calls, no deployments).
 * Covers: connect start (auth required, signed state), connect callback linking to authenticated user,
 * ownership isolation, invalid/expired state rejection, and failed OAuth code exchange.
 */
import assert from 'assert/strict';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import prisma from './src/config/db.js';
import { encrypt } from './src/utils/crypto.js';
import { createOAuthState, verifyOAuthState } from './src/utils/oauthState.js';
import { env } from './src/config/env.js';
import { githubOAuthConnectStart, githubOAuthCallback } from './src/controllers/auth.controller.js';
import { getMe } from './src/controllers/auth.controller.js';
import { getRepositories } from './src/controllers/github.controller.js';

const tag = `ghconn_${Date.now()}`;
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

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

async function createUser(suffix) {
  const user = await prisma.user.create({
    data: { email: `${tag}_${suffix}@test.local`, fullName: `Conn ${suffix}` },
  });
  created.userIds.push(user.id);
  return user;
}

function makeToken(userId) {
  return jwt.sign({ userId, email: `test@test.local`, fullName: 'Test' }, env.JWT_SECRET, { expiresIn: '7d' });
}

async function main() {
  console.log('Running GitHub OAuth connect tests (in-process)...');

  await test('connect start returns 401 when no authenticated user', async () => {
    const req = {};
    const res = mockRes();
    await githubOAuthConnectStart(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.success, false);
  });

  await test('connect start returns signed state and authorize URL when authenticated', async () => {
    const user = await createUser('starter');
    const req = { user: { userId: user.id } };
    const res = mockRes();
    await githubOAuthConnectStart(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body?.success);
    assert.ok(res.body?.data?.state);
    assert.ok(res.body?.data?.authorizeUrl);
    const v = verifyOAuthState(res.body.data.state);
    assert.equal(v.ok, true);
    assert.equal(v.payload.m.t, 'github_oauth_connect');
    assert.equal(v.payload.m.userId, user.id);
  });

  await test('connect callback links GitHub to authenticated user (valid JWT)', async () => {
    const user = await createUser('connect1');

    // Mock axios for GitHub token exchange and user profile
    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async () => ({ data: { access_token: 'gho_test_token_123' } });
    axios.get = async () => ({ data: { id: 987654321, login: 'testuser', email: 'testuser@example.com', name: 'Test User', avatar_url: 'https://avatars.githubusercontent.com/u/987654321' } });

    try {
      const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });
      const req = {
        user: { userId: user.id },
        body: { code: 'auth-code-123', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.success, true);
      assert.equal(res.body?.message, 'GitHub account connected successfully.');
      // Connect flow should NOT issue a new token
      assert.ok(!res.body?.data?.token, 'connect flow should not issue a new JWT');

      // Verify OAuth account was linked to the correct user
      const oauth = await prisma.oAuthAccount.findFirst({
        where: { userId: user.id, provider: 'github' },
      });
      assert.ok(oauth, 'OAuth account should exist for the connected user');
      assert.equal(oauth.providerUserId, '987654321');
      const decrypted = encrypt('gho_test_token_123') === oauth.accessTokenEnc ? 'same-encryption' : 'differs';
      // Just verify it's encrypted and not plain text
      assert.ok(oauth.accessTokenEnc.startsWith && oauth.accessTokenEnc.includes(':'), 'token should be encrypted');
      created.oauthIds.push(oauth.id);
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }
  });

  await test('connect callback links GitHub to user from state-embedded userId when no JWT', async () => {
    const user = await createUser('connect2');

    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async () => ({ data: { access_token: 'gho_test_token_456' } });
    axios.get = async () => ({ data: { id: 111222333, login: 'testuser2', email: 'testuser2@example.com', name: 'Test User 2', avatar_url: null } });

    try {
      const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });
      const req = {
        user: undefined,
        body: { code: 'auth-code-456', state },
        headers: {},
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.success, true);

      const oauth = await prisma.oAuthAccount.findFirst({
        where: { userId: user.id, provider: 'github' },
      });
      assert.ok(oauth, 'OAuth account should exist linked via state-embedded userId');
      assert.equal(oauth.providerUserId, '111222333');
      created.oauthIds.push(oauth.id);
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }
  });

  await test('connect callback rejects invalid state', async () => {
    const user = await createUser('connect3');
    const req = {
      user: { userId: user.id },
      body: { code: 'auth-code', state: 'not.a.valid.signature' },
      headers: { authorization: `Bearer ${makeToken(user.id)}` },
    };
    const res = mockRes();
    await githubOAuthCallback(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.success, false);
    assert.ok(/invalid/i.test(res.body?.message || ''));
  });

  await test('connect callback rejects expired state', async () => {
    const user = await createUser('connect4');
    const crypto = await import('crypto');
    const payload = { n: 'x', exp: Date.now() - 1000, m: { t: 'github_oauth_connect', userId: user.id } };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', env.JWT_SECRET).update(payloadB64).digest('base64url');
    const expired = `${payloadB64}.${sig}`;
    const req = {
      user: { userId: user.id },
      body: { code: 'auth-code', state: expired },
      headers: { authorization: `Bearer ${makeToken(user.id)}` },
    };
    const res = mockRes();
    await githubOAuthCallback(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 400);
    assert.ok(/expired/i.test(res.body?.message || ''));
  });

  await test('connect callback rejects failed GitHub code exchange', async () => {
    const user = await createUser('connect5');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    const origPost = axios.post;
    axios.post = async () => ({ data: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } });

    try {
      const req = {
        user: { userId: user.id },
        body: { code: 'bad-code', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body?.success, false);
      assert.ok(/failed to exchange/i.test(res.body?.message || ''));
    } finally {
      axios.post = origPost;
    }
  });

  await test('ownership isolation: user A cannot connect GitHub to user B via mismatched JWT userId', async () => {
    const owner = await createUser('owner');
    const attacker = await createUser('attacker');

    // State embedded with attacker's userId, but JWT is for owner's userId.
    // JWT takes precedence, so GitHub gets linked to owner, not attacker.
    const state = createOAuthState({ t: 'github_oauth_connect', userId: attacker.id });

    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async () => ({ data: { access_token: 'gho_test_token_789' } });
    axios.get = async () => ({ data: { id: 555666777, login: 'attacker_gh', email: 'attacker@example.com', name: 'Attacker GH', avatar_url: null } });

    try {
      const req = {
        user: { userId: owner.id }, // JWT says owner
        body: { code: 'auth-code', state }, // state says attacker
        headers: { authorization: `Bearer ${makeToken(owner.id)}` },
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 200);

      // GitHub should be linked to the JWT user (owner), not the state user (attacker)
      const ownerOauth = await prisma.oAuthAccount.findFirst({
        where: { userId: owner.id, provider: 'github' },
      });
      assert.ok(ownerOauth, 'GitHub should be linked to the JWT-authenticated user (owner)');
      created.oauthIds.push(ownerOauth.id);

      const attackerOauth = await prisma.oAuthAccount.findFirst({
        where: { userId: attacker.id, provider: 'github' },
      });
      assert.ok(!attackerOauth, 'GitHub should NOT be linked to the state-embedded user (attacker) when JWT differs');
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }
  });

  await test('sign-in flow still works (no JWT, standard github_oauth state)', async () => {
    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async () => ({ data: { access_token: 'gho_test_token_signin' } });
    axios.get = async () => ({ data: { id: 123123123, login: 'signinuser', email: 'signin@example.com', name: 'Sign In User', avatar_url: null } });

    try {
      const state = createOAuthState({ t: 'github_oauth' });
      const req = {
        user: undefined,
        body: { code: 'auth-code-signin', state },
        headers: {},
      };
      const res = mockRes();
      await githubOAuthCallback(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body?.success);
      // Sign-in flow should issue a new JWT
      assert.ok(res.body?.data?.token, 'sign-in flow should issue a new JWT');
      assert.ok(res.body?.data?.user?.id);

      // Track sign-in flow created records for cleanup
      const signinUser = await prisma.user.findUnique({
        where: { email: 'signin@example.com' },
      });
      if (signinUser) {
        created.userIds.push(signinUser.id);
        const signinOauth = await prisma.oAuthAccount.findFirst({
          where: { userId: signinUser.id, provider: 'github' },
        });
        if (signinOauth) {
          created.oauthIds.push(signinOauth.id);
        }
      }
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }
  });

  await test('GET /auth/me returns hasGithubConnected: true after OAuth connect', async () => {
    const user = await createUser('meconnect');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: user.id });

    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async () => ({ data: { access_token: 'gho_me_test_123' } });
    axios.get = async () => ({ data: { id: 123456789, login: 'meuser', email: 'me@example.com', name: 'Me User', avatar_url: null } });

    try {
      const connectReq = {
        user: { userId: user.id },
        body: { code: 'me-code-123', state },
        headers: { authorization: `Bearer ${makeToken(user.id)}` },
      };
      const connectRes = mockRes();
      await githubOAuthCallback(connectReq, connectRes, (e) => { throw e; });
      assert.equal(connectRes.statusCode, 200);

      const meReq = { user: { userId: user.id } };
      const meRes = mockRes();
      await getMe(meReq, meRes, (e) => { throw e; });
      assert.equal(meRes.statusCode, 200);
      assert.equal(meRes.body?.success, true);
      assert.equal(meRes.body?.data?.hasGithubConnected, true);

      // Track OAuth account created by connect for cleanup
      const oauth = await prisma.oAuthAccount.findFirst({
        where: { userId: user.id, provider: 'github' },
      });
      if (oauth) created.oauthIds.push(oauth.id);
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }
  });

  await test('GET /auth/me returns hasGithubConnected: false before OAuth connect', async () => {
    const user = await createUser('menoconn');
    const meReq = { user: { userId: user.id } };
    const meRes = mockRes();
    await getMe(meReq, meRes, (e) => { throw e; });
    assert.equal(meRes.statusCode, 200);
    assert.equal(meRes.body?.success, true);
    assert.equal(meRes.body?.data?.hasGithubConnected, false);
  });

  await test('GET /github/repos returns 400 GITHUB_NOT_CONNECTED before OAuth connect', async () => {
    const user = await createUser('reposnoconn');
    const reposReq = { user: { userId: user.id } };
    const reposRes = mockRes();
    await getRepositories(reposReq, reposRes, (e) => { throw e; });
    assert.equal(reposRes.statusCode, 400);
    assert.equal(reposRes.body?.success, false);
    assert.equal(reposRes.body?.error, 'GITHUB_NOT_CONNECTED');
  });

  await test('connect flow re-links GitHub from prior sign-in user to current authenticated user', async () => {
    // User B: previously signed in with GitHub, owns the GitHub OAuth account
    const userB = await createUser('relink-prior');
    // Pre-create OAuth account for user B (simulating prior GitHub sign-in)
    // Use a unique numeric providerUserId that matches the mock GitHub API response
    const ghProviderUserId = String(Date.now() % 1000000000);
    await prisma.oAuthAccount.create({
      data: {
        userId: userB.id,
        provider: 'github',
        providerUserId: ghProviderUserId,
        accessTokenEnc: encrypt('relink-old-token'),
      },
    });

    // User A: Electron user logging in with email/password, wants to connect same GitHub
    const userA = await createUser('relink-electron');
    const state = createOAuthState({ t: 'github_oauth_connect', userId: userA.id });

    const origPost = axios.post;
    const origGet = axios.get;
    axios.post = async () => ({ data: { access_token: 'gho_relink_new_token' } });
    axios.get = async () => ({ data: { id: parseInt(ghProviderUserId), login: 'relinkuser', email: 'relink@example.com', name: 'Relink User', avatar_url: null } });

    try {
      const connectReq = {
        user: { userId: userA.id },
        body: { code: 'relink-code-123', state },
        headers: { authorization: `Bearer ${makeToken(userA.id)}` },
      };
      const connectRes = mockRes();
      await githubOAuthCallback(connectReq, connectRes, (e) => { throw e; });
      assert.equal(connectRes.statusCode, 200);
      assert.equal(connectRes.body?.success, true);

      // User A should now have GitHub connected
      const meAReq = { user: { userId: userA.id } };
      const meARes = mockRes();
      await getMe(meAReq, meARes, (e) => { throw e; });
      assert.equal(meARes.statusCode, 200);
      assert.equal(meARes.body?.data?.hasGithubConnected, true, 'User A should have GitHub connected after re-link');

      // User B should no longer have GitHub connected (unlinked)
      const meBReq = { user: { userId: userB.id } };
      const meBRes = mockRes();
      await getMe(meBReq, meBRes, (e) => { throw e; });
      assert.equal(meBRes.statusCode, 200);
      assert.equal(meBRes.body?.data?.hasGithubConnected, false, 'User B should no longer have GitHub connected after re-link');

      // Verify OAuth account now points to user A
      const oauth = await prisma.oAuthAccount.findUnique({
        where: { provider_providerUserId: { provider: 'github', providerUserId: ghProviderUserId } },
      });
      assert.ok(oauth, 'OAuth account should exist');
      assert.equal(oauth.userId, userA.id, 'OAuth account should be linked to user A (current authenticated user)');

      // Track for cleanup
      created.oauthIds.push(oauth.id);
    } finally {
      axios.post = origPost;
      axios.get = origGet;
    }
  });

  console.log(`\nGitHub OAuth connect tests: ${pass} passed, ${fail} failed`);
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
