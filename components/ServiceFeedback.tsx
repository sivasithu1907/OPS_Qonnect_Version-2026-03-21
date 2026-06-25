/**
 * ServiceFeedback.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin / Team Lead view of customer feedback captured at job completion.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Star, AlertTriangle, CheckCircle2, RefreshCw, Filter, Loader2 } from 'lucide-react';
import api from '../services/api';
import toast from './Toast';
import { ServiceFeedback as ServiceFeedbackType } from '../types';

const RESOLUTION_LABEL: Record<string, string> = {
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially Completed',
  NOT_COMPLETED: 'Not Completed',
};

const StarRow: React.FC<{ rating: number }> = ({ rating }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map(n => (
      <Star key={n} size={14} className={n <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'} />
    ))}
  </div>
);

const ServiceFeedbackPage: React.FC = () => {
  const [feedback, setFeedback] = useState<ServiceFeedbackType[]>([]);
  const [loading, setLoading] = useState(true);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

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

  const handleResolve = async (id: number) => {
    setResolvingId(id);
    try {
      await api.serviceFeedback.resolveFollowup(id);
      toast.success('Marked as resolved.');
      await fetchFeedback();
    } catch {
      toast.error('Failed to update — please try again.');
    } finally {
      setResolvingId(null);
    }
  };

  const pendingFollowUps = feedback.filter(f => f.followUpRequired && !f.followUpResolved).length;

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
              <p className="text-slate-500 text-sm">Customer ratings captured at job completion</p>
            </div>
          </div>
          <button onClick={fetchFeedback} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div className="flex items-center gap-2 mt-4">
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 py-16">
            <Loader2 size={16} className="animate-spin" /> Loading feedback…
          </div>
        ) : feedback.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Star size={40} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium">{followUpOnly ? 'No follow-ups pending' : 'No feedback yet'}</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {feedback.map(f => {
              const needsAttention = f.followUpRequired && !f.followUpResolved;
              return (
                <div key={f.id} className={`bg-white rounded-xl border p-4 ${needsAttention ? 'border-red-200 bg-red-50/30' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-slate-800">{f.customerName || 'Unknown customer'}</span>
                        <span className="text-[10px] font-mono text-slate-400">{f.activityId || f.ticketId}</span>
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
                      <div className="flex items-center gap-3 mt-2">
                        <StarRow rating={f.rating} />
                        <span className="text-xs font-semibold text-slate-600">{RESOLUTION_LABEL[f.resolutionStatus] || f.resolutionStatus}</span>
                      </div>
                      {f.comment && <p className="text-xs text-slate-500 mt-2 italic">"{f.comment}"</p>}
                      <p className="text-[10px] text-slate-400 mt-2">
                        {new Date(f.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {' · '}Google review shown: {f.googleReviewPromptShown ? 'Yes' : 'No'}
                      </p>
                    </div>
                    {needsAttention && (
                      <button
                        onClick={() => handleResolve(f.id)}
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
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ServiceFeedbackPage;
