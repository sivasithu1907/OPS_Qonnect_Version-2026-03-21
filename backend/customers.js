// Customer helpers shared by every route that can create or match a customer.
//   • phoneKey — ONE definition of "the same mobile number" (mirrors utils/phoneUtils.ts `phoneKey`; tests compare both)
//   • race-safe duplicate prevention (transaction-scoped advisory lock per phone key)
//   • Google Maps URL validation (mirrors utils/mapsUrl.ts `validateGoogleMapsUrl`)

/** Comparison key: 50000001 = +974 5000 0001 = 97450000001 = 0097450000001 → "97450000001". '' when there are no digits. */
export const phoneKey = (input) => {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+') || s.startsWith('(+');
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  if (!hasPlus && d.startsWith('00')) d = d.slice(2);
  else if (!hasPlus && d.length === 8) d = '974' + d;
  return d;
};

/** Value stored in customers.phone: "+<key>" for Qatar numbers and anything written with a "+"/"00"; other digit strings are stored as typed (digits only). */
export const canonicalPhone = (input) => {
  const s = String(input ?? '').trim();
  const key = phoneKey(s);
  if (!key) return null;
  const international = s.startsWith('+') || s.startsWith('(+') || s.replace(/\D/g, '').startsWith('00') || s.replace(/\D/g, '').length === 8 || key.startsWith('974');
  return international ? '+' + key : key;
};

/** SQL expression computing the same key from a stored phone column. */
export const phoneKeySql = (col) => {
  const digits = `regexp_replace(${col}, '[^0-9]', '', 'g')`;
  return `(CASE
    WHEN ltrim(${col}) LIKE '+%' OR ltrim(${col}) LIKE '(+%' THEN ${digits}
    WHEN ${digits} LIKE '00%' THEN substr(${digits}, 3)
    WHEN length(${digits}) = 8 THEN '974' || ${digits}
    ELSE ${digits} END)`;
};

/** Finds a customer whose phone is the same number (any format). `db` = pool or a transaction client. `exceptId` skips one row. */
export const findCustomerByPhone = async (db, rawPhone, exceptId = null) => {
  const key = phoneKey(rawPhone);
  if (!key) return null;
  const { rows } = await db.query(
    `SELECT * FROM customers WHERE phone IS NOT NULL AND phone <> '' AND ${phoneKeySql('phone')} = $1 ${exceptId ? 'AND id <> $2' : ''} ORDER BY created_at NULLS LAST, id LIMIT 1`,
    exceptId ? [key, exceptId] : [key]
  );
  return rows[0] || null;
};

/** Serialises concurrent creations/edits of the SAME number (released automatically at COMMIT/ROLLBACK). Call inside a transaction. */
export const lockCustomerPhone = async (client, rawPhone) => {
  const key = phoneKey(rawPhone);
  if (key) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['customer-phone:' + key]);
  return key;
};

/** Runs fn(client, existingCustomerOrNull) in one transaction holding the phone lock. */
export const withCustomerPhoneLock = async (pool, rawPhone, fn, exceptId = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockCustomerPhone(client, rawPhone);
    const existing = await findCustomerByPhone(client, rawPhone, exceptId);
    const out = await fn(client, existing);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
};

/** What the UI may show about a customer that already owns a number. */
export const customerSummary = (r) => ({
  id: r.id, name: r.name, phone: r.phone || '', buildingNumber: r.building_number || '', address: r.address || '',
});

// ── Google Maps URL ─────────────────────────────────────────────────────────
const MAX_LEN = 2048;
const COUNTRY = '(?:com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})';
const FULL_HOST = new RegExp(`^(?:www\\.|maps\\.)?google\\.${COUNTRY}$`);
const MAPS_SUBDOMAIN_HOST = new RegExp(`^maps\\.google\\.${COUNTRY}$`);

export const validateGoogleMapsUrl = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: 'Google Maps URL is required.' };
  if (s.length > MAX_LEN) return { ok: false, error: 'The URL is too long.' };
  if (/[\s\u0000-\u001f\u007f<>"'`\\]/.test(s)) return { ok: false, error: 'The URL contains spaces or unsafe characters.' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'Enter a full link starting with https://' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Only http(s) links are allowed.' };
  if (u.username || u.password) return { ok: false, error: 'The URL must not contain a user name or password.' };
  if (u.port) return { ok: false, error: 'The URL must not contain a port number.' };
  const host = u.hostname.toLowerCase();
  if (host.includes('xn--') || !/^[a-z0-9.-]+$/.test(host)) return { ok: false, error: 'Not a Google Maps link.' };
  const path = u.pathname;
  if (host === 'maps.app.goo.gl') return /^\/[A-Za-z0-9_-]{4,}\/?$/.test(path) ? { ok: true, url: s, kind: 'short' } : { ok: false, error: 'Incomplete Google Maps short link.' };
  if (host === 'goo.gl' || host === 'www.goo.gl') return /^\/maps\/[A-Za-z0-9_-]{4,}\/?$/.test(path) ? { ok: true, url: s, kind: 'short' } : { ok: false, error: 'Incomplete Google Maps short link.' };
  if (FULL_HOST.test(host)) {
    if (MAPS_SUBDOMAIN_HOST.test(host) || path === '/maps' || path.startsWith('/maps/')) return { ok: true, url: s, kind: 'full' };
    return { ok: false, error: 'This Google link is not a Maps link (it should contain /maps).' };
  }
  return { ok: false, error: 'Only Google Maps links are accepted (google.com/maps, maps.app.goo.gl).' };
};

/** Location text that must never be stored: script / data / file URLs. Plain text and normal http(s) links pass. */
export const hasUnsafeScheme = (raw) => /^\s*(javascript|data|vbscript|file|blob):/i.test(String(raw ?? ''));
