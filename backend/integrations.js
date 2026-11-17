// ═══════════════════════════════════════════════════════════════════════════════
// Outbound-integration switches.
//
// Four environment switches, ALL DISABLED BY DEFAULT (anything other than true/1/yes/on is "off"):
//   ENABLE_WHATSAPP                WhatsApp Cloud API: every send, media download, and the Meta webhook endpoints.
//   ENABLE_TV                      TV display: GET /api/tv-data (and therefore the #tv screen).
//   ENABLE_N8N                     n8n: every call to N8N_WEBHOOK_URL.
//   ENABLE_EXTERNAL_NOTIFICATIONS  Notifications to people outside the app (team-lead and customer WhatsApp
//                                  notifications). A WhatsApp NOTIFICATION needs BOTH this and ENABLE_WHATSAPP.
//
// The switches are checked at the moment of every outgoing call, in code — a missing or dummy credential is NOT what
// keeps an integration off. Internal functions (activities, tickets, contacts, users, assignments, dashboards,
// reports, local audit log, WhatsApp monitor of already-stored logs) never depend on these switches.
//
// APP_ENV=staging adds a start-up guard (assertStagingIsolation) that refuses to start when the configuration could
// reach production services or real external APIs.
// ═══════════════════════════════════════════════════════════════════════════════

const TRUTHY = new Set(['true', '1', 'yes', 'on']);
export const SWITCHES = Object.freeze({
  whatsapp: 'ENABLE_WHATSAPP',
  tv: 'ENABLE_TV',
  n8n: 'ENABLE_N8N',
  notifications: 'ENABLE_EXTERNAL_NOTIFICATIONS',
});

export const isEnabled = (kind, env = process.env) => {
  const name = SWITCHES[kind];
  if (!name) throw new Error(`Unknown integration "${kind}"`);
  return TRUTHY.has(String(env[name] ?? '').trim().toLowerCase());
};

export const switchStates = (env = process.env) =>
  Object.fromEntries(Object.entries(SWITCHES).map(([kind, name]) => [name, isEnabled(kind, env)]));

export class IntegrationDisabledError extends Error {
  constructor(kind, what) {
    super(`${SWITCHES[kind]} is not enabled — ${what || 'outgoing call'} blocked`);
    this.name = 'IntegrationDisabledError';
    this.code = 'INTEGRATION_DISABLED';
    this.integration = kind;
  }
}

// One structured line per blocked call (never contains message text, phone numbers, URLs or tokens).
export const logBlocked = (kind, what) => {
  console.log(JSON.stringify({ level: 'INFO', type: 'integration_blocked', integration: kind, switch: SWITCHES[kind], what, timestamp: new Date().toISOString() }));
};

// True when every listed integration is enabled; otherwise logs the block once and returns false.
export const allowed = (kinds, what, env = process.env) => {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  const off = list.find(k => !isEnabled(k, env));
  if (off) { logBlocked(off, what); return false; }
  return true;
};

// The ONLY way server code may make an outgoing HTTP request. Throws before any network activity when the switch is off.
export const guardedFetch = async (kind, url, options, what = 'outgoing request') => {
  if (!isEnabled(kind)) { logBlocked(kind, what); throw new IntegrationDisabledError(kind, what); }
  return fetch(url, options);
};

// n8n webhook (fire-and-forget or awaited). Resolves { skipped:true } when n8n is off or no URL is configured.
export const callN8n = async (path, payload, { timeoutMs = 10000 } = {}) => {
  if (!isEnabled('n8n')) { logBlocked('n8n', `webhook ${path}`); return { skipped: true, reason: 'ENABLE_N8N is not enabled' }; }
  const base = process.env.N8N_WEBHOOK_URL;
  if (!base) return { skipped: true, reason: 'N8N_WEBHOOK_URL is not set' };
  const resp = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { skipped: false, status: resp.status };
};

// ── Staging isolation guard ───────────────────────────────────────────────────
// Returns a list of problems (empty = fine). Only evaluated when APP_ENV=staging.
const PRODUCTION_HOST_MARKERS = ['qonnectops.duckdns.org'];
export const stagingViolations = (env = process.env) => {
  const v = [];
  for (const [kind, name] of Object.entries(SWITCHES)) if (isEnabled(kind, env)) v.push(`${name} must be false in staging`);
  for (const k of ['N8N_WEBHOOK_URL', 'WA_ACCESS_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_VERIFY_TOKEN', 'TV_TOKEN']) {
    if (String(env[k] || '').trim()) v.push(`${k} must be empty in staging (no integration credentials or URLs)`);
  }
  if (env.DB_HOST !== 'staging-db') v.push(`DB_HOST must be "staging-db" (got "${env.DB_HOST || ''}")`);
  if (!/^fieldops_staging/.test(String(env.DB_NAME || ''))) v.push('DB_NAME must start with "fieldops_staging"');
  if (!/^staging_/.test(String(env.DB_USER || ''))) v.push('DB_USER must start with "staging_"');
  if (String(env.DB_PORT || '5432') !== '5432') v.push('DB_PORT must be 5432 (the staging database container port)');
  if (!/^staging-/.test(String(env.API_KEY || ''))) v.push('API_KEY must be a "staging-…" placeholder, not a real external API key');
  const cors = String(env.CORS_ORIGIN || '');
  if (PRODUCTION_HOST_MARKERS.some(m => cors.includes(m))) v.push('CORS_ORIGIN must not name the production host');
  if (String(env.JWT_SECRET || '').length < 32) v.push('JWT_SECRET must be a staging-specific secret of at least 32 characters');
  return v;
};

export const assertStagingIsolation = (env = process.env) => {
  if (String(env.APP_ENV || '').toLowerCase() !== 'staging') return;
  const problems = stagingViolations(env);
  if (problems.length) {
    console.error('❌ REFUSING TO START (APP_ENV=staging isolation guard):\n  - ' + problems.join('\n  - '));
    process.exit(78);
  }
  console.log(JSON.stringify({ level: 'INFO', type: 'staging_isolation_ok', timestamp: new Date().toISOString() }));
};
