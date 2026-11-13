import prisma from '../config/db.js';
import { decrypt } from '../utils/crypto.js';
import { getUserRepositories } from '../services/github.service.js';
import { analyzeRepository } from '../services/analyzer.service.js';
import { isNonEmptyString } from '../utils/validate.js';

/**
 * List repositories accessible to the user.
 */
export async function getRepositories(req, res, next) {
  try {
    // 1. Look for connected GitHub account
    const oauth = await prisma.oAuthAccount.findFirst({
      where: {
        userId: req.user.userId,
        provider: 'github',
      },
    });

    if (oauth && oauth.accessTokenEnc) {
      const decryptedToken = decrypt(oauth.accessTokenEnc);
      const repos = await getUserRepositories(decryptedToken);
      return res.json({
        success: true,
        source: 'GITHUB_OAUTH',
        data: repos,
      });
    }

    // Fallback: If GitHub OAuth isn't linked yet, return curated starter repos
    res.json({
      success: true,
      source: 'STARTER_TEMPLATES',
      message: 'GitHub OAuth not connected. Showing featured full-stack template repositories.',
      data: [
        {
          id: 101,
          name: 'ecommerce-fullstack-starter',
          fullName: 'demo-org/ecommerce-fullstack-starter',
          url: 'https://github.com/demo-org/ecommerce-fullstack-starter',
          defaultBranch: 'main',
          language: 'TypeScript',
          description: 'Production-ready e-commerce platform with Express backend and Vite React frontend.',
        },
        {
          id: 102,
          name: 'saas-analytics-app',
          fullName: 'demo-org/saas-analytics-app',
          url: 'https://github.com/demo-org/saas-analytics-app',
          defaultBranch: 'main',
          language: 'JavaScript',
          description: 'SaaS analytics platform with real-time telemetry and dashboard.',
        },
        {
          id: 103,
          name: 'fastapi-react-dashboard',
          fullName: 'demo-org/fastapi-react-dashboard',
          url: 'https://github.com/demo-org/fastapi-react-dashboard',
          defaultBranch: 'main',
          language: 'Python',
          description: 'High-performance Python FastAPI service connected to React frontend.',
        },
      ],
    });
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

