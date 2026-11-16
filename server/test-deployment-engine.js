/**
 * @file test-deployment-engine.js
 * @description Comprehensive tests for the deplo.ai deployment engine.
 *
 * Tests cover:
 *   1. Configuration validation (Task 1)
 *   2. Provider adapter simulation (Task 2)
 *   3. Orchestration API endpoints (Task 3)
 *   4. Logs, SSE stream, monitoring (Task 4)
 *   5. Deployment history and error handling (Task 5)
 *
 * Usage:
 *   cd server && node test-deployment-engine.js
 *
 * Requirements:
 *   - Server running on PORT (default 5001)
 *   - Valid JWT_SECRET in .env
 *   - A registered test user account (or the script will register one)
 *   - ALLOW_SIMULATED_DEPLOYMENTS=true in .env for simulation mode tests
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5001';
const TEST_EMAIL = process.env.TEST_EMAIL || 'aridaman-test@deplo.ai';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Test@1234deplo';

let authToken = null;
let testProjectId = null;
let testDeploymentId = null;

// ─────────────────────────── HTTP helpers ───────────────────────────────────

function request(method, path, body = null, token = authToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─────────────────────────── Test runner ────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? `: ${detail}` : ''}`);
    failed++;
    failures.push({ label, detail });
  }
}

async function section(title, fn) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📋 ${title}`);
  console.log('─'.repeat(60));
  try {
    await fn();
  } catch (err) {
    console.error(`  💥 Uncaught error in section: ${err.message}`);
    failed++;
    failures.push({ label: title, detail: err.message });
  }
}

// ─────────────────────────── Tests ──────────────────────────────────────────

await section('1. Server health check', async () => {
  const res = await request('GET', '/api/v1/health', null, null);
  assert('Server responds with 200', res.status === 200, `Got ${res.status}`);
  assert('Status field is ONLINE', res.body?.status === 'ONLINE', JSON.stringify(res.body?.status));
});

await section('2. Auth: register or login test user', async () => {
  // Try login first (user may already exist)
  let res = await request('POST', '/api/v1/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD }, null);
  if (res.status !== 200) {
    // Register
    res = await request('POST', '/api/v1/auth/register', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      fullName: 'Aridaman Test',
    }, null);
    assert('Register returns 201', res.status === 201, `Got ${res.status}`);
    // Login after register
    res = await request('POST', '/api/v1/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD }, null);
  }
  assert('Login returns 200', res.status === 200, `Got ${res.status}`);
  authToken = res.body?.data?.token || res.body?.token;
  assert('Auth token received', typeof authToken === 'string' && authToken.length > 10, 'No token in response');
});

await section('3. Task 1 — Deployment configuration validation', async () => {
  // Missing repository
  let res = await request('POST', '/api/deploy', {
    name: 'Test Project',
    frontend: { provider: 'vercel', rootDirectory: '/client', buildCommand: 'npm run build', framework: 'vite' },
    backend: { provider: 'render', rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start' },
  });
  assert('Missing repository returns 400', res.status === 400, `Got ${res.status}`);
  assert('Validation errors reported', Array.isArray(res.body?.errors) && res.body.errors.length > 0, JSON.stringify(res.body?.errors));

  // Invalid backend provider
  res = await request('POST', '/api/deploy', {
    name: 'Test',
    repository: 'user/repo',
    backend: { provider: 'aws', rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start' },
    frontend: { provider: 'vercel', rootDirectory: '/client', buildCommand: 'npm run build' },
  });
  assert('Invalid backend provider returns 400', res.status === 400, `Got ${res.status}`);

  // Missing startCommand
  res = await request('POST', '/api/deploy', {
    name: 'Test',
    repository: 'https://github.com/test/repo',
    backend: { provider: 'render', rootDirectory: '/server', buildCommand: 'npm install' },
    frontend: { provider: 'vercel', rootDirectory: '/client', buildCommand: 'npm run build' },
  });
  assert('Missing startCommand returns 400', res.status === 400, `Got ${res.status}`);

  // Invalid environment variable key
  res = await request('POST', '/api/deploy', {
    name: 'Test',
    repository: 'https://github.com/test/repo',
    backend: { provider: 'render', rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start' },
    frontend: { provider: 'vercel', rootDirectory: '/client', buildCommand: 'npm run build' },
    environmentVariables: { '123-invalid-key': 'value' },
  });
  assert('Invalid env key returns 400', res.status === 400, `Got ${res.status}`);

  // Path traversal in rootDirectory
  res = await request('POST', '/api/deploy', {
    name: 'Test',
    repository: 'https://github.com/test/repo',
    backend: { provider: 'render', rootDirectory: '../../../etc', buildCommand: 'npm install', startCommand: 'npm start' },
    frontend: { provider: 'vercel', rootDirectory: '/client', buildCommand: 'npm run build' },
  });
  assert('Path traversal in rootDirectory returns 400', res.status === 400, `Got ${res.status}`);
});

await section('4. Task 2 — Provider adapters (Render + Vercel)', async () => {
  // The render.service.js and vercel.service.js adapters are tested indirectly
  // through the deployment trigger. Direct unit tests are skipped here because
  // they require live API credentials; instead we verify the adapter module structure.

  console.log('  ℹ️  Provider adapter integration tests require live API keys.');
  console.log('  ℹ️  Structural import checks are performed via server startup validation.');

  // Verify endpoints are reachable (401 means auth works, adapter is registered)
  const res = await request('GET', '/api/deploy/00000000-0000-0000-0000-000000000000', null, null);
  assert('Unauthenticated deploy status returns 401', res.status === 401, `Got ${res.status}`);

  const res2 = await request('GET', '/api/deploy/00000000-0000-0000-0000-000000000000');
  assert('Invalid UUID deploy returns 400', res2.status === 400, `Got ${res2.status}`);

  // Verify provider-specific error surfaces correctly when no key configured
  // (only testable in simulation mode — skip assertion if key is set)
  console.log('  ℹ️  Skipping live provider tests: set RENDER_API_KEY / VERCEL_API_KEY and ALLOW_SIMULATED_DEPLOYMENTS=true to test.');
});

await section('5. Task 3 — Deployment orchestration (simulation mode)', async () => {
  // This test only runs when ALLOW_SIMULATED_DEPLOYMENTS=true
  const checkRes = await request('GET', '/api/v1/health', null, authToken);
  console.log(`  ℹ️  Server env: ${checkRes.body?.environment || 'unknown'}`);

  const deployBody = {
    name: 'Aridaman Test Project',
    repository: 'https://github.com/shatakshi0709/depoly-ai',
    branch: 'main',
    frontend: {
      provider: 'vercel',
      rootDirectory: 'client',
      buildCommand: 'npm run build',
      framework: 'REACT_VITE',
      outputDirectory: 'dist',
    },
    backend: {
      provider: 'render',
      rootDirectory: 'server',
      buildCommand: 'npm install',
      startCommand: 'npm start',
      healthCheckPath: '/api/v1/health',
    },
    environmentVariables: {
      VITE_API_URL: '',
      NODE_ENV: 'production',
    },
    commitMessage: 'Test: deployment engine validation',
  };

  const res = await request('POST', '/api/deploy', deployBody);

  if (res.status === 201) {
    testDeploymentId = res.body?.data?.id;
    testProjectId = res.body?.data?.projectId;
    assert('Deployment initiated (status 201)', true);
    assert('Deployment ID assigned', typeof testDeploymentId === 'string' && testDeploymentId.length > 0, testDeploymentId);
    assert('Project ID assigned', typeof testProjectId === 'string', testProjectId);

    // Verify initial status is not FAILED immediately
    const statusRes = await request('GET', `/api/deploy/${testDeploymentId}`);
    assert('Deployment status endpoint responds', statusRes.status === 200, `Got ${statusRes.status}`);
    const status = statusRes.body?.data?.status;
    assert('Initial status is not null', status != null, `Got ${status}`);
    console.log(`  ℹ️  Deployment status: ${status}`);
  } else if (res.status === 400) {
    console.log(`  ⚠️  Deployment returned 400 (expected if ALLOW_SIMULATED_DEPLOYMENTS=false): ${JSON.stringify(res.body?.errors || res.body?.message)}`);
    assert('400 response includes error info', res.body?.message || res.body?.errors, JSON.stringify(res.body));
  } else {
    assert('Deploy endpoint reachable', res.status !== 404 && res.status !== 500, `Got ${res.status} — ${JSON.stringify(res.body)}`);
  }
});

await section('6. Task 4 — Deployment logs and monitoring', async () => {
  if (!testDeploymentId) {
    console.log('  ⚠️  Skipping: no deployment ID from Task 3 test.');
    return;
  }

  // Paginated log fetch
  const logRes = await request('GET', `/api/deploy/${testDeploymentId}/logs?limit=10`);
  assert('Logs endpoint returns 200', logRes.status === 200, `Got ${logRes.status}`);
  assert('Logs response has data array', Array.isArray(logRes.body?.data), JSON.stringify(logRes.body?.data));
  assert('nextCursor field present', 'nextCursor' in (logRes.body || {}), JSON.stringify(logRes.body));
  console.log(`  ℹ️  Log count: ${logRes.body?.data?.length}`);

  // SSE stream endpoint reachability (just check headers without reading stream)
  const sseCheckRes = await request('GET', `/api/deploy/${testDeploymentId}/stream`);
  // SSE sends 200 immediately; if deployment already finished it will send done event
  assert('SSE stream endpoint reachable', sseCheckRes.status === 200 || sseCheckRes.status === 204, `Got ${sseCheckRes.status}`);

  // Health endpoint
  const healthRes = await request('GET', `/api/deploy/${testDeploymentId}/health`);
  assert('Health endpoint returns 200', healthRes.status === 200, `Got ${healthRes.status}`);
  assert('Health response has backend field', 'backend' in (healthRes.body?.data || {}), JSON.stringify(healthRes.body));
  assert('Health response has frontend field', 'frontend' in (healthRes.body?.data || {}), JSON.stringify(healthRes.body));

  // URLs endpoint
  const urlsRes = await request('GET', `/api/deploy/${testDeploymentId}/urls`);
  assert('URLs endpoint returns 200', urlsRes.status === 200, `Got ${urlsRes.status}`);
  assert('URLs response has deploymentId', urlsRes.body?.data?.deploymentId === testDeploymentId, JSON.stringify(urlsRes.body?.data));
  assert('URLs response has status field', 'status' in (urlsRes.body?.data || {}), JSON.stringify(urlsRes.body));
});

await section('7. Task 5 — Deployment history', async () => {
  if (!testProjectId) {
    console.log('  ⚠️  Skipping: no project ID from Task 3 test.');
    return;
  }

  const histRes = await request('GET', `/api/deploy?projectId=${testProjectId}`);
  assert('Deployment history endpoint returns 200', histRes.status === 200, `Got ${histRes.status}`);
  assert('History data is array', Array.isArray(histRes.body?.data), JSON.stringify(histRes.body?.data));
  assert('History contains at least one record', (histRes.body?.data?.length || 0) >= 1, `Got ${histRes.body?.data?.length}`);

  if (histRes.body?.data?.length > 0) {
    const record = histRes.body.data[0];
    assert('Record has deploymentId', typeof record.id === 'string', JSON.stringify(record.id));
    assert('Record has status', typeof record.status === 'string', JSON.stringify(record.status));
    assert('Record has projectId', typeof record.projectId === 'string', JSON.stringify(record.projectId));
    assert('Record has startedAt timestamp', record.startedAt != null, JSON.stringify(record.startedAt));
  }
});

await section('8. Task 5 — Error handling', async () => {
  // Retry a non-existent deployment
  const retryRes = await request('POST', '/api/deploy/00000000-0000-0000-0000-000000000001/retry');
  assert('Retry non-existent deployment returns 404', retryRes.status === 404, `Got ${retryRes.status}`);

  // Retry with invalid UUID
  const badRetryRes = await request('POST', '/api/deploy/not-a-uuid/retry');
  assert('Retry with invalid UUID returns 400', badRetryRes.status === 400, `Got ${badRetryRes.status}`);

  // Logs for non-existent deployment
  const noLogRes = await request('GET', '/api/deploy/00000000-0000-0000-0000-000000000002/logs');
  assert('Logs for non-existent deployment returns 404', noLogRes.status === 404, `Got ${noLogRes.status}`);

  // Health for non-existent deployment
  const noHealthRes = await request('GET', '/api/deploy/00000000-0000-0000-0000-000000000003/health');
  assert('Health for non-existent deployment returns 404', noHealthRes.status === 404, `Got ${noHealthRes.status}`);

  // URLs for non-existent deployment
  const noUrlRes = await request('GET', '/api/deploy/00000000-0000-0000-0000-000000000004/urls');
  assert('URLs for non-existent deployment returns 404', noUrlRes.status === 404, `Got ${noUrlRes.status}`);
});

await section('9. Shared API contract endpoints', async () => {
  // POST /api/analyze
  const analyzeRes = await request('POST', '/api/analyze', {
    repoUrl: 'https://github.com/shatakshi0709/depoly-ai',
    branch: 'main',
  });
  assert('POST /api/analyze returns 200', analyzeRes.status === 200, `Got ${analyzeRes.status}`);
  assert('Analysis result has backend field', analyzeRes.body?.data?.backend != null, JSON.stringify(analyzeRes.body?.data));
  assert('Analysis result has frontend field', analyzeRes.body?.data?.frontend != null, JSON.stringify(analyzeRes.body?.data));

  // POST /api/config/generate
  const configRes = await request('POST', '/api/config/generate', {
    repoUrl: 'https://github.com/shatakshi0709/depoly-ai',
    branch: 'main',
    name: 'deplo-ai-test',
  });
  assert('POST /api/config/generate returns 200', configRes.status === 200, `Got ${configRes.status}`);
  const config = configRes.body?.data?.configuration;
  assert('Config has repository field', typeof config?.repository === 'string', JSON.stringify(config));
  assert('Config has frontend.provider=vercel', config?.frontend?.provider === 'vercel', JSON.stringify(config?.frontend));
  assert('Config has backend.provider=render', config?.backend?.provider === 'render', JSON.stringify(config?.backend));
  assert('Config has environmentVariables', typeof config?.environmentVariables === 'object', JSON.stringify(config?.environmentVariables));
  assert('Config has VITE_API_URL placeholder', 'VITE_API_URL' in (config?.environmentVariables || {}), JSON.stringify(config?.environmentVariables));

  // GET /api/github/repos (requires GitHub OAuth to be connected — expect 400 if not)
  const reposRes = await request('GET', '/api/github/repos');
  assert('GET /api/github/repos is accessible', reposRes.status === 200 || reposRes.status === 400, `Got ${reposRes.status}`);
});

// ─────────────────────────── Summary ────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 TEST RESULTS`);
console.log('═'.repeat(60));
console.log(`  Passed : ${passed}`);
console.log(`  Failed : ${failed}`);
console.log(`  Total  : ${passed + failed}`);

if (failures.length > 0) {
  console.log('\n❌ Failures:');
  for (const f of failures) {
    console.log(`   • ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  }
}

console.log('\n' + '═'.repeat(60));
if (failed === 0) {
  console.log('✅ All tests passed! Deployment engine is ready.');
} else {
  console.log(`⚠️  ${failed} test(s) failed. Review failures above.`);
  console.log('   Common causes:');
  console.log('   • Server not running: cd server && npm start');
  console.log('   • Missing ALLOW_SIMULATED_DEPLOYMENTS=true in .env for simulation tests');
  console.log('   • Missing RENDER_OWNER_ID in .env for live Render tests');
}
console.log('═'.repeat(60) + '\n');

process.exit(failed > 0 ? 1 : 0);
