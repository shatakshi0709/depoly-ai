/**
 * test-oauth-preflight.js
 * 
 * Pre-flight check for GitHub OAuth configuration.
 * Verifies env vars are set and GitHub accepts our Client ID
 * WITHOUT making any user-impersonating calls.
 * 
 * Run: node server/test-oauth-preflight.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env files using absolute paths derived from this file's location.
// Load server/.env first, then fall back to repo-root .env without overriding.
const serverEnvPath = path.resolve(__dirname, '.env');
const rootEnvPath = path.resolve(__dirname, '../.env');

dotenv.config({ path: serverEnvPath });
dotenv.config({ path: rootEnvPath, override: false });

const REQUIRED_VARS = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'DATABASE_URL',
];

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  deplo.ai — GitHub OAuth Pre-Flight Check');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── 1. Check all required env vars are present ────────────────────────────────
console.log('① Checking environment variables...');
let allPresent = true;

for (const varName of REQUIRED_VARS) {
  const value = process.env[varName];
  if (!value || value.trim() === '') {
    console.log(`   ✗ MISSING: ${varName}`);
    allPresent = false;
  } else {
    // Show first 6 chars only — never log secrets
    const preview = varName.includes('SECRET') || varName.includes('KEY') || varName.includes('DATABASE')
      ? '[REDACTED]'
      : value.slice(0, 8) + '...';
    console.log(`   ✓ ${varName} = ${preview}`);
  }
}

if (!allPresent) {
  console.log('\n❌ One or more required environment variables are missing.');
  console.log('   Fill them in server/.env before proceeding.\n');
  process.exit(1);
}

// ── 2. Validate GITHUB_CLIENT_ID format ──────────────────────────────────────
console.log('\n② Validating Client ID format...');
const clientId = process.env.GITHUB_CLIENT_ID;
// GitHub Client IDs: "Iv1k..." (OAuth App) or "Iv23li..." (new format)
if (!/^Iv/.test(clientId)) {
  console.log('   ⚠ Client ID does not start with "Iv" — double-check you copied it correctly.');
} else {
  console.log(`   ✓ Client ID format looks valid (starts with "${clientId.slice(0, 4)}")`);
}

// ── 3. Confirm GITHUB_CALLBACK_URL matches expected value ─────────────────────
console.log('\n③ Checking GITHUB_CALLBACK_URL...');
const callbackUrl = process.env.GITHUB_CALLBACK_URL;
const expectedCallback = 'http://localhost:5173/auth/callback';
if (callbackUrl !== expectedCallback) {
  console.log(`   ✗ Expected: ${expectedCallback}`);
  console.log(`   ✗ Got:      ${callbackUrl}`);
  console.log('   ✗ This MUST match the "Authorization callback URL" in your GitHub OAuth App settings.');
} else {
  console.log(`   ✓ ${callbackUrl}`);
}

// ── 4. Probe GitHub's OAuth endpoint (no auth required) ──────────────────────
console.log('\n④ Probing GitHub OAuth endpoint reachability...');
try {
  // Sending a deliberately invalid code — we expect a 200 with error body
  // (GitHub always returns 200 for /access_token, even for errors)
  const res = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: 'preflight_test_invalid_code',
    },
    { headers: { Accept: 'application/json' } }
  );

  const data = res.data;

  if (data.error === 'bad_verification_code') {
    console.log('   ✓ GitHub OAuth endpoint reachable');
    console.log('   ✓ Client ID and Client Secret are RECOGNIZED by GitHub');
    console.log('   ✓ Code was correctly rejected (expected — it\'s a test code)');
  } else if (data.error === 'incorrect_client_credentials') {
    console.log('   ✗ GitHub says: incorrect_client_credentials');
    console.log('   ✗ Your GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is wrong.');
    console.log('   ✗ Double-check both values in server/.env');
    process.exit(1);
  } else if (data.access_token) {
    // Extremely unlikely with a fake code, but handle it
    console.log('   ✓ GitHub responded with an access token (unexpected with test code)');
  } else {
    console.log(`   ⚠ Unexpected response: ${JSON.stringify(data)}`);
  }
} catch (err) {
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
    console.log('   ✗ Cannot reach github.com — check your internet connection');
  } else {
    console.log(`   ✗ Request failed: ${err.message}`);
  }
  process.exit(1);
}

// ── 5. Summary ────────────────────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  ✅ Pre-flight complete — ready to test OAuth flow');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('\nNext steps:');
console.log('  Terminal 1 → node server/src/server.js');
console.log('  Terminal 2 → npm --workspace=apps/web run dev');
console.log('  Browser    → http://localhost:5173/login');
console.log('  Click "Continue with GitHub" and authorize\n');

