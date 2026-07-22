import React, { useState, useMemo } from 'react';
import toast from './Toast';
import { Ticket, Activity, Technician, Customer, TicketStatus, User } from '../types';
import {
  Search, Eye, X, Clock, User as UserIcon, Download,
  ChevronDown, FileText, FileSpreadsheet, AlertTriangle, CheckCircle2,
  Plus, Ticket as TicketIcon, ClipboardList, Calendar as CalendarIcon,
  RefreshCw, ArrowRight, Wrench, TrendingUp, Users, Contact, UserX
} from 'lucide-react';
import { MasterDashboardSkeleton } from './shared/Skeletons';
import { EmptyJobsTable } from './shared/EmptyState';

interface MasterDashboardProps {
  tickets: Ticket[];
  activities: Activity[];
  technicians: Technician[];
  customers: Customer[];
  salesAppointmentRequests?: any[];
  currentUser?: User | null;
  onNavigate?: (type: 'ticket' | 'activity' | 'view', id: string) => void;
}

// Photo lightbox handled via React state (see lightboxSrc state in component)

// Qatar work week helpers
const getQatarWeekStart = (): Date => {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const diff = day === 6 ? 0 : day + 1; // Sat=0 offset, Sun=2, Mon=3...
  const sat = new Date(now);
  sat.setDate(sat.getDate() - diff);
  sat.setHours(0, 0, 0, 0);
  return sat;
};

const UNIFIED_CATEGORIES = ['Wi-Fi & Networking', 'CCTV', 'Home Automation', 'Intercom', 'Smart Speaker', 'Other'];
const ACTIVITY_TYPES = ['Installation', 'Service', 'Maintenance', 'Inspection', 'Survey'];

const MasterDashboard: React.FC<MasterDashboardProps> = ({ tickets, activities, technicians, customers, salesAppointmentRequests = [], currentUser, onNavigate }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'tickets' | 'activities'>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedActTypes, setSelectedActTypes] = useState<string[]>([]);
  const [assignedFilter, setAssignedFilter] = useState('ALL');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [previewItem, setPreviewItem] = useState<any>(null);
  const [showExport, setShowExport] = useState(false);
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [showActTypeDropdown, setShowActTypeDropdown] = useState(false);

  // Export state
  const [exportFormat, setExportFormat] = useState<'pdf' | 'excel'>('pdf');
  const [exportType, setExportType] = useState<'all' | 'tickets' | 'activities'>('all');
  const [exportDateStart, setExportDateStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [exportDateEnd, setExportDateEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportColumns, setExportColumns] = useState<string[]>(['date', 'type', 'client', 'category', 'status', 'leadEngineer', 'description']);

  const allEngineers = useMemo(() => {
    const ids = new Set<string>();
    tickets.forEach(t => { if (t.assignedTechId) ids.add(t.assignedTechId); });
    activities.forEach(a => { if (a.leadTechId) ids.add(a.leadTechId); if ((a as any).primaryEngineerId) ids.add((a as any).primaryEngineerId); });
    const internal = Array.from(ids).map(id => technicians.find(t => t.id === id)).filter(Boolean) as any[];
    // Add freelancer Field Engineers
    const flNames = new Set<string>();
    activities.forEach((a: any) => {
        ((a as any).freelancers || []).forEach((fl: any) => {
            if (fl.role === 'FIELD_ENGINEER' && fl.name && !flNames.has(fl.name)) {
                flNames.add(fl.name);
            }
        });
    });
    const freelancerEntries = Array.from(flNames).map(name => ({ id: 'FL:' + name, name: name + ' (FL)', isFreelancer: true }));
    return [...internal, ...freelancerEntries];
  }, [tickets, activities, technicians]);

  // Normalize all jobs
  const allJobs = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    const qatarWeekStart = getQatarWeekStart();
    const monthAgo = new Date(now.getTime() - 30 * 86400000);

    const ticketJobs = tickets.map(t => {
      // The job's "date" is its own original/relevant date — completedAt once
      // genuinely resolved, otherwise when it was created. Carry-forward no
      // longer shifts this to "today" (updatedAt): doing that meant a ticket
      // carried forward today would vanish from any view/export filtered to
      // its real, original date range. Carry-forward jobs keep their
      // original date and are tracked separately in carryForwardNote/
      // nextPlannedAt, same as how they already display in the UI.
      const workDate = (t.status === 'RESOLVED' && (t as any).completedAt) ? (t as any).completedAt : t.createdAt;
      return {
        id: t.id, kind: 'ticket' as const, reference: t.id,
        title: t.customerName || 'Unknown', subtitle: t.category,
        type: t.type || 'Under Warranty', category: t.category,
        activityType: '', status: t.status, priority: t.priority,
        date: new Date(workDate),
        dateLabel: new Date(workDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
        techId: t.assignedTechId,
        techName: technicians.find(tc => tc.id === t.assignedTechId)?.name || 'Unassigned',
        customerId: t.customerId, raw: t,
      };
    });

    const activityJobs = activities.map(a => {
      const cust = customers.find(c => c.id === a.customerId);
      // Same reasoning as tickets above — carry-forward keeps its original
      // planned date instead of jumping to today.
      const workDate = (a.status === 'DONE' && (a as any).completedAt) ? (a as any).completedAt : (a.plannedDate || a.createdAt);
      return {
        id: a.id, kind: 'activity' as const, reference: a.reference,
        title: cust?.name || 'Unknown', subtitle: a.type,
        type: (a as any).serviceCategory || 'ELV Systems', category: (a as any).serviceCategory || a.type,
        activityType: a.type || '', status: a.status, priority: a.priority,
        date: new Date(workDate),
        dateLabel: new Date(workDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
        techId: (a as any).primaryEngineerId || a.leadTechId,
        techName: (() => {
            const internalName = technicians.find(tc => tc.id === ((a as any).primaryEngineerId || a.leadTechId))?.name;
            if (internalName) return internalName;
            // Check freelancers — use FE freelancer name if no internal engineer
            const feFreelancer = ((a as any).freelancers || []).find((fl: any) => fl.role === 'FIELD_ENGINEER');
            if (feFreelancer) return `${feFreelancer.name} (FL)`;
            const anyFreelancer = ((a as any).freelancers || [])[0];
            if (anyFreelancer) return `${anyFreelancer.name} (FL)`;
            return 'Unassigned';
        })(),
        customerId: a.customerId, raw: a,
      };
    });

    let combined = [...ticketJobs, ...activityJobs];

    // Date filter — Qatar week = Saturday to Thursday, cap at today for non-'all'.
    // Carry-forward jobs are always kept regardless of the active date filter —
    // they need to stay visible (and exportable) until someone actually
    // reschedules or resolves them, no matter how old their original date is.
    if (dateRange === 'today') combined = combined.filter(j => j.status === 'CARRY_FORWARD' || j.date.toDateString() === todayStr);
    else if (dateRange === 'week') combined = combined.filter(j => j.status === 'CARRY_FORWARD' || (j.date >= qatarWeekStart && j.date <= now));
    else if (dateRange === 'month') combined = combined.filter(j => j.status === 'CARRY_FORWARD' || (j.date >= monthAgo && j.date <= now));

    if (typeFilter === 'tickets') combined = combined.filter(j => j.kind === 'ticket');
    else if (typeFilter === 'activities') combined = combined.filter(j => j.kind === 'activity');

    // Multi-select category filter
    if (selectedCategories.length > 0) combined = combined.filter(j =>
      selectedCategories.some(c => j.category === c || j.subtitle === c || j.type === c)
    );
    // Activity type filter
    if (selectedActTypes.length > 0) combined = combined.filter(j =>
      j.kind === 'ticket' || selectedActTypes.some(t => j.subtitle?.toLowerCase() === t.toLowerCase() || j.activityType?.toLowerCase() === t.toLowerCase())
    );

    if (assignedFilter !== 'ALL') {
      if (assignedFilter.startsWith('FL:')) {
        // Freelancer filter — match by name
        const flName = assignedFilter.replace('FL:', '') + ' (FL)';
        combined = combined.filter(j => j.techName === flName);
      } else {
        combined = combined.filter(j => j.techId === assignedFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      combined = combined.filter(j =>
        j.reference.toLowerCase().includes(q) || j.title.toLowerCase().includes(q) ||
        j.subtitle.toLowerCase().includes(q) || j.techName.toLowerCase().includes(q)
      );
    }

    // Sort: most recently worked on first (completedAt > updatedAt > date)
    return combined.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [tickets, activities, technicians, customers, searchQuery, typeFilter, selectedCategories, selectedActTypes, assignedFilter, dateRange]);

  const statusColors: Record<string, string> = {
    'NEW': 'bg-purple-100 text-purple-700', 'OPEN': 'bg-blue-100 text-blue-700',
    'PLANNED': 'bg-amber-100 text-amber-700', 'ASSIGNED': 'bg-indigo-100 text-indigo-700',
    'ON_MY_WAY': 'bg-cyan-100 text-cyan-700', 'ARRIVED': 'bg-indigo-100 text-indigo-700',
    'IN_PROGRESS': 'bg-blue-100 text-blue-700', 'DONE': 'bg-emerald-100 text-emerald-700',
    'RESOLVED': 'bg-emerald-100 text-emerald-700', 'CARRY_FORWARD': 'bg-orange-100 text-orange-700',
    'CANCELLED': 'bg-slate-100 text-slate-500',
  };

  const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtTime = (iso: string) => iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  // ============================================================
  // EXECUTIVE OVERVIEW — everything below is derived directly from
  // the raw tickets/activities/customers/SAR props (NOT from allJobs,
  // which reflects the activity-log table's own filter state further
  // down the page). This keeps "what's happening today" independent
  // of whatever the user has filtered the log table to.
  // ============================================================

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }, []);
  const firstName = currentUser?.name?.trim()?.split(' ')[0] || '';

  // Qatar-local calendar day as YYYY-MM-DD — every "is this today" comparison
  // below uses this instead of the browser's own timezone, since a viewer
  // outside Qatar (or a server render) would otherwise land on the wrong
  // calendar day right around midnight and silently zero out "today" cards.
  const qatarDay = (d: string | Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Qatar' });

  const execToday = useMemo(() => {
    const now = new Date();
    const todayStr = qatarDay(now);

    // "Today's Activities" — each activity counted at most once (a single
    // .filter() pass over the activities array can't double-count), matched
    // per status against the field that actually carries today's relevance:
    //   PLANNED        -> plannedDate is today
    //   IN_PROGRESS    -> plannedDate is today, OR startedAt is today
    //   CARRY_FORWARD  -> nextPlannedAt (the NEW rescheduled date, set by the
    //                      Reschedule flow) is today — NOT plannedDate, which
    //                      stays frozen at the ORIGINAL date once an activity
    //                      is carried forward (see MobileLeadPortal's carry-
    //                      forward handler: "Do NOT send plannedDate — backend
    //                      keeps the original visit date"). Using plannedDate
    //                      or "any Carry Forward record" here is exactly what
    //                      previously pulled in every historical carry-forward
    //                      activity regardless of date.
    //   DONE           -> completedAt is today
    const relevantStatuses = ['PLANNED', 'IN_PROGRESS', 'CARRY_FORWARD', 'DONE'];
    const todaysActivities = activities.filter(a => {
      if (!relevantStatuses.includes(a.status)) return false;

      if (a.status === 'CARRY_FORWARD') {
        const nextDate = (a as any).nextPlannedAt;
        return !!nextDate && qatarDay(nextDate) === todayStr;
      }
      if (a.status === 'DONE') {
        const completedAt = (a as any).completedAt;
        return !!completedAt && qatarDay(completedAt) === todayStr;
      }
      if (a.status === 'IN_PROGRESS') {
        const plannedToday = !!a.plannedDate && qatarDay(a.plannedDate) === todayStr;
        const startedToday = !!(a as any).startedAt && qatarDay((a as any).startedAt) === todayStr;
        return plannedToday || startedToday;
      }
      // PLANNED
      return !!a.plannedDate && qatarDay(a.plannedDate) === todayStr;
    });
    const activeTickets = tickets.filter(t => t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CANCELLED);
    // Carry Forward KPI — intentionally the GLOBAL outstanding count (kept
    // separate from the date-qualified set above per the two-concepts rule:
    // this is total outstanding workload, not "carry-forward due today").
    const carryForward = activities.filter(a => a.status === 'CARRY_FORWARD').length;
    // "Completed Today" = activities completed today (per spec — tickets are
    // tracked separately elsewhere, not folded into this metric).
    const completedToday = activities.filter(a => a.status === 'DONE' && (a as any).completedAt && qatarDay((a as any).completedAt) === todayStr).length;
    const openSAR = (salesAppointmentRequests || []).filter((r: any) => r.status === 'PENDING_SCHEDULING').length;

    // "Engineers Working" = engineers currently assigned to an IN_PROGRESS
    // activity, right now — regardless of which day that activity was
    // originally planned for (a job started yesterday and still open today
    // still means that engineer is working today).
    const engineersWorkingIds = new Set(
      activities
        .filter(a => a.status === 'IN_PROGRESS')
        .map(a => (a as any).primaryEngineerId || a.leadTechId)
        .filter(Boolean)
    );

    // "Overdue" mirrors the same >72h open-ticket threshold already used on
    // the Service Dashboard — no new SLA rule invented here.
    const overdueTickets = tickets.filter(t => {
      if (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CANCELLED) return false;
      return (now.getTime() - new Date(t.createdAt).getTime()) > 72 * 60 * 60 * 1000;
    });

    const unassignedActivities = activities.filter(a =>
      a.status !== 'DONE' && a.status !== 'CANCELLED' && !a.leadTechId && !(a as any).primaryEngineerId && ((a as any).freelancers || []).length === 0
    );

    const urgentOpenTickets = tickets.filter(t => t.priority === 'URGENT' && t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CANCELLED);

    return {
      todaysActivitiesCount: todaysActivities.length,
      todaysActivities,
      activeTicketsCount: activeTickets.length,
      carryForward,
      completedToday,
      openSAR,
      engineersWorking: engineersWorkingIds.size,
      overdueTickets,
      unassignedActivities,
      urgentOpenTickets,
    };
  }, [tickets, activities, salesAppointmentRequests]);

  const operationalSummary = useMemo(() => {
    const critical = execToday.overdueTickets.length + execToday.urgentOpenTickets.length;
    let s = `Today there ${execToday.todaysActivitiesCount === 1 ? 'is' : 'are'} ${execToday.todaysActivitiesCount} scheduled activit${execToday.todaysActivitiesCount === 1 ? 'y' : 'ies'} and ${execToday.activeTicketsCount} active ticket${execToday.activeTicketsCount === 1 ? '' : 's'}`;
    s += critical > 0 ? `, with ${critical} critical issue${critical === 1 ? '' : 's'} requiring attention.` : ', all on track.';
    return s;
  }, [execToday]);

  // Critical Attention — only genuinely urgent items, and only shown if data exists
  const criticalAttention = useMemo(() => {
    const items: { label: string; count: number; icon: React.ReactNode; tone: string; onClick?: () => void }[] = [];
    if (execToday.overdueTickets.length > 0) items.push({
      label: 'Overdue Tickets (>3 days)', count: execToday.overdueTickets.length,
      icon: <AlertTriangle size={18} />, tone: 'red',
      onClick: () => onNavigate?.('view', 'tickets'),
    });
    if (execToday.urgentOpenTickets.length > 0) items.push({
      label: 'Urgent Tickets', count: execToday.urgentOpenTickets.length,
      icon: <AlertTriangle size={18} />, tone: 'red',
      onClick: () => onNavigate?.('view', 'tickets'),
    });
    if (execToday.carryForward > 0) items.push({
      label: 'Carry Forward Activities', count: execToday.carryForward,
      icon: <RefreshCw size={18} />, tone: 'orange',
      onClick: () => onNavigate?.('view', 'planning'),
    });
    if (execToday.unassignedActivities.length > 0) items.push({
      label: 'Activities Without Engineer', count: execToday.unassignedActivities.length,
      icon: <UserX size={18} />, tone: 'amber',
      onClick: () => onNavigate?.('view', 'planning'),
    });
    if (execToday.openSAR > 0) items.push({
      label: 'Pending SAR Approval', count: execToday.openSAR,
      icon: <ClipboardList size={18} />, tone: 'blue',
      onClick: () => onNavigate?.('view', 'sales_requests'),
    });
    return items;
  }, [execToday, onNavigate]);

  // Department Overview — one real metric + destination per department
  const departmentOverview = useMemo(() => {
    // Same "currently active engineer" population used in Business Health
    // below — Team Lead or Field Engineer, active, not on leave.
    const activeEngineerCount = technicians.filter(t =>
      (t.systemRole === 'TEAM_LEAD' || t.systemRole === 'FIELD_ENGINEER') && t.isActive !== false && t.status !== 'LEAVE'
    ).length;

    return [
      {
        label: 'Operations', icon: <Wrench size={18} />,
        metric: `${execToday.todaysActivitiesCount} today`,
        sub: `${execToday.carryForward} carried forward`,
        view: 'operations',
      },
      {
        label: 'Sales', icon: <TrendingUp size={18} />,
        metric: `${execToday.openSAR} pending`,
        sub: 'Sales appointment requests',
        view: 'sales_requests',
      },
      {
        label: 'Engineers', icon: <Users size={18} />,
        metric: `${activeEngineerCount} active`,
        sub: `${execToday.engineersWorking} working right now`,
        view: 'team',
      },
      {
        label: 'Clients', icon: <Contact size={18} />,
        metric: `${customers.length} total`,
        sub: 'Managed client records',
        view: 'customers',
      },
    ];
  }, [execToday, technicians, customers]);

  // Today's Schedule — chronological, today only, independent of the log
  // table's filters. Each item's sort/display time is the field that
  // actually made it qualify as "today" for its status (not always
  // plannedDate — a carry-forward item's plannedDate is its stale original
  // date, not today's relevant time).
  const todaysSchedule = useMemo(() => {
    const getRelevantTime = (a: Activity): number | null => {
      if (a.status === 'CARRY_FORWARD') {
        const d = (a as any).nextPlannedAt;
        return d ? new Date(d).getTime() : null;
      }
      if (a.status === 'DONE') {
        const d = (a as any).completedAt;
        return d ? new Date(d).getTime() : null;
      }
      if (a.status === 'IN_PROGRESS') {
        const started = (a as any).startedAt;
        if (started && qatarDay(started) === qatarDay(new Date())) return new Date(started).getTime();
        return a.plannedDate ? new Date(a.plannedDate).getTime() : null;
      }
      return a.plannedDate ? new Date(a.plannedDate).getTime() : null;
    };

    return [...execToday.todaysActivities]
      .map(a => ({ activity: a, sortTime: getRelevantTime(a) }))
      .sort((x, y) => {
        // Untimed activities sort after every timed activity.
        if (x.sortTime === null && y.sortTime === null) return 0;
        if (x.sortTime === null) return 1;
        if (y.sortTime === null) return -1;
        return x.sortTime - y.sortTime;
      })
      .slice(0, 10)
      .map(({ activity: a, sortTime }) => {
        const cust = customers.find(c => c.id === a.customerId);
        const tech = technicians.find(t => t.id === ((a as any).primaryEngineerId || a.leadTechId));
        return { activity: a, customerName: cust?.name || 'Unknown', engineerName: tech?.name || 'Unassigned', displayTime: sortTime };
      });
  }, [execToday.todaysActivities, customers, technicians]);

  // Recent Activity — most recent real events across tickets + activities,
  // independent of the log table's filter state.
  const recentActivityFeed = useMemo(() => {
    type Event = { id: string; kind: 'ticket' | 'activity'; label: string; who: string; time: Date; status: string };
    const events: Event[] = [];
    tickets.forEach(t => {
      events.push({ id: t.id, kind: 'ticket', label: t.customerName || 'Ticket', who: technicians.find(tc => tc.id === t.assignedTechId)?.name || 'Unassigned', time: new Date(t.updatedAt || t.createdAt), status: t.status });
    });
    activities.forEach(a => {
      const cust = customers.find(c => c.id === a.customerId);
      events.push({ id: a.id, kind: 'activity', label: cust?.name || a.type, who: technicians.find(tc => tc.id === ((a as any).primaryEngineerId || a.leadTechId))?.name || 'Unassigned', time: new Date(a.updatedAt || a.plannedDate || a.createdAt), status: a.status });
    });
    return events.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 8);
  }, [tickets, activities, customers, technicians]);

  // Business Health — only metrics that are already reliably calculable
  const businessHealth = useMemo(() => {
    const totalTickets = tickets.length;
    const resolvedTickets = tickets.filter(t => t.status === TicketStatus.RESOLVED).length;
    const completionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;

    const totalActivities = activities.length;
    const doneActivities = activities.filter(a => a.status === 'DONE').length;
    const activityCompletionRate = totalActivities > 0 ? Math.round((doneActivities / totalActivities) * 100) : 0;

    const activeEngineers = technicians.filter(t => t.isActive !== false && t.status !== 'LEAVE' && (t.systemRole === 'FIELD_ENGINEER' || t.systemRole === 'TEAM_LEAD')).length;
    const utilisation = activeEngineers > 0 ? Math.round((execToday.engineersWorking / activeEngineers) * 100) : 0;

    return { completionRate, activityCompletionRate, resolvedTickets, totalTickets, doneActivities, totalActivities, utilisation, activeEngineers };
  }, [tickets, activities, technicians, execToday]);

  // Toggle multi-select helpers
  const toggleCat = (cat: string) => setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  const toggleActType = (t: string) => setSelectedActTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  // Export handler
  const handleExport = () => {
    // Build export data
    let data = allJobs;
    if (exportType === 'tickets') data = data.filter(j => j.kind === 'ticket');
    else if (exportType === 'activities') data = data.filter(j => j.kind === 'activity');
    
    const es = new Date(exportDateStart); es.setHours(0,0,0,0);
    const ee = new Date(exportDateEnd); ee.setHours(23,59,59,999);
    // Carry-forward jobs are always included in exports regardless of the
    // chosen date range — their original date may fall outside the window,
    // but they still need to show up on the report until rescheduled/resolved.
    data = data.filter(j => j.status === 'CARRY_FORWARD' || (j.date >= es && j.date <= ee));

    const colMap: Record<string, { label: string, getValue: (j: any) => string }> = {
      date: { label: 'Date', getValue: j => j.dateLabel },
      type: { label: 'Type', getValue: j => j.kind === 'ticket' ? 'Ticket' : 'Activity' },
      reference: { label: 'Reference', getValue: j => j.reference },
      client: { label: 'Client', getValue: j => j.title },
      category: { label: 'Category', getValue: j => j.subtitle || j.category },
      status: { label: 'Status', getValue: j => j.status.replace(/_/g, ' ') },
      priority: { label: 'Priority', getValue: j => j.priority },
      leadEngineer: { label: 'Lead Engineer', getValue: j => j.techName },
      technicalAssociate: { label: 'Technical Associate', getValue: j => {
        const raw = j.raw; const ids = (raw as any).assistantTechIds || [];
        return ids.map((id: string) => technicians.find(t => t.id === id)?.name || '').filter(Boolean).join(', ');
      }},
      salesLead: { label: 'Sales Lead', getValue: j => {
        const slId = (j.raw as any).salesLeadId; return slId ? (technicians.find(t => t.id === slId)?.name || '') : '';
      }},
      description: { label: 'Description', getValue: j => (j.raw as any).description || (j.raw as any).notes || '' },
      odooRef: { label: 'Odoo Ref', getValue: j => (j.raw as any).odooLink || '' },
      nextPlanned: { label: 'Next Planned', getValue: j => {
        const next = (j.raw as any).nextPlannedAt;
        return next ? new Date(next).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }) : '';
      }},
    };

    const cols = exportColumns.map(id => colMap[id]).filter(Boolean);
    if (cols.length === 0) { toast.error('Please select at least one column'); return; }

    if (exportFormat === 'excel') {
      const headers = cols.map(c => c.label);
      const rows = data.map(item => cols.map(c => `"${String(c.getValue(item)).replace(/"/g, '""')}"`).join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `qonnect_${exportType}_${exportDateStart}_to_${exportDateEnd}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } else {
      // PDF with branded layout
      const s1 = document.createElement('script');
      s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s1.onload = () => {
        const s2 = document.createElement('script');
        s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
        s2.onload = () => {
          try {
            const { jsPDF } = (window as any).jspdf;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const pw = (doc as any).internal.pageSize.getWidth();
            const ph = (doc as any).internal.pageSize.getHeight();
            const title = exportType === 'tickets' ? 'After-Sales Tickets Report' : exportType === 'activities' ? 'Operations Activity Report' : 'Combined Operations Report';

            doc.setFillColor(15, 23, 42); doc.rect(0, 0, pw, 24, 'F');
            doc.setFontSize(16); doc.setTextColor(253, 187, 64); doc.text('QONNECT', 14, 14);
            doc.setFontSize(12); doc.setTextColor(255, 255, 255); doc.text(title, pw - 14, 10, { align: 'right' });
            doc.setFontSize(8); doc.setTextColor(148, 163, 184);
            doc.text(`Period: ${exportDateStart} to ${exportDateEnd}  |  Records: ${data.length}  |  Generated: ${new Date().toLocaleString('en-GB', {timeZone:'Asia/Qatar'})}`, pw - 14, 17, { align: 'right' });
            doc.setFillColor(253, 187, 64); doc.rect(0, 24, pw, 1, 'F');

            (doc as any).autoTable({
              startY: 30,
              head: [cols.map(c => c.label)],
              body: data.map(item => cols.map(c => String(c.getValue(item) ?? ''))),
              styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.1 },
              headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7 },
              alternateRowStyles: { fillColor: [248, 250, 252] },
              margin: { left: 10, right: 10, bottom: 16 },
              didDrawPage: (d2: any) => {
                if (d2.pageNumber > 1) {
                  doc.setFillColor(15, 23, 42); doc.rect(0, 0, pw, 18, 'F');
                  doc.setFontSize(11); doc.setTextColor(253, 187, 64); doc.text('QONNECT', 14, 11);
                  doc.setFontSize(8); doc.setTextColor(255, 255, 255); doc.text(title, pw - 14, 11, { align: 'right' });
                  doc.setFillColor(253, 187, 64); doc.rect(0, 18, pw, 0.5, 'F');
                }
              }
            });

            const tp = (doc as any).internal.getNumberOfPages();
            for (let i = 1; i <= tp; i++) {
              doc.setPage(i);
              doc.setFillColor(248, 250, 252); doc.rect(0, ph - 10, pw, 10, 'F');
              doc.setFontSize(7); doc.setTextColor(100, 116, 139);
              doc.text('Qonnect W.L.L.  |  qonnect.qa', 14, ph - 4);
              doc.text(`Page ${i} of ${tp}`, pw - 14, ph - 4, { align: 'right' });
            }
            doc.save(`qonnect_${exportType}_${exportDateStart}_to_${exportDateEnd}.pdf`);
          } catch (err) { console.error('PDF failed:', err); toast.error('PDF generation failed. Please try again.'); }
        };
        document.head.appendChild(s2);
      };
      document.head.appendChild(s1);
    }
    setShowExport(false);
  };

  const exportPresetDate = (preset: string) => {
    const now = new Date();
    if (preset === 'today') { setExportDateStart(now.toISOString().slice(0, 10)); setExportDateEnd(now.toISOString().slice(0, 10)); }
    else if (preset === 'week') { setExportDateStart(getQatarWeekStart().toISOString().slice(0, 10)); setExportDateEnd(now.toISOString().slice(0, 10)); }
    else if (preset === 'month') { const m = new Date(now); m.setDate(1); setExportDateStart(m.toISOString().slice(0, 10)); setExportDateEnd(now.toISOString().slice(0, 10)); }
  };

  const EXPORT_COLUMNS = [
    { id: 'date', label: 'Date' }, { id: 'type', label: 'Type' }, { id: 'client', label: 'Client' },
    { id: 'category', label: 'Category' }, { id: 'status', label: 'Status' }, { id: 'description', label: 'Description' },
    { id: 'salesLead', label: 'Sales Lead' }, { id: 'leadEngineer', label: 'Lead Engineer' },
    { id: 'technicalAssociate', label: 'Technical Associate' }, { id: 'reference', label: 'Reference' },
    { id: 'odooRef', label: 'Odoo Ref' }, { id: 'priority', label: 'Priority' },
    { id: 'nextPlanned', label: 'Next Planned' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black text-slate-900">
                {greeting}{firstName ? `, ${firstName}` : ''}
              </h1>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                Live
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-0.5">{operationalSummary}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-sm font-medium">
              <CalendarIcon size={16} className="text-slate-500" aria-hidden="true" />
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
            <button type="button" onClick={() => {
              // Inherit active date range into export defaults
              const now = new Date();
              if (dateRange === 'today') { setExportDateStart(now.toISOString().slice(0,10)); setExportDateEnd(now.toISOString().slice(0,10)); }
              else if (dateRange === 'week') { setExportDateStart(getQatarWeekStart().toISOString().slice(0,10)); setExportDateEnd(now.toISOString().slice(0,10)); }
              setShowExport(true);
            }} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00] focus-visible:ring-offset-1">
              <Download size={14} /> Export Data
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex items-center gap-3 flex-wrap">
          {(searchQuery || typeFilter !== 'all' || selectedCategories.length > 0 || selectedActTypes.length > 0 || assignedFilter !== 'ALL' || dateRange !== 'month') && (
            <button type="button" onClick={() => { setSearchQuery(''); setTypeFilter('all'); setSelectedCategories([]); setSelectedActTypes([]); setAssignedFilter('ALL'); setDateRange('month'); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-600 hover:bg-red-100">
              <X size={12} /> Clear Filters
            </button>
          )}
          <div className="flex-1 relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search reference, client, engineer..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white" />
          </div>
          {/* Type */}
          <div className="flex bg-slate-100 rounded-xl p-0.5 shrink-0">
            {(['all', 'tickets', 'activities'] as const).map(v => (
              <button key={v} onClick={() => setTypeFilter(v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${typeFilter === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {v === 'all' ? 'All' : v === 'tickets' ? 'Tickets' : 'Activities'}
              </button>
            ))}
          </div>
          {/* Category multi-select */}
          <div className="relative">
            <button onClick={() => { setShowCatDropdown(!showCatDropdown); setShowActTypeDropdown(false); }}
              className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700">
              {selectedCategories.length === 0 ? 'All Categories' : `${selectedCategories.length} selected`} <ChevronDown size={12} />
            </button>
            {showCatDropdown && (
              <div className="absolute top-full mt-1 left-0 bg-white border border-slate-200 rounded-xl shadow-xl z-30 p-2 min-w-[180px]">
                {UNIFIED_CATEGORIES.map(c => (
                  <label key={c} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer text-xs">
                    <input type="checkbox" checked={selectedCategories.includes(c)} onChange={() => toggleCat(c)} className="rounded" />
                    {c}
                  </label>
                ))}
                {selectedCategories.length > 0 && <button onClick={() => setSelectedCategories([])} className="text-[10px] text-blue-600 px-2 mt-1">Clear all</button>}
              </div>
            )}
          </div>
          {/* Activity Type multi-select — only show when viewing activities */}
          {typeFilter !== 'tickets' && <div className="relative">
            <button onClick={() => { setShowActTypeDropdown(!showActTypeDropdown); setShowCatDropdown(false); }}
              className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700">
              {selectedActTypes.length === 0 ? 'All Activity Types' : `${selectedActTypes.length} selected`} <ChevronDown size={12} />
            </button>
            {showActTypeDropdown && (
              <div className="absolute top-full mt-1 left-0 bg-white border border-slate-200 rounded-xl shadow-xl z-30 p-2 min-w-[160px]">
                {ACTIVITY_TYPES.map(t => (
                  <label key={t} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer text-xs">
                    <input type="checkbox" checked={selectedActTypes.includes(t)} onChange={() => toggleActType(t)} className="rounded" />
                    {t}
                  </label>
                ))}
                {selectedActTypes.length > 0 && <button onClick={() => setSelectedActTypes([])} className="text-[10px] text-blue-600 px-2 mt-1">Clear all</button>}
              </div>
            )}
          </div>}
          {/* Assigned To */}
          <select value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none shrink-0">
            <option value="ALL">All Engineers</option>
            {allEngineers.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {/* Date Range */}
          <div className="flex bg-slate-100 rounded-xl p-0.5 shrink-0">
            {(['today', 'week', 'month', 'all'] as const).map(v => (
              <button key={v} onClick={() => setDateRange(v)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold ${dateRange === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {v === 'all' ? 'All' : v === 'week' ? 'Week (Sat–Thu)' : v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto pb-20">

        {/* ============ EXECUTIVE OVERVIEW ============ */}
        <div className="p-6 space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">

          {/* Executive Summary */}
          <div>
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Executive Summary</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { label: "Today's Activities", value: execToday.todaysActivitiesCount, icon: <CalendarIcon size={20} />, tone: 'blue', view: 'planning' },
                { label: 'Active Tickets', value: execToday.activeTicketsCount, icon: <TicketIcon size={20} />, tone: 'purple', view: 'tickets' },
                { label: 'Carry Forward', value: execToday.carryForward, icon: <RefreshCw size={20} />, tone: 'orange', view: 'planning' },
                { label: 'Completed Today', value: execToday.completedToday, icon: <CheckCircle2 size={20} />, tone: 'emerald', view: undefined },
                { label: 'Open SAR', value: execToday.openSAR, icon: <ClipboardList size={20} />, tone: 'indigo', view: 'sales_requests' },
                { label: 'Engineers Working', value: execToday.engineersWorking, icon: <Users size={20} />, tone: 'cyan', view: 'team' },
                { label: 'Overdue Tickets', value: execToday.overdueTickets.length, icon: <AlertTriangle size={20} />, tone: 'red', view: 'tickets' },
              ].map(kpi => {
                const toneClasses: Record<string, string> = {
                  blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600',
                  orange: 'bg-orange-50 text-orange-600', emerald: 'bg-emerald-50 text-emerald-600',
                  indigo: 'bg-indigo-50 text-indigo-600', cyan: 'bg-cyan-50 text-cyan-600',
                  red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600',
                };
                const clickable = !!kpi.view && !!onNavigate;
                const Wrapper: any = clickable ? 'button' : 'div';
                return (
                  <Wrapper
                    key={kpi.label}
                    type={clickable ? 'button' : undefined}
                    onClick={clickable ? () => onNavigate?.('view', kpi.view as string) : undefined}
                    className={`text-left bg-white p-4 rounded-2xl border border-slate-200 shadow-sm ${clickable ? 'hover:shadow-md hover:border-slate-300 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00]' : ''}`}
                  >
                    <div className={`inline-flex p-2 rounded-xl mb-3 ${toneClasses[kpi.tone]}`}>{kpi.icon}</div>
                    <div className="text-2xl font-black text-slate-900 leading-none">{kpi.value}</div>
                    <div className="text-xs font-semibold text-slate-500 mt-1">{kpi.label}</div>
                  </Wrapper>
                );
              })}
            </div>
          </div>

          {/* Critical Attention */}
          {criticalAttention.length > 0 && (
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={18} className="text-red-600" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-800">Critical Attention</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {criticalAttention.map(item => {
                  const toneMap: Record<string, string> = {
                    red: 'bg-red-50 border-red-100 hover:bg-red-100/70 text-red-700',
                    orange: 'bg-orange-50 border-orange-100 hover:bg-orange-100/70 text-orange-700',
                    amber: 'bg-amber-50 border-amber-100 hover:bg-amber-100/70 text-amber-700',
                    blue: 'bg-blue-50 border-blue-100 hover:bg-blue-100/70 text-blue-700',
                  };
                  return (
                    <button
                      type="button"
                      key={item.label}
                      onClick={item.onClick}
                      className={`text-left flex items-center gap-3 p-3.5 rounded-xl border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00] ${toneMap[item.tone]}`}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-xl font-bold leading-none">{item.count}</span>
                        <span className="block text-xs font-medium mt-0.5 opacity-90">{item.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div>
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Quick Actions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'New Activity', icon: <Plus size={20} />, view: 'planning' },
                { label: 'New Ticket', icon: <TicketIcon size={20} />, view: 'tickets' },
                { label: 'New SAR', icon: <ClipboardList size={20} />, view: 'sales_requests' },
                { label: 'AMC Contracts', icon: <FileText size={20} />, view: 'amc_contracts' },
              ].map(action => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => onNavigate?.('view', action.view)}
                  className="flex flex-col items-center gap-2 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-[#FFCC00] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00]"
                >
                  <span className="p-2.5 rounded-xl bg-[#FFCC00]/15 text-slate-800">{action.icon}</span>
                  <span className="text-xs font-bold text-slate-700">{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Department Overview */}
          <div>
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Department Overview</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {departmentOverview.map(dept => (
                <button
                  key={dept.label}
                  type="button"
                  onClick={() => onNavigate?.('view', dept.view)}
                  className="text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFCC00] group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 rounded-xl bg-slate-100 text-slate-600 group-hover:bg-slate-200 transition-colors">{dept.icon}</span>
                    <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" aria-hidden="true" />
                  </div>
                  <div className="font-bold text-slate-900 text-sm">{dept.label}</div>
                  <div className="text-lg font-black text-slate-800 mt-1">{dept.metric}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{dept.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Business Health */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-4">Business Health</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-2xl font-black text-slate-900">{businessHealth.completionRate}%</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Ticket Completion ({businessHealth.resolvedTickets}/{businessHealth.totalTickets})</div>
              </div>
              <div>
                <div className="text-2xl font-black text-slate-900">{businessHealth.activityCompletionRate}%</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Activities Completed ({businessHealth.doneActivities}/{businessHealth.totalActivities})</div>
              </div>
              <div>
                <div className="text-2xl font-black text-slate-900">{businessHealth.utilisation}%</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Engineer Utilisation ({execToday.engineersWorking}/{businessHealth.activeEngineers})</div>
              </div>
              <div>
                <div className="text-2xl font-black text-slate-900">{execToday.activeTicketsCount} / {businessHealth.resolvedTickets}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Open vs Closed Tickets</div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-2">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Activity Log &amp; Reports</h2>
            <p className="text-xs text-slate-400 mt-0.5">Full searchable, filterable, exportable record of every ticket and activity</p>
          </div>
        </div>

        <div className="overflow-x-auto qn-table"><table className="w-full text-sm text-left table-fixed">
          <thead className="bg-white text-slate-500 font-semibold uppercase text-[10px] tracking-wider sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 w-[5%]">Type</th>
              <th className="px-4 py-3 w-[9%]">Ref</th>
              <th className="px-4 py-3 w-[16%]">Client</th>
              <th className="px-4 py-3 w-[10%]">Category</th>
              <th className="px-4 py-3 w-[7%]">Priority</th>
              <th className="px-4 py-3 w-[10%]">Status</th>
              <th className="px-4 py-3 w-[10%]">Date</th>
              <th className="px-4 py-3 w-[13%]">Assigned To</th>
              <th className="px-4 py-3 w-[6%] text-center">Photos</th>
              <th className="px-4 py-3 w-[6%] text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {allJobs.length === 0 && (tickets.length === 0 && activities.length === 0) ? (
              <tr><td colSpan={10}><MasterDashboardSkeleton /></td></tr>
            ) : allJobs.length === 0 ? (
              <tr><td colSpan={10}><EmptyJobsTable filtered={true} /></td></tr>
            ) : allJobs.map(job => {
              const photos = (job.raw as any).photos || [];
              return (
                <tr key={`${job.kind}-${job.id}`} className="hover:bg-slate-50 group">
                  <td className="px-4 py-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${job.kind === 'ticket' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>{job.kind === 'ticket' ? 'TKT' : 'ACT'}</span></td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 truncate">{job.reference}</td>
                  <td className="px-4 py-3"><div className="font-medium text-slate-800 truncate">{job.title}</div></td>
                  <td className="px-4 py-3 text-xs text-slate-600 truncate">{job.subtitle}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${job.priority === 'URGENT' ? 'bg-red-50 text-red-700 border-red-200' : job.priority === 'HIGH' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{job.priority}</span></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[job.status] || 'bg-slate-100 text-slate-500'}`}>{job.status.replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{job.dateLabel}</td>
                  <td className="px-4 py-3 text-xs text-slate-700 truncate">{job.techName}</td>
                  <td className="px-4 py-3 text-center">{photos.length > 0 ? <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">{photos.length}</span> : <span className="text-slate-300">{"—"}</span>}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => setPreviewItem(job)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded opacity-0 group-hover:opacity-100"><Eye size={12} /> View</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {/* Preview Popup */}
      {previewItem && (() => {
        const d = previewItem.raw;
        if (!d) { setPreviewItem(null); return null; }
        const isTicket = previewItem.kind === 'ticket';
        const cust = customers.find(c => c.id === (d.customerId || previewItem.customerId));
        const tech = technicians.find(t => t.id === (d.assignedTechId || (d as any).primaryEngineerId || d.leadTechId));
        const salesLd = !isTicket ? technicians.find(t => t.id === (d as any).salesLeadId) : null;
        const assistants = !isTicket ? ((d as any).assistantTechIds || []).map((id: string) => technicians.find(t => t.id === id)).filter(Boolean) : [];
        const photos = (d as any).photos || [];
        const statusColor = d.status === 'DONE' || d.status === 'RESOLVED' ? 'bg-emerald-500' : d.status === 'CARRY_FORWARD' ? 'bg-orange-500' : d.status === 'IN_PROGRESS' ? 'bg-blue-500' : d.status === 'CANCELLED' ? 'bg-slate-400' : 'bg-amber-400';
        const issueText = isTicket ? ((d as any).ai_summary || d.notes || d.category || '') : (d.description || '');
        const visits = (d as any).visitHistory || (d as any).visit_history || [];
        const hasVisits = visits.length > 0;
        const isDone = d.status === 'DONE' || d.status === 'RESOLVED';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setPreviewItem(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${statusColor}`} />
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isTicket ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>{isTicket ? 'TICKET' : 'ACTIVITY'}</span>
                      <span className="text-[10px] font-mono text-slate-400">{previewItem.reference}</span>
                    </div>
                    <h3 className="font-bold text-lg text-slate-900">{isTicket ? d.category : d.type}</h3>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold text-white ${statusColor}`}>{(d.status || '').replace(/_/g, ' ')}</span>
                  <button onClick={() => setPreviewItem(null)} className="p-1.5 hover:bg-slate-200 rounded-lg"><X size={18} className="text-slate-400" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase">Customer</h4>
                  <div className="text-sm font-bold text-slate-800">{cust?.name || (isTicket ? d.customerName : 'Unknown')}</div>
                  {(cust?.phone || d.phoneNumber) && <div className="text-xs text-slate-500">{cust?.phone || d.phoneNumber}</div>}
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-1.5">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase">Timing</h4>
                  <div className="flex justify-between text-xs"><span className="text-slate-400">{isTicket ? 'Created' : 'Planned'}</span><span>{fmtDt(isTicket ? d.createdAt : d.plannedDate)}</span></div>
                  {(d as any).startedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Started</span><span className="text-emerald-600">{fmtDt((d as any).startedAt)}</span></div>}
                  {(d as any).completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Completed</span><span className="text-emerald-600">{fmtDt((d as any).completedAt)}</span></div>}
                </div>
                {(salesLd || tech || assistants.length > 0) && (
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                    {salesLd && <div className="pb-2 border-b border-slate-200"><div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Sales Lead</div><div className="text-xs font-medium text-indigo-700">{salesLd.name}</div></div>}
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Team</div>
                    {tech && <div className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-purple-500" /><span className="font-medium">{tech.name}</span></div>}
                    {assistants.map((a: any) => <div key={a.id} className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-teal-500" /><span>{a.name}</span><span className="text-[10px] text-slate-400">TA</span></div>)}
                  </div>
                )}
                {issueText && <div className="bg-slate-50 rounded-xl p-4 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Description</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{issueText}</p></div>}
                {/* Completion note — only for DONE/RESOLVED, separate from remarks */}
                {isDone && (d as any).completionNote && <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100"><div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Completion Summary</div><p className="text-xs text-emerald-800 whitespace-pre-wrap">{(d as any).completionNote}</p></div>}
                {/* Remarks — only if NO visit history (avoids duplication) */}
                {!hasVisits && ((d as any).remarks || d.notes) && ((d as any).remarks || d.notes) !== (d as any).completionNote && <div className="bg-slate-50 rounded-xl p-4 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</div><p className="text-xs whitespace-pre-wrap">{(d as any).remarks || d.notes}</p></div>}
                {/* Carry forward — only if NO visit history */}
                {!hasVisits && (d as any).carryForwardNote && <div className="bg-amber-50 rounded-xl p-4 border border-amber-200"><div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div><p className="text-xs text-amber-800 whitespace-pre-wrap">{(d as any).carryForwardNote}</p></div>}
                {/* Visit History Cards */}
                {hasVisits && (
                  <div className="space-y-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Visit History ({visits.length} visit{visits.length > 1 ? 's' : ''})</div>
                    <div className="relative border-l-2 border-slate-200 ml-2 space-y-3">
                      {visits.map((v: any, i: number) => {
                        const visCF = v.status === 'CARRY_FORWARD'; const visDone = v.status === 'DONE';
                        const cardBg = visDone ? 'bg-emerald-50 border-emerald-200' : visCF ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200';
                        const hdrColor = visDone ? 'text-emerald-800' : visCF ? 'text-orange-800' : 'text-blue-800';
                        const badgeStyle = visDone ? 'bg-emerald-100 text-emerald-700' : visCF ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700';
                        const dotColor = visDone ? 'bg-emerald-500' : visCF ? 'bg-orange-500' : 'bg-blue-500';
                        const dur = v.startedAt && v.completedAt ? Math.round((new Date(v.completedAt).getTime() - new Date(v.startedAt).getTime()) / 60000) : null;
                        return (
                          <div key={i} className="relative pl-5">
                            <div className={`absolute -left-[7px] top-2 w-3 h-3 rounded-full border-2 border-white shadow-sm ${dotColor}`} />
                            <div className={`rounded-xl p-3 border ${cardBg}`}>
                              <div className="flex justify-between items-center mb-1.5">
                                <span className={`font-bold text-xs ${hdrColor}`}>Visit {i + 1} {"—"} {fmtDate(v.date)}</span>
                                <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${badgeStyle}`}>{(v.status || '').replace(/_/g, ' ')}</span>
                              </div>
                              <div className="text-[10px] text-slate-500">{fmtTime(v.startedAt)} {"→"} {v.completedAt ? fmtTime(v.completedAt) : 'ongoing'}{dur !== null ? ` (${dur >= 60 ? Math.floor(dur/60)+'h '+dur%60+'m' : dur+'m'})` : ''}</div>
                              {v.remarks && <div className="bg-white/60 rounded-lg p-2 mt-2 border border-white/80"><div className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">Remark</div><p className="text-[11px] text-slate-700 whitespace-pre-wrap">{v.remarks}</p></div>}
                              {v.completionNote && <div className="bg-emerald-50/50 rounded-lg p-2 mt-1.5 border border-emerald-100"><div className="text-[8px] font-bold text-emerald-600 uppercase mb-0.5">Completion</div><p className="text-[11px] text-emerald-800 whitespace-pre-wrap">{v.completionNote}</p></div>}
                              {v.carryForwardReason && visCF && <div className="bg-orange-50/50 rounded-lg p-2 mt-1.5 border border-orange-200"><div className="text-[8px] font-bold text-orange-600 uppercase mb-0.5">Carry forward reason</div><p className="text-[11px] text-orange-800 whitespace-pre-wrap">{v.carryForwardReason}</p></div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {photos.length > 0 && <div><div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Photos ({photos.length})</div><div className="grid grid-cols-4 gap-2">{photos.map((p: any, i: number) => <img key={i} src={p.url || p} alt="" className="w-full h-20 object-cover rounded-lg border cursor-pointer hover:shadow-md" onClick={() => setLightboxSrc(p.url || p)} />)}</div></div>}
                {(d as any).odooLink && <div className="flex items-center gap-2 text-xs"><span className="text-slate-400">Odoo:</span><a href={(d as any).odooLink} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline truncate">{(d as any).odooLink}</a></div>}
              </div>
              <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
                <button onClick={() => setPreviewItem(null)} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Export Popup */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowExport(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900">Export Data</h3>
              <button onClick={() => setShowExport(false)} className="p-1 hover:bg-slate-200 rounded-lg"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Format */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Format</label>
                <div className="flex gap-2">
                  <button onClick={() => setExportFormat('pdf')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition-all ${exportFormat === 'pdf' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}><FileText size={14} /> PDF</button>
                  <button onClick={() => setExportFormat('excel')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition-all ${exportFormat === 'excel' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}><FileSpreadsheet size={14} /> Excel (CSV)</button>
                </div>
              </div>
              {/* Type */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Data Type</label>
                <div className="flex gap-2">
                  {(['all', 'tickets', 'activities'] as const).map(v => (
                    <button key={v} onClick={() => setExportType(v)} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${exportType === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>
                      {v === 'all' ? 'All' : v === 'tickets' ? 'Tickets' : 'Activities'}
                    </button>
                  ))}
                </div>
              </div>
              {/* Date Range */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Date Range</label>
                <div className="flex gap-2 mb-2">
                  {[{l:'Today',v:'today'},{l:'Week (Sat–Thu)',v:'week'},{l:'This Month',v:'month'}].map(p => (
                    <button key={p.v} onClick={() => exportPresetDate(p.v)} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">{p.l}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={exportDateStart} onChange={e => setExportDateStart(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  <input type="date" value={exportDateEnd} onChange={e => setExportDateEnd(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">Carry forward jobs are always included, regardless of date range.</p>
              </div>
              {/* Columns */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Columns</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPORT_COLUMNS.map(col => (
                    <label key={col.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={exportColumns.includes(col.id)}
                        onChange={() => setExportColumns(prev => prev.includes(col.id) ? prev.filter(c => c !== col.id) : [...prev, col.id])} className="rounded" />
                      {col.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50">
              <button onClick={handleExport} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 flex items-center justify-center gap-2">
                <Download size={14} /> Export {exportFormat.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox — React portal */}
      {lightboxSrc && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center cursor-pointer" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxSrc(null)} className="absolute top-5 right-6 w-10 h-10 rounded-full bg-black/50 text-white text-2xl font-bold flex items-center justify-center hover:bg-black/70">✕</button>
        </div>
      )}

    </div>
  );
};

export default React.memo(MasterDashboard);
