/**
 * @file test-e2e.js
 * @description End-to-End Orchestration & Database Integration Verification Suite.
 */

import axios from 'axios';
import { io } from 'socket.io-client';
import { env } from './src/config/env.js';
import prisma from './src/config/db.js';
import { SOCKET_EVENTS, DEPLOYMENT_STATUS } from '@deplo/shared';

const BASE_URL = `http://localhost:${env.PORT}/api/v1`;

async function runE2ETests() {
  console.log('🧪 Starting deplo.ai Complete E2E Integration Suite...\n');

  try {
    // 1. Authenticate user
    console.log('1️⃣ Authenticating test engineer...');
    const email = `dev_${Date.now()}@deplo.ai`;
    const regRes = await axios.post(`${BASE_URL}/auth/register`, {
      email,
      password: 'StrongPassword123!',
      fullName: 'Alex Cloud Architect',
    });
    const token = regRes.data.data.token;
    console.log(`   ✅ Auth Successful: ${regRes.data.data.user.fullName} (${email})`);

    const client = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${token}` },
    });

    // 2. Create full-stack project (Render Backend + Vercel Frontend)
    console.log('\n2️⃣ Creating project with Render & Vercel services...');
    const projRes = await client.post('/projects', {
      name: 'cloud-commerce',
      githubRepoFullName: 'university-team/cloud-commerce',
      githubRepoUrl: 'https://github.com/university-team/cloud-commerce',
      defaultBranch: 'main',
      detectedPreset: 'REACT_VITE',
      backendService: {
        rootDirectory: '/server',
        buildCommand: 'npm install',
        startCommand: 'npm start',
        healthCheckPath: '/api/health',
      },
      frontendService: {
        rootDirectory: '/client',
        buildCommand: 'npm run build',
        startCommand: 'npm run preview',
      },
    });

    const project = projRes.data.data;
    console.log(`   ✅ Project Created: "${project.name}" (ID: ${project.id})`);

    // 3. Connect to real-time Socket.IO gateway
    console.log('\n3️⃣ Connecting Socket.IO client gateway...');
    const socket = io(`http://localhost:${env.PORT}`, { transports: ['websocket'] });

    await new Promise((resolve) => {
      socket.on('connect', () => {
        console.log(`   ✅ Socket.IO connected with socket id: ${socket.id}`);
        resolve();
      });
    });

    // 4. Trigger deployment orchestration
    console.log('\n4️⃣ Triggering deployment orchestration pipeline...');
    const deployRes = await client.post('/projects/deployments/trigger', {
      projectId: project.id,
      commitMessage: 'feat: add payment gateway and product catalog',
    });

    const deployment = deployRes.data.data;
    console.log(`   ✅ Deployment Triggered! ID: ${deployment.id} | Initial Status: ${deployment.status}`);

    // Join deployment room to stream real-time events
    socket.emit(SOCKET_EVENTS.JOIN_DEPLOYMENT, { deploymentId: deployment.id });

    // 5. Stream live logs and wait for completion
    console.log('\n5️⃣ Listening to live orchestration logs and state machine...');
    let logCount = 0;
    socket.on(SOCKET_EVENTS.DEPLOYMENT_LOG, (log) => {
      logCount++;
      console.log(`   📡 [LIVE LOG] [${log.stage}] ${log.message}`);
    });

    const finalDeployment = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Deployment timed out after 30 seconds'));
      }, 30000);

      socket.on(SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, (data) => {
        console.log(`   ⚡ [STATUS TRANSITION] Status is now: ${data.status}`);
        if (data.status === DEPLOYMENT_STATUS.SUCCESS) {
          clearTimeout(timeout);
          resolve(data);
        } else if (data.status === DEPLOYMENT_STATUS.FAILED) {
          clearTimeout(timeout);
          reject(new Error(`Deployment failed: ${data.error}`));
        }
      });
    });

    console.log('\n6️⃣ Orchestration Pipeline Completed!');
    console.log(`   🌐 Render Backend URL:  ${finalDeployment.backendUrl}`);
    console.log(`   🌐 Vercel Frontend URL: ${finalDeployment.frontendUrl}`);
    console.log(`   📋 Total Real-time Logs Streamed: ${logCount}`);

    // 7. Verify Academic SQL View
    console.log('\n7️⃣ Querying College SQL View (v_project_deployment_metrics)...');
    const analyticsRes = await client.get('/projects/analytics');
    const metrics = analyticsRes.data.data;
    console.log(`   ✅ View Query Result:`, metrics);

    socket.disconnect();

    console.log('\n=============================================================');
    console.log('🎉 COMPLETE END-TO-END ORCHESTRATION & DATABASE TEST PASSED!');
    console.log('=============================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ E2E test failed:', error.message);
    if (error.response) {
      console.error(error.response.data);
    }
    process.exit(1);
  }
}

runE2ETests();
