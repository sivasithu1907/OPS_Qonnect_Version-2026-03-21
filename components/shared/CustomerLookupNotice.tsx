import React from 'react';
import { AlertCircle, CheckCircle2, UserCheck } from 'lucide-react';
import { Customer } from '../../types';
import { formatPhoneDisplay } from '../../utils/phoneUtils';
import { CustomerLookup } from '../../utils/useCustomerLookup';
import { getCustomerBuilding, getCustomerMapUrl } from '../../utils/mapsUrl';
import CustomerMatchList from './CustomerMatchList';

/**
 * What every customer-creation form shows under the mobile-number field, while the user types:
 *  • a validation message for a number that cannot be right (e.g. 9 local digits) — never silently altered;
 *  • "Will be saved as +974 5000 0001" for a valid number;
 *  • a clear "already registered" warning naming the existing customer, with "Use Existing Customer" where the
 *    workflow can select one (or "Open existing client" in the Clients module).
 * `prefix` namespaces the data-testid values used by the regression tests.
 */
export const PhoneLookupNotice: React.FC<{
  lookup: CustomerLookup;
  prefix: string;
  onUseExisting?: (c: Customer) => void;
  useLabel?: string;
  /** override the data-testid of the "use existing" button */
  useTestId?: string;
  /** override the data-testid of the "already registered" box */
  rootTestId?: string;
  dense?: boolean;
}> = ({ lookup, prefix, onUseExisting, useLabel = 'Use Existing Customer', useTestId, rootTestId, dense = false }) => {
  const { phone, existing } = lookup;
  if (existing) {
    const building = getCustomerBuilding(existing);
    return (
      <div data-testid={rootTestId || `${prefix}-duplicate`} role="alert" className={`mt-1.5 ${dense ? 'p-2' : 'p-3'} rounded-lg border border-amber-300 bg-amber-50 text-amber-900`}>
        <div className="flex items-start gap-2">
          <AlertCircle size={dense ? 14 : 16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold">This mobile number is already registered.</div>
            <div className="text-xs mt-0.5">
              <span data-testid={`${prefix}-duplicate-name`} className="font-bold">{existing.name}</span>
              {' · '}<span data-testid={`${prefix}-duplicate-phone`} className="font-mono">{formatPhoneDisplay(existing.phone)}</span>
              {building ? <span className="text-amber-700"> · {building}</span> : null}
              {!getCustomerMapUrl(existing) && <span className="text-amber-700"> · Location missing</span>}
            </div>
            {onUseExisting && (
              <button type="button" data-testid={useTestId || `${prefix}-use-existing`} onClick={() => onUseExisting(existing)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700">
                <UserCheck size={12} /> {useLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (phone.status === 'invalid') {
    return <p data-testid={`${prefix}-phone-error`} role="alert" className="mt-1 text-xs text-red-600">{phone.error}</p>;
  }
  if (phone.status === 'valid') {
    return (
      <p data-testid={`${prefix}-phone-ok`} className="mt-1 text-xs text-emerald-700 flex items-center gap-1">
        <CheckCircle2 size={12} /> Will be saved as <span className="font-mono font-semibold">{formatPhoneDisplay(phone.canonical)}</span>
      </p>
    );
  }
  return null;
};

/** Existing customers whose number starts like the incomplete number being typed + similar names (labelled suggestions). */
export const CustomerSuggestions: React.FC<{
  lookup: CustomerLookup;
  prefix: string;
  onPick: (c: Customer) => void;
  /** which part of the lookup to show */
  show?: 'name' | 'phone' | 'both';
  heading?: string;
}> = ({ lookup, prefix, onPick, show = 'both', heading = 'Existing clients — suggestions, not matched automatically' }) => {
  const matches = [
    ...(show !== 'name' ? lookup.phoneMatches : []),
    ...(show !== 'phone' ? lookup.nameMatches : []),
  ].filter((m, i, a) => a.findIndex(x => x.customer.id === m.customer.id) === i);
  if (!matches.length) return null;
  return (
    <div data-testid={`${prefix}-suggestions`} className="mt-1.5 bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] font-semibold uppercase text-slate-500">{heading}</div>
      <CustomerMatchList matches={matches} onPick={onPick} dense testId={`${prefix}-suggestion-list`} />
    </div>
  );
};
