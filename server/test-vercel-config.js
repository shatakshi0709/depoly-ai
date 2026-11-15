/**
 * Vercel deployment configuration tests (in-process, no real Vercel API calls, no deployments).
 *
 * Regression coverage for:
 *   - [STATIC_BUILD_NO_OUT_DIR] "No Output Directory named dist found" when the Vite app
 *     lives in a subdirectory (e.g. vite-project/).
 *   - project creation AND deployment payloads both configuring
 *     rootDirectory / outputDirectory / framework / buildCommand.
 *   - syncing settings onto a pre-existing (possibly stale) Vercel project.
 *   - environment-variable API errors no longer being silently swallowed.
 */
import assert from 'assert/strict';
import axios from 'axios';
import { env } from './src/config/env.js';
import {
  ensureVercelProject,
  triggerVercelDeploy,
  upsertVercelEnvVars,
  mapVercelFramework,
} from './src/services/vercel.service.js';

let pass = 0;
let fail = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`FAIL: ${name} -> ${e.message}`);
  }
}

/** Run fn with a mocked axios client and a fake Vercel API key. */
async function withMockedVercel(mockClient, fn) {
  const origCreate = axios.create;
  const origKey = env.VERCEL_API_KEY;
  axios.create = () => mockClient;
  env.VERCEL_API_KEY = 'test_vercel_key';
  try {
    return await fn();
  } finally {
    axios.create = origCreate;
    env.VERCEL_API_KEY = origKey;
  }
}

function notFound() {
  return Object.assign(new Error('Not Found'), { response: { status: 404 } });
}

async function main() {
  console.log('Running Vercel configuration tests (in-process)...');

  await test('1. mapVercelFramework maps analyzer labels to Vercel slugs', async () => {
    assert.equal(mapVercelFramework('REACT_VITE'), 'vite');
    assert.equal(mapVercelFramework('NEXT_JS'), 'nextjs');
    assert.equal(mapVercelFramework('CREATE_REACT_APP'), 'create-react-app');
    assert.equal(mapVercelFramework('VUE'), 'vue');
    assert.equal(mapVercelFramework('STATIC_HTML'), null);
    assert.equal(mapVercelFramework(undefined), 'vite');
  });

  await test('2. ensureVercelProject create payload configures subdirectory Vite output', async () => {
    let createdBody = null;
    const mockClient = {
      get: async () => { throw notFound(); },
      post: async (url, data) => {
        assert.equal(url, '/v10/projects');
        createdBody = data;
        return { data: { id: 'prj_new', name: data.name } };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await ensureVercelProject({
        name: 'wap-grp-project',
        repoUrl: 'https://github.com/shatakshi0709/WAP-Grp-Project',
        rootDir: '/vite-project',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        framework: 'vite',
      });
      assert.equal(result.projectId, 'prj_new');
    });

    assert.ok(createdBody, 'Project create payload must be sent');
    assert.equal(createdBody.rootDirectory, 'vite-project', 'rootDirectory must drop the leading slash for Vercel');
    assert.equal(createdBody.outputDirectory, 'dist', 'outputDirectory must be set to dist');
    assert.equal(createdBody.framework, 'vite', 'framework must be the Vercel slug');
    assert.equal(createdBody.buildCommand, 'npm run build');
    assert.deepEqual(createdBody.gitRepository, {
      type: 'github',
      repo: 'shatakshi0709/WAP-Grp-Project',
    });
  });

  await test('3. ensureVercelProject syncs settings on an existing (stale) project', async () => {
    let patchedUrl = null;
    let patchedBody = null;
    const mockClient = {
      get: async (url) => {
        assert.equal(url, '/v9/projects/wap-grp-project');
        return { data: { id: 'prj_existing', name: 'wap-grp-project' } };
      },
      patch: async (url, data) => {
        patchedUrl = url;
        patchedBody = data;
        return { data: {} };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await ensureVercelProject({
        name: 'wap-grp-project',
        repoUrl: 'https://github.com/shatakshi0709/WAP-Grp-Project',
        rootDir: '/vite-project',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        framework: 'vite',
      });
      assert.equal(result.projectId, 'prj_existing');
    });

    assert.equal(patchedUrl, '/v9/projects/prj_existing', 'Existing project settings must be patched');
    assert.equal(patchedBody.rootDirectory, 'vite-project');
    assert.equal(patchedBody.outputDirectory, 'dist');
    assert.equal(patchedBody.framework, 'vite');
  });

  await test('4. triggerVercelDeploy projectSettings include outputDirectory + framework', async () => {
    let deployBody = null;
    const mockClient = {
      post: async (url, data) => {
        assert.equal(url, '/v13/deployments');
        deployBody = data;
        return { data: { id: 'dpl_123', url: 'wap.vercel.app', readyState: 'QUEUED' } };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await triggerVercelDeploy({
        name: 'wap-grp-project',
        repoUrl: 'https://github.com/shatakshi0709/WAP-Grp-Project',
        branch: 'main',
        rootDir: '/vite-project',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        framework: 'vite',
      });
      assert.equal(result.deploymentId, 'dpl_123');
      assert.equal(result.url, 'https://wap.vercel.app');
    });

    assert.ok(deployBody.projectSettings, 'projectSettings must be present');
    assert.equal(deployBody.projectSettings.rootDirectory, 'vite-project');
    assert.equal(deployBody.projectSettings.outputDirectory, 'dist');
    assert.equal(deployBody.projectSettings.framework, 'vite');
    assert.equal(deployBody.projectSettings.buildCommand, 'npm run build');
    assert.equal(deployBody.gitSource.repo, 'WAP-Grp-Project');
    assert.equal(deployBody.gitSource.org, 'shatakshi0709');
    assert.equal(deployBody.target, 'production');
  });

  await test('5. upsertVercelEnvVars throws when an env var cannot be configured (no false success)', async () => {
    const mockClient = {
      post: async () => {
        throw Object.assign(new Error('Forbidden'), { response: { status: 403, data: { error: { message: 'Forbidden' } } } });
      },
    };

    await withMockedVercel(mockClient, async () => {
      let threw = false;
      try {
        await upsertVercelEnvVars('prj_1', [{ key: 'VITE_API_URL', value: 'https://api.example.com' }]);
      } catch (e) {
        threw = true;
        assert.ok(e.message.includes('VITE_API_URL'), `Error should name the failing key: ${e.message}`);
        assert.equal(e.applied, 0);
        assert.equal(e.failures.length, 1);
      }
      assert.equal(threw, true, 'A failed env var operation must throw, not report success');
    });
  });

  await test('6. upsertVercelEnvVars updates an existing key on HTTP 409', async () => {
    let patchedUrl = null;
    let patchedBody = null;
    let postCount = 0;
    const mockClient = {
      post: async () => {
        postCount++;
        throw Object.assign(new Error('Conflict'), { response: { status: 409 } });
      },
      get: async (url) => {
        assert.equal(url, '/v10/projects/prj_1/env');
        return { data: { envs: [{ id: 'env_abc', key: 'VITE_API_URL' }] } };
      },
      patch: async (url, data) => {
        patchedUrl = url;
        patchedBody = data;
        return { data: {} };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await upsertVercelEnvVars('prj_1', [{ key: 'VITE_API_URL', value: 'https://api.example.com' }]);
      assert.equal(result.success, true);
      assert.equal(result.count, 1);
    });

    assert.equal(postCount, 1);
    assert.equal(patchedUrl, '/v10/projects/prj_1/env/env_abc');
    assert.equal(patchedBody.value, 'https://api.example.com');
  });

  await test('7. upsertVercelEnvVars reports success only when all keys are applied', async () => {
    const mockClient = {
      post: async () => ({ data: {} }),
    };

    await withMockedVercel(mockClient, async () => {
      const result = await upsertVercelEnvVars('prj_1', [
        { key: 'VITE_API_URL', value: 'https://api.example.com' },
        { key: 'VITE_FEATURE_FLAG', value: 'on' },
      ]);
      assert.equal(result.success, true);
      assert.equal(result.count, 2);
      assert.equal(result.simulated, false);
    });
  });

  await test('8. upsertVercelEnvVars skips a null VITE_API_URL (frontend-only, no 400)', async () => {
    let posts = 0;
    const mockClient = {
      post: async () => {
        posts++;
        return { data: {} };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await upsertVercelEnvVars('prj_1', [{ key: 'VITE_API_URL', value: null }]);
      assert.equal(result.success, true);
      assert.equal(result.count, 0);
      assert.equal(result.skipped, 1);
    });

    assert.equal(posts, 0, 'A null value must never be sent to the Vercel API');
  });

  await test('9. upsertVercelEnvVars skips undefined and whitespace-only values', async () => {
    let posts = 0;
    const mockClient = {
      post: async () => {
        posts++;
        return { data: {} };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await upsertVercelEnvVars('prj_1', [
        { key: 'EMPTY_UNDEFINED', value: undefined },
        { key: 'EMPTY_STRING', value: '' },
        { key: 'WHITESPACE', value: '   ' },
      ]);
      assert.equal(result.success, true);
      assert.equal(result.count, 0);
      assert.equal(result.skipped, 3);
    });

    assert.equal(posts, 0, 'Blank values must never be sent to the Vercel API');
  });

  await test('10. upsertVercelEnvVars sends a valid VITE_API_URL', async () => {
    let sentBody = null;
    const mockClient = {
      post: async (url, data) => {
        sentBody = data;
        return { data: {} };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await upsertVercelEnvVars('prj_1', [
        { key: 'VITE_API_URL', value: 'https://api.example.com' },
      ]);
      assert.equal(result.success, true);
      assert.equal(result.count, 1);
      assert.equal(result.skipped, 0);
    });

    assert.equal(sentBody.key, 'VITE_API_URL');
    assert.equal(sentBody.value, 'https://api.example.com');
  });

  await test('11. full-stack: valid VITE_API_URL is kept while a null value is skipped', async () => {
    const sentKeys = [];
    const mockClient = {
      post: async (url, data) => {
        sentKeys.push({ key: data.key, value: data.value });
        return { data: {} };
      },
    };

    await withMockedVercel(mockClient, async () => {
      const result = await upsertVercelEnvVars('prj_1', [
        { key: 'VITE_API_URL', value: 'https://backend.onrender.com' },
        { key: 'UNSET_VAR', value: null },
      ]);
      assert.equal(result.success, true);
      assert.equal(result.count, 1);
      assert.equal(result.skipped, 1);
    });

    assert.deepEqual(sentKeys, [{ key: 'VITE_API_URL', value: 'https://backend.onrender.com' }]);
  });

  console.log(`\nVercel configuration tests: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
