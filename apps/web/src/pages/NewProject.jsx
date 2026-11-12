import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
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
  RefreshCw
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

  // 1. Fetch available repositories on load
  useEffect(() => {
    async function loadRepos() {
      try {
        const res = await api.get('/github/repos');
        const list = res.data.data || [];
        setRepositories(list);

        // Pre-select the first repo
        if (list.length > 0) {
          selectRepo(list[0]);
        }
      } catch (err) {
        console.error('Failed to load repositories:', err);
      } finally {
        setLoadingRepos(false);
      }
    }
    loadRepos();
  }, []);

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
                  setRepoUrl(e.target.value);
                  const clean = e.target.value.replace('https://github.com/', '');
                  setRepoFullName(clean);
                }}
                placeholder="https://github.com/username/repository"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm transition font-mono"
              />
              <button
                type="button"
                onClick={() => triggerAnalysis(repoUrl, defaultBranch)}
                disabled={analyzing || !repoUrl}
                className="px-4 py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 text-xs font-semibold transition flex items-center gap-1.5 border border-emerald-500/20 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {analyzing ? 'Scanning...' : 'Analyze Architecture'}
              </button>
            </div>
          </div>
        </div>

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
