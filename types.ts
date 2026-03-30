export enum Role {
  ADMIN = 'ADMIN',
  TEAM_LEAD = 'TEAM_LEAD',
  FIELD_ENGINEER = 'FIELD_ENGINEER'
}

export const ROLE_VALUES = [Role.ADMIN, Role.TEAM_LEAD, Role.FIELD_ENGINEER];

export const isAdmin = (role: Role) => role === Role.ADMIN;
export const isTeamLead = (role: Role) => role === Role.TEAM_LEAD;
export const isFieldEngineer = (role: Role) => role === Role.FIELD_ENGINEER;

export enum TicketStatus {
  NEW = 'NEW',
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  ON_MY_WAY = 'ON_MY_WAY', // Added for My Jobs Flow
  ARRIVED = 'ARRIVED', // Added for My Jobs Flow
  IN_PROGRESS = 'IN_PROGRESS',
  CARRY_FORWARD = 'CARRY_FORWARD',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED'
}

export enum TicketType {
  WARRANTY = 'Under Warranty',
  CHARGEABLE = 'Chargeable',
  AMC = 'Under AMC'
}

export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}

export enum MessageSender {
  CLIENT = 'CLIENT',
  SYSTEM = 'SYSTEM',
  AGENT = 'AGENT'
}

export interface User {
  email: string;
  name: string;
  role: Role;
  techId?: string; // Links a user to a specific technician record
}

export interface Message {
  id: string;
  sender: MessageSender;
  content: string;
  timestamp: string;
}

export interface Technician {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'BUSY' | 'LEAVE';
  role: string; // Job Title (e.g. "Senior Electrician")
  
  // Auth & RBAC Fields
  systemRole?: Role; 
  isActive: boolean;
  email: string; // Mandatory for login
  password?: string; // Mock password
  phone?: string;
  avatar?: string; // Profile photo URL or auto-generated initials
  
  level: 'TEAM_LEAD' | 'FIELD_ENGINEER' | 'SALES' | 'TECHNICAL_ASSOCIATE'; // Operational Level / Department
  teamId?: string;
}

export interface Ticket {
  id: string;
  customerId: string; // Link to Customer Master
  customerName: string; 
  phoneNumber: string; 
  category: string;
  type: TicketType;
  priority: Priority;
  status: TicketStatus;
  assignedTechId?: string;
  messages: Message[];
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  appointmentTime?: string;
  notes?: string;
  unreadCount: number;
  
  // New Fields
  odooLink?: string;
  locationUrl?: string; // Mandatory URL
  houseNumber?: string;
  ai_summary?: string; // AI-generated summary for Team Lead
  
  // Workflow Tracking
  startedAt?: string;
  completedAt?: string;
  lastEscalatedAt?: string; // For automated stall detection notifications
  
  // Operations Portal Fields
  assignmentNote?: string;
  completionNote?: string;
  carryForwardNote?: string;
  cancellationReason?: string;
  nextPlannedAt?: string; // ISO String for Carry Forward
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string; // Now used for Location URL
  avatar?: string;
  buildingNumber?: string; // New Optional Field
}

export interface AnalysisResult {
  summary: string;
  service_category: 'ELV Systems' | 'Home Automation' | 'Unknown' | string;
  priority: Priority;
  remote_possible: boolean;
  confidence: number;
  recommended_action: 'remote_support' | 'assign_field_engineer' | 'request_more_info';
  suggested_questions: string[];
  draft_reply: string;
}

export interface SimLog {
  id: string;
  step: string;
  detail: string;
  timestamp: string;
  status: 'success' | 'processing' | 'error';
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  ticketId?: string;
  targetRoles: Role[];
  read: boolean;
}

// --- Operations & Planning Types ---

export interface Team {
  id: string;
  name: string;
  leadId: string; // References Technician.id (Must be TEAM_LEAD)
  memberIds: string[]; // References Technician.id (FIELD_ENGINEER)
  status: 'AVAILABLE' | 'DEPLOYED' | 'OFF_DUTY';
  currentSiteId?: string;
  workloadLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface Site {
  id: string;
  name: string;
  clientName: string;
  location: string;
  priority: Priority;
  status: 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  assignedTeamId?: string;
  startTime?: string;
  expectedCompletion?: string;
}

export interface TicketFilter {
  status?: TicketStatus[];
  aging?: 'New' | 'Attention Required' | 'On Hold';
  description?: string; // For display purposes in the UI
  ticketId?: string; // Deep link to specific ticket
}

export type ActivityType = 'Installation' | 'Service' | 'Maintenance' | 'Inspection' | 'Survey';
export type ActivityStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type ServiceCategory = 'ELV Systems' | 'Home Automation';

export interface Activity {
  id: string; // e.g. ACT-00045
  reference: string;
  type: ActivityType;
  serviceCategory?: string; // New Field
  priority: Priority;
  status: ActivityStatus;
  plannedDate: string; // ISO String
  deadline?: string; // ISO String
  
  // Location Details
  siteId?: string; // Optional/Legacy
  customerId?: string; // Link to Customer
  locationUrl?: string;
  houseNumber?: string;
  
  // External Refs
  odooLink?: string;

  // Resource Allocation
  assignedTeamId?: string; // Kept for Dashboard compatibility
  salesLeadId?: string; // Reference to Sales Technician
  leadTechId?: string; // Specific Engineer
  assistantTechIds?: string[]; // Specific Associates

  description: string;
  remarks?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;   // Set when status first transitions to IN_PROGRESS
  completedAt?: string; // Set when status transitions to DONE
  
  // Duration
  durationHours: number;
  durationUnit?: 'HOURS' | 'DAYS';

  // Escalation & Delays
  escalationLevel?: 0 | 1 | 2 | 3; // 0 = None, 1 = Tech, 2 = Lead, 3 = Admin
  delayStatus?: 'none' | 'delayed_not_started' | 'delayed_overdue';
  lastEscalatedAt?: string; // ISO String
  delayReason?: string;
}
