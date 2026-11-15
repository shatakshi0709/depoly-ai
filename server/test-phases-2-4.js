/**
 * Phases 2-4 integration checks (DB-backed, no external provider calls).
 * - Persistence & relations for projects/deployments/steps/logs/env vars/notifications
 * - Ownership isolation queries
 * - Status transitions and retry attempt history
 * - Provider/orchestrator log source distinction
 * Cleans up only records created by this test run.
 */
import assert from 'assert/strict';
import prisma from './src/config/db.js';
import { encrypt } from './src/utils/crypto.js';
import { DEPLOYMENT_STATUS, STEP_STATUS } from '@deplo/shared';

const tag = `p234_${Date.now()}`;
let created = { userIds: [], projectIds: [], deploymentIds: [], envIds: [], notificationIds: [] };

async function main() {
  console.log('Running Phases 2-4 DB tests...');

  // Create two users for isolation
  const u1 = await prisma.user.create({ data: { email: `${tag}_u1@test.local`, fullName: 'User One' } });
  const u2 = await prisma.user.create({ data: { email: `${tag}_u2@test.local`, fullName: 'User Two' } });
  created.userIds.push(u1.id, u2.id);

  // Project + services + env var persistence
  const project = await prisma.project.create({
    data: {
      userId: u1.id,
      name: `${tag}-project`,
      githubRepoFullName: 'org/repo',
      githubRepoUrl: 'https://github.com/org/repo',
      defaultBranch: 'main',
      detectedPreset: 'REACT_VITE',
      services: {
        create: [
          { serviceType: 'BACKEND', provider: 'RENDER', rootDirectory: '/server', buildCommand: 'npm install', startCommand: 'npm start', healthCheckPath: '/health' },
          { serviceType: 'FRONTEND', provider: 'VERCEL', rootDirectory: '/client', buildCommand: 'npm run build', startCommand: 'npm run preview' },
        ],
      },
    },
    include: { services: true },
  });
  created.projectIds.push(project.id);
  assert.equal(project.services.length, 2, 'services persisted');

  const envVar = await prisma.environmentVariable.create({
    data: { projectId: project.id, serviceTarget: 'BACKEND', key: 'DB_URL', valueEnc: encrypt('postgres://example'), isSecret: true },
  });
  created.envIds.push(envVar.id);
  const envRead = await prisma.environmentVariable.findUnique({ where: { id: envVar.id } });
  assert.ok(envRead && envRead.valueEnc && envRead.valueEnc !== 'postgres://example', 'env var encrypted at rest');

  // Ownership isolation
  const u1Projects = await prisma.project.findMany({ where: { userId: u1.id } });
  const u2Projects = await prisma.project.findMany({ where: { userId: u2.id, id: project.id } });
  assert.ok(u1Projects.some(p => p.id === project.id), 'owner can access project');
  assert.equal(u2Projects.length, 0, 'other user cannot access project');

  const ownedEnvDelete = await prisma.environmentVariable.deleteMany({ where: { id: envVar.id, projectId: project.id } });
  assert.equal(ownedEnvDelete.count, 1, 'scoped env delete works');
  const envVar2 = await prisma.environmentVariable.create({
    data: { projectId: project.id, serviceTarget: 'SHARED', key: 'API_KEY', valueEnc: encrypt('secret'), isSecret: true },
  });
  created.envIds.push(envVar2.id);
  const crossDelete = await prisma.environmentVariable.deleteMany({ where: { id: envVar2.id, projectId: '00000000-0000-0000-0000-000000000000' } });
  assert.equal(crossDelete.count, 0, 'env delete scoped to correct project');

  // Deployment + steps + logs persistence and status transitions
  const dep1 = await prisma.$transaction(async (tx) => {
    const d = await tx.deployment.create({
      data: {
        projectId: project.id,
        status: DEPLOYMENT_STATUS.ANALYZING,
        attemptNumber: 1,
        commitHash: 'abc1234',
        commitMessage: 'initial',
        triggeredBy: u1.email,
      },
    });
    await tx.deploymentStep.createMany({
      data: [
        { deploymentId: d.id, stepName: 'Repository Inspection', provider: 'GITHUB', stepOrder: 1, status: STEP_STATUS.RUNNING, startedAt: new Date() },
        { deploymentId: d.id, stepName: 'Backend Build & Deploy', provider: 'RENDER', stepOrder: 2, status: STEP_STATUS.PENDING },
      ],
    });
    await tx.deploymentLog.createMany({
      data: [
        { deploymentId: d.id, logLevel: 'INFO', source: 'ORCHESTRATOR', stage: 'ORCHESTRATOR', message: 'init' },
        { deploymentId: d.id, logLevel: 'INFO', source: 'PROVIDER', stage: 'RENDER', message: 'provider line' },
      ],
    });
    return d;
  });
  created.deploymentIds.push(dep1.id);

  const dep1Full = await prisma.deployment.findUnique({ where: { id: dep1.id }, include: { steps: true, logs: true } });
  assert.equal(dep1Full.steps.length, 2, 'steps persisted');
  assert.equal(dep1Full.logs.length, 2, 'logs persisted');
  assert.ok(dep1Full.logs.some(l => l.source === 'PROVIDER') && dep1Full.logs.some(l => l.source === 'ORCHESTRATOR'), 'log sources distinguished');

  await prisma.deployment.update({ where: { id: dep1.id }, data: { status: DEPLOYMENT_STATUS.DEPLOYING_BACKEND } });
  await prisma.deployment.update({ where: { id: dep1.id }, data: { status: DEPLOYMENT_STATUS.HEALTH_CHECKING, backendUrl: 'https://api.example.test' } });
  await prisma.deployment.update({ where: { id: dep1.id }, data: { status: DEPLOYMENT_STATUS.FAILED, errorMessage: 'simulated failure', completedAt: new Date(), renderServiceId: 'srv_1' } });
  const dep1Failed = await prisma.deployment.findUnique({ where: { id: dep1.id } });
  assert.equal(dep1Failed.status, DEPLOYMENT_STATUS.FAILED, 'failure transition persisted');
  assert.equal(dep1Failed.renderServiceId, 'srv_1', 'provider id persisted');

  // Retry creates separate attempt history linked to original
  const dep2 = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: DEPLOYMENT_STATUS.ANALYZING,
      attemptNumber: 2,
      retriedFromId: dep1.id,
      commitHash: dep1Failed.commitHash,
      commitMessage: `Retry of ${dep1.id}`,
      triggeredBy: u1.email,
    },
  });
  created.deploymentIds.push(dep2.id);
  await prisma.deployment.update({ where: { id: dep2.id }, data: { status: DEPLOYMENT_STATUS.SUCCESS, frontendUrl: 'https://app.example.test', backendUrl: 'https://api.example.test', vercelDeployId: 'dpl_1', durationSeconds: 42, completedAt: new Date() } });
  const dep2Done = await prisma.deployment.findUnique({ where: { id: dep2.id } });
  assert.equal(dep2Done.attemptNumber, 2, 'retry attempt number stored');
  assert.equal(dep2Done.retriedFromId, dep1.id, 'retry link stored');
  assert.equal(dep2Done.status, DEPLOYMENT_STATUS.SUCCESS, 'retry success stored');

  const history = await prisma.deployment.findMany({ where: { projectId: project.id }, orderBy: { startedAt: 'asc' } });
  assert.ok(history.length >= 2, 'separate attempt history persisted');

  // Notifications (user-specific persistence)
  const n = await prisma.notification.create({ data: { userId: u1.id, deploymentId: dep1.id, projectId: project.id, type: 'DEPLOYMENT_FAILED', title: 'Failed', message: 'msg' } });
  created.notificationIds.push(n.id);
  const myNotifs = await prisma.notification.findMany({ where: { userId: u1.id, id: n.id } });
  const otherNotifs = await prisma.notification.findMany({ where: { userId: u2.id, id: n.id } });
  assert.equal(myNotifs.length, 1, 'owner sees notification');
  assert.equal(otherNotifs.length, 0, 'other user cannot see notification');

  console.log('PHASES_2_4_DB_TESTS_PASS');
}

async function cleanup() {
  // delete only test-created records (children cascade where applicable)
  try {
    if (created.notificationIds.length) await prisma.notification.deleteMany({ where: { id: { in: created.notificationIds } } });
    if (created.deploymentIds.length) await prisma.deployment.deleteMany({ where: { id: { in: created.deploymentIds } } });
    if (created.envIds.length) await prisma.environmentVariable.deleteMany({ where: { id: { in: created.envIds } } });
    if (created.projectIds.length) await prisma.project.deleteMany({ where: { id: { in: created.projectIds } } });
    if (created.userIds.length) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  } catch (e) {
    console.error('Cleanup warning:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main().then(cleanup).then(() => process.exit(0)).catch(async (e) => {
  console.error('PHASES_2_4_DB_TESTS_FAIL', e);
  await cleanup();
  process.exit(1);
});
