import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Loader2, CheckCircle2, AlertCircle, Rocket } from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('processing'); // 'processing' | 'success' | 'error'
  const [message, setMessage] = useState('Exchanging authorization code with GitHub...');
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (errorParam) {
      setStatus('error');
      setMessage(errorDescription || 'GitHub authorization was canceled or denied.');
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from GitHub.');
      return;
    }

    async function exchangeCode() {
      try {
        const res = await api.post('/auth/github', { code });
        const { token, user } = res.data.data;

        // Store auth token
        localStorage.setItem('deplo_token', token);
        localStorage.setItem('deplo_user', JSON.stringify(user));

        setStatus('success');
        setMessage('GitHub connected successfully! Redirecting to your dashboard...');

        await refreshProfile();

        setTimeout(() => {
          navigate('/', { replace: true });
        }, 1200);
      } catch (err) {
        setStatus('error');
        setMessage(err.response?.data?.message || 'Failed to exchange authorization code with GitHub.');
      }
    }

    exchangeCode();
  }, [searchParams, navigate, refreshProfile]);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <div className="w-full max-w-md p-8 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-2xl text-center space-y-6">
        <div className="flex items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
            <GithubIcon className="w-6 h-6 text-white" />
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold text-white">GitHub Integration</h2>
          <p className="text-xs text-slate-400 mt-1 font-mono">{message}</p>
        </div>

        {status === 'processing' && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
          </div>
        )}

        {status === 'success' && (
          <div className="flex items-center justify-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4 pt-2">
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 text-left">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{message}</span>
            </div>
            <Link
              to="/login"
              className="inline-block px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition"
            >
              Return to Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

