import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { LogTerminal } from '../components/LogTerminal';
import { useSocket } from '../context/SocketContext';
import { SOCKET_EVENTS, DEPLOYMENT_STATUS } from '@deplo/shared';
import { Monitor, Cpu, HardDrive, Shield, Rocket, RefreshCw, Bell, ExternalLink, TerminalSquare } from 'lucide-react';

function isElectron() {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
}

export function DesktopConsole() {
  const [projects, setProjects] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('');
  const [selectedDeployment, setSelectedDeployment] = useState(null);
  const [logs, setLogs] = useState([]);
  const [sysInfo, setSysInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wizardProjectId, setWizardProjectId] = useState('');
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardMsg, setWizardMsg] = useState('');
  const [error, setError] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiUrlInput, setApiUrlInput] = useState('');
  const [apiUrlMsg, setApiUrlMsg] = useState('');
  const navigate = useNavigate();
  const { socket, joinDeployment, leaveDeployment, connected } = useSocket();

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        setError('');
        const pRes = await api.get('/projects');
        const ps = pRes.data?.data || [];
        setProjects(ps);
        const deps = ps.flatMap((p) => (p.deployments || []).map((d) => ({ ...d, projectName: p.name, projectId: p.id })))
          .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
        setDeployments(deps);
        if (deps[0]) setSelectedDeploymentId(deps[0].id);
        if (ps[0]) setWizardProjectId(ps[0].id);
      } catch (e) {
        setError(e.response?.data?.message || 'Failed to load desktop console data.');
      } finally {
        setLoading(false);
      }
    }
    init();
    if (isElectron() && window.electronAPI.getSystemInfo) {
      window.electronAPI.getSystemInfo().then(setSysInfo).catch(() => {});
    }
    if (isElectron() && window.electronAPI.getApiBaseUrl) {
      window.electronAPI.getApiBaseUrl().then((u) => {
        setApiUrl(u || '');
        setApiUrlInput(u || '');
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!selectedDeploymentId) return;
    let cancelled = false;
    async function loadDep() {
      try {
        const res = await api.get(`/projects/deployments/${selectedDeploymentId}`);
        if (cancelled) return;
        const dep = res.data?.data;
        setSelectedDeployment(dep);
        setLogs(dep?.logs || []);
      } catch {
        if (!cancelled) setSelectedDeployment(null);
      }
    }
    loadDep();
    return () => { cancelled = true; };
  }, [selectedDeploymentId]);

  useEffect(() => {
    if (!socket || !selectedDeploymentId) return;
    joinDeployment(selectedDeploymentId);
    const onLog = (l) => setLogs((prev) => [...prev, l]);
    const onStatus = (d) => setSelectedDeployment((prev) => prev ? { ...prev, ...d, status: d.status || prev.status } : prev);
    socket.on(SOCKET_EVENTS.DEPLOYMENT_LOG, onLog);
    socket.on(SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, onStatus);
    return () => {
      leaveDeployment(selectedDeploymentId);
      socket.off(SOCKET_EVENTS.DEPLOYMENT_LOG, onLog);
      socket.off(SOCKET_EVENTS.DEPLOYMENT_STATUS_CHANGED, onStatus);
    };
  }, [socket, selectedDeploymentId]);

  const runWizardDeploy = async () => {
    if (!wizardProjectId) return;
    try {
      setWizardBusy(true);
      setWizardMsg('');
      const res = await api.post('/projects/deployments/trigger', {
        projectId: wizardProjectId,
        commitMessage: 'Desktop wizard deployment trigger',
      });
      const dep = res.data?.data;
      setWizardMsg(`Deployment started (ID ${String(dep.id).slice(0, 8)}). Streaming logs below.`);
      setDeployments((prev) => [{ ...dep, projectName: projects.find(p=>p.id===wizardProjectId)?.name }, ...prev]);
      setSelectedDeploymentId(dep.id);
      if (isElectron() && window.electronAPI.showNotification) {
        window.electronAPI.showNotification({ title: 'Deployment Started', body: 'Desktop wizard triggered a new deployment pipeline.', status: 'INFO' });
      }
    } catch (e) {
      setWizardMsg(e.response?.data?.message || 'Failed to start deployment from desktop wizard.');
    } finally {
      setWizardBusy(false);
    }
  };

  const testNativeNotification = () => {
    if (isElectron() && window.electronAPI.showNotification) {
      window.electronAPI.showNotification({ title: 'deplo.ai Desktop', body: 'Native desktop notification channel is working.', status: 'INFO' });
      setWizardMsg('Native notification sent via Electron IPC.');
    } else {
      setWizardMsg('Native Electron notifications are available only in the desktop app.');
    }
  };

  const saveApiUrl = async () => {
    if (!isElectron() || !window.electronAPI.setApiBaseUrl) {
      setApiUrlMsg('Backend URL is configurable only in the desktop app.');
      return;
    }
    const value = apiUrlInput.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(value)) {
      setApiUrlMsg('Enter a full URL starting with http:// or https://');
      return;
    }
    const res = await window.electronAPI.setApiBaseUrl(value).catch(() => ({ ok: false }));
    if (res && res.ok) {
      setApiUrl(res.apiUrl);
      setApiUrlMsg('Saved. Restart the app to apply the new backend URL.');
    } else {
      setApiUrlMsg('Could not save the backend URL.');
    }
  };

  const isLive = selectedDeployment && selectedDeployment.status !== DEPLOYMENT_STATUS.SUCCESS && selectedDeployment.status !== DEPLOYMENT_STATUS.FAILED;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Monitor className="w-6 h-6 text-sky-400" />Desktop Deployment Console</h1>
          <p className="text-sm text-slate-400 mt-1">Desktop-specific wizard, native notifications, and live log viewer (secured IPC, shared backend).</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2.5 py-1 rounded-full border ${isElectron() ? 'bg-sky-500/10 text-sky-300 border-sky-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{isElectron() ? 'Electron Runtime' : 'Browser Preview'}</span>
          <span className={`px-2.5 py-1 rounded-full border ${connected ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>Socket {connected ? 'Connected' : 'Connecting'}</span>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Desktop Wizard */}
        <div className="lg:col-span-1 p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Rocket className="w-4 h-4 text-emerald-400" />Desktop Deployment Wizard</h2>
          <p className="text-xs text-slate-400">Select a project and trigger the real orchestration pipeline from the desktop client.</p>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1.5">Project</label>
            <select value={wizardProjectId} onChange={(e) => setWizardProjectId(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 focus:outline-none focus:border-emerald-500">
              <option value="">Select project...</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={runWizardDeploy} disabled={wizardBusy || !wizardProjectId} className="w-full px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              <Rocket className="w-4 h-4" />{wizardBusy ? 'Starting...' : 'Run Deployment Wizard'}
            </button>
            <button onClick={testNativeNotification} className="w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 border border-slate-700">
              <Bell className="w-4 h-4" />Test Native Notification
            </button>
          </div>
          {wizardMsg && <div className="text-xs text-slate-300 p-2.5 rounded-lg bg-slate-950 border border-slate-800">{wizardMsg}</div>}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-emerald-400" />Security Posture</h3>
            <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
              <li>contextIsolation + sandbox enabled</li>
              <li>nodeIntegration disabled</li>
              <li>Minimal preload IPC API (validated)</li>
              <li>No DB/provider secrets in renderer</li>
            </ul>
          </div>
          {isElectron() && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5"><TerminalSquare className="w-3.5 h-3.5 text-sky-400" />Backend API URL</h3>
              <p className="text-[11px] text-slate-400">
                The deployed backend this desktop app connects to. Leave empty to use the built-in local default
                (<span className="font-mono">http://localhost:5001</span>). For other computers, set your publicly
                reachable backend URL here.
              </p>
              <div className="flex gap-2">
                <input
                  value={apiUrlInput}
                  onChange={(e) => setApiUrlInput(e.target.value)}
                  placeholder="https://your-backend.onrender.com"
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                />
                <button onClick={saveApiUrl} className="px-3 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs">Save</button>
              </div>
              <div className="text-[11px] text-slate-500 font-mono break-all">Current: {apiUrl || 'not set'}</div>
              {apiUrlMsg && <div className="text-[11px] text-slate-300">{apiUrlMsg}</div>}
            </div>
          )}
        </div>

        {/* System info & deployment picker */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[11px] text-slate-500 uppercase font-semibold flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" />Platform</div>
              <div className="text-sm text-white mt-1 font-mono">{sysInfo?.platform || (isElectron() ? 'detecting...' : 'browser')}</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[11px] text-slate-500 uppercase font-semibold flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5" />Electron</div>
              <div className="text-sm text-white mt-1 font-mono">{sysInfo?.electronVersion || (isElectron() ? 'n/a' : 'n/a')}</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[11px] text-slate-500 uppercase font-semibold flex items-center gap-1.5"><TerminalSquare className="w-3.5 h-3.5" />Projects</div>
              <div className="text-sm text-white mt-1 font-mono">{projects.length}</div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-white">Desktop Log Viewer (Live Socket.IO)</h2>
              {selectedDeployment && (
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedDeployment.status} />
                  <Link to={`/deployments/${selectedDeployment.id}`} className="text-xs text-emerald-400 hover:underline inline-flex items-center gap-1">Open <ExternalLink className="w-3 h-3" /></Link>
                </div>
              )}
            </div>
            <select value={selectedDeploymentId} onChange={(e) => setSelectedDeploymentId(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 focus:outline-none focus:border-sky-500">
              <option value="">Select deployment to stream...</option>
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.projectName || 'Project'} — {String(d.id).slice(0,8)} — {d.status} — {d.startedAt ? new Date(d.startedAt).toLocaleString() : ''}
                </option>
              ))}
            </select>
            {loading ? (
              <div className="text-sm text-slate-400 py-8 text-center">Loading console data...</div>
            ) : (
              <LogTerminal logs={logs} isLive={!!isLive} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
