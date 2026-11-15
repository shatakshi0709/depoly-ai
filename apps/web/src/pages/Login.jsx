import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Rocket, AlertCircle, ArrowRight } from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubOAuth = async () => {
    setError('');
    setOauthLoading(true);
    try {
      // Request server-generated signed, expiring OAuth state and canonical authorize URL.
      const res = await api.get('/auth/github/start');
      const { state, authorizeUrl } = res.data?.data || {};
      if (!state || !authorizeUrl) {
        throw new Error('OAuth start failed');
      }
      // Store state for same-context validation hint (web/Electron when callback returns in-app).
      try {
        sessionStorage.setItem('deplo_oauth_state', state);
      } catch {
        // Storage may be unavailable; server-side signed-state verification remains authoritative.
      }
      window.location.href = authorizeUrl;
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to start GitHub sign-in. Please try again.');
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 bg-slate-900/60 p-8 rounded-2xl border border-slate-800 backdrop-blur-xl shadow-2xl">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 items-center justify-center shadow-lg shadow-emerald-500/20 mb-2">
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Welcome back to deplo.ai</h2>
          <p className="text-sm text-slate-400">
            Automated multi-cloud deployment orchestrator
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* GitHub OAuth Button */}
        <button
          onClick={handleGitHubOAuth}
          type="button"
          disabled={oauthLoading}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-white font-medium text-sm transition shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <GithubIcon className="w-4 h-4" />
          <span>{oauthLoading ? 'Redirecting to GitHub...' : 'Continue with GitHub'}</span>
        </button>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-slate-800 w-full" />
          <span className="bg-slate-900 px-3 text-xs text-slate-500 uppercase tracking-wider select-none">
            Or with email
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="developer@deplo.ai"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm transition"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Password
              </label>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400">
          Don't have an account yet?{' '}
          <Link to="/register" className="text-emerald-400 hover:text-emerald-300 font-semibold underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
