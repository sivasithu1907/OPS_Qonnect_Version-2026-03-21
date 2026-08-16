export enum Role {
  ADMIN = 'ADMIN',
  TEAM_LEAD = 'TEAM_LEAD',
  FIELD_ENGINEER = 'FIELD_ENGINEER',
  SALES = 'SALES',
  // Read-only account: can log in and see everything, but every mutating
  // request is hard-blocked server-side in backend/server.js's `authenticate`
  // middleware, regardless of which screen or button they use.
  VIEWER = 'VIEWER'
}

export const ROLE_VALUES = [Role.ADMIN, Role.TEAM_LEAD, Role.FIELD_ENGINEER, Role.SALES, Role.VIEWER];

export const isAdmin = (role: Role) => role === Role.ADMIN;
export const isTeamLead = (role: Role) => role === Role.TEAM_LEAD;
export const isFieldEngineer = (role: Role) => role === Role.FIELD_ENGINEER;
export const isSales = (role: Role) => role === Role.SALES;
export const isViewer = (role: Role) => role === Role.VIEWER;

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

  // Photos uploaded by the field engineer as proof of work. In list
  // responses this is either [] or ['HAS_PHOTOS'] (a lightweight flag, real
  // image data is fetched on demand via GET /api/tickets/:id/full) — only
  // the full-detail response contains actual photo objects ({url, takenAt, name}).
  photos?: Array<{ url: string; takenAt?: string; name?: string } | string>;
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
export type ActivityStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'CARRY_FORWARD' | 'ON_MY_WAY' | 'ARRIVED';
export type ServiceCategory = 'ELV Systems' | 'Home Automation';

export interface VisitRecord {
  date: string;
  startedAt?: string;
  completedAt?: string;
  assignedTeam?: {
    leadTechId?: string;
    primaryEngineerId?: string;
    supportingEngineerIds?: string[];
    freelancers?: any[];
  };
  remarks?: string;
  carryForwardReason?: string;
  status: string;
}

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
  customerName?: string;  // Denormalised from customer row (set on creation for SAR-created activities)
  customerPhone?: string; // Denormalised phone for Call button fallback
  locationUrl?: string;
  houseNumber?: string;

  // External Refs
  odooLink?: string;

  // Resource Allocation
  assignedTeamId?: string; // Kept for Dashboard compatibility
  salesLeadId?: string; // Reference to Sales Technician
  salesLeadName?: string; // Denormalised for display in activity details
  leadTechId?: string; // Specific Engineer
  assistantTechIds?: string[]; // Specific Associates

  description: string;
  remarks?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;   // Set when status first transitions to IN_PROGRESS
  completedAt?: string; // Set when status transitions to DONE
  
  // Execution Fields (set at runtime, not during planning)
  primaryEngineerId?: string;      // Who actually pressed "Start Work"
  supportingEngineerIds?: string[]; // Team members working on this activity
  
  // Duration
  durationHours: number;
  durationUnit?: 'HOURS' | 'DAYS';

  // Escalation & Delays
  escalationLevel?: 0 | 1 | 2 | 3; // 0 = None, 1 = Tech, 2 = Lead, 3 = Admin
  delayStatus?: 'none' | 'delayed_not_started' | 'delayed_overdue';
  lastEscalatedAt?: string; // ISO String
  delayReason?: string;

  // Visit History (carry forward tracking)
  visitHistory?: VisitRecord[];
  carryForwardNote?: string;
  previousActivityRef?: string; // Reference to the activity this was carried forward from
}

// --- Sales Appointment Request ---

export enum SalesRequestStatus {
  PENDING_SCHEDULING = 'PENDING_SCHEDULING',
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  // Intermediate status — the field team could not complete the visit;
  // the activity has been carried forward to a new date. The SAR remains
  // open and will advance to COMPLETED once the rescheduled visit is DONE.
  CARRY_FORWARD = 'CARRY_FORWARD',
  // Renamed from DONE to COMPLETED — the backend has always written
  // 'COMPLETED' to the database when a linked job finishes (see the SAR
  // Sync logic in server.js), but this enum said 'DONE', so the status
  // filter could never match a single completed request, for anyone.
  // Renaming the enum to match the real, already-stored value avoids a
  // data migration entirely.
  COMPLETED = 'COMPLETED',
  // A request linked to an existing activity instead of becoming its own
  // new one. Distinct from SCHEDULED — a LINKED request never gets its own
  // activity at all; it's purely a reference to someone else's job.
  LINKED = 'LINKED',
  CANCELLED = 'CANCELLED'
}

export interface SalesAppointmentRequest {
  id: string;
  customerId?: string;
  customerName: string;
  contactNumber: string;
  locationUrl: string;
  houseNumber: string;
  odooReference: string;
  activityType: string;          // Installation | Troubleshooting | Inspection | Survey
  serviceCategory: string;       // multi-value joined string (same pattern as Activity)
  salesLeadUserId: string;
  salesLeadName: string;
  remarks?: string;
  status: SalesRequestStatus;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  assignedFieldEngineerId?: string | null;
  linkedActivityId?: string | null;  // populated when SAR is linked to an existing activity instead of getting its own
  linkNote?: string | null;          // mandatory internal note explaining why this was linked rather than scheduled new
  linkedBy?: string | null;          // user ID of the Team Lead/Admin who linked it
  linkedAt?: string | null;          // ISO timestamp of when it was linked
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Completion Feedback & Google Review QR flow ────────────────────────────
export enum ResolutionStatus {
  COMPLETED = 'COMPLETED',
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED',
  NOT_COMPLETED = 'NOT_COMPLETED',
}

// Not every customer is willing or able to rate the service — these are the
// reasons an engineer can give instead, one tap, no typing required.
export enum SkipReason {
  CUSTOMER_UNAVAILABLE = 'CUSTOMER_UNAVAILABLE',
  DECLINED = 'DECLINED',
  LANGUAGE_BARRIER = 'LANGUAGE_BARRIER',
  OTHER = 'OTHER',
}

export interface ServiceFeedback {
  id: number;
  activityId?: string | null;
  ticketId?: string | null;
  engineerId?: string | null;
  engineerName?: string | null;
  customerName?: string | null;
  rating: number | null; // 1-5, null when skipped
  resolutionStatus: ResolutionStatus | null; // optional — null when skipped, or simply not collected for this submission
  comment?: string | null;
  googleReviewPromptShown: boolean;
  followUpRequired: boolean;
  followUpResolved: boolean;
  skipped: boolean;
  skipReason?: SkipReason | null;
  createdAt: string;
  // Only present on the single-item detail fetch (GET /api/service-feedback/:id)
  // — joined live from the linked activity/ticket, not stored on the
  // feedback row itself, so it stays accurate even if assignments change later.
  serviceCategory?: string | null;
  salesLeadName?: string | null;
  assistantTechNames?: string[];
}
