/**
 * @file github.service.js
 * @description GitHub REST API integration via Octokit for repository inspection and OAuth.
 */

import { Octokit } from '@octokit/rest';

/**
 * Hard cap on every GitHub REST request. Octokit/undici has no default request
 * timeout, so a stalled connection could otherwise block the "Repository
 * Inspection" orchestration step forever. Overridable via env for tests/tuning.
 */
const GITHUB_REQUEST_TIMEOUT_MS = Number(process.env.GITHUB_REQUEST_TIMEOUT_MS) || 15000;

/**
 * Instantiate Octokit with optional user access token or unauthenticated for public repos.
 * Every request is bounded by a timeout so a slow/hung GitHub API can never
 * leave a deployment stuck in the inspection step.
 */
export function getOctokit(token = null) {
  return new Octokit({
    ...(token ? { auth: token } : {}),
    request: { timeout: GITHUB_REQUEST_TIMEOUT_MS },
  });
}

/**
 * Parse owner, repository name, and optional branch from various GitHub URL formats.
 * Supports:
 *   https://github.com/username/project
 *   https://github.com/username/project.git
 *   https://github.com/username/project/tree/main
 *   https://github.com/username/project/blob/main/path/to/file
 *   git@github.com:username/project.git
 *   username/project
 *
 * Returns { owner, repo, branch } or null if unparseable.
 * branch is null when no explicit branch is present in the URL.
 */
export function parseGitHubUrl(urlOrName) {
  if (!urlOrName) return null;
  const cleaned = urlOrName
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');

  // If the cleaned string still contains a protocol, it was not a GitHub URL
  // (the github.com prefix was not stripped), so reject it.
  if (/^https?:\/\//i.test(cleaned)) return null;

  // Detect branch from /tree/<branch> or /blob/<branch> segments
  let branch = null;
  const branchMatch = cleaned.match(/(?:^|\/)(?:tree|blob)\/([^\/]+)(\/.*)?$/);
  if (branchMatch) {
    branch = branchMatch[1];
    // Remove the tree/blob segment and everything after for owner/repo extraction
    const beforeBranch = cleaned.slice(0, cleaned.lastIndexOf(`/${branchMatch[0].split('/')[1]}`));
    const parts = beforeBranch.split('/');
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1], branch };
    }
    return null;
  }

  const parts = cleaned.split('/');
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1], branch: null };
  }
  return null;
}

/**
 * Normalize a GitHub repository URL to canonical form: https://github.com/owner/repo
 * Strips .git, trailing slashes, tree/blob paths, and file paths.
 */
export function normalizeGitHubUrl(urlOrName) {
  if (!urlOrName) return null;
  const coords = parseGitHubUrl(urlOrName);
  if (!coords) return null;
  return `https://github.com/${coords.owner}/${coords.repo}`;
}

/**
 * Fetch repositories accessible to the authenticated user.
 */
async function _getUserRepositories(token) {
  const octokit = getOctokit(token);
  const response = await octokit.repos.listForAuthenticatedUser({
    sort: 'updated',
    per_page: 50,
    visibility: 'all',
  });

  return response.data.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    defaultBranch: repo.default_branch,
    isPrivate: repo.private,
    description: repo.description,
    language: repo.language,
    updatedAt: repo.updated_at,
  }));
}

// Test seam (behavior unchanged): allows controlled stubbing in tests without real GitHub API calls.
export const githubServiceApi = {
  getUserRepositories: _getUserRepositories,
  getRepositoryTree: _getRepositoryTree,
  getFileContent: _getFileContent,
};

export async function getUserRepositories(token) {
  return githubServiceApi.getUserRepositories(token);
}

/**
 * Retrieve the full recursive file tree of a repository without cloning.
 */
async function _getRepositoryTree(owner, repo, branch = 'HEAD', token = null) {
  const octokit = getOctokit(token);

  // 1. Get the latest commit SHA of the branch
  const refRes = await octokit.repos.getCommit({
    owner,
    repo,
    ref: branch,
  });
  const treeSha = refRes.data.commit.tree.sha;

  // 2. Fetch full recursive tree
  const treeRes = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: '1',
  });

  // Returns array of { path, mode, type: ('blob'|'tree'), sha, size }
  return treeRes.data.tree;
}

// Public wrapper routed through the test seam so tests can stub without live GitHub calls.
export async function getRepositoryTree(owner, repo, branch = 'HEAD', token = null) {
  return githubServiceApi.getRepositoryTree(owner, repo, branch, token);
}

/**
 * Fetch and decode raw text content of a file from GitHub repository.
 */
async function _getFileContent(owner, repo, path, branch = 'HEAD', token = null) {
  const octokit = getOctokit(token);

  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (res.data && res.data.content) {
      return Buffer.from(res.data.content, 'base64').toString('utf8');
    }
    return null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

// Public wrapper routed through the test seam so tests can stub without live GitHub calls.
export async function getFileContent(owner, repo, path, branch = 'HEAD', token = null) {
  return githubServiceApi.getFileContent(owner, repo, path, branch, token);
}

