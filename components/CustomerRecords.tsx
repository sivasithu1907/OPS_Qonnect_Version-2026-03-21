
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Customer, Activity, Technician, Site, Ticket } from '../types';
import { validatePhone, normalizePhone, formatPhoneDisplay } from '../utils/phoneUtils';
import { Search, Edit, Trash2, Eye, Plus, X, Mail, Phone, MapPin, Camera, Upload, Contact, Calendar, Clock, ArrowRight, Home, RotateCcw, FileText, MessageSquare, Ticket as TicketIcon } from 'lucide-react';

interface CustomerRecordsProps {
  customers: Customer[];
  activities: Activity[];
  tickets: Ticket[];
  technicians: Technician[];
  sites: Site[];
  onSaveCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
  readOnly?: boolean;
  isMobile?: boolean;
}

const CustomerRecords: React.FC<CustomerRecordsProps> = ({ 
    customers,
    activities,
    tickets,
    technicians,
    sites,
    onSaveCustomer,
    onDeleteCustomer,
    readOnly = false,
    isMobile = false
}) => {
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

  const [modalType, setModalType] = useState<'add' | 'edit' | 'view' | null>(null);
  const [activeItem, setActiveItem] = useState<Customer | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<any>(null); // Timeline item preview popup
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // --- Filtering Logic ---
  const filteredCustomers = useMemo(() => {
      if (!searchTerm.trim()) return customers;
      
      const lowerTerm = searchTerm.toLowerCase();
      const safeSearch = normalizePhone(searchTerm); // Use safe normalized value for comparison

      return customers.filter(c => {
          const nameMatch = c.name.toLowerCase().includes(lowerTerm);
          const emailMatch = c.email?.toLowerCase().includes(lowerTerm);
          
          // Safe Phone Match: normalize data phone before check
          const cPhone = normalizePhone(c.phone);
          const phoneMatch = cPhone.includes(safeSearch) || (c.phone && c.phone.includes(searchTerm));

          return nameMatch || emailMatch || phoneMatch;
      });
  }, [customers, searchTerm]);

  const suggestions = useMemo(() => {
      if (!searchTerm.trim()) return [];
      return filteredCustomers.slice(0, 8);
  }, [filteredCustomers, searchTerm]);

  // Click Outside Handler
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
              setShowSuggestions(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuggestionClick = (c: Customer) => {
      setSearchTerm(c.name);
      setShowSuggestions(false);
      openModal('view', c);
  };

  const openModal = (type: 'add' | 'edit' | 'view', item?: Customer) => {
      setModalType(type);
      setActiveItem(item || null);
      setFormError(null);
      if (item?.avatar) {
          setAvatarPreview(item.avatar);
      } else {
          setAvatarPreview(null);
      }
  };

  const closeModal = () => {
      setModalType(null);
      setActiveItem(null);
      setAvatarPreview(null);
      setFormError(null);
  };

  const handleDelete = (id: string, e?: React.MouseEvent) => {
      if (readOnly) return;
      if (e) {
          e.preventDefault();
          e.stopPropagation();
      }

      if (window.confirm("Are you sure you want to delete this client record? This action cannot be undone.")) {
          onDeleteCustomer(id);
          closeModal();
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setAvatarPreview(reader.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (readOnly) return;
      setFormError(null);
      
      const formData = new FormData(e.target as HTMLFormElement);
      const rawData: any = Object.fromEntries(formData.entries());
      
      // Building Number and Location are optional
      // Validate Phone
      const phoneValidation = validatePhone(rawData.phone);
      if (!phoneValidation.isValid) {
          setFormError(phoneValidation.error || 'Invalid phone number');
          return;
      }

      const cleanPhone = phoneValidation.formatted!;

      // 4. Check Uniqueness
      const duplicate = customers.find(c => c.phone === cleanPhone && c.id !== activeItem?.id);
      if (duplicate) {
          setFormError(`This mobile number already exists for client: ${duplicate.name}`);
          return;
      }


// Build payload but NEVER trust form fields for id
const data: any = {
  ...rawData,
  phone: cleanPhone,
};

// Remove any accidental id coming from the form
delete data.id;

if (modalType === 'add') {
  // ID comes from backend
  data.avatar = avatarPreview || `https://ui-avatars.com/api/?name=${data.name}&background=random`;
} else {
  // Must have activeItem with a real id
  if (!activeItem?.id) {
    setFormError("Missing customer ID. Please close and reopen the client, then try again.");
    return;
  }
  data.id = activeItem.id;
  data.avatar = avatarPreview || activeItem.avatar;
}

onSaveCustomer(data as Customer);
      closeModal();
  };

  // Unified Client History — activities + tickets, sorted newest first
  type TimelineItem = {
      id: string;
      kind: 'activity' | 'ticket';
      ref: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      date: Date;
      dateLabel: string;
      techName?: string;
      location?: string;
      // Extra detail fields
      startedAt?: string;
      completedAt?: string;
      remarks?: string;
      completionNote?: string;
      carryForwardNote?: string;
      nextPlannedAt?: string;
      cancellationReason?: string;
      serviceCategory?: string;
  };

  const getCustomerTimeline = (customerId: string): TimelineItem[] => {
      const items: TimelineItem[] = [];

      // Activities for this customer
      activities.filter(a => a.customerId === customerId).forEach(a => {
          const tech = technicians.find(t => t.id === (a as any).primaryEngineerId || t.id === a.leadTechId);
          const site = sites.find(s => s.id === a.siteId);
          items.push({
              id: a.id,
              kind: 'activity',
              ref: a.reference,
              title: a.type,
              description: a.description || '',
              status: a.status,
              priority: a.priority,
              date: new Date(a.plannedDate || a.createdAt),
              dateLabel: new Date(a.plannedDate || a.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
              techName: tech?.name,
              location: a.houseNumber || site?.name,
              startedAt: (a as any).startedAt,
              completedAt: (a as any).completedAt,
              remarks: (a as any).remarks,
              completionNote: (a as any).completionNote,
              carryForwardNote: (a as any).carryForwardNote,
              nextPlannedAt: (a as any).nextPlannedAt,
              cancellationReason: (a as any).cancellationReason,
              serviceCategory: a.serviceCategory,
              photos: (a as any).photos || [],
          });
      });

      // Tickets for this customer (match by customerId or customerName)
      const cust = customers.find(c => c.id === customerId);
      tickets.filter(t => t.customerId === customerId || (cust && t.customerName === cust.name)).forEach(t => {
          const tech = technicians.find(x => x.id === t.assignedTechId);
          items.push({
              id: t.id,
              kind: 'ticket',
              ref: t.id,
              title: t.category,
              description: t.messages?.find((m: any) => m.sender === 'CLIENT')?.content || (t as any).ai_summary || t.category,
              status: t.status,
              priority: t.priority,
              date: new Date(t.createdAt),
              dateLabel: new Date(t.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: 'short', year: 'numeric' }),
              techName: tech?.name,
              location: t.houseNumber,
              startedAt: (t as any).startedAt,
              completedAt: (t as any).completedAt,
              remarks: t.notes,
              completionNote: (t as any).completionNote,
              carryForwardNote: (t as any).carryForwardNote,
              nextPlannedAt: (t as any).nextPlannedAt,
              cancellationReason: (t as any).cancellationReason,
          });
      });

      return items.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

  // Legacy wrapper for count badges
  const getCustomerHistory = (customerId: string) => {
      return getCustomerTimeline(customerId);
  };

  return (
    <div className={isMobile ? "p-4 space-y-4" : "p-8 space-y-8 animate-in fade-in zoom-in duration-300"}>
        
        {/* Header */}
        <div className="flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
                <p className="text-slate-500 text-sm">Manage client profiles and view service history</p>
            </div>
            {!readOnly && (
                <button 
                    type="button"
                    onClick={() => openModal('add')}
                    className="bg-slate-900 text-white px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all"
                >
                    <Plus size={18} />
                    <span>Add Client</span>
                </button>
            )}
        </div>

        {/* Customer List Container */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                    <Contact size={20} className="text-slate-500" /> 
                    All Clients
                </h3>
                
                {/* Search With Autocomplete */}
                <div className="relative" ref={searchContainerRef}>
                    <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="Search..." 
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        className={`pl-9 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 bg-white ${isMobile ? 'w-full' : 'w-64'}`} 
                    />
                    
                    {/* Autocomplete Dropdown */}
                    {showSuggestions && searchTerm && suggestions.length > 0 && (
                        <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                            {suggestions.map(c => (
                                <div 
                                    key={c.id} 
                                    onClick={() => handleSuggestionClick(c)}
                                    className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                                >
                                    <div className="text-sm font-bold text-slate-800">{c.name}</div>
                                    <div className="text-xs text-slate-500">{formatPhoneDisplay(c.phone)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Conditional Rendering: Card List (Mobile) vs Table (Desktop) */}
            {isMobile ? (
                <div className="divide-y divide-slate-100">
                    {filteredCustomers.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 italic">
                            No clients found matching "{searchTerm}"
                        </div>
                    ) : (
                        filteredCustomers.map(cust => (
                            <div key={cust.id} onClick={() => openModal('view', cust)} className="p-4 active:bg-slate-50 cursor-pointer">
                                <div className="flex items-center gap-3 mb-2">
                                    {cust.avatar ? (
                                        <img src={cust.avatar} className="w-10 h-10 rounded-full bg-slate-200 object-cover" alt="" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                                            {cust.name.charAt(0)}
                                        </div>
                                    )}
                                    <div>
                                        <div className="font-bold text-slate-900">{cust.name}</div>
                                        <div className="text-xs text-slate-500 font-mono">{formatPhoneDisplay(cust.phone)}</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2 text-xs text-slate-500 mb-2">
                                    <MapPin size={12} className="mt-0.5 shrink-0"/>
                                    <span className="truncate">
                                        {cust.buildingNumber && cust.buildingNumber !== 'N/A' ? cust.buildingNumber : ''}
                                        {cust.buildingNumber && cust.address && cust.address.startsWith('http') ? ' · ' : ''}
                                        {cust.address && cust.address.startsWith('http') ? 'Map linked' : (cust.address || 'No location set')}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700">
                                        {getCustomerHistory(cust.id).length} Orders
                                    </span>
                                    <span className="text-xs text-blue-600 font-medium">View Details &rarr;</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left table-fixed">
                        <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs">
                            <tr>
                                <th className="px-6 py-4 w-[28%]">Client</th>
                                <th className="px-6 py-4 w-[18%]">Contact</th>
                                <th className="px-6 py-4 w-[26%]">Location</th>
                                <th className="px-6 py-4 text-center w-[12%]">History</th>
                                <th className="px-6 py-4 text-right w-[16%]">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredCustomers.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400 italic">
                                        No clients found matching "{searchTerm}"
                                    </td>
                                </tr>
                            ) : (
                                filteredCustomers.map(cust => (
                                    <tr key={cust.id} className="hover:bg-slate-50 group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                {cust.avatar ? (
                                                    <img src={cust.avatar} className="w-10 h-10 rounded-full bg-slate-200 object-cover" alt="" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                                                        {cust.name.charAt(0)}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="font-bold text-slate-800">{cust.name}</div>
                                                    <div className="text-xs text-slate-400">ID: {cust.id}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 text-slate-600 font-mono text-xs">
                                                    <Phone size={12} /> {formatPhoneDisplay(cust.phone)}
                                                </div>
                                                <div className="flex items-center gap-2 text-slate-600 text-xs">
                                                    <Mail size={12} /> {cust.email}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600">
                                            <div className="overflow-hidden">
                                                {cust.buildingNumber && cust.buildingNumber !== 'N/A' && !cust.buildingNumber.startsWith('http') ? (
                                                    <div className="font-medium text-slate-800 truncate">{cust.buildingNumber}</div>
                                                ) : !cust.buildingNumber || cust.buildingNumber === 'N/A' ? (
                                                    <div className="text-slate-400 text-xs italic">No building</div>
                                                ) : null}
                                                {/* Show map link if address or buildingNumber contains a URL */}
                                                {(() => {
                                                    const mapUrl = (cust.address && cust.address.startsWith('http')) ? cust.address 
                                                        : (cust.buildingNumber && cust.buildingNumber.startsWith('http')) ? cust.buildingNumber 
                                                        : null;
                                                    return mapUrl ? (
                                                        <a href={mapUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline flex items-center gap-1 mt-0.5">
                                                            <MapPin size={10} className="shrink-0" /> View Map
                                                        </a>
                                                    ) : cust.address && cust.address !== cust.buildingNumber ? (
                                                        <div className="text-xs text-slate-500 truncate mt-0.5">{cust.address}</div>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                {getCustomerHistory(cust.id).length} Orders
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button type="button" onClick={() => openModal('view', cust)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="View Details"><Eye size={16} /></button>
                                                {!readOnly && (
                                                    <>
                                                        <button type="button" onClick={() => openModal('edit', cust)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded" title="Edit"><Edit size={16} /></button>
                                                        <button type="button" onClick={(e) => handleDelete(cust.id, e)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete"><Trash2 size={16} /></button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>

        {/* --- Modals --- */}

        {/* Add/Edit Modal */}
        {(modalType === 'add' || modalType === 'edit') && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                 <div className={`bg-white rounded-2xl shadow-2xl w-full ${isMobile ? 'h-full rounded-none' : 'max-w-lg'} overflow-hidden flex flex-col`}>
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                         <h3 className="font-bold text-lg text-slate-900">
                             {modalType === 'edit' ? 'Edit Client' : 'New Client'}
                         </h3>
                         <button onClick={closeModal}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>
                    
                    <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white flex-1 overflow-y-auto">
                        
                        {/* Avatar Upload */}
                        <div className="flex flex-col items-center mb-4">
                            <div className="relative group cursor-pointer" onClick={() => !readOnly && fileInputRef.current?.click()}>
                                <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden mb-2">
                                    {avatarPreview ? (
                                        <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                                            <Camera size={32} />
                                        </div>
                                    )}
                                </div>
                                {!readOnly && (
                                    <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                        <Upload className="text-white" size={24} />
                                    </div>
                                )}
                            </div>
                            {!readOnly && (
                                <>
                                    <input 
                                        type="file" 
                                        ref={fileInputRef} 
                                        onChange={handleFileChange} 
                                        accept="image/*" 
                                        className="hidden" 
                                    />
                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="text-sm text-emerald-600 font-medium hover:text-emerald-700">
                                        {avatarPreview ? 'Change Photo' : 'Upload Photo'}
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Fields */}
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase">Full Name</label>
                            <input name="name" defaultValue={activeItem?.name} required disabled={readOnly} className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100" placeholder="e.g. John Doe"/>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Phone</label>
                                <div className="flex">
                                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 text-slate-500 text-sm font-medium">+974</span>
                                    <input 
                                        name="phone" 
                                        defaultValue={activeItem?.phone ? activeItem.phone.replace(/^\+974\s?/, '').replace(/^974/, '') : ''}
                                        required 
                                        disabled={readOnly}
                                        className="rounded-none rounded-r-lg flex-1 bg-white border border-slate-300 p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100" 
                                        placeholder="3300 0000"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">
                                    Email <span className="text-slate-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input 
                                    name="email" 
                                    defaultValue={activeItem?.email} 
                                    type="email" 
                                    disabled={readOnly}
                                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100" 
                                    placeholder="email@example.com"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase">
                                Location (URL)
                            </label>
                            <input 
                                name="address" 
                                defaultValue={activeItem?.address} 
                                disabled={readOnly}
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100" 
                                placeholder="https://maps.google.com..."
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase">
                                Building Number
                            </label>
                            <input 
                                name="buildingNumber" 
                                defaultValue={activeItem?.buildingNumber} 
                                disabled={readOnly}
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100" 
                                placeholder="e.g. Bldg 10, Zone 55"
                            />
                        </div>

                        {formError && (
                            <div className="p-2 bg-red-50 text-red-600 text-xs rounded border border-red-100 flex items-center gap-1">
                                <span className="font-bold">Error:</span> {formError}
                            </div>
                        )}

                        {!readOnly && (
                            <div className="pt-4 flex justify-between items-center border-t border-slate-100 mt-2">
                                 {activeItem ? (
                                    <button type="button" onClick={(e) => handleDelete(activeItem.id, e)} className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1 hover:bg-red-50 px-2 py-1 rounded transition-colors">
                                        <Trash2 size={16} className="pointer-events-none" /> Delete
                                    </button>
                                 ) : <div></div>}
                                 <div className="flex gap-3">
                                    <button type="button" onClick={closeModal} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                                    <button type="submit" className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all">
                                        {activeItem ? 'Save Changes' : 'Create Record'}
                                    </button>
                                 </div>
                            </div>
                        )}
                        {readOnly && (
                            <div className="pt-4 flex justify-end border-t border-slate-100 mt-2">
                                <button type="button" onClick={closeModal} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-medium">Close</button>
                            </div>
                        )}

                    </form>
                 </div>
            </div>
        )}

        {/* View Details & History Modal */}
        {modalType === 'view' && activeItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className={`bg-white rounded-2xl shadow-2xl w-full ${isMobile ? 'h-full rounded-none' : 'max-w-4xl max-h-[85vh]'} overflow-hidden relative flex flex-col md:flex-row`}>
                    <button onClick={closeModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 z-10"><X size={20}/></button>
                    
                    {/* Left: Profile Panel */}
                    <div className="w-full md:w-1/3 bg-slate-50 p-8 border-r border-slate-100 flex flex-col items-center overflow-y-auto shrink-0">
                        <div className="w-32 h-32 rounded-full bg-white border-4 border-white shadow-md mb-6 overflow-hidden">
                            {activeItem.avatar ? (
                                <img src={activeItem.avatar} alt={activeItem.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-slate-200 flex items-center justify-center text-4xl text-slate-400 font-bold">
                                    {activeItem.name.charAt(0)}
                                </div>
                            )}
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 text-center mb-1">{activeItem.name}</h2>
                        <p className="text-slate-500 text-sm mb-8 text-center">{activeItem.id}</p>
                        
                        <div className="w-full space-y-4">
                            <div className="flex items-center gap-3 text-slate-700">
                                <div className="p-2 bg-white rounded-lg shadow-sm text-slate-400"><Phone size={18}/></div>
                                <span className="text-sm font-mono">{formatPhoneDisplay(activeItem.phone)}</span>
                            </div>
                            {activeItem.email && (
                                <div className="flex items-center gap-3 text-slate-700">
                                    <div className="p-2 bg-white rounded-lg shadow-sm text-slate-400"><Mail size={18}/></div>
                                    <span className="text-sm">{activeItem.email}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-3 text-slate-700">
                                <div className="p-2 bg-white rounded-lg shadow-sm text-slate-400"><MapPin size={18}/></div>
                                <span className="text-sm truncate max-w-[200px]" title={activeItem.address}>{activeItem.address || 'No Location URL'}</span>
                            </div>
                            {activeItem.buildingNumber && (
                                <div className="flex items-center gap-3 text-slate-700">
                                    <div className="p-2 bg-white rounded-lg shadow-sm text-slate-400"><Home size={18}/></div>
                                    <span className="text-sm">Bldg: {activeItem.buildingNumber}</span>
                                </div>
                            )}
                        </div>

                        {!readOnly && (
                            <div className="mt-auto pt-8 w-full">
                                <button onClick={() => openModal('edit', activeItem)} className="w-full py-2 bg-white border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-100 hover:text-emerald-600 transition-colors">
                                    Edit Profile
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Right: History Panel */}
                    <div className="w-full md:w-2/3 p-8 flex flex-col bg-white overflow-hidden">
                        <h3 className="font-bold text-xl text-slate-800 mb-4 flex items-center gap-2">
                            <Clock size={20} className="text-slate-400"/>
                            Client History
                        </h3>
                        {/* Summary Chips */}
                        {(() => {
                            const timeline = getCustomerTimeline(activeItem.id);
                            const actCount = timeline.filter(i => i.kind === 'activity').length;
                            const ticketCount = timeline.filter(i => i.kind === 'ticket').length;
                            const doneCount = timeline.filter(i => i.status === 'DONE' || i.status === 'RESOLVED').length;
                            const cfCount = timeline.filter(i => i.status === 'CARRY_FORWARD' || i.carryForwardNote).length;
                            return (
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{actCount} Activities</span>
                                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200">{ticketCount} Tickets</span>
                                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{doneCount} Completed</span>
                                    {cfCount > 0 && <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{cfCount} Carry Forward</span>}
                                </div>
                            );
                        })()}
                        
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                            {getCustomerTimeline(activeItem.id).length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-60">
                                    <Calendar size={48} />
                                    <p>No service history found for this customer.</p>
                                </div>
                            ) : (
                                <div className="relative border-l-2 border-slate-100 ml-3 space-y-6 py-2">
                                    {getCustomerTimeline(activeItem.id).map((item, index) => {
                                        const isTicket = item.kind === 'ticket';
                                        const statusColor = 
                                            item.status === 'DONE' || item.status === 'RESOLVED' ? 'bg-emerald-500' :
                                            item.status === 'IN_PROGRESS' ? 'bg-blue-500' :
                                            item.status === 'CARRY_FORWARD' ? 'bg-amber-500' :
                                            item.status === 'CANCELLED' ? 'bg-slate-300' :
                                            item.status === 'ON_MY_WAY' || item.status === 'ARRIVED' ? 'bg-cyan-500' :
                                            'bg-amber-400';
                                        const statusBadge =
                                            item.status === 'DONE' || item.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-700' :
                                            item.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                                            item.status === 'CARRY_FORWARD' ? 'bg-amber-100 text-amber-700' :
                                            item.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' :
                                            item.status === 'ON_MY_WAY' || item.status === 'ARRIVED' ? 'bg-cyan-100 text-cyan-700' :
                                            'bg-amber-100 text-amber-700';
                                        
                                        return (
                                            <div key={`${item.kind}-${item.id}-${index}`} className="relative pl-8">
                                                {/* Timeline Dot */}
                                                <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm ${statusColor}`}>
                                                    {isTicket && <TicketIcon size={8} className="text-white absolute top-0.5 left-0.5" />}
                                                </div>
                                                
                                                <div className={`rounded-lg p-4 border hover:shadow-md transition-shadow cursor-pointer ${
                                                    isTicket ? 'bg-purple-50/30 border-purple-100' : 'bg-slate-50 border-slate-100'
                                                }`} onClick={() => setHistoryPreview(item)}>
                                                    {/* Header Row */}
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isTicket ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                                                                    {isTicket ? 'TICKET' : 'ACTIVITY'}
                                                                </span>
                                                                <span className="text-[10px] font-mono text-slate-400">{item.ref}</span>
                                                            </div>
                                                            <div className="font-bold text-slate-800 text-sm">{item.title}</div>
                                                            {item.serviceCategory && <div className="text-[10px] text-indigo-600">{item.serviceCategory}</div>}
                                                            <div className="text-xs text-slate-500 font-mono mt-0.5">{item.dateLabel} at {item.date.toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}</div>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusBadge}`}>
                                                                {item.status.replace(/_/g, ' ')}
                                                            </span>
                                                            <span className={`text-[9px] font-bold ${
                                                                item.priority === 'URGENT' ? 'text-red-600' : item.priority === 'HIGH' ? 'text-orange-500' : 'text-slate-400'
                                                            }`}>{item.priority}</span>
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Description */}
                                                    <p className="text-xs text-slate-600 mb-2 line-clamp-2">{item.description}</p>
                                                    
                                                    {/* Meta Row */}
                                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mb-2">
                                                        {item.techName && (
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-4 h-4 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[8px] font-bold">E</div>
                                                                <span className="truncate">{item.techName}</span>
                                                            </div>
                                                        )}
                                                        {item.location && (
                                                            <div className="flex items-center gap-1">
                                                                <MapPin size={10} className="text-slate-400"/>
                                                                <span className="truncate">{item.location}</span>
                                                            </div>
                                                        )}
                                                        {item.startedAt && item.completedAt && (
                                                            <div className="flex items-center gap-1">
                                                                <Clock size={10} className="text-slate-400"/>
                                                                <span>{Math.round((new Date(item.completedAt).getTime() - new Date(item.startedAt).getTime()) / 60000)}m actual</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Notes Section — Remarks, Completion, Carry Forward */}
                                                    {(item.remarks || item.completionNote || item.carryForwardNote || item.cancellationReason) && (
                                                        <div className="space-y-1.5 mt-2 pt-2 border-t border-slate-100">
                                                            {item.remarks && (
                                                                <div className="flex items-start gap-1.5">
                                                                    <MessageSquare size={10} className="text-slate-400 mt-0.5 shrink-0"/>
                                                                    <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{item.remarks}</p>
                                                                </div>
                                                            )}
                                                            {item.completionNote && (
                                                                <div className="bg-emerald-50 rounded p-2 border border-emerald-100">
                                                                    <div className="text-[9px] font-bold text-emerald-500 uppercase mb-0.5">Completion Summary</div>
                                                                    <p className="text-[11px] text-emerald-800 whitespace-pre-wrap">{item.completionNote}</p>
                                                                </div>
                                                            )}
                                                            {item.carryForwardNote && (
                                                                <div className="bg-amber-50 rounded p-2 border border-amber-100">
                                                                    <div className="text-[9px] font-bold text-amber-600 uppercase mb-0.5 flex items-center gap-1"><RotateCcw size={8}/> Carry Forward</div>
                                                                    <p className="text-[11px] text-amber-800 whitespace-pre-wrap">{item.carryForwardNote}</p>
                                                                    {item.nextPlannedAt && (
                                                                        <div className="text-[10px] text-amber-600 mt-1 font-medium">
                                                                            Next: {new Date(item.nextPlannedAt).toLocaleDateString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short'})} at {new Date(item.nextPlannedAt).toLocaleTimeString('en-GB', {timeZone:'Asia/Qatar', hour:'2-digit', minute:'2-digit'})}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {item.cancellationReason && (
                                                                <div className="bg-red-50 rounded p-2 border border-red-100">
                                                                    <div className="text-[9px] font-bold text-red-500 uppercase mb-0.5">Cancelled</div>
                                                                    <p className="text-[11px] text-red-700 whitespace-pre-wrap">{item.cancellationReason}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* History Item Preview Popup */}
        {historyPreview && (() => {
            const h = historyPreview;
            const isTicket = h.kind === 'ticket';
            const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('en-GB', {timeZone:'Asia/Qatar', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
            const statusColor = h.status === 'DONE' || h.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-700' : h.status === 'CARRY_FORWARD' ? 'bg-orange-100 text-orange-700' : h.status === 'CANCELLED' ? 'bg-red-100 text-red-600' : h.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
            const photos = h.photos || [];
            return (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setHistoryPreview(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                            <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isTicket ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>{isTicket ? 'TICKET' : 'ACTIVITY'}</span>
                                    <span className="text-[10px] font-mono text-slate-400">{h.ref}</span>
                                </div>
                                <h3 className="font-bold text-slate-900">{h.title}</h3>
                                {h.serviceCategory && <div className="text-xs text-indigo-600">{h.serviceCategory}</div>}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${statusColor}`}>{h.status.replace(/_/g, ' ')}</span>
                                <button onClick={() => setHistoryPreview(null)} className="p-1 hover:bg-slate-200 rounded-lg"><X size={16} className="text-slate-400"/></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* Timing */}
                            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-1.5">
                                <div className="text-[10px] font-bold text-slate-400 uppercase">Timing</div>
                                <div className="flex justify-between text-xs"><span className="text-slate-400">{isTicket ? 'Created' : 'Planned'}</span><span className="text-slate-700">{h.dateLabel}</span></div>
                                {h.startedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Started</span><span className="text-emerald-600">{fmtDt(h.startedAt)}</span></div>}
                                {h.completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Completed</span><span className="text-emerald-600">{fmtDt(h.completedAt)}</span></div>}
                                {h.startedAt && h.completedAt && <div className="flex justify-between text-xs"><span className="text-slate-400">Duration</span><span className="font-bold text-slate-700">{Math.round((new Date(h.completedAt).getTime() - new Date(h.startedAt).getTime()) / 60000)}m</span></div>}
                            </div>
                            {/* Engineer */}
                            {h.techName && <div className="bg-slate-50 rounded-xl p-3 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Assigned To</div><div className="text-xs font-bold text-slate-700">{h.techName}</div></div>}
                            {/* Description */}
                            {h.description && <div className="bg-slate-50 rounded-xl p-3 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Description</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{h.description}</p></div>}
                            {/* Completion */}
                            {h.completionNote && <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100"><div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Completion Summary</div><p className="text-xs text-emerald-800 whitespace-pre-wrap">{h.completionNote}</p></div>}
                            {/* Remarks */}
                            {h.remarks && h.remarks !== h.completionNote && <div className="bg-slate-50 rounded-xl p-3 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Remarks</div><p className="text-xs text-slate-700 whitespace-pre-wrap">{h.remarks}</p></div>}
                            {/* Carry Forward */}
                            {h.carryForwardNote && <div className="bg-amber-50 rounded-xl p-3 border border-amber-200"><div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Carry Forward</div><p className="text-xs text-amber-800 whitespace-pre-wrap">{h.carryForwardNote}</p>{h.nextPlannedAt && <div className="text-[10px] text-amber-600 mt-1">Re-scheduled: {fmtDt(h.nextPlannedAt)}</div>}</div>}
                            {/* Cancellation */}
                            {h.cancellationReason && <div className="bg-red-50 rounded-xl p-3 border border-red-100"><div className="text-[10px] font-bold text-red-500 uppercase mb-1">Cancelled</div><p className="text-xs text-red-700 whitespace-pre-wrap">{h.cancellationReason}</p></div>}
                            {/* Location */}
                            {h.location && <div className="flex items-center gap-2 text-xs text-slate-500"><MapPin size={10}/> {h.location}</div>}
                            {/* Photos */}
                            {photos.length > 0 && (
                                <div><div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Photos ({photos.length})</div><div className="grid grid-cols-3 gap-2">{photos.map((p: any, i: number) => <img key={i} src={p.url || p} alt="" className="w-full h-20 object-cover rounded-lg border border-slate-200 cursor-pointer" onClick={() => showPhotoLightbox(p.url || p)} />)}</div></div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
                            <button onClick={() => setHistoryPreview(null)} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm">Close</button>
                        </div>
                    </div>
                </div>
            );
        })()}

    </div>
  );
};

export default CustomerRecords;
