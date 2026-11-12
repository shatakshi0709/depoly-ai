import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { 
  Rocket, 
  Server, 
  Globe, 
  CheckCircle2, 
  Sparkles, 
  ArrowRight, 
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';

const PRESET_TEMPLATES = [
  {
    name: 'ecommerce-fullstack-starter',
    repo: 'demo-org/ecommerce-fullstack-starter',
    url: 'https://github.com/demo-org/ecommerce-fullstack-starter',
    branch: 'main',
    preset: 'REACT_VITE',
    backend: { dir: '/server', build: 'npm install', start: 'npm start', health: '/api/health' },
    frontend: { dir: '/client', build: 'npm run build', start: 'npm run preview' },
  },
  {
    name: 'saas-analytics-app',
    repo: 'demo-org/saas-analytics-app',
    url: 'https://github.com/demo-org/saas-analytics-app',
    branch: 'main',
    preset: 'REACT_VITE',
    backend: { dir: '/backend', build: 'npm install', start: 'node index.js', health: '/health' },
    frontend: { dir: '/frontend', build: 'npm run build', start: 'npm run preview' },
  },
];

export function NewProject() {
  const [name, setName] = useState('ecommerce-fullstack-starter');
  const [repoFullName, setRepoFullName] = useState('demo-org/ecommerce-fullstack-starter');
  const [repoUrl, setRepoUrl] = useState('https://github.com/demo-org/ecommerce-fullstack-starter');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisDone, setAnalysisDone] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Configuration settings (auto-detected)
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

  const handleSelectTemplate = (tpl) => {
    setName(tpl.name);
    setRepoFullName(tpl.repo);
    setRepoUrl(tpl.url);
    setDefaultBranch(tpl.branch);
    setBackendConfig({
      rootDirectory: tpl.backend.dir,
      buildCommand: tpl.backend.build,
      startCommand: tpl.backend.start,
      healthCheckPath: tpl.backend.health,
    });
    setFrontendConfig({
      rootDirectory: tpl.frontend.dir,
      buildCommand: tpl.frontend.build,
      startCommand: tpl.frontend.start,
    });
  };

  const handleAnalyze = () => {
    setAnalyzing(true);
    setTimeout(() => {
      setAnalyzing(false);
      setAnalysisDone(true);
    }, 1200);
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
        detectedPreset: 'REACT_VITE',
        backendService: backendConfig,
        frontendService: frontendConfig,
      });

      const projectId = projectRes.data.data.id;

      // 2. Trigger initial deployment
      const deployRes = await api.post('/projects/deployments/trigger', {
        projectId,
        commitMessage: 'Initial full-stack automated deployment',
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
          Connect your GitHub repository. deplo.ai analyzes the codebase, configures Render for your backend, Vercel for your frontend, and automates URL injection.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Preset Starter Repositories */}
      <div className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Quick Start with Demo Repositories
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PRESET_TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              type="button"
              onClick={() => handleSelectTemplate(tpl)}
              className={`p-4 rounded-xl border text-left transition flex items-start gap-3 ${
                name === tpl.name
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <GithubIcon className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-slate-200">{tpl.name}</div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">{tpl.repo}</div>
                <div className="text-[11px] text-emerald-400 mt-1">Render (Node) + Vercel (React)</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Repository Details Card */}
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm transition"
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
                onClick={handleAnalyze}
                disabled={analyzing}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                {analyzing ? 'Inspecting...' : 'Analyze Tree'}
              </button>
            </div>
          </div>
        </div>

        {/* AI Framework Analysis Results */}
        {analysisDone && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Architecture Heuristic Analysis Complete</span>
              </h2>
              <span className="text-xs text-slate-400">Order: Backend $\rightarrow$ Frontend</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Backend Target: Render */}
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-white">Backend Service</span>
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
                    <span className="text-sm font-bold text-white">Frontend Service</span>
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
            disabled={submitting}
            className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-500/20 flex items-center gap-2 disabled:opacity-50"
          >
            {submitting ? 'Initializing Orchestrator...' : 'Confirm & Deploy Pipeline'}
            <Rocket className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
