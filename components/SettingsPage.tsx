/**
 * SettingsPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only settings page. Currently just the Google Review URL, used by
 * the Completion Feedback flow (CompletionFeedbackModal.tsx) to generate a
 * QR code at job completion when a customer rates 4-5 stars. Whatever is
 * saved here takes effect everywhere immediately — the QR is always
 * generated live from this value, never a static uploaded image.
 */
import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Settings, Star, Save, Copy, Check, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import api from '../services/api';
import toast from './Toast';
import { INPUT_STYLES } from '../constants';

const SettingsPage: React.FC = () => {
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
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
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
                      <p className="text-xs font-bold text-slate-500 uppercase mb-3">Preview</p>
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
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
