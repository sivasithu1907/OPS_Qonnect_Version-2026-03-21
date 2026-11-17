// Photo safety helpers (Batch 1 — QA-03).
//
// List endpoints return `photos: ['HAS_PHOTOS']` (a flag, not image data). If a whole
// job object is sent back on an ordinary update (status change, reassignment, …) that
// flag must never travel as if it were the job's photos. The server also refuses to
// store it; this keeps the browser from sending it in the first place.

export const PHOTO_PLACEHOLDER = 'HAS_PHOTOS';

const photoKey = (p: any): string =>
  typeof p === 'string' ? p : p && typeof p === 'object' && typeof p.url === 'string' ? p.url : '';

/** Only genuine photos (never the placeholder, never empty entries). */
export function realPhotosOnly(photos: any): any[] {
  if (!Array.isArray(photos)) return [];
  return photos.filter((p) => {
    const k = photoKey(p);
    return !!k && k !== PHOTO_PLACEHOLDER;
  });
}

/**
 * Returns a shallow copy of a job payload that is safe to send to the server:
 * `photos` is dropped entirely unless it holds genuine photo data (an absent field
 * means "no photo change"; the server never treats an empty list as "delete all").
 */
export function withoutPlaceholderPhotos<T extends Record<string, any>>(job: T): T {
  if (!job || typeof job !== 'object' || !('photos' in job)) return job;
  const real = realPhotosOnly(job.photos);
  const copy: Record<string, any> = { ...job };
  if (real.length > 0) copy.photos = real; else delete copy.photos;
  return copy as T;
}
