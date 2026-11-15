import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Rocket, PlusCircle, LayoutDashboard, LogOut, Monitor } from 'lucide-react';
import { GithubIcon } from './GithubIcon';
import { NotificationCenter } from './NotificationCenter';

export function Navbar() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:scale-105 transition">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <div className="hidden sm:block">
            <span className="text-lg font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              deplo.ai
            </span>
            <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              {isElectron ? 'desktop' : 'orchestrator'}
            </span>
          </div>
        </Link>

        {/* Navigation Links */}
        {user && (
          <nav className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
            <Link
              to="/"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                isActive('/')
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Projects</span>
            </Link>

            <Link
              to="/new"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                isActive('/new')
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800/50'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              <span className="hidden sm:inline">New Deployment</span>
            </Link>

            {isElectron && (
              <Link
                to="/desktop"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                  isActive('/desktop')
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-400 hover:text-sky-300 hover:bg-slate-800/50'
                }`}
                title="Desktop Deployment Wizard"
              >
                <Monitor className="w-4 h-4" />
                <span className="hidden sm:inline">Desktop Wizard</span>
              </Link>
            )}
          </nav>
        )}

        {/* User Profile & Actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Socket Connection Status Pill */}
          <div
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
              connected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
            title={connected ? 'Real-time WebSocket connected' : 'Connecting to Socket gateway...'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span>{connected ? 'Gateway Online' : 'Connecting'}</span>
          </div>

          {user && <NotificationCenter />}

          {user ? (
            <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-slate-800">
              <div className="flex items-center gap-2">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.fullName}
                    className="w-8 h-8 rounded-full border border-slate-700"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300">
                    {user.fullName?.charAt(0) || 'U'}
                  </div>
                )}
                <div className="hidden lg:block text-left">
                  <div className="text-xs font-semibold text-slate-200 truncate max-w-[120px]">{user.fullName}</div>
                  <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{user.email}</div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:text-white transition"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="px-3.5 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold transition shadow-md shadow-emerald-500/20"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
