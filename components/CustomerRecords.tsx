
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Customer, Activity, Technician, Site } from '../types';
import { validatePhone, normalizePhone, formatPhoneDisplay } from '../utils/phoneUtils';
import { Search, Edit, Trash2, Eye, Plus, X, Mail, Phone, MapPin, Camera, Upload, Contact, Calendar, Clock, ArrowRight, Home } from 'lucide-react';

interface CustomerRecordsProps {
  customers: Customer[];
  activities: Activity[];
  technicians: Technician[];
  sites: Site[];
  onSaveCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
  readOnly?: boolean;
  isMobile?: boolean; // New prop for mobile responsiveness
}

const CustomerRecords: React.FC<CustomerRecordsProps> = ({ 
    customers,
    activities,
    technicians,
    sites,
    onSaveCustomer,
    onDeleteCustomer,
    readOnly = false,
    isMobile = false
}) => {
  const [modalType, setModalType] = useState<'add' | 'edit' | 'view' | null>(null);
  const [activeItem, setActiveItem] = useState<Customer | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  
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
      
      // 1. Validate Building Number (Required)
      if (!rawData.buildingNumber || rawData.buildingNumber.toString().trim() === "") {
          setFormError("Building Number is required.");
          return;
      }

      // 2. Validate Location (Required)
      if (!rawData.address || rawData.address.toString().trim() === "") {
          setFormError("Location is required.");
          return;
      }

      // 3. Validate Phone
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

  // Activity History Logic
  const getCustomerHistory = (customerId: string) => {
      return activities
          .filter(a => a.customerId === customerId)
          .sort((a, b) => new Date(b.plannedDate).getTime() - new Date(a.plannedDate).getTime());
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
                                    <span className="truncate">{cust.address || 'No location set'}</span>
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
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs">
                            <tr>
                                <th className="px-6 py-4">Client</th>
                                <th className="px-6 py-4">Contact</th>
                                <th className="px-6 py-4">Location</th>
                                <th className="px-6 py-4 text-center">History</th>
                                <th className="px-6 py-4 text-right">Actions</th>
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
                                        <td className="px-6 py-4 text-slate-600 max-w-xs">
                                            <div className="truncate">{cust.address || '-'}</div>
                                            {cust.buildingNumber && <div className="text-xs text-slate-400 mt-0.5">Bldg: {cust.buildingNumber}</div>}
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
                                Location (URL) <span className="text-red-500">*</span>
                            </label>
                            <input 
                                name="address" 
                                defaultValue={activeItem?.address} 
                                required
                                disabled={readOnly}
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100" 
                                placeholder="https://maps.google.com..."
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase">
                                Building Number <span className="text-red-500">*</span>
                            </label>
                            <input 
                                name="buildingNumber" 
                                defaultValue={activeItem?.buildingNumber} 
                                required
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
                        <h3 className="font-bold text-xl text-slate-800 mb-6 flex items-center gap-2">
                            <Clock size={20} className="text-slate-400"/>
                            After-Sales Activity History
                        </h3>
                        
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                            {getCustomerHistory(activeItem.id).length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-60">
                                    <Calendar size={48} />
                                    <p>No service history found for this customer.</p>
                                </div>
                            ) : (
                                <div className="relative border-l-2 border-slate-100 ml-3 space-y-8 py-2">
                                    {getCustomerHistory(activeItem.id).map((act, index) => {
                                        const site = sites.find(s => s.id === act.siteId);
                                        const tech = technicians.find(t => t.id === act.leadTechId);
                                        
                                        return (
                                            <div key={act.id} className="relative pl-8">
                                                {/* Timeline Dot */}
                                                <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm ${
                                                    act.status === 'DONE' ? 'bg-emerald-500' :
                                                    act.status === 'IN_PROGRESS' ? 'bg-blue-500' : 
                                                    act.status === 'CANCELLED' ? 'bg-slate-300' : 'bg-amber-400'
                                                }`} />
                                                
                                                <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 hover:shadow-md transition-shadow">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div>
                                                            <div className="font-bold text-slate-800 text-sm">{act.type}</div>
                                                            <div className="text-xs text-slate-500 font-mono mt-0.5">{new Date(act.plannedDate).toLocaleDateString()} at {new Date(act.plannedDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                                        </div>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                             act.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                                                             act.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 
                                                             act.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'
                                                        }`}>
                                                            {act.status.replace('_', ' ')}
                                                        </span>
                                                    </div>
                                                    
                                                    <p className="text-sm text-slate-600 mb-3">{act.description}</p>
                                                    
                                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                                        <div className="flex items-center gap-1.5 text-slate-500">
                                                            <MapPin size={12} />
                                                            <span className="truncate">{site?.name || 'Unknown Site'}</span>
                                                        </div>
                                                        {tech && (
                                                            <div className="flex items-center gap-1.5 text-slate-500">
                                                                <div className="w-4 h-4 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[8px] font-bold">L</div>
                                                                <span className="truncate">{tech.name}</span>
                                                            </div>
                                                        )}
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
            </div>
        )}

    </div>
  );
};

export default CustomerRecords;
