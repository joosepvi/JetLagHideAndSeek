import { Component, type ComponentType, type ReactNode } from "react";

import { BusyIndicator } from "./BusyIndicator";
import { Map } from "./Map";
import { QuestionSidebar } from "./QuestionSidebar";
import { TutorialDialog } from "./TutorialDialog";
import { ZoneSidebar } from "./ZoneSidebar";

// Keys this app saves in the browser; clearing them starts a fresh game
const clearSavedGame = () => {
    try {
        localStorage.clear();
    } catch {
        // Storage blocked: a reload is all we can do
    }
    location.reload();
};

// Catches a crash in one part of the app, so the rest keeps working and the player
// sees what happened instead of an empty dark screen.
export class ErrorBoundary extends Component<
    { children: ReactNode; compact?: boolean },
    { error: Error | null }
> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        console.error(error);
    }

    render() {
        if (!this.state.error) return this.props.children;
        if (this.props.compact) return null;

        return (
            <div className="absolute inset-0 z-[1040] flex items-center justify-center bg-slate-900/95 p-6 text-white">
                <div className="max-w-sm space-y-4 text-center">
                    <h2 className="text-xl font-semibold">
                        Midagi läks valesti
                    </h2>
                    <p className="text-sm text-slate-300">
                        Kaarti ei õnnestunud näidata. Proovi uuesti laadida.
                        Kui viga kordub, tühjenda salvestatud mäng (küsimused ja
                        seaded selles brauseris kustutatakse).
                    </p>
                    <p className="break-words text-xs text-slate-400">
                        {this.state.error.message}
                    </p>
                    <div className="flex justify-center gap-2">
                        <button
                            className="rounded bg-white px-3 py-2 text-sm font-medium text-slate-900"
                            onClick={() => location.reload()}
                        >
                            Laadi uuesti
                        </button>
                        <button
                            className="rounded border border-white/40 px-3 py-2 text-sm"
                            onClick={clearSavedGame}
                        >
                            Tühjenda salvestatud mäng
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

const guarded =
    <P extends object>(Inner: ComponentType<P>, compact = false) =>
    (props: P) => (
        <ErrorBoundary compact={compact}>
            <Inner {...props} />
        </ErrorBoundary>
    );

// The page's islands, each behind its own error boundary
export const SafeMap = guarded(Map);
export const SafeQuestionSidebar = guarded(QuestionSidebar, true);
export const SafeZoneSidebar = guarded(ZoneSidebar, true);
export const SafeTutorialDialog = guarded(TutorialDialog, true);
export const SafeBusyIndicator = guarded(BusyIndicator, true);
