/**
 * ServiceFeedback.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin / Team Lead view of customer feedback captured at job completion.
 *
 * Date filter presets and the Sat–Thu "week" definition mirror the same
 * logic already used in ReportsModule.tsx, reimplemented locally here since
 * that file's helpers aren't exported for reuse.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Star, AlertTriangle, CheckCircle2, RefreshCw, Filter, Loader2, X, Trash2,
  Calendar, ArrowUpDown, Layers, ChevronDown,
} from 'lucide-react';
import api from '../services/api';
import toast from './Toast';
import { ServiceFeedback as ServiceFeedbackType } from '../types';

const RESOLUTION_LABEL: Record<string, string> = {
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially Completed',
  NOT_COMPLETED: 'Not Completed',
};

const SKIP_REASON_LABEL: Record<string, string> = {
  CUSTOMER_UNAVAILABLE: 'Customer unavailable',
  DECLINED: 'Customer declined to rate',
  LANGUAGE_BARRIER: 'Language barrier',
  OTHER: 'Other',
};

type DatePreset = 'today' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom' | 'all';
type ViewMode = 'sort' | 'group';

const StarRow: React.FC<{ rating: number; size?: number }> = ({ rating, size = 14 }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map(n => (
      <Star key={n} size={size} className={n <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'} />
    ))}
  </div>
);

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

// Qatar working week: Saturday → Thursday. "This week" = the Sat–Thu block
// containing today, not the last fully-completed one (that distinction
// matters mid-week — e.g. on a Tuesday, "this week" should already include
// Saturday/Sunday/Monday, not wait until the week's over).
function thisWeekRange(now: Date): [Date, Date] {
  const day = now.getDay(); // Sun=0 ... Sat=6
  const daysSinceSat = (day + 1) % 7; // Sat→0, Sun→1, Mon→2 ... Fri→6
  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceSat);
  const end = new Date(start);
  end.setDate(start.getDate() + 5); // Sat, Sun, Mon, Tue, Wed, Thu = 6 days total, so +5 to land on Thursday
  return [startOfDay(start), endOfDay(end)];
}

const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  today: 'Today',
  thisWeek: 'This Week (Sat–Thu)',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  custom: 'Custom Range',
  all: 'All Time',
};

const ServiceFeedbackPage: React.FC = () => {
  const [feedback, setFeedback] = useState<ServiceFeedbackType[]>([]);
  const [loading, setLoading] = useState(true);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [showDateMenu, setShowDateMenu] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('sort');
  const [sortDir, setSortDir] = useState<'newest' | 'oldest'>('newest');

  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ServiceFeedbackType | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServiceFeedbackType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.serviceFeedback.list(followUpOnly);
      setFeedback(res || []);
    } catch {
      toast.error('Failed to load service feedback.');
    } finally {
      setLoading(false);
    }
  }, [followUpOnly]);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const res = await api.serviceFeedback.get(detailId);
        if (!cancelled) setDetail(res);
      } catch {
        if (!cancelled) toast.error('Failed to load feedback detail.');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [detailId]);

  const handleResolve = async (id: number) => {
    setResolvingId(id);
    try {
      await api.serviceFeedback.resolveFollowup(id);
      toast.success('Marked as resolved.');
      await fetchFeedback();
      if (detail?.id === id) setDetail(d => d ? { ...d, followUpResolved: true } : d);
    } catch {
      toast.error('Failed to update — please try again.');
    } finally {
      setResolvingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.serviceFeedback.delete(deleteTarget.id);
      toast.success('Feedback deleted.');
      setDeleteTarget(null);
      if (detailId === deleteTarget.id) setDetailId(null);
      await fetchFeedback();
    } catch {
      toast.error('Failed to delete — please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const dateRange = useMemo((): [Date, Date] | null => {
    const now = new Date();
    switch (datePreset) {
      case 'today': return [startOfDay(now), endOfDay(now)];
      case 'thisWeek': return thisWeekRange(now);
      case 'thisMonth': return [startOfMonth(now), endOfDay(now)];
      case 'lastMonth': {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return [startOfMonth(lm), endOfMonth(lm)];
      }
      case 'custom':
        if (!customStart || !customEnd) return null;
        return [startOfDay(new Date(customStart)), endOfDay(new Date(customEnd))];
      case 'all':
      default:
        return null;
    }
  }, [datePreset, customStart, customEnd]);

  const dateFiltered = useMemo(() => {
    if (!dateRange) return feedback;
    const [start, end] = dateRange;
    return feedback.filter(f => {
      const d = new Date(f.createdAt);
      return d >= start && d <= end;
    });
  }, [feedback, dateRange]);

  const sorted = useMemo(() => {
    const arr = [...dateFiltered];
    arr.sort((a, b) => {
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sortDir === 'newest' ? diff : -diff;
    });
    return arr;
  }, [dateFiltered, sortDir]);

  const grouped = useMemo(() => {
    const groups: { label: string; items: ServiceFeedbackType[] }[] = [];
    const byKey = new Map<string, ServiceFeedbackType[]>();
    sorted.forEach(f => {
      const d = new Date(f.createdAt);
      const key = d.toDateString();
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(f);
    });
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    Array.from(byKey.entries()).forEach(([key, items]) => {
      const label = key === today ? 'Today' : key === yesterday ? 'Yesterday'
        : new Date(items[0].createdAt).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
      groups.push({ label, items });
    });
    return groups;
  }, [sorted]);

  const pendingFollowUps = feedback.filter(f => f.followUpRequired && !f.followUpResolved).length;
  const skippedCount = dateFiltered.filter(f => f.skipped).length;

  const renderCard = (f: ServiceFeedbackType) => {
    const needsAttention = f.followUpRequired && !f.followUpResolved;
    return (
      <div
        key={f.id}
        onClick={() => setDetailId(f.id)}
        className={`bg-white rounded-xl border p-4 cursor-pointer hover:shadow-sm transition-shadow ${needsAttention ? 'border-red-200 bg-red-50/30' : f.skipped ? 'border-slate-200 bg-slate-50/50' : 'border-slate-200'}`}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-bold text-slate-800">{f.customerName || 'Unknown customer'}</span>
              <span className="text-[10px] font-mono text-slate-400">{f.activityId || f.ticketId}</span>
              {f.skipped && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-bold">Skipped</span>}
              {needsAttention && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold flex items-center gap-1">
                  <AlertTriangle size={10} /> Follow-up needed
                </span>
              )}
              {f.followUpResolved && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center gap-1">
                  <CheckCircle2 size={10} /> Resolved
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">Engineer: {f.engineerName || 'Unknown'}</p>
            {f.skipped ? (
              <p className="text-xs text-slate-500 mt-2">Reason: {SKIP_REASON_LABEL[f.skipReason || ''] || f.skipReason}</p>
            ) : (
              <div className="flex items-center gap-3 mt-2">
                <StarRow rating={f.rating || 0} />
                <span className="text-xs font-semibold text-slate-600">{(f.resolutionStatus && RESOLUTION_LABEL[f.resolutionStatus]) || f.resolutionStatus}</span>
              </div>
            )}
            {f.comment && <p className="text-xs text-slate-500 mt-2 italic">"{f.comment}"</p>}
            <p className="text-[10px] text-slate-400 mt-2">
              {new Date(f.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {!f.skipped && <>{' · '}Google review shown: {f.googleReviewPromptShown ? 'Yes' : 'No'}</>}
            </p>
          </div>
          {needsAttention && (
            <button
              onClick={e => { e.stopPropagation(); handleResolve(f.id); }}
              disabled={resolvingId === f.id}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              {resolvingId === f.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Mark Resolved
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500 rounded-xl">
              <Star size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900">Service Feedback</h1>
              <p className="text-slate-500 text-sm">
                Customer ratings captured at job completion
                {!followUpOnly && dateFiltered.length > 0 && ` · ${skippedCount} of ${dateFiltered.length} skipped`}
              </p>
            </div>
          </div>
          <button onClick={fetchFeedback} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button
            onClick={() => setFollowUpOnly(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${!followUpOnly ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
          >
            <Filter size={12} /> All Feedback
          </button>
          <button
            onClick={() => setFollowUpOnly(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${followUpOnly ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-slate-500 border-slate-200'}`}
          >
            <AlertTriangle size={12} /> Needs Follow-up {pendingFollowUps > 0 && `(${pendingFollowUps})`}
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          <div className="relative">
            <button
              onClick={() => setShowDateMenu(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${datePreset !== 'all' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`}
            >
              <Calendar size={12} /> {DATE_PRESET_LABEL[datePreset]} <ChevronDown size={12} />
            </button>
            {showDateMenu && (
              <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg p-2 w-56">
                {(['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all'] as DatePreset[]).map(p => (
                  <button
                    key={p}
                    onClick={() => { setDatePreset(p); setShowDateMenu(false); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium ${datePreset === p ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-600'}`}
                  >
                    {DATE_PRESET_LABEL[p]}
                  </button>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-2 px-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Custom range</p>
                  <div className="flex items-center gap-1.5">
                    <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 flex-1" />
                    <span className="text-slate-400 text-xs">–</span>
                    <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 flex-1" />
                  </div>
                  <button
                    disabled={!customStart || !customEnd}
                    onClick={() => { setDatePreset('custom'); setShowDateMenu(false); }}
                    className="w-full mt-2 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:bg-slate-200 disabled:cursor-not-allowed"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('sort')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold ${viewMode === 'sort' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <ArrowUpDown size={12} /> Sort
            </button>
            <button
              onClick={() => setViewMode('group')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold ${viewMode === 'group' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <Layers size={12} /> Group by Day
            </button>
          </div>
          {viewMode === 'sort' && (
            <button
              onClick={() => setSortDir(d => d === 'newest' ? 'oldest' : 'newest')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
            >
              {sortDir === 'newest' ? 'Newest first' : 'Oldest first'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6" onClick={() => setShowDateMenu(false)}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 py-16">
            <Loader2 size={16} className="animate-spin" /> Loading feedback…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Star size={40} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium">{followUpOnly ? 'No follow-ups pending' : 'No feedback in this range'}</p>
          </div>
        ) : viewMode === 'sort' ? (
          <div className="space-y-3 max-w-4xl">
            {sorted.map(renderCard)}
          </div>
        ) : (
          <div className="space-y-6 max-w-4xl">
            {grouped.map(g => (
              <div key={g.label}>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">{g.label} · {g.items.length}</p>
                <div className="space-y-3">{g.items.map(renderCard)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detailId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setDetailId(null)}>
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="font-bold text-slate-900">Feedback Detail</h2>
              <button onClick={() => setDetailId(null)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={18} />
              </button>
            </div>
            {detailLoading || !detail ? (
              <div className="flex items-center justify-center gap-2 text-slate-400 py-16">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {detail.skipped && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-bold">Skipped</span>}
                  {detail.followUpRequired && !detail.followUpResolved && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold flex items-center gap-1">
                      <AlertTriangle size={10} /> Follow-up needed
                    </span>
                  )}
                  {detail.followUpResolved && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center gap-1">
                      <CheckCircle2 size={10} /> Resolved
                    </span>
                  )}
                </div>

                {!detail.skipped && (
                  <div className="flex items-center gap-3">
                    <StarRow rating={detail.rating || 0} size={20} />
                    <span className="text-sm font-bold text-slate-700">{detail.rating}/5</span>
                  </div>
                )}

                <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-2">
                  <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Customer</span><span className="font-medium text-slate-800">{detail.customerName || '—'}</span></div>
                  <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Reference</span><span className="font-mono text-slate-700">{detail.activityId || detail.ticketId}</span></div>
                  <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Service / Scope</span><span className="text-slate-700">{detail.serviceCategory || '—'}</span></div>
                  <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Engineer</span><span className="text-slate-700">{detail.engineerName || '—'}</span></div>
                  <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Sales Lead</span><span className="text-slate-700">{detail.salesLeadName || '—'}</span></div>
                  <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Technical Associate</span><span className="text-slate-700">{detail.assistantTechNames?.length ? detail.assistantTechNames.join(', ') : '—'}</span></div>
                  {!detail.skipped && (
                    <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Resolution</span><span className="text-slate-700">{(detail.resolutionStatus && RESOLUTION_LABEL[detail.resolutionStatus]) || '—'}</span></div>
                  )}
                  {detail.skipped && (
                    <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Skip Reason</span><span className="text-slate-700">{SKIP_REASON_LABEL[detail.skipReason || ''] || detail.skipReason}</span></div>
                  )}
                  <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Date & Time</span><span className="text-slate-700">{new Date(detail.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
                  {!detail.skipped && (
                    <div className="flex gap-3"><span className="text-slate-500 w-32 shrink-0">Google Review</span><span className="text-slate-700">{detail.googleReviewPromptShown ? 'Shown' : 'Not shown'}</span></div>
                  )}
                </div>

                {detail.comment && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Customer Comment</p>
                    <p className="text-sm text-amber-800 italic">"{detail.comment}"</p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {detail.followUpRequired && !detail.followUpResolved && (
                    <button
                      onClick={() => handleResolve(detail.id)}
                      disabled={resolvingId === detail.id}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50"
                    >
                      {resolvingId === detail.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Mark Resolved
                    </button>
                  )}
                  <button
                    onClick={() => setDeleteTarget(detail)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-bold bg-red-50 text-red-600 rounded-xl hover:bg-red-100"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900 mb-1">Delete this feedback?</h3>
            <p className="text-sm text-slate-500 mb-4">This permanently removes it — there's no undo. The customer and job reference won't be affected.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="flex-1 py-2.5 text-slate-500 font-bold rounded-xl border border-slate-200 disabled:opacity-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleting && <Loader2 size={14} className="animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceFeedbackPage;
