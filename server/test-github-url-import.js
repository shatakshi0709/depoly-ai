/**
 * @file test-github-url-import.js
 * @description Regression tests for GitHub repository URL import functionality.
 * Covers: URL validation, normalization, branch extraction, metadata endpoint error
 * handling. All provider calls are mocked — no real deployments or GitHub API calls.
 */
import assert from 'assert/strict';
import axios from 'axios';
import prisma from './src/config/db.js';
import {
  parseGitHubUrl,
  normalizeGitHubUrl,
} from './src/services/github.service.js';
import { getMetadata } from './src/controllers/github.controller.js';

const tag = `urlimport_${Date.now()}`;
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
    data: { email: `${tag}_${suffix}@test.local`, fullName: `URL ${suffix}` },
  });
  created.userIds.push(user.id);
  return user;
}

async function main() {
  console.log('Running GitHub URL import regression tests (in-process, provider calls mocked)...');

  // ── URL parsing & validation ──────────────────────────────────────

  await test('parseGitHubUrl extracts owner/repo from simple URL', async () => {
    const result = parseGitHubUrl('https://github.com/shatakshi0709/insta-lite');
    assert.ok(result, 'Should return parsed result');
    assert.equal(result.owner, 'shatakshi0709');
    assert.equal(result.repo, 'insta-lite');
    assert.equal(result.branch, null);
  });

  await test('parseGitHubUrl extracts branch from /tree/ URL', async () => {
    const result = parseGitHubUrl('https://github.com/shatakshi0709/insta-lite/tree/main');
    assert.ok(result, 'Should return parsed result');
    assert.equal(result.owner, 'shatakshi0709');
    assert.equal(result.repo, 'insta-lite');
    assert.equal(result.branch, 'main');
  });

  await test('parseGitHubUrl extracts branch from /blob/ URL', async () => {
    const result = parseGitHubUrl('https://github.com/shatakshi0709/insta-lite/blob/develop/src/App.jsx');
    assert.ok(result, 'Should return parsed result');
    assert.equal(result.owner, 'shatakshi0709');
    assert.equal(result.repo, 'insta-lite');
    assert.equal(result.branch, 'develop');
  });

  await test('parseGitHubUrl handles owner/repo shorthand', async () => {
    const result = parseGitHubUrl('shatakshi0709/insta-lite');
    assert.ok(result);
    assert.equal(result.owner, 'shatakshi0709');
    assert.equal(result.repo, 'insta-lite');
    assert.equal(result.branch, null);
  });

  await test('parseGitHubUrl handles git@ SSH URL', async () => {
    const result = parseGitHubUrl('git@github.com:shatakshi0709/insta-lite.git');
    assert.ok(result);
    assert.equal(result.owner, 'shatakshi0709');
    assert.equal(result.repo, 'insta-lite');
  });

  await test('parseGitHubUrl returns null for non-GitHub URLs', async () => {
    assert.equal(parseGitHubUrl('https://gitlab.com/owner/repo'), null);
    assert.equal(parseGitHubUrl('https://bitbucket.org/owner/repo'), null);
    assert.equal(parseGitHubUrl('not-a-url'), null);
    assert.equal(parseGitHubUrl('https://github.com/'), null);
    assert.equal(parseGitHubUrl('https://github.com/onlyone'), null);
  });

  await test('normalizeGitHubUrl returns canonical URL', async () => {
    const result = normalizeGitHubUrl('https://github.com/shatakshi0709/insta-lite/tree/main');
    assert.equal(result, 'https://github.com/shatakshi0709/insta-lite');
  });

  await test('normalizeGitHubUrl strips .git and trailing slash', async () => {
    const result = normalizeGitHubUrl('https://github.com/shatakshi0709/insta-lite.git/');
    assert.equal(result, 'https://github.com/shatakshi0709/insta-lite');
  });

  // ── Metadata endpoint error handling (no Octokit mocking needed) ─

  await test('getMetadata returns 400 for invalid URL', async () => {
    const user = await createUser('meta1');
    const req = {
      user: { userId: user.id },
      query: { repoUrl: 'not-a-valid-url' },
      headers: {},
    };
    const res = mockRes();
    await getMetadata(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(/invalid/i.test(res.body.message));
  });

  await test('getMetadata returns 400 when no URL provided', async () => {
    const user = await createUser('meta2');
    const req = {
      user: { userId: user.id },
      query: {},
      headers: {},
    };
    const res = mockRes();
    await getMetadata(req, res, (e) => { throw e; });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });

  await test('getMetadata returns 404 for nonexistent repo', async () => {
    const user = await createUser('meta3');
    const origGet = axios.get;
    axios.get = async () => {
      const err = new Error('Not Found');
      err.status = 404;
      err.response = { status: 404, data: { message: 'Not Found' } };
      throw err;
    };
    try {
      const req = {
        user: { userId: user.id },
        query: { repoUrl: 'https://github.com/nonexistent/repo' },
        headers: {},
      };
      const res = mockRes();
      await getMetadata(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.ok(/not found/i.test(res.body.message));
    } finally {
      axios.get = origGet;
    }
  });

  await test('getMetadata returns 404 for private repo without token', async () => {
    const user = await createUser('meta4');
    const origGet = axios.get;
    axios.get = async () => {
      const err = new Error('Not Found');
      err.status = 404;
      err.response = { status: 404, data: { message: 'Not Found' } };
      throw err;
    };
    try {
      const req = {
        user: { userId: user.id },
        query: { repoUrl: 'https://github.com/private/repo' },
        headers: {},
      };
      const res = mockRes();
      await getMetadata(req, res, (e) => { throw e; });
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.ok(/not found/i.test(res.body.message));
    } finally {
      axios.get = origGet;
    }
  });

  console.log(`\nGitHub URL import tests: ${pass} passed, ${fail} failed`);
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
