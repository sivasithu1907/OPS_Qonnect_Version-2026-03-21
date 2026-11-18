import React from 'react';
import { Customer } from '../../types';
import { formatPhoneDisplay } from '../../utils/phoneUtils';
import { CustomerMatch, MATCH_LABEL } from '../../utils/customerSearch';
import { getCustomerMapUrl } from '../../utils/mapsUrl';

/**
 * Rows of customer search results — one compact look for every picker.
 *  • name (up to two lines, full name in the tooltip) and the number in the standard +974 XXXX XXXX format;
 *  • an exact match is marked green, a close-spelling result is marked amber "Similar name — suggestion";
 *  • rows are real buttons: Tab / Shift+Tab, ArrowUp / ArrowDown / Home / End, Enter / Space; 44px touch rows on touch screens.
 * Picking a row only reports the customer — nothing is selected, renamed or merged by merely listing it.
 */
const CustomerMatchList: React.FC<{
  matches: CustomerMatch<Customer>[];
  onPick: (c: Customer) => void;
  dense?: boolean;
  testId?: string;
  label?: string;
}> = ({ matches, onPick, dense = false, testId = 'customer-matches', label = 'Matching clients' }) => {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const rows = Array.from(e.currentTarget.querySelectorAll('button[data-customer-id]')) as HTMLButtonElement[];
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
    e.preventDefault(); rows[next].focus();
  };
  return (
    <div data-testid={testId} role="group" aria-label={label} onKeyDown={onKeyDown}>
      {matches.map(m => {
        const c = m.customer;
        const fuzzy = m.kind === 'fuzzy';
        const exact = m.kind === 'phone-exact' || m.kind === 'name-exact';
        const phone = formatPhoneDisplay(c.phone) || 'No phone';
        return (
          <button
            key={c.id}
            type="button"
            data-customer-id={c.id}
            data-match-kind={m.kind}
            title={`${c.name} · ${phone}`}
            onClick={() => onPick(c)}
            className={`qn-match-row w-full text-left ${dense ? 'px-2.5 py-1.5' : 'px-3 py-2'} min-h-[2.5rem] hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-500 border-b border-slate-100 last:border-0 flex items-center gap-2 border-l-2 ${fuzzy ? 'bg-amber-50/50 border-l-amber-400' : exact ? 'border-l-emerald-500' : 'border-l-transparent'}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900 leading-snug line-clamp-2 break-words">{c.name}</span>
              <span className="block text-xs text-slate-500 font-mono leading-snug truncate">
                {phone}
                {!getCustomerMapUrl(c) && <span className="ml-2 font-sans text-amber-600">Location missing</span>}
              </span>
            </span>
            {exact && <span className="shrink-0 text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">{MATCH_LABEL[m.kind]}</span>}
            {fuzzy && <span data-testid="fuzzy-badge" className="shrink-0 max-w-[7.5rem] text-[10px] font-bold leading-tight text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">{MATCH_LABEL[m.kind]}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default CustomerMatchList;
