import React, { useEffect, useState, useRef } from 'react';
import { Bell, Check, CheckCheck, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useSocket } from '../context/SocketContext';
import { SOCKET_EVENTS } from '@deplo/shared';

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { socket } = useSocket();
  const ref = useRef(null);

  const unreadCount = items.filter((n) => !n.isRead).length;

  async function load() {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/notifications');
      setItems(res.data?.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = (n) => setItems((prev) => [n, ...prev].slice(0, 50));
    socket.on(SOCKET_EVENTS.NOTIFICATION_CREATED, onNew);
    return () => socket.off(SOCKET_EVENTS.NOTIFICATION_CREATED, onNew);
  }, [socket]);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const markOne = async (id) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch {
      // ignore
    }
  };

  const markAll = async () => {
    try {
      await api.post('/notifications/read-all');
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[90vw] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div>
              <div className="text-sm font-bold text-white">Notifications</div>
              <div className="text-[11px] text-slate-500">{unreadCount} unread</div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={markAll} className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400" title="Mark all read">
                <CheckCheck className="w-4 h-4" />
              </button>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-slate-800 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && <div className="p-4 text-xs text-slate-400 text-center">Loading notifications...</div>}
            {!loading && error && <div className="p-4 text-xs text-rose-400">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="p-6 text-xs text-slate-500 text-center">No notifications yet.</div>
            )}
            {!loading && !error && items.map((n) => (
              <div key={n.id} className={`px-4 py-3 border-b border-slate-800/80 ${n.isRead ? 'bg-transparent' : 'bg-emerald-500/5'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${n.type === 'DEPLOYMENT_SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : n.type === 'DEPLOYMENT_FAILED' ? 'bg-rose-500/10 text-rose-400' : 'bg-sky-500/10 text-sky-400'}`}>
                        {n.type?.replace(/_/g, ' ') || 'INFO'}
                      </span>
                      {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </div>
                    <div className="text-xs font-semibold text-slate-200 mt-1">{n.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 break-words">{n.message}</div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                      <span>{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</span>
                      {n.deploymentId && (
                        <Link to={`/deployments/${n.deploymentId}`} onClick={() => setOpen(false)} className="text-emerald-400 hover:underline inline-flex items-center gap-0.5">
                          View <ExternalLink className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                  {!n.isRead && (
                    <button onClick={() => markOne(n.id)} className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-emerald-400 shrink-0" title="Mark read">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
