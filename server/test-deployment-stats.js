/**
 * @file test-deployment-stats.js
 * @description Unit tests for deployment metrics and statistical aggregations.
 */

import assert from 'assert/strict';
import { getDeploymentStats } from './src/controllers/deployment.controller.js';
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

console.log('Running deployment statistics unit tests...\n');

await test('getDeploymentStats handles zero deployments cleanly', async () => {
  const origFind = prisma.deployment.findMany;
  prisma.deployment.findMany = async () => [];

  try {
    let body = null;
    const req = { query: {}, user: { userId: 'u1' } };
    const res = {
      json(data) { body = data; return this; },
    };

    await getDeploymentStats(req, res, (err) => { throw err; });
    assert.equal(body.success, true);
    assert.equal(body.data.totalDeployments, 0);
    assert.equal(body.data.successRatePercentage, 0);
    assert.equal(body.data.averageDurationSeconds, 0);
  } finally {
    prisma.deployment.findMany = origFind;
  }
});

await test('getDeploymentStats computes counts, rates, and average durations correctly', async () => {
  const origFind = prisma.deployment.findMany;
  prisma.deployment.findMany = async () => [
    { status: 'SUCCESS', durationSeconds: 60, startedAt: new Date() },
    { status: 'SUCCESS', durationSeconds: 120, startedAt: new Date() },
    { status: 'FAILED', durationSeconds: 30, startedAt: new Date() },
    { status: 'CANCELLED', durationSeconds: null, startedAt: new Date() },
  ];

  try {
    let body = null;
    const req = { query: {}, user: { userId: 'u1' } };
    const res = {
      json(data) { body = data; return this; },
    };

    await getDeploymentStats(req, res, (err) => { throw err; });
    assert.equal(body.success, true);
    assert.equal(body.data.totalDeployments, 4);
    assert.equal(body.data.successCount, 2);
    assert.equal(body.data.failureCount, 1);
    assert.equal(body.data.cancelledCount, 1);
    assert.equal(body.data.successRatePercentage, 50); // 2 out of 4 = 50%
    assert.equal(body.data.averageDurationSeconds, 70); // (60 + 120 + 30) / 3 = 70
  } finally {
    prisma.deployment.findMany = origFind;
  }
});

console.log(`\nDeployment stats unit tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
