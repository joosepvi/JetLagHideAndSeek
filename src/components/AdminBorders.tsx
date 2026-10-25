import { useStore } from "@nanostores/react";
import * as L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

import { showAdminBorders } from "@/lib/context";
import { adminBorderLines } from "@/maps/api";

import { satelliteMap } from "./SatelliteToggle";

// Always-visible linnaosa and asum borders with their names. Violet, the one colour
// not already meaning something on the map. Panes: above the shading of eliminated
// areas (400), below the green hiding zones (450) and stops (590).
const BORDERS_PANE = "adminBorders";
const LABELS_PANE = "adminLabels";

// Zoom levels: asum lines from 13, asum names from 14 (linnaosa names until 13,
// satellite view only)
const ASUM_LINES_FROM = 13;
const ASUM_NAMES_FROM = 14;

// Quiet on purpose: orientation only, the game layers stay in front
const styles = (satellite: boolean) =>
    satellite
        ? {
              halo: { color: "#1e1b4b", weight: 3, opacity: 0.3 },
              district: { color: "#ede9fe", weight: 1.4, opacity: 0.6 },
              // Same colour and width as the linnaosa line, only dashed
              asum: {
                  color: "#ede9fe",
                  weight: 1.4,
                  opacity: 0.6,
                  dashArray: "5 4",
              },
          }
        : {
              halo: { color: "#ffffff", weight: 3.5, opacity: 0.4 },
              district: { color: "#7c3aed", weight: 1.5, opacity: 0.55 },
              // Same colour and width as the linnaosa line, only dashed
              asum: {
                  color: "#7c3aed",
                  weight: 1.5,
                  opacity: 0.55,
                  dashArray: "5 4",
              },
          };

// The base map writes the linnaosa names itself (except satellite imagery), so ours
// would only repeat them. The same goes for asums named like their linnaosa.
const stem = (name: string) => name.toLowerCase().replace(/a$/, "");

const escapeHtml = (text: string) =>
    text.replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c]!,
    );

const ensurePane = (map: L.Map, name: string, zIndex: number) => {
    if (!map.getPane(name)) {
        const pane = map.createPane(name);
        pane.style.zIndex = String(zIndex);
        pane.style.pointerEvents = "none";
    }
};

export const AdminBorders = () => {
    const map = useMap();
    const $show = useStore(showAdminBorders);
    const $satellite = useStore(satelliteMap);

    useEffect(() => {
        if (!$show) return;
        ensurePane(map, BORDERS_PANE, 420);
        ensurePane(map, LABELS_PANE, 430);

        const data = adminBorderLines();
        const style = styles($satellite);
        const renderer = L.canvas({ pane: BORDERS_PANE, padding: 0.3 });
        const asLatLng = (lines: [number, number][][]) =>
            lines.map((line) => line.map(([lng, lat]) => [lat, lng]));
        const line = (
            lines: [number, number][][],
            options: L.PolylineOptions,
        ) =>
            L.polyline(asLatLng(lines) as L.LatLngExpression[][], {
                renderer,
                interactive: false,
                lineCap: "round",
                lineJoin: "round",
                ...options,
            });
        const names = (
            labels: { name: string; lat: number; lng: number }[],
            kind: "district" | "asum",
        ) =>
            L.layerGroup(
                labels.map((label) =>
                    L.marker([label.lat, label.lng], {
                        pane: LABELS_PANE,
                        interactive: false,
                        keyboard: false,
                        icon: L.divIcon({
                            // Full class names, so the CSS build keeps their styles
                            className:
                                kind === "district"
                                    ? "admin-label admin-label-district"
                                    : "admin-label admin-label-asum",
                            html: `<span>${escapeHtml(label.name)}</span>`,
                            iconSize: [0, 0],
                        }),
                    }),
                ),
            );

        const districts = L.layerGroup([
            line(data.districtLines, style.halo),
            line(data.districtLines, style.district),
        ]).addTo(map);
        const asums = line(data.asumLines, style.asum);
        const districtStems = new Set(
            data.districtLabels.map((label) => stem(label.name)),
        );
        const districtNames = names(
            $satellite ? data.districtLabels : [],
            "district",
        );
        const asumNames = names(
            $satellite
                ? data.asumLabels
                : data.asumLabels.filter(
                      (label) => !districtStems.has(stem(label.name)),
                  ),
            "asum",
        );

        const showFor = (layer: L.Layer, visible: boolean) => {
            if (visible && !map.hasLayer(layer)) layer.addTo(map);
            if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
        };
        const update = () => {
            const zoom = map.getZoom();
            showFor(asums, zoom >= ASUM_LINES_FROM);
            showFor(districtNames, zoom < ASUM_NAMES_FROM);
            showFor(asumNames, zoom >= ASUM_NAMES_FROM);
        };
        update();
        map.on("zoomend", update);

        return () => {
            map.off("zoomend", update);
            [districts, asums, districtNames, asumNames].forEach((layer) =>
                map.removeLayer(layer),
            );
            renderer.remove();
        };
    }, [map, $show, $satellite]);

    return null;
};
