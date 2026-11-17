// ─────────────────────────────────────────────────────────────────────────────
// Photo protection helpers (Batch 1 — QA-03)
//
// Root cause (Phase-1 audit): list endpoints return a lightweight placeholder
// (`photos: ['HAS_PHOTOS']`) instead of the real image data. The web app sent
// whole job objects back on routine updates (status change, reassignment …),
// and the server wrote whatever `photos` value it received over the stored
// photos — so the placeholder (or an empty array) silently replaced real
// photos.
//
// Rules implemented here:
//   1. A placeholder is NEVER persisted as a photo.
//   2. A `photos` value inside an ordinary update can only ADD photos. It can
//      never remove or replace anything — an empty array, a placeholder-only
//      array or an array that merely omits existing photos changes nothing.
//   3. Additions are applied atomically inside PostgreSQL (one UPDATE that
//      appends only the entries not already present), so two people uploading
//      at the same moment cannot overwrite each other.
//   4. Removal is only possible through the explicit, role-restricted
//      "remove photos" endpoints, which identify photos by a content id.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';

export const PHOTO_PLACEHOLDER = 'HAS_PHOTOS';
export const MAX_PHOTOS_PER_REQUEST = 20;

/** URL/data string of a photo entry (entries are strings or {url,…} objects). */
export function photoKey(p) {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object' && typeof p.url === 'string') return p.url;
  return '';
}

export const isPlaceholderPhoto = (p) => photoKey(p) === PHOTO_PLACEHOLDER;

/** Stable content id for a photo (sha-256 of its data/url, first 24 hex). */
export function photoId(p) {
  return crypto.createHash('sha256').update(photoKey(p)).digest('hex').slice(0, 24);
}

/**
 * Keeps only entries that are genuine photos: a non-empty string, or an object
 * with a non-empty string `url`; never the placeholder. De-duplicates by key.
 */
export function sanitizePhotos(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const p of input) {
    const key = photoKey(p);
    if (!key || key === PHOTO_PLACEHOLDER) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= MAX_PHOTOS_PER_REQUEST) break;
  }
  return out;
}

/** `photoIds` for a stored photos array — used by the on-demand /full endpoints. */
export const photoIdsOf = (arr) => (Array.isArray(arr) ? arr.filter((p) => photoKey(p) && !isPlaceholderPhoto(p)).map(photoId) : []);

// ── Atomic SQL ──────────────────────────────────────────────────────────────
// Both statements operate on the row's CURRENT value inside one UPDATE, so
// concurrent writers serialise on the row lock instead of overwriting.

const ARR = (expr) => `CASE WHEN jsonb_typeof(${expr}) = 'array' THEN ${expr} ELSE '[]'::jsonb END`;
const KEY = (alias) => `COALESCE(${alias}->>'url', ${alias}#>>'{}')`;

/** Append $1 (jsonb array) to tickets.photos, skipping entries already stored. */
export const SQL_TICKET_APPEND_PHOTOS = `
  UPDATE tickets SET
    photos = ${ARR(`COALESCE(photos,'[]'::jsonb)`)} || COALESCE((
      SELECT jsonb_agg(e) FROM jsonb_array_elements($1::jsonb) AS e
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${ARR(`COALESCE(tickets.photos,'[]'::jsonb)`)}) AS x
        WHERE ${KEY('x')} = ${KEY('e')}
      )
    ), '[]'::jsonb),
    updated_at = NOW()
  WHERE id = $2`;

/** Append $1 (jsonb array) to activities.details->'photos', skipping duplicates. */
export const SQL_ACTIVITY_APPEND_PHOTOS = `
  UPDATE activities SET
    details = jsonb_set(
      COALESCE(details,'{}'::jsonb), '{photos}',
      ${ARR(`COALESCE(details->'photos','[]'::jsonb)`)} || COALESCE((
        SELECT jsonb_agg(e) FROM jsonb_array_elements($1::jsonb) AS e
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${ARR(`COALESCE(activities.details->'photos','[]'::jsonb)`)}) AS x
          WHERE ${KEY('x')} = ${KEY('e')}
        )
      ), '[]'::jsonb),
      true),
    updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
  WHERE id = $2`;

/** Explicit removal: drop stored photos whose sha-256 content id is in $1 (text[]). */
export const SQL_TICKET_REMOVE_PHOTOS = `
  UPDATE tickets SET
    photos = COALESCE((
      SELECT jsonb_agg(x) FROM jsonb_array_elements(${ARR(`COALESCE(tickets.photos,'[]'::jsonb)`)}) AS x
      WHERE NOT (substr(encode(sha256(convert_to(${KEY('x')},'UTF8')),'hex'),1,24) = ANY($1::text[]))
    ), '[]'::jsonb),
    updated_at = NOW()
  WHERE id = $2`;

export const SQL_ACTIVITY_REMOVE_PHOTOS = `
  UPDATE activities SET
    details = jsonb_set(
      COALESCE(details,'{}'::jsonb), '{photos}',
      COALESCE((
        SELECT jsonb_agg(x) FROM jsonb_array_elements(${ARR(`COALESCE(activities.details->'photos','[]'::jsonb)`)}) AS x
        WHERE NOT (substr(encode(sha256(convert_to(${KEY('x')},'UTF8')),'hex'),1,24) = ANY($1::text[]))
      ), '[]'::jsonb),
      true),
    updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
  WHERE id = $2`;

/**
 * SQL expression for `activities.details` in a full-row UPDATE: writes the
 * caller's merged details document ($N) but keeps whatever photos are in the
 * database AT WRITE TIME (never the stale copy that was read earlier).
 */
export const detailsKeepingPhotos = (n) =>
  `(${`$${n}`}::jsonb - 'photos') || CASE WHEN activities.details ? 'photos' THEN jsonb_build_object('photos', activities.details->'photos') ELSE '{}'::jsonb END`;
