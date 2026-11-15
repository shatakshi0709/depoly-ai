import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { 
  Rocket, 
  Server, 
  Globe, 
  CheckCircle2, 
  Sparkles, 
  AlertCircle,
  HelpCircle,
  Layers,
  ArrowRight,
  RefreshCw,
  Loader2,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';

export function NewProject() {
  const [repositories, setRepositories] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(true);

  // Form states
  const [name, setName] = useState('');
  const [repoFullName, setRepoFullName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');

  // Analysis states
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Editable configurations pre-filled by analysis
  const [backendConfig, setBackendConfig] = useState({
    rootDirectory: '/server',
    buildCommand: 'npm install',
    startCommand: 'npm start',
    healthCheckPath: '/api/health',
  });

  const [frontendConfig, setFrontendConfig] = useState({
    rootDirectory: '/client',
    buildCommand: 'npm run build',
    startCommand: 'npm run preview',
  });

  const navigate = useNavigate();
const { refreshProfile, user, loading: authLoading } = useAuth();

console.log('[NewProject] Component render. user=', JSON.stringify({ id: user?.id, hasGithubConnected: user?.hasGithubConnected, email: user?.email }), 'authLoading=', authLoading);

  const [repoError, setRepoError] = useState('');
const [oauthLoading, setOauthLoading] = useState(false);

// URL import state (direct repository URL import, works without OAuth)
const [urlError, setUrlError] = useState('');
const [urlLoading, setUrlLoading] = useState(false);
const [repoMetadata, setRepoMetadata] = useState(null);

/**
 * Validate and normalize a GitHub repository URL.
 * Returns { owner, repo, branch, normalizedUrl } or null.
 */
function parseAndValidateGitHubUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const cleaned = url.trim();
  if (!cleaned) return null;

  // Accept https://github.com/owner/repo[/tree/branch] or owner/repo
  const urlPattern = /^(?:https?:\/\/github\.com\/)?([^\/]+)\/([^\/]+?)(?:\/(?:tree|blob)\/([^\/]+))?\/?$/;
  const match = cleaned.match(urlPattern);
  if (!match) return null;

  const owner = match[1].trim();
  const repo = match[2].trim().replace(/\.git$/, '');
  const branch = match[3] || null;

  if (!owner || !repo || owner.includes('.') || repo.includes('.')) return null;

  const normalized = `https://github.com/${owner}/${repo}${branch ? `/tree/${branch}` : ''}`;
  return { owner, repo, branch, normalizedUrl: normalized };
}

/**
 * Fetch repository metadata from the backend for a manual URL import.
 * Works for public repos without OAuth; private repos use stored token if available.
 */
async function fetchRepoMetadata(url) {
  const parsed = parseAndValidateGitHubUrl(url);
  if (!parsed) {
    throw new Error('Invalid GitHub repository URL. Expected: https://github.com/owner/repository[/tree/branch]');
  }

  const res = await api.get('/github/metadata', {
    params: { repoUrl: parsed.normalizedUrl },
  });
  return { ...parsed, ...res.data.data };
}

  // 1. Fetch available repositories on load (authenticated user's real GitHub repositories)
  useEffect(() => {
    async function loadRepos() {
      console.log('[NewProject] loadRepos called. authLoading=', authLoading, 'hasGithubConnected=', user?.hasGithubConnected);
      try {
        setRepoError('');
        // Wait for auth to finish loading before deciding what to show
        if (authLoading) {
          console.log('[NewProject] loadRepos: auth still loading, skipping');
          return;
        }
        // Only load repos if GitHub is connected; otherwise show Connect button
        if (!user?.hasGithubConnected) {
          console.log('[NewProject] loadRepos: GitHub not connected, showing Connect button');
          setLoadingRepos(false);
          return;
        }
        console.log('[NewProject] loadRepos: GitHub connected, fetching repos from /github/repos');
        const res = await api.get('/github/repos');
        console.log('[NewProject] loadRepos: /github/repos status=', res.status, 'repoCount=', res.data?.data?.length || 0);
        const list = res.data?.data || [];
        setRepositories(list);

        // Pre-select the first repo
        if (list.length > 0) {
          selectRepo(list[0]);
        }
      } catch (err) {
        const message = err?.response?.data?.message || err?.message || 'Failed to load repositories from GitHub.';
        console.log('[NewProject] loadRepos: /github/repos ERROR status=', err?.response?.status, 'message=', message);
        setRepoError(message);
        setRepositories([]);
      } finally {
        if (!authLoading) setLoadingRepos(false);
      }
    }
    loadRepos();
  }, [authLoading, user]);

  // Sync GitHub connection state when Electron window regains focus
  // after OAuth completes in Chrome/system browser. Without this, Electron
  // keeps the stale user profile from before OAuth (hasGithubConnected: false)
  // and never re-fetches repositories.
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
  const focusProcessingRef = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!isElectron) {
      console.log('[NewProject] Not Electron (isElectron=', isElectron, '), skipping focus sync');
      return;
    }
    console.log('[NewProject] Electron detected, registering focus/visibility listeners');

    const handleFocus = async () => {
      console.log('[NewProject] Focus/visibility event fired. focusProcessingRef=', focusProcessingRef.current, 'hasGithubConnected=', userRef.current?.hasGithubConnected);
      if (focusProcessingRef.current) {
        console.log('[NewProject] Focus: already processing, skipping');
        return;
      }
      // Only refresh if GitHub connection status is not yet confirmed
      if (userRef.current?.hasGithubConnected) {
        console.log('[NewProject] Focus: GitHub already connected, skipping refresh');
        return;
      }
      focusProcessingRef.current = true;
      console.log('[NewProject] Focus: calling refreshProfile()');
      try {
        await refreshProfile();
        console.log('[NewProject] Focus: refreshProfile completed. New user=', JSON.stringify({ id: user?.id, hasGithubConnected: user?.hasGithubConnected }));
      } catch (e) {
        console.log('[NewProject] Focus: refreshProfile threw error:', e.message);
      } finally {
        focusProcessingRef.current = false;
      }
    };

    // window.focus fires when the Electron BrowserWindow regains focus.
    // visibilitychange fires when the page becomes visible again (more reliable
    // for cross-app switching on some platforms). Both guard against duplicate
    // execution via focusProcessingRef.
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    console.log('[NewProject] Focus/visibility listeners registered');
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      console.log('[NewProject] Focus/visibility listeners removed');
    };
  }, [isElectron, refreshProfile]);

  const selectRepo = (repo) => {
    setName(repo.name);
    setRepoFullName(repo.fullName);
    setRepoUrl(repo.url);
    setDefaultBranch(repo.defaultBranch || 'main');
    // Trigger automated analysis for the selected repo
    triggerAnalysis(repo.url, repo.defaultBranch || 'main');
  };

  const triggerAnalysis = async (urlToAnalyze, branchToAnalyze) => {
    const targetUrl = urlToAnalyze || repoUrl;
    if (!targetUrl) return;

    setAnalyzing(true);
    setError('');

    try {
      const res = await api.post('/github/analyze', {
        repoUrl: targetUrl,
        branch: branchToAnalyze || defaultBranch,
      });

      const report = res.data.data;
      setAnalysisResult(report);

      // Pre-fill backend and frontend configuration fields
      if (report.backend) {
        setBackendConfig({
          rootDirectory: report.backend.rootDirectory || '/server',
          buildCommand: report.backend.buildCommand || 'npm install',
          startCommand: report.backend.startCommand || 'npm start',
          healthCheckPath: report.backend.healthCheckPath || '/health',
        });
      }

      if (report.frontend) {
        setFrontendConfig({
          rootDirectory: report.frontend.rootDirectory || '/client',
          buildCommand: report.frontend.buildCommand || 'npm run build',
          startCommand: report.frontend.startCommand || 'npm run preview',
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Repository analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  // Analyze a manually entered GitHub URL (works with or without OAuth).
  // Fetches metadata, then runs architecture analysis.
  const fetchAndAnalyzeUrl = async () => {
    const targetUrl = repoUrl.trim();
    if (!targetUrl) return;

    const parsed = parseAndValidateGitHubUrl(targetUrl);
    if (!parsed) {
      setUrlError('Invalid GitHub repository URL. Expected: https://github.com/owner/repository[/tree/branch]');
      return;
    }
    setUrlError('');
    setUrlLoading(true);
    setAnalyzing(true);
    setError('');

    try {
      // 1. Fetch metadata (owner, repo, branch, isPrivate, etc.)
      const meta = await fetchRepoMetadata(targetUrl);
      setRepoMetadata(meta);

      // Update form fields from metadata
      setRepoFullName(`${meta.owner}/${meta.repo}`);
      if (meta.branch) setDefaultBranch(meta.branch);
      setRepoUrl(meta.normalizedUrl);

      // 2. Run architecture analysis (uses stored OAuth token for private repos if available)
      await triggerAnalysis(meta.normalizedUrl, meta.branch || defaultBranch);
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Failed to fetch repository metadata.';
      setUrlError(message);
      setRepoMetadata(null);
    } finally {
      setUrlLoading(false);
      setAnalyzing(false);
    }
  };

  // Connect GitHub for already-authenticated user (Electron or web)
  const connectGitHub = async () => {
    console.log('[NewProject] connectGitHub: called. user=', JSON.stringify({ id: user?.id, hasGithubConnected: user?.hasGithubConnected }));
    setRepoError('');
    setOauthLoading(true);
    try {
      const res = await api.get('/auth/github/connect/start');
      const { state, authorizeUrl } = res.data?.data || {};
      if (!state || !authorizeUrl) {
        throw new Error('OAuth connect start failed');
      }
      // Store state for callback handling (server-side signed-state verification is authoritative).
      try {
        sessionStorage.setItem('deplo_oauth_state', state);
      } catch {
        // Storage unavailable; server-side signed-state verification remains authoritative.
      }
      window.location.href = authorizeUrl;
      console.log('[NewProject] connectGitHub: navigated to authorizeUrl. Electron will open system browser via will-navigate handler.');
    } catch (err) {
      setRepoError(err.response?.data?.message || 'Unable to start GitHub connection. Please try again.');
    } finally {
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // 1. Create project with both services
      const projectRes = await api.post('/projects', {
        name,
        githubRepoFullName: repoFullName,
        githubRepoUrl: repoUrl,
        defaultBranch,
        detectedPreset: analysisResult?.detectedPreset || 'REACT_VITE',
        backendService: backendConfig,
        frontendService: frontendConfig,
      });

      const projectId = projectRes.data.data.id;

      // 2. Trigger initial deployment
      const deployRes = await api.post('/projects/deployments/trigger', {
        projectId,
        commitMessage: 'Initial automated multi-cloud deployment',
      });

      const deploymentId = deployRes.data.data.id;

      // 3. Navigate to live console
      navigate(`/deployments/${deploymentId}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create and deploy project.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-400" />
          <span>New Multi-Cloud Deployment</span>
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Select or paste a repository. deplo.ai analyzes the codebase, configures Render for your backend, Vercel for your frontend, and automates URL injection.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Repository Selection */}
      <div className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>Choose a Repository to Deploy</span>
          {loadingRepos && <span className="text-[11px] text-slate-500">Loading repositories...</span>}
        </label>

        {repoError && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{repoError}</span>
          </div>
        )}

        {authLoading ? (
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Checking GitHub connection...</span>
          </div>
        ) : !user?.hasGithubConnected ? (
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <GithubIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-slate-300">Connect your GitHub account to list repositories.</span>
            </div>
            <button
              onClick={connectGitHub}
              disabled={oauthLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-slate-950 font-medium text-sm transition disabled:opacity-60"
            >
              {oauthLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </span>
              ) : (
                <>
                  <GithubIcon className="w-4 h-4" />
                  Connect GitHub
                </>
              )}
            </button>
          </div>
        ) : user?.hasGithubConnected && !loadingRepos && !repoError && repositories.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 text-sm">
            No repositories found for the connected GitHub account. You can still paste a repository URL below.
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {repositories.map((repo) => (
            <button
              key={repo.id}
              type="button"
              onClick={() => selectRepo(repo)}
              className={`p-3.5 rounded-xl border text-left transition flex items-start gap-2.5 ${
                repoFullName === repo.fullName
                  ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/20'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <GithubIcon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div className="truncate">
                <div className="text-xs font-bold text-slate-200 truncate">{repo.name}</div>
                <div className="text-[11px] text-slate-400 font-mono truncate">{repo.fullName}</div>
                <div className="text-[10px] text-emerald-400 mt-1 font-semibold">{repo.language || 'Fullstack'}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Repository Coordinates */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <GithubIcon className="w-4 h-4 text-slate-400" />
            <span>Repository Coordinates</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Project Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-portfolio-app"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Branch
              </label>
              <input
                type="text"
                required
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm transition font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              GitHub Repository URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                required
                value={repoUrl}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setRepoUrl(val);
                  const parsed = parseAndValidateGitHubUrl(val);
                  if (parsed) {
                    setRepoFullName(`${parsed.owner}/${parsed.repo}`);
                    if (parsed.branch) setDefaultBranch(parsed.branch);
                    setUrlError('');
                  } else if (val) {
                    setUrlError('Invalid GitHub URL. Expected: https://github.com/owner/repository[/tree/branch]');
                  } else {
                    setUrlError('');
                  }
                }}
                placeholder="https://github.com/username/repository[/tree/branch]"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm transition font-mono"
              />
              <button
                type="button"
                onClick={fetchAndAnalyzeUrl}
                disabled={urlLoading || analyzing || !repoUrl}
                className="px-4 py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 text-xs font-semibold transition flex items-center gap-1.5 border border-emerald-500/20 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {urlLoading ? 'Loading...' : analyzing ? 'Scanning...' : 'Analyze URL'}
              </button>
            </div>
            {urlError && (
              <div className="mt-1.5 text-xs text-rose-400 font-mono">{urlError}</div>
            )}
          </div>
        </div>

        {/* Repository Metadata (from manual URL import) */}
        {repoMetadata && (
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GithubIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                <h2 className="text-sm font-bold text-white">Repository Details</h2>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                repoMetadata.isPrivate ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                {repoMetadata.isPrivate ? 'Private' : 'Public'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono text-slate-300">
              <div>
                <span className="text-slate-500 block">Owner</span>
                <span className="text-slate-200">{repoMetadata.owner}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Repository</span>
                <span className="text-slate-200">{repoMetadata.repo}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Branch</span>
                <span className="text-slate-200">{repoMetadata.branch}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Language</span>
                <span className="text-slate-200">{repoMetadata.language || 'Not detected'}</span>
              </div>
              {repoMetadata.description && (
                <div className="col-span-2">
                  <span className="text-slate-500 block">Description</span>
                  <span className="text-slate-200 truncate max-w-[200px]">{repoMetadata.description}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <a
                href={repoMetadata.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
              >
                <ExternalLink className="w-3 h-3" />
                View on GitHub
              </a>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(repoMetadata.normalizedUrl);
                }}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 transition"
                title="Copy URL"
              >
                <Copy className="w-3 h-3" />
                Copy URL
              </button>
            </div>
          </div>
        )}

        {/* AI Framework Analysis Results */}
        {analysisResult && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                    Architecture Detected: {analysisResult.detectedPreset}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    {analysisResult.orchestrationPlan?.reasoning}
                  </div>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-slate-900 text-slate-300 border border-slate-700">
                {analysisResult.repository?.isMonorepo ? 'Monorepo' : 'Standard'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Backend Target: Render */}
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-white">Backend Web Service</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    TARGET: RENDER
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Root Directory</label>
                    <input
                      type="text"
                      value={backendConfig.rootDirectory}
                      onChange={(e) => setBackendConfig({ ...backendConfig, rootDirectory: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Build Command</label>
                    <input
                      type="text"
                      value={backendConfig.buildCommand}
                      onChange={(e) => setBackendConfig({ ...backendConfig, buildCommand: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Start Command</label>
                    <input
                      type="text"
                      value={backendConfig.startCommand}
                      onChange={(e) => setBackendConfig({ ...backendConfig, startCommand: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Health Check Path</label>
                    <input
                      type="text"
                      value={backendConfig.healthCheckPath}
                      onChange={(e) => setBackendConfig({ ...backendConfig, healthCheckPath: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                </div>

                {/* Free Tier Notice */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-emerald-500/20 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                        FREE TIER
                      </span>
                      <span className="text-xs font-bold text-white">Backend Compute Plan</span>
                    </div>
                    <span className="ml-auto text-[11px] text-emerald-400 font-bold">$0/month</span>
                  </div>
                  <ul className="space-y-2 text-xs text-slate-300">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                      <span>Render "free" compute plan (no credit card required)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-slate-400 w-3 h-3 mt-0.5 shrink-0">-</span>
                      <span>Service spins down after inactivity</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-slate-400 w-3 h-3 mt-0.5 shrink-0">-</span>
                      <span>No persistent disk (ephemeral filesystem)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-slate-400 w-3 h-3 mt-0.5 shrink-0">-</span>
                      <span>750 hours/month included</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-slate-400 w-3 h-3 mt-0.5 shrink-0">-</span>
                      <span>Paid plans are not available without explicit selection</span>
                    </li>
                  </ul>
                </div>

              {/* Frontend Target: Vercel */}
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-sky-400" />
                    <span className="text-sm font-bold text-white">Frontend Web Service</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    TARGET: VERCEL
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Root Directory</label>
                    <input
                      type="text"
                      value={frontendConfig.rootDirectory}
                      onChange={(e) => setFrontendConfig({ ...frontendConfig, rootDirectory: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Build Command</label>
                    <input
                      type="text"
                      value={frontendConfig.buildCommand}
                      onChange={(e) => setFrontendConfig({ ...frontendConfig, buildCommand: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Preview Command</label>
                    <input
                      type="text"
                      value={frontendConfig.startCommand}
                      onChange={(e) => setFrontendConfig({ ...frontendConfig, startCommand: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Auto Environment Injection</label>
                    <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[11px] flex items-center justify-between">
                      <span>VITE_API_URL = &lt;Render Backend URL&gt;</span>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submit Action */}
        <div className="pt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2.5 rounded-xl border border-slate-800 text-slate-400 hover:text-white text-sm font-semibold transition"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={submitting || analyzing}
            className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-500/20 flex items-center gap-2 disabled:opacity-50"
          >
            {submitting ? 'Initializing Pipeline...' : 'Confirm & Deploy Pipeline'}
            <Rocket className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
