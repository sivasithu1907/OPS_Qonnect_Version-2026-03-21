import React, { useState } from 'react';
import { Lock, Mail, ArrowRight, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { APP_NAME } from '../constants';

interface LoginProps {
  onLogin: (email: string, password: string) => void;
  error?: string;
}

const Login: React.FC<LoginProps> = ({ onLogin, error }) => {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [isLoading, setIsLoading]   = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!email.trim() || !password) {
      setLocalError('Please enter your email and password.');
      return;
    }
    setIsLoading(true);
    try {
      await onLogin(email.trim(), password);
    } catch {
      // error surfaced via `error` prop from parent
    } finally {
      setIsLoading(false);
    }
  };

  const displayError = error || localError;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-500">

        {/* Header */}
        <div className="bg-slate-50 p-8 text-center border-b border-slate-100">
          <div className="w-20 h-20 mx-auto mb-4">
            <svg viewBox="0 0 578 578" xmlns="http://www.w3.org/2000/svg" width="80" height="80">
              <path d="M409.18,407.51a113.86,113.86,0,1,0-225.35,32.32l45-36.75a69.77,69.77,0,0,1,135.75,4.43Z" transform="translate(-8.5 -132)" fill="#fdbb40"/>
              <rect x="251.37" y="404.96" width="30.72" height="30.72"/><rect x="293.23" y="404.96" width="30.72" height="30.72"/>
              <rect x="251.37" y="447.04" width="30.72" height="30.72"/><rect x="293.23" y="447.04" width="30.72" height="30.72"/>
              <path d="M297.5,220.76C186.94,220.76,97,310.71,97,421.27A200.3,200.3,0,0,0,112.27,498l36.14-29.53a156.51,156.51,0,0,1-7.3-47.21c0-86.24,70.15-156.4,156.39-156.4S453.89,335,453.89,421.27a156.33,156.33,0,0,1-7.42,47.57l36.11,29.49A200.38,200.38,0,0,0,498,421.27C498,310.71,408.06,220.76,297.5,220.76Z" transform="translate(-8.5 -132)" fill="#fdbb40"/>
              <path d="M297.5,132c-159.35,0-289,129.64-289,289A287.17,287.17,0,0,0,41.63,555.23l35-28.57A243.44,243.44,0,0,1,52.61,421c0-135,109.86-244.89,244.89-244.89S542.39,286,542.39,421A243.47,243.47,0,0,1,518,527.49l35,28.55A287.17,287.17,0,0,0,586.5,421C586.5,261.64,456.85,132,297.5,132Z" transform="translate(-8.5 -132)" fill="#fdbb40"/>
              <path d="M247.31,506.42l49.61-43.28,43.65,33.92,37-.7-.13,30.39,56,45.68a.78.78,0,0,0,.05-.14l66.75,54.48A289.41,289.41,0,0,0,529,593.6l-34.38-28h0l-73.11-60,.3-54.08-65.73.08-59.39-48L106.09,559.8,65.5,593.13c8.73,11.73,18.34,25.41,28.71,35.68L247.3,506.42Z" transform="translate(-8.5 -132)"/>
              <path d="M430.33,626.59A244.06,244.06,0,0,1,164,626.13L128.4,655.2a288.32,288.32,0,0,0,337.55.48Z" transform="translate(-8.5 -132)"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{APP_NAME} Portal</h1>
          <p className="text-slate-500 text-sm mt-2">Sign in to access your dashboard</p>
        </div>

        {/* Form */}
        <div className="p-8">
          {/* Error banner */}
          {displayError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium flex items-center gap-2">
              <span className="text-red-500">⚠</span> {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 text-slate-400" size={18} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all text-slate-800 placeholder:text-slate-400"
                  placeholder="user@qonnect.qa"
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 text-slate-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all text-slate-800 placeholder:text-slate-400"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                {/* Eye toggle */}
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-3 p-0.5 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="animate-pulse">Authenticating...</span>
              ) : (
                <>Sign In <ArrowRight size={20} /></>
              )}
            </button>
          </form>
        </div>
      </div>
      <p className="mt-8 text-slate-600 text-sm">
        © {new Date().getFullYear()} {APP_NAME} Enterprise Solutions
      </p>
    </div>
  );
};

export default Login;
