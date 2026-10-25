import { useStore } from "@nanostores/react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
    AlertDialog,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarMenu } from "@/components/ui/sidebar-l";
import { showTutorial, tutorialStep } from "@/lib/context";
import { cn } from "@/lib/utils";

import {
    MatchingQuestionComponent,
    MeasuringQuestionComponent,
    RadiusQuestionComponent,
    TentacleQuestionComponent,
    ThermometerQuestionComponent,
} from "./QuestionCards";

interface TutorialStep {
    title: string;
    content: ReactNode;
    targetSelector?: string; // CSS selector for the element to highlight
    position?: "top" | "bottom" | "center"; // Where to position the dialog relative to target
    isDescription?: boolean;
}

// Sample cards in the tutorial stand in Vanalinn
const SAMPLE = { lat: 59.437, lng: 24.745 };

const tutorialSteps: TutorialStep[] = [
    {
        title: "Welcome to Tallinna peitus!",
        content: (
            <>
                This is a map for playing Jet Lag: The Game&apos;s Hide and Seek
                in Tallinn. It draws where the hider can still be after each
                question, using built-in Tallinn data, so it works the same for
                every player.
                <br />
                <br />
                The game is played as a small game: distances are in kilometres
                and every hiding zone is 500 m around a transit stop.
                <br />
                <br />
                If you already know the basics,{" "}
                <strong>skip this tutorial by scrolling down</strong>. It is
                always available again from the Tutorial button.
            </>
        ),
        position: "center",
    },
    {
        title: "Overview: How a Game Goes",
        content: (
            <>
                <strong>1. Questions:</strong> add a question for every card you
                ask (Radius, Thermometer, Tentacles, Matching, Measuring) and
                set the answer.
                <br />
                <br />
                <strong>2. The map:</strong> areas the hider can no longer be in
                are shaded. Hiding zones (green circles) and stop points (yellow
                dots) show what is still possible; ruled-out stops become red
                crossed-out dots.
                <br />
                <br />
                <strong>3. Sharing:</strong> the Share button copies a link with
                all questions and answers for the other players.
                <br />
                <br />
                <strong>4. Hider Mode:</strong> the hider can let the app answer
                every question from their own location.
            </>
        ),
        position: "center",
    },
    {
        title: "Opening the Question Sidebar",
        content: (
            <>
                Questions are added from the sidebar (this button) or straight
                on the map: right-click on a computer or long-press on a phone,
                and the question starts at that point. From the sidebar, a new
                question starts at your GPS position when Follow Me is on,
                otherwise in the middle of the area that is still possible.
            </>
        ),
        targetSelector: '[data-tutorial-id="left-sidebar-trigger"]',
        position: "bottom",
    },
    {
        title: "Question Creation Interface",
        content: (
            <>
                Each button adds one question type:
                <br />
                <br />
                <strong>Radius:</strong> &ldquo;Are you within X of me?&rdquo;
                <br />
                <strong>Thermometer:</strong> &ldquo;Am I hotter or colder after
                moving from A to B?&rdquo;
                <br />
                <strong>Tentacles:</strong> &ldquo;Of the places within X of me,
                which are you closest to?&rdquo;
                <br />
                <strong>Matching:</strong> &ldquo;Is your nearest X the same as
                mine?&rdquo;
                <br />
                <strong>Measuring:</strong> &ldquo;Are you closer to or further
                from X than me?&rdquo;
                <br />
                <br />
                <strong>Paste Question</strong> adds a question copied from
                another player.
            </>
        ),
        targetSelector: '[data-tutorial-id="add-questions-buttons"]',
        position: "top",
    },
    {
        title: "Radius Questions",
        content: (
            <>
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <RadiusQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                ...SAMPLE,
                                collapsed: false,
                                drag: true,
                                hidden: false,
                                radius: 1,
                                unit: "kilometers",
                                color: "blue",
                                within: true,
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                Set the distance, drag the pin to where the seekers are (or type
                the coordinates, or use your location) and choose Inside or
                Outside. The lock stops accidental changes; the eye hides a
                question from the map without deleting it.
            </>
        ),
        position: "center",
    },
    {
        title: "Thermometer Questions",
        content: (
            <>
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <ThermometerQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                collapsed: false,
                                drag: true,
                                hidden: false,
                                latA: SAMPLE.lat,
                                lngA: SAMPLE.lng,
                                latB: SAMPLE.lat,
                                lngB: 24.7539,
                                colorA: "red",
                                colorB: "blue",
                                warmer: true,
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                Pin A is where the seekers started, pin B where they ended (a
                new question puts B 500 m east of A). Warmer means the hider is
                closer to B, colder closer to A.
            </>
        ),
        position: "center",
    },
    {
        title: "Tentacles Questions",
        content: (
            <>
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <TentacleQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                ...SAMPLE,
                                collapsed: false,
                                drag: true,
                                hidden: false,
                                radius: 1.6,
                                unit: "kilometers",
                                color: "red",
                                locationType: "museum",
                                location: false,
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                <strong>1.6 km:</strong> museums, hospitals, cinemas, libraries.
                <br />
                <strong>24 km:</strong> zoos, theme parks.
                <br />
                <strong>Custom:</strong> your own points.
                <br />
                <br />
                All places of the category are shown on the map with an icon;
                those outside the radius are faded. Pick the place the hider
                named.
            </>
        ),
        position: "center",
    },
    {
        title: "Matching Questions",
        content: (
            <>
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <MatchingQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                ...SAMPLE,
                                collapsed: false,
                                drag: true,
                                hidden: false,
                                color: "blue",
                                same: true,
                                type: "airport",
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                <strong>Places:</strong> nearest airport or airfield, museum,
                hospital, cinema, library, embassy, park, zoo, theme park. The
                places are shown on the map.
                <br />
                <strong>Zones:</strong> same linnaosa or asum, or one starting
                with the same letter.
                <br />
                <strong>Stops:</strong> nearest stop name with the same first
                letter or length, and <strong>Same Line</strong>: pick a line
                (bus, tram, train, ferry). Same keeps only its stops, Different
                rules them out.
                <br />
                <strong>Custom:</strong> your own zones or points.
            </>
        ),
        position: "center",
    },
    {
        title: "Measuring Questions",
        content: (
            <>
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <MeasuringQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                ...SAMPLE,
                                collapsed: false,
                                drag: true,
                                hidden: false,
                                color: "green",
                                hiderCloser: true,
                                type: "coastline",
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                Is the hider closer to or further from something than the
                seekers?
                <br />• <strong>Coastline:</strong> the sea shore
                <br />• <strong>Body of Water:</strong> the sea or one of 23
                lakes and ponds
                <br />• <strong>Border:</strong> Estonia&apos;s border, Harju
                county, Tallinn, or (house rule) linnaosa and asum borders
                <br />• <strong>Airport</strong>, <strong>train stop</strong>{" "}
                (Elron), <strong>McDonald&apos;s</strong>
                <br />• Museums, hospitals, cinemas, libraries, golf courses,
                embassies, parks, zoos, theme parks
                <br />
                <br />
                The places measured to are shown on the map.
            </>
        ),
        position: "center",
    },
    {
        title: "Hiding Zones and Stops",
        content: (
            <>
                The right-hand panel controls the hiding zones: which stop types
                count (train, tram, bus, ferry), the radius (500 m), and how
                zones are drawn.
                <br />
                <br />
                <strong>Yellow dots:</strong> stops the hider can still be at.
                <br />
                <strong>Red crossed-out dots:</strong> stops ruled out by the
                answers so far.
                <br />
                <br />
                Click a yellow dot to mark it as the hiding zone and see what is
                left of it; click it again to remove the mark.
                &ldquo;View&rdquo; in the list moves the map to that stop.
            </>
        ),
        position: "center",
    },
    {
        title: "Sharing",
        content: (
            <>
                <strong>Share</strong> copies a link with the questions, answers
                and hiding zone settings. Everyone opening it sees the same map.
                The hider&apos;s location from Hider Mode is never shared.
            </>
        ),
        targetSelector: '[data-tutorial-id="share-questions-button"]',
        position: "top",
    },
    {
        title: "Hider Mode",
        content: (
            <>
                In Options, the hider can turn on Hider Mode and give their
                location. Every question is then answered automatically, and the
                hider can share the answered link back to the seekers.
            </>
        ),
        position: "center",
    },
    {
        title: "Options",
        content: (
            <>
                <strong>Base map:</strong> map style; the map button in the
                top-right corner switches to satellite view.
                <br />
                <strong>Follow Me:</strong> shows your GPS position, and new
                questions start there.
                <br />
                <strong>Planning mode:</strong> preview what a question would
                rule out before you know the answer.
                <br />
                <strong>Auto save:</strong> keeps every change in this browser.
            </>
        ),
        targetSelector: '[data-tutorial-id="option-questions-button"]',
        position: "top",
    },
    {
        title: "Where the Data Comes From",
        content: (
            <>
                Everything is built into the app, so nothing is looked up during
                the game except the transit lines.
                <br />
                <br />• <strong>Places, coastline, lakes:</strong> ETAK (Maa- ja
                Ruumiamet), checked by hand
                <br />• <strong>Districts:</strong> EHAK linnaosad and
                OpenStreetMap asumid, fitted to the city border
                <br />• <strong>Stops and lines:</strong> transport.tallinn.ee
                and Elron; current lines are loaded from peatus.ee when online,
                otherwise the built-in copy is used
                <br />• <strong>Airports and airfields:</strong> eAIP Estonia
                <br />• <strong>Borders:</strong> Estonia and Harju county from
                OpenStreetMap
            </>
        ),
        position: "center",
    },
    {
        title: "Ready to Play",
        content: (
            <>
                Add a question for every card, set the answers, and share the
                link. The shaded area shows where the hider can no longer be.
                <br />
                <br />
                This app is a Tallinn version of{" "}
                <a
                    href="https://github.com/taibeled/JetLagHideAndSeek"
                    className="text-blue-500 cursor-pointer"
                    target="_blank"
                    rel="noreferrer"
                >
                    an open-source map generator by taibeled
                </a>
                . It isn&apos;t affiliated with Jet Lag: The Game.
                <br />
                <br />
                Happy hiding and seeking!
            </>
        ),
        position: "center",
    },
];

const TutorialOverlay = ({
    targetSelector,
    isVisible,
}: {
    targetSelector?: string;
    isVisible: boolean;
}) => {
    const [highlightedElement, setHighlightedElement] =
        useState<Element | null>(null);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (!isVisible || !targetSelector) {
                setHighlightedElement(null);
                return;
            }

            setHighlightedElement(
                document.querySelector(targetSelector) || null,
            );
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [targetSelector, isVisible]);

    if (!isVisible) {
        return null;
    }

    const rect = highlightedElement?.getBoundingClientRect();
    const padding = 12;

    return (
        <div className="fixed inset-0 z-[9999] pointer-events-none">
            {highlightedElement && rect ? (
                <div>
                    <div
                        className="absolute transition-all duration-500 ease-out tutorial-highlight-pulse"
                        style={{
                            left: rect.left - padding,
                            top: rect.top - padding,
                            width: rect.width + padding * 2,
                            height: rect.height + padding * 2,
                            boxShadow: `
                                    0 0 0 4px rgba(59, 130, 246, 0.8),
                                    0 0 0 8px rgba(59, 130, 246, 0.4),
                                    0 0 0 9999px rgba(0, 0, 0, 0.6),
                                    0 0 30px rgba(59, 130, 246, 0.6)
                                `,
                            borderRadius: "12px",
                            border: "3px solid rgb(59, 130, 246)",
                            background: "transparent",
                            zIndex: 10000,
                        }}
                    >
                        <div
                            className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-400/20 to-purple-400/20"
                            style={{
                                animation: "breathe 3s infinite ease-in-out",
                            }}
                        />
                    </div>
                </div>
            ) : (
                <div className="absolute inset-0 bg-black/60 transition-opacity duration-300" />
            )}
        </div>
    );
};

export const TutorialDialog = () => {
    const $showTutorial = useStore(showTutorial);
    const dialogRef = useRef<HTMLDivElement>(null);
    const $tutorialStep = useStore(tutorialStep);

    const handleNext = () => {
        if ($tutorialStep < tutorialSteps.length - 1) {
            tutorialStep.set($tutorialStep + 1);
        }
    };

    const handlePrevious = () => {
        if ($tutorialStep > 0) {
            tutorialStep.set($tutorialStep - 1);
        }
    };
    const handleClose = () => {
        showTutorial.set(false);
    };

    const currentTutorialStep = tutorialSteps[$tutorialStep];

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (!$showTutorial || !dialogRef.current) return;

            const dialogElement = dialogRef.current;
            const isMobile = window.innerWidth < 768; // Tailwind md breakpoint
            const maxWidth = isMobile ? window.innerWidth - 40 : 680;

            dialogElement.style.maxWidth = `${maxWidth}px`;
            dialogElement.style.width = "auto";
            dialogElement.style.height = "auto";

            if (!currentTutorialStep.targetSelector) {
                dialogElement.style.position = "fixed";
                dialogElement.style.left = "50%";
                dialogElement.style.top = "50%";
                dialogElement.style.transform = "translate(-50%, -50%)";
                dialogElement.style.right = "auto";
                dialogElement.style.bottom = "auto";
                return;
            }

            const targetElement = document.querySelector(
                currentTutorialStep.targetSelector,
            ) as HTMLElement;

            if (!targetElement) {
                // If target element not found, center the dialog
                dialogElement.style.position = "fixed";
                dialogElement.style.left = "50%";
                dialogElement.style.top = "50%";
                dialogElement.style.transform = "translate(-50%, -50%)";
                dialogElement.style.right = "auto";
                dialogElement.style.bottom = "auto";
                return;
            }

            const rect = targetElement.getBoundingClientRect();
            const position = currentTutorialStep.position || "center";
            const padding = 20;

            // Ensure positioning is set but don't reset transform immediately
            dialogElement.style.position = "fixed";

            const dialogRect = dialogElement.getBoundingClientRect();
            const dialogWidth = Math.min(
                dialogRect.width || 680,
                isMobile ? window.innerWidth - padding * 2 : 680,
            );
            const dialogHeight = dialogRect.height || 400;

            let finalX = 0;
            let finalY = 0;

            // On mobile, use simpler positioning logic
            if (isMobile) {
                // On mobile, always center horizontally and position vertically based on target
                finalX = (window.innerWidth - dialogWidth) / 2;

                switch (position) {
                    case "top": {
                        finalY = Math.max(
                            padding,
                            rect.top - dialogHeight - padding,
                        );
                        // If no space above, move to below
                        if (finalY < padding) {
                            finalY = Math.min(
                                rect.bottom + padding,
                                window.innerHeight - dialogHeight - padding,
                            );
                        }
                        break;
                    }
                    case "bottom": {
                        finalY = Math.min(
                            rect.bottom + padding,
                            window.innerHeight - dialogHeight - padding,
                        );
                        // If no space below, move to above
                        if (
                            finalY + dialogHeight >
                            window.innerHeight - padding
                        ) {
                            finalY = Math.max(
                                padding,
                                rect.top - dialogHeight - padding,
                            );
                        }
                        break;
                    }
                    default:
                        // Center
                        finalY = (window.innerHeight - dialogHeight) / 2;
                        break;
                }

                // Ensure dialog stays within viewport bounds
                finalY = Math.max(
                    padding,
                    Math.min(
                        finalY,
                        window.innerHeight - dialogHeight - padding,
                    ),
                );
            } else {
                // Desktop positioning logic (unchanged)
                switch (position) {
                    case "top": {
                        finalX = Math.max(
                            padding,
                            Math.min(
                                window.innerWidth - dialogWidth - padding,
                                rect.left + rect.width / 2 - dialogWidth / 2,
                            ),
                        );
                        finalY = Math.max(
                            padding,
                            rect.top - dialogHeight - padding,
                        );
                        // If no space above, flip to below
                        if (finalY < padding) {
                            finalY = rect.bottom + padding;
                        }
                        break;
                    }
                    case "bottom": {
                        finalX = Math.max(
                            padding,
                            Math.min(
                                window.innerWidth - dialogWidth - padding,
                                rect.left + rect.width / 2 - dialogWidth / 2,
                            ),
                        );
                        finalY = rect.bottom + padding;
                        // If no space below, flip to above
                        if (
                            finalY + dialogHeight >
                            window.innerHeight - padding
                        ) {
                            finalY = Math.max(
                                padding,
                                rect.top - dialogHeight - padding,
                            );
                        }
                        break;
                    }
                    default:
                        // Center
                        dialogElement.style.left = "50%";
                        dialogElement.style.top = "50%";
                        dialogElement.style.transform = "translate(-50%, -50%)";
                        dialogElement.style.right = "auto";
                        dialogElement.style.bottom = "auto";
                        return;
                }
            }

            // Apply positioning smoothly
            dialogElement.style.transform = "none";
            dialogElement.style.left = `${finalX}px`;
            dialogElement.style.top = `${finalY}px`;
            dialogElement.style.right = "auto";
            dialogElement.style.bottom = "auto";
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [$tutorialStep, $showTutorial]);

    useEffect(() => {
        if (!$showTutorial) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            switch (event.key) {
                case "ArrowRight":
                case "ArrowDown":
                    event.preventDefault();
                    handleNext();
                    break;
                case "ArrowLeft":
                case "ArrowUp":
                    event.preventDefault();
                    handlePrevious();
                    break;
                case "Escape":
                    event.preventDefault();
                    handleClose();
                    break;
                case "Enter":
                case " ":
                    event.preventDefault();
                    if ($tutorialStep === tutorialSteps.length - 1) {
                        handleClose();
                    } else {
                        handleNext();
                    }
                    break;
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [$showTutorial, $tutorialStep]);

    return (
        <>
            <TutorialOverlay
                targetSelector={currentTutorialStep.targetSelector}
                isVisible={$showTutorial}
            />
            <AlertDialog open={$showTutorial} onOpenChange={showTutorial.set}>
                <AlertDialogPrimitive.AlertDialogContent
                    ref={dialogRef}
                    className={cn(
                        "fixed z-[10000] grid w-full gap-4 border bg-background p-4 md:p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
                        "!max-h-[50vh] overflow-y-auto tutorial-dialog",
                        // Only apply default center positioning for non-targeted steps
                        !currentTutorialStep.targetSelector &&
                            "left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] !max-h-[90vh]",
                    )}
                    style={{
                        maxWidth: "min(680px, calc(100vw - 40px))",
                        width: "auto",
                        transition:
                            "left 0.3s ease-out, top 0.3s ease-out, transform 0.3s ease-out",
                    }}
                    data-tutorial-active={$showTutorial}
                >
                    <AlertDialogHeader className="space-y-4">
                        <div className="flex items-center justify-between">
                            <AlertDialogTitle className="text-2xl font-bold text-left">
                                {currentTutorialStep.title}
                            </AlertDialogTitle>
                        </div>

                        <div className="flex space-x-2">
                            {tutorialSteps.map((_, index) => (
                                <div
                                    key={index}
                                    className={`h-2 rounded-full flex-1 ${
                                        index <= $tutorialStep
                                            ? "bg-blue-500"
                                            : "bg-gray-300"
                                    }`}
                                />
                            ))}
                        </div>
                    </AlertDialogHeader>

                    {(currentTutorialStep.isDescription ?? true) ? (
                        <AlertDialogDescription className="text-base leading-relaxed whitespace-pre-line">
                            {currentTutorialStep.content}
                        </AlertDialogDescription>
                    ) : (
                        <div className="text-base leading-relaxed whitespace-pre-line text-muted-foreground">
                            {currentTutorialStep.content}
                        </div>
                    )}

                    <div className="flex flex-col gap-y-2 justify-between items-center pt-4">
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                onClick={handleClose}
                                className="text-sm"
                            >
                                Skip Tutorial
                            </Button>
                            <div className="hidden md:block text-xs text-muted-foreground">
                                Use arrow keys to navigate
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {$tutorialStep + 1} of {tutorialSteps.length}
                            </div>
                        </div>

                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                onClick={handlePrevious}
                                disabled={$tutorialStep === 0}
                                className="flex items-center space-x-1"
                            >
                                <ChevronLeft className="h-4 w-4" />
                                <span>Previous</span>
                            </Button>
                            {$tutorialStep === tutorialSteps.length - 1 ? (
                                <Button
                                    onClick={handleClose}
                                    variant="secondary"
                                >
                                    <span>Get Started!</span>
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleNext}
                                    className="flex items-center space-x-1"
                                >
                                    <span>Next</span>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                </AlertDialogPrimitive.AlertDialogContent>
            </AlertDialog>
        </>
    );
};
