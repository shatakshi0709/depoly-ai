import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { 
  Rocket, 
  GitBranch, 
  Server, 
  Globe, 
  Play, 
  Clock, 
  ExternalLink,
  ChevronRight,
  AlertCircle,
  Key,
  Plus,
  Trash2,
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';

export function ProjectDetails() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [envVars, setEnvVars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [triggering, setTriggering] = useState(false);

  // New Env Var Form
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newTarget, setNewTarget] = useState('SHARED');
  const [savingEnv, setSavingEnv] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    async function fetchProjectData() {
      try {
        const [projRes, envRes] = await Promise.all([
          api.get(`/projects/${id}`),
          api.get(`/projects/${id}/env`),
        ]);
        setProject(projRes.data.data);
        setEnvVars(envRes.data.data || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load project details.');
      } finally {
        setLoading(false);
      }
    }
    fetchProjectData();
  }, [id]);

  const handleTriggerDeploy = async () => {
    try {
      setTriggering(true);
      const res = await api.post('/projects/deployments/trigger', {
        projectId: id,
        commitMessage: 'Manual redeploy from project dashboard',
      });
      const deploymentId = res.data.data.id;
      navigate(`/deployments/${deploymentId}`);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to trigger deployment.');
      setTriggering(false);
    }
  };

  const handleRetryDeployment = async (deploymentId) => {
    try {
      const res = await api.post(`/projects/deployments/${deploymentId}/retry`);
      const newId = res.data?.data?.id;
      if (newId) navigate(`/deployments/${newId}`);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to retry deployment.');
    }
  };

  const handleAddEnv = async (e) => {
    e.preventDefault();
    if (!newKey || !newValue) return;

    setSavingEnv(true);
    try {
      await api.post(`/projects/${id}/env`, {
        key: newKey.toUpperCase().replace(/\s+/g, '_'),
        value: newValue,
        serviceTarget: newTarget,
        isSecret: true,
      });

      // Refresh list
      const envRes = await api.get(`/projects/${id}/env`);
      setEnvVars(envRes.data.data || []);
      setNewKey('');
      setNewValue('');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save environment variable.');
    } finally {
      setSavingEnv(false);
    }
  };

  const handleDeleteEnv = async (envId) => {
    if (!confirm('Are you sure you want to remove this environment variable?')) return;
    try {
      await api.delete(`/projects/${id}/env/${envId}`);
      setEnvVars((prev) => prev.filter((e) => e.id !== envId));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete variable.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Loading project specification...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-400 mx-auto" />
        <h2 className="text-lg font-bold text-white">Project Not Found</h2>
        <p className="text-sm text-slate-400">{error || 'Unable to retrieve project.'}</p>
        <Link to="/" className="inline-block px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const backendService = project.services.find((s) => s.serviceType === 'BACKEND');
  const frontendService = project.services.find((s) => s.serviceType === 'FRONTEND');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Breadcrumb & Header */}
      <div className="space-y-4 pb-6 border-b border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Link to="/" className="hover:text-emerald-400 transition">Projects</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-200">{project.name}</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <span>{project.name}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {project.detectedPreset}
              </span>
            </h1>
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
              <a
                href={project.githubRepoUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-white flex items-center gap-1"
              >
                <GithubIcon className="w-3.5 h-3.5" />
                <span>{project.githubRepoFullName}</span>
              </a>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono">
                <GitBranch className="w-3.5 h-3.5" />
                {project.defaultBranch}
              </span>
            </div>
          </div>

          <button
            onClick={handleTriggerDeploy}
            disabled={triggering}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{triggering ? 'Starting Pipeline...' : 'Deploy Latest Commit'}</span>
          </button>
        </div>
      </div>

      {/* Services Configuration Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Backend Card */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">Backend Web Service</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 font-bold border border-purple-500/20">
              {backendService?.provider || 'RENDER'}
            </span>
          </div>

          <div className="text-xs space-y-1.5 font-mono text-slate-300">
            <div><span className="text-slate-500">Directory:</span> {backendService?.rootDirectory || '/server'}</div>
            <div><span className="text-slate-500">Build:</span> {backendService?.buildCommand || 'npm install'}</div>
            <div><span className="text-slate-500">Start:</span> {backendService?.startCommand || 'npm start'}</div>
            <div><span className="text-slate-500">Health Path:</span> {backendService?.healthCheckPath || '/health'}</div>
          </div>
        </div>

        {/* Frontend Card */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-400" />
              <span className="text-sm font-bold text-white">Frontend Web Service</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 font-bold border border-sky-500/20">
              {frontendService?.provider || 'VERCEL'}
            </span>
          </div>

          <div className="text-xs space-y-1.5 font-mono text-slate-300">
            <div><span className="text-slate-500">Directory:</span> {frontendService?.rootDirectory || '/client'}</div>
            <div><span className="text-slate-500">Build:</span> {frontendService?.buildCommand || 'npm run build'}</div>
            <div><span className="text-slate-500">Preview:</span> {frontendService?.startCommand || 'npm run preview'}</div>
            <div className="text-emerald-400">
              <span className="text-slate-500">Auto Env:</span> VITE_API_URL &larr; Backend Service URL
            </div>
          </div>
        </div>
      </div>

      {/* Environment Variables Manager (Phase 8) */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Environment Variables (Encrypted via AES-256)
            </h2>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            Encrypted at rest in PostgreSQL
          </span>
        </div>

        {/* Add Env Form */}
        <form onSubmit={handleAddEnv} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <input
            type="text"
            required
            placeholder="KEY (e.g. JWT_SECRET)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <input
            type="password"
            required
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <select
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="SHARED">SHARED (All Services)</option>
            <option value="BACKEND">BACKEND Only (Render)</option>
            <option value="FRONTEND">FRONTEND Only (Vercel)</option>
          </select>
          <button
            type="submit"
            disabled={savingEnv}
            className="px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 text-xs font-semibold border border-emerald-500/20 transition flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{savingEnv ? 'Encrypting...' : 'Add Variable'}</span>
          </button>
        </form>

        {/* Existing Variables Table */}
        <div className="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950/40">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-4 py-2.5">Key</th>
                <th className="px-4 py-2.5">Value</th>
                <th className="px-4 py-2.5">Target</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300 font-mono">
              {envVars.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-4 py-6 text-center text-slate-500 font-sans italic">
                    No custom environment variables configured.
                  </td>
                </tr>
              ) : (
                envVars.map((env) => (
                  <tr key={env.id} className="hover:bg-slate-900/30">
                    <td className="px-4 py-2.5 text-emerald-400 font-semibold">{env.key}</td>
                    <td className="px-4 py-2.5 text-slate-400">{env.value}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-sans">
                        {env.serviceTarget}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleDeleteEnv(env.id)}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 transition"
                        title="Delete variable"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deployment History Table */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-200">Deployment Pipeline History</h2>

        <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Commit</th>
                <th className="px-5 py-3">Triggered By</th>
                <th className="px-5 py-3">Duration</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {project.deployments.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-5 py-8 text-center text-slate-500 italic">
                    No deployments recorded yet. Click "Deploy Latest Commit" to run the pipeline.
                  </td>
                </tr>
              ) : (
                project.deployments.map((dep) => (
                  <tr key={dep.id} className="hover:bg-slate-900/50 transition">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={dep.status} />
                        {dep.attemptNumber > 1 && <span className="text-[10px] text-slate-500 font-mono">#{dep.attemptNumber}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="font-mono text-white">{dep.commitHash || 'main-head'}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-xs">{dep.commitMessage || 'Manual trigger'}</div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">{dep.triggeredBy}</td>
                    <td className="px-5 py-3.5 font-mono text-slate-400">
                      {dep.durationSeconds ? `${dep.durationSeconds}s` : 'In progress...'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">
                      {new Date(dep.startedAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-3">
                      {dep.status === 'FAILED' && (
                        <button onClick={() => handleRetryDeployment(dep.id)} className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-semibold transition">
                          <span>Retry</span>
                        </button>
                      )}
                      <Link
                        to={`/deployments/${dep.id}`}
                        className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold transition"
                      >
                        <span>View</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
