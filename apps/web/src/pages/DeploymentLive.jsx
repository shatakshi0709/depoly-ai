import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useSocket } from '../context/SocketContext';
import { StatusBadge } from '../components/StatusBadge';
import { LogTerminal } from '../components/LogTerminal';
import { useDesktopNotifications } from '../hooks/useDesktopNotifications';
import { SOCKET_EVENTS, DEPLOYMENT_STATUS, STEP_STATUS } from '@deplo/shared';
import { 
  Rocket, 
  ExternalLink, 
  CheckCircle2, 
  Loader2, 
  Clock, 
  ChevronRight,
  Server,
  Globe,
  ArrowRight,
  AlertCircle
} from 'lucide-react';

export function DeploymentLive() {
  const { id } = useParams();
  const { socket, joinDeployment, leaveDeployment } = useSocket();

  const [deployment, setDeployment] = useState(null);
  const [steps, setSteps] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Native desktop notification integration
  useDesktopNotifications(deployment, deployment?.project?.name);

  // 1. Initial REST fetch for deployment history and state
  useEffect(() => {
    async function fetchDeployment() {
      try {
        const res = await api.get(`/projects/deployments/${id}`);
        const dep = res.data.data;
        setDeployment(dep);
        setSteps(dep.steps || []);
        setLogs(dep.logs || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to retrieve deployment details.');
      } finally {
        setLoading(false);
      }
    }
    fetchDeployment();
  }, [id]);

  // 2. Real-time Socket.IO subscriptions
  useEffect(() => {
    if (!socket || !id) return;

    joinDeployment(id);

    // Live log chunk received
    const handleLog = (logItem) => {
      setLogs((prev) => [...prev, logItem]);
    };

    // Overall status transition
    const handleStatusChange = (data) => {
      setDeployment((prev) => ({
        ...prev,
        status: data.status,
        backendUrl: data.backendUrl || prev?.backendUrl,
        frontendUrl: data.frontendUrl || prev?.frontendUrl,
      }));
    };

    // Pipeline step update
    const handleStepUpdate = (data) => {
      setSteps((prev) =>
        prev.map((step) =>
          step.stepOrder === data.order ? { ...step, status: data.status } : step
        )
      );
    };

    socket.on(SOCKET_EVENTS.DEPLOYMENT_LOG, handleLog);
    socket.on(SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, handleStatusChange);
    socket.on(SOCKET_EVENTS.DEPLOYMENT_STEP_UPDATE, handleStepUpdate);

    return () => {
      leaveDeployment(id);
      socket.off(SOCKET_EVENTS.DEPLOYMENT_LOG, handleLog);
      socket.off(SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, handleStatusChange);
      socket.off(SOCKET_EVENTS.DEPLOYMENT_STEP_UPDATE, handleStepUpdate);
    };
  }, [socket, id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Connecting to orchestration stream...</p>
      </div>
    );
  }

  if (error || !deployment) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-400 mx-auto" />
        <h2 className="text-lg font-bold text-white">Deployment Not Found</h2>
        <p className="text-sm text-slate-400">{error || 'Unable to retrieve deployment execution.'}</p>
        <Link to="/" className="inline-block px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const isLive = deployment.status !== DEPLOYMENT_STATUS.SUCCESS && deployment.status !== DEPLOYMENT_STATUS.FAILED;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header & Breadcrumb */}
      <div className="space-y-4 pb-6 border-b border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Link to="/" className="hover:text-emerald-400 transition">Projects</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link to={`/projects/${deployment.project?.id}`} className="hover:text-emerald-400 transition">
            {deployment.project?.name}
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-200 font-mono">Deployment #{id.slice(0, 8)}</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
              <span>Deployment Pipeline</span>
              <StatusBadge status={deployment.status} />
            </h1>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Commit {deployment.commitHash || 'main-head'} — {deployment.commitMessage}
            </p>
          </div>

          {deployment.durationSeconds && (
            <div className="px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Duration: {deployment.durationSeconds}s</span>
            </div>
          )}
        </div>
      </div>

      {/* Live URLs Banner (Appears as soon as URLs are available) */}
      {(deployment.backendUrl || deployment.frontendUrl) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deployment.backendUrl && (
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-purple-300 uppercase tracking-wider">
                    Render Backend (Live)
                  </div>
                  <div className="text-xs text-slate-300 font-mono mt-0.5">{deployment.backendUrl}</div>
                </div>
              </div>
              <a
                href={deployment.backendUrl}
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 transition"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}

          {deployment.frontendUrl && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                    Vercel Frontend (Production)
                  </div>
                  <div className="text-xs text-slate-300 font-mono mt-0.5">{deployment.frontendUrl}</div>
                </div>
              </div>
              <a
                href={deployment.frontendUrl}
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Execution Pipeline Steps Tracker */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Orchestration Stages (Render Backend First &rarr; Vercel Frontend Chained)
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {steps.map((step) => {
            const isSuccess = step.status === STEP_STATUS.SUCCESS;
            const isRunning = step.status === STEP_STATUS.RUNNING;
            const isPending = step.status === STEP_STATUS.PENDING;

            return (
              <div
                key={step.id}
                className={`p-3.5 rounded-xl border flex flex-col justify-between transition ${
                  isSuccess
                    ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-300'
                    : isRunning
                    ? 'bg-sky-500/10 border-sky-500/40 text-sky-200 animate-pulse'
                    : 'bg-slate-950/60 border-slate-800 text-slate-500'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-bold uppercase">
                    Step {step.stepOrder} • {step.provider}
                  </span>
                  {isSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : isRunning ? (
                    <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                  ) : (
                    <Clock className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                <div className="text-xs font-semibold leading-snug">{step.stepName}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Terminal */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-300">Live Orchestration & Build Logs</h2>
          <span className="text-xs text-slate-500 font-mono">{logs.length} Log entries</span>
        </div>
        <LogTerminal logs={logs} isLive={isLive} />
      </div>
    </div>
  );
}
