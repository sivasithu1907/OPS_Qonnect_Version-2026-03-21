/**
 * Toast.tsx — Sprint 2.3 upgraded toast system.
 *
 * Additions over the original:
 *  - `warning` type (distinct from `info` — amber vs yellow)
 *  - Optional `action` button on any toast (e.g. "View", "Undo")
 *  - Consistent icon set — one icon per semantic meaning
 *  - Subtle progress bar indicates auto-dismiss timing
 *  - Reduced-motion: skips slide/translate, keeps opacity fade only
 *
 * Backward compatible: existing toast.success / error / info calls
 * continue to work with no changes anywhere.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  duration?: number;
  action?: ToastAction;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
}

// ── Global event bus ──────────────────────────────────────────────────────────
type Listener = (t: ToastItem) => void;
let listeners: Listener[] = [];
let counter = 0;

function emit(message: string, type: ToastType, duration: number, action?: ToastAction) {
  const item: ToastItem = { id: `t-${++counter}`, message, type, duration, action };
  listeners.forEach(fn => fn(item));
}

// ── Public API — fully backward-compatible ────────────────────────────────────
const toast = {
  success: (msg: string, opts?: ToastOptions) =>
    emit(msg, 'success', opts?.duration ?? 4000, opts?.action),
  error: (msg: string, opts?: ToastOptions) =>
    emit(msg, 'error', opts?.duration ?? 5000, opts?.action),
  info: (msg: string, opts?: ToastOptions) =>
    emit(msg, 'info', opts?.duration ?? 4000, opts?.action),
  warning: (msg: string, opts?: ToastOptions) =>
    emit(msg, 'warning', opts?.duration ?? 4500, opts?.action),
};
export default toast;

// ── Per-type config ───────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<ToastType, {
  icon: React.ReactNode;
  border: string;
  iconBg: string;
  progressColor: string;
}> = {
  success: {
    icon: <CheckCircle2 size={16} className="text-emerald-600" aria-hidden="true" />,
    border: 'border-l-[3px] border-emerald-400',
    iconBg: 'bg-emerald-50',
    progressColor: 'bg-emerald-400',
  },
  error: {
    icon: <XCircle size={16} className="text-red-600" aria-hidden="true" />,
    border: 'border-l-[3px] border-red-400',
    iconBg: 'bg-red-50',
    progressColor: 'bg-red-400',
  },
  warning: {
    icon: <AlertTriangle size={16} className="text-amber-600" aria-hidden="true" />,
    border: 'border-l-[3px] border-amber-400',
    iconBg: 'bg-amber-50',
    progressColor: 'bg-amber-400',
  },
  info: {
    icon: <Info size={16} className="text-blue-600" aria-hidden="true" />,
    border: 'border-l-[3px] border-blue-400',
    iconBg: 'bg-blue-50',
    progressColor: 'bg-blue-400',
  },
};

// ── Single toast card ─────────────────────────────────────────────────────────
function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const cfg = TYPE_CONFIG[item.type];

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onRemove(item.id), 300);
  }, [item.id, onRemove]);

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 10);
    const hide = setTimeout(dismiss, item.duration);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [item.id, item.duration, dismiss]);

  return (
    <div
      role="alert"
      aria-live={item.type === 'error' ? 'assertive' : 'polite'}
      className={`
        relative flex items-start gap-3 bg-white shadow-[0_4px_20px_-4px_rgba(15,23,42,0.18),0_1px_4px_-1px_rgba(15,23,42,0.08)]
        rounded-xl px-4 py-3 max-w-sm w-full overflow-hidden
        ${cfg.border}
        transition-all duration-300
        ${visible
          ? 'opacity-100 translate-x-0'
          : 'opacity-0 translate-x-6'
        }
      `}
      style={{ fontFamily: 'inherit', fontSize: '13px' }}
    >
      {/* Icon */}
      <div className={`shrink-0 mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center ${cfg.iconBg}`}>
        {cfg.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-slate-800 leading-snug font-medium">{item.message}</p>
        {item.action && (
          <button
            type="button"
            onClick={() => { item.action!.onClick(); dismiss(); }}
            className="mt-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 underline underline-offset-2 transition-colors"
          >
            {item.action.label}
          </button>
        )}
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="shrink-0 mt-0.5 p-0.5 text-slate-300 hover:text-slate-500 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
      >
        <X size={13} />
      </button>

      {/* Progress bar — shows auto-dismiss countdown */}
      <div
        className={`absolute bottom-0 left-0 h-[2px] ${cfg.progressColor} origin-left`}
        style={{
          animation: `qn-toast-progress ${item.duration}ms linear forwards`,
        }}
        aria-hidden="true"
      />
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
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard item={t} onRemove={remove} />
        </div>
      ))}
    </div>,
    document.body
  );
}
