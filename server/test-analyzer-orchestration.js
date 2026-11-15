/**
 * @file test-analyzer-orchestration.js
 * @description Regression tests for frontend-only classification and Render-skip orchestration.
 *
 * Root cause covered: a repository with no root backend manifest and a nested Vite
 * frontend was misclassified as fullstack because the analyzer fabricated a phantom
 * NODE_GENERIC backend at the repository root, causing executeOrchestration() to
 * provision a Render service that then failed.
 *
 * All GitHub access is stubbed through the `githubServiceApi` test seam; no live
 * GitHub requests, deployments, cloud resources, or database writes are performed.
 */
import assert from 'assert/strict';
import { githubServiceApi } from './src/services/github.service.js';
import { analyzeRepository, analyzeBackendComponent } from './src/services/analyzer.service.js';
import { isFrontendOnlyAnalysis } from './src/controllers/deployment.controller.js';
import { analyze } from './src/controllers/github.controller.js';
import { createProject, isValidBackendServiceInput } from './src/controllers/project.controller.js';
import prisma from './src/config/db.js';

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

/**
 * Install a stubbed repository tree/content map on the GitHub service seam.
 * Returns a restore function.
 */
function stubRepo(contentMap) {
  const originalTree = githubServiceApi.getRepositoryTree;
  const originalContent = githubServiceApi.getFileContent;
  githubServiceApi.getRepositoryTree = async () =>
    Object.keys(contentMap).map((path) => ({ path, type: 'blob' }));
  githubServiceApi.getFileContent = async (_owner, _repo, path) =>
    Object.prototype.hasOwnProperty.call(contentMap, path) ? contentMap[path] : null;
  return () => {
    githubServiceApi.getRepositoryTree = originalTree;
    githubServiceApi.getFileContent = originalContent;
  };
}

// ── Fixtures ───────────────────────────────────────────────────

// Exact shape of shatakshi0709/WAP-Grp-Project: no root manifest, nested Vite app.
const WAP_TREE = {
  'README.md': '# WAP Group Project',
  'vercel.json': '{}',
  'vite-project/package.json': JSON.stringify({
    name: 'vite-project',
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    devDependencies: { vite: '^8.0.0' },
    scripts: { build: 'vite build', preview: 'vite preview' },
  }),
  'vite-project/index.html': '<!doctype html><html></html>',
  'vite-project/src/main.jsx': 'console.log("app")',
};

const ROOT_EXPRESS_TREE = {
  'package.json': JSON.stringify({
    name: 'api',
    dependencies: { express: '^4.18.0' },
    scripts: { start: 'node index.js' },
  }),
  'index.js': 'app.listen(process.env.PORT)',
};

const MONOREPO_TREE = {
  'server/package.json': JSON.stringify({
    name: 'server',
    dependencies: { express: '^4.18.0' },
    scripts: { start: 'node index.js' },
  }),
  'server/index.js': 'app.listen(process.env.PORT)',
  'client/package.json': JSON.stringify({
    name: 'client',
    dependencies: { vite: '^5.0.0' },
    scripts: { build: 'vite build' },
  }),
  'client/index.html': '<!doctype html><html></html>',
};

// ── Tests ──────────────────────────────────────────────────────

await test('1. nested Vite repo with no root manifest => FRONTEND_ONLY (WAP-Grp-Project)', async () => {
  const restore = stubRepo(WAP_TREE);
  try {
    const analysis = await analyzeRepository('https://github.com/shatakshi0709/WAP-Grp-Project', 'main', null);
    assert.equal(analysis.applicationType, 'frontend_only', `Expected frontend_only, got ${analysis.applicationType}`);
    assert.equal(analysis.backend.detected, false, 'Backend must not be detected');
    assert.equal(analysis.frontend.detected, true, 'Frontend should be detected');
    assert.equal(analysis.frontend.rootDirectory, '/vite-project', `Expected /vite-project, got ${analysis.frontend.rootDirectory}`);
    assert.equal(analysis.frontend.framework, 'REACT_VITE');
    assert.deepEqual(analysis.orchestrationPlan.deploymentOrder, ['FRONTEND'], 'Frontend-only plan must not include BACKEND');
  } finally {
    restore();
  }
});

await test('2. no root backend manifest => analyzeBackendComponent returns null (no phantom NODE_GENERIC)', async () => {
  const restore = stubRepo(WAP_TREE);
  try {
    const backend = await analyzeBackendComponent('shatakshi0709', 'WAP-Grp-Project', '/', Object.keys(WAP_TREE), 'main', null);
    assert.equal(backend, null, `Expected null backend for manifest-less root, got ${JSON.stringify(backend)}`);
    // And via the full analyzer, never a NODE_GENERIC backend object.
    const analysis = await analyzeRepository('shatakshi0709/WAP-Grp-Project', 'main', null);
    assert.notEqual(analysis.backend?.framework, 'NODE_GENERIC', 'Must not fabricate a NODE_GENERIC backend');
    assert.equal(analysis.backend?.detected, false);
  } finally {
    restore();
  }
});

await test('3. executeOrchestration guard skips Render for frontend-only analyses', async () => {
  const restore = stubRepo(WAP_TREE);
  try {
    const frontendOnly = await analyzeRepository('shatakshi0709/WAP-Grp-Project', 'main', null);
    assert.equal(isFrontendOnlyAnalysis(frontendOnly), true, 'Frontend-only analysis must skip Render');

    // Defensive: a stale/malformed analysis with an undetected backend also skips Render.
    assert.equal(
      isFrontendOnlyAnalysis({ applicationType: 'single_repo', backend: { detected: false } }),
      true,
      'Undetected backend must skip Render'
    );
    assert.equal(isFrontendOnlyAnalysis(null), true, 'Missing analysis must skip Render');
    assert.equal(
      isFrontendOnlyAnalysis({ applicationType: 'frontend_only' }),
      true,
      'Explicit frontend_only must skip Render'
    );
  } finally {
    restore();
  }
});

await test('4. /analyze endpoint accepts frontend-only repositories (no ELECTRON_DESKTOP_APP)', async () => {
  const restore = stubRepo(WAP_TREE);
  const originalFindFirst = prisma.oAuthAccount.findFirst;
  prisma.oAuthAccount.findFirst = async () => null; // no linked OAuth account -> public repo path
  try {
    let statusCode = null;
    let body = null;
    const req = {
      user: { userId: 'test-user' },
      body: { repoUrl: 'https://github.com/shatakshi0709/WAP-Grp-Project', branch: 'main' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; },
    };

    await analyze(req, res, (err) => { throw err; });

    assert.equal(statusCode, null, `Expected success (no error status), got ${statusCode}`);
    assert.ok(body, 'Expected a JSON response body');
    assert.equal(body.success, true, `Expected success:true, got ${JSON.stringify(body)}`);
    assert.notEqual(body.error, 'ELECTRON_DESKTOP_APP', 'Frontend-only repo must not be reported as Electron');
    assert.equal(body.data.applicationType, 'frontend_only');
  } finally {
    prisma.oAuthAccount.findFirst = originalFindFirst;
    restore();
  }
});

await test('5. genuine root Express backend is still detected', async () => {
  const restore = stubRepo(ROOT_EXPRESS_TREE);
  try {
    const analysis = await analyzeRepository('owner/express-api', 'main', null);
    assert.equal(analysis.backend.detected, true, 'Express backend must be detected');
    assert.equal(analysis.backend.framework, 'EXPRESS_NODE');
    assert.equal(analysis.backend.rootDirectory, '/', `Expected root '/', got ${analysis.backend.rootDirectory}`);
  } finally {
    restore();
  }
});

await test('6. full-stack monorepo is still detected (server + client)', async () => {
  const restore = stubRepo(MONOREPO_TREE);
  try {
    const analysis = await analyzeRepository('owner/monorepo', 'main', null);
    assert.equal(analysis.applicationType, 'monorepo', `Expected monorepo, got ${analysis.applicationType}`);
    assert.equal(analysis.backend.detected, true);
    assert.equal(analysis.backend.framework, 'EXPRESS_NODE');
    assert.equal(analysis.backend.rootDirectory, '/server');
    assert.equal(analysis.frontend.detected, true);
    assert.equal(analysis.frontend.rootDirectory, '/client');
    assert.ok(analysis.orchestrationPlan.deploymentOrder.includes('BACKEND'), 'Full-stack plan must include BACKEND');
    assert.equal(isFrontendOnlyAnalysis(analysis), false, 'Full-stack analysis must provision Render');
  } finally {
    restore();
  }
});

await test('7. GitHub API test seams are injectable and observed by the analyzer', async () => {
  assert.equal(typeof githubServiceApi.getRepositoryTree, 'function', 'getRepositoryTree seam must exist');
  assert.equal(typeof githubServiceApi.getFileContent, 'function', 'getFileContent seam must exist');

  const seen = [];
  const originalTree = githubServiceApi.getRepositoryTree;
  githubServiceApi.getRepositoryTree = async (...args) => { seen.push(args); return []; };
  try {
    await analyzeRepository('owner/seam-check', 'main', null);
    assert.equal(seen.length, 1, 'Analyzer must call the injected getRepositoryTree seam');
    assert.equal(seen[0][0], 'owner');
    assert.equal(seen[0][1], 'seam-check');
  } finally {
    githubServiceApi.getRepositoryTree = originalTree;
  }
});

// ── GitHub inspection failure & project creation guards ────────

await test('8. GitHub inspection failure returns a clear error (no fabricated backend)', async () => {
  const originalTree = githubServiceApi.getRepositoryTree;
  const originalFindFirst = prisma.oAuthAccount.findFirst;
  githubServiceApi.getRepositoryTree = async () => { throw new Error('API rate limit exceeded'); };
  prisma.oAuthAccount.findFirst = async () => null;
  try {
    let statusCode = null;
    let body = null;
    const req = { user: { userId: 'test-user' }, body: { repoUrl: 'https://github.com/shatakshi0709/WAP-Grp-Project', branch: 'main' } };
    const res = { status(code) { statusCode = code; return this; }, json(payload) { body = payload; return this; } };

    await analyze(req, res, (err) => { throw err; });

    assert.equal(statusCode, 502, `Expected 502, got ${statusCode}`);
    assert.ok(body, 'Expected a JSON response body');
    assert.equal(body.success, false, 'Failure must not be reported as success');
    assert.equal(body.error, 'GITHUB_ANALYSIS_FAILED');
    assert.equal(body.isFallback, undefined, 'Heuristic fallback must be removed');
    assert.equal(body.data, undefined, 'Must not return fabricated analysis data');
    assert.ok(
      !JSON.stringify(body).includes('EXPRESS_NODE'),
      'Must never fabricate an EXPRESS_NODE backend on inspection failure'
    );
  } finally {
    githubServiceApi.getRepositoryTree = originalTree;
    prisma.oAuthAccount.findFirst = originalFindFirst;
  }
});

await test('9. createProject does not persist a phantom backend for frontend-only analysis', async () => {
  const originalTransaction = prisma.$transaction;
  const serviceCalls = [];
  prisma.$transaction = async (fn) => fn({
    project: { create: async ({ data }) => ({ id: 'proj_test_frontend_only', ...data }) },
    projectService: { create: async ({ data }) => { serviceCalls.push(data); return { id: `svc_${serviceCalls.length}`, ...data }; } },
  });
  try {
    let statusCode = null;
    let body = null;
    const req = {
      user: { userId: 'test-user' },
      body: {
        name: 'wap-frontend-only',
        githubRepoFullName: 'shatakshi0709/WAP-Grp-Project',
        githubRepoUrl: 'https://github.com/shatakshi0709/WAP-Grp-Project',
        defaultBranch: 'main',
        detectedPreset: 'FRONTEND_ONLY',
        // Phantom backend as returned by a frontend-only analysis (detected:false, all null).
        backendService: { detected: false, framework: null, rootDirectory: null, buildCommand: null, startCommand: null, healthCheckPath: null },
        frontendService: { rootDirectory: '/vite-project', buildCommand: 'npm run build', startCommand: 'npm run preview' },
      },
    };
    const res = { status(code) { statusCode = code; return this; }, json(payload) { body = payload; return this; } };

    await createProject(req, res, (err) => { throw err; });

    assert.equal(statusCode, 201, `Expected 201, got ${statusCode}`);
    assert.equal(body.success, true);
    assert.equal(serviceCalls.filter((s) => s.serviceType === 'BACKEND').length, 0, 'Must not persist a BACKEND service for frontend-only analysis');
    assert.equal(serviceCalls.filter((s) => s.serviceType === 'FRONTEND').length, 1, 'Should persist the FRONTEND service');
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

await test('10. createProject still persists a genuine backend service', async () => {
  const originalTransaction = prisma.$transaction;
  const serviceCalls = [];
  prisma.$transaction = async (fn) => fn({
    project: { create: async ({ data }) => ({ id: 'proj_test_backend', ...data }) },
    projectService: { create: async ({ data }) => { serviceCalls.push(data); return { id: `svc_${serviceCalls.length}`, ...data }; } },
  });
  try {
    const req = {
      user: { userId: 'test-user' },
      body: {
        name: 'genuine-backend',
        githubRepoFullName: 'owner/express-api',
        githubRepoUrl: 'https://github.com/owner/express-api',
        defaultBranch: 'main',
        detectedPreset: 'EXPRESS_NODE',
        backendService: { detected: true, rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start', healthCheckPath: '/health' },
      },
    };
    const res = { status() { return this; }, json() { return this; } };

    await createProject(req, res, (err) => { throw err; });

    const backendCalls = serviceCalls.filter((s) => s.serviceType === 'BACKEND');
    assert.equal(backendCalls.length, 1, 'Genuine backend must be persisted');
    assert.equal(backendCalls[0].provider, 'RENDER');
    assert.equal(backendCalls[0].rootDirectory, '/server');
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

await test('11. isValidBackendServiceInput rejects phantom/empty payloads', async () => {
  assert.equal(isValidBackendServiceInput(null), false);
  assert.equal(isValidBackendServiceInput({}), false);
  assert.equal(isValidBackendServiceInput({ detected: false, rootDirectory: '/x', buildCommand: 'a', startCommand: 'b' }), false);
  assert.equal(isValidBackendServiceInput({ rootDirectory: '   ', buildCommand: 'a', startCommand: 'b' }), false);
  assert.equal(isValidBackendServiceInput({ rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start' }), true);
});

console.log(`\nAnalyzer/orchestration regression tests: ${pass} passed, ${fail} failed`);
try {
  await prisma.$disconnect();
} catch {
  // best-effort disconnect; no database writes were performed
}
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
  process.exit(1);
}
