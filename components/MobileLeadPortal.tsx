import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, TicketStatus, TicketType, Technician, Activity, Team, Customer, Priority, Role, Site } from '../types';
import { 
  ChevronLeft, Phone, MapPin, Search, Plus, 
  LogOut, Bell, ListTodo, Calendar, BarChart3, Users,
  CheckCircle2, History, AlertTriangle, X, UserPlus,
  TrendingUp, Grid, Contact, Smartphone, ChevronRight, Clock, Briefcase, ExternalLink, Play, CheckSquare, ChevronDown, KeyRound
} from 'lucide-react';
import ReportsModule from './ReportsModule';
import PlanningModule from './PlanningModule';
import CustomerRecords from './CustomerRecords';
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
  
  isStandalone?: boolean;
  onLogout?: () => void;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  focusedTicketId?: string | null;
  currentUserId?: string; // New: For "My Jobs"
}

// --- Icons & UI Helpers ---
const NavButton = ({ active, onClick, icon: Icon, label }: any) => (
    <button 
        onClick={onClick}
        className={`flex flex-col items-center justify-center py-2 flex-1 transition-colors ${active ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600'}`}
    >
        <Icon size={24} className={active ? 'fill-amber-500/10' : ''} />
        <span className="text-[10px] font-bold mt-1 uppercase tracking-wide">{label}</span>
    </button>
);

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
    onUpdateTicket, onUpdateActivity, onAddActivity, onDeleteActivity, onAddCustomer, onSaveCustomer, onDeleteCustomer, onCreateTicket,
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
  const [activeTab, setActiveTab] = useState<'live' | 'my_jobs' | 'team' | 'menu'>('live'); 
  const [mobileModule, setMobileModule] = useState<'none' | 'planner' | 'reports' | 'clients'>('none'); 
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

  // Initialize focused ticket
  useEffect(() => {
      if (focusedTicketId) {
          setSelectedTicketId(focusedTicketId);
          setMobileModule('none');
          setActiveTab('live');
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
          .map(a => ({ kind: 'activity' as const, data: a, sortDate: a.updatedAt || a.createdAt }));
      return [...doneTickets, ...doneActivities]
          .sort((a, b) => new Date(b.sortDate || 0).getTime() - new Date(a.sortDate || 0).getTime())
          .slice(0, 50); // last 50 completed
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

  const newTickets = visibleTickets.filter(t => t.status === TicketStatus.NEW);
  const activeOps = visibleTickets.filter(t => 
      [TicketStatus.OPEN, TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS, TicketStatus.CARRY_FORWARD].includes(t.status)
  );

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);

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

  const handleStartWork = (ticket: Ticket) => {
      if (onUpdateTicket) {
          onUpdateTicket({
              ...ticket,
              status: TicketStatus.IN_PROGRESS,
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
          });
      }
      setViewTicket(null); // ✅ closes the My Jobs bottom sheet automatically
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
          alert("Please select a future date and time.");
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
                      <span className="text-xs font-mono text-slate-400">#{ticket.id}</span>
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
                        <h3 className="text-base font-bold text-slate-900">{actCustomer?.name || act.type || 'Activity'}</h3>
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
                {actCustomer?.phone ? (
                    <a href={`tel:${actCustomer.phone}`} onClick={(e:any)=>e.stopPropagation()}
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
                                  <img src={tech.avatar} className="w-12 h-12 rounded-full bg-slate-200 object-cover" alt="" />
                                  <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${tech.status === 'AVAILABLE' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                              </div>
                              <div className="flex-1">
                                  <h4 className="font-bold text-slate-800">{tech.name}</h4>
                                  <div className="text-xs text-slate-500">{tech.systemRole === Role.TEAM_LEAD ? "Team Lead" : "Field Engineer"}</div>
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
                                  <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Total</span>
                              </div>
                          </div>
                      </div>
                  );
              })}
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

      // 2. Mobile Menu (Overlay)
      if (activeTab === 'menu') {
          return (
              <div className="h-full bg-slate-100 p-4 grid grid-cols-2 gap-4 content-start pt-8 overflow-y-auto">
                  <button onClick={() => { setMobileModule('planner'); setActiveTab('live'); }} className="bg-white p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center gap-3 active:scale-95 transition-transform">
                      <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl"><Calendar size={32}/></div>
                      <span className="font-bold text-slate-800">Planner</span>
                  </button>
                  <button onClick={() => { setMobileModule('none'); }} className="bg-white p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center gap-3 active:scale-95 transition-transform">
                      <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl"><TrendingUp size={32}/></div>
                      <span className="font-bold text-slate-800">Metrics</span>
                  </button>
                  <button onClick={() => { setMobileModule('reports'); setActiveTab('live'); }} className="bg-white p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center gap-3 active:scale-95 transition-transform">
                      <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><BarChart3 size={32}/></div>
                      <span className="font-bold text-slate-800">Reports</span>
                  </button>
                  <button onClick={() => { setMobileModule('clients'); setActiveTab('live'); }} className="bg-white p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center gap-3 active:scale-95 transition-transform">
                      <div className="p-3 bg-purple-100 text-purple-600 rounded-xl"><Contact size={32}/></div>
                      <span className="font-bold text-slate-800">Clients</span>
                  </button>
                  
                  <button onClick={() => { setShowChangePwd(true); setCpForm({current:'',next:'',confirm:''}); setCpError(''); setCpSuccess(false); }} className="col-span-2 bg-slate-800 text-white p-4 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform">
                      <KeyRound size={20}/> Change Password
                  </button>
		  {onLogout && (
		    <button onClick={onLogout} className="col-span-2 bg-slate-200 text-slate-600 p-4 rounded-xl font-bold flex items-center justify-center gap-2">
		        <LogOut size={20}/> Logout
		    </button>
		)}
              </div>
          );
      }

      // 3. Full Screen Modules
      if (mobileModule !== 'none') {
          return (
              <div className="h-full flex flex-col bg-slate-50">
                  <div className="bg-white border-b border-slate-200 p-4 flex items-center gap-3 shrink-0">
                      <button onClick={() => setMobileModule('none')} className="p-1 rounded-full hover:bg-slate-100">
                          <ChevronLeft size={24} className="text-slate-600"/>
                      </button>
                      <h2 className="font-bold text-lg text-slate-900 capitalize">
                          {mobileModule}
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
                              />
                          </div>
                      )}
                  </div>
              </div>
          );
      }

      // 4. Default Dashboard Tabs
      return (
          <div className="h-full overflow-y-auto custom-scrollbar pb-24">
              {activeTab === 'live' && (
                  <div className="p-4 space-y-6">
                      <div className="flex gap-2">
                          <div className="relative flex-1">
                              <Search size={16} className="absolute left-3 top-3 text-slate-400"/>
                              <input 
                                  value={searchTerm}
                                  onChange={(e) => setSearchTerm(e.target.value)}
                                  placeholder="Search tickets..."
                                  className={SEARCH_INPUT_STYLES}
                              />
                          </div>
                          {onCreateTicket && (
                              <button 
                                  onClick={() => setShowCreateTicket(true)}
                                  className="bg-slate-900 text-white px-3 rounded-xl flex items-center gap-1 text-xs font-bold shrink-0"
                              >
                                  <Plus size={14} /> Ticket
                              </button>
                          )}
                      </div>
                      {newTickets.length > 0 && (
                          <div>
                              <h3 className="text-xs font-bold text-slate-500 uppercase mb-2 px-1 flex items-center justify-between">
                                  New Arrivals
                                  <span className="bg-emerald-100 text-emerald-700 px-2 rounded-full">{newTickets.length}</span>
                              </h3>
                              {newTickets.map(t => <TicketCard key={t.id} ticket={t} />)}
                          </div>
                      )}
                      <div>
                          <h3 className="text-xs font-bold text-slate-500 uppercase mb-2 px-1">ACTIVE OPERATIONS ({activeOps.length})</h3>
                          {activeOps.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No active operations</p>}
                          {activeOps.map(t => <TicketCard key={t.id} ticket={t} />)}
                      </div>
                  </div>
              )}
              
              {activeTab === 'my_jobs' && (
                  <div className="p-4 space-y-4">
                      <div className="flex items-center justify-between mb-2 px-1">
                          <h3 className="text-xs font-bold text-slate-500 uppercase">
                              {showJobHistory ? 'Completed Jobs' : `My Active Jobs (${myJobs.length})`}
                          </h3>
                          <button
                              onClick={() => setShowJobHistory(s => !s)}
                              className={`text-[10px] font-bold px-2 py-1 rounded-full transition-colors ${showJobHistory ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'}`}
                          >
                              {showJobHistory ? '← Active' : 'History'}
                          </button>
                      </div>

                      {/* Active jobs */}
                      {!showJobHistory && myJobs.length === 0 && (
                          <p className="text-center text-slate-400 text-sm py-8">No active jobs assigned to you</p>
                      )}
                      {!showJobHistory && myJobs.map(item => {
                          if (item.kind === 'ticket') return <JobCard key={item.data.id} ticket={item.data} />;
                          return <ActivityJobCard key={item.data.id} activity={item.data} />;
                      })}

                      {/* History — completed & cancelled jobs */}
                      {showJobHistory && completedJobs.length === 0 && (
                          <p className="text-center text-slate-400 text-sm py-8">No completed jobs yet</p>
                      )}
                      {showJobHistory && completedJobs.map(item => {
                          const isAct = item.kind === 'activity';
                          const job = item.data as any;
                          const label     = isAct ? (job.type || 'Activity') : (job.customerName || job.id);
                          const sub       = isAct ? (job.serviceCategory || job.description?.substring(0,40) || '') : (job.category || '');
                          const statusVal = job.status || '';
                          const dt        = new Date(item.sortDate || job.updatedAt || job.createdAt);
                          return (
                              <div key={job.id}
                                  onClick={() => isAct
                                      ? setViewJob({ type: 'activity', data: job })
                                      : setViewTicket(job)}
                                  className="bg-white rounded-xl border border-slate-200 p-4 mb-3 cursor-pointer hover:bg-slate-50 active:scale-[0.99] transition-transform">
                                  <div className="flex justify-between items-start mb-1">
                                      <div>
                                          <div className="text-[10px] font-bold text-slate-400 mb-0.5">{job.reference || job.id}</div>
                                          <span className="font-bold text-slate-800">{label}</span>
                                      </div>
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusVal === 'RESOLVED' || statusVal === 'DONE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                          {statusVal.replace(/_/g,' ')}
                                      </span>
                                  </div>
                                  {sub && <div className="text-xs text-slate-500 mb-1">{sub}</div>}
                                  <div className="text-xs text-slate-400">{dt.toLocaleDateString()} {dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                              </div>
                          );
                      })}
                  </div>
              )}

              {activeTab === 'team' && <TeamView />}
          </div>
      );
  };

  // Portal always renders — fullscreen bypass handles device routing

  return (
    <div className="flex h-[100dvh] bg-slate-100 font-sans overflow-hidden" style={{paddingTop: 'env(safe-area-inset-top)', paddingBottom: 0}}>
        
        {/* MAIN CONTENT AREA */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative min-h-0">
            
            {/* MOBILE HEADER — always visible */}
            {!selectedTicketId && (
                <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0 shadow-md z-30 rounded-b-2xl">
                    <div>
                        <h2 className="font-bold text-lg leading-none">Team Lead Portal</h2>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">
                            {mobileModule !== 'none' ? mobileModule.toUpperCase() : activeTab === 'menu' ? 'MENU' : 'LIVE FEED'}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setActiveTab('live')}
                            className="relative p-1 rounded-full hover:bg-slate-700 transition-colors"
                            title={stalledCount > 0 ? `${stalledCount} stalled ticket(s) — click to view` : 'Live feed'}
                        >
                            <Bell size={20} className={stalledCount > 0 ? 'text-red-400' : 'text-slate-400'} />
                            {stalledCount > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border-2 border-slate-900" />}
                        </button>
                        <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-xs shadow-inner border border-slate-800">TL</div>
                    </div>
                </div>
            )}

            {/* CONTENT BODY */}
            <div className="flex-1 overflow-hidden relative bg-slate-100 min-h-0">
                {renderMobileContent()}
            </div>

            {/* Mobile Bottom Navigation */}
            {!selectedTicketId && mobileModule === 'none' && (
                <div className="bg-white border-t border-slate-200 flex justify-between px-2 z-30 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]" style={{height: "calc(4rem + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)"}}>
                    <NavButton active={activeTab === 'live'} onClick={() => setActiveTab('live')} icon={ListTodo} label="Live Feed" />
                    <NavButton active={activeTab === 'my_jobs'} onClick={() => setActiveTab('my_jobs')} icon={Briefcase} label="My Jobs" />
                    <NavButton active={activeTab === 'team'} onClick={() => setActiveTab('team')} icon={Users} label="Field Team" />
                    <NavButton active={activeTab === 'menu'} onClick={() => setActiveTab('menu')} icon={Grid} label="More" />
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

                                {/* Your Work Actions — show whenever this ticket is assigned to current user */}
                                {viewTicket.assignedTechId === currentUserId && (
                                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                            <Briefcase size={14}/> Your Work Actions
                                        </h4>
                                        
                                        <div className="space-y-3">
                                            {(viewTicket.status === TicketStatus.OPEN || viewTicket.status === TicketStatus.ASSIGNED) && (
                                                <button 
                                                    onClick={() => handleStartWork(viewTicket)}
                                                    className="w-full bg-[#FCBF0A] text-slate-900 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors hover:bg-[#e5ad09] active:scale-[0.98] shadow-sm"
                                                >
                                                    <Play size={18} fill="currentColor"/> Start Work
                                                </button>
                                            )}

                                            {viewTicket.status === TicketStatus.IN_PROGRESS && (
                                                <div className="grid grid-cols-2 gap-3">
                                                    <button 
                                                        onClick={() => handleOpenJobAction('job_carry', viewTicket)}
                                                        className="bg-white border border-slate-300 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors text-xs hover:bg-slate-50 active:scale-[0.98]"
                                                    >
                                                        <History size={16}/> Carry Forward
                                                    </button>
                                                    <button 
                                                        onClick={() => handleOpenJobAction('job_complete', viewTicket)}
                                                        className="bg-[#FCBF0A] text-slate-900 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors text-xs hover:bg-[#e5ad09] active:scale-[0.98] shadow-sm"
                                                    >
                                                        <CheckSquare size={16}/> Complete Work
                                                    </button>
                                                </div>
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
{viewActivity && (
    <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-end"
        onClick={() => setViewActivity(null)}
    >
        <div
            className="bg-white w-full max-w-lg rounded-t-[2rem] shadow-2xl h-[70vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
            onClick={e => e.stopPropagation()}
        >
            {/* Drag Handle */}
            <div className="h-6 w-full flex justify-center items-center shrink-0">
                <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-100">
                            Activity • {((viewActivity as any).status === 'IN_PROGRESS') ? 'IN PROGRESS' : (viewActivity as any).status}
                        </span>
                        <span className="text-xs font-mono text-slate-400">#{(viewActivity as any).reference || (viewActivity as any).id}</span>
                    </div>

                    <h2 className="text-xl font-bold text-slate-900 leading-tight">{(viewActivity as any).type || "Activity"}</h2>
                    {(viewActivity as any).plannedDate && (
                        <p className="text-xs text-slate-500 mt-1">
                            Planned {new Date((viewActivity as any).plannedDate).toLocaleDateString()} •{" "}
                            {new Date((viewActivity as any).plannedDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    )}
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-700">
                    {(viewActivity as any).description || "No description"}
                </div>

                {/* Workflow Actions */}
                {onUpdateActivity && (
                    <div className="space-y-3">
                        {(viewActivity as any).status === 'PLANNED' && (
                            <button
                                onClick={() => {
                                    const a = viewActivity as any;
                                    setModalActivity(a);
                                    setDispatchPrimaryId(a.leadTechId || '');
                                    setDispatchSupportIds(a.assistantTechIds || []);
                                    setModalType('activity_dispatch');
                                    setViewActivity(null);
                                }}
                                className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-blue-700"
                            >
                                <Users size={18} /> Dispatch Team
                            </button>
                        )}

                        {['ON_MY_WAY','ARRIVED'].includes((viewActivity as any).status) && (
                            <button
                                onClick={() => {
                                    onUpdateActivity({
                                        ...(viewActivity as any),
                                        status: 'IN_PROGRESS',
                                        updatedAt: new Date().toISOString()
                                    });
                                    setViewActivity(null);
                                }}
                                className="w-full bg-[#FCBF0A] text-slate-900 font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-[#e5ad09]"
                            >
                                <Play size={18} fill="currentColor" /> Start Work
                            </button>
                        )}

                        {(viewActivity as any).status === 'IN_PROGRESS' && (
                            <button
                                onClick={() => {
                                    onUpdateActivity({
                                        ...(viewActivity as any),
                                        status: 'DONE',
                                        updatedAt: new Date().toISOString()
                                    });
                                    setViewActivity(null);
                                }}
                                className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700"
                            >
                                <CheckSquare size={18} /> Complete Work
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-white shrink-0 pb-safe">
                <button
                    onClick={() => setViewActivity(null)}
                    className="w-full py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors"
                >
                    Close
                </button>
            </div>
        </div>
    </div>
)}


            {/* --- Technician Details Bottom Sheet --- */}
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
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-400 font-medium">Location</span>
                                                <span className="font-semibold text-slate-700 text-right max-w-[55%] truncate">
                                                    {viewJob.data.houseNumber || viewJob.data.locationUrl}
                                                </span>
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
                                                <button onClick={() => { handleStartWork(viewJob.data); setViewJob(null); }}
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
                                                <button onClick={() => { handleStartWork(viewJob.data); setViewJob(null); }}
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
                                            {(viewJob.data.status === 'PLANNED') && (
                                                <button onClick={() => {
                                                    const a = viewJob.data;
                                                    setModalActivity(a);
                                                    setDispatchPrimaryId(a.leadTechId || '');
                                                    setDispatchSupportIds(a.assistantTechIds || []);
                                                    setModalType('activity_dispatch');
                                                    setViewJob(null);
                                                }}
                                                    className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm">
                                                    <Users size={18} /> Dispatch Team
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
                                <div className="flex-1 overflow-y-auto bg-white p-4">
                                    {(() => {
                                    const jobs = getTechJobs(viewTech.id).all;

                                    if (!jobs.length) {
                                        return (
                                        <div className="text-center text-sm text-slate-400 py-10">
                                            No active jobs found
                                        </div>
                                        );
                                    }

                                    return (
                                        <div className="space-y-3">
                                        {jobs.map((j, idx) => {
                                            const status = j.type === 'ticket' ? j.data.status : j.data.status;
                                            const ref = j.type === 'ticket' ? `#${j.data.id}` : (j.data.reference || j.data.id);
                                            const title = j.type === 'ticket' ? j.data.category : (j.data.type || 'Activity');
                                            
                                            // Fix for siteName error
                                            let sub = '';
                                            if (j.type === 'ticket') {
                                                sub = j.data.customerName || '';
                                            } else {
                                                // Activity
                                                const act = j.data as Activity;
                                                const site = sites.find(s => s.id === act.siteId);
                                                // Fallback to customer name if site not found (since activities can be linked to customers now)
                                                const customer = customers.find(c => c.id === act.customerId);
                                                sub = site?.name || customer?.name || act.siteId || '';
                                            }

                                            return (
                                            <div
                                                key={`${j.type}-${ref}-${idx}`}
                                                onClick={() => setViewJob(j)}
                                                className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm active:scale-[0.98] transition-transform cursor-pointer"
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(status)}`}>
                                                    {String(status).replace('_', ' ')}
                                                </span>
                                                <span className="text-xs font-mono text-slate-400">{ref}</span>
                                                </div>

                                                <div className="font-bold text-slate-800">{title}</div>
                                                {sub ? <div className="text-xs text-slate-500 mt-1 truncate">{sub}</div> : null}
                                            </div>
                                            );
                                        })}
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
                        if (!modalActivity || !onUpdateActivity || !onAddActivity || !nextDate) return;
                        const a: any = modalActivity as any;
                        const cfNote = carryIssue ? `Reason: ${carryIssue}${actionNote ? '\nRemark: ' + actionNote : ''}` : actionNote;
                        
                        // 1. Mark ORIGINAL activity as CARRY_FORWARD (stays on original date)
                        onUpdateActivity({
                            ...a,
                            status: 'CARRY_FORWARD',
                            carryForwardNote: cfNote,
                            remarks: cfNote + (a.remarks ? '\n---\n' + a.remarks : ''),
                            updatedAt: new Date().toISOString()
                        });
                        
                        // 2. Create NEW activity for the rescheduled date (inherits all details)
                        const newAct = {
                            type: a.type,
                            serviceCategory: a.serviceCategory,
                            customerId: a.customerId,
                            priority: a.priority,
                            status: 'PLANNED',
                            plannedDate: nextDate,
                            durationHours: a.durationHours,
                            durationUnit: a.durationUnit,
                            description: a.description,
                            odooLink: a.odooLink,
                            locationUrl: a.locationUrl,
                            houseNumber: a.houseNumber,
                            salesLeadId: a.salesLeadId,
                            leadTechId: a.leadTechId,
                            assistantTechIds: a.assistantTechIds,
                            freelancers: a.freelancers,
                            siteId: a.siteId,
                            remarks: `Follow-up from ${a.reference} (${new Date(a.plannedDate).toLocaleDateString('en-GB', {day:'2-digit', month:'short'})})\n${cfNote}`,
                            previousActivityRef: a.reference,
                        };
                        onAddActivity(newAct);
                        
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
                        <option value="" disabled>Select primary engineer</option>
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
                        if (!modalActivity || !onUpdateActivity || !dispatchPrimaryId) return;
                        const a = modalActivity as any;
                        onUpdateActivity({
                            ...a,
                            status: 'ON_MY_WAY',
                            primaryEngineerId: dispatchPrimaryId,
                            supportingEngineerIds: dispatchSupportIds.filter(id => id !== dispatchPrimaryId),
                            leadTechId: a.leadTechId || dispatchPrimaryId,
                            updatedAt: new Date().toISOString()
                        });
                        closeModal();
                        setViewActivity(null);
                        setViewJob(null);
                    }}
                    disabled={!dispatchPrimaryId}
                    className="w-full py-3.5 bg-blue-600 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
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
      {showCreateTicket && onCreateTicket && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setShowCreateTicket(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-slate-900">Create Ticket</h3>
              <button onClick={() => setShowCreateTicket(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Customer Name *</label>
                <input value={createTicketForm.customerName} onChange={e => setCreateTicketForm(p => ({...p, customerName: e.target.value}))}
                  placeholder="e.g. Ahmed Al Thani" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">Phone *</label>
                <input value={createTicketForm.phone} onChange={e => setCreateTicketForm(p => ({...p, phone: e.target.value}))}
                  placeholder="+974 XXXX XXXX" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm mt-1" />
              </div>
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
              <button onClick={() => setShowCreateTicket(false)} className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Cancel</button>
              <button onClick={async () => {
                if (!createTicketForm.customerName.trim() || !createTicketForm.phone.trim() || !createTicketForm.category || !createTicketForm.type || !createTicketForm.description.trim()) {
                  alert('Please fill all required fields');
                  return;
                }
                // Create customer first
                const newCust: Customer = {
                  id: `c${Date.now()}`, name: createTicketForm.customerName.trim(),
                  phone: createTicketForm.phone.trim(), address: createTicketForm.houseNumber, email: '',
                  avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(createTicketForm.customerName.trim())}&background=random`
                };
                const created = onAddCustomer ? await onAddCustomer(newCust) : null;
                const custId = created?.id || newCust.id;
                const custName = created?.name || newCust.name;

                onCreateTicket({
                  customerId: custId, customerName: custName,
                  phoneNumber: createTicketForm.phone.trim(),
                  category: createTicketForm.category, type: createTicketForm.type,
                  priority: createTicketForm.priority,
                  initialMessage: createTicketForm.description.trim(),
                  locationUrl: createTicketForm.locationUrl, houseNumber: createTicketForm.houseNumber
                });
                setShowCreateTicket(false);
                setCreateTicketForm({ customerName: '', phone: '', category: '', type: '', priority: 'MEDIUM', description: '', locationUrl: '', houseNumber: '' });
              }} className="flex-1 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800">Create Ticket</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileLeadPortal;
