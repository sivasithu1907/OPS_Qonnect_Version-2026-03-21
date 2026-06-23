/**
 * ReassignmentModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Lets an Admin/Team Lead move all of one person's open jobs to another
 * engineer in a single action — e.g. when someone goes on leave — instead
 * of opening each ticket/activity individually to reassign it by hand.
 *
 * The new engineer REPLACES the original in whichever role they held on
 * each job (lead, primary, supporting, or technical associate) — this is a
 * deliberate choice, not an oversight: a job goes to exactly one person per
 * role, never two people sharing a role meant for one.
 */
import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Loader2, AlertCircle, Ticket as TicketIcon, Activity as ActivityIcon, CheckCircle2 } from 'lucide-react';
import { Technician } from '../types';
import api from '../services/api';
import { jobRoleLabel } from '../utils/jobRoleUtils';
import toast from './Toast';

interface OpenJob {
  id: string;
  kind: 'ticket' | 'activity';
  customerName: string;
  title: string;
  status: string;
  date: string;
  role: string | null;
}

interface ReassignmentModalProps {
  fromPerson: Technician;
  allTechnicians: Technician[];
  onClose: () => void;
  onComplete?: () => void; // called after a successful reassignment, so the parent can refresh tickets/activities
}

const ReassignmentModal: React.FC<ReassignmentModalProps> = ({ fromPerson, allTechnicians, onClose, onComplete }) => {
  const [jobs, setJobs] = useState<OpenJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toPersonId, setToPersonId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ movedTickets: number; movedActivities: number; failed: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.reassignment.openJobs(fromPerson.id);
        if (!cancelled) {
          setJobs(res.jobs || []);
          // Select everything by default — the common case is "this person
          // is leaving, move it all" — unchecking individual jobs is the
          // exception, not the default action.
          setSelectedIds(new Set((res.jobs || []).map((j: OpenJob) => j.id)));
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load open jobs for this person.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fromPerson.id]);

  const toggleJob = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const candidateTargets = allTechnicians.filter(t => t.id !== fromPerson.id && t.isActive !== false);

  const handleSubmit = async () => {
    if (!toPersonId || selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await api.reassignment.execute(fromPerson.id, toPersonId, Array.from(selectedIds));
      setResult({ movedTickets: res.movedTickets, movedActivities: res.movedActivities, failed: res.failed });
      const total = res.movedTickets + res.movedActivities;
      if (total > 0) toast.success(`Moved ${total} job${total > 1 ? 's' : ''}.`);
      if (res.failed > 0) toast.error(`${res.failed} job${res.failed > 1 ? 's' : ''} could not be moved — they may have already changed.`);
      onComplete?.();
    } catch (e) {
      toast.error('Reassignment failed. Nothing was changed.');
    } finally {
      setSubmitting(false);
    }
  };

  const toPersonName = allTechnicians.find(t => t.id === toPersonId)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <h3 className="font-bold text-slate-900">Reassign jobs</h3>
            <p className="text-xs text-slate-500 mt-0.5">Move all of someone's open work to another engineer</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg"><X size={18} className="text-slate-400" /></button>
        </div>

        {result ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3">
              <CheckCircle2 size={24} />
            </div>
            <h4 className="font-bold text-slate-800">
              {(result.movedTickets + result.movedActivities) > 0 ? 'Jobs reassigned' : 'Nothing moved'}
            </h4>
            <p className="text-sm text-slate-500 mt-1">
              {result.movedTickets} ticket{result.movedTickets !== 1 ? 's' : ''} and {result.movedActivities} activit{result.movedActivities !== 1 ? 'ies' : 'y'} moved to {toPersonName}.
              {result.failed > 0 && ` ${result.failed} job${result.failed > 1 ? 's' : ''} could not be moved.`}
            </p>
            <button onClick={onClose} className="mt-4 px-5 py-2 bg-slate-900 text-white rounded-xl font-bold text-sm">Done</button>
          </div>
        ) : (
          <>
            <div className="px-5 pt-4 pb-2 flex items-center gap-3 shrink-0">
              <div className="flex-1">
                <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">From</p>
                <div className="bg-slate-50 rounded-xl px-3 py-2 text-sm font-medium text-slate-700">{fromPerson.name}</div>
              </div>
              <ArrowRight size={18} className="text-slate-300 mt-4" />
              <div className="flex-1">
                <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">To</p>
                <select
                  value={toPersonId}
                  onChange={e => setToPersonId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
                >
                  <option value="">Select engineer…</option>
                  {candidateTargets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4">
              {loading && (
                <div className="flex items-center justify-center gap-2 text-slate-400 py-10">
                  <Loader2 size={16} className="animate-spin" /> Loading open jobs…
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl p-3 text-sm">
                  <AlertCircle size={16} /> {error}
                </div>
              )}
              {!loading && !error && jobs.length === 0 && (
                <div className="text-center py-10 text-slate-400 text-sm">
                  {fromPerson.name} has no open jobs right now.
                </div>
              )}
              {!loading && !error && jobs.length > 0 && (
                <>
                  <p className="text-xs text-slate-400 mb-2">{jobs.length} open job{jobs.length !== 1 ? 's' : ''} found — select which to move</p>
                  <div className="space-y-1">
                    {jobs.map(job => (
                      <label key={job.id} className="flex items-center gap-3 py-2 px-1 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(job.id)}
                          onChange={() => toggleJob(job.id)}
                          className="shrink-0"
                        />
                        {job.kind === 'ticket' ? <TicketIcon size={14} className="text-purple-400 shrink-0" /> : <ActivityIcon size={14} className="text-blue-400 shrink-0" />}
                        <span className="flex-1 text-sm text-slate-700 truncate">
                          <span className="font-mono text-xs text-slate-400 mr-1.5">{job.id}</span>
                          {job.customerName || job.title}
                          {job.role && <span className="text-slate-400"> · {jobRoleLabel(job.role as any)}</span>}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">{job.date ? new Date(job.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
              <button onClick={onClose} disabled={submitting} className="flex-1 py-2.5 text-slate-500 font-bold rounded-xl border border-slate-200 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!toPersonId || selectedIds.size === 0 || submitting}
                className="flex-1 py-2.5 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Reassigning…' : `Reassign ${selectedIds.size} job${selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReassignmentModal;
