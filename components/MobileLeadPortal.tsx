import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import toast from './Toast';
import { Ticket, TicketStatus, TicketType, Technician, Activity, Team, Customer, Priority, Role, Site } from '../types';
import { getTicketHealth, getHealthColor } from '../utils/ticketUtils';
import { 
  ChevronLeft, Phone, MapPin, Search, Plus, RotateCcw, Navigation, 
  LogOut, Bell, ListTodo, Calendar, BarChart3, Users,
  CheckCircle2, History, AlertTriangle, X, UserPlus,
  TrendingUp, Grid, Contact, Smartphone, ChevronRight, Clock, Briefcase, ExternalLink, Play, CheckSquare, ChevronDown, KeyRound,
  Home, Settings, ClipboardList, Zap, Lock, BellRing, LayoutGrid, Activity as ActivityIcon, Layers
} from 'lucide-react';
import ReportsModule from './ReportsModule';
import PlanningModule from './PlanningModule';
import CustomerRecords from './CustomerRecords';
const SalesAppointmentRequests = lazy(() => import('./SalesAppointmentRequests'));
import { INPUT_STYLES, SEARCH_INPUT_STYLES } from '../constants';
import { MyJobTaskView } from './MyJobTaskView';

// --- Props ---
interface MobileLeadPortalProps {
  tickets: Ticket[];
  technicians: Technician[];
  activities?: Activity[];
  teams?: Team[];
  sites?: Site[];
  customers?: Customer[];
  
  onAssign: (ticketId: string, techId: string) => void;
  onUpdateTicket?: (ticket: Ticket) => void;
  onUpdateActivity?: (activity: Activity) => void;
  onAddActivity?: (activity: any) => void;
  onDeleteActivity?: (id: string) => void;
  onAddCustomer?: (customer: Customer) => Promise<Customer | null> | void;
  onSaveCustomer?: (customer: Customer) => void;
  onDeleteCustomer?: (id: string) => void;
  onCreateTicket?: (data: any) => void;
  onNavigateToSalesRequests?: () => void; // desktop nav callback for Sales Requests

  isStandalone?: boolean;
  onLogout?: () => void;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  focusedTicketId?: string | null;
  currentUserId?: string; // New: For "My Jobs"
}

// --- Nav is inline in the bottom bar ---

// --- Helpers ---
const formatNextVisit = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    
    // Format: "DD-MM-YYYY • hh:mm A"
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const strTime = `${String(hours).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} ${ampm}`;
    
    return `${dd}-${mm}-${yyyy} • ${strTime}`;
};

// --- Time Constants ---
const HOURS_12 = Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0'));
const MINUTES_STEP = ['00', '15', '30', '45'];
const AMPM_OPTS = ['AM', 'PM'];

// --- Engineer to Team Lead Mapping ---
const engineerTeamMap: Record<string, string> = {
  "Sabeel": "Afsal Mulla",
  "Obaid": "Afsal Mulla",
  "Sarah Chen": "Afsal Mulla",
  "Mike Ross": "Afsal Mulla"
};

// --- MAIN COMPONENT ---
export const MobileLeadPortal: React.FC<MobileLeadPortalProps> = ({ 
    tickets, technicians, activities = [], teams = [], sites = [], customers = [],
    onUpdateTicket, onUpdateActivity, onAddActivity, onDeleteActivity, onAddCustomer, onSaveCustomer, onDeleteCustomer, onCreateTicket, onNavigateToSalesRequests,
    isStandalone = false, onLogout, onChangePassword, focusedTicketId, currentUserId
}) => {
  // --- Responsive Check ---
  // When embedded in the main app (isStandalone=false), always use mobile layout
  // When accessed directly (isStandalone=true), check actual screen width
  const showPhotoLightbox = (src: string) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;cursor:pointer;';
    overlay.onclick = () => overlay.remove();
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
    const close = document.createElement('div');
    close.textContent = '✕';
    close.style.cssText = 'position:absolute;top:20px;right:24px;color:white;font-size:28px;font-weight:bold;cursor:pointer;background:rgba(0,0,0,0.5);width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
    overlay.appendChild(img);
    overlay.appendChild(close);
    document.body.appendChild(overlay);
  };

  const [isMobile, setIsMobile] = useState(!isStandalone || window.innerWidth < 768);

  useEffect(() => {
    if (isStandalone) {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [isStandalone]);

  // State
  const [activeTab, setActiveTab] = useState<'home' | 'my_jobs' | 'team' | 'planner' | 'more'>('home'); 
  const [mobileModule, setMobileModule] = useState<'none' | 'planner' | 'reports' | 'clients' | 'tickets' | 'sales_requests'>('none');
  const [homeFilter, setHomeFilter] = useState<'all'|'progress'|'carry'|'pending'|'all_history'>('all'); 
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals State
  const [modalType, setModalType] = useState<'dispatch' | 'cancel' | 'carry' | 'job_carry' | 'job_complete' | 'activity_job_carry' | 'activity_job_complete' | 'activity_dispatch' | 'manage_team' | null>(null);
  const [modalTicket, setModalTicket] = useState<Ticket | null>(null);
  const [modalActivity, setModalActivity] = useState<Activity | null>(null);
  
  // Create Ticket State
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [createTicketForm, setCreateTicketForm] = useState({
    customerName: '', phone: '', category: '', type: '', priority: 'MEDIUM',
    description: '', locationUrl: '', houseNumber: ''
  });
  
  // Detail Sheets State
  const [viewTech, setViewTech] = useState<Technician | null>(null);
  const [viewFreelancer, setViewFreelancer] = useState<{ name: string; phone: string; activities: any[] } | null>(null);
  const [viewTicket, setViewTicket] = useState<Ticket | null>(null); 
  const [viewActivity, setViewActivity] = useState<Activity | null>(null);
  const [viewJob, setViewJob] = useState<{ type: 'ticket' | 'activity', data: any } | null>(null);

  // Action Form State
  const [actionNote, setActionNote] = useState('');
  const [carryIssue, setCarryIssue] = useState(''); // Issue field for carry forward
  const [selectedTechId, setSelectedTechId] = useState('');
  const [assignedTeamLead, setAssignedTeamLead] = useState('');

  // Activity Dispatch State (Team Lead picks the execution crew)
  const [dispatchPrimaryId, setDispatchPrimaryId] = useState('');
  const [dispatchSupportIds, setDispatchSupportIds] = useState<string[]>([]);
  const [dispatchFreelancers, setDispatchFreelancers] = useState<{name:string;role:string;phone:string}[]>([]);

  // Activity reschedule modal state
  const [showActivityReschedule, setShowActivityReschedule] = useState(false);
  const [rescheduleActivityTarget, setRescheduleActivityTarget] = useState<Activity | null>(null);
  const [rescheduleActivityDate, setRescheduleActivityDate] = useState('');
  
  // Date Picker State
  const [nextDate, setNextDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showJobHistory, setShowJobHistory] = useState(false);

  // Change password state
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [cpForm, setCpForm] = useState({ current: '', next: '', confirm: '' });
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState(false);
  
  // Temp Picker Values
  const [tempDatetime, setTempDatetime] = useState(''); // YYYY-MM-DDTHH:mm for datetime-local

  // Notifications / Activity Log
  const [showNotifications, setShowNotifications] = useState(false);

  // Create Activity customer search
  const [actCustSearch, setActCustSearch] = useState('');
  const [actSelectedCustomer, setActSelectedCustomer] = useState<Customer | null>(null);
  const [actServiceCats, setActServiceCats] = useState<string[]>([]);

  // Create Activity (quick) — all form state fully initialized for clean resets
  const [showCreateActivity, setShowCreateActivity] = useState(false);
  const EMPTY_CREATE_FORM = {
      type: '', serviceCategory: '', customerId: '', description: '',
      plannedDate: '', priority: 'MEDIUM', locationUrl: '', houseNumber: '', assignedEngineerId: ''
  };
  const [createActivityForm, setCreateActivityForm] = useState({ ...EMPTY_CREATE_FORM });

  // Create Ticket — customer phone search
  const [ticketPhoneSearch, setTicketPhoneSearch] = useState('');
  const [ticketSelectedCustomer, setTicketSelectedCustomer] = useState<Customer | null>(null);

  // Initialize focused ticket
  useEffect(() => {
      if (focusedTicketId) {
          setSelectedTicketId(focusedTicketId);
          setMobileModule('none');
          setActiveTab('home');
      }
  }, [focusedTicketId]);

  // Update Team Lead when Engineer changes
  useEffect(() => {
    if (selectedTechId) {
        const tech = technicians.find(t => t.id === selectedTechId);
        const leadName = tech ? engineerTeamMap[tech.name] : null;
        setAssignedTeamLead(leadName || "Auto-assigned");
    } else {
        setAssignedTeamLead("Auto-assigned");
    }
  }, [selectedTechId, technicians]);

  // STALLED Logic
  const isStalled = (t: Ticket) => {
      if (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CANCELLED) return false;
      const lastUpdate = new Date(t.updatedAt).getTime();
      const diffHours = (Date.now() - lastUpdate) / (1000 * 60 * 60);
      return diffHours > 36;
  };

  const stalledCount = tickets.filter(isStalled).length;
  const newTicketsCount = tickets.filter(t => t.status === TicketStatus.NEW).length;

  // ── Pending Sales Appointment Requests count (for quick action badge) ──
  const [pendingSARCount, setPendingSARCount] = useState(0);
  useEffect(() => {
    const token = localStorage.getItem('qonnect_token');
    fetch('/api/dashboard/pending-sales-requests', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setPendingSARCount(data.count || 0); })
      .catch(() => {});
    // Refresh every 60s
    const interval = setInterval(() => {
      fetch('/api/dashboard/pending-sales-requests', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setPendingSARCount(data.count || 0); })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Filtered Tickets
  const visibleTickets = useMemo(() => {
      let list = tickets;
      if (searchTerm.trim()) {
          const lower = searchTerm.toLowerCase();
          list = list.filter(t => 
              t.id.toLowerCase().includes(lower) ||
              t.customerName.toLowerCase().includes(lower) ||
              t.phoneNumber.includes(lower) ||
              t.category.toLowerCase().includes(lower)
          );
      }
      return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [tickets, searchTerm]);

  const completedJobs = useMemo(() => {
      if (!currentUserId) return [];
      const doneTickets = tickets
          .filter(t =>
              t.assignedTechId === currentUserId &&
              (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CANCELLED)
          )
          .map(t => ({ kind: 'ticket' as const, data: t, sortDate: t.updatedAt || t.createdAt }));
      const doneActivities = (activities || [])
          .filter(a => a.leadTechId === currentUserId && (a.status === 'DONE' || a.status === 'CANCELLED' || a.status === 'CARRY_FORWARD'))
          // Use plannedDate so activities appear on the correct visit day when browsing history
          .map(a => ({ kind: 'activity' as const, data: a, sortDate: a.plannedDate || a.updatedAt || a.createdAt }));
      return [...doneTickets, ...doneActivities]
          .sort((a, b) => new Date(b.sortDate || 0).getTime() - new Date(a.sortDate || 0).getTime())
          .slice(0, 100); // last 100 completed/CF items
  }, [tickets, currentUserId]);

  const myJobs = useMemo(() => {
      if (!currentUserId) return [];

      const myTicketJobs = tickets
          .filter(t =>
              t.assignedTechId === currentUserId &&
              t.status !== TicketStatus.RESOLVED &&
              t.status !== TicketStatus.CANCELLED
          )
          .map(t => ({ kind: 'ticket' as const, data: t, sortDate: t.updatedAt || t.createdAt }));

      const myActivityJobs = (activities || [])
          .filter(a =>
              a.leadTechId === currentUserId &&
              a.status !== 'DONE' &&
              a.status !== 'CANCELLED'
          )
          .map(a => ({ kind: 'activity' as const, data: a, sortDate: a.plannedDate || a.updatedAt || a.createdAt }));

      return [...myTicketJobs, ...myActivityJobs].sort(
          (a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime()
      );
  }, [tickets, activities, currentUserId]);

  // My Jobs date picker (TechPortal style)
  const [myJobsDate, setMyJobsDate] = useState<string>(() => {
      const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const myJobsDateRange = useMemo(() => {
      const dates: { key: string; day: string; weekday: string; month: string; isToday: boolean }[] = [];
      const today = new Date();
      for (let i = -7; i <= 2; i++) {
          const d = new Date(today); d.setDate(today.getDate() + i);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          dates.push({ key, day: String(d.getDate()).padStart(2,'0'), weekday: d.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase(), month: d.toLocaleDateString('en-US',{month:'short'}).toUpperCase(), isToday: i===0 });
      }
      return dates;
  }, []);
  const myJobsTodayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const myJobsIsPast = myJobsDate < myJobsTodayKey;
  const myJobsDateFiltered = useMemo(() => {
      const dateKey = myJobsDate;
      const matchDate = (iso: string) => {
          if (!iso) return false;
          const dt = new Date(iso);
          return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` === dateKey;
      };
      if (myJobsIsPast) {
          // Past dates: only completed jobs from that date
          return completedJobs.filter(item => matchDate(item.sortDate))
              .map(item => ({ type: item.kind as any, data: item.data, date: item.sortDate, priority: (item.data as any).priority || 'MEDIUM', delayed: false, kind: item.kind }));
      }
      if (dateKey === myJobsTodayKey) {
          // TODAY: jobs planned for today + in-progress (any date) + completed today
          const inProgressStatuses = ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'];
          const todayJobs = myJobs.filter(j => {
              const status = (j.data as any).status;
              if (inProgressStatuses.includes(status)) return true;
              const jDate = (j as any).sortDate || '';
              return matchDate(jDate);
          }).map(j => ({ ...j, type: j.kind as any, date: j.sortDate, priority: (j.data as any).priority || 'MEDIUM', delayed: false }));
          const doneToday = completedJobs.filter(item => matchDate(item.sortDate))
              .map(item => ({ type: item.kind as any, data: item.data, date: item.sortDate, priority: (item.data as any).priority || 'MEDIUM', delayed: false, kind: item.kind }));
          const ids = new Set(todayJobs.map(j => j.data.id));
          return [...todayJobs, ...doneToday.filter(j => !ids.has(j.data.id))];
      }
      // Future dates: filter by planned date
      const active = myJobs.filter(j => {
          const jDate = (j as any).sortDate || (j as any).date || '';
          return matchDate(jDate);
      });
      return active;
  }, [myJobs, completedJobs, myJobsDate, myJobsIsPast, myJobsTodayKey]);
  const myJobsInProgress = myJobs.filter(j => {
      const s = (j.data as any).status;
      return ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(s);
  });

  const newTickets = visibleTickets.filter(t => t.status === TicketStatus.NEW);
  const activeOps = visibleTickets.filter(t => 
      [TicketStatus.OPEN, TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS, TicketStatus.CARRY_FORWARD].includes(t.status)
  );

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);

  // Recent changes feed — combines ticket + activity updates, sorted by updatedAt
  // ── Notification System ────────────────────────────────────────────────────
  // Targeted notifications for THIS Team Lead only:
  // - New activities assigned to them (last 48h, PLANNED)
  // - Overdue activities (planned date passed, not started)
  // - Carry Forward items needing reschedule
  // - Urgent/High priority items newly assigned
  const notifications = useMemo(() => {
      const now = Date.now();
      const h48 = 48 * 60 * 60 * 1000;
      const items: {
          id: string; kind: 'activity' | 'ticket'; title: string;
          subtitle: string; status: string; updatedAt: string;
          priority: string; type: 'new_assignment' | 'overdue' | 'carry_forward' | 'urgent';
          ref: string;
      }[] = [];

      // Activities assigned to this TL
      const myActivities = (activities || []).filter(a => a.leadTechId === currentUserId);

      myActivities.forEach(a => {
          const act = a as any;
          const updatedMs = new Date(a.updatedAt || a.createdAt).getTime();
          const plannedMs = new Date(a.plannedDate).getTime();
          const isNew = updatedMs > now - h48;
          const isOverdue = plannedMs < now && !['DONE','CANCELLED','IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(act.status);
          const isCF = act.status === 'CARRY_FORWARD';
          const isUrgent = (act.priority === 'URGENT' || act.priority === 'HIGH') && isNew;

          if (isUrgent) {
              items.push({ id: a.id, kind: 'activity', title: act.type || 'Activity',
                  subtitle: (customers || []).find((cu: any) => cu.id === a.customerId)?.name || act.customerName || '',
                  status: act.status, updatedAt: a.updatedAt || a.createdAt,
                  priority: act.priority, type: 'urgent', ref: act.reference || a.id });
          } else if (isCF) {
              items.push({ id: a.id, kind: 'activity', title: act.type || 'Activity',
                  subtitle: (customers || []).find((cu: any) => cu.id === a.customerId)?.name || act.customerName || '',
                  status: act.status, updatedAt: a.updatedAt || a.createdAt,
                  priority: act.priority, type: 'carry_forward', ref: act.reference || a.id });
          } else if (isOverdue) {
              items.push({ id: a.id, kind: 'activity', title: act.type || 'Activity',
                  subtitle: (customers || []).find((cu: any) => cu.id === a.customerId)?.name || act.customerName || '',
                  status: act.status, updatedAt: a.updatedAt || a.createdAt,
                  priority: act.priority, type: 'overdue', ref: act.reference || a.id });
          } else if (isNew && act.status === 'PLANNED') {
              items.push({ id: a.id, kind: 'activity', title: act.type || 'Activity',
                  subtitle: (customers || []).find((cu: any) => cu.id === a.customerId)?.name || act.customerName || '',
                  status: act.status, updatedAt: a.updatedAt || a.createdAt,
                  priority: act.priority, type: 'new_assignment', ref: act.reference || a.id });
          }
      });

      // Tickets assigned to this TL (new in last 48h)
      (tickets || []).filter(t => t.assignedTechId === currentUserId).forEach(t => {
          const updatedMs = new Date(t.updatedAt || t.createdAt).getTime();
          if (updatedMs > now - h48 && !['RESOLVED','CANCELLED'].includes(t.status)) {
              items.push({ id: t.id, kind: 'ticket', title: t.type || 'Ticket',
                  subtitle: t.customerName || '', status: t.status,
                  updatedAt: t.updatedAt || t.createdAt, priority: t.priority || 'MEDIUM',
                  type: 'new_assignment', ref: t.id });
          }
      });

      // Sort: urgent first, then carry_forward, overdue, new — within each by recency
      const order = { urgent: 0, carry_forward: 1, overdue: 2, new_assignment: 3 };
      return items
          .sort((a, b) => (order[a.type] - order[b.type]) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 30);
  }, [tickets, activities, customers, currentUserId]);

  const unreadNotifCount = notifications.length;

  // Dashboard counts
  const currentTech = technicians.find(t => t.id === currentUserId);

  // Unified feed: merge tickets + activities into common shape
  type FeedItem = { kind: 'ticket'; data: Ticket; status: string; sortDate: string } | { kind: 'activity'; data: Activity; status: string; sortDate: string };
  
  const unifiedFeed = useMemo(() => {
      const searchLower = searchTerm.trim().toLowerCase();
      
      // Tickets
      let ticketItems: FeedItem[] = visibleTickets.map(t => ({
          kind: 'ticket' as const, data: t, status: t.status, sortDate: t.updatedAt || t.createdAt
      }));

      // Activities  
      let actItems: FeedItem[] = (activities || []).map(a => {
          const act = a as any;
          return {
              kind: 'activity' as const, data: a, status: act.status || 'PLANNED',
              sortDate: act.updatedAt || act.plannedDate || act.createdAt
          };
      });

      // Apply search filter to activities too
      if (searchLower) {
          actItems = actItems.filter(item => {
              const a = item.data as any;
              const custName = (customers || []).find((c: any) => c.id === a.customerId)?.name || '';
              return (a.reference || a.id || '').toLowerCase().includes(searchLower) ||
                     custName.toLowerCase().includes(searchLower) ||
                     (a.type || '').toLowerCase().includes(searchLower) ||
                     (a.serviceCategory || '').toLowerCase().includes(searchLower);
          });
      }

      return [...ticketItems, ...actItems].sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());
  }, [visibleTickets, activities, customers, searchTerm]);

  // Counts from unified feed
  const inProgressStatuses = ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED', 'STARTED'];
  const pendingStatuses = ['NEW', 'OPEN', 'ASSIGNED', 'PLANNED'];
  const doneStatuses = ['RESOLVED', 'DONE', 'CANCELLED'];
  
  const inProgressCount = unifiedFeed.filter(f => inProgressStatuses.includes(f.status)).length;
  const carryForwardCount = unifiedFeed.filter(f => f.status === 'CARRY_FORWARD').length;
  const pendingCount = unifiedFeed.filter(f => pendingStatuses.includes(f.status)).length;
  const totalJobsCount = unifiedFeed.length;
  
  // Filtered feed
  const homeFilteredFeed = useMemo(() => {
      if (homeFilter === 'all') return unifiedFeed.filter(f => !doneStatuses.includes(f.status));
      if (homeFilter === 'progress') return unifiedFeed.filter(f => inProgressStatuses.includes(f.status));
      if (homeFilter === 'carry') return unifiedFeed.filter(f => f.status === 'CARRY_FORWARD');
      if (homeFilter === 'pending') return unifiedFeed.filter(f => pendingStatuses.includes(f.status));
      if (homeFilter === 'all_history') return unifiedFeed;
      return unifiedFeed;
  }, [unifiedFeed, homeFilter]);

  // Group feed items by date
  const groupedFeed = useMemo(() => {
      const groups: Record<string, FeedItem[]> = {};
      homeFilteredFeed.forEach(item => {
          const dt = new Date(item.sortDate);
          const today = new Date();
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          let label: string;
          if (dt.toDateString() === today.toDateString()) label = 'Today';
          else if (dt.toDateString() === yesterday.toDateString()) label = 'Yesterday';
          else label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: dt.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
          if (!groups[label]) groups[label] = [];
          groups[label].push(item);
      });
      return groups;
  }, [homeFilteredFeed]);

  // --- Handlers ---

  const handleTicketCardTap = (ticket: Ticket) => {
      setViewTicket(ticket);
  };

  const handleActivityCardTap = (activity: Activity) => {
      setViewActivity(activity);
  };

  const handleOpenFullTicket = () => {
      if (viewTicket) {
          if (viewTicket.status === TicketStatus.NEW && onUpdateTicket) {
              onUpdateTicket({ ...viewTicket, status: TicketStatus.OPEN, updatedAt: new Date().toISOString() });
          }
          setSelectedTicketId(viewTicket.id);
          setViewTicket(null);
      }
  };

  const handleQuickDispatch = (e: React.MouseEvent, ticket: Ticket) => {
      e.stopPropagation();
      setModalTicket(ticket);
      setModalActivity(null);
      setModalType('dispatch');
      setSelectedTechId(ticket.assignedTechId || '');
      setActionNote(ticket.assignmentNote || '');
  };

  const executeDispatch = () => {
      if (!modalTicket || !onUpdateTicket) return;
      onUpdateTicket({
          ...modalTicket,
          status: TicketStatus.ASSIGNED,
          assignedTechId: selectedTechId,
          assignmentNote: actionNote,
          updatedAt: new Date().toISOString()
      });
      closeModal();
  };

  const executeCancel = () => {
      if (!modalTicket || !onUpdateTicket) return;
      onUpdateTicket({
          ...modalTicket,
          status: TicketStatus.CANCELLED,
          cancellationReason: actionNote,
          updatedAt: new Date().toISOString()
      });
      closeModal();
  };

  const executeCarryForward = () => {
      if (!modalTicket || !onUpdateTicket) return;
      onUpdateTicket({
          ...modalTicket,
          status: TicketStatus.CARRY_FORWARD,
          carryForwardNote: actionNote,
          nextPlannedAt: nextDate,
          updatedAt: new Date().toISOString()
      });
      closeModal();
  };

  // Step-by-step ticket workflow matching TechPortal: ASSIGNED → ON_MY_WAY → ARRIVED → IN_PROGRESS
  const handleTicketOnMyWay = (ticket: Ticket) => {
      if (onUpdateTicket) {
          onUpdateTicket({ ...ticket, status: TicketStatus.ON_MY_WAY, updatedAt: new Date().toISOString() });
      }
  };
  const handleTicketArrived = (ticket: Ticket) => {
      if (onUpdateTicket) {
          onUpdateTicket({ ...ticket, status: TicketStatus.ARRIVED, updatedAt: new Date().toISOString() });
      }
  };
  const handleTicketStartWork = (ticket: Ticket) => {
      if (onUpdateTicket) {
          onUpdateTicket({ ...ticket, status: TicketStatus.IN_PROGRESS, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
  };

  const handleOpenJobAction = (type: 'job_carry' | 'job_complete', ticket: Ticket) => {
      setModalTicket(ticket);
      setModalType(type);
      setActionNote('');
      setNextDate('');
  };

  const executeJobComplete = () => {
      if (!modalTicket || !onUpdateTicket) return;
      onUpdateTicket({
          ...modalTicket,
          status: TicketStatus.RESOLVED,
          completionNote: actionNote,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      });
      closeModal();
      setViewTicket(null);
  };

  const executeJobCarry = () => {
      if (!modalTicket || !onUpdateTicket) return;
      
      onUpdateTicket({
          ...modalTicket,
          status: TicketStatus.CARRY_FORWARD, 
          carryForwardNote: carryIssue ? `Reason: ${carryIssue}\nRemark: ${actionNote}` : actionNote,
          nextPlannedAt: nextDate, 
          updatedAt: new Date().toISOString()
      } as any);
      closeModal();
      setViewTicket(null);
  };

  const openDateTimePicker = () => {
      let d = new Date();
      
      // If we have an existing selected date, use it
      if (nextDate) {
          d = new Date(nextDate);
      } else {
          // Default: Now + 2 hours, rounded up to next 15m
          d.setHours(d.getHours() + 2);
          const minutes = d.getMinutes();
          const remainder = minutes % 15;
          if (remainder !== 0) {
              const add = 15 - remainder;
              d.setMinutes(minutes + add);
          }
          d.setSeconds(0);
          d.setMilliseconds(0);
      }
      
      // Date Part YYYY-MM-DD
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setTempDate(`${yyyy}-${mm}-${dd}`);

      // Time Part 12H
      let hours = d.getHours();
      const mins = d.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; 
      
      setTempHour(String(hours).padStart(2, '0'));
      
      // Snap minutes to nearest valid option if somehow invalid
      let nearestMin = String(mins).padStart(2, '0');
      if (!MINUTES_STEP.includes(nearestMin)) {
          nearestMin = MINUTES_STEP.reduce((prev, curr) => 
            Math.abs(parseInt(curr) - mins) < Math.abs(parseInt(prev) - mins) ? curr : prev
          );
      }
      // Init datetime-local to existing selected date or default +1 hour from now
      const existingParsed = nextDate ? new Date(nextDate) : null;
      const initDt = existingParsed && !isNaN(existingParsed.getTime()) && existingParsed > new Date()
          ? existingParsed
          : (() => { const d = new Date(); d.setHours(d.getHours()+1, 0, 0, 0); return d; })();
      const pad = (n: number) => String(n).padStart(2,'0');
      setTempDatetime(`${initDt.getFullYear()}-${pad(initDt.getMonth()+1)}-${pad(initDt.getDate())}T${pad(initDt.getHours())}:${pad(initDt.getMinutes())}`);
      setShowDatePicker(true);
  };

  const confirmDateTime = () => {
      if (!tempDatetime) return;
      const combined = new Date(tempDatetime);
      if (isNaN(combined.getTime()) || combined < new Date()) {
          toast.error("Please select a future date and time.");
          return;
      }
      setNextDate(combined.toISOString());
      setShowDatePicker(false);
  };

  const closeModal = () => {
      setModalType(null);
      setModalTicket(null);
      setModalActivity(null);
      setActionNote('');
      setCarryIssue('');
      setSelectedTechId('');
      setNextDate('');
      setShowDatePicker(false);
      setDispatchPrimaryId('');
      setDispatchSupportIds([]);
      setDispatchFreelancers([]);
  };

  // Helper to open activity reschedule modal
  const openActivityReschedule = (act: Activity, defaultOffset = 0) => {
      const d = new Date(act.plannedDate || Date.now());
      if (defaultOffset) d.setDate(d.getDate() + defaultOffset);
      const pad = (n: number) => String(n).padStart(2,'0');
      setRescheduleActivityDate(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
      setRescheduleActivityTarget(act);
      setShowActivityReschedule(true);
  };

  const getStatusColor = (s: string) => {
      switch(s) {
          case TicketStatus.NEW: return 'bg-emerald-500 text-white';
          case TicketStatus.OPEN: return 'bg-blue-500 text-white';
          case TicketStatus.ASSIGNED: return 'bg-purple-500 text-white';
          case TicketStatus.IN_PROGRESS: 
          case 'IN_PROGRESS': return 'bg-amber-500 text-white animate-pulse';
          case TicketStatus.CARRY_FORWARD: return 'bg-orange-500 text-white';
          case TicketStatus.RESOLVED: 
          case 'DONE': return 'bg-slate-500 text-white';
          case TicketStatus.CANCELLED: 
          case 'CANCELLED': return 'bg-red-500 text-white';
          case 'PLANNED': return 'bg-blue-400 text-white';
          default: return 'bg-slate-400 text-white';
      }
  };

  const getTechJobs = (techId: string) => {
      const techTickets = tickets.filter(t => t.assignedTechId === techId && t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CANCELLED);
      const techActivities = activities.filter(a => a.leadTechId === techId && a.status !== 'DONE' && a.status !== 'CANCELLED');
      
      const combined = [
          ...techTickets.map(t => ({ type: 'ticket' as const, data: t, date: t.updatedAt })),
          ...techActivities.map(a => ({ type: 'activity' as const, data: a, date: a.plannedDate }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
          all: combined,
          pendingCount: combined.filter(i => {
              const status = i.type === 'ticket' ? i.data.status : i.data.status;
              return ['OPEN', 'ASSIGNED', 'PLANNED', 'NEW'].includes(status);
          }).length,
          progressCount: combined.filter(i => {
              const status = i.type === 'ticket' ? i.data.status : i.data.status;
              return ['IN_PROGRESS', 'STARTED'].includes(status);
          }).length,
          activeCount: combined.length
      };
  };

  // --- Sub-Components ---

  const TicketCard: React.FC<{ ticket: Ticket }> = ({ ticket }) => {
      const stalled = isStalled(ticket);
      const locationDisplay = ticket.houseNumber 
        ? ticket.houseNumber 
        : (ticket.locationUrl ? "Map Location Available" : "Location not set");

      return (
          <div 
            onClick={() => handleTicketCardTap(ticket)}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-3 active:scale-[0.98] transition-transform relative overflow-hidden group"
          >
              {stalled && (
                  <div className="absolute top-0 right-0 bg-red-500 text-white text-[9px] px-2 py-1 rounded-bl-lg font-bold z-10 flex items-center gap-1">
                      <AlertTriangle size={10} /> STALLED
                  </div>
              )}
              
              <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(ticket.status)}`}>
                          {ticket.status.replace('_', ' ')}
                      </span>
                      <span className="text-xs font-mono text-slate-500">#{ticket.id}</span>
                  </div>
              </div>

              <h4 className="font-bold text-slate-800 text-sm mb-1">{ticket.customerName}</h4>
              
              <div className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPin size={12} />
                  <span className="truncate max-w-[200px]">{locationDisplay}</span>
              </div>

              {/* Carry Forward indicator */}
              {ticket.carryForwardNote && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                      <span className="font-bold">⟲ CF:</span>
                      <span className="truncate">{ticket.carryForwardNote.split('\n')[0]}</span>
                  </div>
              )}

              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-200 group-hover:text-slate-400 transition-colors">
                  <ChevronRight size={20} />
              </div>
          </div>
      );
  };

  // --- Activity card for the home feed (simpler than ActivityJobCard) ---
  const ActivityFeedCard: React.FC<{ activity: Activity }> = ({ activity }) => {
      const act = activity as any;
      const actStatus = act.status || 'PLANNED';
      const actCustomer = customers?.find((c: any) => c.id === act.customerId);
      const displayName  = actCustomer?.name  || (act as any).customerName  || act.type || 'Activity';
      const displayPhone = actCustomer?.phone || (act as any).customerPhone || '';
      const statusColor =
          actStatus === 'IN_PROGRESS' ? 'bg-amber-500 text-white' :
          actStatus === 'ON_MY_WAY'   ? 'bg-cyan-500 text-white' :
          actStatus === 'ARRIVED'     ? 'bg-indigo-500 text-white' :
          actStatus === 'DONE'        ? 'bg-emerald-500 text-white' :
          actStatus === 'CANCELLED'   ? 'bg-red-100 text-red-700' :
          actStatus === 'CARRY_FORWARD' ? 'bg-orange-500 text-white' :
          'bg-purple-500 text-white';
      const locationDisplay = act.houseNumber || (act.locationUrl ? 'Map Location' : 'No location');
      return (
          <div 
            onClick={() => setViewActivity(activity)}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-3 active:scale-[0.98] transition-transform relative overflow-hidden group"
          >
              <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor}`}>
                          {actStatus.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-mono text-slate-500">#{act.reference || act.id}</span>
                      <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">ACTIVITY</span>
                  </div>
              </div>
              <h4 className="font-bold text-slate-800 text-sm mb-0.5">{displayName}</h4>
              <div className="text-xs text-slate-500 mb-1">{act.type}{act.serviceCategory ? ` · ${act.serviceCategory}` : ''}</div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPin size={12} />
                  <span className="truncate max-w-[200px]">{locationDisplay}</span>
              </div>
              {act.carryForwardNote && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                      <span className="font-bold">⟲ CF:</span>
                      <span className="truncate">{act.carryForwardNote.split('\n')[0]}</span>
                  </div>
              )}
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-200 group-hover:text-slate-400 transition-colors">
                  <ChevronRight size={20} />
              </div>
          </div>
      );
  };

    const JobCard: React.FC<{ ticket: Ticket }> = ({ ticket }) => {
      const isCompleted = ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CANCELLED;
      const isWarranty   = ticket.type === TicketType.WARRANTY;
      const isChargeable = ticket.type === TicketType.CHARGEABLE;
      const ticketSteps = [
          { key: 'ASSIGNED',    label: 'Assigned'   },
          { key: 'ON_MY_WAY',   label: 'On the Way' },
          { key: 'ARRIVED',     label: 'Arrived'    },
          { key: 'IN_PROGRESS', label: 'Working'    },
      ];
      const normalizedStatus = (ticket.status === TicketStatus.OPEN || (ticket.status as string) === 'NEW') ? 'ASSIGNED' : ticket.status;
      const currentStep = ticketSteps.findIndex(s => s.key === normalizedStatus);
      const progress = isCompleted ? 100 : Math.max(5, ((currentStep + 1) / ticketSteps.length) * 100);
      const statusColor =
          ticket.status === TicketStatus.ASSIGNED    ? 'bg-purple-100 text-purple-700' :
          ticket.status === TicketStatus.ON_MY_WAY   ? 'bg-cyan-100 text-cyan-700' :
          ticket.status === TicketStatus.ARRIVED     ? 'bg-indigo-100 text-indigo-700' :
          ticket.status === TicketStatus.IN_PROGRESS ? 'bg-amber-100 text-amber-700' :
          ticket.status === TicketStatus.RESOLVED    ? 'bg-emerald-100 text-emerald-700' :
          'bg-slate-100 text-slate-600';

      return (
          <div
            onClick={() => handleTicketCardTap(ticket)}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-3 overflow-hidden active:scale-[0.99] transition-transform"
          >
              {/* Progress bar */}
              <div className="h-1 bg-slate-100">
                  <div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }}/>
              </div>
              <div className="p-5">
                  {/* Header */}
                  <div className="flex justify-between items-start mb-3">
                      <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{ticket.id}</div>
                          <h3 className="text-base font-bold text-slate-900">{ticket.customerName}</h3>
                          <div className="text-sm text-slate-500 mt-0.5">
                              {ticket.category}
                              {isWarranty   && <span className="ml-2 text-emerald-600 font-bold text-[10px]">✓ Warranty</span>}
                              {isChargeable && <span className="ml-2 text-amber-600 font-bold text-[10px]">QAR 199</span>}
                          </div>
                      </div>
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${statusColor}`}>
                          {ticket.status.replace(/_/g,' ')}
                      </span>
                  </div>
                  {/* Location */}
                  <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                      <MapPin size={13} className="text-slate-400 shrink-0"/>
                      <span className="truncate flex-1">{ticket.houseNumber || ticket.locationUrl || 'No location set'}</span>
                      {ticket.locationUrl && (
                          <a href={ticket.locationUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
                              className="shrink-0 flex items-center gap-1 text-[10px] text-blue-600 font-bold px-2 py-1 bg-blue-50 rounded-lg">
                              Map
                          </a>
                      )}
                  </div>
                  {/* Carry Forward Banner */}
                  {ticket.carryForwardNote && (
                      <div className="bg-amber-50 rounded-xl p-3 mb-3 border border-amber-200">
                          <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-bold text-amber-700 uppercase">⟲ Carry Forward</span>
                          </div>
                          <p className="text-xs text-amber-800 whitespace-pre-wrap line-clamp-3">{ticket.carryForwardNote}</p>
                          {ticket.nextPlannedAt && (
                              <div className="text-[10px] text-amber-600 mt-1 font-medium">
                                  Next: {new Date(ticket.nextPlannedAt).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short'})} at {new Date(ticket.nextPlannedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}
                              </div>
                          )}
                      </div>
                  )}
                  {/* Completion note */}
                  {ticket.status === TicketStatus.RESOLVED && (ticket as any).completionNote && (
                      <div className="bg-emerald-50 rounded-xl p-3 mb-3 border border-emerald-200">
                          <div className="text-[10px] font-bold text-emerald-600 uppercase mb-0.5">Resolution</div>
                          <p className="text-xs text-emerald-800 whitespace-pre-wrap line-clamp-2">{(ticket as any).completionNote}</p>
                      </div>
                  )}
                  {/* Call */}
                  {ticket.phoneNumber ? (
                      <a href={`tel:${ticket.phoneNumber}`} onClick={e=>e.stopPropagation()}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs mb-4 hover:bg-slate-100 transition-colors">
                          <Phone size={13}/> Call Customer
                      </a>
                  ) : (
                      <div className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-400 rounded-xl text-xs mb-4">
                          <Phone size={13}/> No phone number
                      </div>
                  )}
                  {/* 5-step progress */}
                  {!isCompleted ? (
                      <div className="flex items-center justify-between px-1">
                          {ticketSteps.map((step, i) => (
                              <React.Fragment key={step.key}>
                                  <div className="flex flex-col items-center">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                                          i < currentStep  ? 'bg-emerald-500 border-emerald-500 text-white' :
                                          i === currentStep? 'bg-slate-900 border-slate-900 text-white' :
                                          'bg-white border-slate-200 text-slate-400'
                                      }`}>{i < currentStep ? '✓' : i+1}</div>
                                      <span className={`text-[9px] mt-0.5 font-medium ${i===currentStep?'text-slate-900':'text-slate-400'}`}>{step.label}</span>
                                  </div>
                                  {i < 3 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${i<currentStep?'bg-emerald-500':'bg-slate-200'}`}/>}
                              </React.Fragment>
                          ))}
                      </div>
                  ) : (
                      <div className="flex items-center justify-center gap-2 py-2 bg-emerald-50 rounded-xl text-emerald-700 font-bold text-xs">
                          ✓ Completed
                      </div>
                  )}
              </div>
          </div>
      );
  };

  const ActivityJobCard: React.FC<{ activity: Activity }> = ({ activity }) => {
    const act = activity as any;
    const actStatus = act.status || 'PLANNED';
    const actCustomer = customers?.find((c: any) => c.id === act.customerId);
    const actDisplayName  = actCustomer?.name  || (act as any).customerName  || act.type || 'Activity';
    const actDisplayPhone = actCustomer?.phone || (act as any).customerPhone || '';
    const isCompleted = actStatus === 'DONE' || actStatus === 'CANCELLED';
    const actSteps5 = ['PLANNED','ON_MY_WAY','ARRIVED','IN_PROGRESS','DONE'];
    const actStepIdx = Math.max(0, actSteps5.indexOf(actStatus));
    const actProgress = isCompleted ? 100 : Math.max(5, ((actStepIdx + 1) / actSteps5.length) * 100);
    const actStepLabels = [
        { key: 'PLANNED',     label: 'Assigned'   },
        { key: 'ON_MY_WAY',   label: 'On the Way' },
        { key: 'ARRIVED',     label: 'Arrived'    },
        { key: 'IN_PROGRESS', label: 'Working'    },
    ];
    const actStatusColor =
        actStatus === 'ON_MY_WAY'  ? 'bg-cyan-100 text-cyan-700' :
        actStatus === 'ARRIVED'    ? 'bg-indigo-100 text-indigo-700' :
        actStatus === 'IN_PROGRESS'? 'bg-amber-100 text-amber-700' :
        actStatus === 'DONE'       ? 'bg-emerald-100 text-emerald-700' :
        'bg-purple-100 text-purple-700';

    return (
        <div
          onClick={() => setViewActivity(activity)}
          className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-3 overflow-hidden active:scale-[0.99] transition-transform"
        >
            {/* Progress bar */}
            <div className="h-1 bg-slate-100">
                <div className="h-1 bg-emerald-500 transition-all duration-500" style={{ width: `${actProgress}%` }}/>
            </div>
            <div className="p-5">
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                    <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{act.reference || act.id}</div>
                        <h3 className="text-base font-bold text-slate-900">{actDisplayName}</h3>
                        <div className="text-sm text-slate-500 mt-0.5">{act.type}{act.serviceCategory ? ` · ${act.serviceCategory}` : ''}</div>
                    </div>
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${actStatusColor}`}>
                        {actStatus.replace(/_/g,' ')}
                    </span>
                </div>
                {/* Location */}
                <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                    <MapPin size={13} className="text-slate-400 shrink-0"/>
                    <span className="truncate flex-1">{act.houseNumber || act.locationUrl || 'No location set'}</span>
                    {act.locationUrl && (
                        <a href={act.locationUrl} target="_blank" rel="noopener noreferrer" onClick={(e:any)=>e.stopPropagation()}
                            className="shrink-0 flex items-center gap-1 text-[10px] text-blue-600 font-bold px-2 py-1 bg-blue-50 rounded-lg">
                            Map
                        </a>
                    )}
                </div>
                {/* Description */}
                {act.description && (
                    <div className="bg-slate-50 rounded-xl p-3 mb-3 text-xs text-slate-700 line-clamp-2">{act.description}</div>
                )}
                {/* Carry Forward Banner */}
                {act.carryForwardNote && (
                    <div className="bg-amber-50 rounded-xl p-3 mb-3 border border-amber-200">
                        <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] font-bold text-amber-700 uppercase">⟲ Carry Forward</span>
                        </div>
                        <p className="text-xs text-amber-800 whitespace-pre-wrap line-clamp-3">{act.carryForwardNote}</p>
                        {act.nextPlannedAt && (
                            <div className="text-[10px] text-amber-600 mt-1 font-medium">
                                Next: {new Date(act.nextPlannedAt).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short'})} at {new Date(act.nextPlannedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}
                            </div>
                        )}
                    </div>
                )}
                {/* Completion note if done */}
                {actStatus === 'DONE' && act.completionNote && (
                    <div className="bg-emerald-50 rounded-xl p-3 mb-3 border border-emerald-200">
                        <div className="text-[10px] font-bold text-emerald-600 uppercase mb-0.5">Resolution</div>
                        <p className="text-xs text-emerald-800 whitespace-pre-wrap line-clamp-2">{act.completionNote}</p>
                    </div>
                )}
                {/* Call */}
                {actDisplayPhone ? (
                    <a href={`tel:${actDisplayPhone}`} onClick={(e:any)=>e.stopPropagation()}
                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs mb-4 hover:bg-slate-100 transition-colors">
                        <Phone size={13}/> Call Customer
                    </a>
                ) : (
                    <div className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-400 rounded-xl text-xs mb-4">
                        <Phone size={13}/> No phone number
                    </div>
                )}
                {/* 5-step progress */}
                {!isCompleted ? (
                    <div className="flex items-center justify-between px-1">
                        {actStepLabels.map((step, i) => (
                            <React.Fragment key={step.key}>
                                <div className="flex flex-col items-center">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                                        i < actStepIdx  ? 'bg-emerald-500 border-emerald-500 text-white' :
                                        i === actStepIdx? 'bg-slate-900 border-slate-900 text-white' :
                                        'bg-white border-slate-200 text-slate-400'
                                    }`}>{i < actStepIdx ? '✓' : i+1}</div>
                                    <span className={`text-[9px] mt-0.5 font-medium ${i===actStepIdx?'text-slate-900':'text-slate-400'}`}>{step.label}</span>
                                </div>
                                {i < 3 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${i<actStepIdx?'bg-emerald-500':'bg-slate-200'}`}/>}
                            </React.Fragment>
                        ))}
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-2 py-2 bg-emerald-50 rounded-xl text-emerald-700 font-bold text-xs">
                        ✓ Completed
                    </div>
                )}
            </div>
        </div>
    );
  };

  const TeamView = () => {
      return (
          <div className="p-4 space-y-3 pb-24">
              <h3 className="font-bold text-slate-800 text-lg mb-4">Field Team Status</h3>
              {technicians.filter(t => t.isActive !== false && [Role.TEAM_LEAD, Role.FIELD_ENGINEER].includes(t.systemRole) && t.status !== 'LEAVE').map(tech => {
                  const { activeCount, pendingCount, progressCount } = getTechJobs(tech.id);
                  
                  return (
                      <div 
                        key={tech.id} 
                        onClick={() => setViewTech(tech)}
                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm active:scale-95 transition-transform cursor-pointer"
                      >
                          <div className="flex items-center gap-3 mb-3">
                              <div className="relative">
                                  <img src={tech.avatar} className="w-12 h-12 rounded-full bg-slate-200 object-cover ring-2 ring-amber-400/30" alt="" />
                                  <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${tech.status === 'AVAILABLE' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                              </div>
                              <div className="flex-1">
                                  <h4 className="font-bold text-slate-800">{tech.name}</h4>
                                  <div className="text-xs text-slate-400">{tech.systemRole === Role.TEAM_LEAD ? "Team Lead" : "Field Engineer"}</div>
                              </div>
                              <ChevronRight size={16} className="text-slate-300" />
                          </div>
                          
                          <div className="flex gap-2">
                              <div className="flex-1 bg-blue-50 border border-blue-100 rounded-lg py-1.5 px-2 flex flex-col items-center">
                                  <span className="text-lg font-bold text-blue-700 leading-none">{pendingCount}</span>
                                  <span className="text-[9px] font-bold text-blue-400 uppercase mt-0.5">Pending</span>
                              </div>
                              <div className="flex-1 bg-amber-50 border border-amber-100 rounded-lg py-1.5 px-2 flex flex-col items-center">
                                  <span className="text-lg font-bold text-amber-700 leading-none">{progressCount}</span>
                                  <span className="text-[9px] font-bold text-amber-400 uppercase mt-0.5">In Prog</span>
                              </div>
                              <div className="flex-1 bg-slate-50 border border-slate-100 rounded-lg py-1.5 px-2 flex flex-col items-center">
                                  <span className="text-lg font-bold text-slate-700 leading-none">{activeCount}</span>
                                  <span className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Total</span>
                              </div>
                          </div>
                      </div>
                  );
              })}
              
              {/* Freelancer Field Engineers — shown as their own team cards */}
              {(() => {
                  // Extract unique FE freelancers from ALL active activities (not just today)
                  const feMap = new Map<string, { name: string; phone: string; activities: any[] }>();
                  (activities || []).forEach((a: any) => {
                      if (a.status === 'CANCELLED' || a.status === 'DONE' || a.status === 'RESOLVED') return;
                      const freelancers = a.freelancers || [];
                      if (freelancers.length === 0) return;
                      (freelancers as any[]).forEach(fl => {
                          if (fl.role === 'FIELD_ENGINEER' && fl.name) {
                              const key = fl.name.trim().toLowerCase();
                              if (!feMap.has(key)) feMap.set(key, { name: fl.name, phone: fl.phone || '', activities: [] });
                              feMap.get(key)!.activities.push(a);
                          }
                      });
                  });
                  const feList = Array.from(feMap.values());
                  if (feList.length === 0) return null;
                  return (
                      <>
                          <h3 className="font-bold text-orange-700 text-sm mt-4 mb-2 flex items-center gap-2">
                              <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-[10px] font-bold text-orange-700">FL</span>
                              Freelancers
                          </h3>
                          {feList.map((fe, i) => {
                              const progressCount = fe.activities.filter(a => ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status)).length;
                              const pendingCount = fe.activities.filter(a => ['PLANNED','ASSIGNED'].includes(a.status)).length;
                              // TA freelancers under this FE
                              const taFreelancers = fe.activities.flatMap(a => (a.freelancers || []).filter((fl: any) => fl.role !== 'FIELD_ENGINEER'));
                              return (
                                  <div key={`fl-${i}`} onClick={() => setViewFreelancer(fe)} className="bg-white p-4 rounded-xl border border-orange-200 shadow-sm mb-3 active:scale-[0.98] transition-transform cursor-pointer">
                                      <div className="flex items-center gap-3 mb-3">
                                          <div className="w-12 h-12 rounded-full bg-orange-100 border-2 border-orange-300 flex items-center justify-center">
                                              <span className="text-orange-700 font-bold text-sm">{fe.name.split(' ').map(w => w[0]).join('').slice(0,2)}</span>
                                          </div>
                                          <div className="flex-1">
                                              <h4 className="font-bold text-slate-800">{fe.name}</h4>
                                              <div className="flex items-center gap-1.5 text-xs text-orange-600">
                                                  <span className="font-bold">Freelancer</span>
                                                  {fe.phone && <span>· {fe.phone}</span>}
                                              </div>
                                          </div>
                                          {fe.phone && <a href={`tel:${fe.phone}`} className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><Phone size={16}/></a>}
                                      </div>
                                      {taFreelancers.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mb-2">
                                              {Array.from(new Map(taFreelancers.map((t: any) => [t.name, t])).values()).map((ta: any, j: number) => (
                                                  <span key={j} className="text-[9px] font-medium bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded">{ta.name} (TA)</span>
                                              ))}
                                          </div>
                                      )}
                                      <div className="flex gap-2">
                                          <div className="flex-1 bg-blue-50 border border-blue-100 rounded-lg py-1.5 px-2 flex flex-col items-center">
                                              <span className="text-lg font-bold text-blue-700">{pendingCount}</span>
                                              <span className="text-[9px] font-bold text-blue-400 uppercase">Pending</span>
                                          </div>
                                          <div className="flex-1 bg-amber-50 border border-amber-100 rounded-lg py-1.5 px-2 flex flex-col items-center">
                                              <span className="text-lg font-bold text-amber-700">{progressCount}</span>
                                              <span className="text-[9px] font-bold text-amber-400 uppercase">In Prog</span>
                                          </div>
                                          <div className="flex-1 bg-slate-50 border border-slate-100 rounded-lg py-1.5 px-2 flex flex-col items-center">
                                              <span className="text-lg font-bold text-slate-700">{fe.activities.length}</span>
                                              <span className="text-[9px] font-bold text-slate-500 uppercase">Total</span>
                                          </div>
                                      </div>
                                  </div>
                              );
                          })}
                      </>
                  );
              })()}
          </div>
      );
  };

  // --- Mobile Layout Renderer ---
  const renderMobileContent = () => {
      // 1. Ticket Detail View (Overrides everything)
      if (selectedTicketId && selectedTicket) {
          return (
              <div className="h-full flex flex-col bg-slate-50">
                  {/* Detail Header */}
                  <div className="bg-white p-4 border-b border-slate-200 flex justify-between items-start shrink-0">
                      <div>
                          <button onClick={() => setSelectedTicketId(null)} className="flex items-center gap-1 text-slate-500 text-sm mb-2 font-medium">
                              <ChevronLeft size={16} /> Back
                          </button>
                          <h1 className="text-lg font-bold text-slate-900">{selectedTicket.customerName}</h1>
                          <span className="text-xs font-mono text-slate-400">#{selectedTicket.id}</span>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(selectedTicket.status)}`}>
                          {selectedTicket.status.replace('_', ' ')}
                      </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {/* Quick Info */}
                      <div className="flex gap-2">
                          <div className="flex-1 p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                              <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Category</span>
                              <span className="text-sm font-bold text-slate-800">{selectedTicket.category}</span>
                          </div>
                          <div className="flex-1 p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                              <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Location</span>
                              <span className="text-sm font-bold text-slate-800 truncate block">{selectedTicket.houseNumber || 'N/A'}</span>
                          </div>
                      </div>

                      {/* Stalled Reason */}
                      {isStalled(selectedTicket) && (
                          <div className="bg-red-50 border border-red-200 p-3 rounded-xl flex items-center gap-3">
                              <AlertTriangle size={20} className="text-red-600" />
                              <div>
                                  <div className="text-xs font-bold text-red-700 uppercase">Ticket Stalled</div>
                                  <div className="text-xs text-red-600">No update since {new Date(selectedTicket.updatedAt).toLocaleString()}</div>
                              </div>
                          </div>
                      )}

                      {/* Issue Log */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                          <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Issue Log</h3>
                          <div className="space-y-3">
                              {selectedTicket.messages.slice(-3).map(m => (
                                  <div key={m.id} className={`p-3 rounded-lg text-sm border ${m.sender === 'CLIENT' ? 'bg-slate-50 border-slate-200' : 'bg-blue-50 border-blue-100 ml-4'}`}>
                                      <div className="text-[10px] font-bold text-slate-400 mb-1">{m.sender}</div>
                                      {m.content}
                                  </div>
                              ))}
                          </div>
                      </div>

                      {/* Tech Assignment */}
                      {selectedTicket.assignedTechId !== currentUserId && (
                          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                              <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Current Dispatch</h3>
                              <div 
                                  onClick={(e) => handleQuickDispatch(e, selectedTicket)}
                                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg cursor-pointer active:bg-slate-100"
                              >
                                  <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                                          {selectedTicket.assignedTechId ? (
                                              <img src={technicians.find(t=>t.id===selectedTicket.assignedTechId)?.avatar} className="w-full h-full object-cover"/>
                                          ) : <UserPlus size={18} className="text-slate-400"/>}
                                      </div>
                                      <div>
                                          <div className="font-bold text-slate-800 text-sm">
                                              {selectedTicket.assignedTechId ? technicians.find(t=>t.id===selectedTicket.assignedTechId)?.name : 'Unassigned'}
                                          </div>
                                          <div className="text-[10px] text-slate-500">Tap to change</div>
                                      </div>
                                  </div>
                                  <ChevronLeft className="rotate-180 text-slate-300" size={16} />
                              </div>
                          </div>
                      )}
                  </div>

                  {/* Bottom Actions */}
                  <div className="bg-white border-t border-slate-200 p-4 pb-safe flex gap-3 shrink-0">
                      <a href={`tel:${selectedTicket.phoneNumber}`} className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold flex items-center justify-center gap-2">
                          <Phone size={18} /> Call
                      </a>
                      <button 
                          onClick={(e) => handleQuickDispatch(e, selectedTicket)}
                          className="flex-[2] py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2"
                      >
                          Dispatch
                      </button>
                  </div>
                  
                  {/* Admin FABs */}
                  <div className="fixed bottom-24 right-4 flex flex-col gap-3 pointer-events-none">
                      <button onClick={() => { setModalTicket(selectedTicket); setModalType('carry'); }} className="pointer-events-auto w-10 h-10 bg-orange-500 text-white rounded-full shadow-lg flex items-center justify-center"><History size={20}/></button>
                      <button onClick={() => { setModalTicket(selectedTicket); setModalType('cancel'); }} className="pointer-events-auto w-10 h-10 bg-red-500 text-white rounded-full shadow-lg flex items-center justify-center"><X size={20}/></button>
                  </div>
              </div>
          );
      }

      // 2. Full Screen Modules — must check BEFORE activeTab so modules open from any tab
      // (Tickets, Reports, Clients open from More tab; Planner kept for legacy)
      if (mobileModule !== 'none') {
          return (
              <div className="h-full flex flex-col bg-slate-50">
                  <div className="bg-white border-b border-slate-200 p-4 flex items-center gap-3 shrink-0 shadow-sm">
                      <button onClick={() => setMobileModule('none')} className="p-1 rounded-full hover:bg-slate-100">
                          <ChevronLeft size={24} className="text-slate-600"/>
                      </button>
                      <h2 className="font-bold text-lg text-slate-900 capitalize">
                          {mobileModule === 'sales_requests' ? 'Sales Appointment Requests' : mobileModule}
                      </h2>
                  </div>
                  
                  <div className="flex-1 overflow-hidden relative">
                      {mobileModule === 'planner' && (
                          <div className="h-full w-full bg-slate-50">
                              <PlanningModule 
                                  activities={activities} teams={teams} sites={sites} customers={customers} technicians={technicians}
                                  onAddActivity={onAddActivity!} onUpdateActivity={onUpdateActivity!} onDeleteActivity={onDeleteActivity!} onAddCustomer={onAddCustomer!}
                                  isMobile={true}
                                  currentUserId={currentUserId}
                              />
                          </div>
                      )}
                      {mobileModule === 'tickets' && (() => {
                          const statusOrder: TicketStatus[] = [TicketStatus.IN_PROGRESS, TicketStatus.ON_MY_WAY, TicketStatus.ARRIVED, TicketStatus.CARRY_FORWARD, TicketStatus.ASSIGNED, TicketStatus.OPEN, TicketStatus.NEW, TicketStatus.RESOLVED, TicketStatus.CANCELLED];
                          const statusLabels: Record<string, string> = { IN_PROGRESS: 'In Progress', ON_MY_WAY: 'On My Way', ARRIVED: 'Arrived', CARRY_FORWARD: 'Carry Forward', ASSIGNED: 'Assigned', OPEN: 'Open', NEW: 'New', RESOLVED: 'Resolved', CANCELLED: 'Cancelled' };
                          const statusIcons: Record<string, string> = { IN_PROGRESS: '🔄', ON_MY_WAY: '🚗', ARRIVED: '📍', CARRY_FORWARD: '⟲', ASSIGNED: '👤', OPEN: '📂', NEW: '✨', RESOLVED: '✅', CANCELLED: '❌' };
                          const grouped: Record<string, Ticket[]> = {};
                          visibleTickets.forEach(t => {
                              const key = t.status;
                              if (!grouped[key]) grouped[key] = [];
                              grouped[key].push(t);
                          });
                          const orderedGroups = statusOrder.filter(s => grouped[s]?.length > 0);
                          return (
                              <div className="h-full overflow-y-auto bg-slate-50">
                                  <div className="p-4">
                                      <div className="relative mb-4">
                                          <Search size={16} className="absolute left-3 top-3 text-slate-400"/>
                                          <input 
                                              value={searchTerm}
                                              onChange={(e) => setSearchTerm(e.target.value)}
                                              placeholder="Search by name, phone, or job ID..."
                                              className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-amber-400 shadow-sm"
                                          />
                                      </div>
                                      {/* Summary bar */}
                                      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 no-scrollbar">
                                          {orderedGroups.map(status => (
                                              <div key={status} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm">
                                                  <span className="text-xs">{statusIcons[status]}</span>
                                                  <span className="text-[10px] font-bold text-slate-600">{statusLabels[status]}</span>
                                                  <span className="text-[10px] font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded-full">{grouped[status].length}</span>
                                              </div>
                                          ))}
                                      </div>
                                      {visibleTickets.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No tickets found</p>}
                                      {orderedGroups.map(status => (
                                          <div key={status} className="mb-5">
                                              <div className="flex items-center gap-2 mb-2 px-1">
                                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(status)}`}>
                                                      {statusIcons[status]} {statusLabels[status]}
                                                  </span>
                                                  <div className="h-px flex-1 bg-slate-200" />
                                                  <span className="text-[10px] font-bold text-slate-400">{grouped[status].length}</span>
                                              </div>
                                              {grouped[status].map(t => <TicketCard key={t.id} ticket={t} />)}
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          );
                      })()}
                      {mobileModule === 'reports' && (
                          <div className="h-full overflow-y-auto bg-white">
                              <ReportsModule tickets={tickets} activities={activities} technicians={technicians} sites={sites} />
                          </div>
                      )}
                      {mobileModule === 'clients' && (
                          <div className="h-full overflow-y-auto bg-white">
                              <CustomerRecords 
                                  customers={customers} activities={activities} tickets={tickets} technicians={technicians} sites={sites}
                                  onSaveCustomer={onSaveCustomer!} onDeleteCustomer={onDeleteCustomer!} readOnly={true}
                                  isMobile={true}
                                  onCreateTicket={onCreateTicket ? (data) => {
                                      // Pre-fill the create ticket form with customer data
                                      setCreateTicketForm(prev => ({
                                          ...prev,
                                          customerName: data.customerName || '',
                                          phone: data.phoneNumber || '',
                                          locationUrl: data.locationUrl || '',
                                          houseNumber: data.houseNumber || ''
                                      }));
                                      setTicketPhoneSearch(data.phoneNumber || '');
                                      setTicketSelectedCustomer(customers?.find((c: any) => c.id === data.customerId) || null);
                                      setShowCreateTicket(true);
                                  } : undefined}
                                  onCreateActivity={onAddActivity ? (data) => {
                                      // Pre-fill the create activity modal with this customer
                                      const cust = customers?.find((c: any) => c.id === data.customerId);
                                      if (cust) {
                                          setActSelectedCustomer(cust);
                                          setActCustSearch(cust.name);
                                      }
                                      // Pre-fill from customer data + find existing odoo link
                                      const existingAct = (activities || []).find((a: any) => 
                                          a.customerId === data.customerId && a.odooLink
                                      );
                                      setCreateActivityForm(prev => ({
                                          ...prev,
                                          customerId: data.customerId || '',
                                          locationUrl: data.locationUrl || cust?.address || '',
                                          houseNumber: data.houseNumber || (cust as any)?.buildingNumber || '',
                                          odooLink: existingAct?.odooLink || ''
                                      }));
                                      // Close the clients module first, then show the activity modal
                                      setMobileModule('none');
                                      // Reset form before opening
                                      setCreateActivityForm({ type: '', serviceCategory: '', customerId: '', description: '', plannedDate: '', priority: 'MEDIUM', locationUrl: '', houseNumber: '' });
                                      setActServiceCats([]);
                                      setTimeout(() => setShowCreateActivity(true), 100);
                                  } : undefined}
                              />
                          </div>
                      )}
                      {mobileModule === 'sales_requests' && (
                          <div className="h-full overflow-y-auto bg-slate-50">
                              <Suspense fallback={
                                <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2">
                                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                                  Loading…
                                </div>
                              }>
                                <SalesAppointmentRequests
                                  currentUser={{
                                    id:    currentUserId || '',
                                    techId: currentUserId,
                                    name:  currentTech?.name || 'Team Lead',
                                    email: currentTech?.email || '',
                                    role:  (currentTech?.systemRole as Role) || Role.TEAM_LEAD,
                                  }}
                                  technicians={technicians}
                                />
                              </Suspense>
                          </div>
                      )}
                  </div>
              </div>
          );
      }
      if (activeTab === 'more') {
          return (
              <div className="h-full overflow-y-auto pb-24">
                  <div className="p-4 space-y-6">
                      {/* Profile Card */}
                      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                          <div className="flex items-center gap-4">
                              <div className="relative">
                                  <img src={currentTech?.avatar || `https://ui-avatars.com/api/?name=TL&background=f59e0b&color=fff`} className="w-16 h-16 rounded-full object-cover ring-2 ring-amber-400" alt="" />
                                  <div className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white" />
                              </div>
                              <div>
                                  <h3 className="text-slate-900 font-bold text-lg">{currentTech?.name || 'Team Lead'}</h3>
                                  <p className="text-slate-500 text-sm">Team Lead</p>
                              </div>
                          </div>
                      </div>

                      {/* Operations Section */}
                      <div>
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">Operations</h4>
                          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                              <button onClick={() => { setMobileModule('tickets'); }} className="w-full flex items-center gap-3 p-4 active:bg-slate-50 transition-colors">
                                  <div className="p-2 bg-amber-50 rounded-lg"><ListTodo size={20} className="text-amber-600" /></div>
                                  <div className="flex-1 text-left">
                                      <span className="text-slate-900 font-medium block">Tickets</span>
                                      <span className="text-[10px] text-slate-500">View all tickets</span>
                                  </div>
                                  <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{tickets.length}</span>
                                  <ChevronRight size={16} className="text-slate-500" />
                              </button>
                              <button onClick={() => { setMobileModule('reports'); }} className="w-full flex items-center gap-3 p-4 active:bg-slate-50 transition-colors">
                                  <div className="p-2 bg-blue-50 rounded-lg"><BarChart3 size={20} className="text-blue-400" /></div>
                                  <div className="flex-1 text-left">
                                      <span className="text-slate-900 font-medium block">Reports</span>
                                      <span className="text-[10px] text-slate-500">Export data</span>
                                  </div>
                                  <ChevronRight size={16} className="text-slate-500" />
                              </button>
                              <button
                                onClick={() => setMobileModule('sales_requests')}
                                className="w-full flex items-center gap-3 p-4 active:bg-amber-50 transition-colors"
                              >
                                  <div className="relative p-2 bg-amber-50 rounded-lg">
                                    <ClipboardList size={20} className="text-amber-500" />
                                    {pendingSARCount > 0 && (
                                      <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center bg-red-500 text-white text-[8px] font-bold rounded-full px-0.5 border border-white">
                                        {pendingSARCount}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex-1 text-left">
                                      <span className="text-slate-900 font-medium block">Sales Appointment Requests</span>
                                      <span className="text-[10px] text-slate-500">
                                        {pendingSARCount > 0 ? `${pendingSARCount} pending scheduling` : 'View all requests'}
                                      </span>
                                  </div>
                                  <ChevronRight size={16} className="text-slate-500" />
                              </button>
                              <button onClick={() => { setMobileModule('clients'); }} className="w-full flex items-center gap-3 p-4 active:bg-slate-50 transition-colors">
                                  <div className="p-2 bg-purple-50 rounded-lg"><Contact size={20} className="text-purple-400" /></div>
                                  <div className="flex-1 text-left">
                                      <span className="text-slate-900 font-medium block">Clients</span>
                                      <span className="text-[10px] text-slate-500">Customer records</span>
                                  </div>
                                  <ChevronRight size={16} className="text-slate-500" />
                              </button>
                              <button onClick={() => setActiveTab('team')} className="w-full flex items-center gap-3 p-4 active:bg-slate-50 transition-colors">
                                  <div className="p-2 bg-emerald-50 rounded-lg"><Users size={20} className="text-emerald-400" /></div>
                                  <div className="flex-1 text-left">
                                      <span className="text-slate-900 font-medium block">Team Management</span>
                                      <span className="text-[10px] text-slate-500">View field team status</span>
                                  </div>
                                  <ChevronRight size={16} className="text-slate-500" />
                              </button>
                          </div>
                      </div>

                      {/* Notifications Section */}
                      <div>
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">Notifications</h4>
                          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                              <button onClick={() => setShowNotifications(true)} className="w-full flex items-center gap-3 p-4 active:bg-slate-50 transition-colors">
                                  <div className="p-2 bg-amber-50 rounded-lg relative">
                                      <BellRing size={20} className="text-amber-400" />
                                      {unreadNotifCount > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />}
                                  </div>
                                  <div className="flex-1 text-left">
                                      <span className="text-slate-900 font-medium block">Activity Log</span>
                                      <span className="text-[10px] text-slate-500">Recent changes on tickets & activities</span>
                                  </div>
                                  {unreadNotifCount > 0 && <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{unreadNotifCount}</span>}
                                  <ChevronRight size={16} className="text-slate-500" />
                              </button>
                          </div>
                      </div>

                      {/* Account Section */}
                      <div>
                          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">Account</h4>
                          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                              <button onClick={() => { setShowChangePwd(true); setCpForm({current:'',next:'',confirm:''}); setCpError(''); setCpSuccess(false); }} className="w-full flex items-center gap-3 p-4 active:bg-slate-50 transition-colors">
                                  <div className="p-2 bg-slate-100 rounded-lg"><Lock size={20} className="text-slate-400" /></div>
                                  <span className="flex-1 text-left text-slate-900 font-medium">Password & Security</span>
                                  <ChevronRight size={16} className="text-slate-500" />
                              </button>
                              {onLogout && (
                                  <button onClick={onLogout} className="w-full flex items-center gap-3 p-4 active:bg-red-500/10 transition-colors">
                                      <div className="p-2 bg-red-50 rounded-lg"><LogOut size={20} className="text-red-400" /></div>
                                      <span className="flex-1 text-left text-red-500 font-medium">Logout</span>
                                  </button>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          );
      }

      // 4. Default Dashboard Tabs
      // Planner needs full height (has its own scroll), others need scroll wrapper
      if (activeTab === 'planner') {
          return (
              <div className="h-full w-full bg-slate-50 pb-20">
                  <PlanningModule 
                      activities={activities} teams={teams} sites={sites} customers={customers} technicians={technicians}
                      onAddActivity={onAddActivity!} onUpdateActivity={onUpdateActivity!} onDeleteActivity={onDeleteActivity!} onAddCustomer={onAddCustomer!}
                      isMobile={true}
                      currentUserId={currentUserId}
                  />
              </div>
          );
      }

      return (
          <div className="h-full overflow-y-auto custom-scrollbar pb-24">
              {activeTab === 'home' && (
                  <div className="p-4 space-y-5">
                      {/* Dashboard Status Cards */}
                      <div className="grid grid-cols-4 gap-2">
                          <button onClick={() => setHomeFilter(homeFilter === 'progress' ? 'all' : 'progress')} className={`p-3 rounded-xl border transition-all active:scale-[0.97] flex flex-col items-center ${homeFilter === 'progress' ? 'bg-amber-50 border-amber-400 shadow-md' : 'bg-white border-slate-200 shadow-sm'}`}>
                              <div className="text-xl font-bold text-amber-600">{inProgressCount}</div>
                              <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5 leading-tight text-center">In Progress</div>
                          </button>
                          <button onClick={() => setHomeFilter(homeFilter === 'carry' ? 'all' : 'carry')} className={`p-3 rounded-xl border transition-all active:scale-[0.97] flex flex-col items-center ${homeFilter === 'carry' ? 'bg-orange-50 border-orange-400 shadow-md' : 'bg-white border-slate-200 shadow-sm'}`}>
                              <div className="text-xl font-bold text-orange-600">{carryForwardCount}</div>
                              <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5 leading-tight text-center">Carry Fwd</div>
                          </button>
                          <button onClick={() => setHomeFilter(homeFilter === 'pending' ? 'all' : 'pending')} className={`p-3 rounded-xl border transition-all active:scale-[0.97] flex flex-col items-center ${homeFilter === 'pending' ? 'bg-blue-50 border-blue-400 shadow-md' : 'bg-white border-slate-200 shadow-sm'}`}>
                              <div className="text-xl font-bold text-blue-600">{pendingCount}</div>
                              <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5 leading-tight text-center">Pending</div>
                          </button>
                          <button onClick={() => setHomeFilter(homeFilter === 'all_history' ? 'all' : 'all_history')} className={`p-3 rounded-xl border transition-all active:scale-[0.97] flex flex-col items-center ${homeFilter === 'all_history' ? 'bg-slate-100 border-slate-400 shadow-md' : 'bg-white border-slate-200 shadow-sm'}`}>
                              <div className="text-xl font-bold text-slate-700">{totalJobsCount}</div>
                              <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5 leading-tight text-center">All Jobs</div>
                          </button>
                      </div>

                      {/* Quick Actions */}
                      <div>
                          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">Quick Actions</h3>
                          <div className="grid grid-cols-4 gap-2">
                              {onAddActivity && (
                                  <button onClick={() => setActiveTab('planner')} className="flex flex-col items-center gap-1.5 p-3 bg-white rounded-xl border border-slate-200 shadow-sm active:scale-95 transition-transform">
                                      <ActivityIcon size={20} className="text-indigo-400" />
                                      <span className="text-[9px] font-bold text-slate-500 uppercase leading-tight text-center">Activity</span>
                                  </button>
                              )}
                              {onCreateTicket && (
                                  <button onClick={() => setShowCreateTicket(true)} className="flex flex-col items-center gap-1.5 p-3 bg-white rounded-xl border border-slate-200 shadow-sm active:scale-95 transition-transform">
                                      <Plus size={20} className="text-amber-400" />
                                      <span className="text-[9px] font-bold text-slate-500 uppercase">Ticket</span>
                                  </button>
                              )}
                              <button
                                onClick={() => setMobileModule('sales_requests')}
                                className="relative flex flex-col items-center gap-1.5 p-3 bg-amber-50 rounded-xl border border-amber-200 shadow-sm active:scale-95 transition-transform"
                              >
                                <ClipboardList size={20} className="text-amber-500" />
                                <span className="text-[9px] font-bold text-amber-700 uppercase leading-tight text-center">Sales Req.</span>
                                {pendingSARCount > 0 && (
                                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-1 border-2 border-white">
                                    {pendingSARCount}
                                  </span>
                                )}
                              </button>
                              <button onClick={() => { setMobileModule('clients'); }} className="flex flex-col items-center gap-1.5 p-3 bg-white rounded-xl border border-slate-200 shadow-sm active:scale-95 transition-transform">
                                  <Contact size={20} className="text-purple-400" />
                                  <span className="text-[9px] font-bold text-slate-500 uppercase">Clients</span>
                              </button>
                          </div>
                      </div>

                      {/* Search Bar */}
                      <div className="flex gap-2">
                          <div className="relative flex-1">
                              <Search size={16} className="absolute left-3 top-3 text-slate-500"/>
                              <input 
                                  value={searchTerm}
                                  onChange={(e) => setSearchTerm(e.target.value)}
                                  placeholder="Search by name, phone, or job ID..."
                                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 transition-colors shadow-sm"
                              />
                          </div>
                      </div>

                      {/* Live Feed — Date Grouped (Tickets + Activities) */}
                      <div>
                          <div className="flex items-center justify-between mb-3 px-1">
                              <h3 className="text-xs font-bold text-slate-500 uppercase">
                                  {homeFilter === 'all' ? 'Live Feed' : homeFilter === 'progress' ? 'In Progress' : homeFilter === 'carry' ? 'Carry Forwards' : homeFilter === 'pending' ? 'Pending' : homeFilter === 'all_history' ? 'All Jobs' : 'Live Feed'}
                              </h3>
                              <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-[10px] font-bold">{homeFilteredFeed.length}</span>
                          </div>
                          {homeFilteredFeed.length === 0 && (
                              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                  <ListTodo size={40} className="text-slate-300 mb-2" />
                                  <p className="text-sm">No jobs found</p>
                              </div>
                          )}
                          {Object.entries(groupedFeed).map(([dateLabel, itemsInGroup]) => (
                              <div key={dateLabel} className="mb-4">
                                  <div className="flex items-center gap-2 mb-2 px-1">
                                      <div className="h-px flex-1 bg-slate-200" />
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">{dateLabel}</span>
                                      <span className="text-[10px] text-slate-300 font-bold">{itemsInGroup.length}</span>
                                      <div className="h-px flex-1 bg-slate-200" />
                                  </div>
                                  {itemsInGroup.map(item => 
                                      item.kind === 'ticket' 
                                          ? <TicketCard key={`t-${item.data.id}`} ticket={item.data as Ticket} />
                                          : <ActivityFeedCard key={`a-${item.data.id}`} activity={item.data as Activity} />
                                  )}
                              </div>
                          ))}
                      </div>
                  </div>
              )}
              
              {activeTab === 'my_jobs' && (
                  <div>
                      {/* Date Picker — TechPortal style */}
                      <div className="bg-white border-b border-slate-100 px-4 py-3">
                          <div className="flex justify-between gap-2">
                              {myJobsDateRange.map(d => (
                                  <button key={d.key} onClick={() => setMyJobsDate(d.key)}
                                      className={`flex-1 flex flex-col items-center py-2.5 rounded-2xl transition-all ${
                                          myJobsDate === d.key ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-105' :
                                          d.isToday ? 'bg-blue-50 text-blue-700 border-2 border-blue-200' : 'bg-slate-50 text-slate-600'
                                      }`}>
                                      <span className={`text-[9px] font-bold ${myJobsDate === d.key ? 'text-blue-100' : 'text-slate-400'}`}>{d.weekday}</span>
                                      <span className="text-xl font-bold leading-tight">{d.day}</span>
                                      <span className={`text-[8px] font-bold ${myJobsDate === d.key ? 'text-blue-200' : 'text-slate-400'}`}>{d.month}</span>
                                  </button>
                              ))}
                          </div>
                      </div>

                      {/* Summary Cards */}
                      <div className="px-4 pt-3 pb-1">
                          <div className="grid grid-cols-2 gap-3">
                              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
                                  <div className="p-2 bg-blue-50 rounded-lg"><Briefcase size={18} className="text-blue-600" /></div>
                                  <div><div className="text-xl font-bold text-slate-900">{myJobsDateFiltered.length}</div><div className="text-[9px] font-bold text-slate-400 uppercase">{myJobsIsPast ? 'Completed' : 'Total Jobs'}</div></div>
                              </div>
                              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
                                  <div className="p-2 bg-amber-50 rounded-lg"><Clock size={18} className="text-amber-600" /></div>
                                  <div><div className="text-xl font-bold text-amber-600">{myJobsInProgress.length}</div><div className="text-[9px] font-bold text-slate-400 uppercase">In Progress</div></div>
                              </div>
                          </div>
                      </div>

                      {/* In Progress Section (today only) */}
                      {myJobsDate === myJobsTodayKey && myJobsInProgress.length > 0 && (
                          <div className="px-4 pt-3">
                              <div className="flex items-center justify-between px-1 mb-2">
                                  <p className="text-xs font-bold text-amber-600 uppercase flex items-center gap-1"><Clock size={12} /> In Progress</p>
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{myJobsInProgress.length}</span>
                              </div>
                              {myJobsInProgress.map(item => {
                                  if (item.kind === 'ticket') return <JobCard key={item.data.id} ticket={item.data} />;
                                  return <ActivityJobCard key={item.data.id} activity={item.data} />;
                              })}
                          </div>
                      )}

                      {/* Jobs for selected date */}
                      <div className="p-4 space-y-3">
                          <div className="flex items-center justify-between px-1">
                              <p className="text-xs font-bold text-slate-500 uppercase">
                                  {myJobsIsPast ? 'Completed on this day' : myJobsDate === myJobsTodayKey ? "Today's Schedule" : 'Planned'}
                              </p>
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                  {(() => {
                                      const ipIds = new Set(myJobsInProgress.map(j => j.data.id));
                                      const showing = myJobsDate === myJobsTodayKey ? myJobsDateFiltered.filter(j => !ipIds.has(j.data.id)) : myJobsDateFiltered;
                                      return showing.length;
                                  })()}
                              </span>
                          </div>
                          {(() => {
                              const ipIds = new Set(myJobsInProgress.map(j => j.data.id));
                              const jobs = myJobsDate === myJobsTodayKey ? myJobsDateFiltered.filter(j => !ipIds.has(j.data.id)) : myJobsDateFiltered;
                              return jobs.length === 0 ? (
                                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                      <Briefcase size={40} className="mb-2 text-slate-300" />
                                      <p className="font-medium text-sm">{myJobsIsPast ? 'No jobs on this date' : myJobsDate === myJobsTodayKey && myJobsInProgress.length > 0 ? 'All jobs are in progress' : 'No jobs scheduled'}</p>
                                  </div>
                              ) : jobs.map(item => {
                                  if ((item as any).kind === 'ticket' || item.type === 'ticket') {
                                      return <JobCard key={item.data.id} ticket={item.data as Ticket} />;
                                  }
                                  return <ActivityJobCard key={item.data.id} activity={item.data} />;
                              });
                          })()}
                      </div>
                  </div>
              )}

              {activeTab === 'team' && <TeamView />}
          </div>
      );
  };

  // Portal always renders — fullscreen bypass handles device routing

  return (
    <div className="flex h-[100dvh] bg-slate-100 font-sans overflow-hidden" style={{paddingTop: 'env(safe-area-inset-top)', paddingBottom: 0}}>
        {/* Theme color meta tag for browser chrome matching */}
        <style dangerouslySetInnerHTML={{__html: `
            body, html { background-color: #f1f5f9 !important; }
            meta[name="theme-color"] { content: #f1f5f9; }
        `}} />
        
        {/* MAIN CONTENT AREA */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative min-h-0">
            
            {/* MOBILE HEADER — always visible */}
            {!selectedTicketId && mobileModule === 'none' && (
                <div className="bg-white border-b border-slate-200 px-4 pt-4 pb-3 flex items-center justify-between shrink-0 z-30 shadow-sm">
                    <div>
                        <h2 className="font-bold text-lg leading-none text-slate-900">
                            {activeTab === 'home' ? 'Dashboard' : activeTab === 'my_jobs' ? 'My Jobs' : activeTab === 'team' ? 'Field Team' : activeTab === 'planner' ? 'Planner' : 'More'}
                        </h2>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">
                            Team Lead Portal
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowNotifications(true)}
                            className="relative p-1.5 rounded-full hover:bg-slate-100 transition-colors"
                            title={unreadNotifCount > 0 ? `${unreadNotifCount} notification(s)` : 'Notifications'}
                        >
                            <Bell size={20} className={unreadNotifCount > 0 ? 'text-amber-500' : 'text-slate-400'} />
                            {unreadNotifCount > 0 && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                                    {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                                </span>
                            )}
                            {(stalledCount > 0 || unreadNotifCount > 0) && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border-2 border-white" />}
                        </button>
                        <div className="w-9 h-9 rounded-full bg-amber-50 ring-2 ring-amber-400 flex items-center justify-center overflow-hidden">
                            {currentTech?.avatar ? (
                                <img src={currentTech.avatar} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <span className="font-bold text-xs text-amber-700">TL</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* CONTENT BODY */}
            <div className="flex-1 overflow-hidden relative bg-slate-100 min-h-0">
                {renderMobileContent()}
            </div>

            {/* Mobile Bottom Navigation — Floating Pill */}
            {!selectedTicketId && mobileModule === 'none' && (
                <div className="absolute bottom-0 left-0 right-0 z-30 px-3" style={{paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))"}}>
                    <div 
                        className="bg-white/90 backdrop-blur-2xl rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-slate-200/60 flex justify-between px-2 py-1.5"
                        onTouchStart={(e) => { (e.currentTarget as any)._touchX = e.touches[0].clientX; }}
                        onTouchEnd={(e) => {
                            const startX = (e.currentTarget as any)._touchX;
                            if (!startX) return;
                            const diff = e.changedTouches[0].clientX - startX;
                            const tabs: Array<'home'|'my_jobs'|'team'|'planner'|'more'> = ['home','my_jobs','team','planner','more'];
                            const idx = tabs.indexOf(activeTab);
                            if (diff < -60 && idx < tabs.length - 1) setActiveTab(tabs[idx + 1]);
                            if (diff > 60 && idx > 0) setActiveTab(tabs[idx - 1]);
                        }}
                    >
                        {[
                            { key: 'home' as const, icon: Home, label: 'Home' },
                            { key: 'my_jobs' as const, icon: Briefcase, label: 'My Jobs' },
                            { key: 'team' as const, icon: Users, label: 'Team' },
                            { key: 'planner' as const, icon: Calendar, label: 'Planner' },
                            { key: 'more' as const, icon: Grid, label: 'More' },
                        ].map(tab => {
                            const isActive = activeTab === tab.key;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => setActiveTab(tab.key)}
                                    className={`flex flex-col items-center justify-center py-1.5 flex-1 rounded-xl transition-all duration-200 relative ${isActive ? 'bg-slate-900 text-white scale-105' : 'text-slate-400 active:scale-95'}`}
                                >
                                    <div className="relative">
                                        <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                                        {tab.key === 'my_jobs' && myJobs.length > 0 && (
                                            <span className={`absolute -top-1.5 -right-2.5 min-w-[16px] h-4 ${isActive ? 'bg-amber-400 text-slate-900' : 'bg-amber-500 text-white'} text-[9px] font-bold rounded-full flex items-center justify-center px-1`}>{myJobs.length}</span>
                                        )}
                                    </div>
                                    <span className={`text-[8px] font-bold mt-0.5 uppercase tracking-wide ${isActive ? 'text-white' : 'text-slate-400'}`}>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* --- Ticket Detail Bottom Sheet --- */}
            {viewTicket && (
                <div 
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-end"
                    onClick={() => setViewTicket(null)}
                >
                    <div 
                        className="bg-white w-full max-w-lg rounded-t-[2rem] shadow-2xl h-[80vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drag Handle */}
                        <div className="h-6 w-full flex justify-center items-center shrink-0">
                            <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">
                            {/* Header */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wide ${getStatusColor(viewTicket.status)}`}>
                                        {viewTicket.status.replace('_', ' ')}
                                    </span>
                                    <span className="text-xs font-mono text-slate-400">#{viewTicket.id}</span>
                                </div>
                                <h2 className="text-xl font-bold text-slate-900 leading-tight">
                                    {viewTicket.category}
                                </h2>
                                <p className="text-xs text-slate-500 mt-1">
                                    Created {new Date(viewTicket.createdAt).toLocaleDateString()} at {new Date(viewTicket.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                </p>
                            </div>

                            {/* Main Info */}
                            <div className="space-y-4">
                                {/* Customer */}
                                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="p-2 bg-white rounded-lg shadow-sm text-slate-400"><Contact size={20}/></div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-400 uppercase mb-0.5">Client</div>
                                        <div className="font-bold text-slate-800">{viewTicket.customerName}</div>
                                        <div className="text-xs text-slate-500 mt-0.5">{viewTicket.phoneNumber}</div>
                                    </div>
                                </div>

                                {/* Location */}
                                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="p-2 bg-white rounded-lg shadow-sm text-slate-400"><MapPin size={20}/></div>
                                    <div className="flex-1">
                                        <div className="text-xs font-bold text-slate-400 uppercase mb-0.5">Location</div>
                                        <div className="font-bold text-slate-800 text-sm">{viewTicket.houseNumber || 'Location not set'}</div>
                                        {viewTicket.locationUrl && (
                                            <a href={viewTicket.locationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 mt-2 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                                                <ExternalLink size={10} /> Open in Maps
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {/* Description */}
                                <div>
                                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Remarks / Description</h4>
                                    <p className="text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-100 leading-relaxed">
                                        {viewTicket.messages?.find((m: any) => m.sender === 'CLIENT')?.content
                                            || (viewTicket as any).notes
                                            || (viewTicket as any).ai_summary
                                            || `${viewTicket.category} — No description provided`}
                                    </p>
                                </div>

                                {/* Your Work Actions — only for active jobs assigned to current user */}
                                {viewTicket.assignedTechId === currentUserId && 
                                 viewTicket.status !== TicketStatus.RESOLVED && 
                                 viewTicket.status !== TicketStatus.CANCELLED && (
                                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                            <Briefcase size={14}/> Your Work Actions
                                        </h4>
                                        
                                        {/* Step progress indicator */}
                                        <div className="flex items-center justify-between mb-4 px-1">
                                            {[
                                                { key: TicketStatus.ASSIGNED, label: 'Assigned' },
                                                { key: TicketStatus.ON_MY_WAY, label: 'On Way' },
                                                { key: TicketStatus.ARRIVED, label: 'Arrived' },
                                                { key: TicketStatus.IN_PROGRESS, label: 'Working' },
                                            ].map((step, i) => {
                                                const stepsOrder = [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.ASSIGNED, TicketStatus.ON_MY_WAY, TicketStatus.ARRIVED, TicketStatus.IN_PROGRESS];
                                                const currentIdx = stepsOrder.indexOf(viewTicket.status);
                                                const stepIdx = stepsOrder.indexOf(step.key);
                                                const isDone = currentIdx > stepIdx;
                                                const isCurrent = currentIdx === stepIdx || (i === 0 && currentIdx <= 2);
                                                return (
                                                    <React.Fragment key={step.key}>
                                                        <div className="flex flex-col items-center">
                                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                                                                isDone ? 'bg-emerald-500 border-emerald-500 text-white' :
                                                                isCurrent ? 'bg-slate-900 border-slate-900 text-white' :
                                                                'bg-white border-slate-200 text-slate-400'
                                                            }`}>{isDone ? '✓' : i + 1}</div>
                                                            <span className={`text-[8px] mt-0.5 font-medium ${isCurrent ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</span>
                                                        </div>
                                                        {i < 3 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${isDone ? 'bg-emerald-500' : 'bg-slate-200'}`}/>}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>

                                        <div className="space-y-2">
                                            {/* OPEN / ASSIGNED / NEW → On My Way */}
                                            {[TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.ASSIGNED].includes(viewTicket.status) && (
                                                <button 
                                                    onClick={() => handleTicketOnMyWay(viewTicket)}
                                                    className="w-full bg-cyan-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] shadow-sm"
                                                >
                                                    <Navigation size={16}/> On My Way
                                                </button>
                                            )}

                                            {/* ON_MY_WAY → Arrived */}
                                            {viewTicket.status === TicketStatus.ON_MY_WAY && (
                                                <button 
                                                    onClick={() => handleTicketArrived(viewTicket)}
                                                    className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] shadow-sm"
                                                >
                                                    <MapPin size={16}/> I've Arrived
                                                </button>
                                            )}

                                            {/* ARRIVED → Start Work */}
                                            {viewTicket.status === TicketStatus.ARRIVED && (
                                                <button 
                                                    onClick={() => handleTicketStartWork(viewTicket)}
                                                    className="w-full bg-amber-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] shadow-sm"
                                                >
                                                    <Play size={18}/> Start Work
                                                </button>
                                            )}

                                            {/* IN_PROGRESS → Carry Forward / Complete */}
                                            {viewTicket.status === TicketStatus.IN_PROGRESS && (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button 
                                                        onClick={() => handleOpenJobAction('job_carry', viewTicket)}
                                                        className="bg-white border border-slate-300 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-1 text-xs active:scale-[0.98]"
                                                    >
                                                        <History size={14}/> Carry Forward
                                                    </button>
                                                    <button 
                                                        onClick={() => handleOpenJobAction('job_complete', viewTicket)}
                                                        className="bg-emerald-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-1 text-xs active:scale-[0.98] shadow-sm"
                                                    >
                                                        <CheckSquare size={14}/> Complete
                                                    </button>
                                                </div>
                                            )}

                                            {/* CARRY_FORWARD → Reschedule (On My Way again) */}
                                            {viewTicket.status === TicketStatus.CARRY_FORWARD && (
                                                <button 
                                                    onClick={() => handleTicketOnMyWay(viewTicket)}
                                                    className="w-full bg-orange-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] shadow-sm"
                                                >
                                                    <Navigation size={16}/> Resume — On My Way
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Assigned Tech (View Only if not My Jobs or Supervisory) */}
                                {activeTab !== 'my_jobs' && (
                                    <div
                                        onClick={() => {
                                            setModalTicket(viewTicket);
                                            setModalType('dispatch');
                                            setSelectedTechId(viewTicket.assignedTechId || '');
                                            setActionNote(viewTicket.assignmentNote || '');
                                        }}
                                        role="button"
                                        className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer active:scale-[0.99]"
                                        >

                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                                                {viewTicket.assignedTechId ? (
                                                    <img src={technicians.find(t=>t.id===viewTicket.assignedTechId)?.avatar} className="w-full h-full object-cover"/>
                                                ) : <UserPlus size={18} className="text-slate-400"/>}
                                            </div>
                                            <div>
                                                <div className="text-xs font-bold text-slate-400 uppercase">Field Engineer</div>
                                                <div className="font-bold text-slate-800 text-sm">
                                                    {viewTicket.assignedTechId ? technicians.find(t=>t.id===viewTicket.assignedTechId)?.name : 'Unassigned'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions Footer */}
                        {activeTab !== 'my_jobs' && (
                            <div className="p-4 border-t border-slate-100 flex gap-3 bg-white shrink-0 pb-safe">
                                <button 
                                    onClick={() => setViewTicket(null)}
                                    className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors"
                                >
                                    Close
                                </button>
                                <button 
                                    onClick={handleOpenFullTicket}
                                    className="flex-[2] py-3 bg-amber-500 text-white rounded-xl font-bold shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all"
                                >
                                    Open Ticket
                                </button>
                            </div>
                        )}
                        {activeTab === 'my_jobs' && (
                             <div className="p-4 border-t border-slate-100 flex gap-3 bg-white shrink-0 pb-safe">
                                 <button 
                                    onClick={() => setViewTicket(null)}
                                    className="w-full py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors"
                                >
                                    Close
                                </button>
                             </div>
                        )}
                    </div>
                </div>
            )}
{/* --- Activity Detail Bottom Sheet --- */}
{viewActivity && (() => {
    const act = viewActivity as any;
    const actCust = customers?.find((c: any) => c.id === act.customerId);
    const actCustName  = actCust?.name  || (act as any).customerName  || '';
    const actCustPhone = actCust?.phone || (act as any).customerPhone || '';
    const leadTech = technicians.find(t => t.id === act.leadTechId);
    const salesLead = technicians.find(t => t.id === act.salesLeadId);
    const supportEngineers = (act.assistantTechIds || []).map((id: string) => technicians.find(t => t.id === id)).filter(Boolean);
    const actStatus = act.status || 'PLANNED';
    return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-end" onClick={() => setViewActivity(null)}>
        <div className="bg-white w-full max-w-lg rounded-t-[2rem] shadow-2xl h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="h-6 w-full flex justify-center items-center shrink-0"><div className="w-12 h-1.5 bg-slate-200 rounded-full" /></div>
            <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4">
                {/* Header */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wide ${
                            actStatus === 'IN_PROGRESS'    ? 'bg-amber-100 text-amber-700' :
                            actStatus === 'ON_MY_WAY'      ? 'bg-blue-100 text-blue-700' :
                            actStatus === 'ARRIVED'        ? 'bg-purple-100 text-purple-700' :
                            actStatus === 'DONE'           ? 'bg-emerald-100 text-emerald-700' :
                            actStatus === 'CARRY_FORWARD'  ? 'bg-orange-100 text-orange-700' :
                            actStatus === 'CANCELLED'      ? 'bg-red-100 text-red-700' :
                            'bg-indigo-50 text-indigo-700 border border-indigo-100'
                        }`}>{actStatus.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-mono text-slate-400">#{act.reference || act.id}</span>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900">{act.type || 'Activity'}</h2>
                    {act.serviceCategory && <p className="text-sm text-slate-500 mt-0.5">{act.serviceCategory}</p>}
                </div>

                {/* Customer Card */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Customer</div>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-bold text-slate-800">{actCustName || 'Unknown'}</div>
                            {actCustPhone && <div className="text-xs text-slate-500 mt-0.5">{actCustPhone}</div>}
                        </div>
                        {actCustPhone && (
                            <a href={`tel:${actCustPhone}`} className="p-2 bg-emerald-50 rounded-lg text-emerald-600 active:bg-emerald-100">
                                <Phone size={18} />
                            </a>
                        )}
                    </div>
                </div>

                {/* Location */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Location</div>
                    <div className="flex items-center justify-between">
                        <div>
                            {act.houseNumber && <div className="font-bold text-slate-800 text-sm">{act.houseNumber}</div>}
                            {!act.houseNumber && !act.locationUrl && <div className="text-sm text-slate-400">Not set</div>}
                        </div>
                        {act.locationUrl && (
                            <a href={act.locationUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 active:bg-blue-100">
                                <MapPin size={12} /> Open Maps
                            </a>
                        )}
                    </div>
                </div>

                {/* Job Details */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2.5">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Details</div>
                    <div className="flex justify-between text-sm"><span className="text-slate-400">Type</span><span className="font-semibold text-slate-700">{act.type}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-400">Priority</span><span className={`font-bold ${act.priority === 'URGENT' ? 'text-red-600' : act.priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>{act.priority}</span></div>
                    {act.plannedDate && <div className="flex justify-between text-sm"><span className="text-slate-400">Planned</span><span className="font-semibold text-slate-700">{new Date(act.plannedDate).toLocaleDateString()} {new Date(act.plannedDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>}
                    {act.startedAt && <div className="flex justify-between text-sm"><span className="text-slate-400">Started</span><span className="font-semibold text-emerald-600">{new Date(act.startedAt).toLocaleDateString()} {new Date(act.startedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>}
                    {act.completedAt && <div className="flex justify-between text-sm"><span className="text-slate-400">Completed</span><span className="font-semibold text-emerald-600">{new Date(act.completedAt).toLocaleDateString()} {new Date(act.completedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>}
                </div>

                {/* Team / Resources */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Team</div>
                    <div className="space-y-2">
                        {leadTech && <div className="flex items-center gap-2"><img src={leadTech.avatar} className="w-7 h-7 rounded-full bg-slate-200 object-cover" alt=""/><div><div className="text-sm font-bold text-slate-800">{leadTech.name}</div><div className="text-[10px] text-slate-400">Lead Engineer</div></div></div>}
                        {salesLead && <div className="flex items-center gap-2"><img src={salesLead.avatar} className="w-7 h-7 rounded-full bg-slate-200 object-cover" alt=""/><div><div className="text-sm font-bold text-slate-800">{salesLead.name}</div><div className="text-[10px] text-slate-400">Sales Lead</div></div></div>}
                        {supportEngineers.map((eng: any) => <div key={eng.id} className="flex items-center gap-2"><img src={eng.avatar} className="w-7 h-7 rounded-full bg-slate-200 object-cover" alt=""/><div><div className="text-sm font-bold text-slate-800">{eng.name}</div><div className="text-[10px] text-slate-400">Support Engineer</div></div></div>)}
                        {/* Freelancers */}
                        {((act as any).freelancers || []).map((fl: any, i: number) => (
                            <div key={`fl-${i}`} className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-700">{fl.name?.charAt(0) || 'F'}</div>
                                <div>
                                    <div className="text-sm font-bold text-slate-800">{fl.name}</div>
                                    <div className="text-[10px] text-orange-500">{fl.role === 'FIELD_ENGINEER' ? 'Freelancer (FE)' : 'Freelancer (TA)'}</div>
                                </div>
                                {fl.phone && <a href={`tel:${fl.phone}`} className="ml-auto text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 font-bold">Call</a>}
                            </div>
                        ))}
                        {!leadTech && !salesLead && supportEngineers.length === 0 && ((act as any).freelancers || []).length === 0 && <div className="text-sm text-slate-400">No team assigned</div>}
                    </div>
                </div>

                {/* Description */}
                {act.description && (
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Scope of Work</div>
                        <p className="text-sm text-slate-700 leading-relaxed">{act.description}</p>
                    </div>
                )}

                {/* Carry Forward Note */}
                {act.carryForwardNote && (
                    <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                        <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward Note</div>
                        <p className="text-sm text-amber-800">{act.carryForwardNote}</p>
                    </div>
                )}

                {/* Workflow Actions */}
                {onUpdateActivity && (
                    <div className="space-y-2">
                        {actStatus === 'PLANNED' && (
                            <div className="space-y-2">
                                {/* Move to Today — pull a future activity to today */}
                                {act.plannedDate && new Date(act.plannedDate).toDateString() !== new Date().toDateString() && (
                                    <button onClick={() => {
                                        const orig = new Date(act.plannedDate);
                                        const today = new Date();
                                        // Keep same time, change date to today
                                        today.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
                                        onUpdateActivity({ ...act, plannedDate: today.toISOString(), updatedAt: new Date().toISOString() });
                                        setViewActivity(null);
                                        toast.success('Activity moved to today');
                                    }}
                                        className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]">
                                        <Calendar size={18} /> Move to Today
                                    </button>
                                )}
                                {/* Reschedule — pick any date */}
                                <button onClick={() => {
                                        const d = new Date(act.plannedDate || Date.now());
                                        const pad = (n: number) => String(n).padStart(2,'0');
                                        setRescheduleActivityDate(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                                        setRescheduleActivityTarget(act);
                                        setShowActivityReschedule(true);
                                        setViewActivity(null);
                                    }}
                                    className="w-full bg-slate-100 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] border border-slate-200">
                                    <RotateCcw size={18} /> Change Date / Time
                                </button>
                                <button onClick={() => { setModalActivity(act); setDispatchPrimaryId((act as any).primaryEngineerId || ''); setDispatchSupportIds(act.assistantTechIds || []); setDispatchFreelancers((act as any).freelancers ? JSON.parse(JSON.stringify((act as any).freelancers)) : []); setModalType('activity_dispatch'); setViewActivity(null); }}
                                    className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]">
                                    <Users size={18} /> Dispatch Team
                                </button>
                                {act.leadTechId === currentUserId && (
                                    <button onClick={() => { onUpdateActivity({ ...act, status: 'ON_MY_WAY', updatedAt: new Date().toISOString() }); setViewActivity(null); }}
                                        className="w-full bg-cyan-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]">
                                        <Navigation size={18} /> On My Way
                                    </button>
                                )}
                            </div>
                        )}
                        {actStatus === 'ON_MY_WAY' && (
                            <button onClick={() => { onUpdateActivity({ ...act, status: 'ARRIVED', updatedAt: new Date().toISOString() }); setViewActivity(null); }}
                                className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]">
                                <MapPin size={18}/> I've Arrived
                            </button>
                        )}
                        {actStatus === 'ARRIVED' && (
                            <button onClick={() => { onUpdateActivity({ ...act, status: 'IN_PROGRESS', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); setViewActivity(null); }}
                                className="w-full bg-amber-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]">
                                <Play size={18}/> Start Work
                            </button>
                        )}
                        {actStatus === 'IN_PROGRESS' && (
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => { setModalActivity(act); setModalType('activity_job_carry'); setViewActivity(null); }}
                                    className="bg-white border border-slate-300 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-1 text-xs active:scale-[0.98]">
                                    <History size={14}/> Carry Forward
                                </button>
                                <button onClick={() => { onUpdateActivity({ ...act, status: 'DONE', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); setViewActivity(null); }}
                                    className="bg-emerald-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-1 text-xs active:scale-[0.98]">
                                    <CheckSquare size={14}/> Complete
                                </button>
                            </div>
                        )}
                        {actStatus === 'CARRY_FORWARD' && (
                            <div className="space-y-2">
                                {/* Reschedule — pick new date for this carried-forward activity */}
                                <button onClick={() => {
                                        const d = new Date(act.plannedDate || Date.now());
                                        d.setDate(d.getDate() + 1); // default next day
                                        const pad = (n: number) => String(n).padStart(2,'0');
                                        setRescheduleActivityDate(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                                        setRescheduleActivityTarget(act);
                                        setShowActivityReschedule(true);
                                        setViewActivity(null);
                                    }}
                                    className="w-full bg-orange-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]">
                                    <RotateCcw size={18} /> Reschedule to New Date
                                </button>
                                {/* Also allow dispatch */}
                                <button onClick={() => { setModalActivity(act); setDispatchPrimaryId((act as any).primaryEngineerId || ''); setDispatchSupportIds(act.assistantTechIds || []); setDispatchFreelancers((act as any).freelancers ? JSON.parse(JSON.stringify((act as any).freelancers)) : []); setModalType('activity_dispatch'); setViewActivity(null); }}
                                    className="w-full bg-slate-100 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] border border-slate-200">
                                    <Users size={18} /> Re-dispatch Team
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-white shrink-0 pb-safe">
                <button onClick={() => setViewActivity(null)} className="w-full py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Close</button>
            </div>
        </div>
    </div>
    );
})()}


            {/* --- Technician Details Bottom Sheet --- */}
            {/* Freelancer Detail Bottom Sheet */}
            {viewFreelancer && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-end" onClick={() => setViewFreelancer(null)}>
                    <div className="bg-white w-full max-w-lg rounded-t-[2rem] shadow-2xl h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-5 text-white relative shrink-0">
                            <button onClick={() => setViewFreelancer(null)} className="absolute top-4 right-4 text-white/70 hover:text-white p-2 bg-white/10 rounded-full backdrop-blur-sm"><X size={20}/></button>
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center">
                                    <span className="text-white font-bold text-lg">{viewFreelancer.name.split(' ').map(w => w[0]).join('').slice(0,2)}</span>
                                </div>
                                <div>
                                    <h3 className="font-bold text-xl">{viewFreelancer.name}</h3>
                                    <p className="text-orange-100 text-sm">Freelancer · Field Engineer</p>
                                </div>
                            </div>
                            {viewFreelancer.phone && (
                                <a href={`tel:${viewFreelancer.phone}`} className="mt-3 flex items-center justify-center gap-2 bg-white/20 backdrop-blur-sm rounded-xl py-2 text-sm font-bold">
                                    <Phone size={14}/> {viewFreelancer.phone}
                                </a>
                            )}
                        </div>

                        {/* Job list */}
                        <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
                            {(() => {
                                const jobs = viewFreelancer.activities;
                                const inProgress = jobs.filter(j => ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(j.status));
                                const planned = jobs.filter(j => ['PLANNED','NEW','OPEN','ASSIGNED'].includes(j.status));
                                const carryFwd = jobs.filter(j => j.status === 'CARRY_FORWARD');

                                const sections = [
                                    { label: 'In Progress', items: inProgress, color: 'amber', icon: '🔄' },
                                    { label: 'Planned', items: planned, color: 'blue', icon: '📋' },
                                    { label: 'Carry Forward', items: carryFwd, color: 'orange', icon: '⟲' },
                                ].filter(s => s.items.length > 0);

                                if (sections.length === 0) return <p className="text-center text-slate-400 py-10">No active jobs</p>;

                                return (
                                    <div className="space-y-4">
                                        {/* Summary pills */}
                                        <div className="flex gap-2 flex-wrap">
                                            {inProgress.length > 0 && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-[10px] font-bold text-amber-700">{inProgress.length} In Progress</div>}
                                            {planned.length > 0 && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-[10px] font-bold text-blue-700">{planned.length} Planned</div>}
                                            {carryFwd.length > 0 && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-full text-[10px] font-bold text-orange-700">{carryFwd.length} Carry Fwd</div>}
                                        </div>

                                        {sections.map(section => (
                                            <div key={section.label}>
                                                <div className="flex items-center gap-2 mb-2 px-1">
                                                    <span className="text-sm">{section.icon}</span>
                                                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{section.label}</span>
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-${section.color}-100 text-${section.color}-700`}>{section.items.length}</span>
                                                    <div className="h-px flex-1 bg-slate-200 ml-1"/>
                                                </div>
                                                <div className="space-y-2">
                                                    {section.items.map((a: any) => {
                                                        const custName = (customers || []).find((c: any) => c.id === a.customerId)?.name || '';
                                                        const custPhone = (customers || []).find((c: any) => c.id === a.customerId)?.phone || '';
                                                        return (
                                                            <div key={a.id} onClick={() => setViewActivity(a)} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm active:scale-[0.98] transition-transform cursor-pointer">
                                                                <div className="flex items-center justify-between mb-1.5">
                                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(a.status)}`}>
                                                                        {String(a.status).replace(/_/g, ' ')}
                                                                    </span>
                                                                    <span className="text-[10px] font-mono text-slate-400">{a.reference || a.id}</span>
                                                                </div>
                                                                <div className="font-bold text-slate-800 text-sm">{a.type || 'Activity'}</div>
                                                                {a.serviceCategory && <div className="text-xs text-slate-500">{a.serviceCategory}</div>}
                                                                {custName && (
                                                                    <div className="flex items-center justify-between mt-1.5">
                                                                        <div className="text-xs text-slate-500 flex items-center gap-1">
                                                                            <Users size={11} className="text-slate-400"/> {custName}
                                                                        </div>
                                                                        {custPhone && (
                                                                            <a href={`tel:${custPhone}`} onClick={e => e.stopPropagation()} className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-0.5">
                                                                                <Phone size={10}/> Call
                                                                            </a>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {a.houseNumber && <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1"><MapPin size={10}/> {a.houseNumber}</div>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="p-4 border-t border-slate-100 shrink-0">
                            <button onClick={() => setViewFreelancer(null)} className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl">Close</button>
                        </div>
                    </div>
                </div>
            )}

            {viewTech && (
                <div 
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-end"
                    onClick={() => { setViewTech(null); setViewJob(null); }}
                >
                    <div 
                        className="bg-white w-full max-w-lg rounded-t-[2rem] shadow-2xl h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
                        onClick={e => e.stopPropagation()}
                    >
                       {viewJob ? (
                            <>
                                {/* Header */}
                                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                                    <button
                                        onClick={() => setViewJob(null)}
                                        className="text-sm font-bold text-slate-500 flex items-center gap-1 hover:text-slate-800"
                                    >
                                        <ChevronLeft size={20} /> Back
                                    </button>
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Job Details</span>
                                    <div className="w-6" />
                                </div>

                                {/* Progress bar */}
                                <div className="h-1 bg-slate-100 shrink-0">
                                    <div className={`h-1 transition-all duration-500 ${
                                        viewJob.data.status === 'RESOLVED' || viewJob.data.status === 'DONE' ? 'bg-emerald-500 w-full' :
                                        viewJob.data.status === 'IN_PROGRESS' ? 'bg-amber-400 w-3/4' :
                                        viewJob.data.status === 'ARRIVED' ? 'bg-indigo-400 w-2/4' :
                                        viewJob.data.status === 'ON_MY_WAY' ? 'bg-cyan-400 w-1/4' :
                                        'bg-purple-400 w-1/6'
                                    }`}/>
                                </div>

                                {/* Scrollable body */}
                                <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50">

                                    {/* Status + Reference */}
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${getStatusColor(viewJob.data.status)}`}>
                                            {viewJob.data.status.replace(/_/g, ' ')}
                                        </span>
                                        <span className="text-xs font-mono text-slate-400">
                                            {viewJob.type === 'ticket' ? `#${viewJob.data.id}` : (viewJob.data.reference || viewJob.data.id)}
                                        </span>
                                    </div>

                                    {/* Title + subtitle */}
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-900 leading-tight">
                                            {viewJob.type === 'ticket' ? viewJob.data.category : viewJob.data.type}
                                        </h2>
                                        {viewJob.type === 'ticket' && viewJob.data.customerName && (
                                            <p className="text-sm text-slate-500 mt-0.5">{viewJob.data.customerName}</p>
                                        )}
                                        {viewJob.type === 'activity' && (() => {
                                            const ac = viewJob.data;
                                            const acCustomer = customers?.find((cu: any) => cu.id === ac.customerId);
                                            return acCustomer ? <p className="text-sm text-slate-500 mt-0.5">{acCustomer.name}</p> : null;
                                        })()}
                                    </div>

                                    {/* Customer Contact Card */}
                                    {(() => {
                                        const custName = viewJob.type === 'ticket' ? viewJob.data.customerName : ((customers || []).find((c: any) => c.id === viewJob.data.customerId)?.name || 'Unknown');
                                        const custPhone = viewJob.type === 'ticket' ? viewJob.data.phoneNumber : ((customers || []).find((c: any) => c.id === viewJob.data.customerId)?.phone || '');
                                        const locUrl = viewJob.data.locationUrl;
                                        const bldg = viewJob.data.houseNumber;
                                        return (
                                            <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                                                <div className="p-4">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Customer</div>
                                                    <div className="font-bold text-slate-900">{custName}</div>
                                                    {custPhone && <div className="text-xs text-slate-500 mt-0.5">{custPhone}</div>}
                                                    {bldg && <div className="text-xs text-slate-500 mt-0.5">{bldg}</div>}
                                                </div>
                                                <div className="flex border-t border-slate-100 divide-x divide-slate-100">
                                                    {custPhone && (
                                                        <a href={`tel:${custPhone}`} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-emerald-600 active:bg-emerald-50 text-xs font-bold">
                                                            <Phone size={14} /> Call
                                                        </a>
                                                    )}
                                                    {locUrl && (
                                                        <a href={locUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-blue-600 active:bg-blue-50 text-xs font-bold">
                                                            <MapPin size={14} /> Open Maps
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Freelancers (for activities) */}
                                    {viewJob.type === 'activity' && ((viewJob.data as any).freelancers || []).length > 0 && (
                                        <div className="bg-white rounded-xl p-4 border border-orange-100">
                                            <div className="text-[10px] font-bold text-orange-500 uppercase mb-2">Freelancers</div>
                                            <div className="space-y-2">
                                                {((viewJob.data as any).freelancers || []).map((fl: any, i: number) => (
                                                    <div key={i} className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-700">{fl.name?.charAt(0)}</div>
                                                            <div>
                                                                <div className="text-sm font-medium text-slate-800">{fl.name}</div>
                                                                <div className="text-[10px] text-orange-500">{fl.role === 'FIELD_ENGINEER' ? 'Field Engineer' : 'Technical Associate'}</div>
                                                            </div>
                                                        </div>
                                                        {fl.phone && (
                                                            <a href={`tel:${fl.phone}`} onClick={e => e.stopPropagation()} className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">Call</a>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Description */}
                                    <div className="bg-white rounded-xl p-4 border border-slate-100">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                                            {viewJob.type === 'ticket' ? 'Remarks / Description' : 'Scope of Work'}
                                        </div>
                                        <p className="text-sm text-slate-700 leading-relaxed">
                                            {viewJob.type === 'ticket'
                                                ? (viewJob.data.messages?.find((m: any) => m.sender === 'CLIENT')?.content || viewJob.data.notes || viewJob.data.ai_summary || `${viewJob.data.category} — No description provided`)
                                                : (viewJob.data.description || 'No description provided')}
                                        </p>
                                    </div>

                                    {/* Details grid */}
                                    <div className="bg-white rounded-xl p-4 border border-slate-100 space-y-3">
                                        {/* Priority */}
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-400 font-medium">Priority</span>
                                            <span className={`font-bold ${
                                                viewJob.data.priority === 'URGENT' ? 'text-red-600' :
                                                viewJob.data.priority === 'HIGH'   ? 'text-orange-500' :
                                                'text-slate-700'
                                            }`}>{viewJob.data.priority || '—'}</span>
                                        </div>

                                        {/* Category (ticket) / Service category (activity) */}
                                        {viewJob.type === 'ticket' && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-400 font-medium">Category</span>
                                                <span className="font-semibold text-slate-700">{viewJob.data.category || '—'}</span>
                                            </div>
                                        )}
                                        {viewJob.type === 'activity' && viewJob.data.serviceCategory && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-400 font-medium">Category</span>
                                                <span className="font-semibold text-slate-700">{viewJob.data.serviceCategory}</span>
                                            </div>
                                        )}

                                        {/* Location */}
                                        {(viewJob.data.houseNumber || viewJob.data.locationUrl) && (
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-slate-400 font-medium">Location</span>
                                                <div className="flex items-center gap-2">
                                                    {viewJob.data.houseNumber && <span className="font-semibold text-slate-700">{viewJob.data.houseNumber}</span>}
                                                    {viewJob.data.locationUrl && (
                                                        <a href={viewJob.data.locationUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                                            className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                                            Map →
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Assigned engineer (ticket) */}
                                        {viewJob.type === 'ticket' && (() => {
                                            const eng = technicians?.find((t: any) => t.id === viewJob.data.assignedTechId);
                                            return eng ? (
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-400 font-medium">Engineer</span>
                                                    <span className="font-semibold text-slate-700">{eng.name}</span>
                                                </div>
                                            ) : null;
                                        })()}

                                        {/* Planned date (activity) */}
                                        {viewJob.type === 'activity' && viewJob.data.plannedDate && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-400 font-medium">Planned</span>
                                                <span className="font-semibold text-slate-700">
                                                    {new Date(viewJob.data.plannedDate).toLocaleDateString()} {new Date(viewJob.data.plannedDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Step progress — ticket */}
                                    {viewJob.type === 'ticket' && (() => {
                                        const steps = [
                                            { key: 'ASSIGNED',    label: 'Assigned'   },
                                            { key: 'ON_MY_WAY',   label: 'On the Way' },
                                            { key: 'ARRIVED',     label: 'Arrived'    },
                                            { key: 'IN_PROGRESS', label: 'Working'    },
                                            { key: 'RESOLVED',    label: 'Done'       },
                                        ];
                                        const cur = steps.findIndex(s => s.key === viewJob.data.status);
                                        return (
                                            <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-100">
                                                {steps.map((step, i) => (
                                                    <React.Fragment key={step.key}>
                                                        <div className="flex flex-col items-center">
                                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border-2 ${
                                                                i < cur  ? 'bg-emerald-500 border-emerald-500 text-white' :
                                                                i === cur? 'bg-slate-900 border-slate-900 text-white' :
                                                                'bg-white border-slate-200 text-slate-400'
                                                            }`}>{i < cur ? '✓' : i + 1}</div>
                                                            <span className={`text-[8px] mt-1 font-medium ${i === cur ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</span>
                                                        </div>
                                                        {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${i < cur ? 'bg-emerald-500' : 'bg-slate-200'}`}/>}
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        );
                                    })()}

                                    {/* Step progress — activity — 5-step unified flow */}
                                    {viewJob.type === 'activity' && (() => {
                                        const steps = [
                                            { key: 'PLANNED',     label: 'Assigned'   },
                                            { key: 'ON_MY_WAY',   label: 'On the Way' },
                                            { key: 'ARRIVED',     label: 'Arrived'    },
                                            { key: 'IN_PROGRESS', label: 'Working'    },
                                            { key: 'DONE',        label: 'Done'       },
                                        ];
                                        const cur = steps.findIndex(s => s.key === viewJob.data.status);
                                        return (
                                            <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-100">
                                                {steps.map((step, i) => (
                                                    <React.Fragment key={step.key}>
                                                        <div className="flex flex-col items-center">
                                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border-2 ${
                                                                i < cur  ? 'bg-emerald-500 border-emerald-500 text-white' :
                                                                i === cur? 'bg-slate-900 border-slate-900 text-white' :
                                                                'bg-white border-slate-200 text-slate-400'
                                                            }`}>{i < cur ? '✓' : i + 1}</div>
                                                            <span className={`text-[8px] mt-1 font-medium ${i === cur ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</span>
                                                        </div>
                                                        {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 mb-3 ${i < cur ? 'bg-emerald-500' : 'bg-slate-200'}`}/>}
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        );
                                    })()}

                                    {/* Completion / CF / Photos / Visit History — shown for finished jobs */}
                                    {(viewJob.data.status === 'DONE' || viewJob.data.status === 'RESOLVED' || viewJob.data.status === 'CARRY_FORWARD' || viewJob.data.status === 'CANCELLED') && (() => {
                                        const visits = viewJob.data.visitHistory || viewJob.data.visit_history || [];
                                        const hasVisits = visits.length > 0;
                                        return (
                                        <div className="space-y-3">
                                            {!hasVisits && viewJob.data.completionNote && (
                                                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                                                    <div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Completion Summary</div>
                                                    <p className="text-sm text-emerald-800 whitespace-pre-wrap">{viewJob.data.completionNote}</p>
                                                </div>
                                            )}
                                            {!hasVisits && (viewJob.data.remarks || viewJob.data.notes) && (viewJob.data.remarks || viewJob.data.notes) !== viewJob.data.completionNote && (
                                                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</div>
                                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{viewJob.data.remarks || viewJob.data.notes}</p>
                                                </div>
                                            )}
                                            {!hasVisits && viewJob.data.carryForwardNote && (
                                                <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                                                    <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div>
                                                    <p className="text-sm text-amber-800 whitespace-pre-wrap">{viewJob.data.carryForwardNote}</p>
                                                </div>
                                            )}
                                            {/* Visit History Cards */}
                                            {hasVisits && (
                                                <div className="space-y-2">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Visit History ({visits.length} visit{visits.length > 1 ? 's' : ''})</div>
                                                    <div className="relative border-l-2 border-slate-200 ml-2 space-y-3">
                                                        {visits.map((v: any, vi: number) => {
                                                            const isCF = v.status === 'CARRY_FORWARD';
                                                            const isDone = v.status === 'DONE';
                                                            const cardBg = isDone ? 'bg-emerald-50 border-emerald-200' : isCF ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200';
                                                            const hdrColor = isDone ? 'text-emerald-800' : isCF ? 'text-orange-800' : 'text-blue-800';
                                                            const badgeStyle = isDone ? 'bg-emerald-100 text-emerald-700' : isCF ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700';
                                                            const dotColor = isDone ? 'bg-emerald-500' : isCF ? 'bg-orange-500' : 'bg-blue-500';
                                                            const dur = v.startedAt && v.completedAt ? Math.round((new Date(v.completedAt).getTime() - new Date(v.startedAt).getTime()) / 60000) : null;
                                                            const fT = (iso: string) => iso ? new Date(iso).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'}) : '—';
                                                            const fD = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', year:'numeric'}) : '—';
                                                            return (
                                                                <div key={vi} className="relative pl-5">
                                                                    <div className={`absolute -left-[7px] top-2 w-3 h-3 rounded-full border-2 border-white shadow-sm ${dotColor}`} />
                                                                    <div className={`rounded-xl p-3 border ${cardBg}`}>
                                                                        <div className="flex justify-between items-center mb-1">
                                                                            <span className={`font-bold text-xs ${hdrColor}`}>Visit {vi + 1} — {fD(v.date)}</span>
                                                                            <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${badgeStyle}`}>{(v.status || '').replace(/_/g, ' ')}</span>
                                                                        </div>
                                                                        <div className="text-[10px] text-slate-500">{fT(v.startedAt)} → {v.completedAt ? fT(v.completedAt) : 'ongoing'}{dur !== null ? ` (${dur >= 60 ? Math.floor(dur/60)+'h '+dur%60+'m' : dur+'m'})` : ''}</div>
                                                                        {v.remarks && <div className="bg-white/60 rounded-lg p-2 mt-1.5 border border-white/80"><div className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">Remark</div><p className="text-[11px] text-slate-700 whitespace-pre-wrap">{v.remarks}</p></div>}
                                                                        {v.completionNote && isDone && <div className="bg-emerald-50/50 rounded-lg p-2 mt-1.5 border border-emerald-100"><div className="text-[8px] font-bold text-emerald-600 uppercase mb-0.5">Completion</div><p className="text-[11px] text-emerald-800 whitespace-pre-wrap">{v.completionNote}</p></div>}
                                                                        {v.carryForwardReason && isCF && <div className="bg-orange-50/50 rounded-lg p-2 mt-1.5 border border-orange-200"><div className="text-[8px] font-bold text-orange-600 uppercase mb-0.5">CF reason</div><p className="text-[11px] text-orange-800 whitespace-pre-wrap">{v.carryForwardReason}</p></div>}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {(viewJob.data.photos || []).length > 0 && (
                                                <div>
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Photos ({viewJob.data.photos.length})</div>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {viewJob.data.photos.map((p: any, i: number) => (
                                                            <img key={i} src={p.url || p} alt="" className="w-full h-20 object-cover rounded-lg border border-slate-200 cursor-pointer" onClick={() => showPhotoLightbox(p.url || p)} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {(viewJob.data.startedAt || viewJob.data.completedAt) && (
                                                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Timing</div>
                                                    {viewJob.data.startedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Started</span><span className="text-slate-700">{new Date(viewJob.data.startedAt).toLocaleString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</span></div>}
                                                    {viewJob.data.completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Completed</span><span className="text-slate-700">{new Date(viewJob.data.completedAt).toLocaleString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'})}</span></div>}
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })()}

                                    {/* Work Actions */}
                                    {viewJob.type === 'ticket' && viewJob.data.assignedTechId === currentUserId && (
                                        <div className="space-y-2 pb-4">
                                            {(viewJob.data.status === 'OPEN' || viewJob.data.status === 'ASSIGNED' || viewJob.data.status === 'NEW') && (
                                                <button onClick={() => { handleTicketOnMyWay(viewJob.data); setViewJob(null); }}
                                                    className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm">
                                                    🚗 On My Way
                                                </button>
                                            )}
                                            {viewJob.data.status === 'ON_MY_WAY' && (
                                                <button onClick={() => { onUpdateTicket?.({...viewJob.data, status: TicketStatus.ARRIVED}); setViewJob(null); }}
                                                    className="w-full bg-indigo-600 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm">
                                                    🏠 Arrived at Site
                                                </button>
                                            )}
                                            {viewJob.data.status === 'ARRIVED' && (
                                                <button onClick={() => { handleTicketStartWork(viewJob.data); setViewJob(null); }}
                                                    className="w-full bg-amber-500 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm">
                                                    ▶ Start Work
                                                </button>
                                            )}
                                            {viewJob.data.status === 'IN_PROGRESS' && (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button onClick={() => { handleOpenJobAction('job_carry', viewJob.data); setViewJob(null); }}
                                                        className="py-3.5 bg-white border border-slate-300 text-slate-700 font-bold rounded-2xl text-xs active:scale-[0.98]">
                                                        Carry Forward
                                                    </button>
                                                    <button onClick={() => { handleOpenJobAction('job_done', viewJob.data); setViewJob(null); }}
                                                        className="py-3.5 bg-emerald-500 text-white font-bold rounded-2xl text-xs active:scale-[0.98]">
                                                        Complete ✓
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {/* Activity Work Actions — full 5-step flow */}
                                    {viewJob.type === 'activity' && (
                                        <div className="space-y-2 pb-4">
                                            {(viewJob.data.status === 'PLANNED' || viewJob.data.status === 'CARRY_FORWARD') && (
                                                <button onClick={() => {
                                                    const a = viewJob.data;
                                                    setModalActivity(a);
                                                    setDispatchPrimaryId(a.leadTechId || '');
                                                    setDispatchSupportIds(a.assistantTechIds || []);
                                                    setModalType('activity_dispatch');
                                                    setViewJob(null);
                                                }}
                                                    className={`w-full text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm ${viewJob.data.status === 'CARRY_FORWARD' ? 'bg-orange-500' : 'bg-blue-600'}`}>
                                                    {viewJob.data.status === 'CARRY_FORWARD' ? <><RotateCcw size={18} /> Reschedule</> : <><Users size={18} /> Dispatch Team</>}
                                                </button>
                                            )}
                                            {(viewJob.data.status as any) === 'ON_MY_WAY' && (
                                                <button onClick={() => { onUpdateActivity?.({...viewJob.data, status: 'ARRIVED' as any}); setViewJob(null); }}
                                                    className="w-full bg-indigo-600 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm">
                                                    🏠 Arrived at Site
                                                </button>
                                            )}
                                            {(viewJob.data.status as any) === 'ARRIVED' && (
                                                <button onClick={() => { onUpdateActivity?.({...viewJob.data, status: 'IN_PROGRESS'}); setViewJob(null); }}
                                                    className="w-full bg-amber-500 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm">
                                                    ▶ Start Work
                                                </button>
                                            )}
                                            {viewJob.data.status === 'IN_PROGRESS' && (
                                                <div className="space-y-2 pb-2">
                                                    <button onClick={() => {
                                                        const a = viewJob.data as any;
                                                        setModalActivity(a);
                                                        setDispatchPrimaryId(a.primaryEngineerId || a.leadTechId || '');
                                                        // Pre-select all currently assigned support: TAs + supporting engineers
                                                        const currentSupport = Array.from(new Set([
                                                            ...(a.assistantTechIds || []),
                                                            ...(a.supportingEngineerIds || [])
                                                        ]));
                                                        setDispatchSupportIds(currentSupport);
                                                        setModalType('manage_team');
                                                        setViewJob(null);
                                                    }}
                                                        className="w-full bg-indigo-600 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform text-sm">
                                                        <Users size={16} /> Manage Team
                                                    </button>
                                                    <div className="grid grid-cols-2 gap-2">
                                                    <button onClick={() => { setModalActivity(viewJob.data); setModalType('activity_job_carry'); setActionNote(''); setNextDate(''); setViewJob(null); }}
                                                        className="py-3.5 bg-white border border-slate-300 text-slate-700 font-bold rounded-2xl text-xs active:scale-[0.98]">
                                                        Carry Forward
                                                    </button>
                                                    <button onClick={() => { setModalActivity(viewJob.data); setModalType('activity_job_complete'); setActionNote(''); setViewJob(null); }}
                                                        className="py-3.5 bg-emerald-500 text-white font-bold rounded-2xl text-xs active:scale-[0.98]">
                                                        Complete ✓
                                                    </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="p-4 border-t border-slate-100 flex gap-3 bg-white shrink-0 pb-safe">
                                    <button onClick={() => setViewJob(null)} className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors">Back</button>
                                </div>
                            </>
                       ) : (
                           <>
                                <div className="p-6 bg-slate-900 text-white shrink-0 relative overflow-hidden">
                                    <div className="relative z-10 flex items-center gap-4">
                                        <img src={viewTech.avatar} className="w-16 h-16 rounded-full border-4 border-slate-800 shadow-xl object-cover" />
                                        <div>
                                            <h2 className="text-xl font-bold">{viewTech.name}</h2>
                                            <div className="flex items-center gap-2 text-slate-400 text-sm">
                                                <span>{viewTech.role}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setViewTech(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white p-2 bg-white/10 rounded-full backdrop-blur-sm"><X size={20}/></button>
                                </div>
                                <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
                                    {(() => {
                                    const jobs = getTechJobs(viewTech.id).all;

                                    if (!jobs.length) {
                                        return (
                                        <div className="text-center text-sm text-slate-400 py-10">
                                            No active jobs found
                                        </div>
                                        );
                                    }

                                    // Group by status sections
                                    const inProgress = jobs.filter(j => ['IN_PROGRESS','ON_MY_WAY','ARRIVED','STARTED'].includes(j.data.status));
                                    const planned = jobs.filter(j => ['PLANNED','NEW','OPEN','ASSIGNED'].includes(j.data.status));
                                    const carryFwd = jobs.filter(j => j.data.status === 'CARRY_FORWARD');
                                    const done = jobs.filter(j => ['DONE','RESOLVED'].includes(j.data.status));
                                    const other = jobs.filter(j => !inProgress.includes(j) && !planned.includes(j) && !carryFwd.includes(j) && !done.includes(j));

                                    const sections = [
                                        { label: 'In Progress', items: inProgress, color: 'amber', icon: '🔄', emptyHide: true },
                                        { label: 'Planned', items: planned, color: 'blue', icon: '📋', emptyHide: true },
                                        { label: 'Carry Forward', items: carryFwd, color: 'orange', icon: '⟲', emptyHide: true },
                                        { label: 'Completed', items: done, color: 'emerald', icon: '✅', emptyHide: true },
                                        ...(other.length > 0 ? [{ label: 'Other', items: other, color: 'slate', icon: '📌', emptyHide: false }] : [])
                                    ].filter(s => !s.emptyHide || s.items.length > 0);

                                    const renderJobItem = (j: any, idx: number) => {
                                        const status = j.data.status;
                                        const ref = j.type === 'ticket' ? `#${j.data.id}` : (j.data.reference || j.data.id);
                                        const title = j.type === 'ticket' ? j.data.category : (j.data.type || 'Activity');
                                        const custName = j.type === 'ticket' ? j.data.customerName : ((customers || []).find((c: any) => c.id === j.data.customerId)?.name || '');
                                        const custPhone = j.type === 'ticket' ? j.data.phoneNumber : ((customers || []).find((c: any) => c.id === j.data.customerId)?.phone || '');
                                        const loc = j.data.houseNumber || '';
                                        const priority = j.data.priority;

                                        return (
                                            <div
                                                key={`${j.type}-${ref}-${idx}`}
                                                onClick={() => setViewJob(j)}
                                                className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm active:scale-[0.98] transition-transform cursor-pointer"
                                            >
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(status)}`}>
                                                        {String(status).replace(/_/g, ' ')}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        {priority && (
                                                            <span className={`text-[9px] font-bold ${priority === 'URGENT' ? 'text-red-600' : priority === 'HIGH' ? 'text-orange-500' : 'text-slate-400'}`}>
                                                                {priority}
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] font-mono text-slate-400">{ref}</span>
                                                    </div>
                                                </div>
                                                <div className="font-bold text-slate-800 text-sm">{title}</div>
                                                {custName && (
                                                    <div className="flex items-center justify-between mt-1.5">
                                                        <div className="text-xs text-slate-500 flex items-center gap-1">
                                                            <Users size={11} className="text-slate-400"/> {custName}
                                                        </div>
                                                        {custPhone && (
                                                            <a href={`tel:${custPhone}`} onClick={e => e.stopPropagation()}
                                                                className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-0.5">
                                                                <Phone size={10}/> Call
                                                            </a>
                                                        )}
                                                    </div>
                                                )}
                                                {loc && <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1"><MapPin size={10}/> {loc}</div>}
                                            </div>
                                        );
                                    };

                                    return (
                                        <div className="space-y-5">
                                            {/* Summary pills */}
                                            <div className="flex gap-2 flex-wrap">
                                                {inProgress.length > 0 && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-[10px] font-bold text-amber-700">{inProgress.length} In Progress</div>}
                                                {planned.length > 0 && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-[10px] font-bold text-blue-700">{planned.length} Planned</div>}
                                                {carryFwd.length > 0 && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-full text-[10px] font-bold text-orange-700">{carryFwd.length} Carry Fwd</div>}
                                                {done.length > 0 && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full text-[10px] font-bold text-emerald-700">{done.length} Done</div>}
                                            </div>

                                            {/* Sectioned lists */}
                                            {sections.map(section => (
                                                <div key={section.label}>
                                                    <div className="flex items-center gap-2 mb-2 px-1">
                                                        <span className="text-sm">{section.icon}</span>
                                                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{section.label}</span>
                                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-${section.color}-100 text-${section.color}-700`}>{section.items.length}</span>
                                                        <div className="h-px flex-1 bg-slate-200 ml-1"/>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {section.items.map((j, idx) => renderJobItem(j, idx))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                    })()}

                                </div>
                           </>
                       )}
                    </div>
                </div>
            )}

            {/* --- Modals (Dispatch/Cancel/Carry + Jobs) --- */}
            
            {/* Dispatch Modal */}
            {modalType === 'dispatch' && modalTicket && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={closeModal}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-900">Dispatch Field Engineer</h3>
                            <button onClick={closeModal}><X size={20} className="text-slate-400"/></button>
                        </div>
                        <div className="p-6 space-y-4">
                        
                        {/* New Team Lead Field */}
                        <div className="mb-3">
                          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Team Lead
                          </label>
                          <div className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                            {assignedTeamLead || "Auto-assigned"}
                          </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Field Engineer / Team Lead</label>
                            <select
                            value={selectedTechId}
                            onChange={(e) => setSelectedTechId(e.target.value)}
                            className={INPUT_STYLES}
                            >
                            <option value="" disabled hidden>Select Engineer or Lead</option>
                            
                            <optgroup label="Team Leads">
                                {technicians
                                    .filter(t => t.systemRole === Role.TEAM_LEAD && t.status !== 'LEAVE' && (t.isActive !== false))
                                    .map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                            </optgroup>

                            <optgroup label="Field Engineers">
                                {technicians
                                    .filter(t => t.systemRole === Role.FIELD_ENGINEER && t.status !== 'LEAVE' && (t.isActive !== false))
                                    .map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                            </optgroup>
                            </select>
                        </div>

                        <button
                            onClick={executeDispatch}
                            disabled={!selectedTechId}
                            className="w-full py-3 bg-emerald-600 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg"
                        >
                            Confirm Dispatch
                        </button>
                        </div>

                    </div>
                </div>
            )}

            {/* Cancel Modal */}
            {modalType === 'cancel' && modalTicket && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={closeModal}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-red-50 bg-red-50 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-red-900">Cancel Ticket</h3>
                            <button onClick={closeModal}><X size={20} className="text-red-400 hover:text-red-600"/></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} className={INPUT_STYLES} placeholder="Reason..." rows={3}/>
                            <button onClick={executeCancel} className="w-full py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg">Confirm Cancellation</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Admin Carry Forward Modal (Simplified for brevity, focusing on job_carry) */}
            {modalType === 'carry' && modalTicket && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={closeModal}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-900">Carry Forward</h3>
                            <button onClick={closeModal}><X size={20} className="text-slate-400"/></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <input type="datetime-local" value={nextDate} onChange={e => setNextDate(e.target.value)} className={INPUT_STYLES} />
                            <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} className={INPUT_STYLES} placeholder="Reason..." rows={3} />
                            <button onClick={executeCarryForward} className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl shadow-lg">Schedule Carry Forward</button>
                        </div>
                    </div>
                </div>
            )}

            {/* My Job Complete Modal */}
            {modalType === 'job_complete' && modalTicket && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={closeModal}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-900">Job Completion</h3>
                            <button onClick={closeModal}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} className={INPUT_STYLES} placeholder="Work done details..." rows={4} />
                            <button onClick={executeJobComplete} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg">Submit Completion</button>
                        </div>
                    </div>
                </div>
            )}


{/* Activity Complete Modal */}
{modalType === 'activity_job_complete' && modalActivity && (
    <div 
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={closeModal}
    >
        <div 
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="font-bold text-lg text-slate-900">Job Completion</h3>
                <button onClick={closeModal}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
            </div>
            <div className="p-6 space-y-4">
                <textarea value={actionNote} onChange={e => setActionNote(e.target.value)} className={INPUT_STYLES} placeholder="Work done details..." rows={4} />
                <button 
                    onClick={() => {
                        if (!modalActivity || !onUpdateActivity) return;
                        const a: any = modalActivity as any;
                        onUpdateActivity({
                            ...a,
                            status: 'DONE',
                            completionNote: actionNote,
                            remarks: actionNote ? (a.remarks ? a.remarks + '\n' + actionNote : actionNote) : a.remarks,
                            completedAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        });
                        closeModal();
                        setViewActivity(null);
                    }} 
                    className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg"
                >
                    Submit Completion
                </button>
            </div>
        </div>
    </div>
)}
{/* My Job Carry Forward Modal (The focus of the update) */}
            {modalType === 'job_carry' && modalTicket && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={closeModal}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-lg text-slate-900">End Day / Carry Forward</h3>
                            <button onClick={closeModal}><X size={20} className="text-slate-400"/></button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto flex-1">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Reason for Carry Forward <span className="text-red-500">*</span></label>
                                <textarea 
                                    value={carryIssue} 
                                    onChange={e => setCarryIssue(e.target.value)}
                                    className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl text-[#111827] placeholder-[#9CA3AF] px-4 py-3.5 text-sm leading-[1.4] focus:outline-none focus:ring-0 focus:border-[#F5B301] transition-colors resize-none"
                                    placeholder="Why is this job being carried forward?"
                                    rows={3}
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Remark / Description</label>
                                <textarea 
                                    value={actionNote} 
                                    onChange={e => setActionNote(e.target.value)}
                                    className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl text-[#111827] placeholder-[#9CA3AF] px-4 py-3.5 text-sm leading-[1.4] focus:outline-none focus:ring-0 focus:border-[#F5B301] transition-colors resize-none"
                                    placeholder="Additional notes or remarks..."
                                    rows={3}
                                />
                            </div>
                            
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Next Visit <span className="text-red-500">*</span></label>
                                <input
                                    type="datetime-local"
                                    value={nextDate ? (() => {
                                        const d = new Date(nextDate);
                                        const pad = (n: number) => String(n).padStart(2, '0');
                                        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                    })() : ''}
                                    onChange={e => {
                                        const val = e.target.value;
                                        if (val) {
                                            const d = new Date(val);
                                            if (!isNaN(d.getTime())) setNextDate(d.toISOString());
                                        } else {
                                            setNextDate('');
                                        }
                                    }}
                                    min={new Date().toISOString().slice(0,16)}
                                    className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 text-sm font-medium text-[#111827] outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                                />
                                {(!nextDate && carryIssue.trim()) && (
                                    <p className="text-[10px] text-red-500 mt-2 font-medium flex items-center gap-1">
                                        <AlertTriangle size={10} /> Please select next visit date & time.
                                    </p>
                                )}
                            </div>

                            <button 
                                onClick={executeJobCarry}
                                disabled={!carryIssue.trim() || !nextDate}
                                className="w-full py-3 bg-emerald-600/10 border border-emerald-600/40 text-emerald-600 font-bold rounded-xl disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed active:bg-emerald-600/20"
                            >
                                Schedule Visit
                            </button>
                        </div>
                    </div>
                </div>
            )}

{/* Activity Carry Forward Modal */}
{modalType === 'activity_job_carry' && modalActivity && (
    <div 
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={closeModal}
    >
        <div 
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-lg text-slate-900">End Day / Carry Forward</h3>
                <button onClick={closeModal}><X size={20} className="text-slate-400"/></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Reason for Carry Forward <span className="text-red-500">*</span></label>
                    <textarea 
                        value={carryIssue} 
                        onChange={e => setCarryIssue(e.target.value)}
                        className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl text-[#111827] placeholder-[#9CA3AF] px-4 py-3.5 text-sm leading-[1.4] focus:outline-none focus:ring-0 focus:border-[#F5B301] transition-colors resize-none"
                        placeholder="Why is this job being carried forward?"
                        rows={3}
                        autoFocus
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Remark / Description</label>
                    <textarea 
                        value={actionNote} 
                        onChange={e => setActionNote(e.target.value)}
                        className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl text-[#111827] placeholder-[#9CA3AF] px-4 py-3.5 text-sm leading-[1.4] focus:outline-none focus:ring-0 focus:border-[#F5B301] transition-colors resize-none"
                        placeholder="Additional notes or remarks..."
                        rows={3}
                    />
                </div>

                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Next Visit <span className="text-red-500">*</span></label>
                    <input
                        type="datetime-local"
                        value={nextDate ? (() => {
                            const d = new Date(nextDate);
                            const pad = (n: number) => String(n).padStart(2, '0');
                            return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                        })() : ''}
                        onChange={e => {
                            const val = e.target.value;
                            if (val) {
                                const d = new Date(val);
                                if (!isNaN(d.getTime())) setNextDate(d.toISOString());
                            } else {
                                setNextDate('');
                            }
                        }}
                        min={new Date().toISOString().slice(0,16)}
                        className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 text-sm font-medium text-[#111827] outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                    />
                    {(!nextDate && carryIssue.trim()) && (
                        <p className="text-[10px] text-red-500 mt-2 font-medium flex items-center gap-1">
                            <AlertTriangle size={10} /> Please select next visit date & time.
                        </p>
                    )}
                </div>

                <button 
                    onClick={() => {
                        if (!modalActivity || !onUpdateActivity || !nextDate) return;
                        const a: any = modalActivity as any;
                        const cfNote = carryIssue ? `Reason: ${carryIssue}${actionNote ? '\nRemark: ' + actionNote : ''}` : actionNote;
                        
                        // Carry forward = ONE update to the SAME activity
                        // Sets CARRY_FORWARD status + new planned date + records visit history
                        // Does NOT create a duplicate, does NOT send a second update
                        onUpdateActivity({
                            ...a,
                            status: 'CARRY_FORWARD',
                            // Do NOT send plannedDate — backend keeps the original visit date.
                            // nextPlannedAt carries the future date for display only.
                            carryForwardNote: cfNote,
                            currentVisitRemark: actionNote || '',
                            nextPlannedAt: nextDate,
                            updatedAt: new Date().toISOString()
                        });
                        
                        closeModal();
                        setViewActivity(null);
                    }}
                    disabled={!carryIssue.trim() || !nextDate}
                    className="w-full py-3 bg-emerald-600/10 border border-emerald-600/40 text-emerald-600 font-bold rounded-xl disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed active:bg-emerald-600/20"
                >
                    Schedule Visit
                </button>
            </div>
        </div>
    </div>
)}

{/* Activity Dispatch Team Modal — Team Lead picks primary engineer + supporting crew */}
{modalType === 'activity_dispatch' && modalActivity && (
    <div 
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={closeModal}
    >
        <div 
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
                <div>
                    <h3 className="font-bold text-lg text-slate-900">Dispatch Team</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{(modalActivity as any).reference} • {(modalActivity as any).type}</p>
                </div>
                <button onClick={closeModal}><X size={20} className="text-slate-400"/></button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto flex-1">
                
                {/* Primary Engineer */}
                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Primary Engineer <span className="text-red-500">*</span></label>
                    <select
                        value={dispatchPrimaryId}
                        onChange={(e) => setDispatchPrimaryId(e.target.value)}
                        className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3 text-sm text-[#111827] outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                    >
                        <option value="">— Unassigned —</option>
                        <optgroup label="Team Leads">
                            {technicians
                                .filter(t => t.level === 'TEAM_LEAD' && t.systemRole !== 'ADMIN' && t.status !== 'LEAVE' && t.isActive !== false)
                                .map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                        </optgroup>
                        <optgroup label="Field Engineers">
                            {technicians
                                .filter(t => t.level === 'FIELD_ENGINEER' && t.systemRole !== 'ADMIN' && t.status !== 'LEAVE' && t.isActive !== false)
                                .map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                        </optgroup>
                    </select>
                </div>

                {/* Supporting Team (checkboxes) */}
                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Supporting Team</label>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50">
                        {/* Technical Associates */}
                        {technicians.filter(t => t.level === 'TECHNICAL_ASSOCIATE' && t.status !== 'LEAVE' && t.isActive !== false).length > 0 && (
                            <div className="px-3 pt-2 pb-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Technical Associates</span>
                            </div>
                        )}
                        {technicians
                            .filter(t => t.level === 'TECHNICAL_ASSOCIATE' && t.status !== 'LEAVE' && t.isActive !== false)
                            .map(t => (
                                <label key={t.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                                    dispatchSupportIds.includes(t.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                                }`}>
                                    <input
                                        type="checkbox"
                                        checked={dispatchSupportIds.includes(t.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setDispatchSupportIds(prev => [...prev, t.id]);
                                            } else {
                                                setDispatchSupportIds(prev => prev.filter(id => id !== t.id));
                                            }
                                        }}
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <div className="flex items-center gap-2 flex-1">
                                        <img src={t.avatar} className="w-7 h-7 rounded-full bg-slate-200 object-cover" alt="" />
                                        <div>
                                            <span className="text-sm font-medium text-slate-800">{t.name}</span>
                                            <span className="text-[10px] text-slate-400 ml-1.5">{(t as any).jobRole || 'Technical Associate'}</span>
                                        </div>
                                    </div>
                                </label>
                            ))
                        }

                        {/* Field Engineers (exclude the primary and admins) */}
                        {technicians.filter(t => (t.level === 'FIELD_ENGINEER' || t.level === 'TEAM_LEAD') && t.systemRole !== 'ADMIN' && t.id !== dispatchPrimaryId && t.status !== 'LEAVE' && t.isActive !== false).length > 0 && (
                            <div className="px-3 pt-3 pb-1 border-t border-slate-100">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Field Engineers / Leads</span>
                            </div>
                        )}
                        {technicians
                            .filter(t => (t.level === 'FIELD_ENGINEER' || t.level === 'TEAM_LEAD') && t.systemRole !== 'ADMIN' && t.id !== dispatchPrimaryId && t.status !== 'LEAVE' && t.isActive !== false)
                            .map(t => (
                                <label key={t.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                                    dispatchSupportIds.includes(t.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                                }`}>
                                    <input
                                        type="checkbox"
                                        checked={dispatchSupportIds.includes(t.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setDispatchSupportIds(prev => [...prev, t.id]);
                                            } else {
                                                setDispatchSupportIds(prev => prev.filter(id => id !== t.id));
                                            }
                                        }}
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <div className="flex items-center gap-2 flex-1">
                                        <img src={t.avatar} className="w-7 h-7 rounded-full bg-slate-200 object-cover" alt="" />
                                        <div>
                                            <span className="text-sm font-medium text-slate-800">{t.name}</span>
                                            <span className="text-[10px] text-slate-400 ml-1.5">{t.level === 'TEAM_LEAD' ? 'Team Lead' : 'Field Engineer'}</span>
                                        </div>
                                    </div>
                                </label>
                            ))
                        }
                    </div>
                    {dispatchSupportIds.length > 0 && (
                        <div className="mt-2 flex items-center gap-1">
                            <Users size={12} className="text-blue-500"/>
                            <span className="text-xs text-blue-600 font-medium">{dispatchSupportIds.length} supporting member{dispatchSupportIds.length > 1 ? 's' : ''} selected</span>
                        </div>
                    )}
                </div>

                {/* Freelancers Section — inline add/remove during dispatch */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Freelancers</label>
                        <button
                            type="button"
                            onClick={() => setDispatchFreelancers((prev: any[]) => [...prev, { name: '', role: 'TECHNICAL_ASSOCIATE', phone: '' }])}
                            className="text-[10px] font-bold text-amber-600 hover:text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200"
                        >
                            + Add Freelancer
                        </button>
                    </div>
                    {dispatchFreelancers.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No freelancers added.</p>
                    ) : (
                        <div className="space-y-2">
                            {dispatchFreelancers.map((fl: any, i: number) => (
                                <div key={i} className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 relative">
                                    <button
                                        type="button"
                                        onClick={() => setDispatchFreelancers((prev: any[]) => prev.filter((_: any, idx: number) => idx !== i))}
                                        className="absolute top-2 right-2 text-slate-400 hover:text-red-500 text-sm font-bold"
                                    >✕</button>
                                    <div className="grid grid-cols-2 gap-2 mb-2">
                                        <div>
                                            <div className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Name *</div>
                                            <input
                                                value={fl.name}
                                                onChange={e => setDispatchFreelancers((prev: any[]) => prev.map((f: any, idx: number) => idx === i ? {...f, name: e.target.value} : f))}
                                                placeholder="Freelancer name"
                                                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                                            />
                                        </div>
                                        <div>
                                            <div className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Role</div>
                                            <select
                                                value={fl.role}
                                                onChange={e => setDispatchFreelancers((prev: any[]) => prev.map((f: any, idx: number) => idx === i ? {...f, role: e.target.value} : f))}
                                                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                                            >
                                                <option value="TECHNICAL_ASSOCIATE">Tech Associate</option>
                                                <option value="FIELD_ENGINEER">Field Engineer</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Phone (optional)</div>
                                        <input
                                            value={fl.phone}
                                            onChange={e => setDispatchFreelancers((prev: any[]) => prev.map((f: any, idx: number) => idx === i ? {...f, phone: e.target.value} : f))}
                                            placeholder="+974 XXXX XXXX"
                                            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Entire Team Shortcut */}
                <button
                    type="button"
                    onClick={() => {
                        const allTechAssociates = technicians
                            .filter(t => t.level === 'TECHNICAL_ASSOCIATE' && t.status !== 'LEAVE' && t.isActive !== false)
                            .map(t => t.id);
                        setDispatchSupportIds(allTechAssociates);
                    }}
                    className="w-full py-2 text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
                >
                    Select All Technical Associates
                </button>

                {/* Summary */}
                {dispatchPrimaryId && (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1">
                        <div className="text-[10px] font-bold text-blue-800 uppercase">Dispatch Summary</div>
                        <div className="text-xs text-blue-700">
                            <span className="font-bold">Primary:</span> {technicians.find(t => t.id === dispatchPrimaryId)?.name || '—'}
                        </div>
                        {dispatchSupportIds.length > 0 && (
                            <div className="text-xs text-blue-700">
                                <span className="font-bold">Team:</span> {dispatchSupportIds.map(id => technicians.find(t => t.id === id)?.name?.split(' ')[0]).filter(Boolean).join(', ')}
                            </div>
                        )}
                    </div>
                )}

                {/* Confirm Button */}
                <button
                    onClick={() => {
                        if (!modalActivity || !onUpdateActivity) return;
                        const a = modalActivity as any;
                        onUpdateActivity({
                            ...a,
                            status: dispatchPrimaryId ? 'ON_MY_WAY' : a.status,
                            primaryEngineerId: dispatchPrimaryId || null,
                            supportingEngineerIds: dispatchSupportIds.filter(id => id !== dispatchPrimaryId),
                            leadTechId: dispatchPrimaryId || null,
                            assistantTechIds: dispatchSupportIds,
                            // Include any freelancers added/edited during dispatch
                            freelancers: dispatchFreelancers.filter((f: any) => f.name.trim()),
                            updatedAt: new Date().toISOString()
                        });
                        closeModal();
                        setViewActivity(null);
                        setViewJob(null);
                    }}
                    className="w-full py-3.5 bg-blue-600 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                >
                    <Users size={18} /> Confirm Dispatch
                </button>
            </div>
        </div>
    </div>
)}

{/* Manage Team Modal — Add/remove engineers for IN_PROGRESS jobs */}
{modalType === 'manage_team' && modalActivity && (() => {
    const ma = modalActivity as any;
    // Find who is busy on OTHER jobs right now (IN_PROGRESS, ON_MY_WAY, ARRIVED)
    // Also check PLANNED activities for today — they're assigned even if not started
    const busyStatuses = ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'];
    const todayStr = new Date().toDateString();
    const busyIds = new Set<string>();
    (activities || []).forEach((a: any) => {
        if (a.id === ma.id) return; // Skip current activity
        const isActive = busyStatuses.includes(a.status);
        const isPlannedToday = a.status === 'PLANNED' && new Date(a.plannedDate).toDateString() === todayStr;
        if (!isActive && !isPlannedToday) return;
        if (a.primaryEngineerId) busyIds.add(a.primaryEngineerId);
        if (a.leadTechId) busyIds.add(a.leadTechId);
        (a.assistantTechIds || []).forEach((id: string) => busyIds.add(id));
        (a.supportingEngineerIds || []).forEach((id: string) => busyIds.add(id));
    });
    (tickets || []).forEach((t: any) => {
        if (busyStatuses.includes(t.status) && t.assignedTechId) busyIds.add(t.assignedTechId);
    });

    const allTeam = technicians.filter((t: any) =>
        (t.systemRole === 'FIELD_ENGINEER' || t.systemRole === 'TEAM_LEAD' || t.level === 'TECHNICAL_ASSOCIATE') &&
        t.isActive !== false && t.status !== 'INACTIVE'
    );
    const availableForSupport = allTeam.filter((t: any) => t.id !== dispatchPrimaryId && !busyIds.has(t.id));
    const busyForSupport = allTeam.filter((t: any) => t.id !== dispatchPrimaryId && busyIds.has(t.id));

    return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={closeModal}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
                <div>
                    <h3 className="font-bold text-lg text-slate-900">Manage Team</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{ma.reference} — In Progress</p>
                </div>
                <button onClick={closeModal}><X size={20} className="text-slate-400"/></button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
                <div>
                    <label className="text-xs font-bold text-purple-600 uppercase tracking-wider block mb-2">Lead / Primary Engineer</label>
                    <select value={dispatchPrimaryId} onChange={e => {
                        setDispatchPrimaryId(e.target.value);
                        setDispatchSupportIds(prev => prev.filter(id => id !== e.target.value));
                    }}
                        className="w-full border border-slate-300 rounded-xl p-3 text-sm bg-white">
                        <option value="">Select Engineer</option>
                        {technicians.filter((t: any) => (t.systemRole === 'FIELD_ENGINEER' || t.systemRole === 'TEAM_LEAD') && !busyIds.has(t.id) && t.isActive !== false && t.status !== 'INACTIVE').map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name} ({t.systemRole === 'TEAM_LEAD' ? 'TL' : 'FE'})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-blue-600 uppercase tracking-wider block mb-2">Supporting Engineers</label>
                    <p className="text-[10px] text-slate-400 mb-2">Only available (not on other active jobs)</p>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {(() => {
                            const engAvail = availableForSupport.filter((t: any) => (t.systemRole === 'FIELD_ENGINEER' || t.systemRole === 'TEAM_LEAD') && t.level !== 'TECHNICAL_ASSOCIATE');
                            const engBusy = busyForSupport.filter((t: any) => (t.systemRole === 'FIELD_ENGINEER' || t.systemRole === 'TEAM_LEAD') && t.level !== 'TECHNICAL_ASSOCIATE');
                            return engAvail.length > 0 ? engAvail.map((t: any) => (
                                <label key={t.id} className={`flex items-center gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                                    dispatchSupportIds.includes(t.id) ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-200 hover:border-slate-300'
                                }`}>
                                    <input type="checkbox" checked={dispatchSupportIds.includes(t.id)}
                                        onChange={() => setDispatchSupportIds(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id])}
                                        className="sr-only" />
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                        dispatchSupportIds.includes(t.id) ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'
                                    }`}>{dispatchSupportIds.includes(t.id) ? '✓' : t.name.charAt(0)}</div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-slate-800">{t.name}</div>
                                        <div className="text-[10px] text-slate-400">{t.systemRole === 'TEAM_LEAD' ? 'Team Lead' : 'Field Engineer'}</div>
                                    </div>
                                    <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-bold">Available</span>
                                </label>
                            )) : <div className="text-[10px] text-slate-400 italic p-1">No engineers available</div>;
                        })()}
                    </div>
                </div>
                {/* Current Freelancers */}
                {((modalActivity as any)?.freelancers || []).length > 0 && (
                    <div>
                        <label className="text-xs font-bold text-orange-600 uppercase tracking-wider block mb-2">Freelancers (from Activity Planner)</label>
                        <div className="space-y-1.5 rounded-xl border border-orange-100 bg-orange-50/30 p-2">
                            {((modalActivity as any).freelancers || []).map((fl: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 p-2 bg-white rounded-lg">
                                    <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-700">{fl.name?.charAt(0)}</div>
                                    <div className="flex-1">
                                        <span className="text-sm font-medium text-slate-800">{fl.name}</span>
                                        <span className="text-[10px] text-orange-500 ml-1">{fl.role === 'FIELD_ENGINEER' ? 'FE' : 'TA'}</span>
                                    </div>
                                    {fl.phone && <a href={`tel:${fl.phone}`} className="text-[10px] text-emerald-600 font-bold">Call</a>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div>
                    <label className="text-xs font-bold text-teal-600 uppercase tracking-wider block mb-2">Technical Associates</label>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {(() => {
                            const taAvail = availableForSupport.filter((t: any) => t.level === 'TECHNICAL_ASSOCIATE');
                            return taAvail.length > 0 ? taAvail.map((t: any) => (
                                <label key={t.id} className={`flex items-center gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                                    dispatchSupportIds.includes(t.id) ? 'bg-teal-50 border-teal-400' : 'bg-white border-slate-200 hover:border-slate-300'
                                }`}>
                                    <input type="checkbox" checked={dispatchSupportIds.includes(t.id)}
                                        onChange={() => setDispatchSupportIds(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id])}
                                        className="sr-only" />
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                        dispatchSupportIds.includes(t.id) ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-400'
                                    }`}>{dispatchSupportIds.includes(t.id) ? '✓' : t.name.charAt(0)}</div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-slate-800">{t.name}</div>
                                        <div className="text-[10px] text-slate-400">Technical Associate</div>
                                    </div>
                                    <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-bold">Available</span>
                                </label>
                            )) : <div className="text-[10px] text-slate-400 italic p-1">No TAs available</div>;
                        })()}
                    </div>
                </div>
                {busyForSupport.length > 0 && (
                <div>
                    <div className="text-[10px] text-slate-400 mb-1.5 font-bold uppercase">Currently Busy</div>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                        {busyForSupport.map((t: any) => (
                            <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 opacity-50">
                                <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[10px] text-slate-400">{t.name.charAt(0)}</div>
                                <div className="flex-1">
                                    <div className="text-xs text-slate-500">{t.name}</div>
                                    <div className="text-[10px] text-slate-400">{t.level === 'TECHNICAL_ASSOCIATE' ? 'TA' : t.systemRole === 'TEAM_LEAD' ? 'TL' : 'FE'}</div>
                                </div>
                                <span className="text-[9px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full font-bold">Busy</span>
                            </div>
                        ))}
                    </div>
                </div>
                )}
            </div>
            <div className="p-4 border-t border-slate-100 shrink-0">
                <button
                    onClick={() => {
                        if (!modalActivity || !onUpdateActivity) return;
                        onUpdateActivity({
                            ...ma,
                            primaryEngineerId: dispatchPrimaryId || ma.primaryEngineerId,
                            assistantTechIds: dispatchSupportIds,
                            supportingEngineerIds: dispatchSupportIds.filter((id: string) => id !== dispatchPrimaryId),
                            leadTechId: ma.leadTechId || dispatchPrimaryId,
                            updatedAt: new Date().toISOString()
                        });
                        closeModal();
                    }}
                    className="w-full py-3.5 bg-indigo-600 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                >
                    <Users size={18} /> Update Team
                </button>
            </div>
        </div>
    </div>
    );
})()}
            {showDatePicker && (
                <div className="fixed inset-0 z-[80] flex items-end justify-center">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDatePicker(false)} />
                    <div className="bg-white w-full rounded-t-2xl p-4 pb-safe animate-in slide-in-from-bottom duration-300 relative z-10 flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-4 shrink-0">
                            <button onClick={() => setShowDatePicker(false)} className="text-slate-500 font-bold text-sm">Cancel</button>
                            <h3 className="font-bold text-slate-900">Schedule Visit</h3>
                            <button onClick={confirmDateTime} className="text-emerald-600 font-bold text-sm">Set</button>
                        </div>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Date &amp; Time</label>
                                <input
                                    type="datetime-local"
                                    value={tempDatetime}
                                    onChange={e => setTempDatetime(e.target.value)}
                                    min={new Date().toISOString().slice(0,16)}
                                    className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 text-lg font-bold text-[#111827] outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                                />
                            </div>
                        </div>
                        <div className="h-4" /> {/* Spacer */}
                    </div>
                </div>
            )}

        </div>

      {/* ── Change Password Modal ── */}
      {showChangePwd && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-900">Change Password</h3>
              <button onClick={() => setShowChangePwd(false)} className="text-slate-400 hover:text-slate-600 p-1">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {cpSuccess ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                  <p className="text-emerald-700 font-bold">✅ Password changed successfully!</p>
                  <button onClick={() => setShowChangePwd(false)} className="mt-3 px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm">Done</button>
                </div>
              ) : (
                <>
                  {cpError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{cpError}</div>}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Current Password</label>
                    <input type="password" value={cpForm.current} onChange={e => setCpForm(p => ({...p, current: e.target.value}))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Enter current password"/>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">New Password</label>
                    <input type="password" value={cpForm.next} onChange={e => setCpForm(p => ({...p, next: e.target.value}))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Minimum 8 characters"/>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Confirm New Password</label>
                    <input type="password" value={cpForm.confirm} onChange={e => setCpForm(p => ({...p, confirm: e.target.value}))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Repeat new password"/>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowChangePwd(false)} className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 text-sm">Cancel</button>
                    <button onClick={() => {
                      setCpError('');
                      if (!cpForm.current) { setCpError('Enter current password'); return; }
                      if (cpForm.next.length < 8) { setCpError('Min 8 characters'); return; }
                      if (cpForm.next !== cpForm.confirm) { setCpError('Passwords do not match'); return; }
                      onChangePassword?.(cpForm.current, cpForm.next)
                        .then(() => setCpSuccess(true))
                        .catch((err: any) => setCpError(err?.message || 'Failed'));
                    }} className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm">
                      Change Password
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Ticket Modal */}
      {/* --- Notifications / Activity Log Modal --- */}
      {showNotifications && (
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setShowNotifications(false)}>
              <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
                      <h3 className="font-bold text-lg text-slate-900">Notifications</h3>
                      <button onClick={() => setShowNotifications(false)}><X size={20} className="text-slate-400" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                      {notifications.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                              <Bell size={40} className="mb-3 text-slate-300" />
                              <p className="text-sm font-medium">All caught up!</p>
                              <p className="text-xs mt-1">No pending notifications</p>
                          </div>
                      ) : (
                          <div className="divide-y divide-slate-50">
                              {notifications.map((notif, idx) => {
                                  const typeConfig = {
                                      urgent:         { icon: '🚨', label: 'Urgent',          bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700'    },
                                      carry_forward:  { icon: '⟲',  label: 'Carry Forward',   bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
                                      overdue:        { icon: '⚠️', label: 'Overdue',          bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700'  },
                                      new_assignment: { icon: '🆕', label: 'New Assignment',   bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700'   },
                                  }[notif.type];
                                  const timeStr = new Date(notif.updatedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                                  const dateStr = new Date(notif.updatedAt).toLocaleDateString('en-GB', {day:'2-digit', month:'short'});
                                  return (
                                      <div key={`${notif.kind}-${notif.id}-${idx}`} className={`px-4 py-3 ${typeConfig.bg} border-l-4 ${typeConfig.border}`}>
                                          <div className="flex items-start gap-3">
                                              <span className="text-lg shrink-0 mt-0.5">{typeConfig.icon}</span>
                                              <div className="flex-1 min-w-0">
                                                  <div className="flex items-center gap-2 mb-0.5">
                                                      <span className="text-sm font-bold text-slate-800 truncate">{notif.title}</span>
                                                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${typeConfig.text} ${typeConfig.bg} border ${typeConfig.border}`}>
                                                          {typeConfig.label}
                                                      </span>
                                                  </div>
                                                  {notif.subtitle && <p className="text-xs text-slate-600 truncate font-medium">{notif.subtitle}</p>}
                                                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                                                      <span className="font-mono">{notif.ref}</span>
                                                      <span>•</span>
                                                      <span className="font-medium">{notif.status.replace(/_/g,' ')}</span>
                                                      <span>•</span>
                                                      <span>{dateStr} {timeStr}</span>
                                                  </div>
                                              </div>
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* --- Create Activity Modal (matches PlanningModule exactly) --- */}
      {showCreateActivity && onAddActivity && (
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setShowCreateActivity(false)}>
              <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
                      <h3 className="font-bold text-lg text-slate-900">Plan New Activity</h3>
                      <button onClick={() => { setShowCreateActivity(false); setActCustSearch(''); setActSelectedCustomer(null); setActServiceCats([]); setCreateActivityForm({ type: '', serviceCategory: '', customerId: '', description: '', plannedDate: '', priority: 'MEDIUM', locationUrl: '', houseNumber: '' }); }}><X size={20} className="text-slate-400" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {/* Customer — search by name or phone */}
                      <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Customer <span className="text-red-500">*</span></label>
                          {actSelectedCustomer ? (
                              <div className="mt-1 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-emerald-800 truncate">{actSelectedCustomer.name}</p>
                                      <p className="text-[10px] text-emerald-600">{actSelectedCustomer.phone}</p>
                                  </div>
                                  <button onClick={() => { setActSelectedCustomer(null); setActCustSearch(''); }} className="text-xs text-slate-400 hover:text-slate-600">Change</button>
                              </div>
                          ) : (
                              <>
                                  <div className="relative mt-1">
                                      <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                                      <input value={actCustSearch} onChange={e => setActCustSearch(e.target.value)}
                                          placeholder="Search by name or phone..."
                                          className="w-full border border-slate-300 rounded-lg pl-9 pr-3 p-2.5 text-sm" />
                                  </div>
                                  {actCustSearch.length >= 2 && (() => {
                                      const q = actCustSearch.toLowerCase();
                                      const matches = (customers || []).filter(c => 
                                          c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(actCustSearch))
                                      );
                                      return matches.length > 0 ? (
                                          <div className="mt-1 border border-slate-200 rounded-lg overflow-hidden max-h-32 overflow-y-auto">
                                              {matches.slice(0, 5).map(c => (
                                                  <button key={c.id} onClick={() => { setActSelectedCustomer(c); setActCustSearch(c.name); }}
                                                      className="w-full flex items-center gap-2 p-2.5 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0">
                                                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">{c.name.charAt(0)}</div>
                                                      <div className="min-w-0">
                                                          <div className="text-sm font-medium text-slate-800 truncate">{c.name}</div>
                                                          <div className="text-[10px] text-slate-400">{c.phone || 'No phone'}</div>
                                                      </div>
                                                  </button>
                                              ))}
                                          </div>
                                      ) : (
                                          <div className="mt-1 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                              <p className="text-xs text-amber-700 font-medium">No customer found</p>
                                              <button onClick={() => {
                                                  const newCust: Customer = {
                                                      id: `c${Date.now()}`, name: actCustSearch.trim(),
                                                      phone: actCustSearch.replace(/\D/g, '').length >= 4 ? actCustSearch.trim() : '',
                                                      address: '', email: '',
                                                      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(actCustSearch.trim())}&background=random`
                                                  };
                                                  if (onAddCustomer) {
                                                      Promise.resolve(onAddCustomer(newCust)).then(created => {
                                                          setActSelectedCustomer(created || newCust);
                                                          setActCustSearch((created || newCust).name);
                                                      });
                                                  } else {
                                                      setActSelectedCustomer(newCust);
                                                  }
                                              }} className="mt-1.5 text-xs font-bold text-amber-700 bg-amber-100 px-3 py-1.5 rounded-lg hover:bg-amber-200 transition-colors flex items-center gap-1">
                                                  <UserPlus size={12} /> Create "{actCustSearch.trim()}"
                                              </button>
                                          </div>
                                      );
                                  })()}
                              </>
                          )}
                      </div>

                      {/* Activity Type & Priority */}
                      <div className="grid grid-cols-2 gap-3">
                          <div>
                              <label className="text-xs font-semibold text-slate-500 uppercase">Activity Type *</label>
                              <select value={createActivityForm.type} onChange={e => setCreateActivityForm(p => ({...p, type: e.target.value}))}
                                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1">
                                  <option value="">Select Type</option>
                                  {['Installation', 'Service', 'Maintenance', 'Inspection', 'Survey'].map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                          </div>
                          <div>
                              <label className="text-xs font-semibold text-slate-500 uppercase">Priority</label>
                              <select value={createActivityForm.priority} onChange={e => setCreateActivityForm(p => ({...p, priority: e.target.value}))}
                                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1">
                                  {['LOW','MEDIUM','HIGH','URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                          </div>
                      </div>

                      {/* Service Category — multi-select */}
                      <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Service Category <span className="text-red-500">*</span></label>
                          <div className="flex flex-wrap gap-1.5 p-2.5 bg-white border border-slate-300 rounded-lg min-h-[40px] mt-1">
                              {['Wi-Fi & Networking', 'CCTV', 'Home Automation', 'Intercom', 'Smart Speaker', 'Other'].map(cat => {
                                  const sel = actServiceCats.includes(cat);
                                  return (
                                      <button key={cat} type="button" onClick={() => setActServiceCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])}
                                          className={`text-[11px] px-2.5 py-1.5 rounded-lg border-2 transition-all ${sel ? 'bg-amber-50 border-amber-400 text-amber-800 font-bold shadow-sm' : 'bg-white border-slate-200 text-slate-500'}`}>
                                          {sel && <span className="mr-0.5">\u2713 </span>}{cat}
                                      </button>
                                  );
                              })}
                          </div>
                      </div>

                      {/* Location */}
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                          <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><MapPin size={14} /> Location</h4>
                          <div className="grid grid-cols-2 gap-2">
                              <input value={createActivityForm.locationUrl} onChange={e => setCreateActivityForm(p => ({...p, locationUrl: e.target.value}))}
                                  placeholder="Location URL" className="border border-slate-300 rounded-lg p-2 text-sm" />
                              <input value={createActivityForm.houseNumber} onChange={e => setCreateActivityForm(p => ({...p, houseNumber: e.target.value}))}
                                  placeholder="House/Bldg No." className="border border-slate-300 rounded-lg p-2 text-sm" />
                          </div>
                      </div>

                      {/* Date & Time */}
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                          <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Calendar size={14} /> Planned Date & Time</h4>
                          <input type="datetime-local" value={createActivityForm.plannedDate}
                              onChange={e => setCreateActivityForm(p => ({...p, plannedDate: e.target.value}))}
                              min={new Date().toISOString().slice(0,16)}
                              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm" />
                      </div>

                      {/* Assign Engineer (optional — defaults to self) */}
                      <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Assign To <span className="text-slate-400 font-normal text-[10px]">(optional — defaults to you)</span></label>
                          <select
                              value={(createActivityForm as any).assignedEngineerId || ''}
                              onChange={e => setCreateActivityForm(p => ({...p, assignedEngineerId: e.target.value}))}
                              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1"
                          >
                              <option value="">— Self Assign —</option>
                              {(technicians || [])
                                  .filter(t => (t.systemRole === 'FIELD_ENGINEER' || t.systemRole === 'TEAM_LEAD') && t.status !== 'LEAVE' && t.isActive !== false && t.id !== currentUserId)
                                  .map(t => <option key={t.id} value={t.id}>{t.name} ({t.systemRole === 'TEAM_LEAD' ? 'TL' : 'FE'})</option>)
                              }
                          </select>
                      </div>

                      {/* Description */}
                      <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Description</label>
                          <textarea value={createActivityForm.description} onChange={e => setCreateActivityForm(p => ({...p, description: e.target.value}))}
                              rows={2} placeholder="Scope of work..." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1" />
                      </div>
                  </div>
                  <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
                      <button onClick={() => { setShowCreateActivity(false); setActCustSearch(''); setActSelectedCustomer(null); setActServiceCats([]); setCreateActivityForm({ type: '', serviceCategory: '', customerId: '', description: '', plannedDate: '', priority: 'MEDIUM', locationUrl: '', houseNumber: '' }); }} className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Cancel</button>
                      <button onClick={() => {
                          if (!actSelectedCustomer) { toast.error('Please select a customer'); return; }
                          if (!createActivityForm.type) { toast.error('Please select an activity type'); return; }
                          if (actServiceCats.length === 0) { toast.error('Please select at least one service category'); return; }
                          if (!createActivityForm.plannedDate) { toast.error('Please set a planned date'); return; }
                          const plannedDt = new Date(createActivityForm.plannedDate);
                          onAddActivity({
                              type: createActivityForm.type,
                              serviceCategory: actServiceCats.join(', '),
                              customerId: actSelectedCustomer.id,
                              description: createActivityForm.description || undefined,
                              plannedDate: plannedDt.toISOString(),
                              priority: createActivityForm.priority,
                              status: 'PLANNED',
                              locationUrl: createActivityForm.locationUrl || undefined,
                              houseNumber: createActivityForm.houseNumber || undefined,
                              // Use selected engineer if chosen, otherwise self-assign (Team Lead)
                              leadTechId: (createActivityForm as any).assignedEngineerId || currentUserId,
                          });
                          setShowCreateActivity(false);
                          setActCustSearch('');
                          setActSelectedCustomer(null);
                          setActServiceCats([]);
                          setCreateActivityForm({ type: '', serviceCategory: '', customerId: '', description: '', plannedDate: '', priority: 'MEDIUM', locationUrl: '', houseNumber: '' });
                      }} className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800">Plan Activity</button>
                  </div>
              </div>
          </div>
      )}

            {/* Create Ticket Modal — Phone-search-first customer flow */}
      {showCreateTicket && onCreateTicket && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => { setShowCreateTicket(false); setTicketPhoneSearch(''); setTicketSelectedCustomer(null); }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-slate-900">Create Ticket</h3>
              <button onClick={() => { setShowCreateTicket(false); setTicketPhoneSearch(''); setTicketSelectedCustomer(null); }}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Step 1: Search customer by phone */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Phone Number *</label>
                <div className="flex gap-2 mt-1">
                    <input 
                        value={ticketPhoneSearch} 
                        onChange={e => {
                            const val = e.target.value;
                            setTicketPhoneSearch(val);
                            setTicketSelectedCustomer(null);
                            setCreateTicketForm(p => ({...p, phone: val, customerName: ''}));
                            // Auto-search
                            if (val.length >= 4) {
                                const found = (customers || []).find(c => c.phone && c.phone.includes(val));
                                if (found) {
                                    setTicketSelectedCustomer(found);
                                    setCreateTicketForm(p => ({...p, customerName: found.name, phone: found.phone || val}));
                                }
                            }
                        }}
                        placeholder="Enter phone number to search..."
                        className="flex-1 border border-slate-300 rounded-lg p-2.5 text-sm"
                    />
                </div>
                {/* Search results */}
                {ticketPhoneSearch.length >= 3 && !ticketSelectedCustomer && (() => {
                    const matches = (customers || []).filter(c => c.phone && c.phone.includes(ticketPhoneSearch));
                    return matches.length > 0 ? (
                        <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden max-h-32 overflow-y-auto">
                            {matches.slice(0, 5).map(c => (
                                <button key={c.id} onClick={() => {
                                    setTicketSelectedCustomer(c);
                                    setTicketPhoneSearch(c.phone || ticketPhoneSearch);
                                    setCreateTicketForm(p => ({...p, customerName: c.name, phone: c.phone || ticketPhoneSearch}));
                                }} className="w-full flex items-center gap-2 p-2.5 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">{c.name.charAt(0)}</div>
                                    <div>
                                        <div className="text-sm font-medium text-slate-800">{c.name}</div>
                                        <div className="text-[10px] text-slate-400">{c.phone}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <p className="text-xs text-amber-700 font-medium">No customer found with this number</p>
                            <p className="text-[10px] text-amber-600 mt-0.5">A new customer will be created when you submit the ticket</p>
                        </div>
                    );
                })()}
                {ticketSelectedCustomer && (
                    <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                        <div>
                            <p className="text-sm font-bold text-emerald-800">{ticketSelectedCustomer.name}</p>
                            <p className="text-[10px] text-emerald-600">{ticketSelectedCustomer.phone}</p>
                        </div>
                        <button onClick={() => { setTicketSelectedCustomer(null); setTicketPhoneSearch(''); setCreateTicketForm(p => ({...p, customerName: '', phone: ''})); }} className="ml-auto text-xs text-slate-400 hover:text-slate-600">Change</button>
                    </div>
                )}
              </div>
              {/* Customer name — only show if no match found */}
              {!ticketSelectedCustomer && ticketPhoneSearch.length >= 3 && (
                  <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Customer Name *</label>
                      <input value={createTicketForm.customerName} onChange={e => setCreateTicketForm(p => ({...p, customerName: e.target.value}))}
                          placeholder="e.g. Ahmed Al Thani" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1" />
                  </div>
              )}
              <div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Category *</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {['Wi-Fi & Networking', 'CCTV', 'Home Automation', 'Intercom', 'Smart Speaker', 'Other'].map(c => {
                      const cats = (createTicketForm.category || '').split(', ').filter(Boolean);
                      const sel = cats.includes(c);
                      return <button key={c} type="button" onClick={() => {
                        const curr = (createTicketForm.category || '').split(', ').filter(Boolean);
                        const next = sel ? curr.filter(x => x !== c) : [...curr, c];
                        setCreateTicketForm(p => ({...p, category: next.join(', ')}));
                      }} className={`text-[11px] px-2.5 py-1.5 rounded-lg border-2 transition-all ${sel ? 'bg-amber-50 border-amber-400 text-amber-800 font-bold shadow-sm' : 'bg-white border-slate-200 text-slate-500'}`}>{sel ? '\u2713 ' : ''}{c}</button>;
                    })}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Type *</label>
                  <select value={createTicketForm.type} onChange={e => setCreateTicketForm(p => ({...p, type: e.target.value}))}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1">
                    <option value="">Select</option>
                    <option value="Under Warranty">Under Warranty</option>
                    <option value="Chargeable">Chargeable</option>
                    <option value="Under AMC">Under AMC</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Priority</label>
                <div className="flex gap-2 mt-1">
                  {['LOW','MEDIUM','HIGH','URGENT'].map(p => (
                    <button key={p} type="button" onClick={() => setCreateTicketForm(prev => ({...prev, priority: p}))}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${createTicketForm.priority === p
                        ? p === 'URGENT' ? 'bg-red-500 text-white' : p === 'HIGH' ? 'bg-orange-500 text-white' : p === 'MEDIUM' ? 'bg-slate-900 text-white' : 'bg-slate-600 text-white'
                        : 'bg-slate-100 text-slate-500'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Description *</label>
                <textarea value={createTicketForm.description} onChange={e => setCreateTicketForm(p => ({...p, description: e.target.value}))}
                  rows={3} placeholder="Describe the issue..." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Location URL</label>
                <input value={createTicketForm.locationUrl} onChange={e => setCreateTicketForm(p => ({...p, locationUrl: e.target.value}))}
                  placeholder="Google Maps link" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">House / Building No.</label>
                <input value={createTicketForm.houseNumber} onChange={e => setCreateTicketForm(p => ({...p, houseNumber: e.target.value}))}
                  placeholder="e.g. Villa 42" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1" />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
              <button onClick={() => { setShowCreateTicket(false); setTicketPhoneSearch(''); setTicketSelectedCustomer(null); }} className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Cancel</button>
              <button onClick={async () => {
                const phone = ticketSelectedCustomer?.phone || createTicketForm.phone.trim();
                const name = ticketSelectedCustomer?.name || createTicketForm.customerName.trim();
                if (!name || !phone || !createTicketForm.category || !createTicketForm.type || !createTicketForm.description.trim()) {
                  toast.error('Please fill all required fields');
                  return;
                }
                let custId = ticketSelectedCustomer?.id;
                let custName = name;
                // If no existing customer matched, create new
                if (!ticketSelectedCustomer) {
                    const newCust: Customer = {
                        id: `c${Date.now()}`, name: name,
                        phone: phone, address: createTicketForm.houseNumber, email: '',
                        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`
                    };
                    const created = onAddCustomer ? await onAddCustomer(newCust) : null;
                    custId = created?.id || newCust.id;
                    custName = created?.name || newCust.name;
                }

                onCreateTicket({
                  customerId: custId, customerName: custName,
                  phoneNumber: phone,
                  category: createTicketForm.category, type: createTicketForm.type,
                  priority: createTicketForm.priority,
                  initialMessage: createTicketForm.description.trim(),
                  locationUrl: createTicketForm.locationUrl, houseNumber: createTicketForm.houseNumber
                });
                setShowCreateTicket(false);
                setTicketPhoneSearch('');
                setTicketSelectedCustomer(null);
                setCreateTicketForm({ customerName: '', phone: '', category: '', type: '', priority: 'MEDIUM', description: '', locationUrl: '', houseNumber: '' });
              }} className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800">Create Ticket</button>
            </div>
          </div>
        </div>
      )}

    {/* ── Activity Reschedule Modal ── */}
    {showActivityReschedule && rescheduleActivityTarget && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setShowActivityReschedule(false)}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4 bg-slate-800 text-white">
                    <h3 className="font-bold text-lg">Reschedule Activity</h3>
                    <p className="text-slate-300 text-xs mt-0.5">{rescheduleActivityTarget.reference} — {(rescheduleActivityTarget as any).type}</p>
                </div>
                <div className="p-5 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase block mb-1">New Date & Time <span className="text-red-500">*</span></label>
                        <input
                            type="datetime-local"
                            value={rescheduleActivityDate}
                            onChange={e => setRescheduleActivityDate(e.target.value)}
                            className="w-full border border-slate-300 rounded-xl p-3 text-sm"
                        />
                    </div>
                    <p className="text-xs text-slate-400">Status resets to <span className="font-bold text-amber-600">PLANNED</span>. Original date preserved in history.</p>
                </div>
                <div className="p-4 border-t border-slate-200 grid grid-cols-2 gap-3">
                    <button onClick={() => { setShowActivityReschedule(false); setRescheduleActivityTarget(null); }}
                        className="py-3 text-slate-500 font-bold rounded-xl border border-slate-200">Cancel</button>
                    <button
                        disabled={!rescheduleActivityDate}
                        onClick={() => {
                            if (!rescheduleActivityDate || !rescheduleActivityTarget) return;
                            onUpdateActivity({
                                ...rescheduleActivityTarget,
                                status: 'PLANNED' as any,
                                plannedDate: new Date(rescheduleActivityDate).toISOString(),
                                nextPlannedAt: undefined,
                                updatedAt: new Date().toISOString()
                            });
                            setShowActivityReschedule(false);
                            setRescheduleActivityTarget(null);
                            toast.success('Activity rescheduled');
                        }}
                        className="py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 disabled:bg-slate-300 disabled:cursor-not-allowed">
                        Reschedule
                    </button>
                </div>
            </div>
        </div>
    )}

    </div>
  );
};

export default React.memo(MobileLeadPortal);
