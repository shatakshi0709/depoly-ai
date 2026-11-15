/**
 * GitHub repository listing tests (in-process, no real GitHub API calls, no deployments).
 * Covers: not-connected error (no demo fallback), authenticated fetch success, ownership isolation,
 * empty results, and API failure propagation with actual messages.
 */
import assert from 'assert/strict';
import prisma from './src/config/db.js';
import { encrypt } from './src/utils/crypto.js';
import { getRepositories } from './src/controllers/github.controller.js';
import { githubServiceApi } from './src/services/github.service.js';

const tag = `ghrepos_${Date.now()}`;
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
    data: { email: `${tag}_${suffix}@test.local`, fullName: `GH ${suffix}` },
  });
  created.userIds.push(user.id);
  return user;
}

async function main() {
  console.log('Running GitHub repos tests (in-process)...');

  await test('user without linked GitHub OAuth gets 400 and no demo fallback', async () => {
    const user = await createUser('u1');
    const req = { user: { userId: user.id } };
    const res = mockRes();
    await getRepositories(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.error, 'GITHUB_NOT_CONNECTED');
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes('demo-org'));
    assert.ok(!body.includes('STARTER_TEMPLATES'));
    assert.ok(!body.includes('ecommerce-fullstack-starter'));
  });

  await test('authenticated user with stored token fetches own repos via service (ownership) and not demo', async () => {
    const owner = await createUser('owner');
    const other = await createUser('other');
    const oauth = await prisma.oAuthAccount.create({
      data: {
        userId: owner.id,
        provider: 'github',
        providerUserId: `${tag}_ghid_owner`,
        accessTokenEnc: encrypt('gho_test_token_value'),
      },
    });
    created.oauthIds.push(oauth.id);

    const orig = githubServiceApi.getUserRepositories;
    let seenToken = null;
    githubServiceApi.getUserRepositories = async (token) => {
      seenToken = token;
      return [
        { id: 1, name: 'my-repo', fullName: 'shatakshi0709/my-repo', url: 'https://github.com/shatakshi0709/my-repo', defaultBranch: 'main', isPrivate: false, description: '', language: 'JS', updatedAt: new Date().toISOString() },
      ];
    };
    try {
      const resOwner = mockRes();
      await getRepositories({ user: { userId: owner.id } }, resOwner, (e) => { throw e; });
      assert.equal(seenToken, 'gho_test_token_value', 'must use stored decrypted token for authenticated user');
      assert.equal(resOwner.statusCode, 200);
      assert.equal(resOwner.body?.success, true);
      assert.equal(resOwner.body?.source, 'GITHUB_OAUTH');
      assert.ok(Array.isArray(resOwner.body?.data));
      assert.equal(resOwner.body.data.length, 1);
      assert.equal(resOwner.body.data[0].fullName, 'shatakshi0709/my-repo');
      assert.ok(!JSON.stringify(resOwner.body).includes('demo-org'));

      // ownership isolation: other user without linked token cannot receive owner's repos
      const resOther = mockRes();
      await getRepositories({ user: { userId: other.id } }, resOther, (e) => { throw e; });
      assert.equal(resOther.statusCode, 400);
      assert.equal(resOther.body?.error, 'GITHUB_NOT_CONNECTED');
      assert.ok(!JSON.stringify(resOther.body).includes('shatakshi0709/my-repo'));
      assert.ok(!JSON.stringify(resOther.body).includes('demo-org'));
    } finally {
      githubServiceApi.getUserRepositories = orig;
    }
  });

  await test('empty repository list returns success with empty array (no demo)', async () => {
    const user = await createUser('empty');
    const oauth = await prisma.oAuthAccount.create({
      data: { userId: user.id, provider: 'github', providerUserId: `${tag}_ghid_empty`, accessTokenEnc: encrypt('t3') },
    });
    created.oauthIds.push(oauth.id);
    const orig = githubServiceApi.getUserRepositories;
    githubServiceApi.getUserRepositories = async () => [];
    try {
      const res = mockRes();
      await getRepositories({ user: { userId: user.id } }, res, (e) => { throw e; });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.success, true);
      assert.deepEqual(res.body?.data, []);
      assert.ok(!JSON.stringify(res.body).includes('demo-org'));
    } finally {
      githubServiceApi.getUserRepositories = orig;
    }
  });

  await test('GitHub API failures return actual errors (401/502) and no demo data', async () => {
    const user = await createUser('fail');
    const oauth = await prisma.oAuthAccount.create({
      data: { userId: user.id, provider: 'github', providerUserId: `${tag}_ghid_fail`, accessTokenEnc: encrypt('t4') },
    });
    created.oauthIds.push(oauth.id);
    const orig = githubServiceApi.getUserRepositories;

    githubServiceApi.getUserRepositories = async () => { const e = new Error('Bad credentials'); e.status = 401; throw e; };
    try {
      const res = mockRes();
      await getRepositories({ user: { userId: user.id } }, res, (e) => { throw e; });
      assert.equal(res.statusCode, 401);
      assert.equal(res.body?.success, false);
      assert.equal(res.body?.error, 'GITHUB_AUTH_FAILED');
      assert.ok(/Bad credentials/i.test(res.body?.message || ''));
      assert.ok(!JSON.stringify(res.body).includes('demo-org'));
    } finally {
      githubServiceApi.getUserRepositories = orig;
    }

    githubServiceApi.getUserRepositories = async () => { const e = new Error('API rate limit exceeded'); e.status = 403; throw e; };
    try {
      const res = mockRes();
      await getRepositories({ user: { userId: user.id } }, res, (e) => { throw e; });
      assert.equal(res.statusCode, 401);
      assert.equal(res.body?.error, 'GITHUB_AUTH_FAILED');
      assert.ok(/rate limit/i.test(res.body?.message || ''));
      assert.ok(!JSON.stringify(res.body).includes('demo-org'));
    } finally {
      githubServiceApi.getUserRepositories = orig;
    }

    githubServiceApi.getUserRepositories = async () => { const e = new Error('Upstream error'); e.status = 500; throw e; };
    try {
      const res = mockRes();
      await getRepositories({ user: { userId: user.id } }, res, (e) => { throw e; });
      assert.equal(res.statusCode, 502);
      assert.equal(res.body?.success, false);
      assert.equal(res.body?.error, 'GITHUB_API_ERROR');
      assert.ok(/Upstream error/i.test(res.body?.message || ''));
      assert.ok(!JSON.stringify(res.body).includes('demo-org'));
    } finally {
      githubServiceApi.getUserRepositories = orig;
    }
  });

  console.log(`\nGitHub repos tests: ${pass} passed, ${fail} failed`);
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
