import { useStore } from "@nanostores/react";
import { persistentAtom } from "@nanostores/persistent";
import * as L from "leaflet";
import { useEffect, useRef } from "react";
import { MdOutlineMap } from "react-icons/md";
import { TileLayer, useMap } from "react-leaflet";

// One-click switch between the normal base map and Esri satellite imagery.
// The choice is remembered. Satellite tiles load only once it is switched on,
// because the layer is mounted only then. Remove this file and its two uses in
// Map.tsx to drop the feature.
export const satelliteMap = persistentAtom<boolean>("satelliteMap", false, {
    encode: JSON.stringify,
    decode: (value) => {
        try {
            return JSON.parse(value) === true;
        } catch {
            return false;
        }
    },
});

export const SatelliteTiles = () => (
    <TileLayer
        attribution="Tiles &copy; Esri; Powered by Esri and Turf.js"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={19}
        maxZoom={20}
        minZoom={2}
        noWrap
    />
);

export const SatelliteToggleButton = () => {
    const $satellite = useStore(satelliteMap);
    const ref = useRef<HTMLAnchorElement>(null);
    const map = useMap();

    useEffect(() => {
        if (ref.current) L.DomEvent.disableClickPropagation(ref.current);
    }, []);

    // Darker mask over eliminated areas, so it reads on top of imagery (globals.css)
    useEffect(() => {
        map.getContainer().classList.toggle("satellite-map", $satellite);
    }, [map, $satellite]);

    const label = $satellite ? "Map view" : "Satellite view";

    return (
        <a
            ref={ref}
            role="button"
            aria-label={label}
            title={label}
            className="bg-white hover:bg-[#f4f4f4] w-11 h-11 rounded-sm flex items-center justify-center border-2 border-black border-opacity-30 cursor-pointer"
            onClick={() => satelliteMap.set(!$satellite)}
        >
            <MdOutlineMap className="w-7 h-7 text-black" />
        </a>
    );
};
