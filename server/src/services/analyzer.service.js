/**
 * @file analyzer.service.js
 * @description Intelligent heuristic repository analysis engine for framework & cloud provider detection.
 */

import { getRepositoryTree, getFileContent, parseGitHubUrl } from './github.service.js';
import { FRAMEWORK_PRESETS, PROVIDER } from '@deplo/shared';

// Directory-name heuristics shared by layout detection and the Electron-only guard.
const FRONTEND_DIR_CANDIDATES = ['client', 'frontend', 'apps/web', 'ui', 'web', 'packages/web', 'vite-project'];
const BACKEND_DIR_CANDIDATES = ['server', 'backend', 'apps/api', 'api', 'packages/api'];

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

  // 2. Detect if root package.json is an Electron desktop application
  const rootPkgPath = 'package.json';
  const rootPkgContent = filePaths.includes(rootPkgPath)
    ? await getFileContent(owner, repo, rootPkgPath, branch, token)
    : null;
  let rootPkgJson = null;
  if (rootPkgContent) {
    try {
      rootPkgJson = JSON.parse(rootPkgContent);
    } catch {
      rootPkgJson = null;
    }
  }

  const electronApp = detectElectronApp(rootPkgJson);

  // 3. Check if this is an Electron-only application (no separate web backend)
  if (electronApp && !BACKEND_DIR_CANDIDATES.some((d) => filePaths.some((p) => p.startsWith(d + '/package.json')))) {
    return {
      repository: {
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        branch,
        isMonorepo: false,
      },
      applicationType: 'electron_desktop',
      error:
        'This repository is a desktop Electron application and cannot run as a Render web service. ' +
        'Electron apps are desktop clients, not HTTP backends. Select a backend/API project instead.',
      detectedPreset: null,
      backend: {
        detected: false,
        framework: null,
        runtime: null,
        provider: null,
        rootDirectory: null,
        buildCommand: null,
        startCommand: null,
        healthCheckPath: null,
        error: 'Electron desktop application detected - not a web backend',
      },
      frontend: null,
      orchestrationPlan: null,
    };
  }

  // 4. Identify potential frontend and backend directories
  const { frontendDir, backendDir, isMonorepo } = detectDirectoryLayout(filePaths);

  // 5. Analyze Backend (if a backend directory exists)
  let backendAnalysis = null;
  if (backendDir) {
    backendAnalysis = await analyzeBackendComponent(owner, repo, backendDir, filePaths, branch, token);
  }

  // 6. Analyze Frontend (always analyze if frontend directory found or root has frontend files)
  const frontendAnalysis = await analyzeFrontendComponent(owner, repo, frontendDir, filePaths, branch, token);

  // 7. Determine application type
  let applicationType;
  if (electronApp && !backendAnalysis) {
    applicationType = 'electron_desktop';
  } else if (!backendAnalysis && frontendAnalysis?.detected) {
    applicationType = 'frontend_only';
  } else if (backendAnalysis && frontendAnalysis?.detected) {
    applicationType = isMonorepo ? 'fullstack_monorepo' : 'fullstack_single_repo';
  } else if (backendAnalysis && !frontendAnalysis?.detected) {
    applicationType = 'backend_only';
  } else {
    applicationType = 'unknown';
  }

  // 8. Reject Electron-only desktop applications
  if (applicationType === 'electron_desktop') {
    return {
      repository: {
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        branch,
        isMonorepo: false,
      },
      applicationType: 'electron_desktop',
      error:
        'This repository is a desktop Electron application and cannot run as a Render web service. ' +
        'Electron apps are desktop clients, not HTTP backends. Select a backend/API project instead.',
      detectedPreset: null,
      backend: {
        detected: false,
        framework: null,
        runtime: null,
        provider: null,
        rootDirectory: null,
        buildCommand: null,
        startCommand: null,
        healthCheckPath: null,
        error: 'Electron desktop application detected - not a web backend',
      },
      frontend: null,
      orchestrationPlan: null,
    };
  }

  // 9. Reject frontend-only repositories from backend provisioning
  if (applicationType === 'frontend_only') {
    return {
      repository: {
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        branch,
        isMonorepo: false,
      },
      applicationType: 'frontend_only',
      error:
        'This repository contains only a frontend application and has no backend API. ' +
        'It can be deployed to Vercel as a frontend-only project but cannot provision a Render backend service.',
      detectedPreset: frontendAnalysis?.framework || null,
      backend: {
        detected: false,
        framework: null,
        runtime: null,
        provider: null,
        rootDirectory: null,
        buildCommand: null,
        startCommand: null,
        healthCheckPath: null,
        error: 'No backend API found in repository - frontend-only project',
      },
      frontend: frontendAnalysis,
      orchestrationPlan: {
        deploymentOrder: ['FRONTEND'],
        reasoning:
          'This is a frontend-only repository. It will be deployed to Vercel as a static site. ' +
          'No backend service will be provisioned on Render.',
      },
    };
  }

  // 10. Determine overall architectural preset
  const detectedPreset = determineOverallPreset(frontendAnalysis, backendAnalysis);

  // 11. Generate deployment recommendation
  return {
    repository: {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      branch,
      isMonorepo,
    },
    applicationType: electronApp ? 'electron_monorepo' : (isMonorepo ? 'monorepo' : 'single_repo'),
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
  const frontendCandidates = FRONTEND_DIR_CANDIDATES;
  const backendCandidates = BACKEND_DIR_CANDIDATES;

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
 * Detect if a package.json represents an Electron desktop application.
 * An Electron app has 'electron' in dependencies/devDependencies and a
 * 'main' entry point that is NOT a Node.js web server entry.
 */
export function detectElectronApp(pkgJson) {
  if (!pkgJson || typeof pkgJson !== 'object') return null;
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  if (!deps['electron']) return null;
  // Electron main entry point - typically electron/main.js, electron/electron.js, or src/main.js
  const mainEntry = pkgJson.main || '';
  const isElectronMain =
    mainEntry.includes('electron') ||
    mainEntry.includes('main.js') ||
    mainEntry.includes('electron.js') ||
    mainEntry === 'main.js';
  if (isElectronMain) {
    return {
      isElectron: true,
      mainEntry,
      hasWindowCreation: false, // would need to read main file to confirm
    };
  }
  return null;
}

/**
 * Check if a package.json represents an Express/Node.js web backend.
 * An Express backend has 'express' dependency and a start command that
 * launches an HTTP server listening on process.env.PORT.
 */
export function detectExpressBackend(pkgJson) {
  if (!pkgJson || typeof pkgJson !== 'object') return null;
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  if (!deps['express'] && !deps['fastify'] && !deps['@nestjs/core']) return null;

  const scripts = pkgJson.scripts || {};
  const startScript = scripts.start || '';
  const devScript = scripts.dev || '';

  // Check if start command references PORT or 0.0.0.0
  const listensOnPortEnv = /process\.env\.PORT|PORT/.test(startScript + devScript);
  const listensOnAllInterfaces = /0\.0\.0\.0/.test(startScript + devScript);

  return {
    isExpressBackend: true,
    framework: deps['@nestjs/core'] ? 'NEST_JS' : deps['fastify'] ? 'FASTIFY_NODE' : 'EXPRESS_NODE',
    startScript,
    listensOnPortEnv,
    listensOnAllInterfaces,
  };
}

/**
 * Extract required environment variables from a Node.js backend package.json
 * and common source files. Does not expose secret values.
 */
export function extractRequiredEnvVars(pkgJson, sourceFiles = []) {
  const envVars = new Set();

  // Common backend env vars
  envVars.add('PORT');
  envVars.add('NODE_ENV');

  // Check scripts for env var references like ${PORT} or $PORT
  const scripts = pkgJson.scripts || {};
  const scriptText = JSON.stringify(scripts);
  const portMatches = scriptText.match(/\$?\{?PORT\}?/g) || [];
  if (portMatches.length > 0) envVars.add('PORT');

  // Check source files for process.env references
  for (const file of sourceFiles) {
    if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.mjs')) {
      // We can't read file content here, but we can note common patterns
      // that the analyzer would detect from file content
    }
  }

  return Array.from(envVars).map((key) => ({
    key,
    required: key === 'PORT' || key === 'NODE_ENV',
    description: key === 'PORT' ? 'Port for the web server to listen on' : key === 'NODE_ENV' ? 'Runtime environment' : undefined,
  }));
}

/**
 * Inspect backend files to identify framework, start commands, and health paths.
 */
export async function analyzeBackendComponent(owner, repo, rootDir, filePaths, branch, token) {
  const prefix = rootDir === '/' ? '' : rootDir.slice(1) + '/';
  const pkgJsonPath = `${prefix}package.json`;
  const reqTxtPath = `${prefix}requirements.txt`;
  const mainPyPath = `${prefix}main.py`;

  const hasNodeManifest = filePaths.includes(pkgJsonPath);
  const hasPythonManifest = filePaths.includes(reqTxtPath) || filePaths.includes(mainPyPath);

  // No backend manifest at this root directory => this is NOT a backend.
  // Returning null (instead of a default NODE_GENERIC object) prevents the analyzer
  // from fabricating a phantom Render service for frontend-only repositories.
  if (!hasNodeManifest && !hasPythonManifest) {
    return null;
  }

  let framework = 'NODE_GENERIC';
  let buildCommand = 'npm install';
  let startCommand = 'npm start';
  let healthCheckPath = '/health';
  let runtime = 'node';
  let listensOnPortEnv = false;
  let listensOnAllInterfaces = false;

  // Check Node.js
  if (hasNodeManifest) {
    const content = await getFileContent(owner, repo, pkgJsonPath, branch, token);
    let pkg = null;
    if (content) {
      try {
        pkg = JSON.parse(content);
      } catch (e) {
        pkg = null;
      }
    }

    // An unreadable/unparseable package.json is not a usable backend manifest.
    if (!pkg) {
      return null;
    }

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // CRITICAL: If this package.json has 'electron' dependency, it's NOT a web backend
    if (deps['electron']) {
      return {
        detected: false,
        framework: null,
        runtime: null,
        provider: null,
        rootDirectory: rootDir,
        buildCommand: null,
        startCommand: null,
        healthCheckPath: null,
        error: 'Package.json contains electron dependency - this is a desktop application, not a web backend',
        isElectronApp: true,
      };
    }

    const startScript = pkg.scripts?.start || '';
    const devScript = pkg.scripts?.dev || '';
    const hasRecognizedFramework = Boolean(deps['@nestjs/core'] || deps['express'] || deps['fastify']);
    const hasFrontendFramework = Boolean(deps['next'] || deps['vite'] || deps['react-scripts'] || deps['vue']);

    // A Node package with no server framework, no server start script, or explicit
    // frontend framework deps is a frontend package, not a web backend.
    if (!hasRecognizedFramework && (hasFrontendFramework || !startScript)) {
      return null;
    }

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

    // Check if start command references PORT and 0.0.0.0
    listensOnPortEnv = /process\.env\.PORT|PORT/.test(startScript + devScript);
    listensOnAllInterfaces = /0\.0\.0\.0/.test(startScript + devScript);

    // Look for common health check paths in code
    if (filePaths.some((p) => p.includes('health'))) {
      healthCheckPath = '/api/health';
    }
  } else {
    // Check Python (requirements.txt and/or main.py)
    runtime = 'python';
    buildCommand = filePaths.includes(reqTxtPath) ? 'pip install -r requirements.txt' : 'pip install -r requirements.txt';
    const content = filePaths.includes(reqTxtPath)
      ? await getFileContent(owner, repo, reqTxtPath, branch, token)
      : null;

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
    listensOnPortEnv,
    listensOnAllInterfaces,
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
  if (!backend || !backend.framework) {
    if (frontend && frontend.framework) return 'FRONTEND_ONLY';
    return 'ELECTRON_DESKTOP';
  }
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

