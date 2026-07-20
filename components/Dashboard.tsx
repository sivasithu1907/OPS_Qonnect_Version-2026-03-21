import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticket, TicketStatus, TicketFilter, Priority, User, Role, Technician } from '../types';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, LabelList
} from 'recharts';
import {
  AlertCircle, CheckCircle, Clock, Activity, TrendingUp,
  FileText, ArrowUpRight, AlertTriangle,
  ChevronRight, Search, Calendar, X, MapPin, Phone, User as UserIcon,
  Tag, Home, History, ArrowRight, MessageSquare, UserX, CornerDownRight
} from 'lucide-react';
import { SEARCH_INPUT_STYLES } from '../constants';

interface DashboardProps {
  tickets: Ticket[];
  technicians?: Technician[];
  onNavigate: (filter: TicketFilter) => void;
  currentUser?: User | null;
  onUpdateTicket?: (ticket: Ticket) => void;
}

const COLORS = {
  primary: '#3b82f6',   // Blue
  success: '#10b981',   // Emerald
  warning: '#f59e0b',   // Amber
  danger: '#ef4444',    // Red
  neutral: '#64748b',   // Slate
  purple: '#8b5cf6'     // Purple
};

const STATUS_COLORS: Record<string, string> = {
  [TicketStatus.NEW]: COLORS.primary,
  [TicketStatus.OPEN]: COLORS.warning,
  [TicketStatus.IN_PROGRESS]: COLORS.purple,
  [TicketStatus.RESOLVED]: COLORS.success,
  [TicketStatus.CANCELLED]: COLORS.neutral
};

// --- Helper for Text Highlighting ---
const HighlightText = ({ text, highlight }: { text: string, highlight: string }) => {
    if (!text || typeof text !== 'string') return <>{text}</>;
    if (!highlight || typeof highlight !== 'string' || highlight.length < 2) return <>{text}</>;

    try {
        const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
        return (
            <>
                {parts.map((part, i) =>
                    part.toLowerCase() === highlight.toLowerCase() ? (
                        <span key={i} className="bg-[#FFCC00]/40 text-slate-900 rounded-[1px]">{part}</span>
                    ) : (
                        <span key={i}>{part}</span>
                    )
                )}
            </>
        );
    } catch (e) {
        return <>{text}</>;
    }
};

// --- Small reusable empty-state block for charts with no data ---
const ChartEmptyState = ({ label }: { label: string }) => (
    <div className="h-full w-full flex flex-col items-center justify-center text-slate-400 gap-2 py-8">
        <FileText size={28} className="text-slate-300" />
        <span className="text-sm font-medium">{label}</span>
    </div>
);

const Dashboard: React.FC<DashboardProps> = ({ tickets, technicians = [], onNavigate, currentUser, onUpdateTicket }) => {
  // --- Search State (Decoupled from Dashboard Logic) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [selectedSearchTicket, setSelectedSearchTicket] = useState<Ticket | null>(null);
  const [previewTicket, setPreviewTicket] = useState<Ticket | null>(null); // Summary popup for completed tickets
  const [recentTicketIds, setRecentTicketIds] = useState<string[]>(() => {
      try {
          const saved = localStorage.getItem('qonnect_recent_tickets');
          return saved ? JSON.parse(saved) : [];
      } catch { return []; }
  });

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- Search Logic ---

  // 1. Filtered Results for Dropdown ONLY
  const searchResults = useMemo(() => {
      // Role Check Helper
      const canView = (t: Ticket) => {
          if (currentUser?.role === Role.FIELD_ENGINEER && currentUser.techId) {
              return t.assignedTechId === currentUser.techId;
          }
          return true;
      };

      // Case A: Show Recent Tickets if query is empty
      if (!searchQuery.trim()) {
          return recentTicketIds
              .map(id => tickets.find(t => t.id === id))
              .filter((t): t is Ticket => !!t && canView(t))
              .slice(0, 5);
      }

      // Case B: Search Query (Min 2 chars)
      if (searchQuery.length < 2) return [];

      const lowerQuery = searchQuery.toLowerCase();
      return tickets
          .filter(t => {
              if (!canView(t)) return false;
              const safeId = t.id ? t.id.toLowerCase() : '';
              const safeName = t.customerName ? t.customerName.toLowerCase() : '';
              const safePhone = t.phoneNumber ? t.phoneNumber : '';

              return (
                  safeId.includes(lowerQuery) ||
                  safeName.includes(lowerQuery) ||
                  safePhone.includes(lowerQuery)
              );
          })
          .slice(0, 10); // Limit to 10 results
  }, [tickets, searchQuery, recentTicketIds, currentUser]);

  // 2. Handlers
  const handleTicketSelect = (ticket: Ticket) => {
      // Add to recent
      const newRecent = [ticket.id, ...recentTicketIds.filter(id => id !== ticket.id)].slice(0, 5);
      setRecentTicketIds(newRecent);
      localStorage.setItem('qonnect_recent_tickets', JSON.stringify(newRecent));

      // Open Modal
      setSelectedSearchTicket(ticket);

      // Reset Search UI
      setSearchQuery('');
      setIsSearchFocused(false);
      setActiveSearchIndex(-1);
      searchInputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!isSearchFocused || searchResults.length === 0) return;

      if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveSearchIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveSearchIndex(prev => (prev > 0 ? prev - 1 : searchResults.length - 1));
      } else if (e.key === 'Enter') {
          e.preventDefault();
          if (activeSearchIndex >= 0 && searchResults[activeSearchIndex]) {
              handleTicketSelect(searchResults[activeSearchIndex]);
          }
      } else if (e.key === 'Escape') {
          setIsSearchFocused(false);
          searchInputRef.current?.blur();
      }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- Live Data for Modal ---
  // Ensure we are showing the latest version of the ticket even if it updates while modal is open
  const activeModalTicket = useMemo(() => {
      if (!selectedSearchTicket) return null;
      return tickets.find(t => t.id === selectedSearchTicket.id) || selectedSearchTicket;
  }, [selectedSearchTicket, tickets]);

  const latestMessage = activeModalTicket?.messages && activeModalTicket.messages.length > 0
    ? activeModalTicket.messages[activeModalTicket.messages.length - 1]
    : null;

  const isLatestDifferent = latestMessage && activeModalTicket && activeModalTicket.messages && activeModalTicket.messages.length > 0
    ? latestMessage.content !== activeModalTicket.messages[0].content
    : false;

  // Permissions
  const canAssign = currentUser?.role === Role.ADMIN || currentUser?.role === Role.TEAM_LEAD;

  // Close either modal on Escape (additive keyboard accessibility — does not
  // remove or alter any existing modal behaviour, only adds a close path).
  useEffect(() => {
      if (!activeModalTicket && !previewTicket) return;
      const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
              setSelectedSearchTicket(null);
              setPreviewTicket(null);
          }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
  }, [activeModalTicket, previewTicket]);

  // --- Dashboard Logic (Using FULL ticket list, NOT filtered by search) ---

  const dateBadge = useMemo(() => {
      const today = new Date();
      return today.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
      });
  }, []);

  // Time-based greeting + first name, computed once per mount (mirrors the
  // existing dateBadge pattern above).
  const greeting = useMemo(() => {
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      const rawName = currentUser?.name?.trim();
      const firstName = rawName ? rawName.split(' ')[0] : '';
      return firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;
  }, [currentUser?.name]);

  const formatStatus = (status: string) => {
    if (!status || typeof status !== 'string') return 'Unknown';
    if (status === TicketStatus.RESOLVED) return 'Completed';
    return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  const getStatusBadgeStyle = (status: TicketStatus) => {
      switch (status) {
          case TicketStatus.NEW: return 'bg-blue-100 text-blue-700 border-blue-200';
          case TicketStatus.OPEN: return 'bg-amber-100 text-amber-700 border-amber-200';
          case TicketStatus.IN_PROGRESS: return 'bg-purple-100 text-purple-700 border-purple-200';
          case TicketStatus.RESOLVED: return 'bg-emerald-100 text-emerald-700 border-emerald-200';
          default: return 'bg-slate-100 text-slate-600 border-slate-200';
      }
  };

  // Metrics (Always use full 'tickets' prop). Every figure here is derived
  // directly from real ticket data — no invented trend percentages or SLA
  // thresholds beyond the >72h "overdue" window already used elsewhere in
  // the app (see the existing `aging: 'On Hold'` filter).
  const metrics = useMemo(() => {
    const total = tickets.length;
    const resolved = tickets.filter(t => t.status === TicketStatus.RESOLVED).length;
    const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
    const pending = tickets.filter(t => t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CANCELLED).length;

    const now = new Date();
    const totalAgeMs = tickets.reduce((acc, t) => acc + (now.getTime() - new Date(t.createdAt).getTime()), 0);
    const avgAgeHours = total > 0 ? Math.round(totalAgeMs / (1000 * 60 * 60) / total) : 0;

    const overdue = tickets.filter(t => {
        if (t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CANCELLED) return false;
        const diff = now.getTime() - new Date(t.createdAt).getTime();
        return diff > 72 * 60 * 60 * 1000;
    }).length;

    const todayStr = now.toDateString();
    const newToday = tickets.filter(t => new Date(t.createdAt).toDateString() === todayStr).length;

    const unassigned = tickets.filter(t =>
        t.status !== TicketStatus.RESOLVED && t.status !== TicketStatus.CANCELLED && !t.assignedTechId
    ).length;

    const carryForward = tickets.filter(t => t.status === TicketStatus.CARRY_FORWARD).length;

    return { total, rate, resolved, pending, avgAgeHours, overdue, newToday, unassigned, carryForward };
  }, [tickets]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(TicketStatus).forEach(s => counts[s] = 0);
    tickets.forEach(t => counts[t.status] = (counts[t.status] || 0) + 1);
    return Object.keys(counts).map(key => ({
        name: formatStatus(key),
        value: counts[key],
        code: key as TicketStatus,
        color: STATUS_COLORS[key]
    })).filter(d => d.value > 0);
  }, [tickets]);

  const agingData = useMemo(() => {
      const now = new Date();
      const fresh = tickets.filter(t => (now.getTime() - new Date(t.createdAt).getTime()) < 24 * 60 * 60 * 1000).length;
      const warning = tickets.filter(t => {
          const diff = now.getTime() - new Date(t.createdAt).getTime();
          return diff >= 24 * 60 * 60 * 1000 && diff < 72 * 60 * 60 * 1000;
      }).length;
      const stalled = tickets.filter(t => (now.getTime() - new Date(t.createdAt).getTime()) >= 72 * 60 * 60 * 1000).length;

      return [
          { name: 'New', label: '<24h', count: fresh, color: COLORS.success },
          { name: 'Attention Required', label: '1-2d', count: warning, color: COLORS.warning },
          { name: 'On Hold', label: '3d+', count: stalled, color: COLORS.danger },
      ];
  }, [tickets]);

  const velocityData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d;
    }).reverse().map(date => {
        const dateStr = date.toISOString().split('T')[0];
        const count = tickets.filter(t => (t.createdAt || '').startsWith(dateStr)).length;
        return {
            name: date.toLocaleDateString('en-US', { weekday: 'short' }),
            value: count
        };
    });
  }, [tickets]);

  const recentActivity = useMemo(() => {
      // Build one event per meaningful status change across all tickets
      // Use updatedAt as the event time, deduplicate by ticket+status
      type ActivityEvent = {
          id: string;
          ticketId: string;
          customerName: string;
          category: string;
          status: TicketStatus;
          techName?: string;
          time: Date;
          priority: string;
      };

      const events: ActivityEvent[] = [];

      // Only include statuses worth showing in the feed
      const showableStatuses = new Set([
          TicketStatus.NEW,
          TicketStatus.ASSIGNED,
          TicketStatus.ON_MY_WAY,
          TicketStatus.ARRIVED,
          TicketStatus.IN_PROGRESS,
          TicketStatus.CARRY_FORWARD,
          TicketStatus.RESOLVED,
      ]);

      tickets.forEach(t => {
          if (!showableStatuses.has(t.status)) return;
          const tech = t.assignedTechId
              ? technicians.find(x => x.id === t.assignedTechId)
              : undefined;
          events.push({
              id: `${t.id}-${t.status}`,
              ticketId: t.id,
              customerName: t.customerName,
              category: t.category || 'Support',
              status: t.status,
              techName: tech?.name,
              time: new Date(t.updatedAt),
              priority: t.priority,
          });
      });

      return events
          .sort((a, b) => b.time.getTime() - a.time.getTime())
          .slice(0, 8);
  }, [tickets, technicians]);

  // Shared focus-visible ring used across interactive Dashboard elements
  const FOCUS_RING = 'focus:outline-none focus-visible:ring-4 focus-visible:ring-[#FFCC00]/40 focus-visible:border-[#FFCC00]';

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 max-w-[1600px] mx-auto motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">

      {/* ============ HEADER ============ */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
              <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                      <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                          {greeting}
                      </h1>
                      <span
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full"
                          title="This dashboard reflects live ticket data"
                      >
                          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                          </span>
                          Live
                      </span>
                  </div>
                  <p className="text-slate-500 text-sm font-medium mt-1.5">
                      Here&apos;s today&apos;s field operations overview — {metrics.pending} active
                      {metrics.overdue > 0 ? `, ${metrics.overdue} need attention` : ', all on track'}.
                  </p>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                  <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 px-3.5 py-2 rounded-lg text-sm font-medium">
                      <Calendar size={16} className="text-slate-500" aria-hidden="true" />
                      {dateBadge}
                  </div>
              </div>
          </div>

          {/* Global Search Bar */}
          <div className="relative w-full lg:w-96 mt-4" ref={searchContainerRef}>
              <label htmlFor="dashboard-ticket-search" className="sr-only">Search tickets by number, client name, or phone</label>
              <Search className="absolute left-3 top-3 text-slate-400" size={18} aria-hidden="true" />
              <input
                  id="dashboard-ticket-search"
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search by Ticket No, Client Name, or Phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onKeyDown={handleKeyDown}
                  role="combobox"
                  aria-expanded={isSearchFocused}
                  aria-controls="dashboard-search-results"
                  aria-autocomplete="list"
                  className={SEARCH_INPUT_STYLES}
              />

              {/* Autocomplete Dropdown */}
              {isSearchFocused && (
                  <div
                      id="dashboard-search-results"
                      role="listbox"
                      className="absolute top-full left-0 w-full mt-2 bg-white rounded-lg shadow-xl border border-slate-100 max-h-[400px] overflow-y-auto z-50 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
                  >
                      {searchResults.length > 0 ? (
                          <div className="py-2">
                              <div className="px-3 pb-2 mb-1 border-b border-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                                  <span>{searchQuery ? 'Search Results' : 'Recent Tickets'}</span>
                                  {!searchQuery && <History size={12} aria-hidden="true" />}
                              </div>
                              {searchResults.map((ticket, index) => (
                                  <button
                                      key={ticket.id}
                                      role="option"
                                      aria-selected={activeSearchIndex === index}
                                      onClick={() => handleTicketSelect(ticket)}
                                      onMouseEnter={() => setActiveSearchIndex(index)}
                                      className={`w-full text-left px-4 py-3 flex justify-between items-center gap-2 group transition-colors ${FOCUS_RING} ${
                                          activeSearchIndex === index ? 'bg-slate-50' : 'hover:bg-slate-50'
                                      }`}
                                  >
                                      <div className="min-w-0">
                                          <div className="text-sm text-slate-800 flex items-center gap-2">
                                              <span className="font-bold">
                                                  <HighlightText text={ticket.id} highlight={searchQuery} />
                                              </span>
                                              <span className="text-slate-300">|</span>
                                              <span className="truncate max-w-[140px] font-medium">
                                                  <HighlightText text={ticket.customerName} highlight={searchQuery} />
                                              </span>
                                          </div>
                                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                                              <span>•••• {ticket.phoneNumber.slice(-4)}</span>
                                              <span>•</span>
                                              <span className="truncate max-w-[100px]">{ticket.category}</span>
                                          </div>
                                      </div>
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap shrink-0 ${getStatusBadgeStyle(ticket.status)}`}>
                                          {formatStatus(ticket.status)}
                                      </span>
                                  </button>
                              ))}
                          </div>
                      ) : (
                          <div className="p-8 text-center text-slate-500 text-sm flex flex-col items-center gap-2">
                              {searchQuery ? (
                                  <>
                                      <Search size={24} className="text-slate-300" aria-hidden="true" />
                                      <span>No tickets found matching &quot;{searchQuery}&quot;</span>
                                  </>
                              ) : (
                                  <>
                                      <History size={24} className="text-slate-300" aria-hidden="true" />
                                      <span>No recent history</span>
                                  </>
                              )}
                          </div>
                      )}
                  </div>
              )}
          </div>
      </div>

      {/* ============ KPI AREA ============ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <button
            type="button"
            onClick={() => onNavigate({ description: 'All Tickets' })}
            className={`text-left bg-white p-4 sm:p-5 rounded-xl shadow-sm border border-slate-200 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all motion-reduce:transition-none group ${FOCUS_RING}`}
            aria-label={`Total tickets: ${metrics.total}. View all tickets.`}
        >
            <div className="flex justify-between items-start mb-3 sm:mb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                    <Activity size={20} aria-hidden="true" />
                </div>
            </div>
            <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-1">{metrics.total}</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Total Tickets</p>
                <p className="text-xs text-slate-400 mt-1">{metrics.newToday} logged today</p>
            </div>
        </button>

        <div className="bg-white p-4 sm:p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-3 sm:mb-4">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <CheckCircle size={20} aria-hidden="true" />
                </div>
            </div>
            <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-1">{metrics.rate}%</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Resolution Rate</p>
                <p className="text-xs text-slate-400 mt-1">{metrics.resolved} of {metrics.total} resolved</p>
            </div>
        </div>

        <button
            type="button"
            onClick={() => onNavigate({
                status: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
                description: 'Pending Inquiries'
            })}
            className={`text-left bg-white p-4 sm:p-5 rounded-xl shadow-sm border border-slate-200 cursor-pointer hover:shadow-md hover:border-amber-200 transition-all motion-reduce:transition-none group ${FOCUS_RING}`}
            aria-label={`Pending tickets: ${metrics.pending}. View active queue.`}
        >
            <div className="flex justify-between items-start mb-3 sm:mb-4">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg group-hover:bg-amber-100 transition-colors">
                    <AlertCircle size={20} aria-hidden="true" />
                </div>
            </div>
            <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-1">{metrics.pending}</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Pending</p>
                <p className="text-xs text-slate-400 mt-1">Active Queue</p>
            </div>
        </button>

        <div className="bg-white p-4 sm:p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-3 sm:mb-4">
                <div className="p-2 bg-slate-100 text-slate-600 rounded-lg">
                    <Clock size={20} aria-hidden="true" />
                </div>
            </div>
            <div>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-1">{metrics.avgAgeHours}h</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Avg Aging</p>
                <p className="text-xs text-slate-400 mt-1">Per ticket, all-time</p>
            </div>
        </div>

        <button
            type="button"
            onClick={() => onNavigate({ aging: 'On Hold', description: 'Overdue Tickets (>3 Days)' })}
            className={`text-left col-span-2 sm:col-span-1 p-4 sm:p-5 rounded-xl shadow-sm border cursor-pointer hover:shadow-md transition-all motion-reduce:transition-none ${FOCUS_RING} ${
                metrics.overdue > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-slate-200'
            }`}
            aria-label={`Overdue tickets: ${metrics.overdue}. Requires attention.`}
        >
            <div className="flex justify-between items-start mb-3 sm:mb-4">
                <div className={`p-2 rounded-lg ${metrics.overdue > 0 ? 'bg-red-200 text-red-700' : 'bg-slate-100 text-slate-400'}`}>
                    <AlertTriangle size={20} aria-hidden="true" />
                </div>
                {metrics.overdue > 0 && (
                     <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded">
                        Action Req.
                    </span>
                )}
            </div>
            <div>
                <h3 className={`text-2xl sm:text-3xl font-bold mb-1 ${metrics.overdue > 0 ? 'text-red-700' : 'text-slate-800'}`}>
                    {metrics.overdue}
                </h3>
                <p className={`text-xs font-medium uppercase tracking-wide ${metrics.overdue > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                    Overdue (&gt;3d)
                </p>
                <p className={`text-xs mt-1 ${metrics.overdue > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    Requires Attention
                </p>
            </div>
        </button>
      </div>

      {/* ============ ATTENTION REQUIRED ============ */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
              <div>
                  <h4 className="text-lg font-bold text-slate-800">Attention Required</h4>
                  <p className="text-sm text-slate-500">Work that needs a decision or a hand</p>
              </div>
          </div>

          {metrics.overdue === 0 && metrics.unassigned === 0 && metrics.carryForward === 0 ? (
              <div className="flex items-center gap-3 py-6 px-4 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700">
                  <CheckCircle size={20} aria-hidden="true" />
                  <span className="text-sm font-semibold">All caught up — nothing needs attention right now.</span>
              </div>
          ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                      type="button"
                      onClick={() => onNavigate({ aging: 'On Hold', description: 'Overdue Tickets (>3 Days)' })}
                      className={`text-left flex items-center gap-3 p-4 rounded-lg border transition-colors motion-reduce:transition-none ${FOCUS_RING} ${
                          metrics.overdue > 0
                              ? 'bg-red-50 border-red-100 hover:bg-red-100/70'
                              : 'bg-slate-50 border-slate-100 hover:bg-slate-100/70'
                      }`}
                  >
                      <span className={`p-2 rounded-lg shrink-0 ${metrics.overdue > 0 ? 'bg-red-200 text-red-700' : 'bg-slate-200 text-slate-500'}`}>
                          <AlertTriangle size={18} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                          <span className={`block text-xl font-bold ${metrics.overdue > 0 ? 'text-red-700' : 'text-slate-700'}`}>{metrics.overdue}</span>
                          <span className="block text-xs font-medium text-slate-500">Overdue &gt;3 days</span>
                      </span>
                  </button>

                  <div
                      className={`flex items-center gap-3 p-4 rounded-lg border ${
                          metrics.unassigned > 0 ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'
                      }`}
                      title="Not filterable from this view — check the Assigned column in Active Tickets"
                  >
                      <span className={`p-2 rounded-lg shrink-0 ${metrics.unassigned > 0 ? 'bg-amber-200 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>
                          <UserX size={18} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                          <span className={`block text-xl font-bold ${metrics.unassigned > 0 ? 'text-amber-700' : 'text-slate-700'}`}>{metrics.unassigned}</span>
                          <span className="block text-xs font-medium text-slate-500">Unassigned tickets</span>
                      </span>
                  </div>

                  <button
                      type="button"
                      onClick={() => onNavigate({ status: [TicketStatus.CARRY_FORWARD], description: 'Carry Forward Tickets' })}
                      className={`text-left flex items-center gap-3 p-4 rounded-lg border transition-colors motion-reduce:transition-none ${FOCUS_RING} ${
                          metrics.carryForward > 0
                              ? 'bg-orange-50 border-orange-100 hover:bg-orange-100/70'
                              : 'bg-slate-50 border-slate-100 hover:bg-slate-100/70'
                      }`}
                  >
                      <span className={`p-2 rounded-lg shrink-0 ${metrics.carryForward > 0 ? 'bg-orange-200 text-orange-700' : 'bg-slate-200 text-slate-500'}`}>
                          <CornerDownRight size={18} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                          <span className={`block text-xl font-bold ${metrics.carryForward > 0 ? 'text-orange-700' : 'text-slate-700'}`}>{metrics.carryForward}</span>
                          <span className="block text-xs font-medium text-slate-500">Carry-forward work</span>
                      </span>
                  </button>
              </div>
          )}
      </div>

      {/* ============ CHARTS ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
          <div className="bg-white p-5 sm:p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
              <h4 className="text-lg font-bold text-slate-800 mb-1">Service Status Overview</h4>
              <p className="text-sm text-slate-500 mb-4">Current distribution of ticket statuses</p>

              {metrics.total === 0 ? (
                  <ChartEmptyState label="No tickets yet" />
              ) : (
                  <>
                      <div className="flex-1 min-h-[200px] relative" role="img" aria-label={`Pie chart of ${metrics.total} tickets by status`}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={statusData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={70}
                                    outerRadius={90}
                                    paddingAngle={5}
                                    dataKey="value"
                                    cursor="pointer"
                                    stroke="none"
                                    onClick={(data) => {
                                        onNavigate({
                                            status: [data.code],
                                            description: `Status: ${data.name}`
                                        });
                                    }}
                                >
                                    {statusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-3xl font-bold text-slate-800">{metrics.total}</span>
                            <span className="text-xs font-medium text-slate-400 uppercase">Tickets</span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                          {statusData.map((item, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-xs">
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} aria-hidden="true" />
                                  <span className="text-slate-600 font-medium">{item.name}</span>
                                  <span className="text-slate-400 ml-auto">{Math.round((item.value / metrics.total) * 100)}%</span>
                              </div>
                          ))}
                      </div>
                  </>
              )}
          </div>

          {/* Trend Chart */}
          <div className="lg:col-span-2 bg-white p-5 sm:p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h4 className="text-lg font-bold text-slate-800">Ticket Trend</h4>
                    <p className="text-sm text-slate-500">Inflow velocity over the last 7 days</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded hidden sm:inline">Weekly View</span>
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                        <TrendingUp size={20} aria-hidden="true" />
                    </div>
                </div>
            </div>
            <div className="h-56 sm:h-64 lg:h-72" role="img" aria-label="Area chart of ticket inflow over the last 7 days">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={velocityData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.2}/>
                                <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis
                            dataKey="name"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tick={{fill: '#64748b'}}
                            dy={10}
                        />
                        <YAxis hide domain={[0, 'auto']} />
                        <Tooltip
                            contentStyle={{
                                borderRadius: '12px',
                                border: 'none',
                                boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                                padding: '12px'
                            }}
                            cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={COLORS.purple}
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorVelocity)"
                            activeDot={{ r: 6, strokeWidth: 0, fill: COLORS.purple }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
          <div className="bg-white p-5 sm:p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-6">
                <div>
                    <h4 className="text-lg font-bold text-slate-800">Aging Distribution</h4>
                    <p className="text-sm text-slate-500">Ticket volume by age duration</p>
                </div>
                <div className="p-2 bg-slate-100 text-slate-600 rounded-lg">
                    <Clock size={20} aria-hidden="true" />
                </div>
              </div>
              {metrics.total === 0 ? (
                  <ChartEmptyState label="No tickets to age yet" />
              ) : (
                  <div className="h-56 sm:h-64" role="img" aria-label="Bar chart of ticket volume by age">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={agingData} barSize={60}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis
                                dataKey="label"
                                fontSize={12}
                                axisLine={false}
                                tickLine={false}
                                tick={{fill: '#64748b'}}
                                dy={10}
                            />
                            <YAxis hide />
                            <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                            <Bar
                                dataKey="count"
                                radius={[8, 8, 8, 8]}
                                cursor="pointer"
                                onClick={(data) => {
                                    onNavigate({
                                        aging: data.name as TicketFilter['aging'],
                                        description: `${data.name} Tickets`
                                    });
                                }}
                            >
                                {agingData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                                <LabelList dataKey="count" position="top" style={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                  </div>
              )}
          </div>

          {/* Recent Activity */}
          <div className="bg-white p-5 sm:p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                <div className="flex justify-between items-center mb-5">
                    <h4 className="text-lg font-bold text-slate-800">Recent Activity</h4>
                    <button
                        type="button"
                        onClick={() => onNavigate({ description: 'All Recent Log' })}
                        className={`text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 rounded px-1 ${FOCUS_RING}`}
                    >
                        View All <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                </div>

                <div className="flex-1 space-y-1">
                    {recentActivity.map(event => {
                        // Config per status
                        const cfg: Record<string, { label: string; dot: string; icon: React.ReactNode }> = {
                            [TicketStatus.NEW]:          { label: 'New Ticket',    dot: 'bg-blue-500',    icon: <FileText size={13} aria-hidden="true"/> },
                            [TicketStatus.ASSIGNED]:     { label: 'Assigned',      dot: 'bg-violet-500',  icon: <UserIcon size={13} aria-hidden="true"/> },
                            [TicketStatus.ON_MY_WAY]:    { label: 'On the Way',    dot: 'bg-amber-500',   icon: <ArrowRight size={13} aria-hidden="true"/> },
                            [TicketStatus.ARRIVED]:      { label: 'Arrived',       dot: 'bg-orange-500',  icon: <MapPin size={13} aria-hidden="true"/> },
                            [TicketStatus.IN_PROGRESS]:  { label: 'Work Started',  dot: 'bg-purple-500',  icon: <Activity size={13} aria-hidden="true"/> },
                            [TicketStatus.CARRY_FORWARD]:{ label: 'Carry Forward', dot: 'bg-rose-400',    icon: <Clock size={13} aria-hidden="true"/> },
                            [TicketStatus.RESOLVED]:     { label: 'Resolved',      dot: 'bg-emerald-500', icon: <CheckCircle size={13} aria-hidden="true"/> },
                        };
                        const c = cfg[event.status] ?? { label: event.status, dot: 'bg-slate-400', icon: <FileText size={13} aria-hidden="true"/> };

                        // Relative time
                        const diffMs = Date.now() - event.time.getTime();
                        const diffMin = Math.floor(diffMs / 60000);
                        const timeStr = diffMin < 1 ? 'just now'
                            : diffMin < 60 ? `${diffMin}m ago`
                            : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago`
                            : `${Math.floor(diffMin / 1440)}d ago`;

                        return (
                            <button
                                type="button"
                                key={event.id}
                                className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors motion-reduce:transition-none group ${FOCUS_RING}`}
                                onClick={() => {
                                    const ticket = tickets.find(t => t.id === event.ticketId);
                                    if (ticket && (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CANCELLED || ticket.status === 'CARRY_FORWARD' as any)) {
                                        setPreviewTicket(ticket);
                                    } else {
                                        onNavigate({ ticketId: event.ticketId });
                                    }
                                }}
                            >
                                {/* Dot */}
                                <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} aria-hidden="true"/>

                                {/* Icon + Event label */}
                                <span className="text-slate-400 shrink-0">{c.icon}</span>
                                <span className="text-xs font-semibold text-slate-700 w-24 shrink-0 truncate">{c.label}</span>

                                {/* Customer + category */}
                                <div className="flex-1 min-w-0">
                                    <span className="text-xs font-bold text-slate-800 truncate block">
                                        {event.customerName}
                                    </span>
                                    <span className="text-[10px] text-slate-400 truncate block">
                                        {event.category}{event.techName ? ` · ${event.techName}` : ''}
                                    </span>
                                </div>

                                {/* Ticket ID */}
                                <span className="text-[10px] font-mono text-slate-400 shrink-0 hidden sm:block">
                                    {event.ticketId}
                                </span>

                                {/* Time */}
                                <span className="text-[10px] text-slate-400 shrink-0 w-14 text-right">
                                    {timeStr}
                                </span>

                                <ChevronRight size={14} className="text-slate-300 group-hover:text-emerald-500 transition-colors shrink-0" aria-hidden="true"/>
                            </button>
                        );
                    })}
                    {recentActivity.length === 0 && (
                        <div className="text-center text-slate-400 py-8 text-sm">No recent activity</div>
                    )}
                </div>
          </div>
      </div>

      {/* --- Global Search Modal --- */}
      {activeModalTicket && (
          <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dashboard-ticket-modal-title"
              onClick={() => setSelectedSearchTicket(null)}
          >
              <div
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-200"
                  onClick={e => e.stopPropagation()}
              >
                  {/* Modal Header */}
                  <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                      <div className="flex items-center gap-3">
                          <h3 id="dashboard-ticket-modal-title" className="font-bold text-lg text-slate-900">{activeModalTicket.id}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold border uppercase tracking-wide ${getStatusBadgeStyle(activeModalTicket.status)}`}>
                              {activeModalTicket.status.replace('_', ' ')}
                          </span>
                      </div>
                      <button
                          type="button"
                          onClick={() => setSelectedSearchTicket(null)}
                          className={`p-1 rounded-full hover:bg-slate-200 transition-colors ${FOCUS_RING}`}
                          aria-label="Close ticket details"
                      >
                          <X size={20} className="text-slate-500 hover:text-slate-700"/>
                      </button>
                  </div>

                  {/* Modal Body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                      {/* Customer Info */}
                      <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                              <UserIcon size={24} className="text-slate-400" aria-hidden="true" />
                          </div>
                          <div>
                              <h4 className="text-lg font-bold text-slate-800">{activeModalTicket.customerName}</h4>
                              <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                                  <span className="flex items-center gap-1"><Phone size={14} aria-hidden="true" /> {activeModalTicket.phoneNumber}</span>
                              </div>
                          </div>
                      </div>

                      {/* Key Attributes */}
                      <div className="grid grid-cols-2 gap-4">
                           <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Category</div>
                               <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                                   <Tag size={14} aria-hidden="true" /> {activeModalTicket.category}
                               </div>
                           </div>
                           <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Priority</div>
                               <div className={`text-sm font-bold flex items-center gap-1.5 ${
                                   activeModalTicket.priority === Priority.URGENT ? 'text-red-600' :
                                   activeModalTicket.priority === Priority.HIGH ? 'text-orange-600' : 'text-slate-700'
                               }`}>
                                   <AlertCircle size={14} aria-hidden="true" /> {activeModalTicket.priority}
                               </div>
                           </div>
                      </div>

                      {/* Location & Details */}
                      <div className="space-y-4">
                          <div>
                              <div className="text-xs font-bold text-slate-400 uppercase mb-2">Location</div>
                              <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-2 text-sm text-slate-700">
                                      <Home size={16} className="text-slate-400" aria-hidden="true" />
                                      <span>{activeModalTicket.houseNumber || 'No house number'}</span>
                                  </div>
                                  {activeModalTicket.locationUrl ? (
                                      <a href={activeModalTicket.locationUrl} target="_blank" rel="noreferrer" className={`flex items-center gap-2 text-sm text-blue-600 hover:underline rounded ${FOCUS_RING}`}>
                                          <MapPin size={16} aria-hidden="true" /> Open in Maps
                                      </a>
                                  ) : <span className="text-sm text-slate-400 italic">No map link</span>}
                              </div>
                          </div>

                          {/* Quick Actions Panel */}
                          {onUpdateTicket && (
                             <div className="border-t border-slate-100 pt-4">
                                 <div className="text-xs font-bold text-slate-400 uppercase mb-2">Quick Actions</div>
                                 <div className="grid grid-cols-2 gap-3">
                                     {/* Status Update */}
                                     <div>
                                         <label htmlFor="dashboard-modal-status" className="sr-only">Update ticket status</label>
                                         <select
                                            id="dashboard-modal-status"
                                            value={activeModalTicket.status}
                                            onChange={(e) => onUpdateTicket({...activeModalTicket, status: e.target.value as TicketStatus})}
                                            className={`w-full text-xs p-2 rounded-lg bg-white border border-slate-300 ${FOCUS_RING}`}
                                         >
                                             {Object.values(TicketStatus).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                                         </select>
                                     </div>

                                     {/* Assignment (Admin/Lead only) */}
                                     {canAssign ? (
                                        <div>
                                            <label htmlFor="dashboard-modal-assign" className="sr-only">Assign engineer</label>
                                            <select
                                                id="dashboard-modal-assign"
                                                value={activeModalTicket.assignedTechId || ''}
                                                onChange={(e) => onUpdateTicket({...activeModalTicket, assignedTechId: e.target.value})}
                                                className={`w-full text-xs p-2 rounded-lg bg-white border border-slate-300 ${FOCUS_RING}`}
                                            >
                                                <option value="" disabled>Assign Engineer</option>
                                                {technicians.filter(t => t.level === 'TEAM_LEAD').map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                     ) : (
                                         <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                                             <UserIcon size={12} aria-hidden="true" />
                                             {technicians.find(t => t.id === activeModalTicket.assignedTechId)?.name || 'Unassigned'}
                                         </div>
                                     )}
                                 </div>
                             </div>
                          )}

                          {/* Description Section */}
                          <div className="border-t border-slate-100 pt-4">
                              <div className="text-xs font-bold text-slate-400 uppercase mb-2">Initial Description</div>
                              <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                  {activeModalTicket.messages?.[0]?.content || 'No description provided.'}
                              </p>
                          </div>

                          {/* Latest Activity (If different) */}
                          {isLatestDifferent && latestMessage && (
                             <div className="pt-2">
                                <div className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                                    <MessageSquare size={12} aria-hidden="true" /> Latest Activity
                                </div>
                                <div className={`text-sm p-3 rounded-lg border ${latestMessage.sender === 'AGENT' ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                                    <p className="font-semibold text-xs mb-1 opacity-75">{latestMessage.sender === 'AGENT' ? 'Support Agent' : 'Customer'}:</p>
                                    {latestMessage.content}
                                </div>
                             </div>
                          )}

                          <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
                               <div>Created: {new Date(activeModalTicket.createdAt).toLocaleDateString()}</div>
                               {activeModalTicket.appointmentTime && (
                                   <div className="text-right font-medium text-emerald-600">
                                       Appt: {new Date(activeModalTicket.appointmentTime).toLocaleDateString()}
                                   </div>
                               )}
                          </div>
                      </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedSearchTicket(null)}
                        className={`px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors ${FOCUS_RING}`}
                      >
                          Close
                      </button>

                      {/* Navigate to Ticket Management for Editing */}
                      <button
                        type="button"
                        onClick={() => {
                            onNavigate({ ticketId: activeModalTicket.id, description: 'Ticket Detail' });
                            setSelectedSearchTicket(null);
                        }}
                        className={`px-4 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-lg shadow-slate-900/10 ${FOCUS_RING}`}
                      >
                          <span>Open Full Details</span>
                          <ArrowRight size={16} aria-hidden="true" />
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Ticket Preview Popup (Read-Only Summary) */}
      {previewTicket && (() => {
          const t = previewTicket as any;
          const tech = technicians.find(tc => tc.id === t.assignedTechId);
          const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
          const statusColor = t.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-700' : t.status === 'CARRY_FORWARD' ? 'bg-orange-100 text-orange-700' : t.status === 'CANCELLED' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600';
          const issueText = t.messages?.find((m: any) => m.sender === 'CLIENT')?.content || t.notes || t.ai_summary || '';
          return (
              <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="dashboard-preview-title"
                  onClick={() => setPreviewTicket(null)}
              >
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                      <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                          <div>
                              <div className="text-[10px] font-mono text-slate-400">{t.id}</div>
                              <h3 id="dashboard-preview-title" className="font-bold text-slate-900">{t.category}</h3>
                          </div>
                          <div className="flex items-center gap-2">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${statusColor}`}>{(t.status || '').replace(/_/g, ' ')}</span>
                              <button
                                type="button"
                                onClick={() => setPreviewTicket(null)}
                                className={`p-1 hover:bg-slate-200 rounded-lg ${FOCUS_RING}`}
                                aria-label="Close ticket preview"
                              >✕</button>
                          </div>
                      </div>
                      <div className="flex-1 overflow-y-auto p-5 space-y-4">
                          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-1">
                              <div className="text-[10px] font-bold text-slate-400 uppercase">Customer</div>
                              <div className="text-sm font-bold text-slate-800">{t.customerName}</div>
                              {t.phoneNumber && <div className="text-xs text-slate-500">{t.phoneNumber}</div>}
                          </div>
                          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 grid grid-cols-2 gap-2">
                              <div><span className="text-[10px] text-slate-400 block">Type</span><span className="text-xs font-medium">{t.type || '—'}</span></div>
                              <div><span className="text-[10px] text-slate-400 block">Priority</span><span className="text-xs font-medium">{t.priority}</span></div>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-1">
                              <div className="text-[10px] font-bold text-slate-400 uppercase">Timing</div>
                              <div className="flex justify-between text-xs"><span className="text-slate-400">Created</span><span>{fmtDt(t.createdAt)}</span></div>
                              {t.startedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Started</span><span className="text-emerald-600">{fmtDt(t.startedAt)}</span></div>}
                              {t.completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Completed</span><span className="text-emerald-600">{fmtDt(t.completedAt)}</span></div>}
                          </div>
                          {tech && <div className="bg-slate-50 rounded-xl p-3 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Assigned To</div><div className="text-xs font-bold">{tech.name}</div></div>}
                          {issueText && <div className="bg-slate-50 rounded-xl p-3 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Description</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{issueText}</p></div>}
                          {t.completionNote && <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100"><div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Completion</div><p className="text-xs text-emerald-800 whitespace-pre-wrap">{t.completionNote}</p></div>}
                          {t.carryForwardNote && <div className="bg-amber-50 rounded-xl p-3 border border-amber-200"><div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div><p className="text-xs text-amber-800 whitespace-pre-wrap">{t.carryForwardNote}</p></div>}
                      </div>
                      <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 flex gap-3">
                          <button type="button" onClick={() => setPreviewTicket(null)} className={`flex-1 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-bold text-sm ${FOCUS_RING}`}>Close</button>
                          <button type="button" onClick={() => { setPreviewTicket(null); onNavigate({ ticketId: t.id }); }} className={`flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm ${FOCUS_RING}`}>Edit Ticket</button>
                      </div>
                  </div>
              </div>
          );
      })()}
    </div>
  );
};

export default React.memo(Dashboard);
