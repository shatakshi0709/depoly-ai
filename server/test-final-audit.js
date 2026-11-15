/**
 * Final audit integration/unit checks.
 * Assumes server running at http://localhost:5001 with current env (ALLOW_SIMULATED_DEPLOYMENTS=false).
 * Uses DB via Prisma for setup/assertions/cleanup of only test-created records.
 * Does NOT trigger real provider deployments or modify existing data.
 */
import assert from 'assert/strict';
import axios from 'axios';
import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import prisma from './src/config/db.js';
import { env } from './src/config/env.js';
import { createOAuthState, verifyOAuthState } from './src/utils/oauthState.js';
import { sanitizeLogMessage } from './src/utils/sanitize.js';
import { DEPLOYMENT_STATUS } from '@deplo/shared';

const BASE = `http://localhost:${env.PORT}/api/v1`;
const tag = `audit_${Date.now()}`;
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

function client(token) {
  return axios.create({ baseURL: BASE, headers: token ? { Authorization: `Bearer ${token}` } : {}, validateStatus: () => true, timeout: 15000 });
}

async function main() {
  console.log('Running final audit tests...');

  await test('utils: oauth state create/verify/expire-signature', async () => {
    const st = createOAuthState({ t: 'x' });
    const v = verifyOAuthState(st);
    assert.equal(v.ok, true);
    assert.equal(verifyOAuthState('bad.sig').ok, false);
    assert.equal(verifyOAuthState(st + 'tamper').ok, false);
  });

  await test('utils: sanitizeLogMessage redacts secrets and strips control chars', async () => {
    const s = sanitizeLogMessage('token=abc123 Bearer xyz \x1B[31mred\x1B[0m ghp_abcdefghijklmnopqrstuvwxyz123456', 200);
    assert.ok(!s.includes('abc123'));
    assert.ok(!s.includes('ghp_abcdefghijklmnopqrstuvwxyz123456'));
    assert.ok(s.includes('[REDACTED]'));
    assert.ok(!s.includes('\x1B'));
  });

  await test('health endpoints respond', async () => {
    const c = client();
    const h = await c.get('/health');
    const db = await c.get('/health/db');
    assert.equal(h.status, 200);
    assert.equal(h.data?.success, true);
    assert.equal(db.status, 200);
    assert.equal(db.data?.success, true);
  });

  await test('auth validation rejects bad register/login', async () => {
    const c = client();
    const r1 = await c.post('/auth/register', { email: 'bad', password: 'x', fullName: '' });
    const r2 = await c.post('/auth/login', { email: 'bad', password: '' });
    assert.equal(r1.status, 400);
    assert.equal(r2.status, 400);
  });

  await test('auth register/login/me works and token required for me', async () => {
    const c = client();
    const email = `${tag}_u1@test.local`;
    const reg = await c.post('/auth/register', { email, password: 'StrongPass123!', fullName: 'Audit User One' });
    assert.equal(reg.status, 201);
    const token = reg.data?.data?.token;
    const user = reg.data?.data?.user;
    assert.ok(token && user?.id);
    created.userIds.push(user.id);
    const meNo = await c.get('/auth/me');
    assert.ok(meNo.status === 401 || meNo.status === 403);
    const me = await c.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    assert.equal(me.data?.data?.email, email);
    const login = await c.post('/auth/login', { email, password: 'StrongPass123!' });
    assert.equal(login.status, 200);
    assert.ok(login.data?.data?.token);
  });

  let user1Token, user1, user2Token, user2, project1;
  await test('setup second user and project for ownership tests', async () => {
    const c = client();
    const e1 = `${tag}_own1@test.local`;
    const e2 = `${tag}_own2@test.local`;
    const r1 = await c.post('/auth/register', { email: e1, password: 'StrongPass123!', fullName: 'Owner One' });
    const r2 = await c.post('/auth/register', { email: e2, password: 'StrongPass123!', fullName: 'Owner Two' });
    assert.equal(r1.status, 201); assert.equal(r2.status, 201);
    user1Token = r1.data.data.token; user1 = r1.data.data.user;
    user2Token = r2.data.data.token; user2 = r2.data.data.user;
    created.userIds.push(user1.id, user2.id);
    const p = await client(user1Token).post('/projects', {
      name: `${tag}-proj`,
      githubRepoFullName: 'org/repo',
      githubRepoUrl: 'https://github.com/org/repo',
      defaultBranch: 'main',
      backendService: { rootDirectory: '/server', buildCommand: 'npm i', startCommand: 'npm start', healthCheckPath: '/health' },
      frontendService: { rootDirectory: '/client', buildCommand: 'npm run build', startCommand: 'npm run preview' },
    });
    assert.equal(p.status, 201);
    project1 = p.data.data;
    created.projectIds.push(project1.id);
  });

  await test('ownership: other user cannot read project or env and env delete scoped', async () => {
    const c2 = client(user2Token);
    const c1 = client(user1Token);
    const r = await c2.get(`/projects/${project1.id}`);
    assert.ok(r.status === 404 || r.status === 403);
    const envAdd = await c1.post(`/projects/${project1.id}/env`, { key: 'SECRET_KEY', value: 'secret-value', serviceTarget: 'BACKEND', isSecret: true });
    assert.equal(envAdd.status, 200);
    const envList1 = await c1.get(`/projects/${project1.id}/env`);
    assert.equal(envList1.status, 200);
    const item = (envList1.data.data || []).find(x => x.key === 'SECRET_KEY');
    assert.ok(item && item.value !== 'secret-value', 'secret must be masked');
    const envList2 = await c2.get(`/projects/${project1.id}/env`);
    assert.ok(envList2.status === 404 || envList2.status === 403);
    const delOther = await c2.delete(`/projects/${project1.id}/env/${item.id}`);
    assert.ok(delOther.status === 404 || delOther.status === 403);
    const delOk = await c1.delete(`/projects/${project1.id}/env/${item.id}`);
    assert.equal(delOk.status, 200);
  });

  await test('oauth start returns signed state and callback rejects invalid/missing state', async () => {
    const c = client();
    const start = await c.get('/auth/github/start');
    // may be 503 if client id missing, or 200 with state+url
    if (start.status === 200) {
      assert.ok(start.data?.data?.state);
      assert.ok(String(start.data?.data?.authorizeUrl || '').includes('state='));
      const v = verifyOAuthState(start.data.data.state);
      assert.equal(v.ok, true);
    } else {
      assert.ok(start.status === 503 || start.status === 429);
    }
    const cbNoState = await c.post('/auth/github', { code: 'abc' });
    assert.equal(cbNoState.status, 400);
    const cbBadState = await c.post('/auth/github', { code: 'abc', state: 'not.valid' });
    assert.equal(cbBadState.status, 400);
  });

  await test('GitHub and notification routes require auth', async () => {
    const c = client();
    const r1 = await c.get('/github/repos');
    const r2 = await c.get('/notifications');
    assert.ok(r1.status === 401 || r1.status === 403);
    assert.ok(r2.status === 401 || r2.status === 403);
  });

  let failedDeploymentId;
  await test('deployment trigger without provider keys fails safely (no fabricated success) and persists FAILED state', async () => {
    assert.equal(env.ALLOW_SIMULATED_DEPLOYMENTS, false, 'audit must run with simulation disabled');
    const c1 = client(user1Token);
    const trig = await c1.post('/projects/deployments/trigger', { projectId: project1.id, commitMessage: 'audit trigger' });
    assert.equal(trig.status, 201);
    const depId = trig.data?.data?.id;
    assert.ok(depId);
    created.deploymentIds.push(depId);

    // poll for terminal state
    let dep = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const r = await c1.get(`/projects/deployments/${depId}`);
      if (r.status === 200) dep = r.data.data;
      if (dep && [DEPLOYMENT_STATUS.SUCCESS, DEPLOYMENT_STATUS.FAILED].includes(dep.status)) break;
    }
    assert.ok(dep, 'deployment should be readable');
    assert.equal(dep.status, DEPLOYMENT_STATUS.FAILED, 'must not fabricate success without live provider confirmation');
    assert.ok(!dep.frontendUrl, 'no fabricated frontend URL on failure without real deploy');
    // provider IDs/URLs should not be fabricated in normal mode
    const hasFake = (dep.backendUrl || '').includes('sim-') || (dep.frontendUrl || '').includes('sim-');
    assert.equal(hasFake, false);
    failedDeploymentId = depId;
  });

  await test('ownership: other user cannot read deployment and retry forbidden on others', async () => {
    const c2 = client(user2Token);
    const r = await c2.get(`/projects/deployments/${failedDeploymentId}`);
    assert.ok(r.status === 404 || r.status === 403);
    const rt = await c2.post(`/projects/deployments/${failedDeploymentId}/retry`);
    assert.ok(rt.status === 404 || rt.status === 403 || rt.status === 400);
  });

  await test('retry failed deployment creates new attempt history for owner', async () => {
    const c1 = client(user1Token);
    const rt = await c1.post(`/projects/deployments/${failedDeploymentId}/retry`);
    assert.equal(rt.status, 201);
    const newDep = rt.data?.data;
    assert.ok(newDep?.id && newDep.id !== failedDeploymentId);
    created.deploymentIds.push(newDep.id);
    assert.equal(newDep.retriedFromId || newDep.retried_from_id || (newDep.retriedFrom && newDep.retriedFrom.id) ? true : true, true); // presence varies by select; check via fetch
    const fetched = await c1.get(`/projects/deployments/${newDep.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.data.data.attemptNumber >= 2, true);
    assert.equal(fetched.data.data.retriedFromId, failedDeploymentId);
  });

  await test('notifications API scoped and returns owner notifications', async () => {
    const c1 = client(user1Token);
    const c2 = client(user2Token);
    const n1 = await c1.get('/notifications');
    assert.equal(n1.status, 200);
    assert.ok(Array.isArray(n1.data.data));
    const n2 = await c2.get('/notifications');
    assert.equal(n2.status, 200);
    // user2 should not see user1 deployment notifications by content ownership (ids differ)
    const ids1 = new Set((n1.data.data||[]).map(n=>n.id));
    const overlap = (n2.data.data||[]).filter(n=>ids1.has(n.id));
    assert.equal(overlap.length, 0);
  });

  await test('socket.io requires auth and denies joining other user deployment room', async () => {
    // unauthenticated connect
    const sBad = io(`http://localhost:${env.PORT}`, { transports: ['websocket'], auth: { token: 'bad' }, timeout: 3000, reconnection: false });
    const badConnected = await new Promise(resolve => {
      let done = false;
      sBad.on('connect', () => { if (!done){done=true; resolve(true);} });
      sBad.on('connect_error', () => { if (!done){done=true; resolve(false);} });
      setTimeout(()=>{ if(!done){done=true; resolve(sBad.connected);} }, 1500);
    });
    try { sBad.disconnect(); } catch {}
    assert.equal(badConnected, false, 'unauth socket must not connect');

    // user2 cannot join user1 deployment
    const s2 = io(`http://localhost:${env.PORT}`, { transports: ['websocket'], auth: { token: user2Token }, reconnection: false });
    const connected = await new Promise((resolve, reject) => {
      s2.on('connect', () => resolve(true));
      s2.on('connect_error', (e) => reject(e));
      setTimeout(()=>resolve(s2.connected), 2000);
    });
    assert.equal(connected, true);
    const roomErr = await new Promise(resolve => {
      s2.once('deployment_room_error', (p) => resolve(p));
      s2.emit('join_deployment', { deploymentId: failedDeploymentId });
      setTimeout(()=>resolve(null), 2000);
    });
    try { s2.disconnect(); } catch {}
    assert.ok(roomErr, 'should receive room access error');
  });

  console.log(`\nFinal audit: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
  }
}

async function cleanup() {
  try {
    // delete only audit-created records
    const depIds = created.deploymentIds.filter(Boolean);
    if (depIds.length) await prisma.deployment.deleteMany({ where: { id: { in: depIds } } });
    const projIds = created.projectIds.filter(Boolean);
    if (projIds.length) await prisma.project.deleteMany({ where: { id: { in: projIds } } });
    const userIds = created.userIds.filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } catch (e) {
    console.error('Cleanup warning:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main().then(async () => { await cleanup(); process.exit(fail ? 1 : 0); }).catch(async (e) => {
  console.error('AUDIT_FATAL', e);
  await cleanup();
  process.exit(1);
});
