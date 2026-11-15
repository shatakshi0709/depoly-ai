import prisma from '../config/db.js';
import { decrypt } from '../utils/crypto.js';
import { getUserRepositories } from '../services/github.service.js';
import { analyzeRepository } from '../services/analyzer.service.js';
import { parseGitHubUrl, normalizeGitHubUrl, getOctokit } from '../services/github.service.js';
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

      // Reject Electron-only desktop applications - they cannot run as Render web services.
      // Frontend-only repositories are accepted here; they deploy to Vercel only.
      if (analysis.applicationType === 'electron_desktop') {
        return res.status(400).json({
          success: false,
          error: 'ELECTRON_DESKTOP_APP',
          message:
            analysis.error ||
            'This repository is a desktop Electron application and cannot run as a Render web service. Select a backend/API project instead.',
          applicationType: 'electron_desktop',
        });
      }

      return res.json({
        success: true,
        data: analysis,
      });
    } catch (analysisErr) {
      // Live GitHub inspection failed. Never fabricate backend/frontend metadata:
      // returning a synthetic EXPRESS_NODE backend here would let the client create a
      // phantom Render service for a repository that was never actually inspected.
      // Surface a clear, bounded analysis error instead.
      const detail = analysisErr?.message ? String(analysisErr.message).slice(0, 300) : undefined;
      return res.status(502).json({
        success: false,
        error: 'GITHUB_ANALYSIS_FAILED',
        message:
          'Repository analysis failed: the repository could not be inspected on GitHub. ' +
          'Verify the repository URL and branch, ensure the repository is accessible, then try again.',
        detail,
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Fetch repository metadata from a GitHub URL.
 * Public repositories work without authentication.
 * Private repositories use the authenticated user's stored OAuth token if available.
 * Never exposes tokens in URLs, logs, or responses.
 */
export async function getMetadata(req, res, next) {
  try {
    const { repoUrl } = req.query || {};

    if (!isNonEmptyString(repoUrl) || repoUrl.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'A valid repository URL is required.',
      });
    }

    const coords = parseGitHubUrl(repoUrl.trim());
    if (!coords) {
      return res.status(400).json({
        success: false,
        message: 'Invalid GitHub repository URL. Expected format: https://github.com/owner/repo[/tree/branch]',
      });
    }

    const { owner, repo, branch: urlBranch } = coords;
    const normalizedUrl = normalizeGitHubUrl(repoUrl.trim());

    // Resolve the branch: prefer URL-specified branch, fall back to the repo's default branch
    let resolvedBranch = urlBranch || 'main';

    // Check if user has an OAuth token for private repo access
    let token = null;
    try {
      const oauth = await prisma.oAuthAccount.findFirst({
        where: { userId: req.user.userId, provider: 'github' },
      });
      if (oauth && oauth.accessTokenEnc) {
        token = decrypt(oauth.accessTokenEnc);
      }
    } catch {
      // Token lookup failure is non-fatal; proceed unauthenticated for public repos
    }

    const octokit = getOctokit(token);

    let repoData;
    try {
      const response = await octokit.repos.get({
        owner,
        repo,
      });
      repoData = response.data;
      // Use the actual default branch from GitHub if no branch was specified in the URL
      if (!urlBranch) {
        resolvedBranch = repoData.default_branch || 'main';
      }
    } catch (ghError) {
      const status = ghError?.status || ghError?.response?.status;
      if (status === 404) {
        return res.status(404).json({
          success: false,
          message: `Repository "${owner}/${repo}" not found or is not accessible.`,
        });
      }
      if (status === 401 || status === 403) {
        return res.status(403).json({
          success: false,
          message: `GitHub authentication failed for "${owner}/${repo}". Private repository access requires connecting your GitHub account.`,
        });
      }
      return res.status(502).json({
        success: false,
        message: `GitHub API error fetching repository metadata: ${ghError?.message || 'Unknown error'}`,
      });
    }

    return res.json({
      success: true,
      data: {
        owner: repoData.owner.login,
        repo: repoData.name,
        fullName: repoData.full_name,
        branch: resolvedBranch,
        defaultBranch: repoData.default_branch,
        isPrivate: repoData.private,
        description: repoData.description || null,
        language: repoData.language || null,
        htmlUrl: repoData.html_url,
        cloneUrl: repoData.clone_url,
        updatedAt: repoData.updated_at,
        normalizedUrl,
      },
    });
  } catch (error) {
    next(error);
  }
}

