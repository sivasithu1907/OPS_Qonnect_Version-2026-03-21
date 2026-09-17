/**
 * FreelancerManagement.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * Freelancer Management — permanent freelancer profiles, daily attendance &
 * wages, payments & allocations, and a scoped/expiring CEO review link.
 *
 * Used both from the desktop nav (App.tsx, activeView === 'freelancers') and
 * from the mobile Team Lead Portal ("More" → Freelancer Management), same
 * pattern as PlanningModule/ReportsModule/CustomerRecords — one component,
 * an `isMobile` flag adjusts layout, not the underlying logic.
 *
 * Role matrix (mapped to roles that actually exist in the system — nothing
 * invented, no financial access handed to everyone):
 *   ADMIN       — full access: profiles, attendance, payments, review links
 *   TEAM_LEAD   — profiles (create/edit) + attendance (confirm/edit/void).
 *                 No Payments tab — Team Leads confirm attendance, they do
 *                 not record money movement (spec's own role split).
 *   VIEWER      — read-only everywhere, including Payments (matches this
 *                 app's existing VIEWER convention elsewhere) — never a
 *                 write action.
 *   Other roles — module not shown in navigation at all.
 * The backend enforces every one of these independently of this UI.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from './Toast';
import api from '../services/api';
import { StatusBadge } from './shared/StatusBadge';
import { EmptyState } from './shared/EmptyState';
import { INPUT_STYLES } from '../constants';
import {
  Search, X, Plus, Users, Wallet, ClipboardList, Filter, ChevronRight,
  CheckCircle2, XCircle, Share2, Copy, RotateCcw, Paperclip, Calendar,
  ChevronDown, AlertTriangle, User as UserIcon,
} from 'lucide-react';
import type {
  Activity, Technician, Role as RoleType, Freelancer, FreelancerAttendance,
  FreelancerPayment, FreelancerOverview, FreelancerReviewLink,
} from '../types';

interface CurrentUserLike {
  id: string;
  techId?: string;
  name: string;
  email: string;
  role: RoleType | string;
}

interface FreelancerManagementProps {
  currentUser?: CurrentUserLike;
  activities?: Activity[];
  technicians?: Technician[];
  isMobile?: boolean;
}

type Tab = 'overview' | 'attendance' | 'payments';

const FREELANCER_ROLE_LABEL: Record<string, string> = {
  FIELD_ENGINEER: 'Field Engineer',
  TECHNICAL_ASSOCIATE: 'Technical Associate',
};

function money(n: number | undefined | null) {
  return `QAR ${Number(n || 0).toFixed(2)}`;
}
function todayQatarStr() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Small shared bits ───────────────────────────────────────────────────

const SectionCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white border border-slate-200 rounded-2xl p-4 ${className}`}>{children}</div>
);

const KpiTile: React.FC<{ label: string; value: string | number; accent?: string }> = ({ label, value, accent }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-4">
    <div className={`text-xl font-extrabold ${accent || 'text-slate-900'}`}>{value}</div>
    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-1">{label}</div>
  </div>
);

/** Tiny in-app replacement for window.prompt() — used for void/reverse reasons, matching this app's existing custom-modal-over-native-dialog convention. */
const ReasonPromptModal: React.FC<{
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}> = ({ title, description, confirmLabel = 'Confirm', danger, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-slate-900 mb-1">{title}</h3>
        <p className="text-xs text-slate-500 mb-3">{description}</p>
        <textarea
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason (required)…"
          rows={3}
          className={INPUT_STYLES}
        />
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm">Cancel</button>
          <button
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className={`flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-40 ${danger ? 'bg-red-600' : 'bg-slate-900'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Filter bar (shared by Overview + Attendance tabs) ───────────────────

interface Filters {
  dateFrom: string;
  dateTo: string;
  freelancerId: string;
  crmReference: string;
  salesLeadId: string;
  teamLeadId: string;
}
const EMPTY_FILTERS: Filters = { dateFrom: '', dateTo: '', freelancerId: '', crmReference: '', salesLeadId: '', teamLeadId: '' };

const FilterBar: React.FC<{
  filters: Filters;
  onChange: (f: Filters) => void;
  freelancerDirectory: Freelancer[];
  technicians: Technician[];
}> = ({ filters, onChange, freelancerDirectory, technicians }) => {
  const [open, setOpen] = useState(false);
  const salespeople = technicians.filter(t => t.level === 'SALES' || (t as any).systemRole === 'SALES');
  const teamLeads = technicians.filter(t => t.level === 'TEAM_LEAD');
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <SectionCard className="!p-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-700"><Filter size={14} /> Filters {activeCount > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{activeCount}</span>}</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">From</label>
            <input type="date" value={filters.dateFrom} onChange={e => onChange({ ...filters, dateFrom: e.target.value })} className={INPUT_STYLES} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">To</label>
            <input type="date" value={filters.dateTo} onChange={e => onChange({ ...filters, dateTo: e.target.value })} className={INPUT_STYLES} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Freelancer</label>
            <select value={filters.freelancerId} onChange={e => onChange({ ...filters, freelancerId: e.target.value })} className={INPUT_STYLES}>
              <option value="">All freelancers</option>
              {freelancerDirectory.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">CRM / Customer</label>
            <input value={filters.crmReference} onChange={e => onChange({ ...filters, crmReference: e.target.value })} placeholder="Odoo link or customer name" className={INPUT_STYLES} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Salesperson</label>
            <select value={filters.salesLeadId} onChange={e => onChange({ ...filters, salesLeadId: e.target.value })} className={INPUT_STYLES}>
              <option value="">All salespeople</option>
              {salespeople.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Team</label>
            <select value={filters.teamLeadId} onChange={e => onChange({ ...filters, teamLeadId: e.target.value })} className={INPUT_STYLES}>
              <option value="">All teams</option>
              {teamLeads.map(t => <option key={t.id} value={t.id}>{t.name}'s Team</option>)}
            </select>
          </div>
          {activeCount > 0 && (
            <button onClick={() => onChange(EMPTY_FILTERS)} className="text-xs font-semibold text-slate-500 underline self-start">Clear all filters</button>
          )}
        </div>
      )}
    </SectionCard>
  );
};

// ── Single freelancer picker (used inside Confirm Attendance) ───────────

const SingleFreelancerPicker: React.FC<{
  directory: Freelancer[];
  freelancerId: string;
  draftName: string; draftPhone: string; draftRole: string; draftRate: number | '';
  onSelectExisting: (f: Freelancer) => void;
  onClear: () => void;
  onDraftChange: (patch: Partial<{ name: string; phone: string; role: string; rate: number | '' }>) => void;
}> = ({ directory, freelancerId, draftName, draftPhone, draftRole, draftRate, onSelectExisting, onClear, onDraftChange }) => {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const results = directory.filter(f => !term.trim() || f.name.toLowerCase().includes(term.toLowerCase()) || (f.phone || '').includes(term)).slice(0, 8);

  if (freelancerId) {
    const f = directory.find(d => d.id === freelancerId);
    return (
      <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
        <div>
          <div className="text-sm font-bold text-slate-800">{f?.name || draftName}</div>
          <div className="text-[10px] text-slate-500">{f ? FREELANCER_ROLE_LABEL[f.role] : ''} {f?.phone ? `· ${f.phone}` : ''}</div>
        </div>
        <button onClick={onClear} className="text-[10px] font-semibold text-slate-500 underline">Change</button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-500">
          <span className="flex items-center gap-2"><Search size={14} /> Select existing freelancer…</span>
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
            <input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by name or phone…" className="w-full px-3 py-2 text-sm border-b border-slate-100 outline-none" />
            {results.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matches — add details below instead.</div>}
            {results.map(f => (
              <button key={f.id} type="button" onClick={() => { onSelectExisting(f); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between">
                <span><span className="font-semibold">{f.name}</span> <span className="text-slate-400 text-xs">· {FREELANCER_ROLE_LABEL[f.role]}{f.phone ? ` · ${f.phone}` : ''}</span></span>
                <span className="text-xs text-slate-400">{money(f.defaultDailyRate)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="text-[10px] text-slate-400 uppercase font-bold">— or add new —</div>
      <div className="grid grid-cols-2 gap-2">
        <input value={draftName} onChange={e => onDraftChange({ name: e.target.value })} placeholder="Full name *" className={INPUT_STYLES} />
        <select value={draftRole} onChange={e => onDraftChange({ role: e.target.value })} className={INPUT_STYLES}>
          <option value="TECHNICAL_ASSOCIATE">Technical Associate</option>
          <option value="FIELD_ENGINEER">Field Engineer</option>
        </select>
      </div>
      <input value={draftPhone} onChange={e => onDraftChange({ phone: e.target.value })} placeholder="Phone (optional)" className={INPUT_STYLES} />
    </div>
  );
};

// ── Confirm Attendance modal ─────────────────────────────────────────────

const ConfirmAttendanceModal: React.FC<{
  directory: Freelancer[];
  activities: Activity[];
  onClose: () => void;
  onConfirmed: () => void;
}> = ({ directory, activities, onClose, onConfirmed }) => {
  const [workDate, setWorkDate] = useState(todayQatarStr());
  const [freelancerId, setFreelancerId] = useState('');
  const [draft, setDraft] = useState<{ name: string; phone: string; role: string; rate: number | '' }>({ name: '', phone: '', role: 'TECHNICAL_ASSOCIATE', rate: '' });
  const [rate, setRate] = useState<number | ''>(150);
  const [activitySearch, setActivitySearch] = useState('');
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [workSummary, setWorkSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<Freelancer[] | null>(null);

  // "Helps populate attendance drafts" — activities already planned/dispatched
  // for the chosen date, with freelancers attached at planning time. Purely a
  // prefill convenience; nothing here writes attendance until Confirm is pressed.
  const suggestions = useMemo(() => {
    const chips: { activityId: string; name: string; phone: string; role: string; freelancerId?: string; dailyRate?: number }[] = [];
    (activities || []).forEach(a => {
      const d = new Date(a.plannedDate).toISOString().slice(0, 10);
      if (d !== workDate) return;
      ((a as any).freelancers || []).forEach((fl: any) => {
        chips.push({ activityId: a.id, name: fl.name, phone: fl.phone || '', role: fl.role, freelancerId: fl.freelancerId, dailyRate: fl.dailyRate });
      });
    });
    return chips;
  }, [activities, workDate]);

  const matchingActivities = useMemo(() => {
    const term = activitySearch.trim().toLowerCase();
    return (activities || [])
      .filter(a => {
        if (!term) return new Date(a.plannedDate).toISOString().slice(0, 10) === workDate;
        return (a.customerName || '').toLowerCase().includes(term) || (a.reference || '').toLowerCase().includes(term) || (a.odooLink || '').toLowerCase().includes(term);
      })
      .slice(0, 30);
  }, [activities, activitySearch, workDate]);

  const applySuggestion = (s: typeof suggestions[number]) => {
    if (s.freelancerId) { setFreelancerId(s.freelancerId); }
    else { setDraft({ name: s.name, phone: s.phone, role: s.role || 'TECHNICAL_ASSOCIATE', rate: s.dailyRate || '' }); }
    if (s.dailyRate) setRate(s.dailyRate);
    if (!selectedActivityIds.includes(s.activityId)) setSelectedActivityIds(prev => [...prev, s.activityId]);
  };

  const toggleActivity = (id: string) => {
    setSelectedActivityIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // Keep allocations in sync with the selected set + rate, defaulting to an
  // equal split (adjustable) whenever the set changes.
  useEffect(() => {
    if (selectedActivityIds.length === 0) { setAllocations({}); return; }
    const r = Number(rate) || 0;
    const share = Math.floor((r / selectedActivityIds.length) * 100) / 100;
    const next: Record<string, number> = {};
    selectedActivityIds.forEach((id, i) => {
      next[id] = i === selectedActivityIds.length - 1
        ? Number((r - share * (selectedActivityIds.length - 1)).toFixed(2))
        : share;
    });
    setAllocations(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedActivityIds.join(','), rate]);

  const allocationValues: number[] = Object.values(allocations);
  const allocationSum: number = allocationValues.reduce((s: number, v: number) => s + (Number(v) || 0), 0);
  const allocationOk = selectedActivityIds.length > 0 && Math.abs(allocationSum - (Number(rate) || 0)) < 0.005;

  const submit = async (confirmDuplicateAnyway = false) => {
    if (!freelancerId && !draft.name.trim()) { toast.error('Select an existing freelancer or enter a name.'); return; }
    if (!rate || Number(rate) <= 0) { toast.error('Enter a valid daily rate.'); return; }
    if (selectedActivityIds.length === 0) { toast.error('Link at least one activity.'); return; }
    if (!allocationOk) { toast.error('Project allocations must total the daily wage exactly.'); return; }
    setSubmitting(true);
    try {
      const payload: any = {
        workDate, agreedDailyRate: Number(rate),
        activityIds: selectedActivityIds,
        allocations: selectedActivityIds.map(id => ({ activityId: id, amount: allocations[id] || 0 })),
        workSummary,
        confirmDuplicateAnyway,
      };
      if (freelancerId) payload.freelancerId = freelancerId;
      else payload.newFreelancer = { name: draft.name, phone: draft.phone, role: draft.role, defaultDailyRate: draft.rate || Number(rate) };

      await api.freelancerAttendance.confirm(payload);
      toast.success('Attendance confirmed.');
      onConfirmed();
    } catch (e: any) {
      if (e.message) {
        try {
          const parsed = JSON.parse(e.message);
          if (parsed.error === 'duplicate_warning') { setDuplicateMatches(parsed.matches || []); setSubmitting(false); return; }
          toast.error(parsed.error || parsed.message || 'Failed to confirm attendance.');
        } catch { toast.error(e.message || 'Failed to confirm attendance.'); }
      } else {
        toast.error('Failed to confirm attendance.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="font-bold text-lg text-slate-900">Confirm Attendance</h3>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Actual Work Date</label>
            <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} className={INPUT_STYLES} />
          </div>

          {suggestions.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From today's dispatch — tap to prefill</label>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s, i) => (
                  <button key={i} type="button" onClick={() => applySuggestion(s)} className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-full font-semibold">
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Freelancer</label>
            <SingleFreelancerPicker
              directory={directory}
              freelancerId={freelancerId}
              draftName={draft.name} draftPhone={draft.phone} draftRole={draft.role} draftRate={draft.rate}
              onSelectExisting={f => { setFreelancerId(f.id); setRate(f.defaultDailyRate); }}
              onClear={() => setFreelancerId('')}
              onDraftChange={patch => setDraft(prev => ({ ...prev, ...patch }))}
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Agreed Daily Rate (QAR)</label>
            <input type="number" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value === '' ? '' : Number(e.target.value))} className={INPUT_STYLES} />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Linked Activities *</label>
            <input value={activitySearch} onChange={e => setActivitySearch(e.target.value)} placeholder="Search by customer, reference, or CRM link…" className={`${INPUT_STYLES} mb-2`} />
            <div className="border border-slate-200 rounded-xl max-h-40 overflow-y-auto divide-y divide-slate-100">
              {matchingActivities.length === 0 && <div className="p-3 text-xs text-slate-400">No activities match.</div>}
              {matchingActivities.map(a => (
                <label key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={selectedActivityIds.includes(a.id)} onChange={() => toggleActivity(a.id)} />
                  <span className="flex-1">
                    <span className="font-semibold text-slate-700">{a.customerName || a.reference}</span>
                    <span className="text-slate-400"> · {a.reference} · {new Date(a.plannedDate).toLocaleDateString()}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {selectedActivityIds.length > 1 && (
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Project Cost Allocation (must total {money(rate)})</label>
              <div className="space-y-1.5">
                {selectedActivityIds.map(id => {
                  const a = activities.find(x => x.id === id);
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 flex-1 truncate">{a?.customerName || a?.reference || id}</span>
                      <input
                        type="number" min={0} step="0.01"
                        value={allocations[id] ?? 0}
                        onChange={e => setAllocations(prev => ({ ...prev, [id]: Number(e.target.value) }))}
                        className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-xs text-right"
                      />
                    </div>
                  );
                })}
              </div>
              <div className={`text-[10px] font-bold mt-1 ${allocationOk ? 'text-emerald-600' : 'text-red-500'}`}>
                Allocated {money(allocationSum)} of {money(rate)}
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Work Summary</label>
            <textarea value={workSummary} onChange={e => setWorkSummary(e.target.value)} rows={3} className={INPUT_STYLES} placeholder="What was done…" />
          </div>

          {duplicateMatches && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-xs"><AlertTriangle size={14} /> Possible duplicate freelancer</div>
              <p className="text-xs text-amber-700">A freelancer with a matching name or phone already exists:</p>
              {duplicateMatches.map(m => (
                <button key={m.id} onClick={() => { setFreelancerId(m.id); setRate(m.defaultDailyRate); setDuplicateMatches(null); }} className="w-full text-left text-xs bg-white border border-amber-200 rounded-lg px-2.5 py-1.5">
                  Use existing: <b>{m.name}</b> {m.phone ? `· ${m.phone}` : ''}
                </button>
              ))}
              <button onClick={() => { setDuplicateMatches(null); submit(true); }} className="w-full text-xs font-bold text-amber-800 underline">
                No, this is a different person — create as new
              </button>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 shrink-0">
          <button
            disabled={submitting}
            onClick={() => submit(false)}
            className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl disabled:opacity-50"
          >
            {submitting ? 'Confirming…' : 'Confirm Attendance'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Record Payment modal ────────────────────────────────────────────────

const RecordPaymentModal: React.FC<{
  records: FreelancerAttendance[];
  directory: Freelancer[];
  onClose: () => void;
  onRecorded: () => void;
}> = ({ records, directory, onClose, onRecorded }) => {
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(records.map(r => [r.id, Number(r.balance.toFixed(2))]))
  );
  const uniqueFreelancerIds = [...new Set(records.map(r => r.freelancerId))];
  const [recipientId, setRecipientId] = useState(uniqueFreelancerIds[0] || '');
  const [paymentDate, setPaymentDate] = useState(todayQatarStr());
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const amountValues: number[] = Object.values(amounts);
  const total: number = amountValues.reduce((s: number, v: number) => s + (Number(v) || 0), 0);

  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_500_000) { toast.error('Image too large — please use a smaller file.'); return; }
    setProof(await readFileAsDataUrl(file));
  };

  const submit = async () => {
    if (!recipientId) { toast.error('Select who received this payment.'); return; }
    if (total <= 0) { toast.error('Enter at least one payment amount.'); return; }
    setSubmitting(true);
    try {
      await api.freelancerPayments.record({
        paymentDate, amount: Number(total.toFixed(2)), paymentMethod: method, recipientFreelancerId: recipientId,
        reference, notes, proofAttachment: proof,
        allocations: records.filter(r => (amounts[r.id] || 0) > 0).map(r => ({ attendanceId: r.id, amount: amounts[r.id] })),
      });
      toast.success('Payment recorded.');
      onRecorded();
    } catch (e: any) {
      let msg = 'Failed to record payment.';
      try { msg = JSON.parse(e.message)?.error || msg; } catch { msg = e.message || msg; }
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="font-bold text-lg text-slate-900">Record Payment</h3>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Settling {records.length} record{records.length > 1 ? 's' : ''}</label>
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
              {records.map(r => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="flex-1">
                    <span className="font-semibold">{r.freelancerName}</span> · {r.workDate}
                    <span className="text-slate-400 block">Outstanding {money(r.balance)}</span>
                  </span>
                  <input
                    type="number" min={0} max={r.balance} step="0.01"
                    value={amounts[r.id] ?? 0}
                    onChange={e => setAmounts(prev => ({ ...prev, [r.id]: Number(e.target.value) }))}
                    className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-right"
                  />
                </div>
              ))}
            </div>
            <div className="text-right text-sm font-bold text-slate-800 mt-1">Total: {money(total)}</div>
          </div>

          {uniqueFreelancerIds.length > 1 && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              This settles records for {uniqueFreelancerIds.length} different freelancers. Choose below who actually received the money — each freelancer's own history will show that person as the recipient on their behalf.
            </p>
          )}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Payment Received By</label>
            <select value={recipientId} onChange={e => setRecipientId(e.target.value)} className={INPUT_STYLES}>
              <option value="">Select…</option>
              {directory.filter(f => uniqueFreelancerIds.includes(f.id) || f.id === recipientId).map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
              {directory.filter(f => !uniqueFreelancerIds.includes(f.id)).map(f => (
                <option key={f.id} value={f.id}>{f.name} (collecting for others)</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Payment Date</label>
              <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className={INPUT_STYLES} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)} className={INPUT_STYLES}>
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CHEQUE">Cheque</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Transfer / Payment Reference</label>
            <input value={reference} onChange={e => setReference(e.target.value)} className={INPUT_STYLES} placeholder="Bank ref, cheque no., etc." />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={INPUT_STYLES} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Paperclip size={11} /> Proof of Payment (optional)</label>
            <input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} className="text-xs" />
            {proof && <div className="text-[10px] text-emerald-600 mt-1">Attached ✓</div>}
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 shrink-0">
          <button disabled={submitting} onClick={submit} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl disabled:opacity-50">
            {submitting ? 'Recording…' : `Mark as Paid — ${money(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Share Review Link modal ──────────────────────────────────────────────

const ShareReviewLinkModal: React.FC<{ filters: Filters; onClose: () => void }> = ({ filters, onClose }) => {
  const [label, setLabel] = useState('Freelancer Review');
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [links, setLinks] = useState<FreelancerReviewLink[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const loadLinks = useCallback(() => {
    api.freelancerReviewLinks.list().then(setLinks).catch(() => {});
  }, []);
  useEffect(() => { loadLinks(); }, [loadLinks]);

  const create = async () => {
    setCreating(true);
    try {
      const scope = {
        dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined,
        freelancerId: filters.freelancerId || undefined, crmReference: filters.crmReference || undefined,
        salesLeadId: filters.salesLeadId || undefined, teamLeadId: filters.teamLeadId || undefined,
      };
      const res = await api.freelancerReviewLinks.create({ label, scope, expiresInDays });
      const url = `${window.location.origin}${res.pageUrl}`;
      setCreatedUrl(url);
      loadLinks();
    } catch (e: any) {
      toast.error('Failed to create review link.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (token: string) => {
    try { await api.freelancerReviewLinks.revoke(token); toast.success('Link revoked.'); loadLinks(); }
    catch { toast.error('Failed to revoke link.'); }
  };

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(() => toast.success('Link copied.')).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2"><Share2 size={18} /> Share Review Link</h3>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-slate-500">Creates a read-only, unguessable link scoped to the filters currently applied (date range, freelancer, CRM project, salesperson, or team). No login required to view; no payment attachments or phone numbers are exposed. Revoke anytime.</p>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className={INPUT_STYLES} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Expires In</label>
            <select value={expiresInDays} onChange={e => setExpiresInDays(Number(e.target.value))} className={INPUT_STYLES}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          <button disabled={creating} onClick={create} className="w-full py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm disabled:opacity-50">
            {creating ? 'Creating…' : 'Create Link'}
          </button>
          {createdUrl && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2">
              <span className="text-xs text-emerald-800 truncate flex-1">{createdUrl}</span>
              <button onClick={() => copy(createdUrl)}><Copy size={14} className="text-emerald-700" /></button>
            </div>
          )}

          {links.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Existing Links</label>
              <div className="space-y-1.5">
                {links.map(l => (
                  <div key={l.token} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs">
                    <div>
                      <div className="font-semibold text-slate-700">{l.label}</div>
                      <div className="text-slate-400">
                        {l.isActive ? `Expires ${new Date(l.expiresAt).toLocaleDateString()}` : (l.revokedAt ? 'Revoked' : 'Expired')} · {l.viewCount} view{l.viewCount === 1 ? '' : 's'}
                      </div>
                    </div>
                    {l.isActive && <button onClick={() => revoke(l.token)} className="text-red-500 font-semibold">Revoke</button>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Freelancer profile drawer ────────────────────────────────────────────

const FreelancerDrawer: React.FC<{ freelancerId: string; canManage: boolean; onClose: () => void }> = ({ freelancerId, canManage, onClose }) => {
  const [profile, setProfile] = useState<Freelancer | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ name: string; phone: string; role: string; defaultDailyRate: number; notes: string; isActive: boolean } | null>(null);

  useEffect(() => {
    api.freelancers.get(freelancerId).then((p: Freelancer) => {
      setProfile(p);
      setForm({ name: p.name, phone: p.phone, role: p.role, defaultDailyRate: p.defaultDailyRate, notes: p.notes || '', isActive: p.isActive });
    }).catch(() => toast.error('Failed to load freelancer profile.'));
  }, [freelancerId]);

  const save = async () => {
    if (!form) return;
    try {
      const updated = await api.freelancers.update(freelancerId, form);
      setProfile((prev) => prev ? { ...prev, ...updated } : updated);
      setEditing(false);
      toast.success('Profile updated.');
    } catch { toast.error('Failed to update profile.'); }
  };

  return (
    <div className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="font-bold text-lg text-slate-900">Freelancer Profile</h3>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        {!profile ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {!editing ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold text-slate-900">{profile.name}</div>
                    <div className="text-xs text-slate-500">{FREELANCER_ROLE_LABEL[profile.role]} {profile.phone ? `· ${profile.phone}` : ''}</div>
                  </div>
                  {!profile.isActive && <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">INACTIVE</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <KpiTile label="Person-Days" value={profile.stats?.personDays ?? 0} />
                  <KpiTile label="Default Rate" value={money(profile.defaultDailyRate)} />
                  <KpiTile label="Total Wages" value={money(profile.stats?.totalWages)} />
                  <KpiTile label="Balance" value={money(profile.stats?.balance)} accent={((profile.stats?.balance ?? 0) > 0) ? 'text-red-600' : 'text-emerald-600'} />
                </div>
                {profile.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-2.5">{profile.notes}</p>}
                {canManage && <button onClick={() => setEditing(true)} className="text-xs font-bold text-slate-600 underline">Edit profile</button>}

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Recent Attendance</label>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    {(profile.recentAttendance || []).length === 0 && <div className="p-3 text-xs text-slate-400">No attendance recorded yet.</div>}
                    {(profile.recentAttendance || []).map(a => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <span>{a.workDate} <span className="text-slate-400">· {a.customerName}</span></span>
                        <span className="flex items-center gap-1.5">
                          {money(a.agreedDailyRate)}
                          <StatusBadge status={a.status === 'VOIDED' ? 'VOIDED' : a.paymentStatus} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : form && (
              <>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" className={INPUT_STYLES} />
                <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className={INPUT_STYLES} />
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className={INPUT_STYLES}>
                  <option value="TECHNICAL_ASSOCIATE">Technical Associate</option>
                  <option value="FIELD_ENGINEER">Field Engineer</option>
                </select>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Default Daily Rate (QAR)</label>
                  <input type="number" value={form.defaultDailyRate} onChange={e => setForm({ ...form, defaultDailyRate: Number(e.target.value) })} className={INPUT_STYLES} />
                  <p className="text-[9px] text-slate-400 mt-0.5">Only affects future attendance — past wages are never changed.</p>
                </div>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Supplier / group / contact notes" rows={2} className={INPUT_STYLES} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Active
                </label>
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm">Cancel</button>
                  <button onClick={save} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm">Save</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Add Freelancer inline form ───────────────────────────────────────────

const AddFreelancerForm: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('TECHNICAL_ASSOCIATE');
  const [rate, setRate] = useState(150);
  const [notes, setNotes] = useState('');
  const [duplicateMatches, setDuplicateMatches] = useState<Freelancer[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (confirmDuplicateAnyway = false) => {
    if (name.trim().length < 2) { toast.error('Enter a name.'); return; }
    setSubmitting(true);
    try {
      await api.freelancers.create({ name, phone, role, defaultDailyRate: rate, notes, confirmDuplicateAnyway });
      toast.success('Freelancer added.');
      onCreated();
    } catch (e: any) {
      try {
        const parsed = JSON.parse(e.message);
        if (parsed.error === 'duplicate_warning') { setDuplicateMatches(parsed.matches || []); return; }
        toast.error(parsed.error || 'Failed to add freelancer.');
      } catch { toast.error(e.message || 'Failed to add freelancer.'); }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg text-slate-900">Add Freelancer</h3>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        <div className="space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name *" className={INPUT_STYLES} />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" className={INPUT_STYLES} />
          <select value={role} onChange={e => setRole(e.target.value)} className={INPUT_STYLES}>
            <option value="TECHNICAL_ASSOCIATE">Technical Associate</option>
            <option value="FIELD_ENGINEER">Field Engineer</option>
          </select>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Default Daily Rate (QAR)</label>
            <input type="number" value={rate} onChange={e => setRate(Number(e.target.value))} className={INPUT_STYLES} />
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Supplier / group / contact notes (optional)" rows={2} className={INPUT_STYLES} />

          {duplicateMatches && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-xs"><AlertTriangle size={14} /> Possible duplicate</div>
              {duplicateMatches.map(m => <div key={m.id} className="text-xs text-amber-700">{m.name} {m.phone ? `· ${m.phone}` : ''}</div>)}
              <button onClick={() => submit(true)} className="w-full text-xs font-bold text-amber-800 underline">This is a different person — add anyway</button>
            </div>
          )}
          <button disabled={submitting} onClick={() => submit(false)} className="w-full py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm disabled:opacity-50">
            {submitting ? 'Adding…' : 'Add Freelancer'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────

const FreelancerManagement: React.FC<FreelancerManagementProps> = ({ currentUser, activities = [], technicians = [], isMobile = false }) => {
  const role = String(currentUser?.role || '');
  const canManageFreelancers = ['ADMIN', 'TEAM_LEAD'].includes(role);
  const canManagePayments = role === 'ADMIN';
  const canViewPayments = ['ADMIN', 'VIEWER'].includes(role);

  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [directory, setDirectory] = useState<Freelancer[]>([]);
  const [overview, setOverview] = useState<FreelancerOverview | null>(null);
  const [attendance, setAttendance] = useState<FreelancerAttendance[]>([]);
  const [payments, setPayments] = useState<FreelancerPayment[]>([]);
  const [attendanceSubView, setAttendanceSubView] = useState<'attendance' | 'directory'>('attendance');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showShareLink, setShowShareLink] = useState(false);
  const [showAddFreelancer, setShowAddFreelancer] = useState(false);
  const [drawerFreelancerId, setDrawerFreelancerId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<FreelancerAttendance | null>(null);
  const [reverseTarget, setReverseTarget] = useState<FreelancerPayment | null>(null);

  const queryParams = useMemo(() => ({
    dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined,
    freelancerId: filters.freelancerId || undefined, crmReference: filters.crmReference || undefined,
    salesLeadId: filters.salesLeadId || undefined, teamLeadId: filters.teamLeadId || undefined,
  }), [filters]);

  const loadDirectory = useCallback(() => { api.freelancers.list().then(setDirectory).catch(() => {}); }, []);
  const loadOverview = useCallback(() => { api.freelancerOverview(queryParams).then(setOverview).catch(() => {}); }, [queryParams]);
  const loadAttendance = useCallback(() => {
    setLoading(true);
    api.freelancerAttendance.list(queryParams).then(setAttendance).catch(() => {}).finally(() => setLoading(false));
  }, [queryParams]);
  const loadPayments = useCallback(() => {
    if (!canViewPayments) return;
    setLoading(true);
    api.freelancerPayments.list().then(setPayments).catch(() => {}).finally(() => setLoading(false));
  }, [canViewPayments]);

  useEffect(() => { loadDirectory(); }, [loadDirectory]);
  useEffect(() => { if (tab === 'overview') loadOverview(); }, [tab, loadOverview]);
  useEffect(() => { if (tab === 'attendance') loadAttendance(); }, [tab, loadAttendance]);
  useEffect(() => { if (tab === 'payments') loadPayments(); }, [tab, loadPayments]);

  const refreshAll = () => { loadDirectory(); loadOverview(); loadAttendance(); loadPayments(); };

  const unpaidRecords = attendance.filter(a => a.status === 'CONFIRMED' && a.paymentStatus !== 'PAID');
  const selectedRecords = attendance.filter(a => selectedIds.includes(a.id));

  const doVoid = async (reason: string) => {
    if (!voidTarget) return;
    try { await api.freelancerAttendance.void(voidTarget.id, reason); toast.success('Attendance voided.'); setVoidTarget(null); loadAttendance(); loadOverview(); }
    catch (e: any) { let msg = 'Failed to void.'; try { msg = JSON.parse(e.message)?.error || msg; } catch {} toast.error(msg); }
  };
  const doReverse = async (reason: string) => {
    if (!reverseTarget) return;
    try { await api.freelancerPayments.reverse(reverseTarget.id, reason); toast.success('Payment reversed.'); setReverseTarget(null); loadPayments(); loadAttendance(); loadOverview(); }
    catch (e: any) { let msg = 'Failed to reverse.'; try { msg = JSON.parse(e.message)?.error || msg; } catch {} toast.error(msg); }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <ClipboardList size={14} /> },
    { key: 'attendance', label: 'Freelancers & Attendance', icon: <Users size={14} /> },
    ...(canViewPayments ? [{ key: 'payments' as Tab, label: 'Payments', icon: <Wallet size={14} /> }] : []),
  ];

  return (
    <div className={`h-full overflow-y-auto bg-slate-50 ${isMobile ? 'pb-24' : ''}`}>
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        {!isMobile && (
          <div>
            <h1 className="text-xl font-bold text-slate-900">Freelancer Management</h1>
            <p className="text-xs text-slate-500">Profiles, daily attendance & wages, payments, and CEO review links.</p>
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${tab === t.key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <FilterBar filters={filters} onChange={setFilters} freelancerDirectory={directory} technicians={technicians} />

        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <KpiTile label="Freelancers" value={overview?.totals.uniqueFreelancers ?? '—'} />
              <KpiTile label="Person-Days" value={overview?.totals.personDays ?? '—'} />
              <KpiTile label="Total Wages" value={overview ? money(overview.totals.totalWages) : '—'} />
              <KpiTile label="Paid" value={overview ? money(overview.totals.totalPaid) : '—'} accent="text-emerald-600" />
              <KpiTile label="Balance" value={overview ? money(overview.totals.totalBalance) : '—'} accent="text-red-600" />
            </div>

            {canManagePayments && (
              <button onClick={() => setShowShareLink(true)} className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-2 rounded-xl">
                <Share2 size={14} /> Share Review Link (CEO)
              </button>
            )}

            <SectionCard>
              <h3 className="text-sm font-bold text-slate-700 mb-2">By Freelancer</h3>
              {(!overview || overview.byFreelancer.length === 0) ? (
                <EmptyState icon={<Users size={20} />} title="No records" description="No attendance in this range yet." size="sm" />
              ) : (
                <div className="divide-y divide-slate-100">
                  {overview.byFreelancer.map(f => (
                    <button key={f.freelancerId} onClick={() => setDrawerFreelancerId(f.freelancerId)} className="w-full flex items-center justify-between py-2.5 text-left">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{f.name}</div>
                        <div className="text-[10px] text-slate-400">{f.personDays} day{f.personDays === 1 ? '' : 's'}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-slate-800">{money(f.totalWages)}</div>
                        <div className="text-[10px] text-slate-400">Paid {money(f.totalPaid)} · Bal {money(f.balance)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {tab === 'attendance' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                <button onClick={() => setAttendanceSubView('attendance')} className={`text-xs font-bold px-3 py-1.5 rounded-lg ${attendanceSubView === 'attendance' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>Attendance</button>
                <button onClick={() => setAttendanceSubView('directory')} className={`text-xs font-bold px-3 py-1.5 rounded-lg ${attendanceSubView === 'directory' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>Directory</button>
              </div>
              {canManageFreelancers && attendanceSubView === 'attendance' && (
                <button onClick={() => setShowConfirm(true)} className="flex items-center gap-1.5 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-xl"><Plus size={14} /> Confirm Attendance</button>
              )}
              {canManageFreelancers && attendanceSubView === 'directory' && (
                <button onClick={() => setShowAddFreelancer(true)} className="flex items-center gap-1.5 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-xl"><Plus size={14} /> Add Freelancer</button>
              )}
            </div>

            {attendanceSubView === 'attendance' ? (
              <SectionCard className="!p-0 overflow-hidden">
                {loading ? (
                  <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
                ) : attendance.length === 0 ? (
                  <EmptyState icon={<Calendar size={20} />} title="No attendance records" description="Confirm today's attendance to start tracking wages." size="sm" />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {attendance.map(a => (
                      <div key={a.id} className="p-3.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-800">{a.freelancerName}</span>
                            <span className="text-xs text-slate-400">{a.workDate}</span>
                            <StatusBadge status={a.status === 'VOIDED' ? 'VOIDED' : a.paymentStatus} />
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {a.customerName} {a.crmReference && <a href={a.crmReference} target="_blank" rel="noopener noreferrer" className="text-amber-600 underline ml-1">CRM</a>}
                            {a.teamLeadName && ` · ${a.teamLeadName}'s Team`}
                          </div>
                          {a.workSummary && <div className="text-xs text-slate-400 truncate mt-0.5">{a.workSummary}</div>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-sm text-slate-800">{money(a.agreedDailyRate)}</div>
                          <div className="text-[10px] text-slate-400">Paid {money(a.paidAmount)} · Bal {money(a.balance)}</div>
                          {canManageFreelancers && a.status === 'CONFIRMED' && a.paidAmount === 0 && (
                            <button onClick={() => setVoidTarget(a)} className="text-[10px] font-semibold text-red-500 underline mt-1">Void</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            ) : (
              <SectionCard className="!p-0 overflow-hidden">
                {directory.length === 0 ? (
                  <EmptyState icon={<Users size={20} />} title="No freelancers yet" description="Add your first freelancer to start assigning and paying them." size="sm" />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {directory.map(f => (
                      <button key={f.id} onClick={() => setDrawerFreelancerId(f.id)} className="w-full flex items-center justify-between p-3.5 text-left">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-800">{f.name}</span>
                            {!f.isActive && <span className="text-[9px] font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">INACTIVE</span>}
                          </div>
                          <div className="text-xs text-slate-500">{FREELANCER_ROLE_LABEL[f.role]} {f.phone ? `· ${f.phone}` : ''}</div>
                        </div>
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">{money(f.defaultDailyRate)}/day <ChevronRight size={14} className="text-slate-300" /></div>
                      </button>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        )}

        {tab === 'payments' && canViewPayments && (
          <div className="space-y-4">
            <SectionCard>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-700">Unpaid / Partially Paid</h3>
                {canManagePayments && selectedIds.length > 0 && (
                  <button onClick={() => setShowPayment(true)} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-lg">
                    Mark {selectedIds.length} as Paid
                  </button>
                )}
              </div>
              {unpaidRecords.length === 0 ? (
                <EmptyState icon={<CheckCircle2 size={20} />} title="All settled" description="No outstanding balances right now." size="sm" />
              ) : (
                <div className="divide-y divide-slate-100">
                  {unpaidRecords.map(a => (
                    <label key={a.id} className="flex items-center gap-3 py-2.5 cursor-pointer">
                      {canManagePayments && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(a.id)}
                          onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, a.id] : prev.filter(x => x !== a.id))}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800">{a.freelancerName} <span className="text-xs text-slate-400 font-normal">· {a.workDate}</span></div>
                        <div className="text-xs text-slate-400 truncate">{a.customerName}</div>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={a.paymentStatus} />
                        <div className="text-xs font-bold text-slate-700 mt-0.5">Bal {money(a.balance)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard>
              <h3 className="text-sm font-bold text-slate-700 mb-2">Payment History</h3>
              {payments.length === 0 ? (
                <EmptyState icon={<Wallet size={20} />} title="No payments yet" description="Recorded payments will appear here." size="sm" />
              ) : (
                <div className="divide-y divide-slate-100">
                  {payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                          {p.recipientName} <StatusBadge status={p.status === 'REVERSED' ? 'REVERSED' : 'RECORDED'} />
                        </div>
                        <div className="text-[10px] text-slate-400">{p.paymentDate} · {p.paymentMethod} {p.reference ? `· ${p.reference}` : ''}</div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <div className="text-sm font-bold text-slate-800">{money(p.amount)}</div>
                        {canManagePayments && p.status === 'RECORDED' && (
                          <button onClick={() => setReverseTarget(p)} title="Reverse payment"><RotateCcw size={14} className="text-slate-400 hover:text-red-500" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </div>

      {showConfirm && (
        <ConfirmAttendanceModal
          directory={directory}
          activities={activities}
          onClose={() => setShowConfirm(false)}
          onConfirmed={() => { setShowConfirm(false); loadAttendance(); loadOverview(); loadDirectory(); }}
        />
      )}
      {showPayment && (
        <RecordPaymentModal
          records={selectedRecords}
          directory={directory}
          onClose={() => setShowPayment(false)}
          onRecorded={() => { setShowPayment(false); setSelectedIds([]); loadAttendance(); loadPayments(); loadOverview(); }}
        />
      )}
      {showShareLink && <ShareReviewLinkModal filters={filters} onClose={() => setShowShareLink(false)} />}
      {showAddFreelancer && <AddFreelancerForm onClose={() => setShowAddFreelancer(false)} onCreated={() => { setShowAddFreelancer(false); loadDirectory(); }} />}
      {drawerFreelancerId && <FreelancerDrawer freelancerId={drawerFreelancerId} canManage={canManageFreelancers} onClose={() => setDrawerFreelancerId(null)} />}
      {voidTarget && (
        <ReasonPromptModal
          title="Void Attendance"
          description={`This will void ${voidTarget.freelancerName}'s ${voidTarget.workDate} attendance record. This cannot be undone, but the record is kept for history.`}
          confirmLabel="Void Record"
          danger
          onCancel={() => setVoidTarget(null)}
          onConfirm={doVoid}
        />
      )}
      {reverseTarget && (
        <ReasonPromptModal
          title="Reverse Payment"
          description={`This will reverse the ${money(reverseTarget.amount)} payment to ${reverseTarget.recipientName} and restore the outstanding balance on every attendance record it settled.`}
          confirmLabel="Reverse Payment"
          danger
          onCancel={() => setReverseTarget(null)}
          onConfirm={doReverse}
        />
      )}
    </div>
  );
};

export default FreelancerManagement;
