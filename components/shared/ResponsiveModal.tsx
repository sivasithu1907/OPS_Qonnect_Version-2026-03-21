import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';

/**
 * ONE responsive dialog shell for the customer forms (Clients, Activity Planner, Tickets, Sales requests, Team Lead mobile).
 *
 *  • Desktop / tablet: centred, a consistent width (sm 28rem · md 40rem · lg 48rem), never taller than the visible window.
 *  • The header and the footer (Save / Cancel) are fixed; ONLY the body scrolls, so the actions are always reachable
 *    however many suggestions or warnings are showing.
 *  • Phones (< 640px wide) and short landscape windows (< 520px tall): full screen, single column, safe-area padding
 *    (notch / home indicator), 44px touch targets and 16px inputs (no iOS zoom-on-focus) — see `.qn-rm-*` in index.css.
 *  • On-screen keyboard: the shell is sized to the VISUAL viewport (visualViewport API) when the keyboard shrinks it,
 *    so the footer is never hidden behind it; the focused field is scrolled into view.
 *  • Escape closes (only the top-most dialog), focus moves into the dialog, Tab is kept inside it, and focus returns to
 *    whatever opened it. role="dialog" + aria-modal + aria-labelledby; the page behind does not scroll.
 *
 * `as="form"` renders the whole shell as a <form> (header + body + footer) so a submit button in the sticky footer still
 * submits it and Enter inside a field behaves as before.
 */
export type ResponsiveModalSize = 'sm' | 'md' | 'lg';
const WIDTH: Record<ResponsiveModalSize, string> = { sm: '28rem', md: '40rem', lg: '48rem' };

let scrollLocks = 0;
let savedOverflow = '';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Height/offset of the VISIBLE viewport while the on-screen keyboard is open (null = nothing to correct). */
const useKeyboardBox = (): { top: number; height: number } | null => {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      // A shrink of more than 120px compared with the layout viewport is the keyboard (browser toolbars move far less).
      if (window.innerHeight - vv.height > 120) setBox({ top: Math.round(vv.offsetTop), height: Math.round(vv.height) });
      else setBox(null);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return box;
};

export interface ResponsiveModalProps {
  title?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** sticky actions (Save / Cancel). Rendered inside `.qn-rm-footer`. */
  footer?: React.ReactNode;
  /** always-visible message strip between the body and the footer (form-level error) */
  status?: React.ReactNode;
  size?: ResponsiveModalSize;
  as?: 'div' | 'form';
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  noValidate?: boolean;
  icon?: React.ReactNode;
  testId?: string;
  /** render into document.body (escapes ancestors with transforms / overflow) */
  portal?: boolean;
  zIndexClass?: string;
  /** clicking the dimmed backdrop closes (only the forms that always did this keep it) */
  backdropClose?: boolean;
  /** disables the close button and Escape (e.g. while saving) */
  busy?: boolean;
  closeLabel?: string;
  bodyClassName?: string;
  /** bare: only the shell (backdrop, panel, focus, Escape, keyboard, scroll lock) — the caller supplies the .qn-rm-header / .qn-rm-body / .qn-rm-footer children and `ariaLabel` */
  bare?: boolean;
  ariaLabel?: string;
}

const ResponsiveModal: React.FC<ResponsiveModalProps> = ({
  title, onClose, children, footer, status, size = 'md', as = 'div', onSubmit, noValidate, icon, testId, portal = true,
  zIndexClass = 'z-50', backdropClose = false, busy = false, closeLabel = 'Close dialog', bodyClassName = '', bare = false, ariaLabel,
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const keyboard = useKeyboardBox();
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;

  // Focus in on open, back to the opener on close; keep the page behind from scrolling.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (scrollLocks++ === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const first = bodyRef.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
        || panel.querySelector<HTMLElement>(FOCUSABLE);
      (first || panel).focus({ preventScroll: true });
    }
    return () => {
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      if (opener && document.contains(opener)) { try { opener.focus({ preventScroll: true }); } catch { /* ignore */ } }
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.stopPropagation(); // the top-most dialog only (a Planner dialog opened over another dialog closes alone)
      if (!busyRef.current) { e.preventDefault(); onCloseRef.current(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current; if (!panel) return;
    const items = (Array.from(panel.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
  };

  // A focused field must not sit under the keyboard / a sticky bar.
  const onFocusCapture = (e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    if (!bodyRef.current || !bodyRef.current.contains(t) || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    window.setTimeout(() => { try { t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ } }, 250);
  };

  const Panel: any = as;
  const panelProps: any = {
    ref: panelRef as any, role: 'dialog', 'aria-modal': true, 'aria-labelledby': bare ? undefined : titleId, 'aria-label': bare ? ariaLabel : undefined, 'data-testid': testId, tabIndex: -1,
    className: 'qn-rm-panel qn-modal-panel', style: { ['--qn-rm-w' as any]: WIDTH[size] },
    onClick: (e: React.MouseEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onKeyDown, onFocusCapture,
  };
  if (as === 'form') { panelProps.onSubmit = onSubmit; if (noValidate) panelProps.noValidate = true; }

  const node = (
    <div
      className={`qn-rm-backdrop qn-modal-backdrop fixed inset-0 ${zIndexClass}`}
      style={keyboard ? { top: keyboard.top, height: keyboard.height, bottom: 'auto' } : undefined}
      data-keyboard-open={keyboard ? 'true' : undefined}
      onMouseDown={backdropClose ? (e) => { if (e.target === e.currentTarget && !busy) onClose(); } : undefined}
    >
      <Panel {...panelProps}>
        {bare ? children : (<>
        <div className="qn-rm-header">
          {icon ? <div className="shrink-0">{icon}</div> : null}
          <h2 id={titleId} className="qn-rm-title">{title}</h2>
          <button type="button" onClick={() => { if (!busy) onClose(); }} disabled={busy} aria-label={closeLabel} className="qn-rm-close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div ref={bodyRef} className={`qn-rm-body ${bodyClassName}`}>{children}</div>
        {status ? <div className="qn-rm-status">{status}</div> : null}
        {footer ? <div className="qn-rm-footer">{footer}</div> : null}
        </>)}
      </Panel>
    </div>
  );
  return portal && typeof document !== 'undefined' ? ReactDOM.createPortal(node, document.body) : node;
};

export default ResponsiveModal;
