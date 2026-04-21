import { TicketStatus, Role, ActivityStatus } from './types';
import { LayoutDashboard, Ticket as TicketIcon, Smartphone, Users, Activity as ActivityIcon, Calendar, Contact, FileBarChart, UserCog, Database, MessageCircle } from 'lucide-react';

export const APP_NAME = "Qonnect";

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
  // --- Master Dashboard (Top Level) ---
  {
    id: 'master_dashboard',
    label: 'Master Dashboard',
    icon: <LayoutDashboard size={20} />,
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    category: 'Dashboard'
  },

  // --- After-Sales ---
  { 
    id: 'dashboard', 
    label: 'Service Dashboard', 
    icon: <LayoutDashboard size={20} />, 
    roles: [Role.ADMIN],
    category: 'After-Sales'
  },
  { 
    id: 'tickets', 
    label: 'Active Tickets', 
    icon: <TicketIcon size={20} />, 
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    category: 'After-Sales'
  },

  // --- Operations ---
  { 
    id: 'operations', 
    label: 'Operations Monitor', 
    icon: <ActivityIcon size={20} />, 
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    category: 'Operations'
  },
  { 
    id: 'planning', 
    label: 'Activity Planner', 
    icon: <Calendar size={20} />, 
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    category: 'Operations'
  },

  // --- General ---
  { 
    id: 'customers', 
    label: 'Clients', 
    icon: <Contact size={20} />, 
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    category: 'General'
  },
  { 
    id: 'reports', 
    label: 'Reports & Analytics', 
    icon: <FileBarChart size={20} />, 
    roles: [Role.ADMIN, Role.TEAM_LEAD],
    category: 'General'
  },

  // --- Admin ---
  { 
    id: 'users', 
    label: 'User Management', 
    icon: <UserCog size={20} />, 
    roles: [Role.ADMIN],
    category: 'Admin'
  },
  { 
    id: 'team', 
    label: 'Team Management', 
    icon: <Users size={20} />, 
    roles: [Role.ADMIN],
    category: 'Admin'
  },
  { 
    id: 'system_tools', 
    label: 'Data Tools', 
    icon: <Database size={20} />, 
    roles: [Role.ADMIN],
    category: 'Admin'
  },
  { 
    id: 'whatsapp_monitor', 
    label: 'WhatsApp Monitor', 
    icon: <MessageCircle size={20} />, 
    roles: [Role.ADMIN],
    category: 'Admin'
  },

  // --- Portals & Tools ---
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

