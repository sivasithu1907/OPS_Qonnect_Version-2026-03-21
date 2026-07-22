import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, SearchX } from 'lucide-react';
import { CommandItem, searchCommands, IS_APPLE_PLATFORM } from './commandRegistry';

// ─────────────────────────────────────────────────────────────────────────────
// Command Palette (Sprint 2.1) — global "search or jump to" dialog.
//
// Lazy-loaded; mounted only while open. Pure navigation/action layer: it only
// ever calls `onSelect` with a registry command — all routing, permission and
// creation logic stays where it already lives (App.tsx + existing modules).
//
// Accessibility: dialog + combobox/listbox pattern. Focus stays on the search
// input (a real focus trap for the whole dialog); ArrowUp/Down move the active
// option via aria-activedescendant, Tab/Shift+Tab also cycle options so focus
// can never escape the dialog, Enter executes, Escape closes. The selected row
// is indicated by background + accent bar + an explicit ↵ hint, not colour
// alone. Focus restoration after close is handled by the opener (App.tsx).
// ─────────────────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  onClose: () => void;
  /** Commands already filtered to the current user's role (registry order). */
  commands: CommandItem[];
  /** Recent view ids, most recent first, current page already excluded. */
  recentViews: string[];
  onSelect: (command: CommandItem) => void;
}

interface Section {
  heading: string;
  items: CommandItem[];
}

const MODIFIER_LABEL = IS_APPLE_PLATFORM ? '⌘' : 'Ctrl';

const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <kbd className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[5px] border border-slate-200 bg-white text-[10px] font-semibold text-slate-500 leading-none ${className}`}>
    {children}
  </kbd>
);

const CommandPalette: React.FC<CommandPaletteProps> = ({ onClose, commands, recentViews, onSelect }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Build sections ────────────────────────────────────────────────────────
  const sections: Section[] = useMemo(() => {
    const trimmed = query.trim();

    if (trimmed) {
      const results = searchCommands(commands, trimmed);
      return results.length ? [{ heading: 'Results', items: results }] : [];
    }

    // Empty query → Recent / Quick Actions / Navigation
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
  }, [query, commands, recentViews]);

  // Flat list in render order — drives keyboard selection indices.
  const flatItems = useMemo(() => sections.flatMap(s => s.items), [sections]);

  // ── Selection stability ───────────────────────────────────────────────────
  // Reset to the first result whenever the query changes (predictable), and
  // clamp if the list shrinks for any other reason.
  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => {
    setSelectedIndex(prev => (flatItems.length === 0 ? 0 : Math.min(prev, flatItems.length - 1)));
  }, [flatItems.length]);

  // Autofocus the search input on open.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keep the selected row visible while navigating.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#qp-option-${selectedIndex}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const moveSelection = (delta: 1 | -1) => {
    if (flatItems.length === 0) return;
    setSelectedIndex(prev => (prev + delta + flatItems.length) % flatItems.length);
  };

  const executeSelected = () => {
    const cmd = flatItems[selectedIndex];
    if (cmd) onSelect(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1);
        break;
      case 'Tab':
        // Keep focus inside the dialog; Tab walks the options like the arrows
        // so keyboard users are never trapped without movement.
        e.preventDefault();
        moveSelection(e.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        e.preventDefault();
        executeSelected();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      default:
        break;
    }
  };

  // Running index across sections so option ids/selection line up with flatItems.
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
        {/* ── Search input row ── */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={flatItems.length > 0}
            aria-controls="qp-listbox"
            aria-activedescendant={flatItems.length > 0 ? `qp-option-${selectedIndex}` : undefined}
            aria-label="Search pages and actions"
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

        {/* ── Results ── */}
        <div
          ref={listRef}
          id="qp-listbox"
          role="listbox"
          aria-label="Commands"
          className="flex-1 overflow-y-auto custom-scrollbar max-h-[min(56vh,420px)] py-1.5"
        >
          {sections.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-10 px-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                <SearchX size={18} className="text-slate-400" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                No results for “{query.trim()}”
              </p>
              <p className="text-xs text-slate-400 max-w-[320px]">
                Try a page name like “Tickets” or “Clients”, or a shortcut like “SAR”.
              </p>
            </div>
          ) : (
            sections.map(section => (
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
                    return (
                      <button
                        key={`${section.heading}:${item.id}`}
                        type="button"
                        id={`qp-option-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={-1}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => onSelect(item)}
                        className={`qp-row relative w-full flex items-center gap-3 rounded-lg pl-3.5 pr-3 py-2.5 min-h-[44px] text-left transition-colors duration-100 ${
                          isSelected ? 'bg-[#FFCC00]/[0.12]' : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* Accent bar — same motif as the sidebar's active item, so
                            selection never relies on the tint alone. */}
                        {isSelected && (
                          <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-[#FFCC00]" />
                        )}
                        <span
                          aria-hidden="true"
                          className={`shrink-0 flex items-center justify-center transition-colors duration-100 ${
                            isSelected ? 'text-[#B8860B]' : 'text-slate-400'
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span className={`flex-1 min-w-0 truncate text-sm tracking-[-0.01em] ${
                          isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                        }`}>
                          {item.label}
                        </span>
                        <span className="shrink-0 flex items-center gap-2">
                          <span className="hidden sm:block text-[11px] font-medium text-slate-400">
                            {item.contextLabel}
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
            ))
          )}
        </div>

        {/* ── Footer hints ── */}
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
