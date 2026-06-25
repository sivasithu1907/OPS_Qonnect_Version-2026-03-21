/**
 * SettingsPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only settings page, restructured into categorized tabs so future
 * settings have an obvious home without needing another redesign:
 *
 *   Company             — Company Info, Logo, Google Maps URL,
 *                          Google Review URL + QR preview (implemented)
 *   Users & Permissions  — Roles, Access, Security (placeholder)
 *   Notifications        — Email, WhatsApp, future SMS (placeholder)
 *   Integrations          — Google, WhatsApp, APIs (placeholder)
 *   System               — Branding, Backup, Restore, Preferences (placeholder)
 *
 * Only the Google Review URL is wired to anything real today — everything
 * else is a clearly-labeled "coming soon" placeholder. Adding a new setting
 * later means adding a row inside the relevant tab, not restructuring this
 * page or adding a new route.
 */
import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Settings, Star, Save, Copy, Check, AlertTriangle, Loader2, ExternalLink,
  Building2, Shield, Bell, Plug, Cog, MapPin, Image as ImageIcon,
} from 'lucide-react';
import api from '../services/api';
import toast from './Toast';
import { INPUT_STYLES } from '../constants';

type SettingsTab = 'company' | 'users_permissions' | 'notifications' | 'integrations' | 'system';

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'company', label: 'Company', icon: <Building2 size={16} /> },
  { id: 'users_permissions', label: 'Users & Permissions', icon: <Shield size={16} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug size={16} /> },
  { id: 'system', label: 'System', icon: <Cog size={16} /> },
];

const ComingSoonRow: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 border border-slate-100">
    <span className="text-slate-400">{icon}</span>
    <span className="text-sm text-slate-500">{label}</span>
    <span className="ml-auto text-[10px] font-bold text-slate-400 uppercase tracking-wide">Coming soon</span>
  </div>
);

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('company');

  const [reviewUrl, setReviewUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.settings.get('google_review_url');
        setReviewUrl(res?.value || '');
        setSavedUrl(res?.value || null);
      } catch {
        toast.error('Failed to load settings.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const validate = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (!/^https:\/\//i.test(trimmed)) return 'The link must start with https://';
    return '';
  };

  const handleSave = async () => {
    const validationError = validate(reviewUrl);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await api.settings.set('google_review_url', reviewUrl.trim());
      setSavedUrl(res?.value || null);
      toast.success('Google Review URL saved.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save — please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!savedUrl) return;
    try {
      await navigator.clipboard.writeText(savedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — please copy it manually.');
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 rounded-xl">
            <Settings size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Settings</h1>
            <p className="text-slate-500 text-sm">App-wide configuration</p>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-5 -mb-4 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#FFCC00] text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-4">

          {activeTab === 'company' && (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 size={18} className="text-slate-400" />
                  <h2 className="font-bold text-slate-900">Company Information</h2>
                </div>
                <div className="space-y-2">
                  <ComingSoonRow icon={<Building2 size={16} />} label="Company name, address, contact details" />
                  <ComingSoonRow icon={<ImageIcon size={16} />} label="Company logo" />
                  <ComingSoonRow icon={<MapPin size={16} />} label="Google Maps URL" />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Star size={18} className="text-amber-500" />
                  <h2 className="font-bold text-slate-900">Google Review Link</h2>
                </div>
                <p className="text-sm text-slate-500 mb-4">
                  Shown to customers as a QR code after they leave a 4 or 5-star rating at job completion.
                  Updating this takes effect everywhere immediately — there's nothing else to upload or regenerate.
                </p>

                {loading ? (
                  <div className="flex items-center gap-2 text-slate-400 py-6">
                    <Loader2 size={16} className="animate-spin" /> Loading…
                  </div>
                ) : (
                  <>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Review URL</label>
                    <input
                      value={reviewUrl}
                      onChange={e => { setReviewUrl(e.target.value); if (error) setError(''); }}
                      placeholder="https://g.page/r/your-business/review"
                      className={`${INPUT_STYLES} ${error ? 'border-red-400 focus:border-red-400' : ''}`}
                    />
                    {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}

                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Save
                    </button>

                    <div className="mt-6 pt-6 border-t border-slate-100">
                      {!savedUrl ? (
                        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
                          <AlertTriangle size={16} className="shrink-0" />
                          No Google Review URL is set — the QR step will be skipped for everyone until one is saved here.
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase mb-3">QR Code Preview</p>
                          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                            <div className="p-4 bg-white border border-slate-200 rounded-2xl shrink-0">
                              <QRCodeSVG value={savedUrl} size={160} />
                            </div>
                            <div className="flex-1 w-full space-y-2">
                              <p className="text-sm text-slate-600 break-all">{savedUrl}</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleCopy}
                                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold border border-slate-200 rounded-lg hover:bg-slate-50"
                                >
                                  {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                                  {copied ? 'Copied' : 'Copy Link'}
                                </button>
                                <a
                                  href={savedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                                >
                                  <ExternalLink size={13} /> Open
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {activeTab === 'users_permissions' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={18} className="text-slate-400" />
                <h2 className="font-bold text-slate-900">Users & Permissions</h2>
              </div>
              <p className="text-sm text-slate-500 mb-4">
                Role and access management already lives under Administration → User Management.
                This tab will hold finer-grained controls as they're built.
              </p>
              <div className="space-y-2">
                <ComingSoonRow icon={<Shield size={16} />} label="Roles" />
                <ComingSoonRow icon={<Shield size={16} />} label="Access" />
                <ComingSoonRow icon={<Shield size={16} />} label="Security" />
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Bell size={18} className="text-slate-400" />
                <h2 className="font-bold text-slate-900">Notifications</h2>
              </div>
              <div className="space-y-2">
                <ComingSoonRow icon={<Bell size={16} />} label="Email" />
                <ComingSoonRow icon={<Bell size={16} />} label="WhatsApp" />
                <ComingSoonRow icon={<Bell size={16} />} label="SMS (future)" />
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Plug size={18} className="text-slate-400" />
                <h2 className="font-bold text-slate-900">Integrations</h2>
              </div>
              <div className="space-y-2">
                <ComingSoonRow icon={<Plug size={16} />} label="Google" />
                <ComingSoonRow icon={<Plug size={16} />} label="WhatsApp" />
                <ComingSoonRow icon={<Plug size={16} />} label="APIs" />
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Cog size={18} className="text-slate-400" />
                <h2 className="font-bold text-slate-900">System</h2>
              </div>
              <div className="space-y-2">
                <ComingSoonRow icon={<Cog size={16} />} label="Branding" />
                <ComingSoonRow icon={<Cog size={16} />} label="Backup" />
                <ComingSoonRow icon={<Cog size={16} />} label="Restore" />
                <ComingSoonRow icon={<Cog size={16} />} label="Preferences" />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
