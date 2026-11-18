import { useMemo } from 'react';
import { Customer } from '../types';
import { parsePhone, samePhone, ParsedPhone } from './phoneUtils';
import { searchCustomers, CustomerMatch } from './customerSearch';

export interface CustomerLookup {
  /** how the typed number reads: empty / incomplete / valid / invalid (+ the reason) */
  phone: ParsedPhone;
  /** the existing customer that owns this EXACT number (any spelling), only for a complete valid number */
  existing: Customer | null;
  /** customers whose number starts like the incomplete number being typed (never for a complete number) */
  phoneMatches: CustomerMatch<Customer>[];
  /** existing / similar names for the name being typed — close spellings are labelled suggestions */
  nameMatches: CustomerMatch<Customer>[];
}

/**
 * The ONE live lookup every customer-creation form uses while the user types a name or a mobile number.
 * Pure and client-side on the list the screen already holds (no API call per keystroke). The server repeats the
 * duplicate check on save, so a stale list can never create a second client.
 */
export const lookupCustomers = (customers: readonly Customer[] | undefined, name: string, phoneInput: string, ignoreId?: string): CustomerLookup => {
  const list = (customers || []).filter(c => c && c.id !== ignoreId);
  const phone = parsePhone(phoneInput);
  const existing = phone.status === 'valid' ? (list.find(c => c.phone && samePhone(c.phone, phone.canonical)) || null) : null;
  const digits = String(phoneInput || '').replace(/\D/g, '');
  const phoneMatches = phone.status === 'incomplete' && digits.length >= 3
    ? searchCustomers(list, String(phoneInput), { limit: 5, fuzzy: false, minDigits: 3 }) : [];
  const q = String(name || '').trim();
  const nameMatches = q.length >= 2
    ? searchCustomers(list, q, { limit: 5, fuzzy: true, fuzzyLimit: 3 }).filter(m => m.customer.id !== existing?.id) : [];
  return { phone, existing, phoneMatches, nameMatches };
};

export const useCustomerLookup = (customers: readonly Customer[] | undefined, name: string, phoneInput: string, ignoreId?: string): CustomerLookup =>
  useMemo(() => lookupCustomers(customers, name, phoneInput, ignoreId), [customers, name, phoneInput, ignoreId]);
