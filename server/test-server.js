/**
 * @file test-server.js
 * @description Automated test script verifying Server, PostgreSQL connection, and Auth APIs.
 */

import http from 'http';
import axios from 'axios';
import { env } from './src/config/env.js';
import prisma from './src/config/db.js';

async function runTests() {
  console.log('🧪 Starting deplo.ai Backend & Database Verification Suite...\n');

  const BASE_URL = `http://localhost:${env.PORT}`;

  try {
    // 1. Test Database connection directly via Prisma
    console.log('1️⃣ Testing PostgreSQL connection via Prisma...');
    const dbCheck = await prisma.$queryRaw`SELECT current_database(), current_user, version()`;
    console.log(`   ✅ DB Connected! Database: "${dbCheck[0].current_database}", User: "${dbCheck[0].current_user}"`);

    // 2. Test Analytical View created for college requirements
    console.log('\n2️⃣ Testing Analytical View (v_project_deployment_metrics)...');
    const viewMetrics = await prisma.$queryRaw`SELECT * FROM v_project_deployment_metrics`;
    console.log(`   ✅ SQL View Query Succeeded! Returned ${viewMetrics.length} projects with window calculations.`);
    if (viewMetrics.length > 0) {
      console.log(`   📊 Project: ${viewMetrics[0].project_name} | Success Rate: ${viewMetrics[0].success_rate_percentage}% | Avg Duration: ${viewMetrics[0].avg_duration_seconds}s`);
    }

    // 3. Test HTTP Health Endpoint
    console.log('\n3️⃣ Testing Server Health Route (GET /api/v1/health)...');
    const healthRes = await axios.get(`${BASE_URL}/api/v1/health`);
    console.log(`   ✅ Health Route Status: ${healthRes.status} | Service: ${healthRes.data.service}`);

    // 4. Test Database Health Route
    console.log('\n4️⃣ Testing DB Health Route (GET /api/v1/health/db)...');
    const dbHealthRes = await axios.get(`${BASE_URL}/api/v1/health/db`);
    console.log(`   ✅ DB Health Status: ${dbHealthRes.status} | Latency: ${dbHealthRes.data.latencyMs}ms`);

    // 5. Test User Registration Route
    console.log('\n5️⃣ Testing User Registration (POST /api/v1/auth/register)...');
    const testEmail = `test_${Date.now()}@deplo.ai`;
    const regRes = await axios.post(`${BASE_URL}/api/v1/auth/register`, {
      email: testEmail,
      password: 'SecurePassword123!',
      fullName: 'Test Engineer',
    });
    console.log(`   ✅ Registered User ID: ${regRes.data.data.user.id}`);
    const token = regRes.data.data.token;

    // 6. Test User Login Route
    console.log('\n6️⃣ Testing User Login (POST /api/v1/auth/login)...');
    const loginRes = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
      email: testEmail,
      password: 'SecurePassword123!',
    });
    console.log(`   ✅ Login Successful! JWT Token received.`);

    // 7. Test Protected Route with JWT Header
    console.log('\n7️⃣ Testing Authenticated User Profile (GET /api/v1/auth/me)...');
    const meRes = await axios.get(`${BASE_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`   ✅ Authenticated Profile: ${meRes.data.data.fullName} (${meRes.data.data.email})`);

    console.log('\n=======================================================');
    console.log('🎉 ALL BACKEND & DATABASE TESTS PASSED WITH 100% SUCCESS!');
    console.log('=======================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:');
    if (error.response) {
      console.error(`HTTP ${error.response.status}:`, error.response.data);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

// Start test
runTests();
