/**
 * OAuth state & callback validation tests (no external GitHub calls).
 * Requires running server at http://localhost:5001 with current env.
 */
import assert from 'assert/strict';
import axios from 'axios';
import { env } from './src/config/env.js';
import { createOAuthState, verifyOAuthState } from './src/utils/oauthState.js';

const BASE = `http://localhost:${env.PORT}/api/v1`;
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

function client() {
  return axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 10000 });
}

async function main() {
  console.log('Running OAuth state tests...');

  await test('oauth start returns signed state and authorize URL (or 503 if unconfigured)', async () => {
    const res = await client().get('/auth/github/start');
    if (res.status === 503) {
      assert.ok(res.data?.message);
      return;
    }
    assert.equal(res.status, 200);
    assert.ok(res.data?.data?.state);
    assert.ok(res.data?.data?.authorizeUrl);
    assert.ok(res.data?.data?.redirectUri);
    const v = verifyOAuthState(res.data.data.state);
    assert.equal(v.ok, true);
    assert.ok(String(res.data.data.authorizeUrl).includes(encodeURIComponent(res.data.data.state)) || String(res.data.data.authorizeUrl).includes('state='));
  });

  await test('callback rejects missing state', async () => {
    const res = await client().post('/auth/github', { code: 'dummy-code' });
    assert.equal(res.status, 400);
    assert.ok(/state/i.test(res.data?.message || ''));
  });

  await test('callback rejects mismatched/invalid state', async () => {
    const res = await client().post('/auth/github', { code: 'dummy-code', state: 'not.a.valid.signature' });
    assert.equal(res.status, 400);
    assert.ok(/invalid/i.test(res.data?.message || '') || /expired/i.test(res.data?.message || ''));
  });

  await test('callback rejects expired state', async () => {
    // craft expired payload signed with same secret logic via internal module behavior by using create then tamper? easier: simulate by creating state and waiting impossible; instead sign manually
    // Use verify path by constructing expired token through module is not exported; emulate by setting env expectation: create state then monkeypatch time not possible across process.
    // So generate a state and assert verifyOAuthState rejects crafted expired one via direct helper approach: build using crypto inline same as module.
    const crypto = await import('crypto');
    const payload = { n: 'x', exp: Date.now() - 1000, m: { t: 'github_oauth' } };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', env.JWT_SECRET).update(payloadB64).digest('base64url');
    const expired = `${payloadB64}.${sig}`;
    const v = verifyOAuthState(expired);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'expired');
    const res = await client().post('/auth/github', { code: 'dummy-code', state: expired });
    assert.equal(res.status, 400);
    assert.ok(/expired/i.test(res.data?.message || ''));
  });

  await test('callback rejects tampered state signature', async () => {
    const st = createOAuthState({ t: 'github_oauth' });
    const tampered = st.slice(0, -2) + (st.slice(-2) === 'aa' ? 'bb' : 'aa');
    const v = verifyOAuthState(tampered);
    assert.equal(v.ok, false);
    const res = await client().post('/auth/github', { code: 'dummy-code', state: tampered });
    assert.equal(res.status, 400);
  });

  await test('valid signed unexpired state passes server-side verification (exchange may fail without real GitHub code, but not due to state)', async () => {
    // Obtain state from start endpoint when configured; ensures same signing context as server.
    const start = await client().get('/auth/github/start');
    let state;
    if (start.status === 200) {
      state = start.data.data.state;
    } else {
      // fallback: locally created state uses same env secret in this process
      state = createOAuthState({ t: 'github_oauth' });
    }
    const res = await client().post('/auth/github', { code: 'dummy-code-not-from-github', state });
    // Acceptable outcomes: 400 from GitHub exchange failure/config, 503 if not configured, but NOT a state-invalid/expired message.
    assert.ok([400, 503, 429].includes(res.status), `unexpected status ${res.status}`);
    const msg = String(res.data?.message || '');
    assert.ok(!/invalid oauth state/i.test(msg), `state incorrectly rejected: ${msg}`);
    assert.ok(!/oauth session expired/i.test(msg), `state incorrectly expired: ${msg}`);
  });

  console.log(`\nOAuth state tests: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
