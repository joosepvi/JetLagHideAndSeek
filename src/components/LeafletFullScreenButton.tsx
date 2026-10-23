import { useState } from "react";
import { AiOutlineFullscreen, AiOutlineFullscreenExit } from "react-icons/ai";

export const LeafletFullScreenButton = () => {
    const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

    return (
        <a
            className="leaflet-full-screen-specific-name bg-white hover:bg-[#f4f4f4] w-11 h-11 rounded-sm leading-[44px] text-[22px] flex items-center justify-center border-2 border-black border-opacity-30 cursor-pointer"
            onClick={() => {
                // The whole app goes fullscreen, so sidebars, dialogs and buttons keep working
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                    setIsFullScreen(true);
                } else {
                    document.exitFullscreen();
                    setIsFullScreen(false);
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
