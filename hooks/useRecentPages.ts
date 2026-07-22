import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Recent pages for the Command Palette (Sprint 2.1)
//
// Tracks recently visited authenticated views by their view id only — never
// record data, filters, or anything sensitive. Stored locally per browser.
// Permission filtering happens at display time (the palette resolves ids
// against the current role's command list, so revoked pages simply drop out).
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'qonnect_recent_pages';
const MAX_RECENT = 8;

// Fullscreen mobile portals replace the desktop shell entirely and are not
// palette targets; never record them. Login/logout are not views in this app
// (the shell only renders when authenticated), so they can never appear.
const EXCLUDED_VIEWS = new Set(['lead_portal', 'tech_portal']);

const readStored = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
};

/**
 * Records `activeView` transitions (most recent first, de-duplicated, capped)
 * while `enabled` is true, and returns the current list of recent view ids.
 */
export function useRecentPages(activeView: string, enabled: boolean): string[] {
  const [recentViews, setRecentViews] = useState<string[]>(readStored);

  useEffect(() => {
    if (!enabled || !activeView || EXCLUDED_VIEWS.has(activeView)) return;
    setRecentViews(prev => {
      if (prev[0] === activeView) return prev; // already at the top — no churn
      const next = [activeView, ...prev.filter(v => v !== activeView)].slice(0, MAX_RECENT);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage full/blocked — non-fatal */ }
      return next;
    });
  }, [activeView, enabled]);

  return recentViews;
}
