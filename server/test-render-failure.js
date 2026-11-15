/**
 * Render deployment failure tests (in-process, no real Render API calls, no deployments).
 * Covers: sanitizeRenderError extraction, createRenderWebService 400 error capture,
 * validateBackendServiceConfig, retry dedup logic, and Render ownerId/workspace lookup.
 */
import assert from 'assert/strict';
import axios from 'axios';
import prisma from './src/config/db.js';
import { sanitizeRenderError, getRenderOwnerId, getRenderOwners, getOwnerDiagnostic, createRenderWebService, listRenderServices } from './src/services/render.service.js';
import { validateBackendServiceConfig } from './src/controllers/deployment.controller.js';
import { env } from './src/config/env.js';

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

  // ── getRenderOwnerId tests (mocked axios.create) ──────────────────

  await test('getRenderOwnerId returns null when no API key', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = undefined;
    try {
      const result = await getRenderOwnerId();
      assert.equal(result, null, 'Should return null when no API key');
    } finally {
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('getRenderOwnerId returns null when multiple workspaces (never arbitrarily selects)', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_multi';
    const mockClient = { get: async () => ({ status: 200, data: [{ owner: { id: 'ws_a', name: 'Workspace A' } }, { owner: { id: 'ws_b', name: 'Workspace B' } }] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const id = await getRenderOwnerId();
      assert.equal(id, null, 'Should return null for multiple workspaces');
      const diag = getOwnerDiagnostic();
      assert.equal(diag.statusCode, 200);
      assert.equal(diag.entryCount, 2);
      assert.equal(diag.hasOwnerId, true);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('getRenderOwnerId returns null when no accessible workspaces', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_empty';
    const mockClient = { get: async () => ({ status: 200, data: [] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const id = await getRenderOwnerId();
      assert.equal(id, null, 'Should return null when no workspaces');
      const diag = getOwnerDiagnostic();
      assert.equal(diag.statusCode, 200);
      assert.equal(diag.entryCount, 0);
      assert.equal(diag.hasOwnerId, false);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('getRenderOwnerId returns null when entries lack owner.id', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_noid';
    const mockClient = { get: async () => ({ status: 200, data: [{ name: 'Workspace without ID' }] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const id = await getRenderOwnerId();
      assert.equal(id, null, 'Should return null when entries lack owner.id');
      const diag = getOwnerDiagnostic();
      assert.equal(diag.statusCode, 200);
      assert.equal(diag.entryCount, 0);
      assert.equal(diag.hasOwnerId, false);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('getRenderOwnerId returns null on invalid API key (HTTP 401)', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'invalid_key';
    const mockClient = { get: async () => { throw Object.assign(new Error('Unauthorized'), { response: { status: 401, data: { message: 'Invalid API key' } } }); } };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const id = await getRenderOwnerId();
      assert.equal(id, null, 'Should return null on invalid API key');
      const diag = getOwnerDiagnostic();
      assert.equal(diag.statusCode, 401);
      assert.ok(diag.errorMessage.includes('HTTP 401'));
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('createRenderWebService throws when no ownerId available', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_no_owner';
    const mockClient = { get: async () => ({ data: [] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      await createRenderWebService({
        name: 'test-svc',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
      });
      assert.fail('Should have thrown when no ownerId is available');
    } catch (e) {
      assert.ok(e.message.includes('ownerId'), `Expected ownerId in error message: ${e.message}`);
      assert.ok(e.message.includes('workspace'), `Expected workspace in error message: ${e.message}`);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  // The one-workspace test runs LAST because getRenderOwnerId caches its result
  // for the process lifetime, which would cause earlier tests to return the cached value.
  await test('getRenderOwnerId returns workspace ID from nested owner.id when one workspace', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_single';
    const mockClient = { get: async () => ({ status: 200, data: [{ owner: { id: 'ws_alpha_123', name: 'Alpha Workspace' } }] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const id = await getRenderOwnerId();
      assert.equal(id, 'ws_alpha_123', 'Should return nested owner.id');
      const diag = getOwnerDiagnostic();
      assert.equal(diag.statusCode, 200);
      assert.equal(diag.entryCount, 1);
      assert.equal(diag.hasOwnerId, true);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('getOwnerDiagnostic returns safe info without secrets', async () => {
    const diag = getOwnerDiagnostic();
    assert.ok(typeof diag.statusCode === 'number' || diag.statusCode === null);
    assert.ok(typeof diag.entryCount === 'number');
    assert.ok(typeof diag.hasOwnerId === 'boolean');
    assert.ok(diag.errorMessage === null || typeof diag.errorMessage === 'string');
    const diagStr = JSON.stringify(diag);
    assert.ok(!diagStr.includes('test_key'), 'Diagnostic must not contain API key');
    assert.ok(!diagStr.includes('Bearer'), 'Diagnostic must not contain auth header');
  });

  // ── createRenderWebService payload structure tests ──────────────────

  await test('createRenderWebService sends payload with envSpecificDetails', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_payload';
    let capturedPayload = null;
    const mockClient = {
      get: async () => ({ status: 200, data: [{ owner: { id: 'ws_payload', name: 'Payload Workspace' } }] }),
      post: async (url, data) => {
        capturedPayload = data;
        return { data: { service: { id: 'srv_123', serviceDetails: { url: 'https://test.onrender.com' } } } };
      },
    };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const result = await createRenderWebService({
        name: 'Test Service',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
        rootDir: '/server',
        buildCommand: 'npm install',
        startCommand: 'npm start',
        envVars: [{ key: 'NODE_ENV', value: 'production' }],
        runtime: 'node',
      });
      assert.ok(result, 'Should return service result');
      assert.equal(result.serviceId, 'srv_123');

      // Verify payload structure
      assert.equal(capturedPayload.type, 'web_service');
      assert.equal(capturedPayload.repo, 'https://github.com/owner/repo');
      assert.equal(capturedPayload.branch, 'main');
      assert.equal(capturedPayload.rootDir, 'server');

      const sd = capturedPayload.serviceDetails;
      assert.ok(sd, 'serviceDetails must be present');
      assert.equal(sd.runtime, 'node', 'runtime must be set');
      assert.equal(sd.plan, 'free', 'plan must be free by default');
      assert.equal(sd.region, 'oregon', 'region must be oregon');
      assert.ok(sd.envSpecificDetails, 'envSpecificDetails must be present');
      assert.equal(sd.envSpecificDetails.buildCommand, 'npm install');
      assert.equal(sd.envSpecificDetails.startCommand, 'npm start');
      assert.ok(sd.envVars, 'envVars must be present');
      assert.equal(sd.envVars[0].key, 'NODE_ENV');
      assert.equal(sd.envVars[0].value, 'production');
      assert.equal(sd.healthCheckPath, '/health');

      // ownerId must be included
      assert.ok(capturedPayload.ownerId, 'ownerId must be present in payload');
      assert.ok(typeof capturedPayload.ownerId === 'string', 'ownerId must be a string');
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('createRenderWebService throws when buildCommand is missing', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_nobuild';
    const mockClient = { get: async () => ({ status: 200, data: [{ owner: { id: 'ws_nobuild', name: 'No Build' } }] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      await createRenderWebService({
        name: 'test-svc',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
        buildCommand: '',
        startCommand: 'npm start',
      });
      assert.fail('Should have thrown when buildCommand is missing');
    } catch (e) {
      assert.ok(e.message.includes('buildCommand'), `Expected buildCommand in error: ${e.message}`);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('createRenderWebService throws when startCommand is missing', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_nostart';
    const mockClient = { get: async () => ({ status: 200, data: [{ owner: { id: 'ws_nostart', name: 'No Start' } }] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      await createRenderWebService({
        name: 'test-svc',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
        buildCommand: 'npm install',
        startCommand: '',
      });
      assert.fail('Should have thrown when startCommand is missing');
    } catch (e) {
      assert.ok(e.message.includes('startCommand'), `Expected startCommand in error: ${e.message}`);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('createRenderWebService accepts explicit paid plan with explicitPaidPlan=true', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_paid';
    let capturedPayload = null;
    const mockClient = {
      get: async () => ({ status: 200, data: [{ owner: { id: 'ws_paid', name: 'Paid Workspace' } }] }),
      post: async (url, data) => {
        capturedPayload = data;
        return { data: { service: { id: 'srv_paid', serviceDetails: { url: 'https://paid.onrender.com' } } } };
      },
    };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const result = await createRenderWebService({
        name: 'Paid Service',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
        rootDir: '/server',
        buildCommand: 'npm install',
        startCommand: 'npm start',
        plan: 'starter',
        explicitPaidPlan: true,
      });
      assert.ok(result, 'Should return service result');
      assert.equal(result.serviceId, 'srv_paid');

      const sd = capturedPayload.serviceDetails;
      assert.ok(sd, 'serviceDetails must be present');
      assert.equal(sd.plan, 'starter', 'plan must be starter when explicitly selected');
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('createRenderWebService throws on paid plan without explicitPaidPlan', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_silent';
    const mockClient = { get: async () => ({ status: 200, data: [{ owner: { id: 'ws_silent', name: 'Silent' } }] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      await createRenderWebService({
        name: 'Silent Paid Service',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
        rootDir: '/server',
        buildCommand: 'npm install',
        startCommand: 'npm start',
        plan: 'starter',
        // No explicitPaidPlan - should throw
      });
      assert.fail('Should have thrown when paid plan used without explicit consent');
    } catch (e) {
      assert.ok(e.message.includes('paid plan'), `Expected paid plan error: ${e.message}`);
      assert.ok(e.message.includes('explicit selection'), `Expected explicit selection message: ${e.message}`);
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  // ── listRenderServices tests ───────────────────────────────────

  await test('listRenderServices returns empty array when no services', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_empty_services';
    const mockClient = { get: async () => ({ status: 200, data: [] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const result = await listRenderServices();
      assert.ok(Array.isArray(result), 'Should return an array');
      assert.equal(result.length, 0, 'Should return empty array when no services');
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  await test('listRenderServices returns existing services with correct data', async () => {
    const origKey = env.RENDER_API_KEY;
    env.RENDER_API_KEY = 'test_key_with_services';
    const mockClient = { get: async () => ({ status: 200, data: [{ id: 'srv_1', name: 'desktop-application', serviceDetails: { url: 'https://desktop-application.onrender.com' } }] }) };
    const origCreate = axios.create;
    axios.create = () => mockClient;
    try {
      const result = await listRenderServices();
      assert.ok(Array.isArray(result), 'Should return an array');
      assert.equal(result.length, 1, 'Should return one service');
      assert.equal(result[0].id, 'srv_1', 'Service ID should match');
      assert.equal(result[0].name, 'desktop-application', 'Service name should match');
      assert.equal(result[0].url, 'https://desktop-application.onrender.com', 'Service URL should match');
      assert.equal(result[0].simulated, false, 'Should not be simulated');
    } finally {
      axios.create = origCreate;
      env.RENDER_API_KEY = origKey;
    }
  });

  // ── Frontend-only deployment tests ───────────────────────────────

  await test('validateBackendServiceConfig rejects null backend (frontend-only)', async () => {
    const issues = validateBackendServiceConfig(null, 'https://github.com/owner/repo');
    assert.ok(issues.length > 0, 'Should reject null backend service');
    assert.ok(issues.some((i) => i.includes('No backend service configuration')), `Expected backend service config error: ${JSON.stringify(issues)}`);
  });

  await test('validateBackendServiceConfig rejects backend without rootDirectory', async () => {
    const issues = validateBackendServiceConfig(
      { buildCommand: 'npm install', startCommand: 'npm start' },
      'https://github.com/owner/repo'
    );
    assert.ok(issues.some((i) => i.includes('rootDirectory')), `Expected rootDirectory error: ${JSON.stringify(issues)}`);
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
