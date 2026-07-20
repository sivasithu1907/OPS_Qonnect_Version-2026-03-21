import { TicketStatus, Role, ActivityStatus } from './types';
import { LayoutDashboard, Ticket as TicketIcon, Smartphone, Users, Activity as ActivityIcon, Calendar, Contact, FileBarChart, UserCog, Database, MessageCircle, ClipboardList, ShieldCheck, RefreshCw, Settings as SettingsIcon, Star } from 'lucide-react';

export const APP_NAME = "Qonnect";

// --- SHARED DATA CONSTANTS (reused by Planner + Sales Requests) ---
export const ACTIVITY_TYPES = ['Installation', 'Troubleshooting', 'Inspection', 'Survey', 'Service', 'Maintenance'] as const;
export const SALES_ACTIVITY_TYPES = ['Installation', 'Troubleshooting', 'Inspection', 'Survey'] as const;
export const SERVICE_CATEGORIES = ['Wi-Fi & Networking', 'CCTV', 'Home Automation', 'Intercom', 'Smart Speaker', 'ELV Systems', 'Other'] as const;

// --- STATUS LABELS (DB-safe values, UI-friendly text) ---
export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  PLANNED: 'Planned',
  ON_MY_WAY: 'On My Way',
  ARRIVED: 'Arrived',
  IN_PROGRESS: 'In-Progress',
  DONE: 'Done',
  CARRY_FORWARD: 'Carry Forward',
  CANCELLED: 'Cancelled',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: 'New',
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  ON_MY_WAY: 'On My Way',
  ARRIVED: 'Arrived',
  IN_PROGRESS: 'In-Progress',
  CARRY_FORWARD: 'Carry Forward',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
};

export const getActivityStatusLabel = (s: ActivityStatus) =>
  ACTIVITY_STATUS_LABELS[s] ?? s;

export const getTicketStatusLabel = (s: TicketStatus) =>
  TICKET_STATUS_LABELS[s] ?? s;

// --- GLOBAL DESIGN TOKENS ---
export const INPUT_STYLES = "w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-[14px] py-[12px] text-sm font-medium text-[#0F172A] placeholder-[#94A3B8] outline-none transition-all focus:bg-[#FFFFFF] focus:border-[#FFCC00] focus:ring-[4px] focus:ring-[#FFCC00]/25 disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] disabled:border-transparent disabled:cursor-not-allowed resize-none";
export const SEARCH_INPUT_STYLES = "w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-10 pr-[14px] py-[12px] text-sm font-medium text-[#0F172A] placeholder-[#94A3B8] outline-none transition-all focus:bg-[#FFFFFF] focus:border-[#FFCC00] focus:ring-[4px] focus:ring-[#FFCC00]/25";

export const NAVIGATION_ITEMS = [
  // ── 🧭 Overview — high-level operational views, grouped together ──
  {
    id: 'master_dashboard',
    label: 'Master Dashboard',
    icon: <LayoutDashboard size={20} />,
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD],
    category: 'Overview'
  },
  { 
    id: 'operations', 
    label: 'Operations Monitor', 
    icon: <ActivityIcon size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD],
    category: 'Overview'
  },

  // ── 🛠 Operations — field engineers, service, maintenance, support ──
  { 
    id: 'planning', 
    label: 'Activity Planner', 
    icon: <Calendar size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD],
    category: 'Operations'
  },
  { 
    id: 'tickets', 
    label: 'Active Tickets', 
    icon: <TicketIcon size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD],
    category: 'Operations'
  },
  { 
    id: 'amc_contracts', 
    label: 'AMC Contracts', 
    icon: <RefreshCw size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD],
    category: 'Operations'
  },
  { 
    id: 'service_feedback', 
    label: 'Service Feedback', 
    icon: <Star size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD],
    category: 'Operations'
  },

  // ── 💼 Sales — its own section so future Sales Dashboard / Calendar / KPI /
  // Analytics modules can slot in here without restructuring anything. ──
  {
    id: 'sales_requests',
    label: 'Sales Appointment Requests',
    icon: <ClipboardList size={20} />,
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD, Role.SALES],
    category: 'Sales'
  },

  // ── 🗂 Data — master data shared across the system (not operational
  // workflow). Clients today; Sites/Assets/Installations etc. would join
  // this same category later, so new items just need `category: 'Data'`
  // added, no structural change. ──
  { 
    id: 'customers', 
    label: 'Clients', 
    icon: <Contact size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER, Role.TEAM_LEAD],
    category: 'Data'
  },

  // ── 📈 Analytics — detailed reporting/analytics views, separate from the
  // executive Overview now that Master Dashboard covers the top-line
  // operational summary. Same page, same route, same roles — only where it
  // sits in the nav has changed. ──
  { 
    id: 'dashboard', 
    label: 'Service Dashboard', 
    icon: <LayoutDashboard size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER],
    category: 'Analytics'
  },

  // ── 👨‍💼 Administration — internal admin modules ──
  { 
    id: 'users', 
    label: 'User Management', 
    icon: <UserCog size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER],
    category: 'Administration'
  },
  { 
    id: 'team', 
    label: 'Team Management', 
    icon: <Users size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER],
    category: 'Administration'
  },
  { 
    id: 'audit_log', 
    label: 'Audit Log', 
    icon: <ShieldCheck size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER],
    category: 'Administration'
  },
  { 
    id: 'system_tools', 
    label: 'Data Tools', 
    icon: <Database size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER],
    category: 'Administration'
  },

  // ── ⚙ System — configuration & integrations ──
  { 
    id: 'whatsapp_monitor', 
    label: 'WhatsApp Monitor', 
    icon: <MessageCircle size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER],
    category: 'System'
  },
  { 
    id: 'settings', 
    label: 'Settings', 
    icon: <SettingsIcon size={20} />, 
    roles: [Role.ADMIN, Role.VIEWER],
    category: 'System'
  },

  // --- Portals & Tools (unchanged — mobile portals, not part of this refactor) ---
  { 
    id: 'lead_portal', 
    label: 'Lead Portal (Mobile)', 
    icon: <Smartphone size={20} />, 
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    category: 'Portals & Tools'
  },
  { 
    id: 'tech_portal', 
    label: 'Tech Portal (Mobile)', 
    icon: <Smartphone size={20} />, 
    roles: [Role.ADMIN, Role.FIELD_ENGINEER],
    category: 'Portals & Tools'
  },
];

export const TICKET_CATEGORIES = [
  'Wi-Fi & Networking',
  'CCTV',
  'Home Automation',
  'Intercom',
  'Smart Speaker',
  'Other'
];

