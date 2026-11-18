// ONE customer-search implementation for every customer picker / search box in the app (Clients, Activity Planner,
// Tickets, Sales appointments, Team Lead and technician portals, command palette). It works on the customer list the
// screen already holds — it never calls the API.
//
// Ranking (best first):
//   1. exact mobile number      (any format: 50000001 = +974 5000 0001 = 97450000001)
//   2. exact name
//   3. partial name or partial mobile (starts-with ranks above contains)
//   4. close spelling ("fuzzy") — returned ONLY as a SUGGESTION; callers must label it and must never auto-select / merge it
import { phoneKey } from './phoneUtils';

export type MatchKind = 'phone-exact' | 'name-exact' | 'partial' | 'fuzzy';
export interface CustomerMatch<C> { customer: C; kind: MatchKind; score: number }
interface Searchable { id: string; name?: string | null; phone?: string | null; email?: string | null }
export interface SearchOptions { limit?: number; fuzzy?: boolean; fuzzyLimit?: number; includeEmail?: boolean; minDigits?: number }

const RANK: Record<MatchKind, number> = { 'phone-exact': 0, 'name-exact': 1, partial: 2, fuzzy: 3 };

/** lower-case, no accents, no punctuation, single spaces ("Abdullah  Al-Thani" → "abdullah al thani"). */
export const normalizeName = (s: unknown): string =>
  String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Optimal-string-alignment distance (insert / delete / substitute / swap two neighbours each cost 1). */
export const editDistance = (a: string, b: string, cap = 4): number => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length, n = b.length;
  let prev2: number[] = new Array(n + 1).fill(0);
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = new Array(n + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev2 = prev; prev = cur;
  }
  return prev[n];
};

// how many edits a token of this length may differ by and still count as "close"
const allowedEdits = (len: number): number => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

interface Prepared { name: string; tokens: string[]; key: string; email: string }
const cache = new WeakMap<object, { name: unknown; phone: unknown; email: unknown; p: Prepared }>();
const prepare = (c: Searchable): Prepared => {
  const hit = cache.get(c);
  if (hit && hit.name === c.name && hit.phone === c.phone && hit.email === c.email) return hit.p;
  const name = normalizeName(c.name);
  const p: Prepared = { name, tokens: name ? name.split(' ') : [], key: phoneKey(c.phone), email: String(c.email ?? '').toLowerCase() };
  cache.set(c, { name: c.name, phone: c.phone, email: c.email, p });
  return p;
};

/** distance of the query to a customer name (0 = identical), or null when not close. */
const fuzzyDistance = (qTokens: string[], name: Prepared): number | null => {
  if (!qTokens.length || !name.tokens.length) return null;
  let total = 0;
  for (const qt of qTokens) {
    if (qt.length < 3) return null;
    const allow = allowedEdits(qt.length);
    let best = Infinity;
    for (const nt of name.tokens) {
      const d = editDistance(qt, nt, allow);
      if (d < best) best = d;
      // typed-so-far: compare with the same-length beginning of a longer name token (abdhul → abdull…)
      if (nt.length > qt.length) { const d2 = editDistance(qt, nt.slice(0, qt.length), allow); if (d2 < best) best = d2; }
    }
    if (best > allow) return null;
    total += best;
  }
  return total;
};

export const searchCustomers = <C extends Searchable>(customers: readonly C[], query: string, opts: SearchOptions = {}): CustomerMatch<C>[] => {
  const { limit = 8, fuzzy = true, fuzzyLimit = 5, includeEmail = false, minDigits = 2 } = opts;
  const raw = String(query ?? '').trim();
  if (!raw || !customers?.length) return [];
  const qName = normalizeName(raw);
  const digits = raw.replace(/\D/g, '');
  const looksLikePhone = digits.length > 0 && digits.length >= raw.replace(/[\s+()\-.]/g, '').length * 0.8;
  const qKey = looksLikePhone ? phoneKey(raw) : '';
  const qTokens = qName ? qName.split(' ') : [];
  const lowerRaw = raw.toLowerCase();

  const strong: CustomerMatch<C>[] = [];
  const soft: CustomerMatch<C>[] = [];
  for (const c of customers) {
    const p = prepare(c);
    // 1. exact mobile (a complete number: 8 local digits, or 11+ with the country code)
    if (qKey && p.key && p.key === qKey && (digits.length >= 8)) { strong.push({ customer: c, kind: 'phone-exact', score: 0 }); continue; }
    // 2. exact name
    if (qName && p.name === qName) { strong.push({ customer: c, kind: 'name-exact', score: 0 }); continue; }
    // 3. partial
    let score = Infinity;
    if (qName && !looksLikePhone) {
      if (p.name.startsWith(qName)) score = 0;
      else if (p.tokens.some(t => t.startsWith(qName.split(' ')[0])) && qTokens.every(qt => p.tokens.some(t => t.startsWith(qt)))) score = 1;
      else if (p.name.includes(qName)) score = 2;
    }
    if (looksLikePhone && digits.length >= minDigits && p.key) {
      // the query may be typed with or without country code; compare digits as typed and as normalised
      const typed = digits;
      if (p.key.endsWith(typed) || p.key.endsWith(qKey || typed)) score = Math.min(score, 0.5);
      else if (p.key.includes(typed) || (qKey && p.key.includes(qKey))) score = Math.min(score, 3);
    }
    if (includeEmail && lowerRaw.length >= 2 && p.email && p.email.includes(lowerRaw)) score = Math.min(score, 4);
    if (score !== Infinity) { strong.push({ customer: c, kind: 'partial', score }); continue; }
    // 4. close spelling — names only, 4+ letters, never for phone-looking input
    if (fuzzy && !looksLikePhone && qName.replace(/ /g, '').length >= 4) {
      const d = fuzzyDistance(qTokens, p);
      if (d !== null) soft.push({ customer: c, kind: 'fuzzy', score: d });
    }
  }
  const byName = (a: CustomerMatch<C>, b: CustomerMatch<C>) => String(a.customer.name ?? '').localeCompare(String(b.customer.name ?? ''));
  strong.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.score - b.score || byName(a, b));
  soft.sort((a, b) => a.score - b.score || byName(a, b));
  return [...strong.slice(0, limit), ...soft.slice(0, fuzzyLimit)];
};

/** Plain list of customers for a query (best first), for components that just need an array. */
export const searchCustomerList = <C extends Searchable>(customers: readonly C[], query: string, opts?: SearchOptions): C[] =>
  searchCustomers(customers, query, opts).map(m => m.customer);

/** Strict (non-fuzzy) filter used by list screens: every exact or partial match, unlimited, in match order. */
export const filterCustomers = <C extends Searchable>(customers: readonly C[], query: string, includeEmail = true): C[] =>
  searchCustomers(customers, query, { limit: Number.MAX_SAFE_INTEGER, fuzzy: false, includeEmail, minDigits: 1 }).map(m => m.customer);

export const MATCH_LABEL: Record<MatchKind, string> = {
  'phone-exact': 'Exact mobile match',
  'name-exact': 'Exact name',
  partial: 'Match',
  fuzzy: 'Similar name — suggestion',
};
