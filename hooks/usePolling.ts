import { useEffect, useRef } from 'react';

/**
 * Reusable polling hook with:
 * - Configurable interval
 * - Auto-pause when tab is hidden
 * - Prevents overlapping calls
 * - Cleanup on unmount
 */
export function usePolling(
    callback: () => Promise<void>,
    intervalMs: number,
    enabled: boolean = true
) {
    const isRunning = useRef(false);

    useEffect(() => {
        if (!enabled) return;

        const poll = async () => {
            if (isRunning.current || document.hidden) return;
            isRunning.current = true;
            try {
                await callback();
            } catch (e) {
                console.error('Polling error:', e);
            } finally {
                isRunning.current = false;
            }
        };

        const interval = setInterval(poll, intervalMs);
        return () => clearInterval(interval);
    }, [callback, intervalMs, enabled]);
}

export default usePolling;
