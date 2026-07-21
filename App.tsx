import React, { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import toast, { Toaster } from './components/Toast';
import { generateActivityId } from './utils/idUtils';
import { Ticket, TicketStatus, TicketType, Priority, Technician, Customer, Activity, Team, Site, MessageSender, Role } from './types';
import { APP_NAME, NAVIGATION_ITEMS } from './constants';
import {
  Menu, X, Search, Bell, LogOut, ChevronDown, Maximize2, Minimize2, KeyRound, EyeOff, Eye as EyeIcon, RefreshCw
} from 'lucide-react';

// Login + ErrorBoundary load eagerly (needed immediately)
import Login from './components/Login';
import { ErrorBoundary } from './components/ErrorBoundary';

// Everything else loads lazily (only when needed)
const Dashboard = lazy(() => import('./components/Dashboard'));
const TicketManagement = lazy(() => import('./components/TicketManagement'));
const OperationsDashboard = lazy(() => import('./components/OperationsDashboard'));
const PlanningModule = lazy(() => import('./components/PlanningModule'));
const AMCContracts = lazy(() => import('./components/AMCContracts'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const ServiceFeedbackPage = lazy(() => import('./components/ServiceFeedback'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const TeamCRM = lazy(() => import('./components/TeamCRM'));
const MobileLeadPortal = lazy(() => import('./components/MobileLeadPortal').then(m => ({ default: m.MobileLeadPortal || m.default })));
const MobileTechPortal = lazy(() => import('./components/MobileTechPortal'));
const CustomerRecords = lazy(() => import('./components/CustomerRecords'));
const AIChatBot = lazy(() => import('./components/AIChatBot'));
const SystemDataTools = lazy(() => import('./components/SystemDataTools'));
const WhatsAppMonitor = lazy(() => import('./components/WhatsAppMonitor'));
const AuditLog = lazy(() => import('./components/AuditLog'));
const TVDisplayMode = lazy(() => import('./components/TVDisplayMode'));
const CompletedJobSummary = lazy(() => import('./components/CompletedJobSummary'));
const MasterDashboard = lazy(() => import('./components/MasterDashboard'));
const SalesAppointmentRequests = lazy(() => import('./components/SalesAppointmentRequests'));

// Loading fallback component
const LoadingFallback = () => (
    <div className="flex items-center justify-center h-full py-20">
        <div className="text-center">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-sm text-slate-500">Loading...</p>
        </div>
    </div>
);

// ── Client-side safety net for VIEWER (read-only) accounts ──────────────
// Real enforcement lives server-side: backend/server.js's `authenticate`
// middleware hard-blocks every non-GET/HEAD/OPTIONS request for a VIEWER
// account, on every route that uses it (i.e. virtually everything). This
// wrapper is just a UX nicety — it avoids a wasted round trip and shows a
// clear message instead of a raw failed-request error. Installed once at
// module load; re-reads the saved user from localStorage on every call so
// it stays correct across login/logout without requiring a page reload.
if (typeof window !== 'undefined' && !(window as any).__qonnectFetchGuarded) {
  (window as any).__qonnectFetchGuarded = true;
  const _originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const method = (init?.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      if (url.includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const saved = localStorage.getItem('qonnect_user');
        const role = saved ? JSON.parse(saved)?.role : null;
        if (role === 'VIEWER') {
          toast.error("You have view-only access and can't make changes.");
          return Promise.reject(new Error('View-only account: action blocked'));
        }
      }
    } catch {}
    return _originalFetch(input as any, init);
  }) as typeof window.fetch;
}

const QonnectLogo = ({ className, size = 30 }: { className?: string; size?: number }) => (
  <svg viewBox="0 0 578 578" xmlns="http://www.w3.org/2000/svg" className={className} width={size} height={size}>
    <path d="M409.18,407.51a113.86,113.86,0,1,0-225.35,32.32l45-36.75a69.77,69.77,0,0,1,135.75,4.43Z" transform="translate(-8.5 -132)" fill="#fdbb40"/>
    <rect x="251.37" y="404.96" width="30.72" height="30.72"/>
    <rect x="293.23" y="404.96" width="30.72" height="30.72"/>
    <rect x="251.37" y="447.04" width="30.72" height="30.72"/>
    <rect x="293.23" y="447.04" width="30.72" height="30.72"/>
    <path d="M297.5,220.76C186.94,220.76,97,310.71,97,421.27A200.3,200.3,0,0,0,112.27,498l36.14-29.53a156.51,156.51,0,0,1-7.3-47.21c0-86.24,70.15-156.4,156.39-156.4S453.89,335,453.89,421.27a156.33,156.33,0,0,1-7.42,47.57l36.11,29.49A200.38,200.38,0,0,0,498,421.27C498,310.71,408.06,220.76,297.5,220.76Z" transform="translate(-8.5 -132)" fill="#fdbb40"/>
    <path d="M297.5,132c-159.35,0-289,129.64-289,289A287.17,287.17,0,0,0,41.63,555.23l35-28.57A243.44,243.44,0,0,1,52.61,421c0-135,109.86-244.89,244.89-244.89S542.39,286,542.39,421A243.47,243.47,0,0,1,518,527.49l35,28.55A287.17,287.17,0,0,0,586.5,421C586.5,261.64,456.85,132,297.5,132Z" transform="translate(-8.5 -132)" fill="#fdbb40"/>
    <path d="M247.31,506.42l49.61-43.28,43.65,33.92,37-.7-.13,30.39,56,45.68a.78.78,0,0,0,.05-.14l66.75,54.48A289.41,289.41,0,0,0,529,593.6l-34.38-28h0l-73.11-60,.3-54.08-65.73.08-59.39-48L106.09,559.8,65.5,593.13c8.73,11.73,18.34,25.41,28.71,35.68L247.3,506.42Z" transform="translate(-8.5 -132)"/>
    <path d="M430.33,626.59A244.06,244.06,0,0,1,164,626.13L128.4,655.2a288.32,288.32,0,0,0,337.55.48Z" transform="translate(-8.5 -132)"/>
  </svg>
);

function App() {
  // --- Auth Helper — must be first so all handlers can use it ---
  const getAuthHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('qonnect_token') || ''}`
  });

  // --- Global State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
// Data State
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  // Lifted up from SalesAppointmentRequests.tsx (which still fetches its own
  // copy for its own live filtering) so other screens — Customer History —
  // can show SAR data too, without needing their own separate fetch.
  const [salesAppointmentRequests, setSalesAppointmentRequests] = useState<any[]>([]);
  const [portalDataReady, setPortalDataReady] = useState(false);

  // UI State - Persistent Sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
      if (typeof window !== 'undefined') {
          const saved = localStorage.getItem('sidebarCollapsed');
          return saved === 'true';
      }
      return false;
  });

  const [activeView, setActiveView] = useState('master_dashboard');

  // Persist the current page so a browser refresh can restore it (see the
  // session-restore effect below) — only meaningful for Admin/desktop Team
  // Lead, who have free navigation across the app; other roles always
  // re-route to their dedicated view on refresh regardless of this value.
  useEffect(() => {
    localStorage.setItem('qonnect_active_view', activeView);
  }, [activeView]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter | null>(null);
  const [prefillActivity, setPrefillActivity] = useState<any>(null);
  const [slaAlerts, setSlaAlerts] = useState<any[]>([]);
  const [showSlaPanel, setShowSlaPanel] = useState(false);
  const [slaLastChecked, setSlaLastChecked] = useState<Date | null>(null);
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [targetActivityId, setTargetActivityId] = useState<string | null>(null);

  // TV Display Mode — detected from URL hash
  const [isTVMode, setIsTVMode] = useState(() => window.location.hash === '#tv');

  // Completed Job Summary — unified popup for completed tickets/activities
  const [showChatBot, setShowChatBot] = useState(false);
  const [completedSummary, setCompletedSummary] = useState<{ type: 'ticket' | 'activity', item: any } | null>(null);

  // Listen for hash changes (TV mode toggle)
  useEffect(() => {
    const handleHash = () => setIsTVMode(window.location.hash === '#tv');
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // --- Global Search State ---
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);

  // --- Notification State ---
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // --- Profile Menu State (shared app-shell dropdown) ---
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // SALES password change modal (triggered from key icon in header)
  const [showSalesPwModal, setShowSalesPwModal] = useState(false);
  const [salesPwForm, setSalesPwForm] = useState({ current: '', next: '', confirm: '' });
  const [salesPwError, setSalesPwError] = useState('');
  const [salesPwSuccess, setSalesPwSuccess] = useState(false);
  const [salesPwLoading, setSalesPwLoading] = useState(false);
  const [salesShowPw, setSalesShowPw] = useState({ current: false, next: false, confirm: false });
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('qonnect_read_notifs');
      return new Set(saved ? JSON.parse(saved) : []);
    } catch { return new Set(); }
  });

  const markAsRead = (id: string) => {
    setReadNotifIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('qonnect_read_notifs', JSON.stringify([...next]));
      return next;
    });
  };

  const globalSearchResults = useMemo(() => {
      if (!globalSearchQuery || globalSearchQuery.length < 2) return null;
      const lower = globalSearchQuery.toLowerCase();
      return {
          tickets: tickets.filter(t => 
              t.id.toLowerCase().includes(lower) || 
              t.customerName.toLowerCase().includes(lower) || 
              t.phoneNumber.includes(lower)
          ).slice(0, 3),
          customers: customers.filter(c => 
              c.name.toLowerCase().includes(lower) || 
              c.phone.includes(lower)
          ).slice(0, 3),
          team: technicians.filter(t => 
              t.name.toLowerCase().includes(lower) || 
              t.role.toLowerCase().includes(lower)
          ).slice(0, 3),
          activities: activities.filter(a => {
              const siteName = sites.find(s => s.id === a.siteId)?.name || '';
              return a.reference.toLowerCase().includes(lower) || siteName.toLowerCase().includes(lower);
          }).slice(0, 3)
      };
  }, [globalSearchQuery, tickets, customers, technicians, activities, sites]);

  const hasGlobalResults = globalSearchResults && (
      globalSearchResults.tickets.length > 0 || 
      globalSearchResults.customers.length > 0 || 
      globalSearchResults.team.length > 0 || 
      globalSearchResults.activities.length > 0
  );

  const handleGlobalNav = (type: string, id: string) => {
      setGlobalSearchQuery('');
      setIsGlobalSearchFocused(false);
      
      // Check if the item is completed — if so, open in summary view
      if (type === 'ticket') {
          const ticket = tickets.find(t => t.id === id);
          if (ticket && (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CANCELLED)) {
              setCompletedSummary({ type: 'ticket', item: ticket });
              return;
          }
          setActiveView('tickets');
          setTicketFilter({ ticketId: id });
      } else if (type === 'activity') {
          const activity = activities.find(a => a.id === id);
          if (activity && (activity.status === 'DONE' || activity.status === 'CANCELLED' || activity.status === 'CARRY_FORWARD')) {
              setCompletedSummary({ type: 'activity', item: activity });
              return;
          }
          setActiveView('planning');
          setTargetActivityId(id);
      } else if (type === 'customer') {
          setActiveView('customers');
      } else if (type === 'team') {
          setActiveView('team');
      }
  };

  // Toggle Handler
  const toggleSidebar = () => {
      setSidebarCollapsed(prev => {
          const newState = !prev;
          localStorage.setItem('sidebarCollapsed', String(newState));
          return newState;
      });
  };

  // --- Notification Feed (role-aware, activity-based) ---
  const activeUserNotifications = useMemo(() => {
      if (!currentUser) return [];
      const notifs: { id: string; message: string; time: Date; type: string; ticketId?: string }[] = [];

      if (currentUser.role === Role.ADMIN || currentUser.role === Role.TEAM_LEAD) {
          // New unassigned tickets
          tickets
            .filter(t => t.status === TicketStatus.NEW && !t.assignedTechId)
            .forEach(t => notifs.push({
              id: `new-${t.id}`,
              message: `New ticket ${t.id} — ${t.customerName} (${t.category || 'Support'})`,
              time: new Date(t.createdAt),
              type: 'new_ticket',
              ticketId: t.id
            }));

          // Carry forward tickets (last 24h)
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
          tickets
            .filter(t => t.status === TicketStatus.CARRY_FORWARD && new Date(t.updatedAt) > since)
            .forEach(t => notifs.push({
              id: `cf-${t.id}-${t.updatedAt}`,
              message: `Carry Forward: ${t.id} — ${t.customerName}${t.carryForwardNote ? ` · ${t.carryForwardNote}` : ''}`,
              time: new Date(t.updatedAt),
              type: 'carry_forward',
              ticketId: t.id
            }));

          // Recent status changes (last 12h)
          const since12 = new Date(Date.now() - 12 * 60 * 60 * 1000);
          tickets
            .filter(t => [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED].includes(t.status) && new Date(t.updatedAt) > since12)
            .forEach(t => notifs.push({
              id: `status-${t.id}-${t.status}`,
              message: `${t.id} marked ${t.status.replace('_', ' ')} — ${t.customerName}`,
              time: new Date(t.updatedAt),
              type: 'status_change',
              ticketId: t.id
            }));

      } else if (currentUser.role === Role.FIELD_ENGINEER) {
          // Assigned jobs for this engineer
          const myId = (currentUser as any).techId || (currentUser as any).id;
          tickets
            .filter(t => t.assignedTechId === myId && [TicketStatus.ASSIGNED, TicketStatus.OPEN].includes(t.status))
            .forEach(t => notifs.push({
              id: `assigned-${t.id}`,
              message: `New job assigned: ${t.id} — ${t.customerName} (${t.category || 'Support'})`,
              time: new Date(t.updatedAt),
              type: 'assigned',
              ticketId: t.id
            }));
      } else if (currentUser.role === Role.SALES) {
          // Sales users: show when their own requests get scheduled (status changed from PENDING)
          // This is driven from the activities list — look for recently created activities
          // linked back to their requests (created within last 24h)
          const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const myId = (currentUser as any).techId || (currentUser as any).id;
          activities
            .filter(a =>
              a.details?.salesLeadId === myId &&
              new Date(a.createdAt) > since24h
            )
            .forEach(a => notifs.push({
              id: `sales-sched-${a.id}`,
              message: `Your appointment request has been scheduled: ${a.reference} — ${a.customerName || ''}`,
              time: new Date(a.createdAt),
              type: 'sales_scheduled',
            }));
      }

      // Sort newest first
      return notifs.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 20);
  }, [tickets, currentUser]);

  // --- Auth Handlers ---
const [loginError, setLoginError] = React.useState<string>('');

const handleLogin = async (email: string, pass: string) => {
      setLoginError('');
      try {
          const res = await fetch("/api/login", {
              method: "POST",
              headers: getAuthHeaders(),
              body: JSON.stringify({ email, password: pass })
          });

          if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              setLoginError(errData.error || 'Invalid credentials. Please try again.');
              return;
          }

          const data = await res.json();

          // Store token and user
          localStorage.setItem('qonnect_token', data.token);
          localStorage.setItem('qonnect_user', JSON.stringify({
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              role: data.user.role,
              techId: data.user.id
          }));

          setCurrentUser({
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              role: data.user.role,
              techId: data.user.id,
              avatar: data.user.avatar || undefined,
          });
          setLoginError('');
          if (data.user.role === Role.FIELD_ENGINEER) {
              setActiveView('tech_portal');
          } else if (data.user.role === Role.SALES) {
              setActiveView('sales_requests');
          } else if (data.user.role === Role.TEAM_LEAD && window.innerWidth < 768) {
              setActiveView('lead_portal');
          } else {
              setActiveView('master_dashboard');
          }

      } catch (error) {
          console.error("Login Error:", error);
          setLoginError('Unable to connect to server. Please try again.');
      }
  };

const handleLogout = useCallback(() => {
      localStorage.removeItem('qonnect_token');
      localStorage.removeItem('qonnect_user');
      localStorage.removeItem('qonnect_active_view');
      setCurrentUser(null);
      setActiveView('master_dashboard');
  }, []);

  // --- Data Handlers ---
  // Auto-transition NEW → OPEN when a ticket is first opened/viewed on desktop
  const handleOpenTicket = async (ticket: Ticket) => {
      if (ticket.status !== 'NEW') return; // only act on NEW tickets
      const updated = { ...ticket, status: 'OPEN' as any, updatedAt: new Date().toISOString() };
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
      try {
          await fetch(`/api/tickets/${ticket.id}/status`, {
              method: "PUT",
              headers: getAuthHeaders(),
              body: JSON.stringify({ status: 'OPEN' })
          });
      } catch (e) { console.error("Failed to auto-open ticket:", e); }
  };

  const handleUpdateTicket = useCallback(async (updated: Ticket) => {
      // Optimistic UI update immediately
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
      try {
          // Save status + assignment + appointment + completion note to DB
          await fetch(`/api/tickets/${updated.id}/status`, {
              method: "PUT",
              headers: getAuthHeaders(),
              body: JSON.stringify({
                  status: updated.status,
                  assignedTechId: updated.assignedTechId || null,
                  appointmentTime: updated.appointmentTime || null,
                  carryForwardNote: updated.carryForwardNote || null,
                  nextPlannedAt: updated.nextPlannedAt || null,
                  completionNote: updated.completionNote || null,
              })
          });
          // Also persist full ticket fields (category, type, priority, location etc.)
          // NOTE: Do NOT send customerId/customerName here — status updates should NEVER overwrite customer
          await fetch(`/api/tickets/${updated.id}`, {
              method: "PUT",
              headers: getAuthHeaders(),
              body: JSON.stringify({
                  category: updated.category,
                  priority: updated.priority,
                  type: updated.type,
                  locationUrl: updated.locationUrl,
                  houseNumber: updated.houseNumber,
                  odooLink: updated.odooLink,
                  assignedTechId: updated.assignedTechId || null,
                  appointmentTime: updated.appointmentTime || null,
                  // Also persist customer link changes + phone
                  customerId: updated.customerId || null,
                  customerName: updated.customerName || null,
                  phoneNumber: updated.phoneNumber || null,
                  // Photos were previously never sent here at all, so a field
                  // engineer's uploaded photo would show briefly in this screen's
                  // own optimistic state, then vanish the moment loadTickets()
                  // reloaded fresh data from the server — where it had never
                  // actually been saved.
                  photos: updated.photos || undefined,
              })
          });
          // Reload from DB to keep state fresh (mirrors handleUpdateActivity)
          await loadTickets();
      } catch (e) {
          console.error("Failed to update ticket:", e);
          // Keep optimistic update on failure
      }
  }, []);

  const handleCreateTicket = async (data: any) => {
    // This is a TEMPORARY placeholder ID only — used so the new ticket can
    // appear on screen instantly, before the server has responded. It is
    // never sent as a real ID and never persists: the moment the server
    // responds with the real, canonical ticket (assigned by an atomic
    // database sequence), the placeholder below is replaced with it.
    // This is what fixes the duplicate/overwritten-ticket bug — previously
    // the client-generated ID (from a per-device localStorage counter) WAS
    // the permanent ID, so two devices could land on the same number.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    // If engineer pre-assigned at creation, start as ASSIGNED not NEW
    const initialStatus = data.assignedTechId ? TicketStatus.ASSIGNED : TicketStatus.NEW;

    const optimistic: Ticket = {
      ...data, id: tempId, status: initialStatus,
      createdAt: now, updatedAt: now, messages: [],
      priority: data.priority || Priority.MEDIUM,
      unreadCount: 0
    };
    // Optimistic: show immediately
    setTickets(prev => [optimistic, ...prev]);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...data, status: initialStatus,
          createdAt: now, messages: []
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Ticket create failed");
      }
      // Server returns the canonical ticket (real server-assigned ID) —
      // swap the temp placeholder out for it immediately so the UI never
      // shows two rows for the same ticket while waiting on the next sync.
      const serverTicket = await res.json();
      setTickets(prev => prev.map(t => t.id === tempId ? serverTicket : t));
      // Background sync — delay to ensure DB has committed
      setTimeout(() => loadTickets(), 2000);
    } catch (e) {
      console.error("Failed to create ticket:", e);
      // Rollback optimistic update
      setTickets(prev => prev.filter(t => t.id !== tempId));
      toast.error("Failed to create ticket.");
    }
  };


  const handleDeleteTicket = async (id: string) => {
      if (!id) return; // Child component is responsible for user confirmation
      try {
          const response = await fetch(`/api/tickets/${id}`, {
              method: "DELETE",
              headers: getAuthHeaders()
          });
          if (response.ok) {
              setTickets(prev => prev.filter(t => t.id !== id));
              await loadTickets();
          } else {
              const err = await response.json().catch(() => ({}));
              toast.error(err.error || "Could not delete ticket");
          }
      } catch (e) {
          console.error("Delete ticket error:", e);
          toast.error("Failed to connect to the server. Check your connection.");
      }
  };

  const handleSendMessage = async (ticketId: string, content: string, sender: MessageSender) => {
      const newMsg = {
          id: `m-${Date.now()}`,
          sender,
          content,
          timestamp: new Date().toISOString(),
          at: new Date().toISOString()
      };
      // Optimistic UI update
      setTickets(prev => prev.map(t => {
          if (t.id !== ticketId) return t;
          return {
              ...t,
              updatedAt: new Date().toISOString(),
              messages: [...(t.messages || []), newMsg]
          };
      }));
      // Persist to DB
      try {
          await fetch(`/api/tickets/${ticketId}/message`, {
              method: "POST",
              headers: getAuthHeaders(),
              body: JSON.stringify({ sender, content })
          });
      } catch (e) {
          console.error("Failed to save message:", e);
      }
  };

  // Activity save guard — prevents double-submit
  const [isSavingActivity, setIsSavingActivity] = useState(false);

  // Activity Handlers (API-Connected)
  const handleAddActivity = useCallback(async (act: any) => {
      if (isSavingActivity) return; // prevent double-submit
      setIsSavingActivity(true);
      const newId = generateActivityId();
      const now = new Date().toISOString();
      const payload = { ...act, id: newId, reference: newId, status: act.status || 'PLANNED', createdAt: now, updatedAt: now };
      // Optimistic: show immediately
      setActivities(prev => [payload as Activity, ...prev]);
      try {
          const res = await fetch("/api/activities", {
              method: "POST",
              headers: getAuthHeaders(),
              body: JSON.stringify(payload)
          });
          if (!res.ok) {
              // Rollback
              setActivities(prev => prev.filter(a => a.id !== newId));
              console.error('Failed to create activity:', res.status);
          } else {
              // Reload immediately so server-canonical ID replaces temp client ID
              await loadActivities();
              syncActivityLocationToCustomer(act);
          }
      } catch (e) {
          console.error("Failed to add activity", e);
          setActivities(prev => prev.filter(a => a.id !== newId));
      } finally {
          setIsSavingActivity(false);
      }
  }, [isSavingActivity]);

  const handleUpdateActivity = useCallback(async (updated: Activity) => {
      // Note: removed isSavingActivity guard — was silently dropping status updates
      setIsSavingActivity(true);
      // Optimistic UI update immediately — so buttons reflect new status instantly
      setActivities(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
      try {
          const res = await fetch(`/api/activities/${updated.id}`, {
              method: "PUT",
              headers: getAuthHeaders(),
              body: JSON.stringify(updated)
          });
          if (res.ok) {
              // For status changes (DONE, CANCELLED etc): trust optimistic update — don't reload
              // Reloading races with polling and can briefly show stale status
              const statusChanged = updated.status !== undefined;
              if (!statusChanged) {
                  // Only reload for non-status changes (e.g. field edits) to get server fields
                  await loadActivities();
              }
              syncActivityLocationToCustomer(updated);
          } else {
              // Rollback on failure
              console.error('Failed to update activity:', res.status);
              await loadActivities(); // Reload to restore correct state
          }
      } catch (e) {
          console.error("Failed to update activity", e);
          await loadActivities();
      } finally {
          setIsSavingActivity(false);
      }
  }, [isSavingActivity]);

  // When an activity has a customer + location/building, update the customer record if its fields are empty.
  // Only fires when location data is present AND different from what the customer already has.
  const syncActivityLocationToCustomer = async (act: any) => {
      try {
          const custId = act.customerId;
          if (!custId) return;
          // Must have actual location data to sync
          const locationUrl = (act.locationUrl || '').trim();
          const houseNumber = (act.houseNumber || '').trim();
          if (!locationUrl && !houseNumber) return; // Nothing to sync
          const cust = customers.find(c => c.id === custId);
          if (!cust) return;
          // Only update fields that are empty on the customer record
          const needsAddress = !cust.address?.trim() && locationUrl;
          const needsBuilding = !(cust as any).buildingNumber?.trim() && houseNumber;
          if (!needsAddress && !needsBuilding) return; // Customer already has this info
          await fetch(`/api/customers/${encodeURIComponent(custId)}`, {
              method: "PUT",
              headers: getAuthHeaders(),
              body: JSON.stringify({
                  ...(needsAddress ? { address: locationUrl } : {}),
                  ...(needsBuilding ? { buildingNumber: houseNumber } : {})
              })
          });
          await loadCustomers();
      } catch (e) { /* silent — non-critical sync */ }
  };

  const handleDeleteActivity = async (id: string) => {
      if (!id) return; // Child component (PlanningModule) is responsible for user confirmation
      try {
          const res = await fetch(`/api/activities/${id}`, { method: "DELETE", headers: getAuthHeaders() });
          if (res.ok) await loadActivities(); // Refresh from DB
      } catch (e) { console.error("Failed to delete activity", e); }
  };
  
const loadTickets = async () => {
    try {
      const res = await fetch("/api/tickets", { headers: getAuthHeaders() });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (Array.isArray(data)) setTickets(data);
    } catch (e) {
      console.error("Failed to load tickets", e);
    }
  };

  const loadActivities = async () => {
    try {
      const res = await fetch("/api/activities", { headers: getAuthHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
          setActivities(data);
          // Note: viewingActivity in child components will naturally refresh
          // because it derives from the activities array passed as a prop
      }
    } catch (e) {
      console.error("Failed to load activities", e);
    }
  };

  const loadSalesAppointmentRequests = async () => {
    try {
      const res = await fetch("/api/sales-appointment-requests", { headers: getAuthHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setSalesAppointmentRequests(data);
    } catch (e) {
      console.error("Failed to load sales appointment requests", e);
    }
  };

  const loadTeams = async () => {
    try {
      const res = await fetch("/api/teams", { headers: getAuthHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setTeams(data);
    } catch (e) { console.error("Failed to load teams", e); }
  };

  const loadSites = async () => {
    try {
      const res = await fetch("/api/sites", { headers: getAuthHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setSites(data);
    } catch (e) { console.error("Failed to load sites", e); }
  };
  
// Customer Handlers (API-first)
const handleAddCustomer = async (c: Customer): Promise<Customer | null> => {
  try {
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: c.name,
        phone: (c as any).phone,
        email: (c as any).email,
        address: (c as any).address,
        notes: (c as any).notes,
        is_active: (c as any).is_active ?? true,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || "Failed to create customer");
    }

    // Return the DB-created customer (with real server-assigned ID)
    const created = await res.json();
    await loadCustomers();
    return created as Customer;
  } catch (e) {
    console.error(e);
    toast.error("Failed to create customer");
    return null;
  }
};

const handleUpdateCustomer = async (c: Customer) => {
  try {
    const id = (c as any)?.id ? String((c as any).id).trim() : "";
    if (!id) {
      console.error("🚨 Update customer called without id:", c);
      toast.error("Failed to update customer: missing ID.");
      return;
    }

    const payload = {
      name: c.name,
      phone: (c as any).phone,
      email: (c as any).email,
      address: (c as any).address,
      buildingNumber: (c as any).buildingNumber,
      notes: (c as any).notes,
      is_active: (c as any).is_active ?? true,
    };


    const res = await fetch(`/api/customers/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Update failed:", res.status, text);
      toast.error(`Failed to update customer (${res.status})`);
      return;
    }

    await loadCustomers();
  } catch (e) {
    console.error("Update exception:", e);
    toast.error("Failed to update customer");
  }
};

const handleDeleteCustomer = async (id: string) => {
  try {
    const res = await fetch(`/api/customers/${id}`, { method: "DELETE", headers: getAuthHeaders() });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || "Failed to delete customer");
    }

    await loadCustomers();
  } catch (e) {
    console.error(e);
    toast.error("Failed to delete customer");
  }
};

  // Tech/User Handlers — saves to database via API
  const handleSaveUser = async (u: Technician) => {
      try {
          const exists = technicians.find(x => x.id === u.id);
          if (exists) {
              // Update existing user
              // SALES gets its own system role for auth; TECHNICAL_ASSOCIATE stays NONE
              const isNonLoginLevel = u.level === 'TECHNICAL_ASSOCIATE';
              const effectiveRole = isNonLoginLevel ? 'NONE' : (u.systemRole || null);
              const res = await fetch(`/api/users/${u.id}`, {
                  method: "PUT",
                  headers: getAuthHeaders(),
                  body: JSON.stringify({
                      name: u.name,
                      email: u.email,
                      role: effectiveRole,
                      job_role: (u as any).jobRole || null,
                      level: u.level || null,
                      status: u.isActive === false ? 'INACTIVE' : (u.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'),
                      phone: u.phone || null,
                      avatar: u.avatar || null,
                      ...(u.password ? { password: u.password } : {})
                  })
              });
              if (!res.ok) throw new Error("Failed to update user");
          } else {
              // Create new user
              const res = await fetch("/api/users", {
                  method: "POST",
                  headers: getAuthHeaders(),
                  body: JSON.stringify({
                      id: u.id,
                      name: u.name,
                      email: u.email,
                      password: u.password || "Qonnect@123",
                      job_role: (u as any).jobRole || null,
                      level: u.level || null,
                      role: u.systemRole || u.role || null,
                      status: (u.status === 'AVAILABLE' || u.status === 'ACTIVE') ? 'ACTIVE' : (u.isActive === false ? 'INACTIVE' : 'ACTIVE'),
                      phone: u.phone || null,
                      avatar: u.avatar || null
                  })
              });
              if (!res.ok) throw new Error("Failed to create user");
          }
          // Reload from DB to keep state in sync
          await loadUsers();
      } catch (e) {
          console.error("handleSaveUser error:", e);
          toast.error("Failed to save user. Please try again.");
      }
  };

  const handleDeleteUser = async (id: string) => {
      try {
          const res = await fetch(`/api/users/${id}`, { method: "DELETE", headers: getAuthHeaders() });
          if (!res.ok) throw new Error("Failed to delete user");
          await loadUsers();
      } catch (e) {
          console.error("handleDeleteUser error:", e);
          toast.error("Failed to delete user. Please try again.");
      }
  };

  const handleChangePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<void> => {
      const res = await fetch(`/api/users/${userId}/password`, {
          method: "PUT",
          headers: getAuthHeaders(),
          body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");
  };

  // System Import Handler
  const handleSystemImport = async (data: any) => {
      // `data` is no longer a pre-merged payload — the actual merge now
      // happens server-side (see SystemDataTools' executeImport, which
      // calls POST /api/system/import). Once that write completes, this
      // just reloads everything fresh from the database so the screen
      // reflects what was genuinely saved, rather than trusting a client
      // computed merge that previously never made it to Postgres at all.
      await Promise.all([
          loadTickets(), loadActivities(), loadCustomers(),
          loadTeams(), loadSites(), loadUsers(),
      ]);
  };

const loadCustomers = async () => {
  try {
    const res = await fetch("/api/customers", { headers: getAuthHeaders() });
    const data = await res.json();
    if (Array.isArray(data)) setCustomers(data);
  } catch (e) {
    console.error("Failed to load customers", e);
  }
};

// FAST: Mobile-specific lightweight data load
  const loadMobileData = async (portal: 'lead' | 'tech') => {
      try {
          const endpoint = portal === 'lead' ? '/api/mobile/lead' : '/api/mobile/tech';
          const res = await fetch(endpoint, { headers: getAuthHeaders() });
          if (res.status === 401) { handleLogout(); return; }
          if (!res.ok) throw new Error('Mobile load failed');
          const data = await res.json();
          if (data.tickets) setTickets(data.tickets);
          if (data.activities) setActivities(data.activities);
          if (data.technicians) {
              const usersWithLevel = data.technicians.map((u: any) => {
                  let level = u.level || '';
                  if (!level && (u.systemRole || u.role)) {
                      const r = u.systemRole || u.role;
                      if (r === 'ADMIN') level = 'ADMIN';
                      else if (r === 'TEAM_LEAD') level = 'TEAM_LEAD';
                      else if (r === 'FIELD_ENGINEER') level = 'FIELD_ENGINEER';
                  }
                  return { ...u, level, role: u.systemRole || u.role };
              });
              setTechnicians(usersWithLevel);
          }
          if (data.customers) setCustomers(data.customers);
          if (data.teams) setTeams(data.teams);
          if (data.sites) setSites(data.sites);
      } catch (e) {
          console.error("Mobile load failed, using full init:", e);
          await loadAllData();
      }
  };

// FAST: Single-call init — replaces 6 separate API calls
  const loadAllData = async () => {
      try {
          const res = await fetch("/api/init", { headers: getAuthHeaders() });
          if (res.status === 401) { handleLogout(); return; }
          if (!res.ok) throw new Error('Init failed');
          const data = await res.json();
          // Apply the same level derivation as loadUsers
          const usersWithLevel = (data.users || []).map((u: any) => {
              let level = u.level || '';
              if (!level && u.systemRole) {
                  if (u.systemRole === 'ADMIN') level = 'ADMIN';
                  else if (u.systemRole === 'TEAM_LEAD') level = 'TEAM_LEAD';
                  else if (u.systemRole === 'FIELD_ENGINEER') level = 'FIELD_ENGINEER';
              }
              return { ...u, level, role: u.systemRole };
          });
          if (data.users) setTechnicians(usersWithLevel);
          if (data.customers) setCustomers(data.customers);
          if (data.tickets) setTickets(data.tickets);
          if (data.activities) setActivities(data.activities);
          if (data.teams) setTeams(data.teams);
          if (data.sites) setSites(data.sites);
      } catch (e) {
          console.error("Fast init failed, falling back to individual loads:", e);
          await Promise.all([loadUsers(), loadCustomers(), loadTickets(), loadActivities(), loadTeams(), loadSites()]);
      }
  };

  // FAST: Single-call refresh — replaces 3 separate API calls
  const refreshData = async () => {
      try {
          const res = await fetch("/api/refresh", { headers: getAuthHeaders() });
          if (res.status === 401) return; // Don't wipe data on auth failure
          if (!res.ok) throw new Error('Refresh failed');
          const data = await res.json();
          if (data.tickets) setTickets(data.tickets);
          if (data.activities) setActivities(data.activities);
          if (data.customers) setCustomers(data.customers);
      } catch (e) {
          console.error("Fast refresh failed:", e);
      }
  };

  const loadUsers = async () => {
  try {
    const res = await fetch("/api/users", { headers: getAuthHeaders() });
    if (res.status === 401) { handleLogout(); return; }
    const data = await res.json();
    if (Array.isArray(data)) {
        // Derive 'level' from systemRole when not stored in DB
        const withLevel = data.map((u: any) => {
            // Prefer stored level from DB
            let level = u.level || '';
            // If level is blank, derive from systemRole
            if (!level || level === 'ADMIN') {
                if (u.systemRole === 'TEAM_LEAD')      level = 'TEAM_LEAD';
                else if (u.systemRole === 'ADMIN')      level = 'TEAM_LEAD'; // Admins appear with Team Leads
                else if (u.systemRole === 'FIELD_ENGINEER') level = 'FIELD_ENGINEER';
                else if (u.systemRole === 'SALES')      level = 'SALES';
                else if (u.systemRole === 'NONE')       level = ''; // TA — should have level set in DB
                else                                     level = 'FIELD_ENGINEER'; // safe default
            }
            return {
                ...u,
                level,
                jobRole: u.jobRole || u.job_role || ''
            };
        });
        setTechnicians(withLevel);
    }
  } catch (e) {
    console.error("Failed to load users", e);
  }
};

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!isNotifOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-notif-panel]')) setIsNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isNotifOpen]);

  // Close profile dropdown on outside click (same pattern as the notification panel above)
  useEffect(() => {
    if (!isProfileOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-profile-panel]')) setIsProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isProfileOpen]);

  // Lock background scroll while the mobile navigation drawer is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prevOverflow; };
    }
  }, [isMobileMenuOpen]);

  // Escape closes any open shell overlay (mobile drawer, notifications, profile menu)
  useEffect(() => {
    if (!isMobileMenuOpen && !isNotifOpen && !isProfileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
        setIsNotifOpen(false);
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobileMenuOpen, isNotifOpen, isProfileOpen]);

// --- Persistent Auth Check — validates token with server on every startup ---
  useEffect(() => {
    const savedToken = localStorage.getItem('qonnect_token');
    if (!savedToken) return; // no token → show login

    // Verify token is still valid with the server
    fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${savedToken}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Token invalid');
        return res.json();
      })
      .then(user => {
        // Token is valid — restore session
        localStorage.setItem('qonnect_user', JSON.stringify(user));
        setCurrentUser({ ...user, avatar: user.avatar || undefined });
        // Auto-route based on role and device. Field Engineer / Sales /
        // mobile Team Lead always land on their dedicated view on refresh —
        // those roles don't have free navigation across the rest of the
        // app, so there's no meaningful "page to preserve" for them.
        if (user.role === Role.FIELD_ENGINEER) {
          setActiveView('tech_portal');
        } else if (user.role === Role.SALES) {
          setActiveView('sales_requests');
        } else if (user.role === Role.TEAM_LEAD && window.innerWidth < 768) {
          setActiveView('lead_portal');
        } else {
          // Admin / desktop Team Lead — restore whichever page they were on
          // before the refresh, per the "browser refresh should preserve
          // the current page" requirement. Previously nothing was restored
          // here at all, so a refresh always silently fell back to
          // whatever activeView's default happened to be (Service
          // Dashboard) — this is the actual fix for that, not just
          // changing the default.
          const savedView = localStorage.getItem('qonnect_active_view');
          const isValidForRole = savedView && NAVIGATION_ITEMS.some(
            item => item.id === savedView && item.roles.includes(user.role)
          );
          // If the saved view doesn't exist or isn't allowed for this role
          // (e.g. stale data from a previous account), fall back to Master
          // Dashboard rather than risk landing on a blank screen.
          setActiveView(isValidForRole ? savedView : 'master_dashboard');
        }
      })
      .catch(() => {
        // Token expired or invalid — clear and show login
        localStorage.removeItem('qonnect_token');
        localStorage.removeItem('qonnect_user');
        localStorage.removeItem('qonnect_active_view');
        setCurrentUser(null);
      });
  }, []);
  
useEffect(() => {
    if (!currentUser) return;
    // Use lightweight mobile API for portals, full init for desktop
    const view = activeView;
    if (view === 'lead_portal') {
        loadMobileData('lead');
    } else if (view === 'tech_portal') {
        loadMobileData('tech');
    } else {
        loadAllData();
        // Independent of /api/init — Sales Appointment Requests has always
        // been loaded separately by its own screen; this just also loads it
        // at the App level so Customer History can show it without needing
        // its own redundant fetch.
        loadSalesAppointmentRequests();
    }
  }, [currentUser?.id || currentUser?.techId]);

// Lead Portal — render immediately, no blocking gate
useEffect(() => {
    if (activeView === 'lead_portal') setPortalDataReady(true);
}, [activeView]);

  // Auto-refresh — 15s for mobile portals, 30s for desktop
  useEffect(() => {
    if (!currentUser) return;
    let isRefreshing = false;
    const isMobilePortal = activeView === 'lead_portal' || activeView === 'tech_portal';
    const refreshMs = isMobilePortal ? 20000 : 45000; // Slower polling — less server load
    let lastRefreshTime = new Date().toISOString();
    // SLA alert check every 5 minutes
    const fetchSLA = async () => {
      try {
        const res = await fetch('/api/sla/alerts', { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          setSlaAlerts(data.allOverdue || []);
          setSlaLastChecked(new Date());
        }
      } catch(e) { /* non-critical */ }
    };
    fetchSLA();
    const slaInterval = setInterval(fetchSLA, 5 * 60 * 1000);

    const interval = setInterval(async () => {
      if (isRefreshing || document.hidden) return;
      isRefreshing = true;
      try {
        // Use incremental refresh — only fetch records changed since last poll
        const res = await fetch(`/api/refresh-lite?since=${encodeURIComponent(lastRefreshTime)}`, { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (data.hasChanges) {
            // Merge changed records into existing state (don't replace everything)
            if (data.tickets?.length > 0) {
              setTickets(prev => {
                const updated = new Map(prev.map(t => [t.id, t]));
                data.tickets.forEach((t: any) => updated.set(t.id, t));
                return Array.from(updated.values()).sort((a: any, b: any) => 
                  new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
                );
              });
            }
            if (data.activities?.length > 0) {
              setActivities(prev => {
                const updated = new Map(prev.map(a => [a.id, a]));
                data.activities.forEach((a: any) => updated.set(a.id, a));
                return Array.from(updated.values()).sort((a: any, b: any) => 
                  new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
                );
              });
            }
          }
          lastRefreshTime = data.timestamp || new Date().toISOString();
        }
      } catch(e) {
        console.error("Refresh error:", e);
      } finally {
        isRefreshing = false;
      }
    }, refreshMs);
    return () => { clearInterval(interval); clearInterval(slaInterval); };
  }, [activeView, currentUser]);
  
  // --- Navigation Logic ---
  const filteredNavItems = useMemo(() => {
      if (!currentUser) return [];
      const isDesktop = window.innerWidth >= 768;
      return NAVIGATION_ITEMS.filter(item => {
          if (!item.roles.includes(currentUser.role)) return false;
          // Admin no longer needs Lead Portal / Tech Portal in the sidebar —
          // these are working views for Team Leads / Field Engineers, not an
          // admin troubleshooting tool. This only hides the menu entry; the
          // views themselves are unaffected for Admin if reached another way,
          // and completely unaffected for Team Lead / Field Engineer.
          if (currentUser.role === Role.ADMIN && (item.id === 'lead_portal' || item.id === 'tech_portal')) return false;
          // Hide mobile portals on desktop for non-Admin roles
          if (isDesktop && currentUser.role !== Role.ADMIN && (item.id === 'lead_portal' || item.id === 'tech_portal')) return false;
          return true;
      });
  }, [currentUser]);

  const groupedNavItems = useMemo(() => {
      const groups: Record<string, typeof filteredNavItems> = {};
      filteredNavItems.forEach(item => {
          if (!groups[item.category]) groups[item.category] = [];
          groups[item.category].push(item);
      });
      return groups;
  }, [filteredNavItems]);

  const categoryOrder = useMemo(() => Object.keys(groupedNavItems), [groupedNavItems]);

  // Current nav entry — drives the small contextual label in the shared
  // header (category + page name), reusing the same NAVIGATION_ITEMS config
  // as the sidebar rather than a second source of truth.
  const currentNavItem = useMemo(
    () => NAVIGATION_ITEMS.find(item => item.id === activeView),
    [activeView]
  );

  // Shared focus-visible ring for shell controls (sidebar, header, dropdowns)
  const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00] focus-visible:ring-offset-1';

  // --- Render ---

  // ── TV Display Mode — Fullscreen read-only, NO LOGIN REQUIRED ──
  // Renders before login check — TV fetches its own data from public /api/tv-data endpoint
  if (isTVMode) {
    return <TVDisplayMode />;
  }

  if (!currentUser) {
      return <Login onLogin={handleLogin} error={loginError} />;
  }

  // ── Fullscreen Portal Mode ─────────────────────────────────────────────
  // Bypasses entire desktop layout — no sidebar, no header, no AI bot
  if (activeView === 'lead_portal') {
// Portal renders immediately — no blocking gate. Components handle their own loading states.

    return (
      <div className="fixed inset-0 z-[999] overflow-hidden" style={{background:'#f1f5f9'}}>
        <ErrorBoundary name='LeadPortal'>
        <Suspense fallback={<LoadingFallback />}>
        <MobileLeadPortal
          tickets={tickets}
          technicians={technicians}
          activities={activities}
          teams={teams}
          sites={sites}
          customers={customers}
          onAssign={(tId, techId) => {
            const t = tickets.find(x => x.id === tId);
            if (t) handleUpdateTicket({...t, assignedTechId: techId, status: TicketStatus.ASSIGNED});
          }}
          onUpdateTicket={handleUpdateTicket}
          onUpdateActivity={handleUpdateActivity}
          onAddActivity={handleAddActivity}
          onDeleteActivity={handleDeleteActivity}
          onAddCustomer={handleAddCustomer}
          onSaveCustomer={handleUpdateCustomer}
          onDeleteCustomer={handleDeleteCustomer}
          onCreateTicket={handleCreateTicket}
          onNavigateToSalesRequests={() => setActiveView('sales_requests')}
          onActivityCreated={() => { loadActivities(); }}
          isStandalone={true}
	  onLogout={handleLogout}
          onChangePassword={async (cur, nxt) => { await handleChangePassword(currentUser.techId ?? '', cur, nxt); }}
          focusedTicketId={focusedTicketId}
          currentUserId={currentUser.techId}
        />
        </Suspense>
        </ErrorBoundary>
      </div>
    );
  }

  if (activeView === 'tech_portal') {
    return (
      <div className="fixed inset-0 z-[999] overflow-hidden" style={{background:'#f1f5f9'}}>
        <ErrorBoundary name='TechPortal'>
        <Suspense fallback={<LoadingFallback />}>
        <MobileTechPortal
          tickets={tickets}
          activities={activities}
          customers={customers}
          technicians={technicians}
          currentTechId={currentUser.techId || ''}
          onUpdateStatus={(tId, status, note) => {
            const t = tickets.find(x => x.id === tId);
            if (t) handleUpdateTicket({
              ...t, 
              status,
              ...(status === 'RESOLVED' && note ? { completionNote: note } : {})
            });
          }}
          onUpdateActivity={handleUpdateActivity}
          onUpdateTicket={handleUpdateTicket}
          isStandalone={true}
          onLogout={handleLogout}
          onChangePassword={async (cur, nxt) => { await handleChangePassword(currentUser.techId ?? '', cur, nxt); }}
        />
        </Suspense>
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { borderRadius: '10px', fontFamily: 'inherit', fontSize: '14px', maxWidth: '420px' },
          success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
          error:   { duration: 5000, iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />

      {currentUser.role === Role.VIEWER && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg">
          <EyeIcon size={14} />
          View Only — changes are disabled for this account
        </div>
      )}
        
        {/* Mobile Overlay */}
        {isMobileMenuOpen && (
            <div 
                className="fixed inset-0 bg-slate-900/50 z-40 md:hidden backdrop-blur-sm"
                onClick={() => setIsMobileMenuOpen(false)}
            />
        )}

        {/* Sidebar — warm off-white anchor (no glass/blur here by design); Qonnect
            yellow reserved strictly for the active-item accent. */}
        <aside
            aria-label="Main navigation"
            className={`fixed inset-y-0 left-0 md:relative flex flex-col bg-[#F4F5F7] border-r border-black/[0.08] text-slate-900 z-50 transition-transform duration-200 ease-in-out md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} ${sidebarCollapsed ? 'md:w-[80px] w-[80px]' : 'md:w-[260px] w-[260px]'} ${currentUser.role === Role.SALES ? 'hidden' : ''}`}
        >
            
            {/* Sidebar Header — clicking the logo navigates to Master Dashboard.
                Reduced height + a subtle divider keeps this a clean, compact
                anchor rather than a heavy banner. */}
            <button
                type="button"
                onClick={() => { setActiveView('master_dashboard'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center border-b border-black/[0.08] shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-all duration-200 text-left ${FOCUS_RING} ${sidebarCollapsed ? 'justify-center py-4' : 'px-5 py-4 gap-3'}`}
                title="Go to Master Dashboard"
            >
            <div className="shrink-0 transition-all duration-300 flex items-center justify-center">
                <QonnectLogo size={sidebarCollapsed ? 34 : 30} />
            </div>
            
            <div className={`flex flex-col justify-center overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>
                <h1 className="text-[17px] font-semibold text-slate-900 leading-tight tracking-tight whitespace-nowrap">{APP_NAME}</h1>
                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-widest whitespace-nowrap mt-0.5">
                Field Operations Platform
                </div>
            </div>
            </button>
            
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
            {categoryOrder.map((cat, catIdx) => {
                const items = groupedNavItems[cat];
                if (!items || items.length === 0) return null;

                return (
                    <div key={cat} className={catIdx > 0 && !sidebarCollapsed ? 'pt-4 mt-4 border-t border-black/[0.055]' : ''}>
                        {/* Section Header — small, quiet uppercase label. Each
                            section (including single-item ones like Sales/Data)
                            keeps its heading so the grouping itself communicates
                            structure — Sales and Data are deliberately their own
                            sections to make room for future modules. */}
                        {!sidebarCollapsed && (
                            <h3 className="px-3 mb-2">
                                <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.11em]">
                                    {cat}
                                </span>
                            </h3>
                        )}
                        
                        {/* Collapsed Divider */}
                        {sidebarCollapsed && catIdx > 0 && <div className="border-t border-black/[0.08] mb-3 mx-4 pt-3" />}

                        <div className="space-y-0.5">
                            {items.map(item => {
                                const isActive = activeView === item.id;
                                return (
                                    <button
                                        type="button"
                                        key={item.id}
                                        title={sidebarCollapsed ? item.label : ''}
                                        aria-label={item.label}
                                        aria-current={isActive ? 'page' : undefined}
                                        onClick={() => {
                                            setActiveView(item.id);
                                            setIsMobileMenuOpen(false); // <--- Auto-close on mobile
                                            if (item.id !== 'tickets') setTicketFilter(null); 
                                            if (item.id !== 'lead_portal') setFocusedTicketId(null);
                                            if (item.id !== 'planning') setTargetActivityId(null);
                                        }}
                                        className={`group relative w-full flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between pl-3.5 pr-2.5'} py-2.5 text-sm rounded-lg transition-all duration-150 ease-out ${FOCUS_RING} ${
                                            isActive 
                                            ? 'bg-white text-slate-900 font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)]' 
                                            : 'font-medium text-slate-600 hover:bg-black/[0.035] hover:text-slate-900'
                                        }`}
                                    >
                                        {/* Thin accent indicator — a short floating bar rather than a
                                            full-height border, so the active state reads as a subtle
                                            highlight instead of a heavy rule. */}
                                        {isActive && (
                                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-[#FFCC00]" />
                                        )}
                                        <div className={`flex items-center gap-2.5 ${sidebarCollapsed ? 'justify-center w-full' : 'w-full'}`}>
                                            <span className={`shrink-0 flex items-center justify-center transition-colors duration-150 ${
                                                isActive
                                                    ? 'text-[#B8860B]'
                                                    : 'text-slate-400 group-hover:text-slate-600'
                                            }`}>
                                                {item.icon}
                                            </span>
                                            {!sidebarCollapsed && <span className="whitespace-nowrap tracking-[-0.01em]">{item.label}</span>}
                                        </div>
                                        
                                        {/* Notification Badge */}
                                        {item.id === 'lead_portal' && activeUserNotifications.length > 0 && (
                                            !sidebarCollapsed ? (
                                                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                                                    {activeUserNotifications.length}
                                                </span>
                                            ) : (
                                                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-[#F4F5F7]" />
                                            )
                                        )}

                                        {/* Tooltip for Collapsed Mode */}
                                        {sidebarCollapsed && (
                                            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 bg-white text-slate-800 text-xs px-3 py-1.5 rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap border border-slate-200 z-50 transition-opacity duration-200 font-medium">
                                                {item.label}
                                                <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-white border-l border-b border-slate-200 transform rotate-45"></div>
                                            </div>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )
            })}
            </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-white relative transition-all duration-300">
            
            {/* Top Bar */}
            <header className="h-16 border-b border-slate-100 bg-white flex items-center justify-between px-4 shrink-0 z-40 relative">
                <div className="flex items-center gap-3">
                    {currentUser.role === Role.SALES ? (
                        /* SALES: avatar + name + designation + online status — now doubles as
                           the account menu trigger (Change Password / Sign Out), so we don't
                           show a second, redundant avatar in the right-side icon cluster. */
                        <div className="relative" data-profile-panel>
                            <button
                                type="button"
                                onClick={() => setIsProfileOpen(prev => !prev)}
                                className={`flex items-center gap-3 p-1 pr-2 rounded-lg hover:bg-slate-100 transition-colors ${FOCUS_RING}`}
                                aria-haspopup="menu"
                                aria-expanded={isProfileOpen}
                                aria-label={`Account menu for ${currentUser.name}`}
                            >
                                {/* Avatar with green online dot */}
                                <div className="relative shrink-0">
                                    {currentUser.avatar ? (
                                        <img src={currentUser.avatar} alt={currentUser.name} className="w-10 h-10 rounded-full object-cover ring-2 ring-amber-400 shadow-sm" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-amber-100 ring-2 ring-amber-400 flex items-center justify-center font-bold text-amber-700 text-sm">
                                            {currentUser.name.charAt(0)}
                                        </div>
                                    )}
                                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full" />
                                </div>
                                {/* Name + designation — always shown */}
                                <div className="text-left">
                                    <p className="text-sm font-bold text-slate-900 leading-none">{currentUser.name}</p>
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        {(currentUser as any).jobRole || 'Sales Representative'}
                                    </p>
                                </div>
                                <ChevronDown size={14} aria-hidden="true" className={`text-slate-400 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isProfileOpen && (
                                <div
                                    role="menu"
                                    aria-label="Account menu"
                                    className="absolute left-0 top-14 w-64 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-xl shadow-xl z-[95] overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
                                >
                                    <div className="px-4 py-3 border-b border-slate-100">
                                        <div className="text-sm font-bold text-slate-900 truncate">{currentUser.name}</div>
                                        {currentUser.email && (
                                            <div className="text-xs text-slate-500 truncate mt-0.5">{currentUser.email}</div>
                                        )}
                                        <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                                            {currentUser.role}
                                        </span>
                                    </div>
                                    <div className="py-1">
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => { setIsProfileOpen(false); setShowSalesPwModal(true); }}
                                            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors ${FOCUS_RING}`}
                                        >
                                            <KeyRound size={16} className="text-slate-400" aria-hidden="true" />
                                            Change Password
                                        </button>
                                    </div>
                                    <div className="border-t border-slate-100 py-1">
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => { setIsProfileOpen(false); handleLogout(); }}
                                            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors ${FOCUS_RING}`}
                                        >
                                            <LogOut size={16} aria-hidden="true" />
                                            Sign Out
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Desktop Toggle (Minimizes Sidebar) */}
                            <button 
                                type="button"
                                onClick={toggleSidebar}
                                className={`hidden md:block p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors cursor-pointer ${FOCUS_RING}`}
                                title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                            >
                                <Menu size={24} />
                            </button>
                            {/* Mobile Toggle (Slides Sidebar Out) */}
                            <button 
                                type="button"
                                onClick={() => setIsMobileMenuOpen(true)}
                                className={`md:hidden p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors cursor-pointer ${FOCUS_RING}`}
                                title="Open Menu"
                                aria-label="Open navigation menu"
                            >
                                <Menu size={24} />
                            </button>

                            {/* Contextual page label — small, muted, no visual competition
                                with each page's own in-content title. Skips the category
                                segment when it would just repeat the page name. */}
                            {currentNavItem && (
                                <div className="hidden sm:block min-w-0 leading-tight">
                                    <div className="text-sm font-semibold text-slate-700 truncate max-w-[220px]">
                                        {currentNavItem.category && currentNavItem.category !== currentNavItem.label
                                            ? `${currentNavItem.category} / ${currentNavItem.label}`
                                            : currentNavItem.label}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center gap-4">
                     {/* Search Bar (Global) */}
                     <div className="relative hidden lg:block z-50">
                         <div className={`flex items-center bg-slate-50 pl-3 pr-2.5 py-2 rounded-xl border transition-all duration-200 ${isGlobalSearchFocused ? 'border-slate-300 bg-white shadow-[0_0_0_3px_rgba(0,0,0,0.04)]' : 'border-slate-100 hover:border-slate-200'}`}>
                             <Search size={15} className={`shrink-0 transition-colors ${isGlobalSearchFocused ? 'text-slate-500' : 'text-slate-400'}`} />
                             <input 
                                type="text" 
                                placeholder="Search tickets, clients, jobs…" 
                                value={globalSearchQuery}
                                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                                onFocus={() => setIsGlobalSearchFocused(true)}
                                onBlur={() => setTimeout(() => setIsGlobalSearchFocused(false), 200)}
                                className={`bg-transparent border-none outline-none text-sm ml-2 text-slate-700 placeholder:text-slate-400 transition-all duration-200 ${isGlobalSearchFocused ? 'w-72' : 'w-56'}`} 
                             />
                             {globalSearchQuery && (
                                 <button type="button" onClick={() => setGlobalSearchQuery('')} aria-label="Clear search" className={`ml-2 shrink-0 text-slate-400 hover:text-slate-600 rounded ${FOCUS_RING}`}><X size={14}/></button>
                             )}
                         </div>

                         {/* Dropdown Results */}
                         {isGlobalSearchFocused && globalSearchQuery.length >= 2 && (
                             <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden max-h-[400px] overflow-y-auto">
                                 {!hasGlobalResults ? (
                                     <div className="p-4 text-center text-slate-500 text-xs italic">No matching results found.</div>
                                 ) : (
                                     <div className="py-2">
                                         {globalSearchResults?.tickets.length > 0 && (
                                             <div className="mb-2">
                                                 <div className="px-3 py-1 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tickets</div>
                                                 {globalSearchResults.tickets.map(t => (
                                                     <div key={t.id} onClick={() => handleGlobalNav('ticket', t.id)} className="px-4 py-2 hover:bg-slate-50 cursor-pointer flex justify-between items-center group">
                                                         <div>
                                                             <div className="text-sm font-medium text-slate-800">{t.customerName}</div>
                                                             <div className="text-xs text-slate-500">{t.category} • {t.id}</div>
                                                         </div>
                                                         <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 group-hover:bg-white">{t.status}</span>
                                                     </div>
                                                 ))}
                                             </div>
                                         )}
                                         {globalSearchResults?.customers.length > 0 && (
                                             <div className="mb-2">
                                                 <div className="px-3 py-1 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Customers</div>
                                                 {globalSearchResults.customers.map(c => (
                                                     <div key={c.id} onClick={() => handleGlobalNav('customer', c.id)} className="px-4 py-2 hover:bg-slate-50 cursor-pointer">
                                                         <div className="text-sm font-medium text-slate-800">{c.name}</div>
                                                         <div className="text-xs text-slate-500">{c.phone}</div>
                                                     </div>
                                                 ))}
                                             </div>
                                         )}
                                         {globalSearchResults?.team.length > 0 && (
                                             <div className="mb-2">
                                                 <div className="px-3 py-1 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Team</div>
                                                 {globalSearchResults.team.map(t => (
                                                     <div key={t.id} onClick={() => handleGlobalNav('team', t.id)} className="px-4 py-2 hover:bg-slate-50 cursor-pointer">
                                                         <div className="text-sm font-medium text-slate-800">{t.name}</div>
                                                         <div className="text-xs text-slate-500">{t.role}</div>
                                                     </div>
                                                 ))}
                                             </div>
                                         )}
                                         {globalSearchResults?.activities.length > 0 && (
                                             <div>
                                                 <div className="px-3 py-1 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Activities</div>
                                                 {globalSearchResults.activities.map(a => (
                                                     <div key={a.id} onClick={() => handleGlobalNav('activity', a.id)} className="px-4 py-2 hover:bg-slate-50 cursor-pointer">
                                                         <div className="text-sm font-medium text-slate-800">{a.type}</div>
                                                         <div className="text-xs text-slate-500">{a.reference}</div>
                                                     </div>
                                                 ))}
                                             </div>
                                         )}
                                     </div>
                                 )}
                             </div>
                         )}
                     </div>

                     {/* Refresh + key icon (password) for SALES — before bell.
                         Sales uses this same shared header, but typically on a
                         phone, not a desktop browser — so they get the same
                         full-reload refresh button the Lead/Tech portals have,
                         scoped specifically to this role rather than the whole
                         header (Admin/Team Lead on actual desktop don't need
                         it; they have their browser's own refresh). */}
                     {currentUser.role === Role.SALES && (
                         <button
                             type="button"
                             onClick={() => window.location.reload()}
                             className={`p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors ${FOCUS_RING}`}
                             title="Refresh"
                             aria-label="Refresh page"
                         >
                             <RefreshCw size={18} />
                         </button>
                     )}

                     {/* Notification Bell — single bell, SLA as inner tab */}
                     <div className="relative" data-notif-panel>
                         <button
                             type="button"
                             onClick={() => setIsNotifOpen(prev => !prev)}
                             className={`relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors ${FOCUS_RING}`}
                             aria-haspopup="menu"
                             aria-expanded={isNotifOpen}
                             aria-label="Notifications"
                         >
                             <Bell size={20} className={slaAlerts.filter((a:any)=>!a.alreadyAlerted).length > 0 ? 'text-amber-500' : ''} />
                             {(activeUserNotifications.filter(n => !readNotifIds.has(n.id)).length + slaAlerts.filter((a:any)=>!a.alreadyAlerted).length) > 0 && (
                                 <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5">
                                     {activeUserNotifications.filter(n => !readNotifIds.has(n.id)).length + slaAlerts.filter((a:any)=>!a.alreadyAlerted).length}
                                 </span>
                             )}
                         </button>

                         {isNotifOpen && (
                             <div role="menu" className="absolute right-0 top-10 w-80 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-xl shadow-xl z-[95] overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
                                 {/* Tab header */}
                                 <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
                                     <div className="flex gap-1">
                                         <button onClick={() => setShowSlaPanel(false)}
                                             className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${!showSlaPanel ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                                             Alerts
                                             {activeUserNotifications.filter(n => !readNotifIds.has(n.id)).length > 0 && (
                                                 <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-red-500 text-white">{activeUserNotifications.filter(n => !readNotifIds.has(n.id)).length}</span>
                                             )}
                                         </button>
                                         {currentUser && ['ADMIN','TEAM_LEAD'].includes(currentUser.role) && (
                                             <button onClick={() => setShowSlaPanel(true)}
                                                 className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${showSlaPanel ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                                                 SLA
                                                 {slaAlerts.filter((a:any)=>!a.alreadyAlerted).length > 0 && (
                                                     <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-red-500 text-white">{slaAlerts.filter((a:any)=>!a.alreadyAlerted).length}</span>
                                                 )}
                                             </button>
                                         )}
                                     </div>
                                     <button type="button" onClick={() => setIsNotifOpen(false)} aria-label="Close notifications" className={`text-slate-400 hover:text-slate-600 rounded ${FOCUS_RING}`}><X size={16}/></button>
                                 </div>

                                 {/* SLA Tab */}
                                 {showSlaPanel && currentUser && ['ADMIN','TEAM_LEAD'].includes(currentUser.role) ? (
                                     <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                                         {slaAlerts.length === 0 ? (
                                             <div className="py-8 text-center text-slate-400 text-sm">✅ All tickets within SLA</div>
                                         ) : (slaAlerts as any[]).map((a:any) => (
                                             <div key={a.ticketId} className={`px-4 py-3 flex items-start gap-3 ${a.alertType==='STALLED_72H' ? 'border-l-4 border-red-400' : 'border-l-4 border-amber-400'}`}>
                                                 <span className={`shrink-0 mt-1.5 w-2 h-2 rounded-full ${a.alertType==='STALLED_72H' ? 'bg-red-500' : 'bg-amber-400'}`}/>
                                                 <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setTicketFilter({type:'id' as any, value:a.ticketId, description:`SLA: ${a.customerName}`}); setActiveView('tickets'); setIsNotifOpen(false); }}>
                                                     <div className="flex items-center justify-between gap-2">
                                                         <span className="text-sm font-bold text-slate-800 truncate">{a.customerName}</span>
                                                         <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${a.alertType==='STALLED_72H' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                                             {a.alertType==='STALLED_72H' ? '⚠ STALLED' : '⏰ WARNING'}
                                                         </span>
                                                     </div>
                                                     <p className="text-xs text-slate-500 mt-0.5">{a.category} · {a.hoursOpen}h open · {a.assignedTech}</p>
                                                 </div>
                                                 <button onClick={async (e) => { e.stopPropagation(); await fetch(`/api/sla/alerts/${a.ticketId}/acknowledge`, { method:'POST', headers: getAuthHeaders() }); setSlaAlerts(prev => prev.filter((x:any) => x.ticketId !== a.ticketId)); }}
                                                     className="shrink-0 text-[9px] font-bold text-slate-400 hover:text-slate-600 px-1.5 py-1 rounded border border-slate-200 hover:bg-slate-50">✓</button>
                                             </div>
                                         ))}
                                     </div>
                                 ) : (
                                     /* Notifications Tab */
                                     <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                                         {activeUserNotifications.length === 0 ? (
                                             <div className="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
                                         ) : (
                                             activeUserNotifications.map(n => {
                                                 const isRead = readNotifIds.has(n.id);
                                                 const typeColor: Record<string, string> = {
                                                     urgent: 'bg-red-50 border-l-4 border-red-400',
                                                     carry_forward: 'bg-orange-50 border-l-4 border-orange-400',
                                                     overdue: 'bg-amber-50 border-l-4 border-amber-400',
                                                     new_assignment: 'bg-blue-50 border-l-4 border-blue-400',
                                                 };
                                                 return (
                                                     <div key={n.id} className={`px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-slate-50 ${isRead ? 'opacity-60' : ''} ${typeColor[n.type] || ''}`}
                                                         onClick={() => {
                                                             markAsRead(n.id);
                                                             if (n.ticketId) {
                                                                 setTicketFilter({ ticketId: n.ticketId });
                                                                 setActiveView('tickets');
                                                                 setIsNotifOpen(false);
                                                             }
                                                         }}>
                                                         <span className="shrink-0 mt-1.5 text-base">
                                                             {n.type === 'urgent' ? '🚨' : n.type === 'carry_forward' ? '⟲' : n.type === 'overdue' ? '⚠️' : '🆕'}
                                                         </span>
                                                         <div className="flex-1 min-w-0">
                                                             <p className={`text-xs leading-snug line-clamp-2 ${isRead ? 'text-slate-400' : 'text-slate-700 font-medium'}`}
                                                                 onClick={(e) => { e.stopPropagation(); if (n.ticketId) { setTicketFilter({ ticketId: n.ticketId }); setActiveView('tickets'); setIsNotifOpen(false); } }}>
                                                                 {n.message}
                                                             </p>
                                                             <p className="text-[10px] text-slate-400 mt-0.5">
                                                                 {n.time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {n.time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                             </p>
                                                         </div>
                                                         {!isRead && (
                                                             <button onClick={() => markAsRead(n.id)} className="text-[10px] text-slate-400 hover:text-slate-600 shrink-0 px-1.5 py-0.5 border border-slate-200 rounded">
                                                                 Mark read
                                                             </button>
                                                         )}
                                                     </div>
                                                 );
                                             })
                                         )}
                                     </div>
                                 )}
                             </div>
                         )}
                     </div>

                     {currentUser.role !== Role.SALES && (
                     <>
                     {/* Divider */}
                     <div className="h-6 w-px bg-slate-200 mx-1 hidden md:block"></div>

                     {/* Profile Menu */}
                     <div className="relative" data-profile-panel>
                        <button
                            type="button"
                            onClick={() => setIsProfileOpen(prev => !prev)}
                            className={`flex items-center gap-2 pl-1 pr-1.5 md:pr-2 py-1 rounded-lg hover:bg-slate-100 transition-colors ${FOCUS_RING}`}
                            aria-haspopup="menu"
                            aria-expanded={isProfileOpen}
                            aria-label={`Account menu for ${currentUser.name}`}
                        >
                            {currentUser.avatar ? (
                                <img src={currentUser.avatar} alt="" className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 text-sm shrink-0">
                                    {currentUser.name.charAt(0)}
                                </div>
                            )}
                            <div className="text-right hidden md:block leading-tight">
                                <div className="text-sm font-bold text-slate-800">{currentUser.name}</div>
                                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{currentUser.role}</div>
                            </div>
                            <ChevronDown size={14} aria-hidden="true" className={`hidden md:block text-slate-400 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isProfileOpen && (
                            <div
                                role="menu"
                                aria-label="Account menu"
                                className="absolute right-0 top-11 w-64 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-xl shadow-xl z-[95] overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
                            >
                                <div className="px-4 py-3 border-b border-slate-100">
                                    <div className="text-sm font-bold text-slate-900 truncate">{currentUser.name}</div>
                                    {currentUser.email && (
                                        <div className="text-xs text-slate-500 truncate mt-0.5">{currentUser.email}</div>
                                    )}
                                    <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                                        {currentUser.role}
                                    </span>
                                </div>
                                {currentUser.role !== Role.VIEWER && (
                                    <div className="py-1">
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => { setIsProfileOpen(false); setShowSalesPwModal(true); }}
                                            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors ${FOCUS_RING}`}
                                        >
                                            <KeyRound size={16} className="text-slate-400" aria-hidden="true" />
                                            Change Password
                                        </button>
                                    </div>
                                )}
                                <div className="border-t border-slate-100 py-1">
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setIsProfileOpen(false); handleLogout(); }}
                                        className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors ${FOCUS_RING}`}
                                    >
                                        <LogOut size={16} aria-hidden="true" />
                                        Sign Out
                                    </button>
                                </div>
                            </div>
                        )}
                     </div>
                     </>
                     )}
                </div>
            </header>

            {/* View Container */}
            <div className="flex-1 overflow-auto bg-slate-50 relative">
              <ErrorBoundary name='MainContent'>
              <Suspense fallback={<LoadingFallback />}>
                {/* ── SALES route guard: redirect to allowed view ── */}
                {currentUser.role === Role.SALES && activeView !== 'sales_requests' && (
                  <div className="flex flex-col items-center justify-center h-full py-32 gap-4 text-slate-400">
                    <div className="text-5xl">🔒</div>
                    <p className="font-semibold text-slate-600">Access Restricted</p>
                    <p className="text-sm">This page is not available for your role.</p>
                    <button
                      onClick={() => setActiveView('sales_requests')}
                      className="mt-2 px-4 py-2 bg-amber-400 text-slate-900 rounded-xl font-semibold text-sm"
                    >
                      Go to Sales Requests
                    </button>
                  </div>
                )}
                {activeView === 'dashboard' && (
                    <Dashboard 
                        tickets={tickets} 
                        technicians={technicians}
                        currentUser={currentUser}
                        onNavigate={(filter) => {
                            setTicketFilter(filter);
                            setActiveView('tickets');
                        }}
                        onUpdateTicket={handleUpdateTicket}
                    />
                )}
                {activeView === 'tickets' && (
                    <TicketManagement 
                        tickets={tickets} 
                        technicians={technicians}
                        customers={customers}
                        activities={activities}
                        currentUser={currentUser}
                        onDeleteTicket={handleDeleteTicket}
                        onAddCustomer={handleAddCustomer}
                        onUpdateTicket={handleUpdateTicket}
                        onOpenTicket={handleOpenTicket}
                        onSendMessage={handleSendMessage}
                        onCreateTicket={handleCreateTicket}
                        activeFilter={ticketFilter}
                        onClearFilter={() => setTicketFilter(null)}
                    />
                )}
                {activeView === 'operations' && (
                    <OperationsDashboard 
                        teams={teams}
                        sites={sites}
                        technicians={technicians}
                        activities={activities}
                        tickets={tickets}
                        customers={customers}
                        onUpdateActivity={handleUpdateActivity}
                        onNavigate={(type, id) => {
                            if (type === 'ticket') {
                                setTicketFilter({ ticketId: id });
                                setActiveView('tickets');
                            } else if (type === 'activity') {
                                setTargetActivityId(id);
                                setActiveView('planning');
                            }
                        }}
                    />
                )}
                {activeView === 'planning' && (
                    <PlanningModule 
                        prefillActivity={prefillActivity}
                        onClearPrefill={() => setPrefillActivity(null)}
                        activities={activities}
                        teams={teams}
                        sites={sites}
                        customers={customers}
                        technicians={technicians}
                        onAddActivity={handleAddActivity}
                        onUpdateActivity={handleUpdateActivity}
                        onDeleteActivity={handleDeleteActivity}
                        onAddCustomer={handleAddCustomer}
                        initialActivityId={targetActivityId}
                        onClearInitialActivity={() => setTargetActivityId(null)}
                        isSaving={isSavingActivity}
                        currentUserRole={currentUser?.role}
                    />
                )}
                {activeView === 'amc_contracts' && (
                    <AMCContracts customers={customers} />
                )}
                {activeView === 'settings' && (
                    <SettingsPage />
                )}
                {activeView === 'service_feedback' && (
                    <ServiceFeedbackPage />
                )}
                {activeView === 'customers' && (
                    <CustomerRecords 
                        customers={customers}
                        activities={activities}
                        tickets={tickets}
                        technicians={technicians}
                        sites={sites}
                        salesAppointmentRequests={salesAppointmentRequests}
                        onSaveCustomer={handleUpdateCustomer}
                        onDeleteCustomer={handleDeleteCustomer}
                        onCreateTicket={(data) => { handleCreateTicket(data); setActiveView('tickets'); }}
                        onCreateActivity={(data) => {
                        // Navigate to Planning + prefill form so user can choose salesRep + other details
                        setPrefillActivity({
                            ...data,
                            salesLeadId: (currentUser?.role === 'SALES') ? currentUser.id : '',
                        });
                        setActiveView('planning');
                    }}
                    />
                )}
                {activeView === 'master_dashboard' && (
                    <MasterDashboard
                        tickets={tickets}
                        activities={activities}
                        technicians={technicians}
                        slaAlerts={slaAlerts}
                        customers={customers}
                        salesAppointmentRequests={salesAppointmentRequests}
                        currentUser={currentUser}
                        onNavigate={(type, id) => {
                            if (type === 'ticket') {
                                setTicketFilter({ ticketId: id });
                                setActiveView('tickets');
                            } else if (type === 'activity') {
                                setTargetActivityId(id);
                                setActiveView('planning');
                            } else if (type === 'view') {
                                setActiveView(id);
                            }
                        }}
                    />
                )}
                {activeView === 'users' && (
                    <UserManagement 
                        users={technicians}
                        teams={teams}
                        onSaveUser={handleSaveUser}
                        onDeleteUser={handleDeleteUser}
                        onChangePassword={handleChangePassword}
                        onJobsReassigned={() => { loadTickets(); loadActivities(); }}
                    />
                )}
                {activeView === 'team' && (
                    <TeamCRM 
                        technicians={technicians}
                        onSaveTech={handleSaveUser}
                        onDeleteTech={handleDeleteUser}
                    />
                )}
                {activeView === 'system_tools' && (
                    <SystemDataTools 
                        data={{tickets, activities, technicians, customers, teams, sites}}
                        onImport={handleSystemImport}
                        currentUser={currentUser}
                    />
                )}
                {activeView === 'whatsapp_monitor' && (
                    <WhatsAppMonitor />
                )}
                {activeView === 'audit_log' && (
                    <AuditLog />
                )}

                {activeView === 'sales_requests' && (
                    <SalesAppointmentRequests
                        currentUser={currentUser}
                        technicians={technicians}
                        activities={activities}
                        onActivityCreated={() => {
                            // Refresh activities so planner/ops monitor shows the new planned activity
                            const token = localStorage.getItem('qonnect_token');
                            fetch('/api/refresh', { headers: { Authorization: `Bearer ${token}` } })
                                .then(r => r.json())
                                .then((data: any) => { if (data.activities) setActivities(data.activities); })
                                .catch(() => {});
                            // Also refresh the App-level copy of SAR data — used by
                            // Customer History — since scheduling/linking changes
                            // the SAR's status and linkedActivityId.
                            loadSalesAppointmentRequests();
                        }}
                    />
                )}

                {activeView === 'tech_portal' && (
                    <MobileTechPortal 
                        tickets={tickets}
                        activities={activities}
                        customers={customers}
                        currentTechId={currentUser.techId || ''}
                        onUpdateStatus={(tId, status, note) => {
                            const t = tickets.find(x => x.id === tId);
                            if (t) handleUpdateTicket({
                              ...t, 
                              status,
                              ...(status === 'RESOLVED' && note ? { completionNote: note } : {})
                            });
                        }}
                        onUpdateActivity={handleUpdateActivity}
                        isStandalone={false}
                        onLogout={handleLogout}
                    />
                )}
              </Suspense>
              </ErrorBoundary>
              </div>

          {/* AI Assistant — loads only when clicked */}
          {showChatBot ? (
              <Suspense fallback={null}>
                  <AIChatBot 
                      context={{ tickets, activities, customers, technicians, sites }}
                      currentUser={currentUser}
                  />
              </Suspense>
          ) : (
              <button
                  onClick={() => setShowChatBot(true)}
                  className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-slate-900 text-white shadow-xl flex items-center justify-center hover:bg-slate-800 active:scale-95 transition-all z-50"
                  title="AI Assistant"
              >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
          )}

          {/* Completed Job Summary Popup (Global) */}
          <Suspense fallback={null}>
          {completedSummary && (
            <CompletedJobSummary
              type={completedSummary.type}
              item={completedSummary.item}
              technicians={technicians}
              customers={customers}
              onClose={() => setCompletedSummary(null)}
            />
          )}
          </Suspense>

        </main>

        {/* ── Change Password Modal — originally SALES-only (key icon in header),
             now also reachable from the shared Account menu's "Change Password"
             action for every role. Logic is unchanged; only the trigger surface
             grew. ── */}
        {showSalesPwModal && (
          <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSalesPwModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center">
                    <KeyRound size={16} className="text-slate-600" />
                  </div>
                  <h3 className="font-bold text-slate-900">Change Password</h3>
                </div>
                <button onClick={() => setShowSalesPwModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                  <X size={16} />
                </button>
              </div>
              {salesPwSuccess ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                    <KeyRound size={22} className="text-emerald-600" />
                  </div>
                  <p className="font-semibold text-emerald-700">Password updated successfully</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {salesPwError && (
                    <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{salesPwError}</div>
                  )}
                  {(['current', 'next', 'confirm'] as const).map(field => {
                    const labels = { current: 'Current Password', next: 'New Password', confirm: 'Confirm New Password' };
                    return (
                      <div key={field}>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">{labels[field]}</label>
                        <div className="relative">
                          <input
                            type={salesShowPw[field] ? 'text' : 'password'}
                            value={salesPwForm[field]}
                            onChange={e => setSalesPwForm(p => ({ ...p, [field]: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-400/20 transition-all"
                            autoComplete={field === 'current' ? 'current-password' : 'new-password'}
                          />
                          <button type="button" onClick={() => setSalesShowPw(p => ({ ...p, [field]: !p[field] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            {salesShowPw[field] ? <EyeOff size={14} /> : <EyeIcon size={14} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowSalesPwModal(false)} className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                      Cancel
                    </button>
                    <button
                      disabled={salesPwLoading}
                      onClick={async () => {
                        setSalesPwError('');
                        if (!salesPwForm.current) { setSalesPwError('Enter your current password'); return; }
                        if (salesPwForm.next.length < 6) { setSalesPwError('New password must be at least 6 characters'); return; }
                        if (salesPwForm.next !== salesPwForm.confirm) { setSalesPwError('Passwords do not match'); return; }
                        setSalesPwLoading(true);
                        try {
                          await handleChangePassword(currentUser.techId ?? currentUser.id, salesPwForm.current, salesPwForm.next);
                          setSalesPwSuccess(true);
                          setSalesPwForm({ current: '', next: '', confirm: '' });
                          setTimeout(() => { setSalesPwSuccess(false); setShowSalesPwModal(false); }, 1800);
                        } catch (e: any) {
                          setSalesPwError(e.message || 'Failed to change password');
                        } finally {
                          setSalesPwLoading(false);
                        }
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 bg-[#FFCC00] hover:bg-amber-400 disabled:opacity-60 rounded-xl transition-colors"
                    >
                      {salesPwLoading ? <span className="w-4 h-4 border-2 border-slate-700/30 border-t-slate-700 rounded-full animate-spin" /> : <KeyRound size={14} />}
                      Update
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

export default App;
