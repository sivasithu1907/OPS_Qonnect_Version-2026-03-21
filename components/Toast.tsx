/**
 * Toast.tsx — Lightweight self-contained toast notification system.
 * Zero external dependencies. Drop-in replacement for react-hot-toast API.
 * Usage: import toast from './Toast';  toast.success('Done!');  toast.error('Failed');
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

// ── Global event bus ──────────────────────────────────────────────────────────
type Listener = (t: ToastItem) => void;
let listeners: Listener[] = [];
let counter = 0;

function emit(message: string, type: ToastType, duration: number) {
  const item: ToastItem = { id: `t-${++counter}`, message, type, duration };
  listeners.forEach(fn => fn(item));
}

// ── Public API (matches react-hot-toast surface) ──────────────────────────────
const toast = {
  success: (msg: string, opts?: { duration?: number }) => emit(msg, 'success', opts?.duration ?? 4000),
  error:   (msg: string, opts?: { duration?: number }) => emit(msg, 'error',   opts?.duration ?? 5000),
  info:    (msg: string, opts?: { duration?: number }) => emit(msg, 'info',    opts?.duration ?? 4000),
};
export default toast;

// ── Single toast card ─────────────────────────────────────────────────────────
const ICONS = {
  success: <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" />,
  error:   <XCircle     size={18} className="text-red-500     shrink-0 mt-0.5" />,
  info:    <AlertTriangle size={18} className="text-amber-500  shrink-0 mt-0.5" />,
};

const BORDERS = {
  success: 'border-l-4 border-emerald-400',
  error:   'border-l-4 border-red-400',
  info:    'border-l-4 border-amber-400',
};

function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Slide in
    const show = setTimeout(() => setVisible(true), 10);
    // Auto dismiss
    const hide = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onRemove(item.id), 300);
    }, item.duration);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [item.id, item.duration, onRemove]);

  return (
    <div
      className={`flex items-start gap-3 bg-white shadow-lg rounded-xl px-4 py-3 max-w-sm w-full
        ${BORDERS[item.type]} transition-all duration-300
        ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
      style={{ fontFamily: 'inherit', fontSize: '14px' }}
    >
      {ICONS[item.type]}
      <span className="flex-1 text-slate-800 leading-snug">{item.message}</span>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onRemove(item.id), 300); }}
        className="text-slate-400 hover:text-slate-600 shrink-0 mt-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Container — render this once in App.tsx ───────────────────────────────────
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const listenerRef = useRef<Listener | null>(null);

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const fn: Listener = (item) => setToasts(prev => [...prev, item]);
    listenerRef.current = fn;
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard item={t} onRemove={remove} />
        </div>
      ))}
    </div>,
    document.body
  );
}
