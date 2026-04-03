
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Customer } from '../types';
import { validatePhone, formatPhoneDisplay, normalizePhone } from '../utils/phoneUtils';
import { Search, UserPlus, CheckCircle2, AlertTriangle, X, Phone, User, Save, AlertCircle, Loader2 } from 'lucide-react';
import { generateCustomerId } from '../utils/idUtils';

interface CustomerSelectorProps {
  customers: Customer[];
  selectedCustomerId?: string;
  onSelect: (customer: Customer) => void;
  // onCreateNew now returns a Promise so we can await the DB save and get the real ID back
  onCreateNew: (customer: Customer) => Promise<Customer | null> | void;
  onManualCreate?: (initialPhone: string) => void;
}

// Helper to escape regex special characters
const escapeRegExp = (string: string) => {
  if (typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Highlight matching text in phone numbers
const HighlightedPhone: React.FC<{ text: string; highlight: string }> = ({ text, highlight }) => {
  if (!highlight) return <>{text}</>;
  const escaped = escapeRegExp(highlight.replace(/\D/g, ''));
  if (!escaped) return <>{text}</>;
  const regex = new RegExp(`(${escaped})`, 'g');
  const parts = text.replace(/\D/g, '').split(regex);
  let i = 0;
  return (
    <>
      {text.split('').map((char) => {
        if (/\d/.test(char)) {
          const part = parts[i] !== undefined ? parts[i] : char;
          i++;
          return regex.test(char) ? <mark key={i} className="bg-yellow-100 text-slate-900 rounded-sm">{char}</mark> : <span key={i}>{char}</span>;
        }
        return <span key={`sep-${i}`}>{char}</span>;
      })}
    </>
  );
};

const CustomerSelector: React.FC<CustomerSelectorProps> = ({ customers, selectedCustomerId, onSelect, onCreateNew, onManualCreate }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  // Sync search term when a customer is selected externally or newly created customer loads
  useEffect(() => {
    if (selectedCustomer) {
      setSearchTerm(selectedCustomer.name);
    }
  }, [selectedCustomer]);

  const inputDigits = searchTerm.replace(/\D/g, '');
  const isSelectedName = selectedCustomer && searchTerm === selectedCustomer.name;

  const exactMatch = useMemo(() => {
    if (!inputDigits || inputDigits.length < 4) return null;
    return customers.find(c => normalizePhone(c.phone).endsWith(inputDigits)) || null;
  }, [customers, inputDigits]);

  const partialMatches = useMemo(() => {
    if (!inputDigits || inputDigits.length < 2) return [];
    return customers.filter(c =>
      normalizePhone(c.phone).includes(inputDigits) && c !== exactMatch
    ).slice(0, 8);
  }, [customers, inputDigits, exactMatch]);

  const showBanner = !!exactMatch && !selectedCustomer;
  const showDropdown = isOpen && !isSelectedName && (partialMatches.length > 0 || (!exactMatch && inputDigits.length > 0));

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (selectedCustomer) {
          setSearchTerm(selectedCustomer.name);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedCustomer]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    // CRITICAL: Stop event from bubbling to the parent PlanningModule form
    e.preventDefault();
    e.stopPropagation();

    setPhoneError(null);
    setSaveError(null);

    // Validation
    if (!newName || !newName.trim()) {
      setSaveError('Customer Name is required.');
      return;
    }

    const validation = validatePhone(newPhone);
    if (!validation.isValid) {
      setPhoneError(validation.error || 'Invalid phone number');
      return;
    }

    const formattedPhone = validation.formatted || newPhone;

    const exists = customers.find(c => c.phone === formattedPhone);
    if (exists) {
      setPhoneError(`Number already exists for ${exists.name}.`);
      return;
    }

    // Build temp customer object (ID will be replaced by DB-assigned ID)
    const tempCustomer: Customer = {
      id: generateCustomerId(),
      name: newName.trim(),
      phone: formattedPhone,
      email: '',
      address: '',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(newName.trim())}&background=random`,
    };

    setIsSaving(true);
    try {
      // Await the API call — onCreateNew now returns Promise<Customer | null>
      const result = await onCreateNew(tempCustomer);
      // Use the DB-assigned customer (real ID) if returned, else fall back to temp
      const savedCustomer = result || tempCustomer;

      // Select the newly created customer immediately
      onSelect(savedCustomer);
      setSearchTerm(savedCustomer.name);

      // Reset and close modal ONLY after successful save
      setNewName('');
      setNewPhone('');
      setShowCreateModal(false);
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to save customer:', err);
      setSaveError('Failed to save customer. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Customer <span className="text-red-500">*</span></label>

      {/* Input Field */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search by phone..."
          className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 pl-9 text-sm focus:ring-2 focus:ring-emerald-500 outline-none placeholder:text-slate-400"
        />
        <Search size={16} className="absolute left-3 top-3 text-slate-400" />
        {selectedCustomer && searchTerm === selectedCustomer.name && (
          <CheckCircle2 size={16} className="absolute right-3 top-3 text-emerald-500" />
        )}
      </div>

      {/* EXACT MATCH BANNER */}
      {showBanner && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-emerald-50 border border-emerald-200 p-3 rounded-lg z-20 flex items-center justify-between shadow-lg animate-in slide-in-from-top-1 duration-200">
          <div>
            <div className="text-xs text-emerald-800 font-bold flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Client Found
            </div>
            <div className="text-sm font-bold text-slate-800">{exactMatch.name}</div>
            <div className="text-xs text-slate-500 font-mono">{formatPhoneDisplay(exactMatch.phone)}</div>
          </div>
          <button
            type="button"
            onClick={() => { onSelect(exactMatch); setSearchTerm(exactMatch.name); setIsOpen(false); }}
            className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-700 transition-colors shadow-sm"
          >
            Select
          </button>
        </div>
      )}

      {/* DROPDOWN LIST */}
      {showDropdown && (
        <div className={`absolute left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-10 animate-in fade-in zoom-in-95 duration-100 ${showBanner ? 'top-[calc(100%+80px)]' : 'top-full mt-1'}`}>
          {partialMatches.map(c => (
            <div
              key={c.id}
              onClick={() => { onSelect(c); setSearchTerm(c.name); setIsOpen(false); }}
              className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 flex flex-col"
            >
              <span className="text-sm font-bold text-slate-900">{c.name}</span>
              <span className="text-xs text-slate-500 font-mono mt-0.5">
                <HighlightedPhone text={formatPhoneDisplay(c.phone)} highlight={searchTerm} />
              </span>
            </div>
          ))}

          {!exactMatch && (
            <div className="p-2 sticky bottom-0 bg-white border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  if (onManualCreate) {
                    onManualCreate(searchTerm);
                    setIsOpen(false);
                  } else {
                    setNewPhone(searchTerm);
                    setShowCreateModal(true);
                    setIsOpen(false);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
              >
                <UserPlus size={16} />
                + Create New Customer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Modal — rendered OUTSIDE the parent form via stop-propagation to avoid nested form submit bubble */}
      {showCreateModal && !onManualCreate && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-slate-900">Add New Customer</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} disabled={isSaving}>
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            {/* IMPORTANT: This form uses onSubmit with stopPropagation to prevent
                bubbling to the parent PlanningModule form which would close the planner modal */}
            <form
              onSubmit={handleCreateSubmit}
              className="space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={isSaving}
                    className="w-full bg-white text-slate-900 placeholder:text-slate-400 border border-slate-300 rounded-lg p-2.5 pl-9 text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-60"
                    placeholder="e.g. John Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Mobile Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    required
                    value={newPhone}
                    onChange={(e) => { setNewPhone(e.target.value); setPhoneError(null); }}
                    disabled={isSaving}
                    className={`w-full bg-white text-slate-900 placeholder:text-slate-400 border rounded-lg p-2.5 pl-9 text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-60 ${phoneError ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                    placeholder="3300 0000"
                  />
                </div>
                {phoneError && <p className="text-xs text-red-600 mt-1 font-medium">{phoneError}</p>}
                <p className="text-[10px] text-slate-400 mt-1">Default country: Qatar (+974)</p>
              </div>

              {saveError && (
                <div className="p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700 flex items-center gap-1.5">
                  <AlertCircle size={14} /> {saveError}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-bold shadow-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <><Loader2 size={18} className="animate-spin" /> Saving...</>
                  ) : (
                    <><Save size={18} /> Save Customer</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerSelector;
