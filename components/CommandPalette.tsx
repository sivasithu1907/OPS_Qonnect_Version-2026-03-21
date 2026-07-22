import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Search, CornerDownLeft, SearchX, Loader2, Contact, Calendar, Ticket, ClipboardList, AlertCircle } from 'lucide-react';
import { CommandItem, searchCommands, IS_APPLE_PLATFORM } from './commandRegistry';

// ─────────────────────────────────────────────────────────────────────────────
// Command Palette (Sprint 2.1 + 3.1A)
//
// Sprint 3.1A adds:
//  - Backend record search (clients, activities, tickets, SARs)
//  - Debounced fetch (300ms) for queries ≥ 2 characters
//  - Stale-request cancellation (AbortController)
//  - Record result groups below navigation results
//  - Permission-correct: backend enforces role scoping for every record type
//  - Loading / error / empty states per the design system
//  - Existing navigation/quick-action commands completely unchanged
// ─────────────────────────────────────────────────────────────────────────────

// ── Record result types (returned by /api/search/records) ─────────────────
interface ClientResult {
  id: string; name: string; phone: string; email: string;
  buildingNumber: string; locationUrl: string;
}
interface ActivityResult {
  id: string; reference: string; type: string; status: string;
  customerName: string; plannedDate: string | null;
  serviceCategory: string; odooLink: string;
}
interface TicketResult {
  id: string; customerName: string; phoneNumber: string;
  category: string; status: string; odooLink: string;
}
interface SARResult {
  id: string; customerName: string; contactNumber: string;
  activityType: string; serviceCategory: string; status: string;
  odooReference: string; salesLeadName: string;
}

interface SearchResults {
  clients: ClientResult[];
  activities: ActivityResult[];
  tickets: TicketResult[];
  sars: SARResult[];
}

// ── Record command item (unified type for navigation in palette) ──────────
export interface RecordItem {
  /** Unique identifier for keyboard navigation */
  id: string;
  kind: 'record';
  recordType: 'client' | 'activity' | 'ticket' | 'sar';
  /** Primary display line */
  label: string;
  /** Secondary context line */
  sublabel: string;
  /** Status string for badge */
  status?: string;
  /** The record's database ID */
  recordId: string;
}

// ── Section is either CommandItem rows or RecordItem rows ─────────────────
type PaletteItem = CommandItem | RecordItem;

interface Section {
  heading: string;
  items: PaletteItem[];
}

// ── Props ─────────────────────────────────────────────────────────────────
interface CommandPaletteProps {
  onClose: () => void;
  commands: CommandItem[];
  recentViews: string[];
  onSelect: (command: CommandItem) => void;
  onSelectRecord: (item: RecordItem) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────
const MODIFIER_LABEL = IS_APPLE_PLATFORM ? '⌘' : 'Ctrl';
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

// ── Helpers ───────────────────────────────────────────────────────────────
const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <kbd className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[5px] border border-slate-200 bg-white text-[10px] font-semibold text-slate-500 leading-none ${className}`}>
    {children}
  </kbd>
);

const RECORD_ICONS: Record<RecordItem['recordType'], React.ReactNode> = {
  client:   <Contact size={16} />,
  activity: <Calendar size={16} />,
  ticket:   <Ticket size={16} />,
  sar:      <ClipboardList size={16} />,
};

const RECORD_TYPE_LABEL: Record<RecordItem['recordType'], string> = {
  client:   'Client',
  activity: 'Activity',
  ticket:   'Ticket',
  sar:      'Sales Request',
};

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('qonnect_token') || '';
  return { 'Authorization': `Bearer ${token}` };
}

// ── Main component ────────────────────────────────────────────────────────
const CommandPalette: React.FC<CommandPaletteProps> = ({
  onClose, commands, recentViews, onSelect, onSelectRecord
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recordResults, setRecordResults] = useState<SearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Backend search with debounce + stale-request cancellation ────────────
  const fetchRecords = useCallback((q: string) => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.trim().length < MIN_QUERY_LEN) {
      setRecordResults(null);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/search/records?q=${encodeURIComponent(q.trim())}`,
          { headers: getAuthHeaders(), signal: controller.signal }
        );
        if (!res.ok) throw new Error('Search failed');
        const data: SearchResults = await res.json();
        setRecordResults(data);
        setSearchError(null);
      } catch (e: any) {
        if (e.name === 'AbortError') return; // stale request — ignore
        setSearchError('Record search unavailable');
        setRecordResults(null);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    fetchRecords(query);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [query, fetchRecords]);

  // ── Build sections ────────────────────────────────────────────────────────
  const sections: Section[] = useMemo(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      // Empty query → Recent / Quick Actions / Navigation (unchanged from Sprint 2.1)
      const navCommands = commands.filter(c => c.kind === 'navigation');
      const actionCommands = commands.filter(c => c.kind === 'action');
      const recentItems = recentViews
        .map(view => navCommands.find(c => c.targetView === view))
        .filter((c): c is CommandItem => Boolean(c))
        .slice(0, 5);
      const out: Section[] = [];
      if (recentItems.length) out.push({ heading: 'Recent', items: recentItems });
      if (actionCommands.length) out.push({ heading: 'Quick Actions', items: actionCommands });
      if (navCommands.length) out.push({ heading: 'Navigation', items: navCommands });
      return out;
    }

    // Typed query → navigation commands first, then record results
    const navResults = searchCommands(commands, trimmed);
    const out: Section[] = [];
    if (navResults.length) out.push({ heading: 'Commands', items: navResults });

    if (recordResults) {
      if (recordResults.clients.length) {
        out.push({
          heading: 'Clients',
          items: recordResults.clients.map((c): RecordItem => ({
            id: `record:client:${c.id}`,
            kind: 'record',
            recordType: 'client',
            label: c.name,
            sublabel: [c.phone, c.buildingNumber, c.email].filter(Boolean).join(' · '),
            recordId: c.id,
          })),
        });
      }
      if (recordResults.activities.length) {
        out.push({
          heading: 'Activities',
          items: recordResults.activities.map((a): RecordItem => ({
            id: `record:activity:${a.id}`,
            kind: 'record',
            recordType: 'activity',
            label: `${a.reference} · ${a.type}`,
            sublabel: [a.customerName, a.serviceCategory].filter(Boolean).join(' · '),
            status: a.status,
            recordId: a.id,
          })),
        });
      }
      if (recordResults.tickets.length) {
        out.push({
          heading: 'Active Tickets',
          items: recordResults.tickets.map((t): RecordItem => ({
            id: `record:ticket:${t.id}`,
            kind: 'record',
            recordType: 'ticket',
            label: `${t.id} · ${t.category || 'Support'}`,
            sublabel: [t.customerName, t.phoneNumber].filter(Boolean).join(' · '),
            status: t.status,
            recordId: t.id,
          })),
        });
      }
      if (recordResults.sars.length) {
        out.push({
          heading: 'Sales Requests',
          items: recordResults.sars.map((s): RecordItem => ({
            id: `record:sar:${s.id}`,
            kind: 'record',
            recordType: 'sar',
            label: `${s.id} · ${s.activityType}`,
            sublabel: [s.customerName, s.serviceCategory].filter(Boolean).join(' · '),
            status: s.status,
            recordId: s.id,
          })),
        });
      }
    }

    return out;
  }, [query, commands, recentViews, recordResults]);

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => sections.flatMap(s => s.items), [sections]);

  // Reset selection on query change
  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => {
    setSelectedIndex(prev => flatItems.length === 0 ? 0 : Math.min(prev, flatItems.length - 1));
  }, [flatItems.length]);

  // Autofocus
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Scroll selected into view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`#qp-option-${selectedIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const moveSelection = (delta: 1 | -1) => {
    if (flatItems.length === 0) return;
    setSelectedIndex(prev => (prev + delta + flatItems.length) % flatItems.length);
  };

  const executeSelected = () => {
    const item = flatItems[selectedIndex];
    if (!item) return;
    if (item.kind === 'record') onSelectRecord(item as RecordItem);
    else onSelect(item as CommandItem);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveSelection(1); break;
      case 'ArrowUp':   e.preventDefault(); moveSelection(-1); break;
      case 'Tab':       e.preventDefault(); moveSelection(e.shiftKey ? -1 : 1); break;
      case 'Enter':     e.preventDefault(); executeSelected(); break;
      case 'Escape':    e.preventDefault(); e.stopPropagation(); onClose(); break;
    }
  };

  const handleItemClick = (item: PaletteItem) => {
    if (item.kind === 'record') onSelectRecord(item as RecordItem);
    else onSelect(item as CommandItem);
  };

  // ── Whether to show the no-results state ─────────────────────────────────
  const trimmed = query.trim();
  const showNoResults =
    trimmed.length >= MIN_QUERY_LEN &&
    !isSearching &&
    sections.length === 0 &&
    !searchError;

  const showSearchError = !!searchError && trimmed.length >= MIN_QUERY_LEN;

  let optionIndex = -1;

  return (
    <div
      className="qp-backdrop fixed inset-0 z-[210] bg-slate-900/30 backdrop-blur-[2px] flex items-start justify-center px-4 pt-[10vh] sm:pt-[16vh] pb-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="qp-panel w-full max-w-[600px] bg-white rounded-[14px] border border-slate-200 shadow-[0_24px_64px_-16px_rgba(15,23,42,0.28),0_2px_8px_rgba(15,23,42,0.06)] overflow-hidden flex flex-col"
      >
        {/* ── Search input ── */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          {isSearching
            ? <Loader2 size={17} className="shrink-0 text-slate-400 animate-spin" aria-hidden="true" />
            : <Search size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
          }
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={flatItems.length > 0}
            aria-controls="qp-listbox"
            aria-activedescendant={flatItems.length > 0 ? `qp-option-${selectedIndex}` : undefined}
            aria-label="Search pages, actions, and records"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search or jump to…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 min-w-0 bg-transparent outline-none border-none text-[15px] font-medium text-slate-900 placeholder-slate-400"
          />
          <Kbd className="hidden sm:inline-flex px-1.5">Esc</Kbd>
        </div>

        {/* ── Results list ── */}
        <div
          ref={listRef}
          id="qp-listbox"
          role="listbox"
          aria-label="Commands and records"
          className="flex-1 overflow-y-auto custom-scrollbar max-h-[min(58vh,440px)] py-1.5"
        >
          {/* Loading state — show a subtle indicator while searching */}
          {isSearching && trimmed.length >= MIN_QUERY_LEN && sections.length === 0 && (
            <div className="flex items-center gap-2.5 px-5 py-8 text-slate-400">
              <Loader2 size={15} className="animate-spin shrink-0" />
              <span className="text-sm">Searching records…</span>
            </div>
          )}

          {/* Search error — navigation still works */}
          {showSearchError && (
            <div className="mx-2 mb-2 flex items-start gap-2.5 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-snug">
                Record search is temporarily unavailable. Navigation commands are still available.
              </p>
            </div>
          )}

          {/* No results */}
          {showNoResults && (
            <div className="flex flex-col items-center gap-2.5 py-10 px-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                <SearchX size={18} className="text-slate-400" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                No matching results
              </p>
              <p className="text-xs text-slate-400 max-w-[300px]">
                Try a client name, phone number, activity reference, or ticket ID.
              </p>
            </div>
          )}

          {/* Results */}
          {sections.map(section => (
            <div key={section.heading} role="group" aria-label={section.heading} className="px-2 pb-1">
              <h3 className="px-2.5 pt-2.5 pb-1.5">
                <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.11em]">
                  {section.heading}
                </span>
              </h3>
              <div className="space-y-px">
                {section.items.map(item => {
                  optionIndex += 1;
                  const index = optionIndex;
                  const isSelected = index === selectedIndex;

                  if (item.kind === 'record') {
                    const rec = item as RecordItem;
                    return (
                      <button
                        key={rec.id}
                        type="button"
                        id={`qp-option-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={-1}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => handleItemClick(rec)}
                        className={`qp-row relative w-full flex items-center gap-3 rounded-lg pl-3.5 pr-3 py-2.5 min-h-[48px] text-left transition-colors duration-100 ${
                          isSelected ? 'bg-[#FFCC00]/[0.12]' : 'hover:bg-slate-50'
                        }`}
                      >
                        {isSelected && (
                          <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-[#FFCC00]" />
                        )}
                        <span
                          aria-hidden="true"
                          className={`shrink-0 flex items-center justify-center transition-colors duration-100 ${
                            isSelected ? 'text-[#B8860B]' : 'text-slate-400'
                          }`}
                        >
                          {RECORD_ICONS[rec.recordType]}
                        </span>
                        <span className="flex-1 min-w-0 flex flex-col">
                          <span className={`text-sm tracking-[-0.01em] truncate ${
                            isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                          }`}>
                            {rec.label}
                          </span>
                          {rec.sublabel && (
                            <span className="text-[11px] text-slate-400 truncate mt-0.5 font-normal">
                              {rec.sublabel}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 flex items-center gap-2">
                          {rec.status && (
                            <span className="hidden sm:block text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">
                              {rec.status.replace(/_/g, ' ')}
                            </span>
                          )}
                          <span className="hidden sm:block text-[10px] font-medium text-slate-400">
                            {RECORD_TYPE_LABEL[rec.recordType]}
                          </span>
                          {isSelected && (
                            <span className="flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border border-slate-200 bg-white text-slate-500" aria-hidden="true">
                              <CornerDownLeft size={10} />
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  }

                  // Navigation / action item (unchanged from Sprint 2.1)
                  const cmd = item as CommandItem;
                  return (
                    <button
                      key={`${section.heading}:${cmd.id}`}
                      type="button"
                      id={`qp-option-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={-1}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => handleItemClick(cmd)}
                      className={`qp-row relative w-full flex items-center gap-3 rounded-lg pl-3.5 pr-3 py-2.5 min-h-[44px] text-left transition-colors duration-100 ${
                        isSelected ? 'bg-[#FFCC00]/[0.12]' : 'hover:bg-slate-50'
                      }`}
                    >
                      {isSelected && (
                        <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-[#FFCC00]" />
                      )}
                      <span
                        aria-hidden="true"
                        className={`shrink-0 flex items-center justify-center transition-colors duration-100 ${
                          isSelected ? 'text-[#B8860B]' : 'text-slate-400'
                        }`}
                      >
                        {cmd.icon}
                      </span>
                      <span className={`flex-1 min-w-0 truncate text-sm tracking-[-0.01em] ${
                        isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                      }`}>
                        {cmd.label}
                      </span>
                      <span className="shrink-0 flex items-center gap-2">
                        <span className="hidden sm:block text-[11px] font-medium text-slate-400">
                          {cmd.contextLabel}
                        </span>
                        {isSelected && (
                          <span className="flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border border-slate-200 bg-white text-slate-500" aria-hidden="true">
                            <CornerDownLeft size={10} />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
          <div className="flex items-center gap-3.5 text-[11px] font-medium text-slate-400">
            <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
            <span className="flex items-center gap-1.5"><Kbd className="px-1"><CornerDownLeft size={10} /></Kbd> Open</span>
            <span className="hidden sm:flex items-center gap-1.5"><Kbd className="px-1.5">Esc</Kbd> Close</span>
          </div>
          <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
            <Kbd className="px-1.5">{MODIFIER_LABEL}</Kbd><Kbd>K</Kbd>
          </span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
