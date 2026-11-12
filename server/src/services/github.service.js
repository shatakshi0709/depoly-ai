/**
 * @file github.service.js
 * @description GitHub REST API integration via Octokit for repository inspection and OAuth.
 */

import { Octokit } from '@octokit/rest';

/**
 * Instantiate Octokit with optional user access token or unauthenticated for public repos.
 */
export function getOctokit(token = null) {
  return new Octokit(token ? { auth: token } : {});
}

/**
 * Parse owner and repository name from various GitHub URL formats.
 * e.g., 'https://github.com/username/project' -> { owner: 'username', repo: 'project' }
 */
export function parseGitHubUrl(urlOrName) {
  if (!urlOrName) return null;
  const cleaned = urlOrName
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '');

  const parts = cleaned.split('/');
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

/**
 * Fetch repositories accessible to the authenticated user.
 */
export async function getUserRepositories(token) {
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

/**
 * Retrieve the full recursive file tree of a repository without cloning.
 */
export async function getRepositoryTree(owner, repo, branch = 'HEAD', token = null) {
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

/**
 * Fetch and decode raw text content of a file from GitHub repository.
 */
export async function getFileContent(owner, repo, path, branch = 'HEAD', token = null) {
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
