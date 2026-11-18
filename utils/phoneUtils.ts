
/**
 * ONE definition of a customer phone number for the whole application (the backend mirrors it in backend/customers.js `parsePhone`;
 * a unit test runs both over the same corpus).
 *
 * Accepted (all are the same Qatar number, stored as "+97450000001", shown as "+974 5000 0001"):
 *   50000001 · 5000 0001 · +97450000001 · +974 50000001 · +974 5000 0001 · 97450000001 · 0097450000001
 * Qatar numbers have exactly 8 digits after 974. A bare number with any other length (e.g. 500000001 = 9 digits) is INVALID —
 * it is reported, never "fixed". A number written with "+" or "00" and another country code is a legitimate international
 * number and is kept exactly as written (digits only, 7–15 digits); the Qatar code is never added to it.
 */
export type PhoneStatus = 'empty' | 'incomplete' | 'valid' | 'invalid';
export interface ParsedPhone {
  status: PhoneStatus;
  kind: 'qatar' | 'international' | '';
  /** "+97450000001" when status is valid, otherwise ''. */
  canonical: string;
  /** comparison key (same as phoneKey). */
  key: string;
  error?: string;
}

const QATAR_HELP = 'Qatar mobile numbers have 8 digits, e.g. 5000 0001 or +974 5000 0001. For a number outside Qatar start with + and the country code.';

export const parsePhone = (input: unknown): ParsedPhone => {
  const s = String(input ?? '').trim();
  const key = phoneKey(s);
  const out = (status: PhoneStatus, extra: Partial<ParsedPhone> = {}): ParsedPhone => ({ status, kind: '', canonical: '', key, ...extra });
  if (!s) return out('empty');
  // only digits, spaces, dots, dashes, brackets and ONE leading "+" are allowed
  if (/[^\d\s+().\-]/.test(s) || /\+/.test(s.replace(/^\(?\+/, ''))) {
    return out('invalid', { error: 'Use digits only (spaces, dashes and a leading + are fine).' });
  }
  const hasPlus = /^\(?\+/.test(s);
  let d = s.replace(/\D/g, '');
  if (!d) return out('incomplete');
  const explicit = hasPlus || d.startsWith('00');
  if (!hasPlus && d.startsWith('00')) d = d.slice(2);
  const qatar = (digits: string): ParsedPhone => ({ status: 'valid', kind: 'qatar', canonical: '+' + digits, key: digits });

  if (explicit) {
    if (d.startsWith('974')) {
      const local = d.length - 3;
      if (local === 8) return qatar(d);
      if (local < 8) return out('incomplete');
      return out('invalid', { error: `A Qatar number has 8 digits after +974 (you entered ${local}).` });
    }
    if (d.startsWith('0')) return out('invalid', { error: 'A country code cannot start with 0.' });
    if (d.length > 15) return out('invalid', { error: 'An international number has at most 15 digits.' });
    if (d.length < 7) return out('incomplete');
    return { status: 'valid', kind: 'international', canonical: '+' + d, key: d };
  }
  // no "+" / "00": a Qatar number, written locally (8 digits) or with 974 (11 digits)
  if (d.length < 8) return out('incomplete');
  if (d.length === 8) return qatar('974' + d);
  if (d.startsWith('974')) {
    if (d.length === 11) return qatar(d);
    if (d.length < 11) return out('incomplete');
    return out('invalid', { error: `A Qatar number has 8 digits after 974 (you entered ${d.length - 3}).` });
  }
  return out('invalid', { error: `Qatar mobile numbers have 8 digits (you entered ${d.length}). For a number outside Qatar start with + and the country code.` });
};

/** The form value to STORE: "+97450000001" for every valid Qatar spelling; the digits with "+" for an international number. */
export const normalizePhone = (input: unknown): string => {
  const p = parsePhone(input);
  return p.status === 'valid' ? p.canonical : String(input ?? '').trim();
};

export const validatePhone = (input: unknown): { isValid: boolean; error?: string; formatted?: string } => {
  const p = parsePhone(input);
  if (p.status === 'valid') return { isValid: true, formatted: p.canonical };
  if (p.status === 'empty') return { isValid: false, error: 'Phone number is required.' };
  if (p.status === 'incomplete') return { isValid: false, error: `The phone number is incomplete. ${QATAR_HELP}` };
  return { isValid: false, error: p.error || 'Invalid phone number.' };
};

/** "+974 5000 0001" for any valid Qatar spelling (including numbers stored in an older format); everything else is shown as stored. */
export const formatPhoneDisplay = (input: unknown): string => {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const p = parsePhone(raw);
  if (p.status === 'valid' && p.kind === 'qatar') return `+974 ${p.canonical.slice(4, 8)} ${p.canonical.slice(8)}`;
  if (p.status === 'valid') return p.canonical;
  return raw;
};

/** `tel:` target for a stored/typed number: canonical when valid, otherwise exactly what is stored. */
export const phoneTel = (input: unknown): string => {
  const p = parsePhone(input);
  return p.status === 'valid' ? p.canonical : String(input ?? '').trim();
};

/**
 * Canonical COMPARISON key for a phone number — the same rule the backend uses (backend/customers.js `phoneKey`).
 * Two numbers are "the same mobile number" exactly when their keys are equal and non-empty.
 *
 *   50000001 · +974 5000 0001 · 97450000001 · 0097450000001 · (+974)5000-0001   → 97450000001
 *
 * Rules: digits only; a leading "+" means "international, as written"; a leading "00" is the international prefix;
 * a bare 8-digit number is a Qatar local number (country code 974 added). Anything else is compared digit-for-digit.
 * Never used for display or storage — only to decide whether two numbers are one number.
 */
export const phoneKey = (input: unknown): string => {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+') || s.startsWith('(+');
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  if (!hasPlus && d.startsWith('00')) d = d.slice(2);
  else if (!hasPlus && d.length === 8) d = '974' + d;
  return d;
};

/** True when both values are the same mobile number once normalised. */
export const samePhone = (a: unknown, b: unknown): boolean => {
  const ka = phoneKey(a);
  return ka !== '' && ka === phoneKey(b);
};
