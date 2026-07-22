/**
 * AMCContracts.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone AMC / recurring maintenance contracts page, under Operations.
 *
 * Previously this lived as a view-mode tab inside Activity Planner, and
 * required someone to click "Process Due Now" to create the actual job —
 * if nobody clicked it, contracts could sit overdue indefinitely with no
 * visible job ever appearing anywhere. Processing is now automatic
 * (server-side, no button here) and runs ahead of the due date — see the
 * backend's daily cron for the exact window — so a contract due in a few
 * days already has a real, unassigned PLANNED activity sitting in Activity
 * Planner well before the visit is actually needed. A Team Lead picks the
 * engineer and time there, exactly like any other planned activity;
 * rescheduling also happens there, not here. This page is purely for
 * managing the contracts themselves (create / pause / resume / delete) and
 * seeing what's overdue or coming up.
 */
import React, { useState, useEffect, useCallback } from 'react';
import toast from './Toast';
import api from '../services/api';
import { Plus, RefreshCw, Calendar, AlertCircle } from 'lucide-react';
import { Customer } from '../types';
import { AmcSkeleton } from './shared/Skeletons';
import { EmptyAMC } from './shared/EmptyState';
interface AMCContractsProps {
  customers: Customer[];
}

const EMPTY_FORM = {
  customerId: '',
  customerName: '',
  category: 'Wi-Fi & Networking',
  intervalType: 'MONTHLY',
  preferredTime: '09:00',
  nextDueDate: new Date().toISOString().slice(0, 10),
  notes: '',
};

const AMCContracts: React.FC<AMCContractsProps> = ({ customers }) => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/recurring-schedules');
      setSchedules(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load AMC contracts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const togglePause = async (s: any) => {
    try {
      await api.put(`/api/recurring-schedules/${s.id}`, { isActive: !s.is_active });
      await fetchSchedules();
    } catch {
      toast.error('Failed to update contract.');
    }
  };

  const deleteSchedule = async (s: any) => {
    if (!window.confirm(`Delete the AMC contract for ${s.customer_name || 'this customer'}? This cannot be undone.`)) return;
    try {
      await api.del(`/api/recurring-schedules/${s.id}`);
      await fetchSchedules();
    } catch {
      toast.error('Failed to delete contract.');
    }
  };

  const createSchedule = async () => {
    setFormSaving(true);
    try {
      await api.post('/api/recurring-schedules', form);
      setShowForm(false);
      setForm(EMPTY_FORM);
      toast.success('AMC contract created.');
      await fetchSchedules();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create contract.');
    } finally {
      setFormSaving(false);
    }
  };

  // ── Grouping — overdue / due this week / upcoming / paused ──
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekFromNow = new Date(today.getTime() + 7 * 86400000);
  const active = schedules.filter(s => s.is_active);
  const paused = schedules.filter(s => !s.is_active);
  const overdue = active.filter(s => new Date(s.next_due_date) < today);
  const dueThisWeek = active.filter(s => {
    const d = new Date(s.next_due_date);
    return d >= today && d <= weekFromNow;
  });
  const upcoming = active.filter(s => new Date(s.next_due_date) > weekFromNow);

  const renderCard = (s: any) => {
    const dueDate = new Date(s.next_due_date);
    const isOverdue = dueDate < today;
    const isDueToday = dueDate.toDateString() === today.toDateString();
    return (
      <div key={s.id} className={`bg-white rounded-xl border p-4 flex items-start justify-between gap-4 ${isOverdue ? 'border-red-200 bg-red-50/30' : isDueToday ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-slate-800">{s.customer_name || 'Unknown'}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{s.interval_type}</span>
            {isOverdue && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">OVERDUE</span>}
            {isDueToday && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">DUE TODAY</span>}
            {!s.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">PAUSED</span>}
          </div>
          <p className="text-xs text-slate-500">{s.type} · {s.category}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Next due: <span className={`font-bold ${isOverdue ? 'text-red-600' : isDueToday ? 'text-amber-600' : 'text-slate-700'}`}>
              {dueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            {s.last_scheduled_date && ` · Last: ${new Date(s.last_scheduled_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
          </p>
          {s.notes && <p className="text-xs text-slate-400 mt-1 italic">{s.notes}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => togglePause(s)} className={`text-[10px] font-bold px-2 py-1 rounded border ${s.is_active ? 'bg-white text-slate-500 border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'}`}>
            {s.is_active ? 'Pause' : 'Resume'}
          </button>
          <button onClick={() => deleteSchedule(s)} className="text-[10px] font-bold px-2 py-1 rounded border bg-white text-red-500 border-red-200 hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>
    );
  };

  const section = (label: string, items: any[], labelClass = 'text-slate-400') => items.length === 0 ? null : (
    <div className="mb-5">
      <p className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${labelClass}`}>{label} ({items.length})</p>
      <div className="space-y-3">{items.map(renderCard)}</div>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500 rounded-xl"><Calendar size={20} className="text-white" /></div>
              <div>
                <h1 className="text-2xl font-black text-slate-900">AMC Contracts</h1>
                <p className="text-slate-500 text-sm">Recurring maintenance contracts — visits are created automatically ahead of their due date</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchSchedules} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-slate-900 text-white rounded-lg hover:bg-slate-800">
              <Plus size={14} /> New Contract
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Note explaining the automatic flow, since the manual "Process Due
            Now" button people may remember from before no longer exists. */}
        <div className="flex items-start gap-2 mb-5 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Visits are created automatically, ahead of each contract's due date, and appear in Activity Planner under <span className="font-bold">Planned</span> with no engineer or time assigned yet — assign and schedule them from there.</span>
        </div>

        {!loading && schedules.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl p-3 border border-slate-200">
              <p className="text-[11px] text-slate-500 mb-1">Active contracts</p>
              <p className="text-2xl font-bold text-slate-800">{active.length}</p>
            </div>
            <div className={`rounded-xl p-3 border ${dueThisWeek.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
              <p className={`text-[11px] mb-1 ${dueThisWeek.length > 0 ? 'text-amber-700' : 'text-slate-500'}`}>Due this week</p>
              <p className={`text-2xl font-bold ${dueThisWeek.length > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{dueThisWeek.length}</p>
            </div>
            <div className={`rounded-xl p-3 border ${overdue.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
              <p className={`text-[11px] mb-1 ${overdue.length > 0 ? 'text-red-700' : 'text-slate-500'}`}>Overdue</p>
              <p className={`text-2xl font-bold ${overdue.length > 0 ? 'text-red-700' : 'text-slate-800'}`}>{overdue.length}</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-slate-200">
              <p className="text-[11px] text-slate-500 mb-1">Paused</p>
              <p className="text-2xl font-bold text-slate-800">{paused.length}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-4"><AmcSkeleton /></div>
        ) : schedules.length === 0 ? (
          <EmptyAMC />
        ) : (
          <div>
            {section('Overdue — needs attention', overdue, 'text-red-500')}
            {section('Due this week', dueThisWeek, 'text-amber-600')}
            {section('Upcoming', upcoming)}
            {section('Paused', paused)}
          </div>
        )}
      </div>

      {/* New Contract Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 bg-slate-800 text-white">
              <h3 className="font-bold text-lg">New AMC Contract</h3>
              <p className="text-slate-300 text-xs mt-0.5">Recurring maintenance schedule</p>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Client</label>
                <select value={form.customerId} onChange={e => {
                  const cust = customers.find(c => c.id === e.target.value);
                  setForm(p => ({ ...p, customerId: e.target.value, customerName: cust?.name || '' }));
                }} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                  <option value="">Select client...</option>
                  {customers.map(cust => <option key={cust.id} value={cust.id}>{cust.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Service Category</label>
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm">
                  {['Wi-Fi & Networking', 'CCTV', 'Home Automation', 'Intercom', 'Smart Speaker', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Frequency</label>
                <div className="grid grid-cols-2 gap-2">
                  {['MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'].map(f => (
                    <button key={f} type="button" onClick={() => setForm(p => ({ ...p, intervalType: f }))}
                      className={`py-2 rounded-lg border text-xs font-bold transition-all ${form.intervalType === f ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}>
                      {f === 'BIANNUAL' ? 'Every 6 months' : f === 'QUARTERLY' ? 'Every 3 months' : f.charAt(0) + f.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">First Due Date</label>
                  <input type="date" value={form.nextDueDate} onChange={e => setForm(p => ({ ...p, nextDueDate: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Preferred Time</label>
                  <input type="time" value={form.preferredTime} onChange={e => setForm(p => ({ ...p, preferredTime: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Description / Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} placeholder="AMC contract details..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm resize-none" />
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3">
              <button onClick={() => setShowForm(false)} disabled={formSaving} className="flex-1 py-2.5 text-slate-500 font-bold rounded-xl border border-slate-200 disabled:opacity-50">Cancel</button>
              <button disabled={!form.customerId || !form.nextDueDate || formSaving}
                onClick={createSchedule}
                className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed">
                {formSaving ? 'Saving…' : 'Create Contract'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AMCContracts;
