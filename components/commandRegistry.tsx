import React from 'react';
import { Role } from '../types';
import { NAVIGATION_ITEMS } from '../constants';
import { CalendarPlus, TicketPlus, ClipboardPlus, UserRoundPlus, ContactRound } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Command Palette registry — Sprint 2.1
//
// Single source of truth for what the palette can show. Navigation commands
// are DERIVED from the existing NAVIGATION_ITEMS config (same ids, labels,
// icons, roles, categories the sidebar uses) so routes and permissions are
// never duplicated. Quick actions are defined here once, each pointing at an
// existing view + its existing creation flow — no forms live in the palette.
// ─────────────────────────────────────────────────────────────────────────────

export type QuickActionId =
  | 'create_activity'
  | 'create_ticket'
  | 'create_sar'
  | 'create_client'
  | 'add_user';

export interface CommandItem {
  /** Unique id within the palette, e.g. `nav:tickets` / `action:create_ticket` */
  id: string;
  kind: 'navigation' | 'action';
  label: string;
  /** Sidebar category for navigation items; "Quick Action" for actions */
  contextLabel: string;
  icon: React.ReactNode;
  /** Extra search terms beyond the label (aliases, abbreviations like "sar") */
  keywords: string[];
  roles: Role[];
  /** The existing view id (App.tsx `activeView`) this command navigates to */
  targetView: string;
  /** Present only for quick actions */
  action?: QuickActionId;
}

// Views the palette must never target: the fullscreen mobile portals replace
// the whole desktop shell (the palette lives in that shell), and they are not
// part of the Sprint 2.1 navigation scope.
const PALETTE_EXCLUDED_VIEWS = new Set(['lead_portal', 'tech_portal']);

// Search aliases per existing view id. Only additive metadata — ids, labels
// and roles keep coming from NAVIGATION_ITEMS itself.
const NAV_KEYWORDS: Record<string, string[]> = {
  master_dashboard: ['dashboard', 'overview', 'home', 'kpi', 'stats', 'reports'],
  operations:       ['ops', 'monitor', 'live', 'field', 'timeline'],
  planning:         ['activity', 'planner', 'plan', 'schedule', 'calendar', 'jobs', 'installation'],
  tickets:          ['ticket', 'support', 'issues', 'complaints', 'service requests'],
  amc_contracts:    ['amc', 'contract', 'contracts', 'maintenance', 'annual', 'renewal'],
  service_feedback: ['feedback', 'reviews', 'google review', 'qr', 'rating', 'stars'],
  sales_requests:   ['sar', 'sales', 'appointment', 'requests', 'leads'],
  customers:        ['client', 'clients', 'customer', 'customers', 'records', 'contacts', 'crm'],
  users:            ['user', 'users', 'accounts', 'logins', 'staff', 'roles'],
  team:             ['team', 'engineers', 'technicians', 'crew', 'members', 'freelancers'],
  audit_log:        ['audit', 'log', 'history', 'security', 'changes'],
  system_tools:     ['data', 'tools', 'export', 'import', 'backup', 'system'],
  whatsapp_monitor: ['whatsapp', 'wa', 'messages', 'chat', 'monitor'],
  settings:         ['settings', 'preferences', 'configuration', 'config', 'options'],
  dashboard:        ['service dashboard', 'analytics'],
};

// Quick actions — each reuses an existing creation flow on its existing page.
// Roles are intentionally narrower than page-view roles: VIEWER can see every
// page but is read-only (mutations are hard-blocked server-side), so creation
// actions are never offered to VIEWER. SAR creation mirrors the module's own
// rule (`isSales || isScheduler`).
const QUICK_ACTIONS: CommandItem[] = [
  {
    id: 'action:create_activity',
    kind: 'action',
    label: 'Create Activity',
    contextLabel: 'Quick Action',
    icon: <CalendarPlus size={18} />,
    keywords: ['new activity', 'plan activity', 'schedule job', 'add activity', 'planner', 'act'],
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    targetView: 'planning',
    action: 'create_activity',
  },
  {
    id: 'action:create_ticket',
    kind: 'action',
    label: 'Create Ticket',
    contextLabel: 'Quick Action',
    icon: <TicketPlus size={18} />,
    keywords: ['new ticket', 'add ticket', 'raise ticket', 'support', 'issue', 'complaint'],
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    targetView: 'tickets',
    action: 'create_ticket',
  },
  {
    id: 'action:create_sar',
    kind: 'action',
    label: 'Create Sales Appointment Request',
    contextLabel: 'Quick Action',
    icon: <ClipboardPlus size={18} />,
    keywords: ['sar', 'new request', 'sales request', 'appointment', 'new sar', 'lead'],
    roles: [Role.ADMIN, Role.TEAM_LEAD, Role.SALES],
    targetView: 'sales_requests',
    action: 'create_sar',
  },
  {
    id: 'action:create_client',
    kind: 'action',
    label: 'Create Client',
    contextLabel: 'Quick Action',
    icon: <ContactRound size={18} />,
    keywords: ['new client', 'add client', 'new customer', 'add customer', 'contact'],
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    targetView: 'customers',
    action: 'create_client',
  },
  {
    id: 'action:add_user',
    kind: 'action',
    label: 'Add User',
    contextLabel: 'Quick Action',
    icon: <UserRoundPlus size={18} />,
    keywords: ['new user', 'create user', 'add account', 'invite', 'staff', 'engineer'],
    roles: [Role.ADMIN],
    targetView: 'users',
    action: 'add_user',
  },
];

/** All palette commands visible to a given role, in stable registry order. */
export const getCommandsForRole = (role: Role): CommandItem[] => {
  const navCommands: CommandItem[] = NAVIGATION_ITEMS
    .filter(item => !PALETTE_EXCLUDED_VIEWS.has(item.id))
    .filter(item => item.roles.includes(role))
    .map(item => ({
      id: `nav:${item.id}`,
      kind: 'navigation' as const,
      label: item.label,
      contextLabel: item.category || 'Navigation',
      icon: item.icon,
      keywords: NAV_KEYWORDS[item.id] || [],
      roles: item.roles,
      targetView: item.id,
    }));

  const actionCommands = QUICK_ACTIONS.filter(a => a.roles.includes(role));

  return [...actionCommands, ...navCommands];
};

// ── Search ───────────────────────────────────────────────────────────────────
// Deterministic, case-insensitive, partial-term scoring. Higher = better.
// Ties keep registry order (stable sort via index).

const scoreCommand = (cmd: CommandItem, query: string): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = cmd.label.toLowerCase();

  if (label === q) return 100;
  if (label.startsWith(q)) return 90;
  // Word-boundary prefix inside the label ("act" → "Active Tickets" via "Active")
  if (label.split(/\s+/).some(w => w.startsWith(q))) return 80;
  if (label.includes(q)) return 65;

  const keywords = cmd.keywords.map(k => k.toLowerCase());
  if (keywords.some(k => k === q)) return 60;
  if (keywords.some(k => k.startsWith(q))) return 50;
  if (keywords.some(k => k.split(/\s+/).some(w => w.startsWith(q)))) return 45;
  if (keywords.some(k => k.includes(q))) return 35;

  if (cmd.contextLabel.toLowerCase().includes(q)) return 20;
  return 0;
};

/** Filter + rank commands for a query. Empty query returns everything as-is. */
export const searchCommands = (commands: CommandItem[], query: string): CommandItem[] => {
  const q = query.trim();
  if (!q) return commands;
  return commands
    .map((cmd, index) => ({ cmd, index, score: scoreCommand(cmd, q) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(entry => entry.cmd);
};

/** True on Apple platforms — used only to render ⌘ vs Ctrl in shortcut hints. */
export const IS_APPLE_PLATFORM =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(
    // `userAgentData.platform` where available, falling back to the legacy field
    ((navigator as any).userAgentData?.platform as string) || navigator.platform || ''
  );
