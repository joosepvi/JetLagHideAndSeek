import { useEffect, useState } from "react";
import { AiOutlineFullscreen, AiOutlineFullscreenExit } from "react-icons/ai";

// The whole app goes fullscreen, so sidebars, dialogs and buttons keep working.
// Safari uses the webkit-prefixed API; iPhone Safari has none, so the button is hidden there.
const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitFullscreenEnabled?: boolean;
    webkitExitFullscreen?: () => Promise<void>;
};
const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
};

const fullscreenElement = () =>
    doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
const canFullscreen = () =>
    !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

export const LeafletFullScreenButton = () => {
    const [isFullScreen, setIsFullScreen] =
        useState<boolean>(!!fullscreenElement());

    useEffect(() => {
        const update = () => setIsFullScreen(!!fullscreenElement());
        document.addEventListener("fullscreenchange", update);
        document.addEventListener("webkitfullscreenchange", update);
        return () => {
            document.removeEventListener("fullscreenchange", update);
            document.removeEventListener("webkitfullscreenchange", update);
        };
    }, []);

    if (!canFullscreen()) return null;

    return (
        <a
            className="leaflet-full-screen-specific-name bg-white hover:bg-[#f4f4f4] w-11 h-11 rounded-sm leading-[44px] text-[22px] flex items-center justify-center border-2 border-black border-opacity-30 cursor-pointer"
            title={isFullScreen ? "Exit full screen" : "Full screen"}
            onClick={() => {
                if (!fullscreenElement()) {
                    (
                        root.requestFullscreen ?? root.webkitRequestFullscreen
                    )?.call(root);
                } else {
                    (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
                }
            }}
        >
            {isFullScreen ? (
                <AiOutlineFullscreenExit className="w-7 h-7 text-black" />
            ) : (
                <AiOutlineFullscreen className="w-7 h-7 text-black" />
            )}
        </a>
    );
};
