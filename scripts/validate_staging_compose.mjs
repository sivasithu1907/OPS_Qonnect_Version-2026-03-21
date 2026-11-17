#!/usr/bin/env node
// Preflight for docker-compose.staging.yml. READ-ONLY: it only inspects the rendered configuration; it starts nothing.
//
//   docker compose -p qonnect-fieldops-staging -f docker-compose.staging.yml --env-file .env.staging config --format json \
//     | node scripts/validate_staging_compose.mjs
//
// Exit 0 = every isolation rule holds. Exit 1 = at least one rule is broken (all are printed). Do not start the stack on 1.
import fs from 'fs';
import { stagingViolations } from '../backend/integrations.js';

const PROJECT = 'qonnect-fieldops-staging';
const EXPECTED_SERVICES = ['backend', 'frontend', 'staging-db'];
const INTERNAL_NET = `${PROJECT}_internal`, EDGE_NET = `${PROJECT}_edge`, VOLUME = `${PROJECT}_pgdata`;
// Things that exist in production and must never appear in staging.
const PRODUCTION_VOLUME_NAMES = ['postgres_data'];
const PRODUCTION_HOST_PORTS = new Set(['3000', '8080', '5432']);
const MAX_TOTAL_MEMORY = 1024 * 1024 * 1024;     // 1 GiB of limits in total
const MAX_TOTAL_CPUS = 1.5;

export function validate(cfg) {
  const v = [];
  const bad = (m) => v.push(m);
  const services = cfg.services || {};
  if (cfg.name !== PROJECT) bad(`project name must be "${PROJECT}" (got "${cfg.name}")`);
  const names = Object.keys(services).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_SERVICES)) bad(`services must be exactly ${EXPECTED_SERVICES.join(', ')} (got ${names.join(', ')})`);

  // ── networks ──
  const nets = cfg.networks || {};
  for (const [k, n] of Object.entries(nets)) {
    if (n.external) bad(`network "${k}" is external — staging may only use networks it creates`);
    if (![INTERNAL_NET, EDGE_NET].includes(n.name)) bad(`network "${k}" is named "${n.name}" — allowed: ${INTERNAL_NET}, ${EDGE_NET}`);
  }
  if (!nets.staging_internal || nets.staging_internal.internal !== true) bad('staging_internal must exist with internal: true (no internet / host access for the database and backend)');
  if (nets.staging_edge && nets.staging_edge.internal) bad('staging_edge must not be internal (it is needed to publish the frontend port)');

  // ── per service ──
  let mem = 0, cpus = 0;
  for (const [name, s] of Object.entries(services)) {
    if (s.network_mode) bad(`${name}: network_mode is not allowed ("${s.network_mode}")`);
    for (const k of ['privileged', 'pid', 'ipc', 'userns_mode', 'cap_add', 'devices', 'extra_hosts', 'external_links', 'links', 'volumes_from', 'dns', 'dns_search', 'sysctls'])
      if (s[k] && (!Array.isArray(s[k]) || s[k].length)) bad(`${name}: "${k}" is not allowed`);
    if (s.container_name) bad(`${name}: container_name is not allowed (it could collide with a production container)`);
    const sn = Object.keys(s.networks || {});
    if (!sn.length) bad(`${name}: must be attached to a staging network explicitly`);
    for (const n of sn) if (!nets[n]) bad(`${name}: uses network "${n}" that is not defined by this file`);
    if (name !== 'frontend' && (sn.length !== 1 || sn[0] !== 'staging_internal')) bad(`${name}: must be on staging_internal ONLY (got ${sn.join(', ')})`);
    if (name === 'frontend' && (sn.slice().sort().join() !== 'staging_edge,staging_internal')) bad(`frontend: must be on staging_internal and staging_edge (got ${sn.join(', ')})`);

    // ports
    for (const p of s.ports || []) {
      const host = String(p.published ?? ''), ip = p.host_ip;
      if (name !== 'frontend') bad(`${name}: must not publish any port (found ${ip || '*'}:${host}->${p.target})`);
      else if (!(ip === '127.0.0.1' && host === '3001' && Number(p.target) === 80)) bad(`frontend: the only allowed port mapping is 127.0.0.1:3001->80 (found ${ip || '0.0.0.0'}:${host}->${p.target})`);
      if (PRODUCTION_HOST_PORTS.has(host)) bad(`${name}: host port ${host} is a production port`);
    }
    if (name === 'frontend' && (s.ports || []).length !== 1) bad('frontend: exactly one published port is required (127.0.0.1:3001->80)');
    if (s.expose && s.expose.length && name === 'staging-db') bad('staging-db: must not expose ports');

    // volumes / mounts
    for (const m of s.volumes || []) {
      if (m.type === 'bind') bad(`${name}: bind mount "${m.source}" -> "${m.target}" is not allowed (no host paths, no docker.sock)`);
      else if (m.type === 'volume') {
        if (name !== 'staging-db') bad(`${name}: only staging-db may mount a volume (found "${m.source}")`);
        else if (m.source !== 'staging_pgdata') bad(`staging-db: mounts "${m.source}" — only staging_pgdata is allowed`);
      } else bad(`${name}: mount type "${m.type}" is not allowed`);
      if (PRODUCTION_VOLUME_NAMES.some(p => String(m.source || '').includes(p))) bad(`${name}: mounts a production volume name (${m.source})`);
    }
    const dbm = (services['staging-db']?.volumes || []);
    if (name === 'staging-db' && !(dbm.length === 1 && dbm[0].source === 'staging_pgdata' && dbm[0].target === '/var/lib/postgresql/data')) bad('staging-db: must mount exactly staging_pgdata at /var/lib/postgresql/data');

    // resources
    const lim = s.deploy?.resources?.limits || {};
    if (!lim.memory) bad(`${name}: a memory limit is required`); else mem += Number(lim.memory);
    if (!lim.cpus) bad(`${name}: a cpu limit is required`); else cpus += Number(lim.cpus);
  }
  if (mem > MAX_TOTAL_MEMORY) bad(`total memory limits ${Math.round(mem / 1048576)} MiB exceed ${MAX_TOTAL_MEMORY / 1048576} MiB`);
  if (cpus > MAX_TOTAL_CPUS) bad(`total cpu limits ${cpus} exceed ${MAX_TOTAL_CPUS}`);

  // ── volumes ──
  const vols = cfg.volumes || {};
  const vk = Object.keys(vols);
  if (vk.length !== 1 || vk[0] !== 'staging_pgdata') bad(`volumes must be exactly staging_pgdata (got ${vk.join(', ') || 'none'})`);
  for (const [k, vol] of Object.entries(vols)) {
    if (vol.external) bad(`volume "${k}" is external — staging may only use a volume it creates`);
    if (vol.name !== VOLUME) bad(`volume "${k}" is named "${vol.name}" — must be "${VOLUME}"`);
    if (PRODUCTION_VOLUME_NAMES.some(p => String(vol.name).endsWith(p) && vol.name !== VOLUME)) bad(`volume "${k}" looks like a production volume`);
  }

  // ── backend environment (same rules the backend enforces at start-up) ──
  const be = services.backend?.environment || {};
  for (const m of stagingViolations(be)) bad(`backend environment: ${m}`);
  if (be.APP_ENV !== 'staging') bad('backend: APP_ENV must be "staging"');
  for (const [k, val] of Object.entries(services['staging-db']?.environment || {})) {
    if (k === 'POSTGRES_DB' && val !== 'fieldops_staging') bad('staging-db: POSTGRES_DB must be fieldops_staging');
    if (k === 'POSTGRES_USER' && !/^staging_/.test(val)) bad('staging-db: POSTGRES_USER must start with staging_');
  }
  // the staging passwords must not simply be copied between roles
  if (be.DB_PASSWORD && be.DB_PASSWORD === be.JWT_SECRET) bad('backend: DB_PASSWORD and JWT_SECRET must differ');
  for (const [name, s] of Object.entries(services)) {
    const img = s.image || '';
    if (name !== 'staging-db' && !img.startsWith('qonnect-fieldops-staging/')) bad(`${name}: image must be tagged qonnect-fieldops-staging/… (got "${img}")`);
  }
  return v;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href;
if (isMain) {
  const arg = process.argv[2];
  const raw = arg ? fs.readFileSync(arg, 'utf8') : fs.readFileSync(0, 'utf8');
  let cfg; try { cfg = JSON.parse(raw); } catch { console.error('Input is not JSON. Pipe `docker compose … config --format json` into this script.'); process.exit(2); }
  const problems = validate(cfg);
  if (problems.length) { console.error('STAGING COMPOSE PREFLIGHT: FAILED\n  - ' + problems.join('\n  - ')); process.exit(1); }
  console.log('STAGING COMPOSE PREFLIGHT: OK — isolated project, internal-only backend/database, one loopback port (127.0.0.1:3001), dedicated volume, all integrations off.');
}
