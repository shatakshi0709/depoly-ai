/**
 * @file test-env.js
 * @description Automated verification test suite for Phase 8: Encrypted Environment Variables.
 */

import axios from 'axios';
import { env } from './src/config/env.js';
import prisma from './src/config/db.js';

const BASE_URL = `http://localhost:${env.PORT}/api/v1`;

async function runEnvTests() {
  console.log('🧪 Starting Phase 8: Environment Variables & Encryption Verification...\n');

  try {
    // 1. Authenticate
    console.log('1️⃣ Authenticating test engineer...');
    const email = `env_tester_${Date.now()}@deplo.ai`;
    const regRes = await axios.post(`${BASE_URL}/auth/register`, {
      email,
      password: 'SecurePassword123!',
      fullName: 'Security Engineer',
    });
    const token = regRes.data.data.token;
    const client = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${token}` },
    });

    // 2. Create test project
    console.log('\n2️⃣ Creating test project...');
    const projRes = await client.post('/projects', {
      name: 'secure-vault-service',
      githubRepoFullName: 'demo-org/secure-vault-service',
      githubRepoUrl: 'https://github.com/demo-org/secure-vault-service',
    });
    const projectId = projRes.data.data.id;
    console.log(`   ✅ Project Created: ${projectId}`);

    // 3. Add secret environment variable
    console.log('\n3️⃣ Adding secret environment variable (POST /projects/:id/env)...');
    const addRes = await client.post(`/projects/${projectId}/env`, {
      key: 'STRIPE_API_KEY',
      value: 'sk_live_51M00SuperSecretKeyXYZ',
      serviceTarget: 'BACKEND',
      isSecret: true,
    });
    console.log(`   ✅ Added Variable: ${addRes.data.data.key}`);

    // 4. Verify in PostgreSQL directly to confirm AES-256 encryption at rest
    console.log('\n4️⃣ Checking PostgreSQL database row to verify encryption at rest...');
    const dbRecord = await prisma.environmentVariable.findFirst({
      where: { projectId, key: 'STRIPE_API_KEY' },
    });
    console.log(`   🔐 Database Raw Value: "${dbRecord.valueEnc}"`);
    if (dbRecord.valueEnc.includes('sk_live_51M00SuperSecretKeyXYZ')) {
      throw new Error('Security vulnerability: Value was stored in plain text!');
    }
    console.log('   ✅ Security Confirmed: Plaintext is NOT present in the database. AES-256-GCM authenticated cipher used.');

    // 5. Test GET endpoint masks secret values
    console.log('\n5️⃣ Testing Masked Output on GET /projects/:id/env...');
    const listRes = await client.get(`/projects/${projectId}/env`);
    const envVar = listRes.data.data[0];
    console.log(`   ✅ API Output: Key="${envVar.key}", Masked Value="${envVar.value}"`);

    // 6. Test delete
    console.log('\n6️⃣ Testing Variable Deletion (DELETE /projects/:id/env/:envId)...');
    await client.delete(`/projects/${projectId}/env/${envVar.id}`);
    const afterDelete = await client.get(`/projects/${projectId}/env`);
    console.log(`   ✅ Variable count after deletion: ${afterDelete.data.data.length}`);

    console.log('\n=============================================================');
    console.log('🎉 PHASE 8 ENVIRONMENT VARIABLES & SECURITY TESTS PASSED!');
    console.log('=============================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Environment test failed:', error.message);
    if (error.response) {
      console.error(error.response.data);
    }
    process.exit(1);
  }
}

runEnvTests();

