/**
 * CompletionFeedbackModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Customer Feedback step shown when a Field Engineer presses "Complete" on
 * an activity or ticket. The job does not close until this step finishes —
 * the engineer hands the device to the customer (or asks them to rate the
 * service), the rating + resolution status get captured, and only then does
 * onFinalComplete() fire, which runs the EXACT SAME completion logic that
 * already existed before this feature (handleComplete in MobileTechPortal).
 *
 * 4-5 stars  → show the Google Review QR + copy-link, customer can scan or
 *              copy, then finish.
 * 1-3 stars  → no QR, a short "thank you, we'll follow up" message instead,
 *              and the backend flags this for Team Lead/Admin attention.
 *
 * If no Google Review URL has been configured in Admin Settings, this never
 * blocks completion — it shows a quiet inline note instead of a QR, and
 * completion proceeds exactly the same either way.
 */
import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Star, X, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { INPUT_STYLES } from '../constants';
import api from '../services/api';
import toast from './Toast';
import { ResolutionStatus } from '../types';

interface CompletionFeedbackModalProps {
  activityId?: string | null;
  ticketId?: string | null;
  engineerId: string;
  engineerName: string;
  customerName?: string | null;
  onCancel: () => void;
  onFinalComplete: () => void;
}

const RESOLUTION_OPTIONS: { value: ResolutionStatus; label: string }[] = [
  { value: ResolutionStatus.COMPLETED, label: 'Completed' },
  { value: ResolutionStatus.PARTIALLY_COMPLETED, label: 'Partially Completed' },
  { value: ResolutionStatus.NOT_COMPLETED, label: 'Not Completed' },
];

const CompletionFeedbackModal: React.FC<CompletionFeedbackModalProps> = ({
  activityId, ticketId, engineerId, engineerName, customerName,
  onCancel, onFinalComplete,
}) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [resolutionStatus, setResolutionStatus] = useState<ResolutionStatus | ''>('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);

  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewUrlLoading, setReviewUrlLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.settings.get('google_review_url');
        if (!cancelled) setReviewUrl(res?.value || null);
      } catch {
        if (!cancelled) setReviewUrl(null);
      } finally {
        if (!cancelled) setReviewUrlLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isPositive = rating >= 4;
  const canSubmit = rating > 0 && !!resolutionStatus;

  const handleSubmitFeedback = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.serviceFeedback.create({
        activityId: activityId || undefined,
        ticketId: ticketId || undefined,
        engineerId,
        engineerName,
        customerName: customerName || undefined,
        rating,
        resolutionStatus,
        comment: comment.trim() || undefined,
        googleReviewPromptShown: isPositive && !!reviewUrl,
      });
      setSubmitted(true);
    } catch (e: any) {
      toast.error('Could not save feedback, but you can still complete the job.');
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!reviewUrl) return;
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link — please copy it manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="font-bold text-slate-900">Customer Feedback</h2>
          {!submitted && (
            <button onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <X size={18} />
            </button>
          )}
        </div>

        {!submitted ? (
          <div className="p-5 space-y-5">
            <p className="text-sm text-slate-500">
              Please hand the device to the customer, or ask them to rate the service before we finish.
            </p>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 text-center">
                How would you rate the engineer's service? <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1"
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Star
                      size={36}
                      className={(hoverRating || rating) >= n ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}
                    />
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <p className="text-center text-xs text-slate-400 mt-1">{rating} of 5 stars</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Was the work completed? <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 gap-2">
                {RESOLUTION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setResolutionStatus(opt.value)}
                    className={`py-3 rounded-xl border text-sm font-semibold transition-all ${
                      resolutionStatus === opt.value
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Comments (optional)</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                placeholder="Anything the customer would like to add…"
                className={INPUT_STYLES}
              />
            </div>

            <button
              onClick={handleSubmitFeedback}
              disabled={!canSubmit || submitting}
              className="w-full py-4 rounded-xl bg-emerald-600 text-white font-bold shadow-lg active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Submit Feedback
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {isPositive ? (
              reviewUrlLoading ? (
                <div className="flex items-center justify-center gap-2 text-slate-400 py-10">
                  <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
              ) : reviewUrl ? (
                <div className="text-center space-y-4">
                  <p className="font-bold text-slate-900">Thank you! Would you mind leaving us a Google review?</p>
                  <div className="flex justify-center">
                    <div className="p-4 bg-white border border-slate-200 rounded-2xl inline-block">
                      <QRCodeSVG value={reviewUrl} size={200} />
                    </div>
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold flex items-center justify-center gap-2 hover:bg-slate-50"
                  >
                    {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                    {copied ? 'Link Copied' : 'Copy Review Link'}
                  </button>
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <div className="flex items-center justify-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={16} className="shrink-0" />
                    <p className="text-xs text-left">
                      Google Review link hasn't been set up yet. Ask an Admin to add it under Settings.
                    </p>
                  </div>
                  <p className="text-sm text-slate-500">Thank you for the great feedback!</p>
                </div>
              )
            ) : (
              <div className="text-center space-y-2 py-4">
                <p className="font-bold text-slate-900">Thank you for your feedback.</p>
                <p className="text-sm text-slate-500">Our team will follow up.</p>
              </div>
            )}

            <button
              onClick={onFinalComplete}
              className="w-full py-4 rounded-xl bg-slate-900 text-white font-bold shadow-lg active:scale-[0.98]"
            >
              I have completed this step
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompletionFeedbackModal;
