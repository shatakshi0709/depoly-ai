/**
 * @file test-deployment-cancellation.js
 * @description Unit tests for deployment cancellation validation and state transitions.
 */

import assert from 'assert/strict';
import { cancelDeployment } from './src/controllers/deployment.controller.js';
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

console.log('Running deployment cancellation unit tests...\n');

await test('cancelDeployment rejects invalid UUID identifier', async () => {
  let statusCode = null;
  let body = null;
  const req = { params: { id: 'invalid-id' }, user: { userId: 'u1' } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { body = data; return this; },
  };

  await cancelDeployment(req, res, (err) => { throw err; });
  assert.equal(statusCode, 400);
  assert.equal(body.success, false);
});

await test('cancelDeployment returns 404 when deployment not found or not owned', async () => {
  const origFind = prisma.deployment.findFirst;
  prisma.deployment.findFirst = async () => null;

  try {
    let statusCode = null;
    let body = null;
    const req = { params: { id: '11111111-1111-4111-a111-111111111111' }, user: { userId: 'u1' } };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
    };

    await cancelDeployment(req, res, (err) => { throw err; });
    assert.equal(statusCode, 404);
  } finally {
    prisma.deployment.findFirst = origFind;
  }
});

await test('cancelDeployment rejects cancelling a SUCCESS deployment', async () => {
  const origFind = prisma.deployment.findFirst;
  prisma.deployment.findFirst = async () => ({
    id: '22222222-2222-4222-a222-222222222222',
    status: 'SUCCESS',
    project: { userId: 'u1' },
  });

  try {
    let statusCode = null;
    let body = null;
    const req = { params: { id: '22222222-2222-4222-a222-222222222222' }, user: { userId: 'u1' } };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
    };

    await cancelDeployment(req, res, (err) => { throw err; });
    assert.equal(statusCode, 400);
    assert.ok(body.message.includes('SUCCESS'));
  } finally {
    prisma.deployment.findFirst = origFind;
  }
});

await test('cancelDeployment successfully marks an active deployment CANCELLED', async () => {
  const origFind = prisma.deployment.findFirst;
  const origUpdate = prisma.deployment.update;
  const origLog = prisma.deploymentLog.create;

  prisma.deployment.findFirst = async () => ({
    id: '33333333-3333-4333-a333-333333333333',
    status: 'DEPLOYING_BACKEND',
    project: { userId: 'u1' },
  });
  prisma.deployment.update = async ({ data }) => ({
    id: '33333333-3333-4333-a333-333333333333',
    status: data.status,
    errorMessage: data.errorMessage,
  });
  prisma.deploymentLog.create = async () => ({ id: 1n });

  try {
    let statusCode = null;
    let body = null;
    const req = { params: { id: '33333333-3333-4333-a333-333333333333' }, user: { userId: 'u1' } };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
    };

    await cancelDeployment(req, res, (err) => { throw err; });
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'CANCELLED');
  } finally {
    prisma.deployment.findFirst = origFind;
    prisma.deployment.update = origUpdate;
    prisma.deploymentLog.create = origLog;
  }
});

console.log(`\nCancellation unit tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
