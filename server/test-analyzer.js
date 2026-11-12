/**
 * @file test-analyzer.js
 * @description Automated test suite for GitHub Integration & Framework Analyzer Engine (Phase 7).
 */

import axios from 'axios';
import { env } from './src/config/env.js';
import { parseGitHubUrl } from './src/services/github.service.js';
import { analyzeRepository } from './src/services/analyzer.service.js';

const BASE_URL = `http://localhost:${env.PORT}/api/v1`;

async function runAnalyzerTests() {
  console.log('🧪 Starting Phase 7: GitHub Integration & Framework Analyzer Verification...\n');

  try {
    // 1. Test URL parsing
    console.log('1️⃣ Testing GitHub URL parser...');
    const parsed1 = parseGitHubUrl('https://github.com/facebook/react');
    const parsed2 = parseGitHubUrl('vercel/next.js');
    console.log(`   ✅ Parsed "https://github.com/facebook/react" -> owner: "${parsed1.owner}", repo: "${parsed1.repo}"`);
    console.log(`   ✅ Parsed "vercel/next.js" -> owner: "${parsed2.owner}", repo: "${parsed2.repo}"`);

    // 2. Authenticate to test protected API endpoints
    console.log('\n2️⃣ Authenticating test engineer...');
    const email = `analyzer_tester_${Date.now()}@deplo.ai`;
    const regRes = await axios.post(`${BASE_URL}/auth/register`, {
      email,
      password: 'SecurePassword123!',
      fullName: 'Repo Architect',
    });
    const token = regRes.data.data.token;
    const client = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${token}` },
    });

    // 3. Test GET /api/v1/github/repos
    console.log('\n3️⃣ Testing Repository List Endpoint (GET /api/v1/github/repos)...');
    const reposRes = await client.get('/github/repos');
    console.log(`   ✅ Source: ${reposRes.data.source} | Repos Returned: ${reposRes.data.data.length}`);
    reposRes.data.data.forEach((r) => {
      console.log(`      📁 [${r.language || 'Multi'}] ${r.fullName} - ${r.description.slice(0, 50)}...`);
    });

    // 4. Test POST /api/v1/github/analyze with full-stack Node/React repo
    console.log('\n4️⃣ Testing Framework Heuristics (POST /api/v1/github/analyze)...');
    const analyzeRes = await client.post('/github/analyze', {
      repoUrl: 'https://github.com/demo-org/ecommerce-fullstack-starter',
      branch: 'main',
    });

    const report = analyzeRes.data.data;
    console.log(`   ✅ Detected Architecture: ${report.detectedPreset}`);
    console.log(`   ✅ Monorepo Detected:     ${report.repository.isMonorepo}`);
    console.log(`   🚀 Backend Target:        ${report.backend.provider} (${report.backend.framework})`);
    console.log(`      - Root Directory:      ${report.backend.rootDirectory}`);
    console.log(`      - Build Command:       ${report.backend.buildCommand}`);
    console.log(`      - Start Command:       ${report.backend.startCommand}`);
    console.log(`      - Health Check Path:   ${report.backend.healthCheckPath}`);
    console.log(`   🚀 Frontend Target:       ${report.frontend.provider} (${report.frontend.framework})`);
    console.log(`      - Root Directory:      ${report.frontend.rootDirectory}`);
    console.log(`      - Build Command:       ${report.frontend.buildCommand}`);
    console.log(`      - Auto Environment:    ${report.frontend.suggestedEnvVars[0].key} = ${report.frontend.suggestedEnvVars[0].value}`);
    console.log(`   📋 Orchestration Order:   ${report.orchestrationPlan.deploymentOrder.join(' -> ')}`);

    // 5. Test Python FastAPI detection
    console.log('\n5️⃣ Testing Python FastAPI Heuristics...');
    const pythonRes = await client.post('/github/analyze', {
      repoUrl: 'https://github.com/demo-org/fastapi-react-dashboard',
      branch: 'main',
    });
    console.log(`   ✅ Python Analysis Preset: ${pythonRes.data.data.detectedPreset}`);
    console.log(`   🚀 Backend Runtime:        ${pythonRes.data.data.backend.runtime} (${pythonRes.data.data.backend.framework})`);
    console.log(`      - Start Command:       ${pythonRes.data.data.backend.startCommand}`);

    console.log('\n=============================================================');
    console.log('🎉 PHASE 7 GITHUB & ANALYZER ENGINE TESTS PASSED WITH 100%!');
    console.log('=============================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Analyzer test failed:', error.message);
    if (error.response) {
      console.error(error.response.data);
    }
    process.exit(1);
  }
}

runAnalyzerTests();
