import React from 'react';
import { Customer } from '../../types';
import { formatPhoneDisplay } from '../../utils/phoneUtils';
import { CustomerMatch, MATCH_LABEL } from '../../utils/customerSearch';
import { getCustomerMapUrl } from '../../utils/mapsUrl';

/** Rows of customer search results — one look for every picker. Close-spelling results are clearly marked as suggestions. */
const CustomerMatchList: React.FC<{
  matches: CustomerMatch<Customer>[];
  onPick: (c: Customer) => void;
  dense?: boolean;
  testId?: string;
}> = ({ matches, onPick, dense = false, testId = 'customer-matches' }) => (
  <div data-testid={testId}>
    {matches.map(m => {
      const c = m.customer;
      const fuzzy = m.kind === 'fuzzy';
      return (
        <button
          key={c.id}
          type="button"
          data-customer-id={c.id}
          data-match-kind={m.kind}
          onClick={() => onPick(c)}
          className={`w-full text-left ${dense ? 'p-2.5' : 'p-3'} hover:bg-slate-50 border-b border-slate-100 last:border-0 flex flex-col ${fuzzy ? 'bg-amber-50/40' : ''}`}
        >
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{c.name}</span>
            {m.kind === 'phone-exact' && <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5">{MATCH_LABEL[m.kind]}</span>}
            {m.kind === 'name-exact' && <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5">{MATCH_LABEL[m.kind]}</span>}
            {fuzzy && <span data-testid="fuzzy-badge" className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5">{MATCH_LABEL[m.kind]}</span>}
          </span>
          <span className="text-xs text-slate-500 font-mono mt-0.5">
            {formatPhoneDisplay(c.phone) || 'No phone'}
            {!getCustomerMapUrl(c) && <span className="ml-2 font-sans text-amber-600">Location missing</span>}
          </span>
        </button>
      );
    })}
  </div>
);

export default CustomerMatchList;
