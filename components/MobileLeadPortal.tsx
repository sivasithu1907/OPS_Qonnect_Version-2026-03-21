import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, TicketStatus, Technician, Activity, Team, Customer, Priority, Role, Site } from '../types';
import { 
  ChevronLeft, Phone, MapPin, Search, Plus, 
  LogOut, Bell, ListTodo, Calendar, BarChart3, Users,
  CheckCircle2, History, AlertTriangle, X, UserPlus,
  TrendingUp, Grid, Contact, Smartphone, ChevronRight, Clock, Briefcase, ExternalLink, Play, CheckSquare, ChevronDown
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
  onAddCustomer?: (customer: Customer) => void;
  onSaveCustomer?: (customer: Customer) => void;
  onDeleteCustomer?: (id: string) => void;
  
  isStandalone?: boolean;
  onLogout?: () => void;
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
    onUpdateTicket, onUpdateActivity, onAddActivity, onDeleteActivity, onAddCustomer, onSaveCustomer, onDeleteCustomer,
    isStandalone = false, onLogout, focusedTicketId, currentUserId
}) => {
  // --- Responsive Check ---
  // When embedded in the main app (isStandalone=false), always use mobile layout
  // When accessed directly (isStandalone=true), check actual screen width
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
  const [modalType, setModalType] = useState<'dispatch' | 'cancel' | 'carry' | 'job_carry' | 'job_complete' | 'activity_job_carry' | 'activity_job_complete' | null>(null);
  const [modalTicket, setModalTicket] = useState<Ticket | null>(null);
  const [modalActivity, setModalActivity] = useState<Activity | null>(null);
  
  // Detail Sheets State
  const [viewTech, setViewTech] = useState<Technician | null>(null);
  const [viewTicket, setViewTicket] = useState<Ticket | null>(null); 
  const [viewActivity, setViewActivity] = useState<Activity | null>(null);
  const [viewJob, setViewJob] = useState<{ type: 'ticket' | 'activity', data: any } | null>(null);

  // Action Form State
  const [actionNote, setActionNote] = useState('');
  const [selectedTechId, setSelectedTechId] = useState('');
  const [assignedTeamLead, setAssignedTeamLead] = useState('');
  
  // Date Picker State
  const [nextDate, setNextDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // Temp Picker Values
  const [tempDate, setTempDate] = useState(''); // YYYY-MM-DD for input type="date"
  const [tempHour, setTempHour] = useState('09');
  const [tempMinute, setTempMinute] = useState('00');
  const [tempAmPm, setTempAmPm] = useState('AM');

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
          status: TicketStatus.IN_PROGRESS, 
          carryForwardNote: actionNote,
          nextPlannedAt: nextDate, 
          updatedAt: new Date().toISOString()
      });
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
      setTempMinute(nearestMin);
      
      setTempAmPm(ampm);
      setShowDatePicker(true);
  };

  const confirmDateTime = () => {
      if (!tempDate) return;
      
      let hours = parseInt(tempHour);
      if (tempAmPm === 'PM' && hours < 12) hours += 12;
      if (tempAmPm === 'AM' && hours === 12) hours = 0;
      
      const combined = new Date(`${tempDate}T${String(hours).padStart(2, '0')}:${tempMinute}:00`);
      
      // Validation: Disallow past dates
      if (combined < new Date()) {
          alert("Cannot schedule a visit in the past.");
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
      setSelectedTechId('');
      setNextDate('');
      setShowDatePicker(false);
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

              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-200 group-hover:text-slate-400 transition-colors">
                  <ChevronRight size={20} />
              </div>
          </div>
      );
  };

  const JobCard: React.FC<{ ticket: Ticket }> = ({ ticket }) => {
      const locationDisplay = ticket.houseNumber 
        ? ticket.houseNumber 
        : (ticket.locationUrl ? "Map Location Available" : "Location not set");

      return (
          <div 
            onClick={() => handleTicketCardTap(ticket)}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-3 active:scale-[0.98] transition-transform relative overflow-hidden group"
          >
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

              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-200">
                  <ChevronRight size={20} />
              </div>
          </div>
      );
  };

const ActivityJobCard: React.FC<{ activity: Activity }> = ({ activity }) => {
    const locationDisplay = (activity as any).houseNumber
      ? (activity as any).houseNumber
      : ((activity as any).locationUrl ? "Map Location Available" : "Location not set");

    const statusLabel = (activity as any).status === 'IN_PROGRESS' ? 'IN PROGRESS' : (activity as any).status;

    return (
        <div
          onClick={() => setViewActivity(activity)}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-3 active:scale-[0.98] transition-transform relative overflow-hidden"
        >
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                        ACTIVITY • {statusLabel}
                    </span>
                    <span className="text-xs font-mono text-slate-400">#{(activity as any).reference || (activity as any).id}</span>
                </div>
            </div>

            <h4 className="font-bold text-slate-800 text-sm mb-1">{(activity as any).type || "Activity"}</h4>

            <div className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin size={12} />
                <span className="truncate max-w-[200px]">{locationDisplay}</span>
            </div>

            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-200">
                <ChevronRight size={20} />
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
                  
                  <button onClick={onLogout} className="col-span-2 mt-8 bg-slate-200 text-slate-600 p-4 rounded-xl font-bold flex items-center justify-center gap-2">
                      <LogOut size={20}/> Logout
                  </button>
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
                                  customers={customers} activities={activities} technicians={technicians} sites={sites}
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
                      <div className="relative">
                          <Search size={16} className="absolute left-3 top-3 text-slate-400"/>
                          <input 
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              placeholder="Search tickets..."
                              className={SEARCH_INPUT_STYLES}
                          />
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
                      <h3 className="text-xs font-bold text-slate-500 uppercase mb-2 px-1">
                          My Assigned Jobs ({myJobs.length})
                      </h3>

                      {myJobs.length === 0 && (
                          <p className="text-center text-slate-400 text-sm py-8">No jobs assigned to you</p>
                      )}

                      {myJobs.map(item => {
                          if (item.kind === 'ticket') return <JobCard key={item.data.id} ticket={item.data} />;
                          return <ActivityJobCard key={item.data.id} activity={item.data} />;
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
            
            {/* MOBILE HEADER */}
            {!selectedTicketId && mobileModule === 'none' && activeTab !== 'menu' && (
                <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0 shadow-md z-30 rounded-b-2xl">
                    <div>
                        <h2 className="font-bold text-lg leading-none">Team Lead Portal</h2>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">
                            LIVE FEED
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Bell size={20} className="text-slate-400" />
                            {stalledCount > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border-2 border-slate-900" />}
                        </div>
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
                                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Issue Description</h4>
                                    <p className="text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-100 leading-relaxed">
                                        {viewTicket.messages[0]?.content}
                                    </p>
                                </div>

                                {/* Your Work Actions (For My Jobs) */}
                                {activeTab === 'my_jobs' && viewTicket.assignedTechId === currentUserId && (
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
                {(viewActivity as any).leadTechId === currentUserId && onUpdateActivity && (
                    <div className="space-y-3">
                        {(viewActivity as any).status === 'PLANNED' && (
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
                                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                                    <button 
                                        onClick={() => setViewJob(null)}
                                        className="text-sm font-bold text-slate-500 flex items-center gap-1 hover:text-slate-800"
                                    >
                                        <ChevronLeft size={20} /> Back
                                    </button>
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Job Details</span>
                                    <div className="w-6" /> {/* Spacer */}
                                </div>
                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(viewJob.data.status)}`}>
                                                {viewJob.data.status.replace('_', ' ')}
                                            </span>
                                            <span className="text-xs font-mono text-slate-400">
                                                {viewJob.type === 'ticket' ? `#${viewJob.data.id}` : viewJob.data.reference}
                                            </span>
                                        </div>
                                        <h2 className="text-xl font-bold text-slate-900 leading-tight mb-1">
                                            {viewJob.type === 'ticket' ? viewJob.data.category : viewJob.data.type}
                                        </h2>
                                        <p className="text-sm text-slate-500">
                                            {viewJob.type === 'ticket' ? viewJob.data.messages[0]?.content : viewJob.data.description}
                                        </p>
                                    </div>
                                </div>
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
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Remark <span className="text-red-500">*</span></label>
                                <textarea 
                                    value={actionNote} 
                                    onChange={e => setActionNote(e.target.value)}
                                    className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl text-[#111827] placeholder-[#9CA3AF] px-4 py-3.5 text-sm leading-[1.4] focus:outline-none focus:ring-0 focus:border-[#F5B301] transition-colors resize-none"
                                    placeholder="Reason for carry forward..."
                                    rows={4}
                                    autoFocus
                                />
                            </div>
                            
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Next Visit <span className="text-red-500">*</span></label>
                                <div 
                                    onClick={openDateTimePicker}
                                    className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 flex items-center gap-3 cursor-pointer active:bg-slate-100 transition-colors"
                                >
                                    <Calendar size={18} className="text-slate-400"/>
                                    {nextDate ? (
                                        <span className="text-[#111827] text-sm font-medium">{formatNextVisit(nextDate)}</span>
                                    ) : (
                                        <span className="text-[#94A3B8] text-sm">Select date & time...</span>
                                    )}
                                </div>
                                {(!nextDate && actionNote.trim()) && (
                                    <p className="text-[10px] text-red-500 mt-2 font-medium flex items-center gap-1">
                                        <AlertTriangle size={10} /> Please select next visit date & time.
                                    </p>
                                )}
                            </div>

                            <button 
                                onClick={executeJobCarry}
                                disabled={!actionNote.trim() || !nextDate}
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
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Remark <span className="text-red-500">*</span></label>
                    <textarea 
                        value={actionNote} 
                        onChange={e => setActionNote(e.target.value)}
                        className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl text-[#111827] placeholder-[#9CA3AF] px-4 py-3.5 text-sm leading-[1.4] focus:outline-none focus:ring-0 focus:border-[#F5B301] transition-colors resize-none"
                        placeholder="Reason for carry forward..."
                        rows={4}
                        autoFocus
                    />
                </div>

                <div>
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Next Visit <span className="text-red-500">*</span></label>
                    <div 
                        onClick={openDateTimePicker}
                        className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 flex items-center gap-3 cursor-pointer active:bg-slate-100 transition-colors"
                    >
                        <Calendar size={18} className="text-slate-400"/>
                        {nextDate ? (
                            <span className="text-[#111827] text-sm font-medium">{formatNextVisit(nextDate)}</span>
                        ) : (
                            <span className="text-[#94A3B8] text-sm">Select date & time...</span>
                        )}
                    </div>
                    {(!nextDate && actionNote.trim()) && (
                        <p className="text-[10px] text-red-500 mt-2 font-medium flex items-center gap-1">
                            <AlertTriangle size={10} /> Please select next visit date & time.
                        </p>
                    )}
                </div>

                <button 
                    onClick={() => {
                        if (!modalActivity || !onUpdateActivity || !nextDate) return;
                        const a: any = modalActivity as any;
                        onUpdateActivity({
                            ...a,
                            status: 'PLANNED',
                            plannedDate: nextDate,
                            remarks: actionNote ? (a.remarks ? a.remarks + '\n' + actionNote : actionNote) : a.remarks,
                            updatedAt: new Date().toISOString()
                        });
                        closeModal();
                        setViewActivity(null);
                    }}
                    disabled={!actionNote.trim() || !nextDate}
                    className="w-full py-3 bg-emerald-600/10 border border-emerald-600/40 text-emerald-600 font-bold rounded-xl disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed active:bg-emerald-600/20"
                >
                    Schedule Visit
                </button>
            </div>
        </div>
    </div>
)}


            {/* Custom Date Time Picker Bottom Sheet */}
            {showDatePicker && (
                <div className="fixed inset-0 z-[70] flex items-end justify-center">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDatePicker(false)} />
                    <div className="bg-white w-full rounded-t-2xl p-4 pb-safe animate-in slide-in-from-bottom duration-300 relative z-10 flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-4 shrink-0">
                            <button onClick={() => setShowDatePicker(false)} className="text-slate-500 font-bold text-sm">Cancel</button>
                            <h3 className="font-bold text-slate-900">Schedule Visit</h3>
                            <button onClick={confirmDateTime} className="text-emerald-600 font-bold text-sm">Set</button>
                        </div>
                        
                        <div className="space-y-6">
                            {/* Date Section */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Date</label>
                                <input 
                                    type="date" 
                                    value={tempDate}
                                    onChange={(e) => setTempDate(e.target.value)}
                                    onKeyDown={(e) => e.preventDefault()}
                                    className="w-full bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 text-lg font-bold text-[#111827] outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all appearance-none"
                                    min={new Date().toISOString().split('T')[0]}
                                />
                            </div>

                            {/* Time Section */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Time</label>
                                <div className="flex gap-2">
                                    {/* Hour */}
                                    <div className="flex-1 relative">
                                        <select 
                                            value={tempHour}
                                            onChange={(e) => setTempHour(e.target.value)}
                                            className="w-full appearance-none bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 text-lg font-bold text-[#111827] outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-center"
                                        >
                                            {HOURS_12.map(h => <option key={h} value={h}>{h}</option>)}
                                        </select>
                                        <div className="absolute inset-0 pointer-events-none flex items-center justify-end px-3">
                                            {/* Hide default arrow if custom styling needed, but native select is fine for dropdown req */}
                                        </div>
                                    </div>
                                    
                                    <span className="text-2xl font-bold text-slate-300 self-center">:</span>

                                    {/* Minute */}
                                    <div className="flex-1 relative">
                                        <select 
                                            value={tempMinute}
                                            onChange={(e) => setTempMinute(e.target.value)}
                                            className="w-full appearance-none bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 text-lg font-bold text-[#111827] outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-center"
                                        >
                                            {MINUTES_STEP.map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                    </div>

                                    {/* AM/PM */}
                                    <div className="flex-1 relative">
                                        <select 
                                            value={tempAmPm}
                                            onChange={(e) => setTempAmPm(e.target.value)}
                                            className="w-full appearance-none bg-[#F5F6F8] border border-[#E2E5EA] rounded-xl px-4 py-3.5 text-lg font-bold text-[#111827] outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all text-center"
                                        >
                                            {AMPM_OPTS.map(ap => <option key={ap} value={ap}>{ap}</option>)}
                                        </select>
                                        {/* Custom styled arrow/icon could go here */}
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                            <ChevronDown size={16} className="text-slate-400" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="h-4" /> {/* Spacer */}
                    </div>
                </div>
            )}

        </div>
    </div>
  );
};

export default MobileLeadPortal;
