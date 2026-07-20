
import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import toast from './Toast';
import { Team, Site, Technician, Activity, Ticket, TicketStatus, Priority, Customer } from '../types';
import { 
  MapPin, Clock, Truck, ShieldAlert, 
  Activity as ActivityIcon, Calendar, ZoomIn, ZoomOut,
  CheckCircle2, AlertCircle, History, Ticket as TicketIcon, 
  Zap, ArrowRight, X, ExternalLink, Users, ChevronRight, User, Phone,
  FileText, MessageSquare, RotateCcw, Briefcase
} from 'lucide-react';

interface OperationsDashboardProps {
  teams: Team[];
  sites: Site[];
  technicians: Technician[];
  activities: Activity[];
  tickets: Ticket[];
  customers: Customer[];
  onUpdateActivity?: (activity: Activity) => void;
  onNavigate?: (type: 'ticket' | 'activity', id: string) => void;
  readOnly?: boolean;
  tvMode?: boolean; // TV Display: bigger rows, full names, wider zoom, no KPI bar
}

// Define a union type for the selected item in the drawer
type DrawerItem = { type: 'ticket', data: Ticket } | { type: 'activity', data: Activity };

const OperationsDashboard: React.FC<OperationsDashboardProps> = ({ 
    teams, 
    sites, 
    technicians,
    activities,
    tickets,
    customers,
    onUpdateActivity,
    onNavigate,
    readOnly = false,
    tvMode = false
}) => {
  const [selectedItem, setSelectedItem] = useState<DrawerItem | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Timeline Configuration
  const [zoomLevel, setZoomLevel] = useState(tvMode ? 100 : 140); // TV: wider view, Desktop: 140px/hr
  
  // Constants for Fixed Timeline (00:00 - 24:00)
  const TIMELINE_START = 0;
  const TIMELINE_END = 24;
  const TOTAL_HOURS = TIMELINE_END - TIMELINE_START; 
  const totalGridWidth = TOTAL_HOURS * zoomLevel;
  const LEFT_COL_WIDTH = tvMode ? 240 : 280;
  const ROW_HEIGHT = tvMode ? 'h-32' : 'h-28'; // Taller rows for TV readability — bumped one step for distance readability

  // Filters
  const [bodyScrollLeft, setBodyScrollLeft] = useState(0);


  // Refs for Scroll Sync
  const leftColRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  // Update clock every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Scroll to NOW handled by useLayoutEffect below (removed duplicate useEffect)

  // --- Scroll Synchronization ---
  const handleBodyScroll = () => {
      if (bodyScrollRef.current) {
          const { scrollLeft, scrollTop } = bodyScrollRef.current;
          setBodyScrollLeft(scrollLeft);
          
          // Sync Header Horizontally
          if (headerScrollRef.current) {
              headerScrollRef.current.scrollLeft = scrollLeft;
          }
          
          // Sync Left Column Vertically
          if (leftColRef.current) {
              leftColRef.current.scrollTop = scrollTop;
          }
      }
  };

  const handleHeaderScroll = () => {
      if (headerScrollRef.current && bodyScrollRef.current) {
          bodyScrollRef.current.scrollLeft = headerScrollRef.current.scrollLeft;
      }
  };

  const handleLeftWheel = (e: React.WheelEvent) => {
      if (bodyScrollRef.current) {
          // Forward both vertical and horizontal scroll to the body
          bodyScrollRef.current.scrollTop += e.deltaY;
          if (e.deltaX !== 0) {
              bodyScrollRef.current.scrollLeft += e.deltaX;
          }
      }
  };

  // --- Helpers ---

  const normalizeStatus = (status: string | undefined) => {
      if (!status) return '';
      // Convert "In Progress", "INPROGRESS", "in_progress" -> "IN_PROGRESS"
      return status.toUpperCase().replace(/\s/g, '_').replace('INPROGRESS', 'IN_PROGRESS');
  };

  const getTechWorkload = (techId: string) => {
      const today = new Date().toDateString();
      const todaysActs = activities.filter(a => {
          const isToday = new Date(a.plannedDate).toDateString() === today;
          if (!isToday || a.status === 'CANCELLED') return false;
          // A job counts toward a tech's workload whether they're the lead,
          // the primary (actual) engineer, or a supporting engineer on it —
          // previously only leadTechId was checked, so supporting engineers
          // showed 0h/0% utilization for jobs they were genuinely working on.
          if (a.leadTechId === techId) return true;
          if ((a as any).primaryEngineerId === techId) return true;
          if (((a as any).supportingEngineerIds || []).includes(techId)) return true;
          return false;
      });
      return todaysActs.reduce((acc, curr) => acc + curr.durationHours, 0);
  };

  const getNowX = () => {
      const hours = currentTime.getHours() + currentTime.getMinutes() / 60;
      if (hours < TIMELINE_START) return 0;
      if (hours > TIMELINE_END) return totalGridWidth;
      return (hours - TIMELINE_START) * zoomLevel;
  };

  // Auto-scroll to NOW on initial load
  useLayoutEffect(() => {
      if (bodyScrollRef.current && !hasAutoScrolled.current && totalGridWidth > 0) {
          const nowX = getNowX();
          // Only scroll if we are within the timeline range
          if (nowX > 0 && nowX < totalGridWidth) {
              const containerWidth = bodyScrollRef.current.clientWidth;
              const targetScroll = Math.max(0, nowX - (containerWidth / 2));
              bodyScrollRef.current.scrollLeft = targetScroll;
          }
          hasAutoScrolled.current = true;
      }
  }, [totalGridWidth, zoomLevel]);

  const getPositionStyle = (dateStr: string, durationHours: number = 2) => {
  let date = new Date(dateStr);
  if (isNaN(date.getTime())) date = new Date();

  const startHours = date.getHours() + date.getMinutes() / 60;
  const offsetHours = startHours - TIMELINE_START;

  // start X (clamp within grid start)
  const left = Math.max(0, offsetHours * zoomLevel);

  // compute end X and clamp to timeline end (24:00)
  const rawEndHours = startHours + durationHours;
  const clampedEndHours = Math.min(rawEndHours, TIMELINE_END); // 24.0

  const endOffsetHours = clampedEndHours - TIMELINE_START;
  const endX = Math.max(0, endOffsetHours * zoomLevel);

  // width should never exceed the grid end
  const width = Math.max(tvMode ? 120 : 4, endX - left); // TV mode: min 120px so content is readable

  // if start is already beyond grid end, keep it at the edge with minimal width
  const clampedLeft = Math.min(left, totalGridWidth);

  // also clamp width so it never extends beyond totalGridWidth
  const maxWidth = Math.max(4, totalGridWidth - clampedLeft);
  const clampedWidth = Math.min(width, maxWidth);

  return { left: `${clampedLeft}px`, width: `${clampedWidth}px` };
};


  const formatTimeHeader = (hour: number) => {
      const displayHour = hour === 24 ? 0 : hour;
      return `${String(displayHour).padStart(2, '0')}:00`;
  };

  const handleItemClick = (type: 'ticket' | 'activity', id: string) => {
      if (type === 'ticket') {
          const t = tickets.find(x => x.id === id);
          if (t) setSelectedItem({ type: 'ticket', data: t });
      } else {
          const a = activities.find(x => x.id === id);
          if (a) setSelectedItem({ type: 'activity', data: a });
      }
  };

  // --- Data Derivation ---

  const operationsStaff = useMemo(() => {
      // Only Team Leads and Field Engineers appear in the schedule — not Admins or others
      const isOpsRole = (t: any) =>
          (t.systemRole === 'TEAM_LEAD' || t.systemRole === 'FIELD_ENGINEER') &&
          t.systemRole !== 'ADMIN';
      return technicians.filter(t =>
          isOpsRole(t) &&
          t.isActive !== false &&
          t.status !== 'LEAVE'
      ).sort((a, b) => {
          // Prioritize Team Leads in the sort order
          if (a.level === 'TEAM_LEAD' && b.level !== 'TEAM_LEAD') return -1;
          if (a.level !== 'TEAM_LEAD' && b.level === 'TEAM_LEAD') return 1;
          return a.name.localeCompare(b.name);
      });
  }, [technicians]);

  // Activities with freelancers but no internal engineer assigned — need their own row
  // Split into: FE freelancers get their own row, TA freelancers show as "unassigned"
  const freelancerEngineers = useMemo(() => {
      const today = new Date().toDateString();
      const feMap = new Map<string, { name: string; phone: string; activities: Activity[] }>();
      
      activities.forEach(a => {
          if (a.status === 'CANCELLED') return;
          const freelancers = (a as any).freelancers || [];
          if (freelancers.length === 0) return;
          
          // Skip if this activity already has an internal engineer — it's shown under their row
          const hasInternalEngineer = a.leadTechId && operationsStaff.some(s => s.id === a.leadTechId);
          if (hasInternalEngineer) return;
          
          // Check if this is a today/active activity
          const d = new Date(a.plannedDate || a.createdAt);
          const isToday = d.toDateString() === today;
          const isActive = ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(a.status);
          if (!isToday && !isActive) return;
          
          // Find FE freelancers — they get their own row
          freelancers.forEach((fl: any) => {
              if (fl.role === 'FIELD_ENGINEER' && fl.name) {
                  const key = fl.name.trim().toLowerCase();
                  if (!feMap.has(key)) {
                      feMap.set(key, { name: fl.name, phone: fl.phone || '', activities: [] });
                  }
                  feMap.get(key)!.activities.push(a);
              }
          });
      });
      
      return Array.from(feMap.values());
  }, [activities]);

  const unassignedFreelancerActs = useMemo(() => {
      const today = new Date().toDateString();
      return activities.filter(a => {
          if (a.status === 'CANCELLED') return false;
          if (!(a as any).freelancers || (a as any).freelancers.length === 0) return false;
          // Must NOT have an internal engineer AND no FE freelancer
          const hasInternalLead = a.leadTechId || (a as any).primaryEngineerId;
          if (hasInternalLead) return false;
          // Check if any freelancer is FE (they have their own row)
          const hasFEFreelancer = ((a as any).freelancers || []).some((fl: any) => fl.role === 'FIELD_ENGINEER');
          if (hasFEFreelancer) return false; // Handled by freelancerEngineers rows
          // Today's activities only
          const d = new Date(a.plannedDate || a.createdAt);
          if (a.status === 'IN_PROGRESS' || a.status === 'ON_MY_WAY' || a.status === 'ARRIVED') return true;
          return d.toDateString() === today;
      });
  }, [activities]);

  const liveFeed = useMemo(() => {
      const today = new Date().toDateString();
      const feedItems = [
          ...tickets
              .filter(t => new Date(t.updatedAt).toDateString() === today || new Date(t.createdAt).toDateString() === today)
              .map(t => ({
                  id: t.id,
                  type: 'ticket' as const,
                  refLine: t.id,
                  clientLine: t.customerName,
                  descLine: (t as any).ai_summary || t.notes || t.category,
                  time: new Date(t.updatedAt),
                  status: t.status
              })),
          ...activities
              .filter(a => a.type !== 'WHATSAPP_SUPPORT' && (new Date(a.updatedAt || a.createdAt).toDateString() === today))
              .map(a => ({
                  id: a.id,
                  type: 'activity' as const,
                  refLine: a.reference,
                  clientLine: customers.find(c=>c.id===a.customerId)?.name || sites.find(s=>s.id===a.siteId)?.name || a.houseNumber || 'Unknown Client',
                  descLine: a.description || a.type,
                  time: new Date(a.updatedAt || a.createdAt),
                  status: a.status
              }))
      ];
      return feedItems.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 20);
  }, [tickets, activities, sites, customers]);

  const metrics = useMemo(() => {
    const todayDate = new Date().toDateString();
    const activeActs = activities.filter(a =>
        ['IN_PROGRESS', 'PLANNED'].includes(normalizeStatus(a.status)) &&
        new Date(a.plannedDate || a.createdAt).toDateString() === todayDate
    ).length;
    const activeTickets = tickets.filter(t => ['IN_PROGRESS','ASSIGNED','ON_MY_WAY','ARRIVED'].includes(normalizeStatus(t.status))).length;
    const activeJobs = activeActs + activeTickets;
    // crewsOnSite = techs who are actively on a job right now
    const activeTechIds = new Set([
        ...tickets
            .filter(t => ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(normalizeStatus(t.status)) && t.assignedTechId)
            .map(t => t.assignedTechId!),
        ...activities
            .filter(a => ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status))
            .flatMap(a => [a.leadTechId, (a as any).primaryEngineerId].filter(Boolean))
    ]);
    const crewsOnSite = operationsStaff.filter(t => activeTechIds.has(t.id)).length;
    const plannedToday = activities.filter(a => new Date(a.plannedDate).toDateString() === new Date().toDateString()).length;
    const completedToday = (
        activities.filter(a => a.status === 'DONE' && new Date((a as any).completedAt || a.updatedAt).toDateString() === todayDate).length +
        tickets.filter(t => normalizeStatus(t.status) === 'RESOLVED' && new Date((t as any).completedAt || t.updatedAt).toDateString() === todayDate).length
    );
    const alertsCount = activities.filter(a => (a.escalationLevel || 0) > 0 && a.status !== 'DONE' && a.status !== 'CANCELLED').length;
    // Utilization = total scheduled hours / (staff × 8h capacity) × 100
    const totalScheduledHours = activities
        .filter(a => new Date(a.plannedDate || a.createdAt).toDateString() === todayDate && a.status !== 'CANCELLED')
        .reduce((sum, a) => sum + (a.durationHours || 2), 0);
    const capacityHours = (operationsStaff.length || 1) * 8;
    const utilization = Math.min(100, Math.round((totalScheduledHours / capacityHours) * 100));

    // Additional KPIs for the Mission Control summary bar — reuses the same
    // arrays and status/priority values already in use elsewhere, nothing invented.
    const inProgressCount = activities.filter(a => a.status === 'IN_PROGRESS').length + tickets.filter(t => normalizeStatus(t.status) === 'IN_PROGRESS').length;
    const carryForwardCount = activities.filter(a => a.status === 'CARRY_FORWARD').length + tickets.filter(t => normalizeStatus(t.status) === 'CARRY_FORWARD').length;
    const openTickets = tickets.filter(t => t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CANCELLED).length;
    const urgentTickets = tickets.filter(t => t.priority === Priority.URGENT && t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CANCELLED).length;

    return { activeJobs, crewsOnSite, plannedToday, alertsCount, utilization, completedToday, inProgressCount, carryForwardCount, openTickets, urgentTickets };
  }, [activities, tickets, operationsStaff]);

  const timeMarkers = Array.from(
      { length: TOTAL_HOURS }, // Strictly 0 to 23
      (_, i) => TIMELINE_START + i
  );

  // Genuine operational issues only — overdue (>72h, same threshold as the
  // Ticket Management aging pills), unassigned open tickets, high/urgent
  // priority, carry-forward. No fabricated alert types.
  const criticalAlerts = useMemo(() => {
      const now = Date.now();
      type Alert = { id: string; icon: React.ReactNode; label: string; ref: string; client: string; tone: 'red' | 'amber'; onClick: () => void };
      const alerts: Alert[] = [];
      tickets.forEach(t => {
          if (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CANCELLED) return;
          const hours = (now - new Date(t.createdAt).getTime()) / 36e5;
          if (hours > 72) alerts.push({ id: `ov-${t.id}`, icon: <Clock size={12} />, label: 'Overdue', ref: t.id, client: t.customerName, tone: 'red', onClick: () => handleItemClick('ticket', t.id) });
          if (!t.assignedTechId) alerts.push({ id: `wa-${t.id}`, icon: <AlertCircle size={12} />, label: 'Waiting Assignment', ref: t.id, client: t.customerName, tone: 'amber', onClick: () => handleItemClick('ticket', t.id) });
          if (t.priority === Priority.URGENT) alerts.push({ id: `ur-${t.id}`, icon: <ShieldAlert size={12} />, label: 'Urgent', ref: t.id, client: t.customerName, tone: 'red', onClick: () => handleItemClick('ticket', t.id) });
          if (t.status === TicketStatus.CARRY_FORWARD) alerts.push({ id: `cft-${t.id}`, icon: <History size={12} />, label: 'Carry Forward', ref: t.id, client: t.customerName, tone: 'amber', onClick: () => handleItemClick('ticket', t.id) });
      });
      activities.forEach(a => {
          if (a.status === 'CANCELLED' || a.status === 'DONE') return;
          const custLabel = customers.find(c => c.id === a.customerId)?.name || a.houseNumber || a.reference || a.id;
          if (a.status === 'CARRY_FORWARD') alerts.push({ id: `cfa-${a.id}`, icon: <History size={12} />, label: 'Carry Forward', ref: a.reference || a.id, client: custLabel, tone: 'amber', onClick: () => handleItemClick('activity', a.id) });
          if ((a.escalationLevel || 0) > 0) alerts.push({ id: `esc-${a.id}`, icon: <ShieldAlert size={12} />, label: 'Escalated', ref: a.reference || a.id, client: custLabel, tone: 'red', onClick: () => handleItemClick('activity', a.id) });
      });
      return alerts;
  }, [tickets, activities, customers]);

  // Live status per engineer — reuses the same involvement rules (primary /
  // lead / supporting) already established for the timeline rows below,
  // simplified to "what is this person doing right now, if anything".
  const engineerLiveStatus = useMemo(() => {
      return operationsStaff.map(tech => {
          const activeActivity = activities.find(a =>
              ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(a.status) &&
              (a.leadTechId === tech.id || (a as any).primaryEngineerId === tech.id || ((a as any).supportingEngineerIds || []).includes(tech.id))
          );
          const activeTicket = !activeActivity ? tickets.find(t => t.assignedTechId === tech.id && ['IN_PROGRESS', 'ON_MY_WAY', 'ARRIVED'].includes(normalizeStatus(t.status))) : undefined;

          let liveStatus: 'Travelling' | 'Working' | 'Available' | 'Busy' = 'Available';
          if (activeActivity) liveStatus = activeActivity.status === 'ON_MY_WAY' ? 'Travelling' : 'Working';
          else if (activeTicket) liveStatus = normalizeStatus(activeTicket.status) === 'ON_MY_WAY' ? 'Travelling' : 'Working';
          else if (tech.status === 'BUSY') liveStatus = 'Busy';

          const clientName = activeActivity
              ? (customers.find(c => c.id === activeActivity.customerId)?.name || sites.find(s => s.id === activeActivity.siteId)?.name || activeActivity.houseNumber || null)
              : activeTicket ? (customers.find(c => c.id === activeTicket.customerId)?.name || activeTicket.customerName || null) : null;

          const refLabel = activeActivity ? (activeActivity.reference || activeActivity.id) : activeTicket ? activeTicket.id : null;

          // ETA only computable when we have a real start time + duration (activities only)
          const eta = activeActivity && (activeActivity as any).startedAt
              ? new Date(new Date((activeActivity as any).startedAt).getTime() + (activeActivity.durationHours || 2) * 3600000)
              : null;

          return {
              tech, liveStatus, clientName, refLabel, eta,
              onClick: activeActivity ? () => handleItemClick('activity', activeActivity.id) : activeTicket ? () => handleItemClick('ticket', activeTicket.id) : undefined
          };
      });
  }, [operationsStaff, activities, tickets, customers, sites]);

  const getSystemStatus = () => {
      if (metrics.alertsCount > 3) return { 
          label: 'System Critical', 
          bgColor: 'bg-red-50', 
          borderColor: 'border-red-200', 
          textColor: 'text-red-900', 
          dotColor: 'bg-red-500'
      };
      if (metrics.alertsCount > 0) return { 
          label: 'Warnings Detected', 
          bgColor: 'bg-amber-50', 
          borderColor: 'border-amber-200', 
          textColor: 'text-amber-900',
          dotColor: 'bg-amber-500'
      };
      return { 
          label: 'Operations Normal', 
          bgColor: 'bg-emerald-50', 
          borderColor: 'border-emerald-200', 
          textColor: 'text-emerald-900', 
          dotColor: 'bg-emerald-500'
      };
  };

  const statusConfig = getSystemStatus();
  const nowX = getNowX();

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden font-sans text-slate-900">
        
        {/* TOP: Mission Control Summary — HIDDEN in TV mode (TV cycles a dedicated Dashboard panel already) */}
        {!tvMode && (
        <div className="flex-none bg-white z-30 shadow-sm">

            {/* Mission Control Header */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#FFCC00] shrink-0" />
                <h2 className="font-bold text-slate-900 text-[15px] tracking-tight">Mission Control</h2>
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${statusConfig.bgColor} ${statusConfig.borderColor} ${statusConfig.textColor}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dotColor} animate-pulse`} />{statusConfig.label}
                </span>
              </div>
              <div className="text-[11px] font-mono font-semibold text-slate-400 tabular-nums">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Live
              </div>
            </div>

            {/* Live KPI Bar */}
            <div className="px-4 pb-3 grid grid-cols-7 gap-3">
                <div className="p-2.5 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Activities Today</span>
                        <Calendar size={13} className="text-slate-400"/>
                    </div>
                    <span className="text-xl font-bold text-slate-800 leading-none mt-1 tabular-nums">{metrics.plannedToday}</span>
                    <span className="text-[9px] text-slate-400 mt-0.5">Scheduled for today</span>
                </div>
                <div className="p-2.5 rounded-xl border border-blue-200 bg-blue-50/40 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">In Progress</span>
                        <ActivityIcon size={13} className="text-blue-500"/>
                    </div>
                    <span className="text-xl font-bold text-blue-700 leading-none mt-1 tabular-nums">{metrics.inProgressCount}</span>
                    <span className="text-[9px] text-blue-400 mt-0.5">Currently active</span>
                </div>
                <div className={`p-2.5 rounded-xl border shadow-sm flex flex-col justify-between ${metrics.carryForwardCount > 0 ? 'border-orange-200 bg-orange-50/40' : 'border-slate-200 bg-white'}`}>
                    <div className="flex justify-between items-start">
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${metrics.carryForwardCount > 0 ? 'text-orange-600' : 'text-slate-400'}`}>Carry Forward</span>
                        <History size={13} className={metrics.carryForwardCount > 0 ? 'text-orange-500' : 'text-slate-300'}/>
                    </div>
                    <span className={`text-xl font-bold leading-none mt-1 tabular-nums ${metrics.carryForwardCount > 0 ? 'text-orange-700' : 'text-slate-800'}`}>{metrics.carryForwardCount}</span>
                    <span className={`text-[9px] mt-0.5 ${metrics.carryForwardCount > 0 ? 'text-orange-400' : 'text-slate-400'}`}>Outstanding workload</span>
                </div>
                <div className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Completed Today</span>
                        <CheckCircle2 size={13} className="text-emerald-500"/>
                    </div>
                    <span className="text-xl font-bold text-emerald-700 leading-none mt-1 tabular-nums">{metrics.completedToday}</span>
                    <span className="text-[9px] text-emerald-400 mt-0.5">Completed today</span>
                </div>
                <div className="p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/40 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider">Active Engineers</span>
                        <Truck size={13} className="text-indigo-500"/>
                    </div>
                    <div className="flex items-end gap-1 mt-1">
                      <span className="text-xl font-bold text-indigo-700 leading-none tabular-nums">{metrics.crewsOnSite}</span>
                      <span className="text-[10px] font-medium text-indigo-400 mb-0.5">/ {operationsStaff.length}</span>
                    </div>
                    <span className="text-[9px] text-indigo-400 mt-0.5">Working now</span>
                </div>
                <div className="p-2.5 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Open Tickets</span>
                        <TicketIcon size={13} className="text-slate-400"/>
                    </div>
                    <span className="text-xl font-bold text-slate-800 leading-none mt-1 tabular-nums">{metrics.openTickets}</span>
                    <span className="text-[9px] text-slate-400 mt-0.5">Currently unresolved</span>
                </div>
                <div className={`p-2.5 rounded-xl border shadow-sm flex flex-col justify-between ${metrics.urgentTickets > 0 ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex justify-between items-start">
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${metrics.urgentTickets > 0 ? 'text-red-600' : 'text-slate-400'}`}>Urgent Tickets</span>
                        <ShieldAlert size={13} className={metrics.urgentTickets > 0 ? 'text-red-600 animate-pulse' : 'text-slate-300'}/>
                    </div>
                    <span className={`text-xl font-bold leading-none mt-1 tabular-nums ${metrics.urgentTickets > 0 ? 'text-red-700' : 'text-slate-800'}`}>{metrics.urgentTickets}</span>
                    <span className={`text-[9px] mt-0.5 ${metrics.urgentTickets > 0 ? 'text-red-400' : 'text-slate-400'}`}>Requires attention</span>
                </div>
            </div>

            {/* Critical Alerts strip — horizontal scroll, only renders genuine issues */}
            {criticalAlerts.length > 0 && (
              <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1"><ShieldAlert size={11}/> Critical Alerts</span>
                {criticalAlerts.slice(0, 25).map(a => (
                  <button key={a.id} type="button" onClick={a.onClick}
                    className={`shrink-0 flex items-center gap-2 pl-2.5 pr-3 py-2 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00] ${
                      a.tone === 'red' ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                    }`}>
                    <span className={a.tone === 'red' ? 'text-red-500 shrink-0' : 'text-amber-500 shrink-0'}>{a.icon}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${a.tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{a.label}</span>
                    <span className={`w-px h-3 shrink-0 ${a.tone === 'red' ? 'bg-red-200' : 'bg-amber-200'}`} />
                    <span className={`text-[10px] font-mono font-semibold shrink-0 ${a.tone === 'red' ? 'text-red-600' : 'text-amber-600'}`}>{a.ref}</span>
                    <span className={`w-px h-3 shrink-0 ${a.tone === 'red' ? 'bg-red-200' : 'bg-amber-200'}`} />
                    <span className={`text-[10px] font-medium truncate max-w-[130px] ${a.tone === 'red' ? 'text-red-800' : 'text-amber-800'}`}>{a.client}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Engineers Live Status strip — horizontal scroll of compact cards */}
            <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1"><Users size={11}/> Engineers</span>
              {engineerLiveStatus.map(({ tech, liveStatus, clientName, refLabel, eta, onClick }) => {
                const statusStyle = liveStatus === 'Working' ? 'bg-blue-500' : liveStatus === 'Travelling' ? 'bg-cyan-500' : liveStatus === 'Busy' ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                  <button key={tech.id} type="button" onClick={onClick} disabled={!onClick}
                    className={`shrink-0 flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00] ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
                    <div className="relative shrink-0">
                      <img src={tech.avatar} className="w-7 h-7 rounded-full bg-slate-200 object-cover" alt="" />
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${statusStyle}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-800 truncate max-w-[110px]">{tech.name}</span>
                        <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded ${liveStatus === 'Working' ? 'bg-blue-100 text-blue-700' : liveStatus === 'Travelling' ? 'bg-cyan-100 text-cyan-700' : liveStatus === 'Busy' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{liveStatus}</span>
                      </div>
                      <div className="text-[9px] text-slate-400 truncate max-w-[150px]">
                        {clientName ? <>{refLabel} · {clientName}{eta ? ` · ETA ${eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</> : 'No active job'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Zoom Controls */}
            <div className="bg-white border-t border-slate-100 px-4 py-2 flex items-center justify-between gap-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Operational Timeline</span>
                <div className="flex items-center gap-2">
                    <button onClick={() => setZoomLevel(prev => Math.max(60, prev - 20))} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200 transition-colors"><ZoomOut size={16}/></button>
                    <span className="text-[10px] font-mono text-slate-400 min-w-[60px] text-center font-medium">{zoomLevel} px/hr</span>
                    <button onClick={() => setZoomLevel(prev => Math.min(300, prev + 20))} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200 transition-colors"><ZoomIn size={16}/></button>
                </div>
            </div>
        </div>
        )}

        {/* MAIN LAYOUT: 3-COLUMN GRID — dynamic widths for TV vs Desktop */}
        <div className={`flex-1 overflow-hidden grid ${tvMode ? 'grid-cols-[220px_minmax(0,1fr)_200px]' : 'grid-cols-[280px_minmax(0,1fr)_240px]'}`}>
            
            {/* COLUMN 1: LEFT TEAMS (Fixed Width) */}
            <div className="flex flex-col border-r border-slate-200 bg-white relative z-20">
                {/* Header Row */}
                <div className="h-10 border-b border-slate-200 bg-slate-50 flex items-center px-4 font-bold text-[10px] text-slate-500 uppercase tracking-wider shrink-0">
                    Field Operations
                </div>
                {/* Vertically Scrollable List (Synced via JS) */}
                <div 
                    ref={leftColRef}
                    className="flex-1 overflow-hidden bg-white"
                    onWheel={handleLeftWheel}
                >
                    {operationsStaff.map(tech => {
                        const workload = getTechWorkload(tech.id);
                        const capacity = 8;
                        const utilization = Math.min(100, Math.round((workload/capacity)*100));
                        
                        // Find activities where this tech is assigned for TODAY or currently active
                        const todayStr = new Date().toDateString();
                        const todayActs = activities.filter(a => {
                            const isToday = new Date(a.plannedDate).toDateString() === todayStr;
                            const isActive = ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status);
                            if (a.status === 'CANCELLED') return false;
                            // Must be today's activity OR currently active
                            if (!isToday && !isActive) return false;
                            // Execution: this tech is the primary (actual) engineer
                            if ((a as any).primaryEngineerId === tech.id) return true;
                            // Planning: this tech is the planned lead
                            if (a.leadTechId === tech.id) return true;
                            // Supporting: this tech is a supporting engineer on the job —
                            // previously missing here, which meant a supporting engineer's
                            // own card never showed this job in their hours/utilization,
                            // even though the job correctly showed in their timeline row.
                            if (((a as any).supportingEngineerIds || []).includes(tech.id)) return true;
                            return false;
                        });
                        
                        // Extract supporting engineers — only from today's active or planned activities for THIS engineer
                        const activeActs = todayActs.filter(a => ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status));
                        const uniqueSupportIds = Array.from(new Set([
                            ...activeActs.flatMap(a => (a as any).supportingEngineerIds || []),
                            // Include TAs only from today's assigned activities (not global)
                            ...todayActs.flatMap(a => a.assistantTechIds || []),
                            // Include the job's own primary/lead engineer too — without this,
                            // a SUPPORTING engineer's card only ever showed other supporters/TAs
                            // and never the actual lead they're supporting (e.g. Aswanth's card
                            // showed "Kaushar Wosta" but not "Obaid", even though Obaid is the
                            // lead on the very job Aswanth is supporting).
                            ...activeActs.flatMap(a => [(a as any).primaryEngineerId, a.leadTechId].filter(Boolean)),
                        ].filter(Boolean))).filter(id => id !== tech.id); // exclude self — todayActs now also
                          // includes jobs where this tech is themselves a supporter (see fix above), so
                          // without this filter a supporting engineer would show up as a tag on their own card
                        
                        const supportingMembers = uniqueSupportIds
                            .map(mId => technicians.find(t => t.id === mId))
                            .filter(Boolean);

                        // Extract freelancers from ALL today's activities (show even for PLANNED)
                        const allFreelancers = todayActs.flatMap(a => (a as any).freelancers || []);

                        // Check if this tech is currently working on something
                        const isActiveNow = activeActs.length > 0;

                        return (
                            <div key={tech.id} className={`${tvMode ? "h-32" : "h-28"} border-b border-slate-200 p-3 flex flex-col justify-center`}>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="relative">
                                        <img src={tech.avatar} className="w-9 h-9 rounded-full bg-slate-200 border border-slate-100 object-cover" alt=""/>
                                        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                            isActiveNow ? 'bg-blue-500 animate-pulse' : tech.status === 'AVAILABLE' ? 'bg-emerald-500' : 'bg-slate-300'
                                        }`} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800 text-xs truncate">
                                                {tech.name}
                                            </span>
                                            {isActiveNow && <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">LIVE</span>}
                                        </div>
                                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                            <span className={utilization > 100 ? 'text-red-500 font-bold' : 'text-slate-400'}>
                                                {workload}h / {capacity}h
                                            </span>
                                            <span className="text-slate-300">|</span>
                                            <span className="text-slate-400">{utilization}% Util</span>
                                        </div>
                                    </div>
                                </div>
                                {/* Supporting Team (internal + freelancers) */}
                                <div className="flex flex-wrap gap-1 mb-1">
                                {supportingMembers.length > 0 && (
                                    supportingMembers.map((assoc: any) => {
                                    // Determine this person's role on the job relative to THIS card —
                                    // Lead (primary/leadTechId), execution Support, or TA. Without this,
                                    // a job's lead/primary engineer fell through to the generic TA style
                                    // when shown on a supporting engineer's own card.
                                    const isLead = activeActs.some(a => (a as any).primaryEngineerId === assoc.id || a.leadTechId === assoc.id);
                                    const isTA = todayActs.some(a => (a.assistantTechIds || []).includes(assoc.id));
                                    const isExecSupport = activeActs.some(a => ((a as any).supportingEngineerIds || []).includes(assoc.id));
                                    return (
                                    <span
                                        key={assoc.id}
                                        className={`px-1.5 py-0.5 text-[9px] font-medium rounded flex items-center gap-1 ${
                                            isLead ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                                            isExecSupport ? 'bg-blue-50 text-blue-700' : 'bg-teal-50 text-teal-700 border border-teal-200'
                                        }`}
                                    >
                                        <Users size={8} className={isLead ? 'text-indigo-400' : isExecSupport ? 'text-blue-400' : 'text-teal-400'} /> {assoc.name}
                                        {isLead && <span className="text-[7px] opacity-60">Lead</span>}
                                        {isTA && !isExecSupport && !isLead && <span className="text-[7px] opacity-60">TA</span>}
                                    </span>
                                    );
                                    })
                                )}
                                {allFreelancers.length > 0 && (
                                    allFreelancers.map((fl: any, i: number) => (
                                    <span
                                        key={`fl-${i}`}
                                        className="px-1.5 py-0.5 bg-amber-50 text-[9px] font-medium text-amber-700 rounded flex items-center gap-1 border border-amber-200"
                                    >
                                        {fl.name} <span className="text-[7px] opacity-60">FL</span>
                                    </span>
                                    ))
                                )}
                                {supportingMembers.length === 0 && allFreelancers.length === 0 && (
                                    <span className="text-[9px] text-slate-300 italic">Solo</span>
                                )}
                                </div>

                                
                                <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full ${utilization > 100 ? 'bg-red-500' : utilization > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                                        style={{ width: `${utilization}%` }} 
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {/* Freelancer Field Engineers — their own row with TA freelancers as supporting */}
                    {freelancerEngineers.map((fe, feIdx) => {
                        const feActs = fe.activities;
                        const isActiveNow = feActs.some(a => ['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status));
                        // Find TA freelancers on the same activities
                        const taFreelancers = feActs.flatMap(a => ((a as any).freelancers || []).filter((fl: any) => fl.role !== 'FIELD_ENGINEER'));
                        const uniqueTAs = Array.from(new Map(taFreelancers.map((t: any) => [t.name, t])).values());
                        
                        return (
                            <div key={`fe-fl-${feIdx}`} className={`${tvMode ? "h-32" : "h-28"} border-b border-slate-200 p-3 flex flex-col justify-center bg-orange-50/20`}>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="relative">
                                        <div className="w-9 h-9 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-700 text-xs font-bold">
                                            {fe.name.split(' ').map(w => w[0]).join('').slice(0,2)}
                                        </div>
                                        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${isActiveNow ? 'bg-blue-500 animate-pulse' : 'bg-orange-400'}`} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800 text-xs truncate">{fe.name}</span>
                                            <span className="text-[8px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">FREELANCER</span>
                                            {isActiveNow && <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">LIVE</span>}
                                        </div>
                                        <div className="text-[10px] text-slate-500">{feActs.length} job{feActs.length > 1 ? 's' : ''} today</div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1 mb-1">
                                    {uniqueTAs.map((ta: any, i: number) => (
                                        <span key={`fta-${i}`} className="px-1.5 py-0.5 bg-teal-50 text-[9px] font-medium text-teal-700 rounded flex items-center gap-1 border border-teal-200">
                                            <Users size={8} className="text-teal-400" /> {ta.name} <span className="text-[7px] opacity-60">TA</span>
                                        </span>
                                    ))}
                                    {uniqueTAs.length === 0 && <span className="text-[9px] text-slate-300 italic">Solo</span>}
                                </div>
                                <div className="h-1 w-full bg-orange-100 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.min(100, (feActs.length / 3) * 100)}%` }} />
                                </div>
                            </div>
                        );
                    })}
                    {/* Freelancer-only Jobs Row (no internal engineer assigned) */}
                    {unassignedFreelancerActs.length > 0 && (
                        <div className={`${tvMode ? "h-32" : "h-28"} border-b border-slate-200 p-3 flex flex-col justify-center bg-amber-50/30`}>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 text-[10px] font-bold">FL</div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-amber-800 text-xs">Freelancer Jobs</span>
                                        <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">{unassignedFreelancerActs.length}</span>
                                    </div>
                                    <div className="text-[10px] text-amber-600">No internal engineer assigned</div>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-1">
                                {unassignedFreelancerActs.flatMap(a => (a as any).freelancers || []).map((fl: any, i: number) => (
                                    <span key={`ufl-${i}`} className="px-1.5 py-0.5 bg-amber-100 text-[9px] font-medium text-amber-700 rounded flex items-center gap-1 border border-amber-200">
                                        {fl.name} <span className="text-[7px] opacity-60">FL</span>
                                    </span>
                                ))}
                            </div>
                            <div className="h-1 w-full bg-amber-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-amber-400" style={{ width: '100%' }} />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* COLUMN 2: CENTER TIMELINE (Horizontal Scroll) */}
            <div className="flex flex-col overflow-hidden relative min-w-0">
                {/* Header Scroller */}
                <div 
                    ref={headerScrollRef}
                    className="h-10 border-b border-slate-200 bg-white overflow-x-auto overflow-y-hidden no-scrollbar shrink-0"
                    onScroll={handleHeaderScroll}
                >
                    <div className="relative h-full" style={{ width: `${totalGridWidth}px` }}>
                        {timeMarkers.map(hour => {
                            if (hour > TIMELINE_END) return null; // Don't render marker after end
                            const offset = (hour - TIMELINE_START) * zoomLevel;
                            const displayHour = hour === 24 ? 0 : hour;
                            const hh = String(displayHour).padStart(2, '0');
                            const showHalf = zoomLevel >= 180;
                            
                            return (
                                <div 
                                    key={hour} 
                                    className="absolute top-0 bottom-0 border-l border-slate-200 pl-1 flex items-center text-[10px] font-mono font-medium tracking-wide text-slate-500 select-none" 
                                    style={{ left: `${offset}px`, width: `${zoomLevel}px` }}
                                >
                                    <span>{hh}:00</span>
                                    {hour < TIMELINE_END && showHalf && (
                                        <span className="absolute left-1/2 text-slate-300 font-normal">
                                            {hh}:30
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                        {/* Header Red Line (NOW) */}
                        {nowX >= 0 && nowX <= totalGridWidth && (
                            <div 
                                className="absolute top-0 bottom-0 z-50 pointer-events-none" 
                                style={{ left: `${nowX}px` }}
                            >
                                <div className="h-full border-l-2 border-red-500 relative">
                                    <div className="absolute -top-0 -left-[5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-red-500" />
                                    <div className="absolute -top-6 left-2 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap opacity-90 shadow-sm">
                                        NOW - {currentTime.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Body Scroller (Main Driver) */}
                <div 
                    ref={bodyScrollRef}
                    className="relative flex-1 overflow-x-auto overflow-y-auto bg-slate-50/50"
                    onScroll={handleBodyScroll}
                >
                    <div className="relative" style={{ width: `${totalGridWidth}px` }}>
                        {/* Grid Background */}
                        <div className="absolute inset-0 flex pointer-events-none z-0 h-full">
                            {timeMarkers.map(hour => {
                                if (hour > TIMELINE_END) return null;
                                const showHalf = zoomLevel >= 180;
                                return (
                                  <div
                                    key={hour}
                                    className={`relative h-full flex-shrink-0 border-r border-slate-200/80 ${hour % 2 === 0 ? "bg-slate-50/30" : ""}`}
                                    style={{ width: `${zoomLevel}px` }}
                                  >
                                    {hour < TIMELINE_END && showHalf && (
                                        <div className="absolute left-1/2 top-0 bottom-0 border-r border-slate-100 pointer-events-none" />
                                    )}
                                  </div>
                                );
                            })}
                        </div>

                        {/* Body Red Line (NOW) - Standard Absolute Positioning */}
                        {nowX >= 0 && nowX <= totalGridWidth && (
                            <div 
                                className="absolute top-0 bottom-0 z-40 pointer-events-none border-l-2 border-red-500"
                                style={{ left: `${nowX}px` }}
                            >
                                {/* Triangle Indicator */}
                                <div className="absolute -top-[5px] -left-[5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-red-500" />
                            </div>
                        )}

                        {/* Rows */}
                        {operationsStaff.map(tech => {
                            // Unified timeline items (both Activities and Tickets)
                            // 1. Normalize Activities — use primaryEngineerId for execution, leadTechId for planning
                            const techActivities = activities.filter(a => {
                                const isExecutionPhase = ['IN_PROGRESS','DONE','ON_MY_WAY','ARRIVED','CARRY_FORWARD'].includes(a.status);
                                const hasPrimaryEngineer = !!(a as any).primaryEngineerId;
                                const hasFreelancers = ((a as any).freelancers || []).length > 0;
                                const hasFEFreelancer = ((a as any).freelancers || []).some((fl: any) => fl.role === 'FIELD_ENGINEER');
                                
                                // Check if this tech is involved in ANY capacity
                                const isPrimary = hasPrimaryEngineer && (a as any).primaryEngineerId === tech.id;
                                const isLead = a.leadTechId === tech.id;
                                const isSupporting = ((a as any).supportingEngineerIds || []).includes(tech.id);
                                const isTA = (a.assistantTechIds || []).includes(tech.id);
                                
                                // If activity has freelancers and this engineer is only the leadTechId
                                // (not explicitly primary/supporting/TA), skip — it belongs to freelancer row
                                if (hasFreelancers && isLead && !isPrimary && !isSupporting && !isTA) {
                                    return false;
                                }
                                
                                const isInvolved = isPrimary || isLead || isSupporting || isTA;

                                if (!isInvolved) return false;

                                if (isExecutionPhase) {
                                    if (a.status !== 'DONE' && a.status !== 'CARRY_FORWARD') return true;
                                    // DONE/CARRY_FORWARD: show if completed today
                                    const d = new Date((a as any).completedAt || a.updatedAt || a.createdAt);
                                    return d.toDateString() === new Date().toDateString();
                                } else {
                                    if (a.status === 'CANCELLED') return false;
                                    const d = new Date(a.plannedDate || a.createdAt);
                                    return d.toDateString() === new Date().toDateString();
                                }
                            }).map(a => {
                                const s = normalizeStatus(a.status);
                                const isExecution = ['IN_PROGRESS','DONE','ON_MY_WAY','ARRIVED','CARRY_FORWARD'].includes(a.status);
                                const actualStart = (a as any).startedAt;
                                const actualEnd = (a as any).completedAt;
                                const supportCount = ((a as any).supportingEngineerIds || []).length + ((a as any).freelancers || []).length;

                                return {
                                    id: a.id,
                                    reference: a.reference,
                                    type: 'activity',
                                    status: s,
                                    priority: a.priority,
                                    isPlanned: !isExecution, // Used for styling (faded for planned)
                                    supportCount,
                                    // Timeline start position
                                    plannedDate: (() => {
                                        if (actualStart && (s === 'DONE' || s === 'IN_PROGRESS' || s === 'ON_MY_WAY' || s === 'ARRIVED')) {
                                            const start = new Date(actualStart);
                                            const now = new Date();
                                            // If started on a previous day, show bar from 08:00 today
                                            if (start.toDateString() !== now.toDateString()) {
                                                const today8am = new Date(now);
                                                today8am.setHours(8, 0, 0, 0);
                                                return today8am.toISOString();
                                            }
                                            return actualStart;
                                        }
                                        if (s === 'IN_PROGRESS' && a.updatedAt) return a.updatedAt;
                                        return a.plannedDate || a.createdAt || new Date().toISOString();
                                    })(),
                                    // Duration
                                    durationHours: (() => {
                                        if (s === 'DONE' && actualStart && actualEnd) {
                                            const start = new Date(actualStart);
                                            const end = new Date(actualEnd);
                                            const today = new Date();
                                            const endHour = end.getHours() + end.getMinutes() / 60;
                                            const startHour = start.getHours() + start.getMinutes() / 60;
                                            // Both same day — simple diff
                                            if (start.toDateString() === end.toDateString()) {
                                                return Math.max(0.25, endHour - startHour);
                                            }
                                            // Started on previous day, completed today — bar from 08:00 to completedAt
                                            if (end.toDateString() === today.toDateString()) {
                                                return Math.max(0.25, endHour - 8);
                                            }
                                            // Both on previous days — use original hours
                                            return Math.max(0.25, endHour - startHour > 0 ? endHour - startHour : endHour - 8);
                                        }
                                        if ((s === 'IN_PROGRESS' || s === 'ON_MY_WAY' || s === 'ARRIVED') && actualStart) {
                                            // Bar must stop at current time (the red NOW line)
                                            const now = new Date();
                                            const start = new Date(actualStart);
                                            const nowHour = now.getHours() + now.getMinutes() / 60;
                                            const startHour = start.getHours() + start.getMinutes() / 60;
                                            // If started today, duration = now - start in hours-of-day
                                            // If started on a previous day, cap at now hour - timeline start
                                            if (start.toDateString() === now.toDateString()) {
                                                return Math.max(0.25, nowHour - startHour);
                                            }
                                            // Started on a previous day — show bar from 08:00 to now
                                            return Math.max(0.25, nowHour - 8);
                                        }
                                        return a.durationHours || 2;
                                    })(),
                                    description: a.description || a.type,
                                    escalationLevel: a.escalationLevel || 0,
                                    clientLine: customers.find(c => c.id === a.customerId)?.name || a.houseNumber || ''
                                };
                            });

                            // 2. Normalize Tickets (only if assigned and IN_PROGRESS/OPEN)
                            const techTickets = tickets
                                .filter(t => {
                                if (t.assignedTechId !== tech.id) return false;
                                const activeStatuses = ['IN_PROGRESS','ASSIGNED','ON_MY_WAY','ARRIVED'];
                                if (activeStatuses.includes(normalizeStatus(t.status))) return true;
                                if (normalizeStatus(t.status) === 'RESOLVED') {
                                    const d = new Date((t as any).completedAt || t.updatedAt || t.createdAt);
                                    return d.toDateString() === new Date().toDateString();
                                }
                                return false;
                            })
                                .map(t => {
                                    const tStatus = normalizeStatus(t.status);
                                    const tStarted = (t as any).startedAt;
                                    const tCompleted = (t as any).completedAt;
                                    const tPlannedDate = tStarted || t.appointmentTime || (() => {
                                        const d = new Date();
                                        d.setMinutes(0, 0, 0);
                                        return d.toISOString();
                                    })();
                                    const tDuration = (() => {
                                        if (tStatus === 'RESOLVED' && tCompleted && tStarted) {
                                            const start = new Date(tStarted);
                                            const end = new Date(tCompleted);
                                            const today = new Date();
                                            const endHour = end.getHours() + end.getMinutes() / 60;
                                            const startHour = start.getHours() + start.getMinutes() / 60;
                                            if (start.toDateString() === end.toDateString()) return Math.max(0.25, endHour - startHour);
                                            if (end.toDateString() === today.toDateString()) return Math.max(0.25, endHour - 8);
                                            return Math.max(0.25, endHour - startHour > 0 ? endHour - startHour : 2);
                                        }
                                        if (tStatus === 'IN_PROGRESS' && tStarted) {
                                            const now = new Date();
                                            const start = new Date(tStarted);
                                            const nowHour = now.getHours() + now.getMinutes() / 60;
                                            const startHour = start.getHours() + start.getMinutes() / 60;
                                            if (start.toDateString() === now.toDateString()) {
                                                return Math.max(0.25, nowHour - startHour);
                                            }
                                            return Math.max(0.25, nowHour - 8);
                                        }
                                        return 2;
                                    })();
                                    return {
                                        id: t.id,
                                        reference: t.id,
                                        type: 'ticket',
                                        status: tStatus,
                                        priority: t.priority,
                                        isPlanned: false,
                                        supportCount: 0,
                                        plannedDate: tPlannedDate,
                                        durationHours: tDuration,
                                        description: t.category + (t.type ? ' · ' + t.type : ''),
                                        escalationLevel: 0,
                                        startedAt: tStarted,
                                        completedAt: tCompleted,
                                        clientLine: t.customerName || '',
                                    };
                                });

                            const timelineItems = [...techActivities, ...techTickets];

                            return (
                                <div key={tech.id} className={`${tvMode ? "h-32" : "h-28"} border-b border-slate-200 relative w-full hover:bg-slate-100/50 transition-colors`}>
                                    {timelineItems.map((item: any) => {
                                        const style = getPositionStyle(item.plannedDate, item.durationHours);
                                        const isTicket = item.type === 'ticket';
                                        const isPlanned = item.isPlanned;
                                        
                                        return (
                                            <div 
                                                key={item.id}
                                                className={`absolute top-3 bottom-3 rounded border shadow-sm p-1.5 flex flex-col justify-center cursor-pointer hover:z-20 hover:shadow-md hover:ring-2 ring-opacity-50 transition-all z-20 overflow-hidden ${
                                                    isTicket && item.status === 'RESOLVED'    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 opacity-80' :
                                                    isTicket && item.status === 'IN_PROGRESS'  ? 'bg-amber-50 border-amber-300 text-amber-900 ring-amber-400' :
                                                    isTicket && item.status === 'ON_MY_WAY'   ? 'bg-cyan-50 border-cyan-300 text-cyan-900 ring-cyan-400' :
                                                    isTicket && item.status === 'ARRIVED'     ? 'bg-indigo-50 border-indigo-300 text-indigo-900 ring-indigo-400' :
                                                    isTicket && item.status === 'ASSIGNED'    ? 'bg-purple-50 border-purple-200 text-purple-900 ring-purple-400' :
                                                    isTicket                                  ? 'bg-slate-50 border-slate-200 text-slate-600' :
                                                    item.status === 'DONE'        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 opacity-80' :
                                                    item.status === 'CARRY_FORWARD' ? 'bg-orange-50 border-orange-300 text-orange-800 opacity-90' :
                                                    item.status === 'IN_PROGRESS' ? 'bg-blue-50 border-blue-200 text-blue-900 ring-blue-400' :
                                                    item.status === 'ON_MY_WAY'   ? 'bg-cyan-50 border-cyan-200 text-cyan-800 ring-cyan-400' :
                                                    item.status === 'ARRIVED'     ? 'bg-indigo-50 border-indigo-200 text-indigo-800 ring-indigo-400' :
                                                    item.escalationLevel > 0      ? 'bg-red-50 border-red-200 text-red-900 ring-red-400' :
                                                    isPlanned                     ? 'bg-slate-50 border-dashed border-slate-300 text-slate-400 opacity-60' :
                                                    'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                                                }`}
                                                style={style}
                                                onClick={() => handleItemClick(isTicket ? 'ticket' : 'activity', item.id)}
                                                title={`${item.description} - ${new Date(item.plannedDate).toLocaleTimeString()}`}
                                            >
                                                <div className="flex items-center gap-1 font-bold text-[11px] leading-snug truncate">
                                                    {isTicket && <TicketIcon size={11} />}
                                                    {item.reference}
                                                    {item.supportCount > 0 && (
                                                        <span className="ml-auto text-[9px] font-bold bg-blue-100 text-blue-600 px-1 rounded shrink-0">+{item.supportCount}</span>
                                                    )}
                                                    {isPlanned && (
                                                        <span className="ml-auto text-[9px] font-medium text-slate-400 italic shrink-0">planned</span>
                                                    )}
                                                </div>
                                                {item.clientLine && (
                                                    <div className="text-[9px] font-medium truncate opacity-90 leading-snug mt-0.5">{item.clientLine}</div>
                                                )}
                                                <div className="text-[10px] truncate opacity-80 leading-snug mt-0.5">
                                                    {item.description}
                                                </div>
                                                {(item.status === 'IN_PROGRESS' || item.status === 'ON_MY_WAY' || item.status === 'ARRIVED') && !isPlanned && (
                                                    <div className="mt-1 h-0.5 w-full bg-blue-200 rounded-full overflow-hidden">
                                                        <div className="h-full bg-blue-500 animate-pulse w-2/3"></div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            );
                        })}
                        {/* Freelancer Field Engineer timeline rows */}
                        {freelancerEngineers.map((fe, feIdx) => (
                            <div key={`fe-tl-${feIdx}`} className={`${tvMode ? "h-32" : "h-28"} border-b border-slate-200 relative w-full bg-orange-50/10`}>
                                {fe.activities.map(a => {
                                    const s = normalizeStatus(a.status);
                                    const actualStart = (a as any).startedAt;
                                    const actualEnd = (a as any).completedAt;
                                    const startTime = (() => {
                                        if (actualStart && ['DONE','IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status)) return actualStart;
                                        return a.plannedDate || a.createdAt || new Date().toISOString();
                                    })();
                                    const duration = (() => {
                                        if (s === 'DONE' && actualStart && actualEnd) return Math.max(0.25, (new Date(actualEnd).getTime() - new Date(actualStart).getTime()) / 3600000);
                                        if (['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status) && actualStart) {
                                            const now = new Date();
                                            const start = new Date(actualStart);
                                            const nowHour = now.getHours() + now.getMinutes() / 60;
                                            const startHour = start.getHours() + start.getMinutes() / 60;
                                            if (start.toDateString() === now.toDateString()) return Math.max(0.25, nowHour - startHour);
                                            return Math.max(0.25, nowHour - 8);
                                        }
                                        return a.durationHours || 2;
                                    })();
                                    const style = getPositionStyle(startTime, duration);
                                    const custName = customers.find((c: any) => c.id === a.customerId)?.name || '';
                                    return (
                                        <div key={a.id} className={`absolute top-3 bottom-3 rounded border shadow-sm p-1.5 flex flex-col justify-center cursor-pointer hover:z-20 hover:shadow-md transition-all z-10 overflow-hidden ${
                                            s === 'DONE' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 opacity-80' :
                                            s === 'IN_PROGRESS' ? 'bg-orange-50 border-orange-300 text-orange-900' :
                                            s === 'ON_MY_WAY' ? 'bg-cyan-50 border-cyan-200 text-cyan-800' :
                                            'bg-orange-50 border-dashed border-orange-300 text-orange-700 opacity-70'
                                        }`} style={style} onClick={() => handleItemClick('activity', a.id)}>
                                            <span className="text-[10px] font-bold truncate leading-snug">{a.reference || a.id}</span>
                                            <span className="text-[9px] truncate opacity-80 leading-snug mt-0.5">{custName}</span>
                                            <span className="text-[8px] truncate opacity-60 leading-snug">{a.type}{a.serviceCategory ? ` · ${a.serviceCategory}` : ''}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                        {/* Freelancer-only timeline row */}
                        {unassignedFreelancerActs.length > 0 && (
                            <div className={`${tvMode ? "h-32" : "h-28"} border-b border-slate-200 relative w-full bg-amber-50/20`}>
                                {unassignedFreelancerActs.map(a => {
                                    const s = normalizeStatus(a.status);
                                    const actualStart = (a as any).startedAt;
                                    const actualEnd = (a as any).completedAt;
                                    const flCount = ((a as any).freelancers || []).length;
                                    
                                    const startTime = (() => {
                                        if (actualStart && ['DONE','IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status)) return actualStart;
                                        if (s === 'IN_PROGRESS' && a.updatedAt) return a.updatedAt;
                                        return a.plannedDate || a.createdAt || new Date().toISOString();
                                    })();
                                    const duration = (() => {
                                        if (s === 'DONE' && actualStart && actualEnd) return Math.max(0.25, (new Date(actualEnd).getTime() - new Date(actualStart).getTime()) / 3600000);
                                        if (['IN_PROGRESS','ON_MY_WAY','ARRIVED'].includes(a.status) && actualStart) return Math.max(0.25, (Date.now() - new Date(actualStart).getTime()) / 3600000);
                                        return a.durationHours || 2;
                                    })();
                                    
                                    const style = getPositionStyle(startTime, duration);
                                    return (
                                        <div
                                            key={a.id}
                                            className={`absolute top-3 bottom-3 rounded border shadow-sm p-1.5 flex flex-col justify-center cursor-pointer hover:z-20 hover:shadow-md hover:ring-2 ring-opacity-50 transition-all z-20 overflow-hidden ${
                                                s === 'DONE' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 opacity-80' :
                                                s === 'IN_PROGRESS' ? 'bg-amber-50 border-amber-300 text-amber-900 ring-amber-400' :
                                                s === 'ON_MY_WAY' ? 'bg-cyan-50 border-cyan-200 text-cyan-800 ring-cyan-400' :
                                                'bg-amber-50 border-dashed border-amber-300 text-amber-700 opacity-70'
                                            }`}
                                            style={style}
                                            onClick={() => handleItemClick('activity', a.id)}
                                            title={`${a.description} — Freelancer: ${((a as any).freelancers || []).map((f: any) => f.name).join(', ')}`}
                                        >
                                            <div className="flex items-center gap-1 font-bold text-[11px] leading-snug truncate">
                                                {a.reference}
                                                {flCount > 0 && (
                                                    <span className="ml-auto text-[9px] font-bold bg-amber-200 text-amber-700 px-1 rounded shrink-0">FL +{flCount}</span>
                                                )}
                                            </div>
                                            <div className="text-[10px] truncate opacity-80 leading-snug mt-0.5">
                                                {a.description || a.type}
                                            </div>
                                            {(s === 'IN_PROGRESS' || s === 'ON_MY_WAY') && (
                                                <div className="mt-1 h-0.5 w-full bg-amber-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-amber-500 animate-pulse w-2/3"></div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* COLUMN 3: RIGHT FEED (Fixed Width) */}
            <div className="flex flex-col border-l border-slate-200 bg-white z-20 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.02)]">
                <div className="h-10 border-b border-slate-100 bg-slate-50 flex items-center px-3 justify-between shrink-0">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <History size={12} /> Live Feed
                    </span>
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                </div>
                <div className="flex-1 overflow-y-auto p-0 divide-y divide-slate-100">
                    {liveFeed.map((item, i) => (
                        <div 
                            key={`${item.id}-${i}`} 
                            onClick={() => handleItemClick(item.type, item.id)}
                            className="p-3 hover:bg-black/[0.03] transition-colors group cursor-pointer relative"
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded tabular-nums">{item.time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                    normalizeStatus(item.status) === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                                    item.status === 'DONE' || item.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-700' :
                                    item.status === 'CARRY_FORWARD' ? 'bg-orange-100 text-orange-700' :
                                    item.status === 'NEW' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'
                                }`}>{item.status.replace('_', ' ')}</span>
                            </div>
                            <div className="flex items-start gap-2 pr-4">
                                <div className={`mt-0.5 p-1 rounded-full ${item.type === 'ticket' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                                    {item.type === 'ticket' ? <TicketIcon size={10} /> : <ActivityIcon size={10} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold text-slate-900 leading-snug">{item.refLine}</p>
                                    <p className="text-[10px] text-slate-600 mt-0.5 font-semibold truncate">{item.clientLine}</p>
                                    <p className="text-[9px] text-slate-400 mt-0.5 truncate">{item.descLine}</p>
                                </div>
                            </div>
                            <ChevronRight size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-900/45 group-hover:text-slate-900/75 transition-colors" />
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* Details Drawer (Overlay) */}
        {selectedItem && (
             <div className="absolute top-0 right-0 h-full w-[350px] md:w-[420px] bg-white shadow-2xl border-l border-slate-200 z-50 animate-in slide-in-from-right duration-300 flex flex-col">
                 <div className="p-4 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                     <div>
                         <div className="flex items-center gap-2 mb-1">
                             <span className="text-xs font-mono text-slate-400 bg-white border px-1 rounded">
                                {selectedItem.type === 'activity' ? (selectedItem.data as Activity).reference : (selectedItem.data as Ticket).id}
                             </span>
                             <span className="text-[10px] font-bold uppercase text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                {selectedItem.data.status.replace('_', ' ')}
                             </span>
                         </div>
                         <h3 className="font-bold text-slate-900 text-sm leading-tight uppercase tracking-tight">
                             {selectedItem.type === 'activity' ? (selectedItem.data as Activity).type : (selectedItem.data as Ticket).category}
                         </h3>
                     </div>
                     <button onClick={() => setSelectedItem(null)} className="p-1 hover:bg-slate-200 rounded transition-colors"><X size={16} className="text-slate-500"/></button>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-4 space-y-4">
                     {/* Customer Info Section */}
                     <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm space-y-2">
                         <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase border-b border-slate-100 pb-2 mb-2">
                             <User size={12}/> Customer
                         </div>
                         <div className="flex justify-between items-start">
                             <div>
                                 <div className="text-sm font-bold text-slate-800">
                                     {selectedItem.type === 'activity' ? 
                                        (customers?.find(c => c.id === (selectedItem.data as Activity).customerId)?.name || 'Unknown') : 
                                        (selectedItem.data as Ticket).customerName}
                                 </div>
                                 <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                                     <Phone size={10} /> 
                                     {selectedItem.type === 'ticket' ? 
                                        ((() => {
                                            const t = selectedItem.data as Ticket;
                                            const phone = t.phoneNumber;
                                            if (phone && phone.length > 8 && /^\+?\d/.test(phone)) return phone;
                                            const c = customers?.find(cx => cx.id === t.customerId);
                                            return c?.phone || phone || 'N/A';
                                        })()) : 
                                        (customers?.find(c => c.id === (selectedItem.data as Activity).customerId)?.phone || 'Contact on file')}
                                 </div>
                             </div>
                         </div>
                     </div>

                     {/* Location Section */}
                     <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 space-y-2">
                         <h4 className="text-[10px] font-bold text-blue-800 uppercase flex items-center gap-1">
                             <MapPin size={10} /> Location
                         </h4>
                         <div className="text-xs text-slate-700 font-medium">
                            {(() => {
                                const d = selectedItem.data as any;
                                if (selectedItem.type === 'activity') {
                                    const cust = customers.find(c=>c.id===d.customerId);
                                    const parts: string[] = [];
                                    if (d.houseNumber) parts.push(d.houseNumber);
                                    if (cust?.buildingNumber) parts.push(`Bldg: ${cust.buildingNumber}`);
                                    if (cust?.name) parts.push(cust.name);
                                    if (parts.length === 0) {
                                        const site = sites.find(s=>s.id===d.siteId);
                                        parts.push(site?.name || 'Unknown Location');
                                    }
                                    return parts.join(' · ');
                                }
                                return d.houseNumber || 'Location Provided';
                            })()}
                         </div>
                         {selectedItem.data.locationUrl && (
                             <a href={selectedItem.data.locationUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline">
                                 <ExternalLink size={10} /> Open Map
                             </a>
                         )}
                     </div>

                     {/* Scope / Service Info */}
                     {selectedItem.type === 'activity' && (
                         <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 space-y-2">
                             <h4 className="text-[10px] font-bold text-purple-800 uppercase flex items-center gap-1">
                                 <Briefcase size={10} /> Scope
                             </h4>
                             <div className="space-y-1.5">
                                 <div className="flex justify-between text-xs">
                                     <span className="text-slate-400">Type</span>
                                     <span className="font-semibold text-slate-700">{(selectedItem.data as Activity).type}</span>
                                 </div>
                                 {(selectedItem.data as any).serviceCategory && (
                                     <div className="flex justify-between text-xs">
                                         <span className="text-slate-400">Service Category</span>
                                         <span className="font-medium text-purple-700">{(selectedItem.data as any).serviceCategory}</span>
                                     </div>
                                 )}
                                 <div className="flex justify-between text-xs">
                                     <span className="text-slate-400">Priority</span>
                                     <span className={`font-bold ${(selectedItem.data as Activity).priority === 'URGENT' ? 'text-red-600' : (selectedItem.data as Activity).priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>
                                         {(selectedItem.data as Activity).priority}
                                     </span>
                                 </div>
                                 <div className="flex justify-between text-xs">
                                     <span className="text-slate-400">Planned Duration</span>
                                     <span className="text-slate-700">{(selectedItem.data as Activity).durationHours}h</span>
                                 </div>
                                 {(selectedItem.data as any).odooLink && (
                                     <div className="flex justify-between text-xs">
                                         <span className="text-slate-400">Odoo Ref</span>
                                         <a href={(selectedItem.data as any).odooLink} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline truncate max-w-[60%]">{(selectedItem.data as any).odooLink}</a>
                                     </div>
                                 )}
                             </div>
                         </div>
                     )}
                     {selectedItem.type === 'ticket' && (
                         <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 space-y-2">
                             <h4 className="text-[10px] font-bold text-purple-800 uppercase flex items-center gap-1">
                                 <Briefcase size={10} /> Ticket Info
                             </h4>
                             <div className="space-y-1.5">
                                 <div className="flex justify-between text-xs">
                                     <span className="text-slate-400">Category</span>
                                     <span className="font-semibold text-slate-700">{(selectedItem.data as Ticket).category}</span>
                                 </div>
                                 <div className="flex justify-between text-xs">
                                     <span className="text-slate-400">Type</span>
                                     <span className="font-medium text-slate-700">{(selectedItem.data as Ticket).type}</span>
                                 </div>
                                 <div className="flex justify-between text-xs">
                                     <span className="text-slate-400">Priority</span>
                                     <span className={`font-bold ${(selectedItem.data as Ticket).priority === 'URGENT' ? 'text-red-600' : (selectedItem.data as Ticket).priority === 'HIGH' ? 'text-orange-500' : 'text-slate-600'}`}>
                                         {(selectedItem.data as Ticket).priority}
                                     </span>
                                 </div>
                             </div>
                         </div>
                     )}

                     {/* Time & Schedule */}
                     <div>
                         <label className="text-[10px] font-bold text-slate-400 uppercase">Timing</label>
                         <div className="flex items-center gap-2 text-xs font-mono text-slate-700 mt-1 bg-slate-50 p-2 rounded border border-slate-100">
                             <Clock size={12} className="text-slate-400" />
                             {(() => {
                                 const d = selectedItem.data as any;
                                 // Use ONLY real timestamps — never fall back to planned/appointment time
                                 const startTime = d.startedAt || null;
                                 const endTime = d.completedAt || null;
                                 const status = selectedItem.type === 'activity' ? (d as Activity).status : normalizeStatus(d.status);
                                 const isDone = status === 'DONE' || status === 'RESOLVED';
                                 const isActive = status === 'IN_PROGRESS';
                                 if (startTime) {
                                     return (
                                         <>
                                             <span className="text-emerald-700 font-semibold">{new Date(startTime).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}</span>
                                             <ArrowRight size={10} className="text-slate-300"/>
                                             {isDone && endTime ? (
                                                 <span className="text-slate-600 font-semibold">{new Date(endTime).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}</span>
                                             ) : isActive ? (
                                                 <span className="text-amber-600 font-semibold animate-pulse">Live ({Math.round((Date.now() - new Date(startTime).getTime()) / 60000)}m)</span>
                                             ) : (
                                                 <span className="text-slate-400">—</span>
                                             )}
                                         </>
                                     );
                                 }
                                 // No real startedAt — show planned/appointment info clearly labelled
                                 return (
                                     <span className="text-slate-400">
                                         {selectedItem.type === 'ticket'
                                             ? d.appointmentTime
                                                 ? `Appt: ${new Date(d.appointmentTime).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}`
                                                 : 'Not started'
                                             : d.plannedDate
                                                 ? `Planned: ${new Date((d as Activity).plannedDate).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}`
                                                 : 'Not started'}
                                     </span>
                                 );
                             })()}
                         </div>
                         <div className="text-[10px] text-slate-400 mt-1 flex justify-between">
                             {(selectedItem.data as any).startedAt && (
                                 <span>Started: {new Date((selectedItem.data as any).startedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                             )}
                             {(selectedItem.data as any).completedAt && (
                                 <span>Completed: {new Date((selectedItem.data as any).completedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                             )}
                             {!(selectedItem.data as any).startedAt && selectedItem.type === 'ticket' && (selectedItem.data as Ticket).updatedAt && (
                                 <span className="ml-auto">Last Update: {new Date((selectedItem.data as Ticket).updatedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                             )}
                         </div>
                     </div>

                     {/* Assigned Resources — Full Team */}
                     <div>
                         <label className="text-[10px] font-bold text-slate-400 uppercase">Assigned Team</label>
                         <div className="mt-2 space-y-2">
                             {/* Primary / Assigned Tech */}
                             <div className="flex items-center gap-2">
                                 <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-[10px] font-bold text-purple-600">P</div>
                                 <div className="flex flex-col">
                                     <span className="text-xs font-medium text-slate-700">
                                         {selectedItem.type === 'activity' ? 
                                            (technicians.find(t => t.id === ((selectedItem.data as any).primaryEngineerId || (selectedItem.data as Activity).leadTechId))?.name || 'Unassigned') : 
                                            (technicians.find(t => t.id === (selectedItem.data as Ticket).assignedTechId)?.name || 'Unassigned')}
                                     </span>
                                     <span className="text-[9px] text-slate-400">
                                         {selectedItem.type === 'activity' 
                                             ? ((selectedItem.data as any).primaryEngineerId ? 'Primary Engineer' : 'Lead Engineer (Planned)')
                                             : 'Assigned Technician'}
                                     </span>
                                 </div>
                             </div>
                             {/* Show planned lead if different from primary */}
                             {selectedItem.type === 'activity' && (selectedItem.data as any).primaryEngineerId && (selectedItem.data as any).primaryEngineerId !== (selectedItem.data as Activity).leadTechId && (
                                 <div className="flex items-center gap-2">
                                     <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600">L</div>
                                     <div className="flex flex-col">
                                         <span className="text-xs font-medium text-slate-600">{technicians.find(t => t.id === (selectedItem.data as Activity).leadTechId)?.name || '—'}</span>
                                         <span className="text-[9px] text-slate-400">Planned Lead</span>
                                     </div>
                                 </div>
                             )}
                             {/* Sales Lead */}
                             {selectedItem.type === 'activity' && (selectedItem.data as any).salesLeadId && (
                                 <div className="flex items-center gap-2">
                                     <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600">S</div>
                                     <div className="flex flex-col">
                                         <span className="text-xs font-medium text-indigo-700">{technicians.find(t => t.id === (selectedItem.data as any).salesLeadId)?.name || '—'}</span>
                                         <span className="text-[9px] text-slate-400">Sales Lead</span>
                                     </div>
                                 </div>
                             )}
                             {/* Technical Associates / Supporting Engineers */}
                             {selectedItem.type === 'activity' && (() => {
                                 const d = selectedItem.data as any;
                                 const taIds = d.assistantTechIds || [];
                                 const supportIds = d.supportingEngineerIds || [];
                                 const allIds = Array.from(new Set([...taIds, ...supportIds]));
                                 if (allIds.length === 0) return null;
                                 return allIds.map((sid: string) => {
                                     const member = technicians.find(t => t.id === sid);
                                     if (!member) return null;
                                     const isExec = supportIds.includes(sid);
                                     return (
                                         <div key={sid} className="flex items-center gap-2">
                                             <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${isExec ? 'bg-blue-100 text-blue-600' : 'bg-teal-100 text-teal-600'}`}>
                                                 {isExec ? 'SE' : 'TA'}
                                             </div>
                                             <div className="flex flex-col">
                                                 <span className="text-xs font-medium text-slate-700">{member.name}</span>
                                                 <span className="text-[9px] text-slate-400">{isExec ? 'Supporting Engineer' : 'Technical Associate'}</span>
                                             </div>
                                         </div>
                                     );
                                 });
                             })()}
                             {/* Freelancers */}
                             {selectedItem.type === 'activity' && ((selectedItem.data as any).freelancers || []).length > 0 && (
                                 <>
                                     {((selectedItem.data as any).freelancers || []).map((fl: any, i: number) => (
                                         <div key={`fl-${i}`} className="flex items-center gap-2">
                                             <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-[10px] font-bold text-amber-700">FL</div>
                                             <div className="flex flex-col">
                                                 <span className="text-xs font-medium text-amber-800">{fl.name}</span>
                                                 <div className="flex items-center gap-2">
                                                     <span className="text-[9px] text-amber-600">Freelancer{fl.role ? ` · ${fl.role === 'FIELD_ENGINEER' ? 'FE' : 'TA'}` : ''}</span>
                                                     {fl.phone && <span className="text-[9px] text-slate-400">{fl.phone}</span>}
                                                 </div>
                                             </div>
                                         </div>
                                     ))}
                                 </>
                             )}
                         </div>
                     </div>

                     {/* Description */}
                     <div>
                         <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><FileText size={10}/> Description</label>
                         <p className="text-xs text-slate-600 mt-1 leading-relaxed bg-slate-50 p-2 rounded border border-slate-100 whitespace-pre-wrap">
                             {selectedItem.type === 'activity' ? (selectedItem.data as Activity).description : ((selectedItem.data as any).messages?.find((m: any) => m.sender === "CLIENT")?.content || (selectedItem.data as any).ai_summary || (selectedItem.data as any).category || "No description")}
                         </p>
                     </div>

                     {/* Remarks / Notes */}
                     {(() => {
                         const d = selectedItem.data as any;
                         const remarks = selectedItem.type === 'activity' ? d.remarks : d.notes;
                         const completionNote = d.completionNote;
                         const assignmentNote = d.assignmentNote;
                         const carryForwardNote = d.carryForwardNote;
                         const cancellationReason = d.cancellationReason;
                         const hasAny = remarks || completionNote || assignmentNote || carryForwardNote || cancellationReason;
                         if (!hasAny) return null;
                         return (
                             <div className="space-y-2">
                                 <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><MessageSquare size={10}/> Notes & Remarks</label>
                                 {remarks && (
                                     <div className="bg-slate-50 p-2 rounded border border-slate-100">
                                         <div className="text-[9px] font-bold text-slate-400 uppercase mb-0.5">Remarks</div>
                                         <p className="text-xs text-slate-600 whitespace-pre-wrap">{remarks}</p>
                                     </div>
                                 )}
                                 {assignmentNote && (
                                     <div className="bg-indigo-50 p-2 rounded border border-indigo-100">
                                         <div className="text-[9px] font-bold text-indigo-400 uppercase mb-0.5">Assignment Note</div>
                                         <p className="text-xs text-indigo-700 whitespace-pre-wrap">{assignmentNote}</p>
                                     </div>
                                 )}
                                 {completionNote && (
                                     <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                                         <div className="text-[9px] font-bold text-emerald-500 uppercase mb-0.5">Completion Note</div>
                                         <p className="text-xs text-emerald-700 whitespace-pre-wrap">{completionNote}</p>
                                     </div>
                                 )}
                                 {carryForwardNote && (
                                     <div className="bg-amber-50 p-2 rounded border border-amber-100">
                                         <div className="text-[9px] font-bold text-amber-500 uppercase mb-0.5 flex items-center gap-1"><RotateCcw size={8}/> Carry Forward</div>
                                         <p className="text-xs text-amber-700 whitespace-pre-wrap">{carryForwardNote}</p>
                                         {d.nextPlannedAt && (
                                             <div className="text-[10px] text-amber-600 mt-1 font-medium">
                                                 Next planned: {new Date(d.nextPlannedAt).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short'})} at {new Date(d.nextPlannedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}
                                             </div>
                                         )}
                                     </div>
                                 )}
                                 {cancellationReason && (
                                     <div className="bg-red-50 p-2 rounded border border-red-100">
                                         <div className="text-[9px] font-bold text-red-400 uppercase mb-0.5">Cancellation Reason</div>
                                         <p className="text-xs text-red-700 whitespace-pre-wrap">{cancellationReason}</p>
                                     </div>
                                 )}
                             </div>
                         );
                     })()}
                 </div>

                 {/* Drawer Footer Actions */}
                 <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                     <button 
                        onClick={() => setSelectedItem(null)}
                        className="flex-1 py-2 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded transition-colors"
                     >
                         Close
                     </button>
                     <button 
                        onClick={() => {
                            if (!selectedItem) {
                                toast.error("No item selected");
                                return;
                            }
                            if (onNavigate) {
                                onNavigate(selectedItem.type, selectedItem.data.id);
                                setSelectedItem(null);
                            } else {
                                console.warn("Navigation handler missing");
                            }
                        }}
                        className="flex-1 py-2 bg-slate-900 text-white rounded text-xs font-bold hover:bg-slate-800 shadow-sm"
                     >
                         Open Full View
                     </button>
                 </div>
             </div>
        )}
    </div>
  );
};

export default React.memo(OperationsDashboard);
