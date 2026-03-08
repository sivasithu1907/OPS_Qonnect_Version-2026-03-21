import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticket, TicketStatus, TicketFilter, Priority, User, Role, Technician } from '../types';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  AreaChart, Area, LabelList
} from 'recharts';
import { 
  AlertCircle, CheckCircle, Clock, Activity, TrendingUp, 
  FileText, ArrowUpRight, AlertTriangle, ArrowDownRight, ArrowUp,
  ChevronRight, Zap, Search, Calendar, X, MapPin, Phone, User as UserIcon,
  Tag, Link as LinkIcon, Home, History, ArrowRight, MessageSquare
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
                        <span key={i} className="bg-yellow-200 text-slate-900 rounded-[1px]">{part}</span>
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

const Dashboard: React.FC<DashboardProps> = ({ tickets, technicians = [], onNavigate, currentUser, onUpdateTicket }) => {
  // --- Search State (Decoupled from Dashboard Logic) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [selectedSearchTicket, setSelectedSearchTicket] = useState<Ticket | null>(null);
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
  
  // --- Dashboard Logic (Using FULL ticket list, NOT filtered by search) ---

  const dateBadge = useMemo(() => {
      const today = new Date();
      return today.toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
      });
  }, []);

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

  // Metrics (Always use full 'tickets' prop)
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

    return { total, rate, pending, avgAgeHours, overdue };
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
      return [...tickets]
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5);
  }, [tickets]);

  return (
    <div className="p-8 space-y-8 animate-in fade-in zoom-in duration-300 max-w-[1600px] mx-auto">
      
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-4 border-b border-slate-100 pb-6">
          <div className="space-y-4 w-full md:w-auto relative z-20">
              <div>
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Service Overview</h1>
                  <p className="text-slate-500 text-sm font-medium mt-1">Real-time operational metrics and ticket analytics.</p>
              </div>
              
              {/* Global Search Bar */}
              <div className="relative w-full md:w-96" ref={searchContainerRef}>
                  <Search className="absolute left-3 top-3 text-slate-400" size={18} />
                  <input 
                      ref={searchInputRef}
                      type="text" 
                      placeholder="Search by Ticket No, Client Name, or Phone..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => setIsSearchFocused(true)}
                      onKeyDown={handleKeyDown}
                      className={SEARCH_INPUT_STYLES}
                  />

                  {/* Autocomplete Dropdown */}
                  {isSearchFocused && (
                      <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-lg shadow-xl border border-slate-100 max-h-[400px] overflow-y-auto z-50 animate-in fade-in zoom-in-95 duration-100">
                          {searchResults.length > 0 ? (
                              <div className="py-2">
                                  <div className="px-3 pb-2 mb-1 border-b border-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                                      <span>{searchQuery ? 'Search Results' : 'Recent Tickets'}</span>
                                      {!searchQuery && <History size={12} />}
                                  </div>
                                  {searchResults.map((ticket, index) => (
                                      <button 
                                          key={ticket.id}
                                          onClick={() => handleTicketSelect(ticket)}
                                          onMouseEnter={() => setActiveSearchIndex(index)}
                                          className={`w-full text-left px-4 py-3 flex justify-between items-center group transition-colors ${
                                              activeSearchIndex === index ? 'bg-slate-50' : 'hover:bg-slate-50'
                                          }`}
                                      >
                                          <div>
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
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${getStatusBadgeStyle(ticket.status)}`}>
                                              {formatStatus(ticket.status)}
                                          </span>
                                      </button>
                                  ))}
                              </div>
                          ) : (
                              <div className="p-8 text-center text-slate-500 text-sm flex flex-col items-center gap-2">
                                  {searchQuery ? (
                                      <>
                                          <Search size={24} className="text-slate-300" />
                                          <span>No tickets found matching "{searchQuery}"</span>
                                      </>
                                  ) : (
                                      <>
                                          <History size={24} className="text-slate-300" />
                                          <span>No recent history</span>
                                      </>
                                  )}
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>

          {/* Date Badge */}
          <div className="shrink-0 hidden md:block">
              <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium shadow-sm">
                  <Calendar size={16} className="text-slate-500" />
                  {dateBadge}
              </div>
          </div>
      </div>

      {/* --- DASHBOARD WIDGETS (Filtered only by clicking widgets, NOT by search) --- */}
      
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        <div 
            onClick={() => onNavigate({ description: 'All Tickets' })}
            className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                    <Activity size={20} />
                </div>
                <span className="text-xs font-medium text-emerald-600 flex items-center gap-0.5 bg-emerald-50 px-1.5 py-0.5 rounded">
                    <ArrowUp size={12} /> 12%
                </span>
            </div>
            <div>
                <h3 className="text-3xl font-bold text-slate-800 mb-1">{metrics.total}</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Total Tickets</p>
                <p className="text-xs text-slate-400 mt-1">vs. last 30 days</p>
            </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <CheckCircle size={20} />
                </div>
                <span className="text-xs font-medium text-emerald-600 flex items-center gap-0.5 bg-emerald-50 px-1.5 py-0.5 rounded">
                    <ArrowUp size={12} /> 5%
                </span>
            </div>
            <div>
                <h3 className="text-3xl font-bold text-slate-800 mb-1">{metrics.rate}%</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Resolution Rate</p>
                <p className="text-xs text-slate-400 mt-1">Target: 85%</p>
            </div>
        </div>

        <div 
            onClick={() => onNavigate({ 
                status: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
                description: 'Pending Inquiries'
            })}
            className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 cursor-pointer hover:shadow-md hover:border-amber-200 transition-all group"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg group-hover:bg-amber-100 transition-colors">
                    <AlertCircle size={20} />
                </div>
                <span className="text-xs font-medium text-amber-600 flex items-center gap-0.5 bg-amber-50 px-1.5 py-0.5 rounded">
                    <ArrowUp size={12} /> 2
                </span>
            </div>
            <div>
                <h3 className="text-3xl font-bold text-slate-800 mb-1">{metrics.pending}</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Pending</p>
                <p className="text-xs text-slate-400 mt-1">Active Queue</p>
            </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-slate-100 text-slate-600 rounded-lg">
                    <Clock size={20} />
                </div>
                <span className="text-xs font-medium text-emerald-600 flex items-center gap-0.5 bg-emerald-50 px-1.5 py-0.5 rounded">
                    <ArrowDownRight size={12} /> 1.5h
                </span>
            </div>
            <div>
                <h3 className="text-3xl font-bold text-slate-800 mb-1">{metrics.avgAgeHours}h</h3>
                <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Avg Aging</p>
                <p className="text-xs text-slate-400 mt-1">Per Ticket</p>
            </div>
        </div>

        <div 
            onClick={() => onNavigate({ aging: 'On Hold', description: 'Overdue Tickets (>3 Days)' })}
            className={`p-5 rounded-xl shadow-sm border cursor-pointer hover:shadow-md transition-all ${
                metrics.overdue > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-slate-200'
            }`}
        >
            <div className="flex justify-between items-start mb-4">
                <div className={`p-2 rounded-lg ${metrics.overdue > 0 ? 'bg-red-200 text-red-700' : 'bg-slate-100 text-slate-400'}`}>
                    <AlertTriangle size={20} />
                </div>
                {metrics.overdue > 0 && (
                     <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded animate-pulse">
                        Action Req.
                    </span>
                )}
            </div>
            <div>
                <h3 className={`text-3xl font-bold mb-1 ${metrics.overdue > 0 ? 'text-red-700' : 'text-slate-800'}`}>
                    {metrics.overdue}
                </h3>
                <p className={`text-xs font-medium uppercase tracking-wide ${metrics.overdue > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                    Overdue (&gt;3d)
                </p>
                <p className={`text-xs mt-1 ${metrics.overdue > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    Requires Attention
                </p>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status Chart */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
              <h4 className="text-lg font-bold text-slate-800 mb-2">Service Status Overview</h4>
              <p className="text-sm text-slate-500 mb-4">Current distribution of ticket statuses</p>
              
              <div className="flex-1 min-h-[200px] relative">
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
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className="text-slate-600 font-medium">{item.name}</span>
                          <span className="text-slate-400 ml-auto">{Math.round((item.value / metrics.total) * 100)}%</span>
                      </div>
                  ))}
              </div>
          </div>

          {/* Trend Chart */}
          <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h4 className="text-lg font-bold text-slate-800">Ticket Trend</h4>
                    <p className="text-sm text-slate-500">Inflow velocity over the last 7 days</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">Weekly View</span>
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                        <TrendingUp size={20} />
                    </div>
                </div>
            </div>
            <div className="h-72">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-6">
                <div>
                    <h4 className="text-lg font-bold text-slate-800">Aging Distribution</h4>
                    <p className="text-sm text-slate-500">Ticket volume by age duration</p>
                </div>
                <div className="p-2 bg-slate-100 text-slate-600 rounded-lg">
                    <Clock size={20} />
                </div>
              </div>
              <div className="h-64">
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
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h4 className="text-lg font-bold text-slate-800">Recent Activity</h4>
                    <button 
                        onClick={() => onNavigate({ description: 'All Recent Log' })}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                    >
                        View All <ArrowUpRight size={14} />
                    </button>
                </div>
                
                <div className="space-y-4 flex-1">
                    {recentActivity.map(ticket => {
                        const isUrgent = ticket.priority === Priority.URGENT || ticket.priority === Priority.HIGH;
                        return (
                            <div 
                                key={ticket.id} 
                                className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                                    isUrgent ? 'bg-red-50/50 border-red-100' : 'bg-white border-slate-100 hover:border-slate-200'
                                }`}
                            >
                                <div className={`mt-1 p-2 rounded-lg shrink-0 ${
                                    ticket.status === TicketStatus.RESOLVED ? 'bg-emerald-100 text-emerald-600' : 
                                    isUrgent ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                                }`}>
                                    {ticket.status === TicketStatus.RESOLVED ? <CheckCircle size={16}/> : isUrgent ? <Zap size={16}/> : <FileText size={16} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex justify-between items-start">
                                        <p className="text-sm font-bold text-slate-900 truncate">{ticket.customerName}</p>
                                        <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2">
                                            {Math.floor((new Date().getTime() - new Date(ticket.updatedAt).getTime()) / (1000 * 60))}m ago
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                                        {ticket.messages && ticket.messages.length > 0 ? ticket.messages[ticket.messages.length-1]?.content : 'No messages'}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-[10px] bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 font-mono">
                                            {ticket.id}
                                        </span>
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                            ticket.status === TicketStatus.RESOLVED ? 'bg-emerald-100 text-emerald-700' :
                                            ticket.status === TicketStatus.NEW ? 'bg-blue-100 text-blue-700' :
                                            'bg-slate-100 text-slate-600'
                                        }`}>
                                            {formatStatus(ticket.status)}
                                        </span>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => handleTicketSelect(ticket)}
                                    className="self-center text-slate-300 hover:text-emerald-600 p-2 rounded-full hover:bg-slate-50 transition-colors"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col m-4 animate-in zoom-in-95 duration-200">
                  {/* Modal Header */}
                  <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                      <div className="flex items-center gap-3">
                          <h3 className="font-bold text-lg text-slate-900">{activeModalTicket.id}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold border uppercase tracking-wide ${getStatusBadgeStyle(activeModalTicket.status)}`}>
                              {activeModalTicket.status.replace('_', ' ')}
                          </span>
                      </div>
                      <button onClick={() => setSelectedSearchTicket(null)} className="p-1 rounded-full hover:bg-slate-200 transition-colors">
                          <X size={20} className="text-slate-500 hover:text-slate-700"/>
                      </button>
                  </div>
                  
                  {/* Modal Body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                      {/* Customer Info */}
                      <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                              <UserIcon size={24} className="text-slate-400" />
                          </div>
                          <div>
                              <h4 className="text-lg font-bold text-slate-800">{activeModalTicket.customerName}</h4>
                              <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                                  <span className="flex items-center gap-1"><Phone size={14} /> {activeModalTicket.phoneNumber}</span>
                              </div>
                          </div>
                      </div>

                      {/* Key Attributes */}
                      <div className="grid grid-cols-2 gap-4">
                           <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Category</div>
                               <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                                   <Tag size={14} /> {activeModalTicket.category}
                               </div>
                           </div>
                           <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                               <div className="text-xs text-slate-400 font-bold uppercase mb-1">Priority</div>
                               <div className={`text-sm font-bold flex items-center gap-1.5 ${
                                   activeModalTicket.priority === Priority.URGENT ? 'text-red-600' :
                                   activeModalTicket.priority === Priority.HIGH ? 'text-orange-600' : 'text-slate-700'
                               }`}>
                                   <AlertCircle size={14} /> {activeModalTicket.priority}
                               </div>
                           </div>
                      </div>

                      {/* Location & Details */}
                      <div className="space-y-4">
                          <div>
                              <div className="text-xs font-bold text-slate-400 uppercase mb-2">Location</div>
                              <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-2 text-sm text-slate-700">
                                      <Home size={16} className="text-slate-400" />
                                      <span>{activeModalTicket.houseNumber || 'No house number'}</span>
                                  </div>
                                  {activeModalTicket.locationUrl ? (
                                      <a href={activeModalTicket.locationUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                          <MapPin size={16} /> Open in Maps
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
                                         <select 
                                            value={activeModalTicket.status}
                                            onChange={(e) => onUpdateTicket({...activeModalTicket, status: e.target.value as TicketStatus})}
                                            className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 focus:ring-2 focus:ring-slate-900 outline-none"
                                         >
                                             {Object.values(TicketStatus).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                                         </select>
                                     </div>
                                     
                                     {/* Assignment (Admin/Lead only) */}
                                     {canAssign ? (
                                        <div>
                                            <select 
                                                value={activeModalTicket.assignedTechId || ''}
                                                onChange={(e) => onUpdateTicket({...activeModalTicket, assignedTechId: e.target.value})}
                                                className="w-full text-xs p-2 rounded-lg bg-white border border-slate-300 focus:ring-2 focus:ring-slate-900 outline-none"
                                            >
                                                <option value="" disabled>Assign Engineer</option>
                                                {technicians.filter(t => t.level === 'TEAM_LEAD').map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                     ) : (
                                         <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                                             <UserIcon size={12} />
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
                                    <MessageSquare size={12} /> Latest Activity
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
                        onClick={() => setSelectedSearchTicket(null)}
                        className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors"
                      >
                          Close
                      </button>
                      
                      {/* Navigate to Ticket Management for Editing */}
                      <button 
                        onClick={() => {
                            onNavigate({ ticketId: activeModalTicket.id, description: 'Ticket Detail' });
                            setSelectedSearchTicket(null);
                        }}
                        className="px-4 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-lg shadow-slate-900/10"
                      >
                          <span>Open Full Details</span>
                          <ArrowRight size={16} />
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Dashboard;
