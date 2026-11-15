import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { 
  Rocket, 
  GitBranch, 
  ExternalLink, 
  PlusCircle, 
  TrendingUp, 
  Clock, 
  Layers, 
  Play, 
  AlertCircle
} from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';

export function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deployingId, setDeployingId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchData() {
      try {
        const [projRes, analyticsRes] = await Promise.all([
          api.get('/projects'),
          api.get('/projects/analytics'),
        ]);
        setProjects(projRes.data.data || []);
        setAnalytics(analyticsRes.data.data || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to fetch dashboard data.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleQuickDeploy = async (projectId) => {
    try {
      setDeployingId(projectId);
      const res = await api.post('/projects/deployments/trigger', { projectId });
      const deploymentId = res.data.data.id;
      navigate(`/deployments/${deploymentId}`);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to trigger deployment.');
      setDeployingId(null);
    }
  };

  // Compute aggregate totals for the metrics cards
  const totalDeployments = analytics.reduce((acc, curr) => acc + Number(curr.total_deployments || 0), 0);
  const avgSuccessRate = analytics.length > 0 
    ? (analytics.reduce((acc, curr) => acc + Number(curr.success_rate_percentage || 0), 0) / analytics.length).toFixed(1)
    : '100.0';
  const avgDuration = analytics.length > 0
    ? (analytics.reduce((acc, curr) => acc + Number(curr.avg_duration_seconds || 0), 0) / analytics.length).toFixed(1)
    : '0';

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Loading your cloud deployments...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Orchestration Dashboard</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Monitor full-stack multi-cloud pipelines across Render and Vercel.
          </p>
        </div>

        <Link
          to="/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-500/20"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Project</span>
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Analytics KPI Row (SQL View Data) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Deployments</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{totalDeployments}</div>
          <p className="text-[11px] text-slate-500 mt-1">Multi-cloud executions triggered</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Success Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-400">{avgSuccessRate}%</div>
          <p className="text-[11px] text-slate-500 mt-1">PostgreSQL computed aggregate</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Avg Build Duration</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{avgDuration}s</div>
          <p className="text-[11px] text-slate-500 mt-1">Moving average window function</p>
        </div>
      </div>

      {/* Projects List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-200">Connected Repositories</h2>
          <span className="text-xs text-slate-500">{projects.length} Active</span>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <GithubIcon className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-200">No repositories connected yet</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Connect a GitHub repository to let deplo.ai inspect its architecture and orchestrate deployments.
            </p>
            <Link
              to="/new"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-sm hover:bg-emerald-400 transition"
            >
              <PlusCircle className="w-4 h-4" />
              Connect Repository
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((proj) => {
              const latestDep = proj.deployments?.[0];
              return (
                <div
                  key={proj.id}
                  className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between group"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          to={`/projects/${proj.id}`}
                          className="text-base font-bold text-white hover:text-emerald-400 transition flex items-center gap-1.5"
                        >
                          <span>{proj.name}</span>
                          <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition text-slate-400" />
                        </Link>
                        <a
                          href={proj.githubRepoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-slate-400 hover:text-slate-300 flex items-center gap-1 mt-0.5"
                        >
                          <GithubIcon className="w-3 h-3" />
                          <span>{proj.githubRepoFullName}</span>
                        </a>
                      </div>

                      <StatusBadge status={latestDep?.status || 'QUEUED'} />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                        {proj.defaultBranch}
                      </span>
                      <span>•</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
                        {proj.detectedPreset}
                      </span>
                      <span>•</span>
                      <span>{proj._count?.deployments || 0} deploys</span>
                    </div>

                    {/* Live URLs if available */}
                    {latestDep?.frontendUrl && (
                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                        <span className="text-slate-500">Live Production:</span>
                        <a
                          href={latestDep.frontendUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
                        >
                          {latestDep.frontendUrl.replace('https://', '')}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
                    <Link
                      to={`/projects/${proj.id}`}
                      className="text-xs font-semibold text-slate-400 hover:text-white transition"
                    >
                      View Details & History →
                    </Link>

                    <button
                      onClick={() => handleQuickDeploy(proj.id)}
                      disabled={deployingId === proj.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 font-semibold text-xs border border-emerald-500/20 transition disabled:opacity-50"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>{deployingId === proj.id ? 'Starting...' : 'Deploy Now'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
