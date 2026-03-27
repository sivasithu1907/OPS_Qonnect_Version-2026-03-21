
import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, TicketStatus, MessageSender, Priority, Technician, TicketType, TicketFilter, Customer, Role, AnalysisResult } from '../types';
import { TICKET_CATEGORIES, SEARCH_INPUT_STYLES, INPUT_STYLES } from '../constants';
import { analyzeTicketMessage } from '../services/geminiService';
import CustomerSelector from './CustomerSelector';
import { validatePhone, normalizePhone, formatPhoneDisplay } from '../utils/phoneUtils';
import { Send, Sparkles, MoreHorizontal, Plus, X, Calendar, Save, AlertCircle, Filter, MapPin, Link as LinkIcon, Home, History, Clock, User, AlertTriangle, Search as SearchIcon, ChevronDown, RefreshCw, UserPlus, CheckCircle2, Unlink, UserCheck, MessageSquare, Wrench, Wifi, Trash2 } from 'lucide-react';
import { getTicketHealth, getHealthColor } from '../utils/ticketUtils';

interface TicketManagementProps {
  tickets: Ticket[];
  technicians: Technician[];
  // Pass full customer list and creation handler
  customers?: Customer[]; 
  onAddCustomer?: (customer: Customer) => void;
  
  onUpdateTicket: (ticket: Ticket) => void;
  onOpenTicket?: (ticket: Ticket) => void;
  onSendMessage: (ticketId: string, content: string, sender: MessageSender) => void;
  onCreateTicket: (ticket: { 
    customerName: string; 
    phoneNumber: string; 
    customerId: string; // New Required Field
    category: string; 
    type: TicketType; 
    priority: Priority; 
    initialMessage: string;
    assignedTechId?: string;
    locationUrl?: string;
    houseNumber?: string;
    odooLink?: string;
    createdAt?: string; 
  }) => void;
  activeFilter: TicketFilter | null;
  onClearFilter: () => void;
  currentUser?: User;
  onDeleteTicket?: (id: string) => void;
}

// Date Constants for Dropdowns
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = Array.from({length: 5}, (_, i) => String(new Date().getFullYear() + i));
const HOURS = Array.from({length: 24}, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({length: 12}, (_, i) => String(i * 5).padStart(2, '0'));

// Helper to get days in month
const getDaysInMonth = (year: number, monthIndex: number) => {
  return new Date(year, monthIndex + 1, 0).getDate();
};

// --- LOCAL SAFE HELPERS ---
const safeString = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    return String(val);
};

const safeNormalize = (val: unknown): string => {
    return safeString(val).replace(/[^0-9+]/g, "");
};

const TicketManagement: React.FC<TicketManagementProps> = ({ 
    tickets, 
    technicians,
    customers = [],
    onAddCustomer = (_: Customer) => {}, // Fixed default signature
    onUpdateTicket,
    onOpenTicket,
    onSendMessage, 
    onCreateTicket,
    activeFilter,
    onClearFilter,
    currentUser,
    onDeleteTicket
}) => {
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // NEW: State for rich analysis result
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'active' | 'history'>('active');
  
  // --- Local Filter State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [agingFilter, setAgingFilter] = useState<'Fresh' | 'Warning' | 'Stalled' | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<string | 'ALL'>('ALL');

  // --- Create Form State ---
  const initialCreateState = {
    customerId: '',
    customerName: '', // derived from selector
    phone: '', // derived from selector
    category: '',
    type: '',
    priority: '',
    description: '',
    locationUrl: '',
    houseNumber: '',
    odooLink: '',
    assignedTechId: '',
    createdDateDisplay: '' // Display only string
  };
  const [createForm, setCreateForm] = useState(initialCreateState);
  
  // New Client Creation Mode State
  const [isNewClientMode, setIsNewClientMode] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<Customer | null>(null);

  // --- Edit Form State ---
  // Expanded to include Customer Linking fields
  const [editForm, setEditForm] = useState<{
    status: TicketStatus;
    type: TicketType;
    priority: Priority;
    category: string;
    assignedTechId: string;
    appointmentTime: string;
    odooLink: string;
    locationUrl: string;
    houseNumber: string;
    // Linking Fields
    customerId: string;
    customerName: string;
    phoneNumber: string;
  } | null>(null);

  // Client Link UI State in Right Panel
  const [clientLinkMode, setClientLinkMode] = useState<'view' | 'search' | 'create'>('view');
  const [newClientName, setNewClientName] = useState(''); // For inline creation

  // --- Helper: Format Date for Display ---
  const formatDisplayDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  // Initialize Create Date when modal opens
  useEffect(() => {
    if (isCreateModalOpen) {
      setCreateForm(prev => ({
        ...prev,
        createdDateDisplay: formatDisplayDate(new Date())
      }));
      setIsNewClientMode(false);
      setDuplicateWarning(null);
    } else {
      setCreateForm(initialCreateState);
    }
  }, [isCreateModalOpen]);

  // Duplicate Check Effect
  useEffect(() => {
      if (isNewClientMode && createForm.phone) {
          const normalizedInput = safeNormalize(createForm.phone);
          const match = customers.find(c => safeNormalize(c.phone) === normalizedInput);
          setDuplicateWarning(match || null);
      } else {
          setDuplicateWarning(null);
      }
  }, [createForm.phone, isNewClientMode, customers]);

  // Handle external navigation/filtering
  useEffect(() => {
      if (activeFilter?.ticketId) {
          setSelectedTicketId(activeFilter.ticketId);
          const ticket = tickets.find(t => t.id === activeFilter.ticketId);
          if (ticket && (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CANCELLED)) {
              setViewMode('history');
          } else {
              setViewMode('active');
          }
      }
  }, [activeFilter, tickets]);

  // --- Filtering Logic ---
  const baseTickets = useMemo(() => {
    if (activeFilter) {
        return tickets.filter(ticket => {
            if (activeFilter.ticketId) {
                if (!activeFilter.status && !activeFilter.aging) return true;
            }
            if (activeFilter.status && activeFilter.status.length > 0) {
                if (!activeFilter.status.includes(ticket.status)) return false;
            }
            if (activeFilter.aging) {
                const diff = new Date().getTime() - new Date(ticket.createdAt).getTime();
                const hours = diff / (1000 * 60 * 60);
                if (activeFilter.aging === 'New' && hours >= 24) return false;
                if (activeFilter.aging === 'Attention Required' && (hours < 24 || hours >= 72)) return false;
                if (activeFilter.aging === 'On Hold' && hours < 72) return false;
            }
            return true;
        });
    }
    return tickets.filter(ticket => {
        const isClosed = ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CANCELLED;
        if (viewMode === 'active') return !isClosed;
        return isClosed;
    });
  }, [tickets, activeFilter, viewMode]);

  const filteredTickets = useMemo(() => {
      let result = baseTickets;
      const safeSearchTerm = safeString(searchTerm);

      if (safeSearchTerm.trim()) {
          const lowerTerm = safeSearchTerm.toLowerCase();
          const safeSearchDigits = safeNormalize(safeSearchTerm); // Use safe local normalize
          
          result = result.filter(t => {
              const tech = technicians.find(tech => tech.id === t.assignedTechId);
              const matchesText = 
                  safeString(t.id).toLowerCase().includes(lowerTerm) ||
                  safeString(t.customerName).toLowerCase().includes(lowerTerm) ||
                  safeString(t.locationUrl).toLowerCase().includes(lowerTerm) ||
                  safeString(t.houseNumber).toLowerCase().includes(lowerTerm) ||
                  (tech && safeString(tech.name).toLowerCase().includes(lowerTerm));
              
              // Safe phone match
              const tPhone = safeNormalize(t.phoneNumber);
              const tPhoneRaw = safeString(t.phoneNumber);
              const matchesPhone = tPhone.includes(safeSearchDigits) || tPhoneRaw.includes(safeSearchTerm);
              
              return matchesText || matchesPhone;
          });
      }
      if (agingFilter) {
          const now = new Date().getTime();
          result = result.filter(t => {
              const created = new Date(t.createdAt).getTime();
              const hoursDiff = (now - created) / (1000 * 60 * 60);
              if (agingFilter === 'Fresh') return hoursDiff <= 2;
              if (agingFilter === 'Warning') return hoursDiff > 2 && hoursDiff <= 6;
              if (agingFilter === 'Stalled') return hoursDiff > 6;
              return true;
          });
      }
      if (priorityFilter !== 'ALL') result = result.filter(t => t.priority === priorityFilter);
      if (statusFilter !== 'ALL') result = result.filter(t => t.status === statusFilter);
      if (assigneeFilter !== 'ALL') result = result.filter(t => t.assignedTechId === assigneeFilter);
      return result;
  }, [baseTickets, searchTerm, agingFilter, priorityFilter, statusFilter, assigneeFilter, technicians]);

  const agingCounts = useMemo(() => {
      let temp = baseTickets;
      const safeSearchTerm = safeString(searchTerm);

      if (safeSearchTerm.trim()) {
          const lowerTerm = safeSearchTerm.toLowerCase(); 
          const safeSearchDigits = safeNormalize(safeSearchTerm);

          temp = temp.filter(t => {
             const tech = technicians.find(tech => tech.id === t.assignedTechId);
             const matchesText = 
                safeString(t.id).toLowerCase().includes(lowerTerm) || 
                safeString(t.customerName).toLowerCase().includes(lowerTerm) || 
                (tech && safeString(tech.name).toLowerCase().includes(lowerTerm));
             
             // Safe phone match
             const tPhone = safeNormalize(t.phoneNumber);
             const tPhoneRaw = safeString(t.phoneNumber);
             const matchesPhone = tPhone.includes(safeSearchDigits) || tPhoneRaw.includes(safeSearchTerm);
             
             return matchesText || matchesPhone;
          });
      }
      if (priorityFilter !== 'ALL') temp = temp.filter(t => t.priority === priorityFilter);
      if (statusFilter !== 'ALL') temp = temp.filter(t => t.status === statusFilter);
      if (assigneeFilter !== 'ALL') temp = temp.filter(t => t.assignedTechId === assigneeFilter);
      const now = new Date().getTime();
      return {
          Fresh: temp.filter(t => (now - new Date(t.createdAt).getTime()) / 36e5 <= 2).length,
          Warning: temp.filter(t => {
              const h = (now - new Date(t.createdAt).getTime()) / 36e5;
              return h > 2 && h <= 6;
          }).length,
          Stalled: temp.filter(t => (now - new Date(t.createdAt).getTime()) / 36e5 > 6).length,
      };
  }, [baseTickets, searchTerm, priorityFilter, statusFilter, assigneeFilter, technicians]);

  const handleClearLocalFilters = () => {
      setSearchTerm('');
      setAgingFilter(null);
      setPriorityFilter('ALL');
      setStatusFilter('ALL');
      setAssigneeFilter('ALL');
  };

  const hasActiveLocalFilters = searchTerm || agingFilter || priorityFilter !== 'ALL' || statusFilter !== 'ALL' || assigneeFilter !== 'ALL';
  const selectedTicket = tickets.find(t => t.id === selectedTicketId);
  const fieldEngineers = technicians.filter(t => t.systemRole === Role.FIELD_ENGINEER && t.status !== 'LEAVE' && (t.isActive !== false));
  const teamLeads = technicians.filter(t => t.systemRole === Role.TEAM_LEAD && t.status !== 'LEAVE' && (t.isActive !== false));
  const engineerOptions = useMemo(() => technicians.filter(t => t.systemRole === Role.FIELD_ENGINEER), [technicians]);

  // Sync Edit Form with Selected Ticket
  useEffect(() => {
    if (selectedTicket) {
      setEditForm({
        status: selectedTicket.status,
        type: selectedTicket.type,
        priority: selectedTicket.priority,
        category: selectedTicket.category,
        assignedTechId: selectedTicket.assignedTechId || '',
        appointmentTime: selectedTicket.appointmentTime || '',
        odooLink: selectedTicket.odooLink || '',
        locationUrl: selectedTicket.locationUrl || '',
        houseNumber: selectedTicket.houseNumber || '',
        customerId: selectedTicket.customerId,
        customerName: selectedTicket.customerName,
        phoneNumber: selectedTicket.phoneNumber
      });
      setClientLinkMode('view');
      setNewClientName('');
      setAnalysisResult(null); // Reset analysis on ticket change
      setReplyText('');
    } else {
        setEditForm(null);
    }
  }, [selectedTicketId, selectedTicket]);

  const toTitleCase = (str: unknown) => {
      if (typeof str !== 'string') return '';
      return str.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  
  const getPriorityColor = (p: string) => {
      switch(p) {
        case Priority.LOW: return 'border-slate-300';
        case Priority.MEDIUM: return 'border-blue-400';
        case Priority.HIGH: return 'border-orange-400';
        case Priority.URGENT: return 'border-red-500';
        default: return 'border-slate-200';
      }
  };
  const getPriorityDot = (p: string) => {
    switch(p) {
      case Priority.LOW: return 'bg-slate-400';
      case Priority.MEDIUM: return 'bg-blue-500';
      case Priority.HIGH: return 'bg-orange-500';
      case Priority.URGENT: return 'bg-red-500';
      default: return 'bg-slate-200';
    }
  };
  const getFormValue = (field: keyof NonNullable<typeof editForm>) => editForm ? editForm[field] : '';
  
  const updateField = (field: keyof NonNullable<typeof editForm>, value: any) => {
      if (!selectedTicket) return;
      setEditForm(prev => {
          if (!prev) return null;
          return { ...prev, [field]: value };
      });
  };

  const updateAppointmentDate = (part: 'day' | 'month' | 'year' | 'hour' | 'minute', value: string) => {
    if (!editForm) return;
    let current = editForm.appointmentTime ? new Date(editForm.appointmentTime) : new Date();
    if (!editForm.appointmentTime) {
        current.setMinutes(0, 0, 0);
        current.setHours(current.getHours() + 1);
    }
    const currentYear = current.getFullYear();
    const currentMonth = current.getMonth();
    const currentDay = current.getDate();

    if (part === 'day') current.setDate(parseInt(value));
    else if (part === 'month') {
        const newMonthIndex = MONTHS.indexOf(value);
        const daysInNewMonth = getDaysInMonth(currentYear, newMonthIndex);
        const dayToSet = Math.min(currentDay, daysInNewMonth);
        current.setDate(1); current.setMonth(newMonthIndex); current.setDate(dayToSet);
    } else if (part === 'year') {
        const newYear = parseInt(value);
        const daysInNewMonth = getDaysInMonth(newYear, currentMonth);
        const dayToSet = Math.min(currentDay, daysInNewMonth);
        current.setDate(1); current.setFullYear(newYear); current.setDate(dayToSet);
    } else if (part === 'hour') current.setHours(parseInt(value));
    else if (part === 'minute') current.setMinutes(parseInt(value));

    updateField('appointmentTime', current.toISOString());
  };

  const getDateParts = () => {
      const d = editForm?.appointmentTime ? new Date(editForm.appointmentTime) : null;
      return {
          day: d ? String(d.getDate()).padStart(2, '0') : '',
          month: d ? MONTHS[d.getMonth()] : '',
          year: d ? String(d.getFullYear()) : '',
          hour: d ? String(d.getHours()).padStart(2, '0') : '',
          minute: d ? String(d.getMinutes()).padStart(2, '0') : ''
      };
  };

  const hasUnsavedChanges = () => {
      if (!selectedTicket || !editForm) return false;
      return (
          // status is auto-managed — excluded from unsaved-changes check
          editForm.type !== selectedTicket.type ||
          editForm.priority !== selectedTicket.priority ||
          editForm.category !== selectedTicket.category ||
          editForm.assignedTechId !== (selectedTicket.assignedTechId || '') ||
          editForm.appointmentTime !== (selectedTicket.appointmentTime || '') ||
          editForm.odooLink !== (selectedTicket.odooLink || '') ||
          editForm.locationUrl !== (selectedTicket.locationUrl || '') ||
          editForm.houseNumber !== (selectedTicket.houseNumber || '') ||
          editForm.customerId !== selectedTicket.customerId ||
          editForm.customerName !== selectedTicket.customerName || 
          editForm.phoneNumber !== selectedTicket.phoneNumber
      );
  };

  const isDetailValid = () => {
      if (!editForm) return false;
      // Location and House Number are required for readiness
      return editForm.locationUrl.trim() !== '' && editForm.houseNumber.trim() !== '';
  };

  const handleSaveChanges = () => {
    if (!selectedTicket || !editForm) return;
    if (!isDetailValid()) {
        alert("Location URL and House Number are mandatory.");
        return;
    }
    
    // Auto-status logic — derived from workflow action, never from a manual dropdown
    const oldTechId = selectedTicket.assignedTechId || '';
    const newTechId = editForm.assignedTechId;

    let newStatus = selectedTicket.status; // always start from current persisted status

    if (newTechId && newTechId !== oldTechId) {
        // Engineer assigned (new or re-assigned) → ASSIGNED
        newStatus = TicketStatus.ASSIGNED;
    } else if (!newTechId && oldTechId && selectedTicket.status === TicketStatus.ASSIGNED) {
        // Engineer removed from an ASSIGNED ticket → back to OPEN
        newStatus = TicketStatus.OPEN;
    }
    // CARRY_FORWARD, IN_PROGRESS, RESOLVED, CANCELLED set via dedicated actions only

    if (newTechId && newTechId !== oldTechId) {
        const tech = technicians.find(t => t.id === newTechId);
        if (tech) onSendMessage(selectedTicket.id, `System Update: Field Engineer ${tech.name} has been assigned to your ticket.`, MessageSender.SYSTEM);
    }

    onUpdateTicket({
        ...selectedTicket,
        // Update Editable Fields
        status: newStatus,
        type: editForm.type,
        priority: editForm.priority,
        category: editForm.category,
        assignedTechId: editForm.assignedTechId || undefined,
        appointmentTime: editForm.appointmentTime || undefined,
        odooLink: editForm.odooLink,
        locationUrl: editForm.locationUrl,
        houseNumber: editForm.houseNumber,
        // Update Client Link
        customerId: editForm.customerId,
        customerName: editForm.customerName,
        phoneNumber: editForm.phoneNumber
    });
  };

  // --- Inline Client Creation Helper ---
  const handleInlineCreateClient = () => {
      if (!editForm) return;
      if (!newClientName.trim()) {
          alert('Client Name is required');
          return;
      }
      
      const newCustomer: Customer = {
          id: `c${Date.now()}`,
          name: newClientName.trim(),
          phone: editForm.phoneNumber, // Use phone from ticket
          address: '',
          email: '',
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(newClientName.trim())}&background=random`
      };

      onAddCustomer(newCustomer);
      
      // Update form to link to new customer
      updateField('customerId', newCustomer.id);
      updateField('customerName', newCustomer.name);
      
      setClientLinkMode('view');
      setNewClientName('');
  };

  // --- Send & Stub Logic ---
  const sendToWhatsApp = (phone: string, message: string) => {
      console.log(`[STUB] Sending WhatsApp to ${phone}: ${message}`);
      alert(`Message Sent to WhatsApp (${phone})`);
  };

  const handleSend = () => {
    if (!selectedTicketId || !replyText.trim() || !editForm) return;
    
    // Internal Update
    onSendMessage(selectedTicketId, replyText, MessageSender.AGENT);
    
    // External Stub
    sendToWhatsApp(editForm.phoneNumber, replyText);

    setReplyText('');
    setAnalysisResult(null); // Clear analysis on send
  };

  const handleAIAnalysis = async () => {
    if (!selectedTicket) return;
    setIsAnalyzing(true);
    setAnalysisResult(null);

    const lastClientMsg = [...selectedTicket.messages].reverse().find(m => m.sender === MessageSender.CLIENT);
    const history = selectedTicket.messages.map(m => `${m.sender}: ${m.content}`);
    
    try {
        // Analyze
        const result = await analyzeTicketMessage(lastClientMsg?.content || "No message", history);
        
        setAnalysisResult(result);
        if (result.draft_reply) {
            setReplyText(result.draft_reply);
        }

        // Auto-Tag Logic
        if (editForm) {
            // Only auto-fill if current value matches a default or empty state, or if we trust AI blindly.
            // For smoother UX, we update state, user can revert before saving.
            updateField('priority', result.priority);
            // Only update category if it's "Unknown" or empty or matches generic types
            if (result.service_category !== 'Unknown') {
                updateField('category', result.service_category);
            }
        }
    } catch (err: any) {
        console.error("AI Handover failed", err);
        alert(err.message || "Failed to connect to AI Service.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  // --- Create Form Logic ---
  const isCreateFormValid = () => {
      const { customerId, category, type, priority, description, locationUrl, houseNumber, customerName, phone } = createForm;
      const baseValid = category !== '' && type !== '' && priority !== '' && description.trim() !== '' && locationUrl.trim() !== '' && houseNumber.trim() !== '';
      
      if (isNewClientMode) {
          return baseValid && customerName.trim() !== '' && phone.trim() !== '' && !duplicateWarning;
      } else {
          return baseValid && customerId !== '';
      }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      
      if (!createForm.category || !createForm.type || !createForm.priority || !createForm.description || !createForm.locationUrl || !createForm.houseNumber) {
          return; 
      }

      if (isNewClientMode) {
          if (!createForm.customerName.trim() || !createForm.phone.trim()) {
              alert("Name and Phone are required for new clients.");
              return;
          }

          if (duplicateWarning) {
              alert(`Client already exists: ${duplicateWarning.name}. Please select existing client.`);
              return;
          }
          
          const phoneValidation = validatePhone(createForm.phone);
          if (!phoneValidation.isValid) {
              alert(phoneValidation.error);
              return;
          }
          const finalPhone = phoneValidation.formatted!;

          const newCustomer: Customer = {
              id: `c${Date.now()}`,
              name: createForm.customerName,
              phone: finalPhone,
              address: createForm.houseNumber,
              email: '',
              avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(createForm.customerName)}&background=random`,
              buildingNumber: createForm.houseNumber
          };

          onAddCustomer(newCustomer);

          onCreateTicket({
              customerId: newCustomer.id,
              customerName: newCustomer.name,
              phoneNumber: newCustomer.phone,
              category: createForm.category,
              type: createForm.type as TicketType,
              priority: createForm.priority as Priority,
              assignedTechId: createForm.assignedTechId || undefined,
              initialMessage: createForm.description,
              locationUrl: createForm.locationUrl,
              houseNumber: createForm.houseNumber,
              odooLink: createForm.odooLink,
          });

      } else {
          if (!createForm.customerId) return;

          onCreateTicket({
              customerId: createForm.customerId,
              customerName: createForm.customerName,
              phoneNumber: createForm.phone,
              category: createForm.category,
              type: createForm.type as TicketType,
              priority: createForm.priority as Priority,
              assignedTechId: createForm.assignedTechId || undefined,
              initialMessage: createForm.description,
              locationUrl: createForm.locationUrl,
              houseNumber: createForm.houseNumber,
              odooLink: createForm.odooLink,
          });
      }

      setIsCreateModalOpen(false);
      setIsNewClientMode(false);
      setDuplicateWarning(null);
  };

  const handleCustomerSelect = (cust: Customer) => {
      setCreateForm(prev => ({
          ...prev,
          customerId: cust.id,
          customerName: cust.name,
          phone: cust.phone,
          houseNumber: prev.houseNumber || cust.buildingNumber || cust.address || ''
      }));
  };

  const handleSelectExistingFromWarning = () => {
      if (duplicateWarning) {
          handleCustomerSelect(duplicateWarning);
          setIsNewClientMode(false);
          setDuplicateWarning(null);
      }
  };

  const handleManualCreateTrigger = (term: string) => {
      setIsNewClientMode(true);
      setCreateForm(prev => ({ 
          ...prev, 
          phone: term, 
          customerName: '',
          customerId: '' 
      }));
  };

  const dateParts = getDateParts();
  const selectedYear = dateParts.year ? parseInt(dateParts.year) : new Date().getFullYear();
  const selectedMonthIndex = dateParts.month ? MONTHS.indexOf(dateParts.month) : new Date().getMonth();
  const maxDays = getDaysInMonth(selectedYear, selectedMonthIndex);

  // Derived Match for Unlinked Ticket
  const potentialMatch = useMemo(() => {
      if (!editForm || editForm.customerId) return null;
      const normalizedTicketPhone = safeNormalize(editForm.phoneNumber);
      return customers.find(c => safeNormalize(c.phone) === normalizedTicketPhone);
  }, [editForm, customers]);

  const linkedCustomer = useMemo(() => {
      if (!editForm) return null;
      return customers.find(c => c.id === editForm.customerId);
  }, [editForm, customers]);

  // Derived hints from AI Analysis
  const suggestTechAssign = analysisResult?.recommended_action === 'assign_field_engineer';

  return (
    <div className="flex h-[calc(100vh-6rem)] overflow-hidden bg-white rounded-lg shadow-sm border border-slate-200 m-6">
      
      {/* Left List View (Unchanged) */}
      <div className="w-1/3 border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100 bg-slate-50 space-y-3">
             <div className="flex justify-between items-center">
                <h2 className="font-semibold text-slate-800">
                    {activeFilter ? 'Filtered' : (viewMode === 'active' ? 'Active Queue' : 'History')} 
                    <span className="ml-2 text-slate-400 text-sm font-normal">({filteredTickets.length})</span>
                </h2>
                {!activeFilter && (
                     <button 
                        onClick={() => setIsCreateModalOpen(true)}
                        className="p-1.5 bg-slate-200 hover:bg-emerald-600 hover:text-white rounded-md transition-all flex items-center gap-1 text-xs font-semibold px-2"
                    >
                        <Plus size={16} /> New
                    </button>
                )}
             </div>
             
             {!activeFilter && (
                 <div className="space-y-3">
                     <div className="relative">
                         <SearchIcon size={14} className="absolute left-3 top-2.5 text-slate-400" />
                         <input 
                            type="text" 
                            placeholder="Search by ID, name, phone..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={SEARCH_INPUT_STYLES.replace('w-full', 'w-full text-xs py-2 pl-8 pr-8')}
                         />
                         {searchTerm && (
                             <button onClick={() => setSearchTerm('')} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600">
                                 <X size={14} />
                             </button>
                         )}
                     </div>

                     <div className="flex flex-col gap-2">
                         <div className="flex gap-2">
                             {['Fresh', 'Warning', 'Stalled'].map(type => (
                                 <button 
                                    key={type}
                                    onClick={() => setAgingFilter(agingFilter === type ? null : type as any)}
                                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                                        agingFilter === type 
                                        ? (type === 'Fresh' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : type === 'Warning' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-red-100 text-red-700 border-red-200')
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-200'
                                    }`}
                                 >
                                     {type} <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-slate-100">{agingCounts[type as keyof typeof agingCounts]}</span>
                                 </button>
                             ))}
                         </div>
                         <div className="flex items-center gap-2">
                             {[
                                 { val: priorityFilter, set: setPriorityFilter, opts: Object.values(Priority), label: 'Priorities' },
                                 { val: statusFilter, set: setStatusFilter, opts: [
                      TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.ASSIGNED,
                      TicketStatus.IN_PROGRESS, TicketStatus.CARRY_FORWARD,
                      TicketStatus.RESOLVED, TicketStatus.CANCELLED
                  ], label: 'Statuses' },
                                 { val: assigneeFilter, set: setAssigneeFilter, opts: engineerOptions, label: 'Engineers', valKey: 'id', nameKey: 'name' }
                             ].map((f, i) => (
                                 <div key={i} className="relative flex-1">
                                    <select 
                                        value={f.val}
                                        onChange={(e) => f.set(e.target.value as any)}
                                        className="w-full appearance-none bg-white border border-slate-200 rounded-lg py-1.5 px-2 text-[10px] font-medium text-slate-600 focus:outline-none focus:border-slate-400"
                                    >
                                        <option value="ALL">All {f.label}</option>
                                        {f.opts.map((o: any) => (
                                            <option 
                                                key={f.valKey ? o[f.valKey] : o} 
                                                value={f.valKey ? o[f.valKey] : o}
                                            >
                                                {toTitleCase(f.nameKey ? o[f.nameKey] : String(o))}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                 </div>
                             ))}
                             {hasActiveLocalFilters && (
                                 <button onClick={handleClearLocalFilters} className="text-[10px] text-red-500 hover:text-red-700 font-medium whitespace-nowrap px-1 shrink-0">Clear</button>
                             )}
                         </div>
                     </div>
                 </div>
             )}
             
             {!activeFilter && (
                 <div className="flex bg-slate-200/50 p-1 rounded-lg">
                     <button onClick={() => setViewMode('active')} className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-all ${viewMode === 'active' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Active</button>
                     <button onClick={() => setViewMode('history')} className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-all flex items-center justify-center gap-1 ${viewMode === 'history' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><History size={12} /> History</button>
                 </div>
             )}

             {activeFilter && (
                 <div className="flex items-center justify-between bg-blue-50 text-blue-700 px-3 py-2 rounded-md text-sm border border-blue-100">
                     <div className="flex items-center gap-2"><Filter size={14} /><span>{activeFilter.description || 'Filtered List'}</span></div>
                     <button onClick={onClearFilter} className="hover:text-blue-900"><X size={14}/></button>
                 </div>
             )}
        </div>
        <div className="overflow-y-auto flex-1">
          {filteredTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                  <Filter size={32} className="mb-2 opacity-50"/>
                  <p className="text-sm">No tickets found</p>
                  {hasActiveLocalFilters && <button onClick={handleClearLocalFilters} className="mt-2 text-xs text-blue-500 hover:underline">Clear Filters</button>}
              </div>
          ) : (
            filteredTickets.map(ticket => {
                const health = getTicketHealth(ticket);
                const healthColor = getHealthColor(health);
                
                return (
                    <div key={ticket.id} onClick={() => { setSelectedTicketId(ticket.id); onOpenTicket?.(ticket); }} className={`p-4 border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors ${selectedTicketId === ticket.id ? 'bg-slate-50 border-l-4 border-l-emerald-500' : ''}`}>
                        <div className="flex justify-between items-start mb-1">
                            <span className="font-medium text-slate-900">{ticket.customerName}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${(new Date().getTime() - new Date(ticket.createdAt).getTime()) / 36e5 < 24 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{(new Date().getTime() - new Date(ticket.createdAt).getTime()) / 36e5 < 24 ? 'New' : 'Pending'}</span>
                        </div>
                        <div className="text-sm text-slate-500 mb-2 truncate"><span className="text-xs text-slate-400 font-medium">{ticket.id}</span> • {(safeString(ticket.type) || '—')} • {ticket.category} • {safeString(ticket.phoneNumber)}</div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600"><span className={`w-1.5 h-1.5 rounded-full ${getPriorityDot(ticket.priority)}`}/>{toTitleCase(ticket.priority)}</span>
                            <div className="flex items-center gap-2">
                                {/* Health Badge */}
                                {health && (
                                    <div className={`w-2.5 h-2.5 rounded-full ${healthColor} shadow-sm border border-white`} title={`${health?.toUpperCase()} Status`} />
                                )}
                                <span className="text-slate-400">{new Date(ticket.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                        </div>
                    </div>
                );
            })
          )}
        </div>
      </div>

      {/* Right Detail View */}
      {selectedTicket && editForm ? (
        <div className="w-2/3 flex flex-row">
          <div className="flex-1 flex flex-col border-r border-slate-200 relative">
             <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
               <div>
                   <h3 className="font-bold text-slate-800">{editForm.customerName}</h3>
                   <p className="text-xs text-slate-500">{formatPhoneDisplay(editForm.phoneNumber)}</p>
               </div>
               
               {/* NEW WRAPPER DIV FOR BOTH BUTTONS */}
               <div className="flex items-center gap-2">
                  {currentUser?.role === 'ADMIN' && (
                       <button 
                           onClick={() => {
                               if (onDeleteTicket && selectedTicketId) {
                                   onDeleteTicket(selectedTicketId);
                                   setSelectedTicketId(null); // Clear selection after delete
                               }
                           }}
                           className="text-xs font-semibold flex items-center gap-1 text-red-600 hover:bg-red-50 px-2 py-1.5 rounded transition-colors"
                       >
                           <Trash2 size={14} /> Delete
                       </button>
                   )}

                   <button onClick={handleAIAnalysis} disabled={isAnalyzing} className="text-xs font-semibold flex items-center gap-1 text-purple-600 hover:bg-purple-50 px-2 py-1.5 rounded transition-colors disabled:opacity-50">
                       {isAnalyzing ? <div className="animate-spin w-3 h-3 border-2 border-purple-600 border-t-transparent rounded-full"/> : <Sparkles size={14} />}
                       AI Analyze
                   </button>
               </div>
             </div>
             
             <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
		{(selectedTicket?.messages || []).map((msg, idx) => {
                  // Normalise: DB stores 'at', frontend creates 'timestamp' — handle both
                  const msgTime = (msg as any).timestamp || (msg as any).at || '';
                  const msgId = (msg as any).id || `msg-${idx}`;
                  return (
                  <div key={msgId} className={`flex ${msg.sender === MessageSender.CLIENT ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] rounded-xl p-3 shadow-sm ${msg.sender === MessageSender.CLIENT ? 'bg-white text-slate-800 border border-slate-100' : msg.sender === MessageSender.AGENT ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600 text-sm'}`}>
                      <p>{msg.content}</p>
                      <div className={`text-[10px] mt-1 text-right ${msg.sender === MessageSender.AGENT ? 'text-emerald-100' : 'text-slate-400'}`}>
                        {msgTime ? new Date(msgTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}
                      </div>
                    </div>
                  </div>
                  );
                })}
             </div>

             {/* AI Analysis Panel */}
             {analysisResult && (
                 <div className="mx-4 mb-2 p-3 bg-white rounded-xl shadow-lg border border-purple-100 animate-in slide-in-from-bottom-2">
                     <div className="flex justify-between items-start mb-2">
                         <div className="flex items-center gap-2">
                             <Sparkles size={16} className="text-purple-600" />
                             <span className="text-xs font-bold text-slate-700 uppercase">AI Insights</span>
                             <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{analysisResult.confidence}% Conf.</span>
                         </div>
                         <button onClick={() => setAnalysisResult(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                     </div>
                     
                     <div className="grid grid-cols-2 gap-2 mb-2">
                         <div className="bg-purple-50 p-2 rounded-lg border border-purple-100">
                             <span className="text-[10px] text-purple-600 font-bold block mb-0.5">Summary</span>
                             <p className="text-xs text-slate-800 leading-tight">{analysisResult.summary}</p>
                         </div>
                         <div className="space-y-1">
                             <div className="flex gap-1">
                                 <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100 font-medium truncate">{analysisResult.service_category}</span>
                                 <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${getPriorityColor(analysisResult.priority)} bg-slate-50`}>{toTitleCase(analysisResult.priority)}</span>
                             </div>
                             {analysisResult.remote_possible && (
                                 <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                                     <Wifi size={12} /> Remote Possible
                                 </div>
                             )}
                             {analysisResult.recommended_action === 'assign_field_engineer' && (
                                 <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-100">
                                     <Wrench size={12} /> Field Eng. Required
                                 </div>
                             )}
                         </div>
                     </div>

                     {analysisResult.suggested_questions.length > 0 && (
                         <div className="mb-2">
                             <span className="text-[10px] font-bold text-slate-400 block mb-1">Suggested Questions</span>
                             <div className="flex flex-wrap gap-1">
                                 {analysisResult.suggested_questions.map((q, i) => (
                                     <button 
                                        key={i} 
                                        onClick={() => setReplyText(prev => prev ? `${prev}\n${q}` : q)}
                                        className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-full transition-colors border border-slate-200 text-left truncate max-w-full"
                                     >
                                         + {q}
                                     </button>
                                 ))}
                             </div>
                         </div>
                     )}
                 </div>
             )}

             <div className="p-4 bg-white border-t border-slate-200 shrink-0">
                <div className="flex gap-2">
                 <input type="text" value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type a response..." className={INPUT_STYLES} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
                 <button onClick={handleSend} className="bg-emerald-600 text-white p-2 rounded-lg hover:bg-emerald-700 transition-colors"><Send size={20} /></button>
               </div>
             </div>
          </div>
          <div className="w-80 bg-slate-50 flex flex-col h-full overflow-hidden border-l border-slate-200">
             
             {/* Client Management Section */}
             <div className="p-4 border-b border-slate-200 bg-white space-y-4 shrink-0">
                <h3 className="font-bold text-slate-800 flex items-center gap-2 text-xs uppercase tracking-wider">
                    <User size={14}/> Client Details
                </h3>

                {linkedCustomer ? (
                    // Linked View
                    <div className="flex justify-between items-start p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                        <div>
                            <div className="font-bold text-slate-900 text-sm">{linkedCustomer.name}</div>
                            <div className="text-xs text-emerald-700 font-mono mt-1">{formatPhoneDisplay(linkedCustomer.phone)}</div>
                            <div className="text-[10px] text-slate-500 mt-1">ID: {linkedCustomer.id}</div>
                        </div>
                        <button 
                            onClick={() => {
                                updateField('customerId', '');
                                updateField('customerName', 'Unknown Client'); 
                            }} 
                            className="text-slate-400 hover:text-red-600 p-1 hover:bg-red-50 rounded transition-colors" 
                            title="Unlink"
                        >
                            <Unlink size={16} />
                        </button>
                    </div>
                ) : (
                    // Unlinked View
                    <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-slate-100 border border-slate-200 rounded-lg">
                            <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase">Detected Contact</div>
                                <div className="font-mono text-sm font-bold text-slate-700">{formatPhoneDisplay(editForm.phoneNumber) || "No Phone"}</div>
                            </div>
                            <div className="text-[10px] bg-slate-200 text-slate-600 px-2 py-1 rounded font-medium">Unlinked</div>
                        </div>

                        {potentialMatch && (
                            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg flex justify-between items-center animate-in fade-in">
                                <div>
                                    <div className="text-[10px] text-blue-600 font-bold mb-1 flex items-center gap-1"><Sparkles size={10}/> Suggestion</div>
                                    <div className="text-sm font-bold text-slate-800">{potentialMatch.name}</div>
                                </div>
                                <button 
                                    onClick={() => {
                                        updateField('customerId', potentialMatch.id);
                                        updateField('customerName', potentialMatch.name);
                                        // Also auto-fill location if missing
                                        if (!editForm.houseNumber && potentialMatch.buildingNumber) updateField('houseNumber', potentialMatch.buildingNumber);
                                        if (!editForm.locationUrl && potentialMatch.address) updateField('locationUrl', potentialMatch.address);
                                    }}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm"
                                >
                                    Link
                                </button>
                            </div>
                        )}

                        {clientLinkMode === 'view' && (
                            <div className="flex gap-2">
                                <button onClick={() => setClientLinkMode('search')} className="flex-1 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors">Link Existing</button>
                                <button onClick={() => setClientLinkMode('create')} className="flex-1 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors">Create New</button>
                            </div>
                        )}

                        {clientLinkMode === 'search' && (
                            <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
                                <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                                    <CustomerSelector 
                                        customers={customers}
                                        onSelect={(c) => {
                                            updateField('customerId', c.id);
                                            updateField('customerName', c.name);
                                            if (!editForm.houseNumber && c.buildingNumber) updateField('houseNumber', c.buildingNumber);
                                            if (!editForm.locationUrl && c.address) updateField('locationUrl', c.address);
                                            setClientLinkMode('view');
                                        }}
                                        onCreateNew={() => {}} // Disabled here
                                    />
                                </div>
                                <button onClick={() => setClientLinkMode('view')} className="text-xs text-slate-500 hover:text-slate-800 w-full text-center hover:underline">Cancel Search</button>
                            </div>
                        )}

                        {clientLinkMode === 'create' && (
                            <div className="space-y-3 p-3 bg-slate-50 border border-slate-200 rounded-lg animate-in fade-in zoom-in-95 duration-200">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-bold text-slate-800">New Client Profile</h4>
                                    <button onClick={() => setClientLinkMode('view')}><X size={14} className="text-slate-400 hover:text-slate-600"/></button>
                                </div>
                                <input 
                                    value={newClientName}
                                    onChange={(e) => setNewClientName(e.target.value)}
                                    placeholder="Client Name"
                                    className={INPUT_STYLES}
                                />
                                <div className="text-xs text-slate-500">Phone: {formatPhoneDisplay(editForm.phoneNumber)}</div>
                                <button 
                                    onClick={handleInlineCreateClient}
                                    className="w-full bg-emerald-600 text-white py-2 rounded-lg text-xs font-bold hover:bg-emerald-700"
                                >
                                    Create & Link
                                </button>
                            </div>
                        )}
                    </div>
                )}
             </div>

             <div className="flex-1 overflow-y-auto space-y-4 p-4 pr-2">
                {/* AI Summary Banner */}
                {(selectedTicket as any)?.ai_summary && (
                    <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-100 rounded-xl">
                        <Sparkles size={14} className="text-purple-500 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-[10px] font-bold text-purple-500 uppercase mb-0.5">AI Summary</p>
                            <p className="text-xs text-purple-900 leading-snug">{(selectedTicket as any).ai_summary}</p>
                        </div>
                    </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Status</label>
                  <span className={`block w-full px-3 py-2 rounded-lg text-sm font-bold text-center border ${
                    selectedTicket?.status === TicketStatus.NEW           ? 'bg-slate-100 text-slate-700 border-slate-300' :
                    selectedTicket?.status === TicketStatus.OPEN          ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    selectedTicket?.status === TicketStatus.ASSIGNED      ? 'bg-purple-50 text-purple-700 border-purple-200' :
                    selectedTicket?.status === TicketStatus.IN_PROGRESS   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    selectedTicket?.status === TicketStatus.CARRY_FORWARD ? 'bg-orange-50 text-orange-700 border-orange-200' :
                    selectedTicket?.status === TicketStatus.RESOLVED      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    selectedTicket?.status === TicketStatus.CANCELLED     ? 'bg-red-50 text-red-600 border-red-200' :
                    'bg-slate-50 text-slate-500 border-slate-200'
                  }`}>
                    {toTitleCase(selectedTicket?.status || '')}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">Auto-managed by workflow actions</p>
                </div>
                {selectedTicket && selectedTicket.status !== TicketStatus.RESOLVED && selectedTicket.status !== TicketStatus.CANCELLED && (
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Cancel this ticket? This cannot be undone.')) {
                          onUpdateTicket({ ...selectedTicket, status: TicketStatus.CANCELLED, updatedAt: new Date().toISOString() });
                        }
                      }}
                      className="w-full py-2 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 transition-colors"
                    >
                      Cancel Ticket
                    </button>
                  </div>
                )}
                <div><label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Priority</label><select value={getFormValue('priority') as Priority} onChange={(e) => updateField('priority', e.target.value)} className={INPUT_STYLES}>{Object.values(Priority).map(p => <option key={p} value={p}>{toTitleCase(p)}</option>)}</select></div>
                
                {/* Assignment Dropdown with Hint Highlight */}
                <div className={`transition-all rounded-md ${suggestTechAssign ? 'p-1 bg-amber-50 ring-2 ring-amber-400' : ''}`}>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center justify-between">
                        Assigned Field Engineer
                        {suggestTechAssign && <span className="text-[10px] text-amber-700 flex items-center gap-1 font-bold animate-pulse"><Wrench size={10}/> AI Suggested</span>}
                    </label>
                    <select value={getFormValue('assignedTechId') as string} onChange={(e) => updateField('assignedTechId', e.target.value)} className={INPUT_STYLES}>
                        <option value="" disabled>Unassigned</option>

                        <optgroup label="Team Leads">
                            {teamLeads.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </optgroup>

                        <optgroup label="Field Engineers">
                            {fieldEngineers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </optgroup>
                    </select>
                </div>

                <div><label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Type</label><select value={getFormValue('type') as TicketType} onChange={(e) => updateField('type', e.target.value)} className={INPUT_STYLES}>{Object.values(TicketType).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Category</label><select value={getFormValue('category') as string} onChange={(e) => updateField('category', e.target.value)} className={INPUT_STYLES}>{TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Appointment</label>
                    <input
                        type="datetime-local"
                        value={editForm.appointmentTime ? new Date(editForm.appointmentTime).toISOString().slice(0,16) : ''}
                        onChange={e => updateField('appointmentTime', e.target.value ? new Date(e.target.value).toISOString() : '')}
                        className={INPUT_STYLES}
                        min={new Date().toISOString().slice(0,16)}
                    />
                </div>
                <div className="pt-2 border-t border-slate-200">
                    <h4 className="text-xs font-bold text-slate-800 uppercase mb-3 flex items-center gap-2">
                        <MapPin size={12} /> Service Location <span className="text-red-500">*</span>
                    </h4>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Map URL</label>
                            <input 
                                type="text" 
                                required 
                                value={getFormValue('locationUrl') as string} 
                                onChange={(e) => updateField('locationUrl', e.target.value)} 
                                className={INPUT_STYLES}
                                placeholder="https://maps.google..."
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">House / Building No.</label>
                            <input 
                                type="text" 
                                required 
                                value={getFormValue('houseNumber') as string} 
                                onChange={(e) => updateField('houseNumber', e.target.value)} 
                                className={INPUT_STYLES}
                                placeholder="Villa 10"
                            />
                        </div>
                    </div>
                </div>
                <div className="pt-2 border-t border-slate-200">
                    <h4 className="text-xs font-bold text-slate-800 uppercase mb-3">External References</h4>
                    <div><label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1"><LinkIcon size={10}/> Odoo Link</label><input type="text" value={getFormValue('odooLink') as string} onChange={(e) => updateField('odooLink', e.target.value)} placeholder="https://odoo..." className={INPUT_STYLES} /></div>
                </div>
             </div>
             <div className="p-4 border-t border-slate-200 bg-white">
                 {hasUnsavedChanges() && <div className="mb-3 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200"><AlertCircle size={14} /> Unsaved changes</div>}
                 
                 {!isDetailValid() && (
                     <div className="mb-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                         <AlertCircle size={14} /> Location & House No. required
                     </div>
                 )}

                 <button 
                    onClick={handleSaveChanges} 
                    disabled={!hasUnsavedChanges() || !isDetailValid()} 
                    className={`w-full py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all ${
                        hasUnsavedChanges() && isDetailValid() 
                        ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-md' 
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                >
                    <Save size={18} /> Update Ticket Details
                </button>
             </div>
          </div>
        </div>
      ) : (
        <div className="w-2/3 flex items-center justify-center bg-slate-50 text-slate-400">
          <div className="text-center"><MoreHorizontal size={48} className="mx-auto mb-2 opacity-50" /><p>Select a ticket to view details</p></div>
        </div>
      )}

      {/* New Ticket Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
             <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                  <h3 className="font-bold text-lg text-slate-900">Create New Ticket</h3>
                  <button onClick={() => setIsCreateModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
             </div>
             
             <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                 
                 {/* Auto-filled Date */}
                 <div className="space-y-1">
                     <label className="text-xs font-semibold text-slate-500 uppercase">Created Date</label>
                     <div className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-slate-600 text-sm font-medium">
                         {createForm.createdDateDisplay}
                     </div>
                 </div>

                 {/* Customer Section: Swaps between Selector and Inline Creation */}
                 <div className="space-y-1">
                     {!isNewClientMode ? (
                        <CustomerSelector 
                            customers={customers}
                            selectedCustomerId={createForm.customerId}
                            onSelect={handleCustomerSelect}
                            onCreateNew={() => {/* Legacy support, suppressed by onManualCreate */}}
                            onManualCreate={handleManualCreateTrigger}
                        />
                     ) : (
                        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-3 border-b border-slate-200 pb-2">
                                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                    <UserPlus size={16} className="text-emerald-600"/>
                                    New Client Details
                                </h4>
                                <button 
                                    type="button" 
                                    onClick={() => { setIsNewClientMode(false); setDuplicateWarning(null); }}
                                    className="text-xs text-blue-600 font-semibold hover:underline"
                                >
                                    Cancel / Select Existing
                                </button>
                            </div>
                            
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Client Name <span className="text-red-500">*</span></label>
                                    <input 
                                        type="text"
                                        required
                                        autoFocus
                                        value={createForm.customerName}
                                        onChange={(e) => setCreateForm(prev => ({ ...prev, customerName: e.target.value }))}
                                        className={INPUT_STYLES}
                                        placeholder="Full Name"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mobile Number <span className="text-red-500">*</span></label>
                                    <input 
                                        type="text"
                                        required
                                        value={createForm.phone}
                                        onChange={(e) => setCreateForm(prev => ({ ...prev, phone: e.target.value }))}
                                        className={INPUT_STYLES}
                                        placeholder="+974 3300 0000"
                                    />
                                    {duplicateWarning && (
                                        <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700 flex flex-col gap-1">
                                            <div className="flex items-center gap-1 font-bold">
                                                <AlertCircle size={12} /> Client already exists
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span>Matches: <b>{duplicateWarning.name}</b></span>
                                                <button 
                                                    type="button" 
                                                    onClick={handleSelectExistingFromWarning}
                                                    className="bg-red-100 hover:bg-red-200 text-red-800 px-2 py-0.5 rounded border border-red-200 font-bold transition-colors"
                                                >
                                                    Select Existing
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                     )}
                 </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Category <span className="text-red-500">*</span></label>
                        <select 
                            value={createForm.category}
                            onChange={(e) => setCreateForm({...createForm, category: e.target.value})}
                            required
                            className={INPUT_STYLES}
                        >
                            <option value="" disabled>Select Category</option>
                            {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Priority <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <select 
                                value={createForm.priority}
                                onChange={(e) => setCreateForm({...createForm, priority: e.target.value})}
                                required
                                className={INPUT_STYLES}
                            >
                                <option value="" disabled>Select Priority</option>
                                {Object.values(Priority).map(p => <option key={p} value={p}>{toTitleCase(p)}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Location Details */}
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <h4 className="text-xs font-bold text-slate-700 uppercase mb-3">Location Details</h4>
                    <div className="grid grid-cols-1 gap-3">
                        <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500 uppercase">Location URL <span className="text-red-500">*</span></label>
                            <input 
                                value={createForm.locationUrl}
                                onChange={(e) => setCreateForm({...createForm, locationUrl: e.target.value})}
                                required 
                                className={INPUT_STYLES}
                                placeholder="Google Maps Link"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-500 uppercase">House Number <span className="text-red-500">*</span></label>
                            <input 
                                value={createForm.houseNumber}
                                onChange={(e) => setCreateForm({...createForm, houseNumber: e.target.value})}
                                required 
                                className={INPUT_STYLES}
                                placeholder="Building/Villa No."
                            />
                        </div>
                    </div>
                </div>

                {/* Odoo Ref */}
                <div className="space-y-1">
                     <label className="text-xs font-semibold text-slate-500 uppercase">Odoo Reference</label>
                     <input 
                        value={createForm.odooLink}
                        onChange={(e) => setCreateForm({...createForm, odooLink: e.target.value})}
                        className={INPUT_STYLES}
                        placeholder="https://odoo..."
                     />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Ticket Type <span className="text-red-500">*</span></label>
                        <select 
                            value={createForm.type}
                            onChange={(e) => setCreateForm({...createForm, type: e.target.value})}
                            required
                            className={INPUT_STYLES}
                        >
                            <option value="" disabled>Select Type</option>
                            {Object.values(TicketType).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Assign Field Engineer</label>
                        <select 
                            value={createForm.assignedTechId}
                            onChange={(e) => setCreateForm({...createForm, assignedTechId: e.target.value})}
                            className={INPUT_STYLES}
                        >
                          <option value="" disabled>Unassigned</option>

                             <optgroup label="Team Leads">
                               {teamLeads.map(t => (
                                 <option key={t.id} value={t.id}>{t.name}</option>
                               ))}
                             </optgroup>

                             <optgroup label="Field Engineers">
                               {fieldEngineers.map(t => (
                                 <option key={t.id} value={t.id}>{t.name}</option>
                               ))}
                             </optgroup>
                        </select>
                    </div>
                </div>

                <div className="space-y-1">
                     <label className="text-xs font-semibold text-slate-500 uppercase">Initial Message / Description <span className="text-red-500">*</span></label>
                     <textarea 
                        value={createForm.description}
                        onChange={(e) => setCreateForm({...createForm, description: e.target.value})}
                        required 
                        rows={3} 
                        className={INPUT_STYLES}
                        placeholder="Describe the issue..."
                    />
                 </div>

                 <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-2">
                      <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                      <button 
                        type="submit" 
                        disabled={isCreateFormValid ? !isCreateFormValid() : true}
                        className={`px-6 py-2 text-white font-medium rounded-lg shadow-lg transition-all ${isCreateFormValid && isCreateFormValid() ? 'bg-slate-900 hover:bg-slate-800 shadow-slate-900/20' : 'bg-slate-300 cursor-not-allowed'}`}
                      >
                          {isNewClientMode ? 'Create Client & Ticket' : 'Create Ticket'}
                      </button>
                  </div>

             </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketManagement;
