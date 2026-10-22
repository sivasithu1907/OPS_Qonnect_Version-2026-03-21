import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CLIENT_PAGE_SIZES, RAIL_LETTERS, getPageItems } from '../../utils/customerListUtils';

// ───────────────────────── Pagination bar ─────────────────────────
// Rendered both above and below the Clients list. Presentational only: all
// state lives in CustomerRecords.

interface PaginationBarProps {
  position: 'top' | 'bottom';
  total: number;            // clients matching the current search (all pages)
  totalAll: number;         // every client loaded (to say "filtered from N")
  page: number;             // already clamped, 1-based
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const navBtn =
  'inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-lg border text-xs font-semibold transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ';

export const ClientPaginationBar: React.FC<PaginationBarProps> = ({
  position, total, totalAll, page, totalPages, pageSize, onPageChange, onPageSizeChange,
}) => {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const items = getPageItems(page, totalPages);
  const selectId = `client-page-size-${position}`;

  return (
    <div
      data-testid={`client-pagination-${position}`}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 bg-slate-50 ${
        position === 'top' ? 'border-b' : 'border-t'
      } border-slate-100`}
    >
      <p
        className="text-xs text-slate-500"
        data-testid={`client-range-${position}`}
        aria-live={position === 'top' ? 'polite' : undefined}
      >
        Showing <span className="font-semibold text-slate-700">{start}–{end}</span> of{' '}
        <span className="font-semibold text-slate-700">{total}</span> {total === 1 ? 'client' : 'clients'}
        {total !== totalAll && <span className="text-slate-400"> (filtered from {totalAll})</span>}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={selectId} className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="hidden sm:inline">Per page</span>
          <select
            id={selectId}
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            aria-label="Clients per page"
            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            {CLIENT_PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <nav aria-label={`Clients pagination (${position})`} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className={`${navBtn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white`}
          >
            <ChevronLeft size={14} />
            <span className="hidden sm:inline ml-0.5">Previous</span>
          </button>

          {/* Compact numbered navigation (wide screens) */}
          <div className="hidden sm:flex items-center gap-1">
            {items.map((it, i) =>
              it === 'gap' ? (
                <span key={`gap-${i}`} className="px-1 text-xs text-slate-400" aria-hidden="true">…</span>
              ) : (
                <button
                  key={it}
                  type="button"
                  onClick={() => onPageChange(it)}
                  aria-label={`Page ${it}`}
                  aria-current={it === page ? 'page' : undefined}
                  className={`${navBtn} ${
                    it === page
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {it}
                </button>
              )
            )}
          </div>

          {/* Phone-sized: one compact "Page x / y" label instead of the numbers */}
          <span className="sm:hidden px-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
            {page} / {totalPages}
          </span>

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
            className={`${navBtn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white`}
          >
            <span className="hidden sm:inline mr-0.5">Next</span>
            <ChevronRight size={14} />
          </button>
        </nav>
      </div>
    </div>
  );
};

// ───────────────────────── Alphabet navigation ─────────────────────────
// A visual navigation aid only. Letters are derived from customer names on
// the fly; no grouping/category data is created or stored anywhere.

interface RailProps {
  activeLetter: string;
  available: ReadonlySet<string>;
  onSelect: (letter: string) => void;
}

const letterLabel = (l: string) =>
  l === '#'
    ? 'Jump to clients starting with a number, symbol or non-Latin letter'
    : `Jump to clients starting with ${l}`;

/** Slim vertical rail, desktop. Sticky inside the page scroller, beside (not over) the list card. */
export const AlphabetRail: React.FC<RailProps> = ({ activeLetter, available, onSelect }) => (
  <nav
    aria-label="Alphabet navigation"
    data-testid="alphabet-rail"
    className="sticky top-4 shrink-0 w-7 flex flex-col items-center select-none"
    // Height leaves room under the rail for the fixed floating chat button
    // (bottom-6, 56px tall) even before the page has been scrolled, when the
    // rail starts ~11rem below the top of the scroller.
    style={{ height: 'clamp(360px, calc(100vh - 17.5rem), 620px)' }}
  >
    {/* Subtle current-letter indicator */}
    <div
      data-testid="alphabet-current"
      aria-hidden="true"
      className="mb-1 w-7 h-7 shrink-0 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center justify-center shadow-sm"
    >
      {activeLetter || '–'}
    </div>
    <ul className="flex-1 w-full flex flex-col justify-between items-center rounded-full bg-white border border-slate-200 py-1 shadow-sm">
      {RAIL_LETTERS.map(l => {
        const enabled = available.has(l);
        const active = l === activeLetter;
        return (
          <li key={l} className="flex-1 min-h-0 flex items-center">
            <button
              type="button"
              data-letter={l}
              disabled={!enabled}
              onClick={() => onSelect(l)}
              aria-label={letterLabel(l)}
              aria-current={active ? 'true' : undefined}
              title={enabled ? letterLabel(l) : undefined}
              className={`w-5 h-full max-h-[1.05rem] min-h-0 leading-none rounded text-[10px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                active
                  ? 'bg-emerald-500 text-white'
                  : enabled
                    ? 'text-slate-600 hover:bg-slate-100'
                    : 'text-slate-300 cursor-default'
              }`}
            >
              {l}
            </button>
          </li>
        );
      })}
    </ul>
  </nav>
);

/** Compact horizontal alternative for phones: a scrollable letter strip. */
export const AlphabetStrip: React.FC<RailProps> = ({ activeLetter, available, onSelect }) => {
  const scrollerRef = useRef<HTMLUListElement>(null);

  // Keep the active letter visible inside the strip WITHOUT scrolling the page.
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc || !activeLetter) return;
    const btn = sc.querySelector<HTMLElement>(`[data-letter="${activeLetter === '#' ? '#' : activeLetter}"]`);
    if (!btn) return;
    const target = btn.offsetLeft - sc.clientWidth / 2 + btn.offsetWidth / 2;
    sc.scrollLeft = Math.max(0, target);
  }, [activeLetter]);

  return (
    <nav
      aria-label="Alphabet navigation"
      data-testid="alphabet-strip"
      className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-slate-100"
    >
      <ul ref={scrollerRef} className="flex gap-1 overflow-x-auto no-scrollbar">
        {RAIL_LETTERS.map(l => {
          const enabled = available.has(l);
          const active = l === activeLetter;
          return (
            <li key={l} className="shrink-0">
              <button
                type="button"
                data-letter={l}
                disabled={!enabled}
                onClick={() => onSelect(l)}
                aria-label={letterLabel(l)}
                aria-current={active ? 'true' : undefined}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  active
                    ? 'bg-slate-900 text-white'
                    : enabled
                      ? 'bg-slate-100 text-slate-700 active:bg-slate-200'
                      : 'bg-transparent text-slate-300'
                }`}
              >
                {l}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
