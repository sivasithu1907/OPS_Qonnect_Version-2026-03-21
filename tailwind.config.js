/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./constants.tsx",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          850: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      // ── Qonnect motion tokens (Sprint 2.2) ─────────────────────────────
      // One consistent timing language across the whole app.
      // fast  = micro interactions (hover, press, badge)
      // base  = panel/card transitions
      // slow  = page fades, skeleton shimmer
      transitionDuration: {
        fast: '100ms',
        base: '180ms',
        slow: '300ms',
      },
      transitionTimingFunction: {
        // Snappy start, soft landing — feels "premium app" not "website"
        premium: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        // For items entering the screen (elements slide up gently)
        enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
        // For items leaving
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      },
      keyframes: {
        // Page transition — tiny upward movement + fade
        'page-in': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Card/row appear
        'item-in': {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Shimmer for skeleton loaders
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Status badge transition — cross-fade via opacity
        'badge-pop': {
          '0%':   { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'page-in':   'page-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'item-in':   'item-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer:     'shimmer 1.6s linear infinite',
        'badge-pop': 'badge-pop 120ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
}
