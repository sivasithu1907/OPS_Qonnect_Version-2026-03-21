/**
 * CompletionFeedbackModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Customer Feedback step shown when a Field Engineer presses "Complete" on
 * an activity or ticket. The job does not close until this step finishes —
 * the engineer hands the device to the customer (or asks them to rate the
 * service), the rating gets captured, and only then does onFinalComplete()
 * fire, which runs the EXACT SAME completion logic that already existed
 * before this feature (handleComplete in MobileTechPortal).
 *
 * Single screen, no second step: the moment a 4-5 star rating is tapped,
 * the Google Review QR appears immediately, right under the stars — not
 * after a separate "submit" screen. Customers were treating the star
 * rating as the entire review and stopping there, never reaching a second
 * screen that came after; collapsing it into one continuous moment is the
 * fix. Google provides no way for a third-party app to post a review on a
 * customer's behalf (and explicitly disallows automating this), so the
 * actual goal here is getting the customer to scan the code themselves
 * while they're still holding the phone with their rating on it, not
 * literally combining two API calls into one.
 *
 * 1-3 stars  → no QR, a short "thank you, we'll follow up" message instead,
 *              and the backend flags this for Team Lead/Admin attention.
 *
 * If no Google Review URL has been configured in Admin Settings, the QR
 * section simply doesn't appear — this never blocks completion.
 *
 * "Was the work completed?" was dropped per a later product decision — the
 * feedback step is now just rating + optional comment + the QR, since the
 * extra required field was part of why customers stopped after rating and
 * never engaged with the actual review step.
 */
import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Star, X, Copy, Check, AlertTriangle, Loader2, Languages } from 'lucide-react';
import { INPUT_STYLES } from '../constants';
import api from '../services/api';
import toast from './Toast';
import { SkipReason } from '../types';

type Lang = 'en' | 'ar';

// Every customer-facing string in this screen, in both languages. The
// engineer-facing pieces (loading/error toasts, etc.) stay English-only —
// this is specifically about what the CUSTOMER reads and taps, since
// they're the one being handed the device.
const T: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Customer Feedback',
    handDevice: 'Please hand the device to the customer, or ask them to rate the service.',
    rateService: "How would you rate the engineer's service?",
    starsOf5: 'of 5 stars',
    comments: 'Comments (optional)',
    commentsPlaceholder: 'Anything the customer would like to add…',
    submit: 'Submit',
    skipLink: 'Customer unavailable or unable to rate',
    skipWhy: 'Why are you skipping?',
    skipBack: 'Never mind, go back',
    skippedTitle: 'No problem.',
    skippedBody: 'Feedback was skipped for this job.',
    reviewPrompt: 'Scan to leave a Google review',
    copyLink: 'Copy Review Link',
    linkCopied: 'Link Copied',
    noReviewUrl: "Google Review link hasn't been set up yet. Ask an Admin to add it under Settings.",
    thanksGreat: 'Thank you!',
    thanksLow: 'Thank you for your feedback.',
    followUp: "Our team will follow up.",
    finish: 'I have completed this step',
    customerUnavailable: 'Customer unavailable',
    declined: 'Customer declined to rate',
    languageBarrier: 'Language barrier',
    other: 'Other',
  },
  ar: {
    title: 'تقييم الخدمة',
    handDevice: 'يرجى تسليم الجهاز للعميل، أو طلب تقييم الخدمة.',
    rateService: 'كيف تقيّم خدمة المهندس؟',
    starsOf5: 'من 5 نجوم',
    comments: 'تعليقات (اختياري)',
    commentsPlaceholder: 'أي شيء يرغب العميل بإضافته…',
    submit: 'إرسال',
    skipLink: 'العميل غير متاح أو لا يمكنه التقييم',
    skipWhy: 'لماذا تتخطى هذه الخطوة؟',
    skipBack: 'تراجع',
    skippedTitle: 'لا بأس.',
    skippedBody: 'تم تخطي التقييم لهذه المهمة.',
    reviewPrompt: 'امسح الرمز لترك تقييم على جوجل',
    copyLink: 'نسخ رابط التقييم',
    linkCopied: 'تم نسخ الرابط',
    noReviewUrl: 'لم يتم إعداد رابط تقييم جوجل بعد. يرجى التواصل مع المسؤول لإضافته في الإعدادات.',
    thanksGreat: 'شكراً لك!',
    thanksLow: 'شكراً لملاحظاتك.',
    followUp: 'سيتواصل فريقنا معك قريباً.',
    finish: 'لقد أتممت هذه الخطوة',
    customerUnavailable: 'العميل غير متاح',
    declined: 'رفض العميل التقييم',
    languageBarrier: 'حاجز اللغة',
    other: 'أخرى',
  },
};

interface CompletionFeedbackModalProps {
  activityId?: string | null;
  ticketId?: string | null;
  engineerId: string;
  engineerName: string;
  customerName?: string | null;
  onCancel: () => void;
  onFinalComplete: () => void;
}

// Not every customer is willing or available to rate the service — one tap,
// no typing required, so this never becomes a reason to get stuck mid-job.
const SKIP_REASON_OPTIONS = (t: Record<string, string>): { value: SkipReason; label: string }[] => [
  { value: SkipReason.CUSTOMER_UNAVAILABLE, label: t.customerUnavailable },
  { value: SkipReason.DECLINED, label: t.declined },
  { value: SkipReason.LANGUAGE_BARRIER, label: t.languageBarrier },
  { value: SkipReason.OTHER, label: t.other },
];

const CompletionFeedbackModal: React.FC<CompletionFeedbackModalProps> = ({
  activityId, ticketId, engineerId, engineerName, customerName,
  onCancel, onFinalComplete,
}) => {
  const [lang, setLang] = useState<Lang>('en');
  const t = T[lang];
  const isRtl = lang === 'ar';

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [wasSkipped, setWasSkipped] = useState(false);
  const [copied, setCopied] = useState(false);

  // Skip picker — a small, deliberately understated link beneath the main
  // form, never a competing button. Tapping it reveals one-tap reason
  // options instead of immediately skipping, so a skip is still a real,
  // recorded action rather than a silent shortcut.
  const [showSkipOptions, setShowSkipOptions] = useState(false);

  // Loaded proactively on mount, not lazily after submit — the QR needs to
  // appear inline the instant a 4-5 star rating is tapped, on the SAME
  // screen, not after a separate "submit" step. That's the actual fix for
  // customers treating the star rating as the whole review and never
  // reaching what used to be a second screen after it.
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
  const canSubmit = rating > 0;

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

  const handleSkip = async (reason: SkipReason) => {
    setSubmitting(true);
    try {
      await api.serviceFeedback.create({
        activityId: activityId || undefined,
        ticketId: ticketId || undefined,
        engineerId,
        engineerName,
        customerName: customerName || undefined,
        skipped: true,
        skipReason: reason,
      });
    } catch {
      // Same as a real submission — saving the skip record is best-effort;
      // it never blocks the engineer from finishing the job either way.
      toast.error('Could not record the skip, but you can still complete the job.');
    } finally {
      setSubmitting(false);
      setWasSkipped(true);
      setSubmitted(true);
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
      <div dir={isRtl ? 'rtl' : 'ltr'} className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="font-bold text-slate-900">{t.title}</h2>
          <div className="flex items-center gap-2">
            {/* Language toggle — the customer picks, since the engineer
                can't know in advance whether English or Arabic suits a
                given household, and not every customer reads Arabic
                despite it being the majority. */}
            <button
              onClick={() => setLang(l => l === 'en' ? 'ar' : 'en')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <Languages size={14} />
              {lang === 'en' ? 'العربية' : 'English'}
            </button>
            {!submitted && (
              <button onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {!submitted ? (
          <div className="p-5 space-y-5">
            <p className="text-sm text-slate-500">
              {t.handDevice}
            </p>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 text-center">
                {t.rateService} <span className="text-red-500">*</span>
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
                <p className="text-center text-xs text-slate-400 mt-1">{rating} {t.starsOf5}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">{t.comments}</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                placeholder={t.commentsPlaceholder}
                className={INPUT_STYLES}
              />
            </div>

            {/* Google Review QR — appears the INSTANT a 4-5 star rating is
                tapped, right here on the same screen, not after a separate
                submit step. This is the actual fix: the customer sees and
                can scan this while still holding the phone with their
                rating fresh on it, in one continuous motion, instead of a
                second screen that read as optional and got skipped. */}
            {isPositive && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-center">
                {reviewUrlLoading ? (
                  <div className="flex items-center justify-center gap-2 text-slate-400 py-4">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                ) : reviewUrl ? (
                  <>
                    <p className="font-bold text-slate-900 text-sm mb-3">{t.reviewPrompt}</p>
                    <div className="flex justify-center mb-3">
                      <div className="p-3 bg-white border border-slate-200 rounded-xl inline-block">
                        <QRCodeSVG value={reviewUrl} size={150} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="w-full py-2.5 rounded-xl border border-amber-300 bg-white text-slate-600 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-amber-100/50"
                    >
                      {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                      {copied ? t.linkCopied : t.copyLink}
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-amber-700 text-xs text-left">
                    <AlertTriangle size={14} className="shrink-0" />
                    <p>{t.noReviewUrl}</p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleSubmitFeedback}
              disabled={!canSubmit || submitting}
              className="w-full py-4 rounded-xl bg-emerald-600 text-white font-bold shadow-lg active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {t.submit}
            </button>

            {/* Skip — deliberately small and understated, never competing
                visually with the main Submit button, since the goal is a
                real exception path, not a one-tap default everyone reaches
                for out of habit. */}
            {!showSkipOptions ? (
              <button
                type="button"
                onClick={() => setShowSkipOptions(true)}
                className="w-full text-center text-xs text-slate-400 underline hover:text-slate-500"
              >
                {t.skipLink}
              </button>
            ) : (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">{t.skipWhy}</p>
                <div className="grid grid-cols-1 gap-2">
                  {SKIP_REASON_OPTIONS(t).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={submitting}
                      onClick={() => handleSkip(opt.value)}
                      className="py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-left px-4 flex items-center justify-between"
                    >
                      {opt.label}
                      {submitting && <Loader2 size={14} className="animate-spin" />}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowSkipOptions(false)}
                  className="w-full text-center text-xs text-slate-400 underline mt-3"
                >
                  {t.skipBack}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Post-submit screen is now just a brief confirmation — the QR
                already happened above, inline, before this point. No
                second review step lives here anymore. */}
            <div className="text-center space-y-2 py-4">
              <p className="font-bold text-slate-900">
                {wasSkipped ? t.skippedTitle : isPositive ? t.thanksGreat : t.thanksLow}
              </p>
              <p className="text-sm text-slate-500">
                {wasSkipped ? t.skippedBody : isPositive ? '' : t.followUp}
              </p>
            </div>

            <button
              onClick={onFinalComplete}
              className="w-full py-4 rounded-xl bg-slate-900 text-white font-bold shadow-lg active:scale-[0.98]"
            >
              {t.finish}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompletionFeedbackModal;
