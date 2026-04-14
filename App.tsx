import React, { useState, useMemo, useEffect } from 'react';
import { 
  APP_NAME, NAVIGATION_ITEMS
} from './constants';
import { 
  User, Role, Ticket, Technician, Activity, Team, Site, 
  TicketStatus, TicketFilter, MessageSender, Customer 
} from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import TicketManagement from './components/TicketManagement';
import OperationsDashboard from './components/OperationsDashboard';
import PlanningModule from './components/PlanningModule';
import ReportsModule from './components/ReportsModule';
import UserManagement from './components/UserManagement';
import TeamCRM from './components/TeamCRM';
import { MobileLeadPortal } from './components/MobileLeadPortal';
import MobileTechPortal from './components/MobileTechPortal';
import CustomerRecords from './components/CustomerRecords';
import AIChatBot from './components/AIChatBot';
import SystemDataTools from './components/SystemDataTools';
import WhatsAppMonitor from './components/WhatsAppMonitor';
import TVDisplayMode from './components/TVDisplayMode';
import CompletedJobSummary from './components/CompletedJobSummary';
import { Menu, Bell, Search, LogOut, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { generateActivityId, generateTicketId } from './utils/idUtils';

// Logo Component
const QonnectLogo = ({ className }: { className?: string }) => (
  <div className={`bg-slate-900 text-white flex items-center justify-center rounded-lg font-bold text-xl ${className}`}>
    Q
  </div>
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
  const [portalDataReady, setPortalDataReady] = useState(false);

  // UI State - Persistent Sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
      if (typeof window !== 'undefined') {
          const saved = localStorage.getItem('sidebarCollapsed');
          return saved === 'true';
      }
      return false;
  });

  const [activeView, setActiveView] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter | null>(null);
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [targetActivityId, setTargetActivityId] = useState<string | null>(null);

  // TV Display Mode — detected from URL hash
  const [isTVMode, setIsTVMode] = useState(() => window.location.hash === '#tv');

  // Completed Job Summary — unified popup for completed tickets/activities
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
              techId: data.user.id
          });
          setLoginError('');
          if (data.user.role === Role.FIELD_ENGINEER) {
              setActiveView('tech_portal');
          } else if (data.user.role === Role.TEAM_LEAD && window.innerWidth < 768) {
              setActiveView('lead_portal');
          } else {
              setActiveView('dashboard');
          }

      } catch (error) {
          console.error("Login Error:", error);
          setLoginError('Unable to connect to server. Please try again.');
      }
  };

const handleLogout = () => {
      localStorage.removeItem('qonnect_token');
      localStorage.removeItem('qonnect_user');
      setCurrentUser(null);
      setActiveView('dashboard');
  };

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

  const handleUpdateTicket = async (updated: Ticket) => {
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
                  customerId: updated.customerId,
                  customerName: updated.customerName,
                  assignedTechId: updated.assignedTechId || null,
                  appointmentTime: updated.appointmentTime || null,
              })
          });
          // Reload from DB to keep state fresh (mirrors handleUpdateActivity)
          await loadTickets();
      } catch (e) {
          console.error("Failed to update ticket:", e);
          // Keep optimistic update on failure
      }
  };

  const handleCreateTicket = async (data: any) => {
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...data,
          id: generateTicketId(),
          status: TicketStatus.NEW,
          createdAt: new Date().toISOString(),
          messages: []
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Ticket create failed");
      }

      await loadTickets();
    } catch (e) {
      console.error("Failed to create ticket:", e);
      alert("Failed to create ticket.");
    }
  };

  const handleDeleteTicket = async (id: string) => {
      if (!window.confirm("Are you sure you want to delete this ticket?")) return;
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
              alert(`Error: ${err.error || "Could not delete ticket"}`);
          }
      } catch (e) {
          console.error("Delete ticket error:", e);
          alert("Failed to connect to the server.");
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

  // Activity Handlers (API-Connected)
  const handleAddActivity = async (act: any) => {
      const newId = generateActivityId();
      const payload = { ...act, id: newId, reference: newId, status: act.status || 'PLANNED' };
      try {
          const res = await fetch("/api/activities", {
              method: "POST",
              headers: getAuthHeaders(),
              body: JSON.stringify(payload)
          });
          if (res.ok) await loadActivities(); // Refresh from DB
          // Sync location/building to customer if provided
          syncActivityLocationToCustomer(act);
      } catch (e) { console.error("Failed to add activity", e); }
  };

  const handleUpdateActivity = async (updated: Activity) => {
      try {
          const res = await fetch(`/api/activities/${updated.id}`, {
              method: "PUT",
              headers: getAuthHeaders(),
              body: JSON.stringify(updated)
          });
          if (res.ok) await loadActivities(); // Refresh from DB
          // Sync location/building to customer if provided
          syncActivityLocationToCustomer(updated);
      } catch (e) { console.error("Failed to update activity", e); }
  };

  // When an activity has a customer + location/building, update the customer record if its fields are empty
  const syncActivityLocationToCustomer = async (act: any) => {
      try {
          const custId = act.customerId;
          if (!custId) return;
          const cust = customers.find(c => c.id === custId);
          if (!cust) return;
          const locationUrl = act.locationUrl || '';
          const houseNumber = act.houseNumber || '';
          if (!locationUrl && !houseNumber) return;
          // Only update if the customer's fields are empty
          const needsAddress = !cust.address && locationUrl;
          const needsBuilding = !(cust as any).buildingNumber && houseNumber;
          if (!needsAddress && !needsBuilding) return;
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
      if (!window.confirm("Are you sure you want to delete this activity?")) return;
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
      if (Array.isArray(data)) setActivities(data);
    } catch (e) {
      console.error("Failed to load activities", e);
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
    alert("Failed to create customer");
    return null;
  }
};

const handleUpdateCustomer = async (c: Customer) => {
  try {
    const id = (c as any)?.id ? String((c as any).id).trim() : "";
    if (!id) {
      console.error("🚨 Update customer called without id:", c);
      alert("Failed to update customer: missing customer id.");
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
      alert(`Failed to update customer (${res.status})`);
      return;
    }

    await loadCustomers();
  } catch (e) {
    console.error("Update exception:", e);
    alert("Failed to update customer");
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
    alert("Failed to delete customer");
  }
};

  // Tech/User Handlers — saves to database via API
  const handleSaveUser = async (u: Technician) => {
      try {
          const exists = technicians.find(x => x.id === u.id);
          if (exists) {
              // Update existing user
              // When level is SALES or TECHNICAL_ASSOCIATE, clear systemRole to NONE
              const isNonLoginLevel = u.level === 'SALES' || u.level === 'TECHNICAL_ASSOCIATE';
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
          alert("Failed to save user. Please try again.");
      }
  };

  const handleDeleteUser = async (id: string) => {
      try {
          const res = await fetch(`/api/users/${id}`, { method: "DELETE", headers: getAuthHeaders() });
          if (!res.ok) throw new Error("Failed to delete user");
          await loadUsers();
      } catch (e) {
          console.error("handleDeleteUser error:", e);
          alert("Failed to delete user. Please try again.");
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
  const handleSystemImport = (data: any) => {
      if (data.tickets) setTickets(data.tickets);
      if (data.activities) setActivities(data.activities);
      if (data.technicians) setTechnicians(data.technicians);
      if (data.customers) setCustomers(data.customers);
      if (data.teams) setTeams(data.teams);
      if (data.sites) setSites(data.sites);
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
                else if (u.systemRole === 'NONE')       level = ''; // SALES/TA — should have level set in DB
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
        setCurrentUser(user);
        // Auto-route based on role and device
        if (user.role === Role.FIELD_ENGINEER) {
          setActiveView('tech_portal');
        } else if (user.role === Role.TEAM_LEAD && window.innerWidth < 768) {
          setActiveView('lead_portal');
        }
      })
      .catch(() => {
        // Token expired or invalid — clear and show login
        localStorage.removeItem('qonnect_token');
        localStorage.removeItem('qonnect_user');
        setCurrentUser(null);
      });
  }, []);
  
useEffect(() => {
    if (!currentUser) return; // wait until logged in before fetching data
    loadUsers();
    loadCustomers();
    loadTickets();
    loadActivities();
    loadTeams();
    loadSites();
  }, [currentUser?.id || currentUser?.techId]); // re-run when user logs in

useEffect(() => {
    if (activeView !== 'lead_portal') return;

    const prepareLeadPortal = async () => {
        setPortalDataReady(false);
        try {
            await Promise.all([
                loadUsers(),
                loadTickets(),
                loadTeams(),
            ]);
        } catch (error) {
            console.error('Failed to prepare Lead Portal data:', error);
        } finally {
            setPortalDataReady(true);
        }
    };

    prepareLeadPortal();
}, [activeView]);

  // Auto-refresh every 8s — runs for all views including lead_portal and tech_portal
  useEffect(() => {
    let isRefreshing = false;
    const interval = setInterval(async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        await Promise.all([loadTickets(), loadActivities()]);
      } finally {
        isRefreshing = false;
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [activeView]);
  
  // --- Navigation Logic ---
  const filteredNavItems = useMemo(() => {
      if (!currentUser) return [];
      const isDesktop = window.innerWidth >= 768;
      return NAVIGATION_ITEMS.filter(item => {
          if (!item.roles.includes(currentUser.role)) return false;
          // Hide mobile portals on desktop for non-Admin roles — Admin keeps access for troubleshooting
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
	if (!portalDataReady) {
	  return (
	    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-100">
	      <div className="text-center">
	        <div className="text-lg font-semibold text-slate-700">Loading Lead Portal...</div>
	        <div className="text-sm text-slate-500 mt-2">Please wait</div>
	      </div>
	    </div>
	  );
	}

    return (
      <div className="fixed inset-0 z-[999] overflow-hidden" style={{background:'#f1f5f9'}}>
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
          isStandalone={true}
	  onLogout={handleLogout}
          onChangePassword={async (cur, nxt) => { await handleChangePassword(currentUser.techId ?? '', cur, nxt); }}
          focusedTicketId={focusedTicketId}
          currentUserId={currentUser.techId}
        />
      </div>
    );
  }

  if (activeView === 'tech_portal') {
    return (
      <div className="fixed inset-0 z-[999] overflow-hidden" style={{background:'#f1f5f9'}}>
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
          onUpdateTicket={handleUpdateTicket}
          isStandalone={true}
          onLogout={handleLogout}
          onChangePassword={async (cur, nxt) => { await handleChangePassword(currentUser.techId ?? '', cur, nxt); }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
        
        {/* Mobile Overlay */}
        {isMobileMenuOpen && (
            <div 
                className="fixed inset-0 bg-slate-900/50 z-40 md:hidden backdrop-blur-sm"
                onClick={() => setIsMobileMenuOpen(false)}
            />
        )}

        {/* Sidebar - APPLE iOS LIGHT THEME */}
        <aside className={`fixed inset-y-0 left-0 md:relative flex flex-col bg-[#E5E7EB] border-r-[3px] border-[#1E293B]/20 text-gray-900 z-50 transition-transform duration-300 ease-in-out md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} ${sidebarCollapsed ? 'md:w-[80px] w-[80px]' : 'md:w-[260px] w-[260px]'}`}>
            
            {/* Sidebar Header */}
            <div className={`flex items-center border-b border-[#0F172A]/[0.08] transition-all duration-300 ${sidebarCollapsed ? 'justify-center py-5' : 'px-5 py-5 gap-3'}`}>
            <div className="shrink-0 transition-all duration-300 flex items-center justify-center">
                <QonnectLogo className="w-[30px] h-[30px] object-contain block" />
            </div>
            
            <div className={`flex flex-col justify-center overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>
                <h1 className="text-[18px] font-semibold text-[#111827] leading-tight tracking-tight whitespace-nowrap">{APP_NAME}</h1>
                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-widest whitespace-nowrap mt-0.5">
                Field Operations Platform
                </div>
            </div>
            </div>
            
            <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto overflow-x-hidden custom-scrollbar">
            {categoryOrder.map(cat => {
                const items = groupedNavItems[cat];
                if (!items || items.length === 0) return null;
                
                return (
                    <div key={cat}>
                        {/* Section Header */}
                        {!sidebarCollapsed && (
                            <h3 className="px-4 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-widest mt-6 mb-2">
                                {cat}
                            </h3>
                        )}
                        
                        {/* Collapsed Divider */}
                        {sidebarCollapsed && <div className="border-b border-gray-200 mb-3 mx-4 mt-3" />}

                        <div className="space-y-1">
                            {items.map(item => {
                                const isActive = activeView === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        title={sidebarCollapsed ? item.label : ''}
                                        onClick={() => {
                                            setActiveView(item.id);
                                            setIsMobileMenuOpen(false); // <--- Auto-close on mobile
                                            if (item.id !== 'tickets') setTicketFilter(null); 
                                            if (item.id !== 'lead_portal') setFocusedTicketId(null);
                                            if (item.id !== 'planning') setTargetActivityId(null);
                                        }}
                                        className={`group relative w-full flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'} py-2.5 text-sm font-medium transition-all duration-200 rounded-[10px] border-l-[3px] ${
                                            isActive 
                                            ? 'border-[#FFCC00] bg-[rgba(255,204,0,0.12)] text-black' 
                                            : 'border-transparent text-[#111827] hover:bg-black/5'
                                        }`}
                                    >
                                        <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center w-full' : 'w-full'}`}>
                                            <span className={`${isActive ? 'text-[#FFCC00]' : 'text-gray-500 group-hover:text-gray-700 transition-colors'} shrink-0`}>
                                                {item.icon}
                                            </span>
                                            {!sidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                                        </div>
                                        
                                        {/* Notification Badge */}
                                        {item.id === 'lead_portal' && activeUserNotifications.length > 0 && (
                                            !sidebarCollapsed ? (
                                                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                                                    {activeUserNotifications.length}
                                                </span>
                                            ) : (
                                                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-[#F3F4F6]" />
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
                    {/* Desktop Toggle (Minimizes Sidebar) */}
                    <button 
                        onClick={toggleSidebar}
                        className="hidden md:block p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors cursor-pointer"
                        title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                    >
                        <Menu size={24} />
                    </button>
                    {/* Mobile Toggle (Slides Sidebar Out) */}
                    <button 
                        onClick={() => setIsMobileMenuOpen(true)}
                        className="md:hidden p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="Open Menu"
                    >
                        <Menu size={24} />
                    </button>
                </div>

                <div className="flex items-center gap-4">
                     {/* Search Bar (Global) */}
                     <div className="relative hidden lg:block z-50">
                         <div className="flex items-center bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 focus-within:ring-2 focus-within:ring-slate-200 transition-all">
                             <Search size={16} className="text-slate-400" />
                             <input 
                                type="text" 
                                placeholder="Global Search..." 
                                value={globalSearchQuery}
                                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                                onFocus={() => setIsGlobalSearchFocused(true)}
                                onBlur={() => setTimeout(() => setIsGlobalSearchFocused(false), 200)}
                                className="bg-transparent border-none outline-none text-sm ml-2 w-64 text-slate-700 placeholder:text-slate-400" 
                             />
                             {globalSearchQuery && (
                                 <button onClick={() => setGlobalSearchQuery('')} className="ml-2 text-slate-400 hover:text-slate-600"><X size={14}/></button>
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

                     {/* Notification Bell */}
                     <div className="relative" data-notif-panel>
                         <button
                             onClick={() => setIsNotifOpen(prev => !prev)}
                             className="relative p-2 text-slate-400 hover:text-slate-600 transition-colors"
                         >
                             <Bell size={20} />
                             {activeUserNotifications.filter(n => !readNotifIds.has(n.id)).length > 0 && (
                                 <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
                             )}
                         </button>

                         {isNotifOpen && (
                             <div className="absolute right-0 top-10 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                 {/* Header */}
                                 <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                                     <span className="text-sm font-bold text-slate-800">Notifications</span>
                                     <div className="flex items-center gap-2">
                                         {activeUserNotifications.filter(n => !readNotifIds.has(n.id)).length > 0 && (
                                             <span className="text-xs font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                                                 {activeUserNotifications.filter(n => !readNotifIds.has(n.id)).length} new
                                             </span>
                                         )}
                                         <button onClick={() => setIsNotifOpen(false)} className="text-slate-400 hover:text-slate-600">
                                             <X size={16} />
                                         </button>
                                     </div>
                                 </div>

                                 {/* List */}
                                 <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                                     {activeUserNotifications.length === 0 ? (
                                         <div className="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
                                     ) : (
                                         activeUserNotifications.map(n => {
                                             const isRead = readNotifIds.has(n.id);
                                             const typeColor: Record<string, string> = {
                                                 new_ticket: 'bg-emerald-500',
                                                 carry_forward: 'bg-amber-500',
                                                 status_change: 'bg-blue-500',
                                                 assigned: 'bg-purple-500',
                                             };
                                             return (
                                                 <div
                                                     key={n.id}
                                                     className={`flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors ${isRead ? 'opacity-50' : ''}`}
                                                 >
                                                     <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${typeColor[n.type] || 'bg-slate-400'}`}></span>
                                                     <div className="flex-1 min-w-0">
                                                         <p
                                                             className="text-xs text-slate-700 leading-snug cursor-pointer hover:text-emerald-600"
                                                             onClick={() => {
                                                                 if (n.ticketId) {
                                                                     setActiveView('tickets');
                                                                     setTicketFilter({ ticketId: n.ticketId });
                                                                     setIsNotifOpen(false);
                                                                 }
                                                             }}
                                                         >
                                                             {n.message}
                                                         </p>
                                                         <p className="text-[10px] text-slate-400 mt-0.5">
                                                             {n.time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {n.time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                         </p>
                                                     </div>
                                                     {!isRead && (
                                                         <button
                                                             onClick={() => markAsRead(n.id)}
                                                             className="text-[10px] text-slate-400 hover:text-emerald-600 shrink-0 mt-1 whitespace-nowrap"
                                                         >
                                                             Mark read
                                                         </button>
                                                     )}
                                                 </div>
                                             );
                                         })
                                     )}
                                 </div>
                             </div>
                         )}
                     </div>

                     {/* Divider */}
                     <div className="h-6 w-px bg-slate-200 mx-1 hidden md:block"></div>

                     {/* User Identity Block */}
                     <div className="flex items-center gap-3">
                        <div className="text-right hidden md:block leading-tight">
                            <div className="text-sm font-bold text-slate-800">{currentUser.name}</div>
                            <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{currentUser.role}</div>
                        </div>
                        <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 text-sm shrink-0">
                            {currentUser.name.charAt(0)}
                        </div>
                        <button 
                            onClick={handleLogout}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-1"
                            title="Sign Out"
                        >
                            <LogOut size={18} />
                        </button>
                     </div>
                </div>
            </header>

            {/* View Container */}
            <div className="flex-1 overflow-auto bg-slate-50 relative">
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
                    />
                )}
                {activeView === 'customers' && (
                    <CustomerRecords 
                        customers={customers}
                        activities={activities}
                        tickets={tickets}
                        technicians={technicians}
                        sites={sites}
                        onSaveCustomer={handleUpdateCustomer}
                        onDeleteCustomer={handleDeleteCustomer}
                    />
                )}
                {activeView === 'reports' && (
                    <ReportsModule 
                        tickets={tickets}
                        activities={activities}
                        technicians={technicians}
                        sites={sites}
                        customers={customers}
                        onNavigate={handleGlobalNav}
                    />
                )}
                {activeView === 'users' && (
                    <UserManagement 
                        users={technicians}
                        teams={teams}
                        onSaveUser={handleSaveUser}
                        onDeleteUser={handleDeleteUser}
                        onChangePassword={handleChangePassword}
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

                {activeView === 'tech_portal' && (
                    <MobileTechPortal 
                        tickets={tickets}
                        activities={activities}
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
              </div>

          {/* AI Assistant Chat Bubble (Global) */}
          <AIChatBot 
            context={{
              tickets,
              activities,
              customers,
              technicians,
              sites
            }}
            currentUser={currentUser}
          />

          {/* Completed Job Summary Popup (Global) */}
          {completedSummary && (
            <CompletedJobSummary
              type={completedSummary.type}
              item={completedSummary.item}
              technicians={technicians}
              customers={customers}
              onClose={() => setCompletedSummary(null)}
            />
          )}

        </main>
    </div>
  );
}

export default App;
