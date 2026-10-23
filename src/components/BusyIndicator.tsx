import { useStore } from "@nanostores/react";

import { isCalculating, isLoading } from "@/lib/context";

// "Calculating…" pill at the top of the map while questions or hiding zones are worked out.
// Fades in after a short delay (CSS, so it works even while the page is busy computing)
// so quick updates don't flicker.
export const BusyIndicator = () => {
    const $isLoading = useStore(isLoading);
    const $isCalculating = useStore(isCalculating);
    const busy = $isLoading || $isCalculating > 0;

    if (!busy) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="busy-indicator flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-sm font-medium text-slate-800 shadow-md border border-black/20"
        >
            <svg
                className="h-4 w-4 animate-spin text-blue-600"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
            >
                <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeOpacity="0.25"
                    strokeWidth="3"
                />
                <path
                    d="M21 12a9 9 0 0 0-9-9"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
            </svg>
            Calculating…
        </div>
    );
};

// Lets the browser paint the indicator before heavy synchronous work starts
export const yieldToPaint = () =>
    new Promise<void>((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
    );
