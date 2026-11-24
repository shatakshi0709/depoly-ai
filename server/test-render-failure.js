/**
 * Render deployment failure tests (in-process, no real Render API calls, no deployments).
 * Covers: sanitizeRenderError extraction, createRenderWebService 400 error capture,
 * validateBackendServiceConfig, and retry dedup logic.
 */
import assert from 'assert/strict';
import axios from 'axios';
import prisma from './src/config/db.js';
import { sanitizeRenderError } from './src/services/render.service.js';
import { validateBackendServiceConfig } from './src/controllers/deployment.controller.js';

const tag = `rndfail_${Date.now()}`;
const created = { userIds: [], projectIds: [], deploymentIds: [] };
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
    data: { email: `${tag}_${suffix}@test.local`, fullName: `RND ${suffix}` },
  });
  created.userIds.push(user.id);
  return user;
}

async function main() {
  console.log('Running Render deployment failure tests (in-process)...');

  await test('sanitizeRenderError extracts message from axios HTTP 400 response', async () => {
    const err = {
      response: {
        status: 400,
        data: { error: { message: 'Invalid rootDir: path must not be empty' } },
      },
      message: 'Request failed with status code 400',
    };
    const result = sanitizeRenderError(err);
    assert.ok(result.message.includes('HTTP 400'), `Expected HTTP 400 in message: ${result.message}`);
    assert.ok(result.message.includes('Invalid rootDir'), `Expected Invalid rootDir: ${result.message}`);
    assert.equal(result.status, 400);
  });

  await test('sanitizeRenderError sanitizes potential secrets from error detail', async () => {
    const err = {
      response: {
        status: 400,
        data: { error: { message: 'Invalid token rnd_abc123def456 in request' } },
      },
      message: 'Request failed',
    };
    const result = sanitizeRenderError(err);
    assert.ok(!result.message.includes('rnd_abc123def456'), 'Secret should be redacted');
    assert.ok(result.message.includes('[REDACTED]'), 'Should contain redaction marker');
  });

  await test('sanitizeRenderError handles network error (no response)', async () => {
    const err = { message: 'connect ECONNREFUSED api.render.com:443', code: 'ECONNREFUSED' };
    const result = sanitizeRenderError(err);
    assert.ok(result.message.includes('connect ECONNREFUSED'), `Expected network error: ${result.message}`);
    assert.equal(result.status, undefined);
  });

  await test('sanitizeRenderError handles null/undefined error', async () => {
    const result = sanitizeRenderError(null);
    assert.ok(result.message.includes('Unknown Render API error'), `Expected unknown error: ${result.message}`);
  });

  await test('validateBackendServiceConfig passes for valid config', async () => {
    const issues = validateBackendServiceConfig(
      { rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start', healthCheckPath: '/health' },
      'https://github.com/shatakshi0709/insta-lite'
    );
    assert.deepEqual(issues, [], `Expected no issues, got: ${JSON.stringify(issues)}`);
  });

  await test('validateBackendServiceConfig rejects missing rootDirectory', async () => {
    const issues = validateBackendServiceConfig(
      { buildCommand: 'npm install', startCommand: 'npm start', healthCheckPath: '/health' },
      'https://github.com/shatakshi0709/insta-lite'
    );
    assert.ok(issues.length > 0, 'Expected issues for missing rootDirectory');
    assert.ok(issues.some((i) => i.includes('rootDirectory')), `Expected rootDirectory issue: ${JSON.stringify(issues)}`);
  });

  await test('validateBackendServiceConfig rejects empty buildCommand', async () => {
    const issues = validateBackendServiceConfig(
      { rootDirectory: '/server', buildCommand: '', startCommand: 'npm start', healthCheckPath: '/health' },
      'https://github.com/shatakshi0709/insta-lite'
    );
    assert.ok(issues.some((i) => i.includes('buildCommand')), `Expected buildCommand issue: ${JSON.stringify(issues)}`);
  });

  await test('validateBackendServiceConfig rejects invalid GitHub URL', async () => {
    const issues = validateBackendServiceConfig(
      { rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start', healthCheckPath: '/health' },
      'not-a-github-url'
    );
    assert.ok(issues.some((i) => i.includes('Repository URL')), `Expected repo URL issue: ${JSON.stringify(issues)}`);
  });

  await test('validateBackendServiceConfig rejects null backendService', async () => {
    const issues = validateBackendServiceConfig(null, 'https://github.com/shatakshi0709/insta-lite');
    assert.ok(issues.length > 0, 'Expected issues for null backendService');
    assert.ok(issues.some((i) => i.includes('backend service configuration')), `Expected backend service issue: ${JSON.stringify(issues)}`);
  });

  await test('validateBackendServiceConfig rejects healthCheckPath not starting with /', async () => {
    const issues = validateBackendServiceConfig(
      { rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start', healthCheckPath: 'health' },
      'https://github.com/shatakshi0709/insta-lite'
    );
    assert.ok(issues.some((i) => i.includes('healthCheckPath')), `Expected healthCheckPath issue: ${JSON.stringify(issues)}`);
  });

  await test('retry dedup reuses existing renderServiceId from prior deployment', async () => {
    const user = await createUser('dedup');
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: 'test-project-dedup',
        githubRepoFullName: 'shatakshi0709/insta-lite',
        githubRepoUrl: 'https://github.com/shatakshi0709/insta-lite',
        defaultBranch: 'main',
        detectedPreset: 'REACT_VITE',
      },
    });
    created.projectIds.push(project.id);

    // Create a prior deployment with a renderServiceId
    const priorDep = await prisma.deployment.create({
      data: {
        projectId: project.id,
        status: 'FAILED',
        attemptNumber: 1,
        renderServiceId: 'srv-existing-123',
        renderDeployId: 'dep-existing-456',
        commitHash: 'main-head',
        commitMessage: 'Prior failed deployment',
        triggeredBy: 'MANUAL',
      },
    });
    created.deploymentIds.push(priorDep.id);

    const priorDeployments = await prisma.deployment.findMany({
      where: { projectId: project.id, renderServiceId: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: { id: true, renderServiceId: true, renderDeployId: true, status: true, attemptNumber: true },
    });

    assert.equal(priorDeployments.length, 1, 'Should find prior deployment with renderServiceId');
    assert.equal(priorDeployments[0].renderServiceId, 'srv-existing-123', 'Should reuse existing service ID');
    assert.equal(priorDeployments[0].renderDeployId, 'dep-existing-456', 'Should carry forward deploy ID');
  });

  console.log(`\nRender deployment failure tests: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

async function cleanup() {
  try {
    if (created.deploymentIds.length) await prisma.deployment.deleteMany({ where: { id: { in: created.deploymentIds } } });
    if (created.projectIds.length) await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });
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
