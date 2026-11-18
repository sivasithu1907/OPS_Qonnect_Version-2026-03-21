// Google Maps URL validation + safe display helpers. Pure functions, no network access: a short link is accepted by its
// shape and is NEVER resolved or fetched (that would be an outbound request from the browser/server for every save).
// The same rules are implemented in backend/customers.js (`validateGoogleMapsUrl`) — keep both in step (tests compare them).

export interface MapsUrlResult { ok: boolean; url?: string; kind?: 'full' | 'short'; error?: string }

const MAX_LEN = 2048;
const COUNTRY = '(?:com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})';
const FULL_HOST = new RegExp(`^(?:www\\.|maps\\.)?google\\.${COUNTRY}$`);
const MAPS_SUBDOMAIN_HOST = new RegExp(`^maps\\.google\\.${COUNTRY}$`);

export const validateGoogleMapsUrl = (raw: unknown): MapsUrlResult => {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: 'Google Maps URL is required.' };
  if (s.length > MAX_LEN) return { ok: false, error: 'The URL is too long.' };
  if (/[\s\u0000-\u001f\u007f<>"'`\\]/.test(s)) return { ok: false, error: 'The URL contains spaces or unsafe characters.' };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: 'Enter a full link starting with https://' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Only http(s) links are allowed.' };
  if (u.username || u.password) return { ok: false, error: 'The URL must not contain a user name or password.' };
  if (u.port) return { ok: false, error: 'The URL must not contain a port number.' };
  const host = u.hostname.toLowerCase();
  if (host.includes('xn--') || !/^[a-z0-9.-]+$/.test(host)) return { ok: false, error: 'Not a Google Maps link.' };
  const path = u.pathname;
  // Short links: maps.app.goo.gl/<id>, goo.gl/maps/<id>
  if (host === 'maps.app.goo.gl') {
    return /^\/[A-Za-z0-9_-]{4,}\/?$/.test(path) ? { ok: true, url: s, kind: 'short' } : { ok: false, error: 'Incomplete Google Maps short link.' };
  }
  if (host === 'goo.gl' || host === 'www.goo.gl') {
    return /^\/maps\/[A-Za-z0-9_-]{4,}\/?$/.test(path) ? { ok: true, url: s, kind: 'short' } : { ok: false, error: 'Incomplete Google Maps short link.' };
  }
  // Full links: https://www.google.com/maps/..., https://maps.google.com/?q=..., https://google.com.qa/maps?...
  if (FULL_HOST.test(host)) {
    const isMapsHost = MAPS_SUBDOMAIN_HOST.test(host);
    if (isMapsHost || path === '/maps' || path.startsWith('/maps/')) return { ok: true, url: s, kind: 'full' };
    return { ok: false, error: 'This Google link is not a Maps link (it should contain /maps).' };
  }
  return { ok: false, error: 'Only Google Maps links are accepted (google.com/maps, maps.app.goo.gl).' };
};

/** Any http(s) URL that is safe to render as a link (used for historical data that is not a Google Maps link). */
export const isSafeHttpUrl = (raw: unknown): boolean => {
  const s = String(raw ?? '').trim();
  if (!s || s.length > MAX_LEN || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(s)) return false;
  try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password; } catch { return false; }
};

/** The saved location link of a customer (the `address` field holds the location URL; very old records kept it in buildingNumber). '' = none. */
export const getCustomerMapUrl = (c: { address?: string | null; buildingNumber?: string | null } | null | undefined): string => {
  if (!c) return '';
  const a = String(c.address ?? '').trim();
  if (isSafeHttpUrl(a)) return a;
  const b = String(c.buildingNumber ?? '').trim();
  if (isSafeHttpUrl(b)) return b;
  return '';
};

/** Building / villa text of a customer (never a URL). */
export const getCustomerBuilding = (c: { buildingNumber?: string | null } | null | undefined): string => {
  const b = String(c?.buildingNumber ?? '').trim();
  return b && !isSafeHttpUrl(b) && b !== 'N/A' ? b : '';
};
