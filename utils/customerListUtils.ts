// Pure helpers for the Clients list: sorting, A–Z bucketing and page windows.
// Kept free of React/DOM so they can be unit-tested directly.
//
// Order of operations in the Clients page is always:
//   complete customer dataset -> search/filter -> sort -> paginate
// Nothing in here mutates its input, and nothing here creates, stores or
// changes a customer grouping field — letters are derived on the fly from the
// name purely to drive the visual navigation rail.

export type ClientSortKey = 'name-asc' | 'name-desc' | 'newest' | 'oldest';

export const CLIENT_SORT_OPTIONS: { value: ClientSortKey; label: string }[] = [
  { value: 'name-asc', label: 'Name: A–Z' },
  { value: 'name-desc', label: 'Name: Z–A' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

export const CLIENT_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_CLIENT_PAGE_SIZE = 25;

export const ALPHABET: string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/** '#' catches digits, punctuation, blank names and non-Latin scripts (e.g. Arabic). */
export const RAIL_LETTERS: string[] = [...ALPHABET, '#'];

interface SortableCustomer {
  id?: string;
  name?: string | null;
  createdAt?: string | null;
}

// Locale-aware, case/accent-insensitive, digit-aware ("Unit 2" < "Unit 10").
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const cleanName = (c: SortableCustomer): string =>
  typeof c?.name === 'string' ? c.name.trim() : '';

const compareIds = (a: SortableCustomer, b: SortableCustomer): number =>
  collator.compare(String(a?.id ?? ''), String(b?.id ?? ''));

/** First letter used by the navigation rail: 'A'–'Z', or '#' for anything else. */
export function getNameLetter(name?: string | null): string {
  const t = (name || '').trim();
  if (!t) return '#';
  // Strip diacritics so "Émile" files under E, then test for a plain Latin letter.
  const first = t.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' && first.length === 1 ? first : '#';
}

function compareByName(a: SortableCustomer, b: SortableCustomer, dir: 1 | -1): number {
  const an = cleanName(a);
  const bn = cleanName(b);
  // Blank names always go last, in both directions, so they never hide real ones.
  if (!an && bn) return 1;
  if (an && !bn) return -1;
  if (an && bn) {
    const r = collator.compare(an, bn);
    if (r !== 0) return r * dir;
  }
  return compareIds(a, b); // deterministic tie-breaker
}

/** Milliseconds for a usable createdAt, otherwise null (never invented). */
export function createdAtMs(c: SortableCustomer): number | null {
  const v = c?.createdAt;
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function compareByCreated(a: SortableCustomer, b: SortableCustomer, newestFirst: boolean): number {
  const at = createdAtMs(a);
  const bt = createdAtMs(b);
  // Customers with no usable date always go last, in both directions.
  if (at === null && bt !== null) return 1;
  if (at !== null && bt === null) return -1;
  if (at === null && bt === null) return compareByName(a, b, 1);
  if (at !== bt) return newestFirst ? (bt as number) - (at as number) : (at as number) - (bt as number);
  // Same timestamp: customer IDs are sequential, so follow the sort direction.
  const r = compareIds(a, b);
  return newestFirst ? -r : r;
}

/** Returns a NEW sorted array; the input (shared app state) is never mutated. */
export function sortCustomers<T extends SortableCustomer>(list: readonly T[], key: ClientSortKey): T[] {
  const copy = list.slice();
  switch (key) {
    case 'name-desc': return copy.sort((a, b) => compareByName(a, b, -1));
    case 'newest':    return copy.sort((a, b) => compareByCreated(a, b, true));
    case 'oldest':    return copy.sort((a, b) => compareByCreated(a, b, false));
    case 'name-asc':
    default:          return copy.sort((a, b) => compareByName(a, b, 1));
  }
}

/** Index (in the full sorted list) of the first customer for each rail letter. */
export function buildLetterIndex<T extends SortableCustomer>(sorted: readonly T[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const l = getNameLetter(sorted[i].name);
    if (!map.has(l)) map.set(l, i);
  }
  return map;
}

export const clampPage = (page: number, total: number, pageSize: number): number => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
};

/** Compact page list, e.g. [1,'gap',4,5,6,'gap',14]. */
export function getPageItems(current: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const set = new Set<number>([1, totalPages, current - 1, current, current + 1]);
  if (current <= 3) { set.add(2); set.add(3); set.add(4); }
  if (current >= totalPages - 2) { set.add(totalPages - 1); set.add(totalPages - 2); set.add(totalPages - 3); }
  const pages = [...set].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}
