import React, { useState, useMemo, useEffect } from 'react';
import { 
  APP_NAME, NAVIGATION_ITEMS, MOCK_TICKETS, MOCK_TECHNICIANS, 
  MOCK_ACTIVITIES, MOCK_TEAMS, MOCK_SITES, MOCK_CUSTOMERS 
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
import FlowSimulator from './components/FlowSimulator';
import IntegrationGuide from './components/IntegrationGuide';
import CustomerRecords from './components/CustomerRecords';
import AIChatBot from './components/AIChatBot';
import SystemDataTools from './components/SystemDataTools';
import WhatsAppMonitor from './components/WhatsAppMonitor';
import { Menu, Bell, Search, LogOut, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { generateActivityId, generateTicketId } from './utils/idUtils';

// Logo Component
const QonnectLogo = ({ className }: { className?: string }) => (
  <div className={`bg-slate-900 text-white flex items-center justify-center rounded-lg font-bold text-xl ${className}`}>
    Q
  </div>
);

function App() {
  // --- Global State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
// Data State
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [teams, setTeams] = useState<Team[]>(MOCK_TEAMS);
  const [sites, setSites] = useState<Site[]>(MOCK_SITES);

  // UI State - Persistent Sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
      if (typeof window !== 'undefined') {
          const saved = localStorage.getItem('sidebarCollapsed');
          return saved === 'true';
      }
      return false;
  });

  const [activeView, setActiveView] = useState('dashboard');
  const [ticketFilter, setTicketFilter] = useState<TicketFilter | null>(null);
  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null);
  const [targetActivityId, setTargetActivityId] = useState<string | null>(null);

  // --- Global Search State ---
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);

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
      if (type === 'ticket') {
          setActiveView('tickets');
          setTicketFilter({ ticketId: id });
      } else if (type === 'activity') {
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

  // Notifications (Mock)
  const activeUserNotifications = useMemo(() => {
      // Simple mock: count unread tickets for lead, or just return empty array
      return [];
  }, [tickets, currentUser]);

  // --- Auth Handlers ---
const handleLogin = async (email: string, pass: string) => {
      try {
          const res = await fetch("/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password: pass })
          });
          
          if (!res.ok) {
              alert('Invalid credentials');
              return;
          }

          const data = await res.json();
          // Store token securely
          localStorage.setItem('qonnect_token', data.token);
          
          setCurrentUser({
              email: data.user.email,
              name: data.user.name,
              role: data.user.role,
              techId: data.user.id
          });
          
          if (data.user.role === Role.FIELD_ENGINEER) setActiveView('tech_portal');
          else setActiveView('dashboard');

      } catch (error) {
          console.error("Login Error:", error);
          alert("Failed to connect to server.");
      }
  };

  const handleLogout = () => {
      setCurrentUser(null);
      setActiveView('dashboard');
  };

  // --- Data Handlers ---
  const handleUpdateTicket = (updated: Ticket) => {
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  const handleCreateTicket = async (data: any) => {
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          id: generateTicketId(),
          status: TicketStatus.NEW,
          createdAt: new Date().toISOString()
        }),
      });

    const handleDeleteTicket = async (id: string) => {
      if (!window.confirm("Are you sure you want to permanently delete this ticket?")) return;
      try {
          const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
          if (res.ok) {
              setTickets(prev => prev.filter(t => t.id !== id));
              if (focusedTicketId === id) setFocusedTicketId(null);
          } else {
              alert("Failed to delete ticket");
          }
      } catch (e) {
          console.error("Delete error", e);
      }
  };
      
      if (res.ok) {
        await loadTickets(); // Refresh list from database
      }
    } catch (e) {
      console.error("Failed to save ticket to database", e);
    }
  };

  const handleSendMessage = (ticketId: string, content: string, sender: MessageSender) => {
      setTickets(prev => prev.map(t => {
          if (t.id !== ticketId) return t;
          return {
              ...t,
              updatedAt: new Date().toISOString(),
              messages: [
                  ...t.messages,
                  {
                      id: `m-${Date.now()}`,
                      sender,
                      content,
                      timestamp: new Date().toISOString()
                  }
              ]
          };
      }));
  };

  // Activity Handlers
  const handleAddActivity = (act: any) => {
      const newId = generateActivityId();
      const newAct = {
          ...act,
          id: newId,
          reference: newId, // Activity ID matches Ref for display
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      };
      setActivities(prev => [...prev, newAct]);
  };

  const handleUpdateActivity = (updated: Activity) => {
      setActivities(prev => prev.map(a => a.id === updated.id ? updated : a));
  };

  const handleDeleteActivity = (id: string) => {
      setActivities(prev => prev.filter(a => a.id !== id));
  };
  
const loadTickets = async () => {
    try {
      const res = await fetch("/api/tickets");
      const data = await res.json();
      if (Array.isArray(data)) setTickets(data);
    } catch (e) {
      console.error("Failed to load tickets", e);
    }
  };

  const loadActivities = async () => {
    try {
      const res = await fetch("/api/activities");
      const data = await res.json();
      if (Array.isArray(data)) setActivities(data);
    } catch (e) {
      console.error("Failed to load activities", e);
    }
  };
  
// Customer Handlers (API-first)
const handleAddCustomer = async (c: Customer) => {
  try {
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    await loadCustomers();
  } catch (e) {
    console.error(e);
    alert("Failed to create customer");
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

    console.log("PUT /api/customers/" + id, payload);

    const res = await fetch(`/api/customers/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });

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

  // Tech/User Handlers
  const handleSaveUser = (u: Technician) => {
      setTechnicians(prev => {
          const exists = prev.find(x => x.id === u.id);
          if (exists) return prev.map(x => x.id === u.id ? u : x);
          return [...prev, u];
      });
  };

  const handleDeleteUser = (id: string) => {
      setTechnicians(prev => prev.filter(x => x.id !== id));
  };

  // System Import Handler
  const handleSystemImport = (data: any) => {
      if (data.tickets) setTickets(data.tickets);
      if (data.activities) setActivities(data.activities);
      if (data.technicians) setTechnicians(data.technicians);
   // if (data.customers) setCustomers(data.customers);
      if (data.teams) setTeams(data.teams);
      if (data.sites) setSites(data.sites);
  };

const loadCustomers = async () => {
  try {
    const res = await fetch("/api/customers");
    const data = await res.json();
    if (Array.isArray(data)) setCustomers(data);
  } catch (e) {
    console.error("Failed to load customers", e);
  }
};

const loadUsers = async () => {
  try {
    const res = await fetch("/api/users");
    const data = await res.json();
    if (Array.isArray(data)) setTechnicians(data);
  } catch (e) {
    console.error("Failed to load users", e);
  }
};

useEffect(() => {
    loadUsers();
    loadCustomers();
    loadTickets();
    loadActivities();
  }, []);
  
  // --- Navigation Logic ---
  const filteredNavItems = useMemo(() => {
      if (!currentUser) return [];
      return NAVIGATION_ITEMS.filter(item => item.roles.includes(currentUser.role));
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

  if (!currentUser) {
      return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
        
        {/* Sidebar - APPLE iOS LIGHT THEME */}
        <aside className={`hidden md:flex flex-col bg-[#E5E7EB] border-r-[3px] border-[#1E293B]/20 text-gray-900 z-20 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-[80px]' : 'w-[260px]'}`}>
            
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
            <header className="h-16 border-b border-slate-100 bg-white flex items-center justify-between px-4 shrink-0 z-20 relative">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={toggleSidebar}
                        className="p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors cursor-pointer"
                        title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
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

                     <button className="relative p-2 text-slate-400 hover:text-slate-600 transition-colors">
                         <Bell size={20} />
                         {activeUserNotifications.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>}
                     </button>

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
                        onAddCustomer={handleAddCustomer}
                        onUpdateTicket={handleUpdateTicket}
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
                    />
                )}
                {activeView === 'users' && (
                    <UserManagement 
                        users={technicians}
                        teams={teams}
                        onSaveUser={handleSaveUser}
                        onDeleteUser={handleDeleteUser}
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
                {activeView === 'lead_portal' && (
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
                        isStandalone={false}
                        onLogout={() => setActiveView('dashboard')}
                        focusedTicketId={focusedTicketId}
                        currentUserId={currentUser.techId}
                    />
                )}
                {activeView === 'tech_portal' && (
                    <MobileTechPortal 
                        tickets={tickets}
                        activities={activities}
                        currentTechId={currentUser.techId || ''}
                        onUpdateStatus={(tId, status) => {
                            const t = tickets.find(x => x.id === tId);
                            if (t) handleUpdateTicket({...t, status});
                        }}
                        onUpdateActivity={handleUpdateActivity}
                        isStandalone={false}
                        onLogout={handleLogout}
                    />
                )}
                {activeView === 'simulator' && (
                    <FlowSimulator onNewTicket={(t) => {
                        setTickets(prev => [t, ...prev]);
                        // Optional: Notify user
                        alert(`New Simulated Ticket: ${t.id}`);
                    }} />
                )}
                {activeView === 'guide' && <IntegrationGuide />}
            </div>

            {/* AI Assistant Chat Bubble (Global) */}
            <AIChatBot />

        </main>
    </div>
  );
}

export default App;
