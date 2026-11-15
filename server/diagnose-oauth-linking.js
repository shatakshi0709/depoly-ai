/**
 * Read-only diagnostic: check OAuth account linking for GitHub.
 * Compares user IDs without exposing any secrets, tokens, or codes.
 */
import prisma from './src/config/db.js';

async function main() {
  console.log('=== OAuth Account Linking Diagnostic (read-only) ===\n');

  // 1. Count users
  const userCount = await prisma.user.count();
  console.log(`Total users: ${userCount}`);

  // 2. Count GitHub OAuth accounts
  const githubOauthCount = await prisma.oAuthAccount.count({
    where: { provider: 'github' },
  });
  console.log(`GitHub OAuth accounts: ${githubOauthCount}\n`);

  // 3. List all users with their OAuth account status (no secrets)
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      fullName: true,
      createdAt: true,
      oauthAccounts: {
        where: { provider: 'github' },
        select: {
          id: true,
          provider: true,
          providerUserId: true,
          createdAt: true,
        },
      },
      _count: {
        select: { projects: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log('Users and GitHub OAuth linkage:');
  console.log('----------------------------------------');
  for (const u of users) {
    const redactedId = u.id.slice(0, 8) + '...';
    const hasGithub = u.oauthAccounts.length > 0;
    console.log(
      `User: ${redactedId} | email: ${u.email} | hasGithubConnected: ${hasGithub} | ` +
      `oauthCount: ${u.oauthAccounts.length} | projects: ${u._count.projects}`
    );
    for (const oa of u.oauthAccounts) {
      const redactedProviderUserId = oa.providerUserId.slice(0, 4) + '...' + oa.providerUserId.slice(-4);
      console.log(`    └─ OAuthAccount: id=${oa.id.slice(0, 8)}... provider=${oa.provider} providerUserId=...${redactedProviderUserId}`);
    }
  }

  // 4. Check for OAuth accounts linked to users that don't exist (orphaned)
  const orphaned = await prisma.oAuthAccount.findMany({
    where: { provider: 'github' },
    select: {
      id: true,
      userId: true,
      providerUserId: true,
      user: { select: { id: true, email: true } },
    },
  });

  console.log(`\nGitHub OAuth account → user mapping (redacted):`);
  console.log('----------------------------------------');
  for (const oa of orphaned) {
    const redactedUserId = oa.userId.slice(0, 8) + '...';
    const redactedPuid = oa.providerUserId.slice(0, 4) + '...' + oa.providerUserId.slice(-4);
    const userFound = oa.user ? 'YES' : 'NO (orphaned)';
    const userEmail = oa.user ? oa.user.email.slice(0, 20) + '...' : 'N/A';
    console.log(`OAuthAccount userId=${redactedUserId} → user found: ${userFound} | email: ${userEmail} | providerUserId=...${redactedPuid}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Diagnostic error:', e.message);
  process.exit(1);
});
