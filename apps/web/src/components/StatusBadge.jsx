import React from 'react';
import { DEPLOYMENT_STATUS } from '@deplo/shared';
import { CheckCircle2, XCircle, Clock, Loader2, Play } from 'lucide-react';

export function StatusBadge({ status }) {
  switch (status) {
    case DEPLOYMENT_STATUS.SUCCESS:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Success
        </span>
      );
    case DEPLOYMENT_STATUS.FAILED:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <XCircle className="w-3.5 h-3.5" />
          Failed
        </span>
      );
    case DEPLOYMENT_STATUS.QUEUED:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
          <Clock className="w-3.5 h-3.5" />
          Queued
        </span>
      );
    case DEPLOYMENT_STATUS.DEPLOYING_BACKEND:
    case DEPLOYMENT_STATUS.HEALTH_CHECKING:
    case DEPLOYMENT_STATUS.DEPLOYING_FRONTEND:
    case DEPLOYMENT_STATUS.ANALYZING:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {status.replace('_', ' ')}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
          <Play className="w-3 h-3" />
          {status || 'Unknown'}
        </span>
      );
  }
}

