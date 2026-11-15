import React, { useEffect, useRef, useState } from 'react';
import { Terminal, Copy, Check, ArrowDown } from 'lucide-react';

export function LogTerminal({ logs = [], isLive = false }) {
  const terminalEndRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const copyAllLogs = () => {
    const text = logs
      .map((l) => `[${l.createdAt || l.timestamp || ''}] [${l.source || 'ORCHESTRATOR'}] [${l.stage || 'BUILD'}] [${l.logLevel || 'INFO'}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLogLevelClass = (level) => {
    switch (level) {
      case 'ERROR':
        return 'text-rose-400 font-semibold';
      case 'WARN':
        return 'text-amber-400';
      case 'DEBUG':
        return 'text-slate-500';
      default:
        return 'text-emerald-400';
    }
  };

  const getSourceClass = (source) => {
    return source === 'PROVIDER'
      ? 'text-sky-400 bg-sky-500/10 border-sky-500/20'
      : 'text-violet-300 bg-violet-500/10 border-violet-500/20';
  };

  return (
    <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl font-mono text-xs">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-rose-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="flex items-center gap-1.5 ml-2 text-slate-400 font-sans text-xs">
            <Terminal className="w-3.5 h-3.5" />
            <span>deployment.log</span>
            {isLive && (
              <span className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                LIVE STREAM
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded text-[11px] font-sans flex items-center gap-1 transition ${
              autoScroll ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
            }`}
            title="Toggle Auto-Scroll"
          >
            <ArrowDown className="w-3 h-3" />
            Auto-scroll
          </button>
          <button
            onClick={copyAllLogs}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
            title="Copy Logs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div className="p-4 h-96 overflow-y-auto space-y-1.5 leading-relaxed selection:bg-emerald-500/30 selection:text-white">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic py-12 text-center font-sans">
            Awaiting orchestration pipeline initialization...
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={log.id || index} className="flex items-start gap-2 group hover:bg-slate-900/60 px-1 py-0.5 rounded">
              <span className="text-slate-600 select-none shrink-0">
                {log.createdAt || log.timestamp ? new Date(log.createdAt || log.timestamp).toLocaleTimeString() : '00:00:00'}
              </span>
              <span className={`select-none shrink-0 px-1.5 py-0 rounded border text-[10px] ${getSourceClass(log.source || 'ORCHESTRATOR')}`}>
                {log.source || 'ORCHESTRATOR'}
              </span>
              <span className="text-slate-500 select-none shrink-0">[{log.stage || 'STAGE'}]</span>
              <span className={`select-none shrink-0 ${getLogLevelClass(log.logLevel)}`}>
                [{log.logLevel || 'INFO'}]
              </span>
              <span className="text-slate-200 break-all whitespace-pre-wrap">{log.message}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}


