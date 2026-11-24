import prisma from '../config/db.js';
import { decrypt } from '../utils/crypto.js';
import { getUserRepositories } from '../services/github.service.js';
import { analyzeRepository } from '../services/analyzer.service.js';
import { isNonEmptyString } from '../utils/validate.js';

/**
 * List repositories accessible to the authenticated user (via their linked GitHub OAuth token).
 * No demo/fallback repositories are returned from this endpoint.
 */
export async function getRepositories(req, res, next) {
  try {
    // 1. Look for connected GitHub account for the authenticated user
    const oauth = await prisma.oAuthAccount.findFirst({
      where: {
        userId: req.user.userId,
        provider: 'github',
      },
    });

    if (!oauth || !oauth.accessTokenEnc) {
      return res.status(400).json({
        success: false,
        error: 'GITHUB_NOT_CONNECTED',
        message: 'GitHub account is not connected. Please sign in with GitHub to list your repositories.',
      });
    }

    let decryptedToken;
    try {
      decryptedToken = decrypt(oauth.accessTokenEnc);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'GITHUB_TOKEN_ERROR',
        message: 'Stored GitHub credentials could not be read. Please reconnect your GitHub account.',
      });
    }

    if (!decryptedToken) {
      return res.status(400).json({
        success: false,
        error: 'GITHUB_NOT_CONNECTED',
        message: 'GitHub account is not connected. Please sign in with GitHub to list your repositories.',
      });
    }

    try {
      const repos = await getUserRepositories(decryptedToken);
      return res.json({
        success: true,
        source: 'GITHUB_OAUTH',
        data: repos,
      });
    } catch (ghError) {
      const status = ghError?.status || ghError?.response?.status;
      const ghMessage = ghError?.response?.data?.message || ghError?.message || 'Failed to fetch repositories from GitHub.';
      if (status === 401 || status === 403) {
        return res.status(401).json({
          success: false,
          error: 'GITHUB_AUTH_FAILED',
          message: `GitHub authentication failed: ${ghMessage}. Please reconnect your GitHub account.`,
        });
      }
      return res.status(502).json({
        success: false,
        error: 'GITHUB_API_ERROR',
        message: `Failed to fetch repositories from GitHub: ${ghMessage}`,
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Analyze a repository URL to detect frameworks, directory structures, and build commands.
 */
export async function analyze(req, res, next) {
  try {
    const { repoUrl, branch = 'main' } = req.body || {};

    if (!isNonEmptyString(repoUrl) || repoUrl.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'A valid repository URL or full name is required.',
      });
    }

    const safeBranch = isNonEmptyString(branch) ? branch.trim().slice(0, 100) : 'main';

    // Check if user has an OAuth token to pass for private repo access
    const oauth = await prisma.oAuthAccount.findFirst({
      where: {
        userId: req.user.userId,
        provider: 'github',
      },
    });

    const token = oauth && oauth.accessTokenEnc ? decrypt(oauth.accessTokenEnc) : null;

    try {
      const analysis = await analyzeRepository(repoUrl.trim(), safeBranch, token);
      return res.json({
        success: true,
        data: analysis,
      });
    } catch {
      // If live GitHub inspection fails, provide heuristic fallback analysis.
      const fallback = generateHeuristicFallback(repoUrl.trim(), safeBranch);
      return res.json({
        success: true,
        isFallback: true,
        data: fallback,
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Intelligent heuristic fallback for demo/offline presentations
 */
function generateHeuristicFallback(repoUrl, branch) {
  const isPython = repoUrl.toLowerCase().includes('fastapi') || repoUrl.toLowerCase().includes('python');

  return {
    repository: {
      fullName: repoUrl.replace('https://github.com/', ''),
      branch,
      isMonorepo: true,
    },
    detectedPreset: isPython ? 'FAST_API' : 'REACT_VITE',
    orchestrationPlan: {
      deploymentOrder: ['BACKEND', 'HEALTH_CHECK', 'ENV_INJECTION', 'FRONTEND'],
      reasoning: 'Backend must be deployed and verified healthy before building the frontend, allowing the live backend URL to be automatically injected into the frontend environment.',
    },
    backend: {
      detected: true,
      framework: isPython ? 'FAST_API' : 'EXPRESS_NODE',
      runtime: isPython ? 'python' : 'node',
      provider: 'RENDER',
      rootDirectory: isPython ? '/api' : '/server',
      buildCommand: isPython ? 'pip install -r requirements.txt' : 'npm install',
      startCommand: isPython ? 'uvicorn main:app --host 0.0.0.0 --port 10000' : 'npm start',
      healthCheckPath: '/api/health',
      suggestedEnvVars: [
        { key: 'PORT', value: '10000', description: 'Port for Render web service' },
        { key: 'NODE_ENV', value: 'production', description: 'Runtime environment' },
      ],
    },
    frontend: {
      detected: true,
      framework: 'REACT_VITE',
      provider: 'VERCEL',
      rootDirectory: isPython ? '/frontend' : '/client',
      buildCommand: 'npm run build',
      startCommand: 'npm run preview',
      outputDirectory: 'dist',
      suggestedEnvVars: [
        { key: 'VITE_API_URL', value: '{{RENDER_BACKEND_URL}}', description: 'Auto-populated with live Render backend URL' },
      ],
    },
  };
}

