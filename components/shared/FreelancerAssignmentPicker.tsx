/**
 * FreelancerAssignmentPicker.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * Shared "Freelancers" section used by both the Activity Planner
 * (PlanningModule) and the mobile Team Lead dispatch modal
 * (MobileLeadPortal). Replaces what used to be two separately-implemented,
 * free-text-only "name / role / phone" row lists with one control that
 * supports both:
 *   - "Select Existing Freelancer" — searches the permanent Freelancer
 *     Management directory (GET /api/freelancers) and pre-fills
 *     name/phone/role/rate from that profile, keeping a `freelancerId` link
 *     so attendance confirmation later resolves back to the same person.
 *   - "Add New Freelancer" — the original free-text row, unchanged in
 *     shape, so existing activities and the create/update payloads stay
 *     fully backward compatible (freelancerId/dailyRate are simply absent).
 *
 * Deliberately controlled (value/onChange) rather than owning its own list
 * state — the two host forms already own a `freelancers` / `dispatchFreelancers`
 * array and pass it straight through to the activity payload, so this
 * component only needs to read/replace that array.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Search, X, UserPlus, ChevronDown } from 'lucide-react';
import api from '../../services/api';
import type { ActivityFreelancerAssignment, Freelancer } from '../../types';

interface FreelancerAssignmentPickerProps {
  value: ActivityFreelancerAssignment[];
  onChange: (next: ActivityFreelancerAssignment[]) => void;
  /** Visual theme to match the host screen — Planner uses slate, mobile dispatch uses amber. */
  theme?: 'slate' | 'amber';
}

const blankRow = (): ActivityFreelancerAssignment => ({ name: '', role: 'TECHNICAL_ASSOCIATE', phone: '' });

export const FreelancerAssignmentPicker: React.FC<FreelancerAssignmentPickerProps> = ({ value, onChange, theme = 'slate' }) => {
  const [directory, setDirectory] = useState<Freelancer[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  // Which row index currently has its "Select Existing" search dropdown open
  const [searchOpenIdx, setSearchOpenIdx] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.freelancers.list({ isActive: true }).then((rows: Freelancer[]) => {
      if (!cancelled) { setDirectory(rows || []); setDirectoryLoaded(true); }
    }).catch(() => { if (!cancelled) setDirectoryLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setSearchOpenIdx(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filteredDirectory = directory.filter(f =>
    !searchTerm.trim() || f.name.toLowerCase().includes(searchTerm.toLowerCase()) || (f.phone || '').includes(searchTerm)
  ).slice(0, 8);

  const update = (idx: number, patch: Partial<ActivityFreelancerAssignment>) => {
    const next = [...value];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const addBlankRow = () => onChange([...value, blankRow()]);
  const selectExisting = (idx: number, f: Freelancer) => {
    update(idx, { freelancerId: f.id, name: f.name, phone: f.phone || '', role: f.role, dailyRate: f.defaultDailyRate });
    setSearchOpenIdx(null);
    setSearchTerm('');
  };
  const clearLink = (idx: number) => update(idx, { freelancerId: undefined, dailyRate: undefined });

  const accent = theme === 'amber'
    ? { label: 'text-slate-500', addBtn: 'text-amber-600 hover:text-amber-700 bg-amber-50 border border-amber-200', card: 'bg-amber-50/60 border-amber-200' }
    : { label: 'text-slate-500', addBtn: 'text-emerald-600 hover:text-emerald-700', card: 'bg-slate-50 border-slate-200' };

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="flex items-center justify-between">
        <label className={`text-xs font-semibold uppercase ${accent.label}`}>Freelancers (Optional)</label>
        <button
          type="button"
          onClick={addBlankRow}
          className={`text-xs font-bold flex items-center gap-1 px-2 py-1 rounded-lg ${accent.addBtn}`}
        >
          <UserPlus size={12} /> + Add Freelancer
        </button>
      </div>

      {value.length === 0 && (
        <p className="text-[10px] text-slate-400 italic">No freelancers added. Click "+ Add Freelancer" to select an existing one or add a new temporary resource.</p>
      )}

      {value.map((fl, idx) => (
        <div key={idx} className={`border rounded-xl p-3 space-y-2 relative ${accent.card}`}>
          <button
            type="button"
            onClick={() => remove(idx)}
            className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors"
            title="Remove"
          >
            <X size={14} />
          </button>

          {fl.freelancerId ? (
            // ── Linked to a permanent profile ──
            <div className="flex items-center justify-between gap-2 pr-6">
              <div>
                <div className="text-sm font-bold text-slate-800">{fl.name}</div>
                <div className="text-[10px] text-slate-500">
                  {fl.role === 'FIELD_ENGINEER' ? 'Field Engineer' : 'Technical Associate'}
                  {fl.phone ? ` · ${fl.phone}` : ''} · <span className="text-emerald-600 font-semibold">Linked profile</span>
                </div>
              </div>
              <button type="button" onClick={() => clearLink(idx)} className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 underline shrink-0">
                Unlink
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setSearchOpenIdx(searchOpenIdx === idx ? null : idx); setSearchTerm(fl.name || ''); }}
                  className="w-full flex items-center justify-between bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-500"
                >
                  <span className="flex items-center gap-1.5"><Search size={12} /> Select Existing Freelancer…</span>
                  <ChevronDown size={12} />
                </button>
                {searchOpenIdx === idx && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    <input
                      autoFocus
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Search by name or phone…"
                      className="w-full px-2.5 py-2 text-xs border-b border-slate-100 outline-none"
                    />
                    {!directoryLoaded && <div className="px-3 py-2 text-xs text-slate-400">Loading…</div>}
                    {directoryLoaded && filteredDirectory.length === 0 && (
                      <div className="px-3 py-2 text-xs text-slate-400">No matching freelancers. Use "Add New Freelancer" below.</div>
                    )}
                    {filteredDirectory.map(f => (
                      <button
                        type="button"
                        key={f.id}
                        onClick={() => selectExisting(idx, f)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between"
                      >
                        <span>
                          <span className="font-semibold text-slate-800">{f.name}</span>
                          <span className="text-slate-400"> · {f.role === 'FIELD_ENGINEER' ? 'FE' : 'TA'}{f.phone ? ` · ${f.phone}` : ''}</span>
                        </span>
                        <span className="text-slate-400">QAR {f.defaultDailyRate.toFixed(0)}/day</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-[10px] text-slate-400 uppercase font-bold pt-1">— or add new —</div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-bold">Name *</label>
                  <input
                    type="text"
                    value={fl.name}
                    onChange={e => update(idx, { name: e.target.value })}
                    placeholder="e.g. Ahmed (Freelancer)"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-bold">Role</label>
                  <select
                    value={fl.role}
                    onChange={e => update(idx, { role: e.target.value as ActivityFreelancerAssignment['role'] })}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  >
                    <option value="TECHNICAL_ASSOCIATE">Technical Associate</option>
                    <option value="FIELD_ENGINEER">Field Engineer</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold">Phone (Optional)</label>
                <input
                  type="tel"
                  value={fl.phone}
                  onChange={e => update(idx, { phone: e.target.value })}
                  placeholder="+974 XXXX XXXX"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                />
              </div>
            </>
          )}

          <div>
            <label className="text-[10px] text-slate-400 uppercase font-bold">Agreed Daily Rate (QAR)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={fl.dailyRate ?? ''}
              onChange={e => update(idx, { dailyRate: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="150.00"
              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
            />
            <p className="text-[9px] text-slate-400 mt-0.5">Confirmed again — and can be adjusted — when attendance is recorded in Freelancer Management.</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default FreelancerAssignmentPicker;
