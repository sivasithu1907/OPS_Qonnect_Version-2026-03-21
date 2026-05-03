import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Customer } from '../types';
import { validatePhone, formatPhoneDisplay, normalizePhone } from '../utils/phoneUtils';
import { Search, UserPlus, CheckCircle2, X, Phone, User, Save, AlertCircle, Loader2 } from 'lucide-react';
import { generateCustomerId } from '../utils/idUtils';

interface CustomerSelectorProps {
  customers: Customer[];
  selectedCustomerId?: string;
  onSelect: (customer: Customer) => void;
  onCreateNew: (customer: Customer) => Promise<Customer | null> | void;
  onManualCreate?: (initialPhone: string) => void;
}

const escapeRegExp = (string: string) => {
  if (typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const HighlightedPhone: React.FC<{ text: string; highlight: string }> = ({ text, highlight }) => {
  if (!highlight) return <>{text}</>;
  const digits = highlight.replace(/\D/g, '');
  if (!digits) return <>{text}</>;
  return <>{text}</>;
};

const CustomerSelector: React.FC<CustomerSelectorProps> = ({
  customers,
  selectedCustomerId,
  onSelect,
  onCreateNew,
  onManualCreate,
}) => {
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

  useEffect(() => {
    if (selectedCustomer) setSearchTerm(selectedCustomer.name);
  }, [selectedCustomer]);

  const inputDigits = searchTerm.replace(/\D/g, '');
  const isSelectedName = selectedCustomer && searchTerm === selectedCustomer.name;

  const exactMatch = useMemo(() => {
    if (!inputDigits || inputDigits.length < 4) return null;
    return customers.find(c => normalizePhone(c.phone).endsWith(inputDigits)) || null;
  }, [customers, inputDigits]);

  const partialMatches = useMemo(() => {
    if (!inputDigits || inputDigits.length < 2) return [];
    return customers
      .filter(c => normalizePhone(c.phone).includes(inputDigits) && c !== exactMatch)
      .slice(0, 8);
  }, [customers, inputDigits, exactMatch]);

  const showBanner = !!exactMatch && !selectedCustomer;
  const showDropdown =
    isOpen && !isSelectedName && (partialMatches.length > 0 || (!exactMatch && inputDigits.length > 0));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (selectedCustomer) setSearchTerm(selectedCustomer.name);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedCustomer]);

  // ── Customer create — runs completely outside parent form via Portal ──
  const handleSaveCustomer = async () => {
    setPhoneError(null);
    setSaveError(null);

    if (!newName.trim()) {
      setSaveError('Customer name is required.');
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
      setPhoneError(`Number already registered for ${exists.name}.`);
      return;
    }

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
      const result = await onCreateNew(tempCustomer);
      const saved = (result as Customer) || tempCustomer;
      onSelect(saved);
      setSearchTerm(saved.name);
      setNewName('');
      setNewPhone('');
      setShowCreateModal(false);
    } catch (err) {
      console.error('Save customer error:', err);
      setSaveError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Portal modal — rendered at document.body, completely outside any <form> ──
  const createModal = showCreateModal && !onManualCreate
    ? ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 mx-4 animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-slate-900">Add New Customer</h3>
              <button
                type="button"
                onClick={() => { setShowCreateModal(false); setNewName(''); setNewPhone(''); setPhoneError(null); setSaveError(null); }}
                disabled={isSaving}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>

            {/* Name field */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  disabled={isSaving}
                  placeholder="e.g. John Doe"
                  className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 pl-9 text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-60"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleSaveCustomer(); } }}
                />
              </div>
            </div>

            {/* Phone field */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Mobile Number <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Phone size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={newPhone}
                  onChange={e => { setNewPhone(e.target.value); setPhoneError(null); }}
                  disabled={isSaving}
                  placeholder="3300 0000"
                  className={`w-full bg-white text-slate-900 border rounded-lg p-2.5 pl-9 text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-60 ${phoneError ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleSaveCustomer(); } }}
                />
              </div>
              {phoneError && <p className="text-xs text-red-600 mt-1 font-medium">{phoneError}</p>}
              <p className="text-[10px] text-slate-400 mt-1">Default country: Qatar (+974)</p>
            </div>

            {saveError && (
              <div className="p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700 flex items-center gap-1.5 mb-4">
                <AlertCircle size={14} /> {saveError}
              </div>
            )}

            {/* Save button — type="button" so it NEVER submits any form */}
            <button
              type="button"
              onClick={handleSaveCustomer}
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
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
        Customer <span className="text-red-500">*</span>
      </label>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={e => { setSearchTerm(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search by phone..."
          className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 pl-9 text-sm focus:ring-2 focus:ring-emerald-500 outline-none placeholder:text-slate-400"
        />
        <Search size={16} className="absolute left-3 top-3 text-slate-400" />
        {selectedCustomer && searchTerm === selectedCustomer.name && (
          <CheckCircle2 size={16} className="absolute right-3 top-3 text-emerald-500" />
        )}
      </div>

      {/* Exact match banner */}
      {showBanner && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-emerald-50 border border-emerald-200 p-3 rounded-lg z-20 flex items-center justify-between shadow-lg">
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
            className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-700 transition-colors"
          >
            Select
          </button>
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className={`absolute left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-10 ${showBanner ? 'top-[calc(100%+80px)]' : 'top-full mt-1'}`}>
          {partialMatches.map(c => (
            <div
              key={c.id}
              onClick={() => { onSelect(c); setSearchTerm(c.name); setIsOpen(false); }}
              className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 flex flex-col"
            >
              <span className="text-sm font-bold text-slate-900">{c.name}</span>
              <span className="text-xs text-slate-500 font-mono mt-0.5">{formatPhoneDisplay(c.phone)}</span>
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

      {/* Portal modal rendered at document.body — completely outside any <form> */}
      {createModal}
    </div>
  );
};

export default CustomerSelector;
