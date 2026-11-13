/**
 * @file analyzer.service.js
 * @description Intelligent heuristic repository analysis engine for framework & cloud provider detection.
 */

import { getRepositoryTree, getFileContent, parseGitHubUrl } from './github.service.js';
import { FRAMEWORK_PRESETS, PROVIDER } from '@deplo/shared';

/**
 * Perform comprehensive architecture analysis on a GitHub repository.
 */
export async function analyzeRepository(repoUrlOrName, branch = 'HEAD', token = null) {
  const coords = parseGitHubUrl(repoUrlOrName);
  if (!coords) {
    throw new Error('Invalid GitHub repository URL or format. Expected: owner/repository');
  }

  const { owner, repo } = coords;

  // 1. Fetch file tree
  let tree = [];
  try {
    tree = await getRepositoryTree(owner, repo, branch, token);
  } catch (error) {
    // If branch doesn't exist or repo is empty, return an informative error
    throw new Error(`Unable to read repository tree from GitHub: ${error.message}`);
  }

  const filePaths = tree.map((node) => node.path);

  // 2. Identify potential frontend and backend directories
  const { frontendDir, backendDir, isMonorepo } = detectDirectoryLayout(filePaths);

  // 3. Analyze Backend
  const backendAnalysis = await analyzeBackendComponent(owner, repo, backendDir, filePaths, branch, token);

  // 4. Analyze Frontend
  const frontendAnalysis = await analyzeFrontendComponent(owner, repo, frontendDir, filePaths, branch, token);

  // 5. Determine overall architectural preset
  const detectedPreset = determineOverallPreset(frontendAnalysis, backendAnalysis);

  // 6. Generate deployment recommendation
  return {
    repository: {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      branch,
      isMonorepo,
    },
    detectedPreset,
    orchestrationPlan: {
      deploymentOrder: ['BACKEND', 'HEALTH_CHECK', 'ENV_INJECTION', 'FRONTEND'],
      reasoning:
        'The backend API must be deployed and verified healthy before building the frontend, allowing the live backend URL to be automatically injected as an environment variable (e.g. VITE_API_URL).',
    },
    backend: backendAnalysis,
    frontend: frontendAnalysis,
  };
}

/**
 * Heuristic detector for directory structures (monorepo vs polyrepo).
 */
function detectDirectoryLayout(filePaths) {
  const frontendCandidates = ['client', 'frontend', 'apps/web', 'ui', 'web', 'packages/web'];
  const backendCandidates = ['server', 'backend', 'apps/api', 'api', 'packages/api'];

  let frontendDir = null;
  let backendDir = null;

  for (const dir of frontendCandidates) {
    if (filePaths.some((p) => p.startsWith(dir + '/package.json') || p.startsWith(dir + '/index.html'))) {
      frontendDir = '/' + dir;
      break;
    }
  }

  for (const dir of backendCandidates) {
    if (filePaths.some((p) => p.startsWith(dir + '/package.json') || p.startsWith(dir + '/requirements.txt') || p.startsWith(dir + '/main.py'))) {
      backendDir = '/' + dir;
      break;
    }
  }

  const isMonorepo = Boolean(frontendDir && backendDir);

  // If not monorepo, default directory to root '/'
  return {
    frontendDir: frontendDir || '/',
    backendDir: backendDir || '/',
    isMonorepo,
  };
}

/**
 * Inspect backend files to identify framework, start commands, and health paths.
 */
async function analyzeBackendComponent(owner, repo, rootDir, filePaths, branch, token) {
  const prefix = rootDir === '/' ? '' : rootDir.slice(1) + '/';
  const pkgJsonPath = `${prefix}package.json`;
  const reqTxtPath = `${prefix}requirements.txt`;

  let framework = 'NODE_GENERIC';
  let buildCommand = 'npm install';
  let startCommand = 'npm start';
  let healthCheckPath = '/health';
  let runtime = 'node';

  // Check Node.js
  if (filePaths.includes(pkgJsonPath)) {
    const content = await getFileContent(owner, repo, pkgJsonPath, branch, token);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps['@nestjs/core']) {
          framework = 'NEST_JS';
          buildCommand = 'npm install && npm run build';
          startCommand = 'npm run start:prod';
        } else if (deps['express']) {
          framework = 'EXPRESS_NODE';
          buildCommand = 'npm install';
          startCommand = pkg.scripts?.start ? 'npm start' : 'node index.js';
        } else if (deps['fastify']) {
          framework = 'FASTIFY_NODE';
          buildCommand = 'npm install';
          startCommand = pkg.scripts?.start ? 'npm start' : 'node server.js';
        }

        // Look for common health check paths in code
        if (filePaths.some((p) => p.includes('health'))) {
          healthCheckPath = '/api/health';
        }
      } catch (e) {
        // Fallback default
      }
    }
  } else if (filePaths.includes(reqTxtPath)) {
    // Check Python
    runtime = 'python';
    buildCommand = 'pip install -r requirements.txt';
    const content = await getFileContent(owner, repo, reqTxtPath, branch, token);

    if (content && content.includes('fastapi')) {
      framework = 'FAST_API';
      startCommand = 'uvicorn main:app --host 0.0.0.0 --port 10000';
    } else if (content && content.includes('django')) {
      framework = 'DJANGO';
      startCommand = 'python manage.py runserver 0.0.0.0:10000';
    } else {
      framework = 'PYTHON_FLASK';
      startCommand = 'python app.py';
    }
  }

  return {
    detected: true,
    framework,
    runtime,
    provider: PROVIDER.RENDER,
    rootDirectory: rootDir,
    buildCommand,
    startCommand,
    healthCheckPath,
    suggestedEnvVars: [
      { key: 'PORT', value: '10000', description: 'Port for Render web service' },
      { key: 'NODE_ENV', value: 'production', description: 'Runtime environment' },
    ],
  };
}

/**
 * Inspect frontend files to identify Vite, Next.js, CRA, build commands, and output directories.
 */
async function analyzeFrontendComponent(owner, repo, rootDir, filePaths, branch, token) {
  const prefix = rootDir === '/' ? '' : rootDir.slice(1) + '/';
  const pkgJsonPath = `${prefix}package.json`;

  let framework = 'REACT_VITE';
  let buildCommand = 'npm run build';
  let startCommand = 'npm run preview';
  let outputDirectory = 'dist';

  if (filePaths.includes(pkgJsonPath)) {
    const content = await getFileContent(owner, repo, pkgJsonPath, branch, token);
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps['next']) {
          framework = 'NEXT_JS';
          buildCommand = 'npm run build';
          startCommand = 'npm start';
          outputDirectory = '.next';
        } else if (deps['vite']) {
          framework = 'REACT_VITE';
          buildCommand = 'npm run build';
          startCommand = 'npm run preview';
          outputDirectory = 'dist';
        } else if (deps['react-scripts']) {
          framework = 'CREATE_REACT_APP';
          buildCommand = 'npm run build';
          startCommand = 'serve -s build';
          outputDirectory = 'build';
        } else if (deps['vue']) {
          framework = 'VUE';
          buildCommand = 'npm run build';
          outputDirectory = 'dist';
        }
      } catch (e) {
        // Fallback default
      }
    }
  } else if (filePaths.some((p) => p.endsWith('.html'))) {
    framework = 'STATIC_HTML';
    buildCommand = '';
    startCommand = '';
    outputDirectory = '.';
  }

  return {
    detected: true,
    framework,
    provider: PROVIDER.VERCEL,
    rootDirectory: rootDir,
    buildCommand,
    startCommand,
    outputDirectory,
    suggestedEnvVars: [
      {
        key: 'VITE_API_URL',
        value: '{{RENDER_BACKEND_URL}}',
        description: 'Auto-populated with live Render backend URL after health verification',
      },
    ],
  };
}

/**
 * Determine high-level preset label.
 */
function determineOverallPreset(frontend, backend) {
  if (frontend.framework === 'REACT_VITE' && backend.framework === 'EXPRESS_NODE') {
    return FRAMEWORK_PRESETS.REACT_VITE;
  }
  if (frontend.framework === 'NEXT_JS') {
    return FRAMEWORK_PRESETS.NEXT_JS;
  }
  if (backend.framework === 'FAST_API') {
    return FRAMEWORK_PRESETS.FAST_API;
  }
  return 'FULLSTACK_CUSTOM';
}

