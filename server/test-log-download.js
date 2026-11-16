/**
 * @file test-log-download.js
 * @description Unit tests for raw log export and plain-text formatting.
 */

import assert from 'assert/strict';
import { downloadDeploymentLogs } from './src/controllers/deployment.controller.js';
import prisma from './src/config/db.js';

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL: ${name} -> ${err.message}`);
  }
}

console.log('Running log export and download unit tests...\n');

await test('downloadDeploymentLogs rejects non-UUID id', async () => {
  let statusCode = null;
  const req = { params: { id: 'invalid-id' }, user: { userId: 'u1' } };
  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; },
  };

  await downloadDeploymentLogs(req, res, (err) => { throw err; });
  assert.equal(statusCode, 400);
});

await test('downloadDeploymentLogs returns 404 when deployment not found', async () => {
  const origFind = prisma.deployment.findFirst;
  prisma.deployment.findFirst = async () => null;

  try {
    let statusCode = null;
    const req = { params: { id: '44444444-4444-4444-a444-444444444444' }, user: { userId: 'u1' } };
    const res = {
      status(code) { statusCode = code; return this; },
      json() { return this; },
    };

    await downloadDeploymentLogs(req, res, (err) => { throw err; });
    assert.equal(statusCode, 404);
  } finally {
    prisma.deployment.findFirst = origFind;
  }
});

await test('downloadDeploymentLogs formats plain text and sets attachment header', async () => {
  const origFind = prisma.deployment.findFirst;
  const origFindLogs = prisma.deploymentLog.findMany;

  const now = new Date('2026-11-16T08:30:00.000Z');
  prisma.deployment.findFirst = async () => ({
    id: '55555555-5555-4555-a555-555555555555',
    project: { name: 'Moviez' },
    createdAt: now,
  });

  prisma.deploymentLog.findMany = async () => [
    { id: 1n, createdAt: now, logLevel: 'INFO', stage: 'ORCHESTRATOR', source: 'ORCHESTRATOR', message: 'Pipeline initialized' },
    { id: 2n, createdAt: now, logLevel: 'WARN', stage: 'RENDER', source: 'PROVIDER', message: 'Build warning' },
  ];

  try {
    const headers = {};
    let sentBody = '';
    const req = { params: { id: '55555555-5555-4555-a555-555555555555' }, user: { userId: 'u1' } };
    const res = {
      setHeader(name, val) { headers[name] = val; },
      send(data) { sentBody = data; },
    };

    await downloadDeploymentLogs(req, res, (err) => { throw err; });
    assert.equal(headers['Content-Type'], 'text/plain; charset=utf-8');
    assert.ok(headers['Content-Disposition'].includes('deplo-Moviez-log-55555555.txt'));
    assert.ok(sentBody.includes('[INFO ] [ORCHESTRATOR/ORCHESTRATOR] Pipeline initialized'));
    assert.ok(sentBody.includes('[WARN ] [PROVIDER/RENDER] Build warning'));
  } finally {
    prisma.deployment.findFirst = origFind;
    prisma.deploymentLog.findMany = origFindLogs;
  }
});

console.log(`\nLog download unit tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
