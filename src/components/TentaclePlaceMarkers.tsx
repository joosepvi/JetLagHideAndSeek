import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import * as L from "leaflet";
import { Fragment } from "react/jsx-runtime";
import { Marker, Tooltip } from "react-leaflet";

import { questions, triggerLocalRefresh } from "@/lib/context";
import { getTallinnPlaces, TALLINN_AIRPORTS } from "@/maps/api";
import { FLAGS } from "@/maps/api/flags";
import tallinnBoundary from "@/maps/api/tallinn.json";
import tallinnPlaces from "@/maps/api/tallinn-places.json";

type Place = { name: string; lat: number; lng: number; country?: string };

const tallinnShape = tallinnBoundary.features[0] as any;
const inTallinnCache = new Map<string, boolean>();
const isInTallinn = (p: Place) => {
    const key = `${p.lng},${p.lat}`;
    if (!inTallinnCache.has(key)) {
        inTallinnCache.set(
            key,
            turf.booleanPointInPolygon(
                turf.point([p.lng, p.lat]),
                tallinnShape,
            ),
        );
    }
    return inTallinnCache.get(key)!;
};

export const TENTACLE_EMOJI: Record<string, string> = {
    theme_park: "🎢",
    zoo: "🦁",
    aquarium: "🐠",
    museum: "🏛️",
    hospital: "🏥",
    cinema: "🎬",
    library: "📚",
    consulate: "🚩",
    park: "🌳",
    golf_course: "⛳",
    airport: "✈️",
    custom: "📍",
};

// Icons are drawn once into images (glow included). Live CSS filters/shadows on
// hundreds of markers made panning and zooming very slow on phones.
const iconCache: Record<string, L.Icon> = {};
const emojiIcon = (emoji: string, selected: boolean, inRange: boolean) => {
    const key = `${emoji}-${selected}-${inRange}`;
    if (!iconCache[key]) {
        const box = 28;
        const fontSize = selected ? 26 : inRange ? 20 : 16;
        const scale = 3; // sharp on high-density screens
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = box * scale;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(scale, scale);
        ctx.globalAlpha = inRange ? 1 : 0.45;
        ctx.font = `${fontSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const glows: [string, number][] = selected
            ? [
                  ["#facc15", 4],
                  ["#ffffff", 2],
              ]
            : [["#ffffff", 2]];
        for (const [color, blur] of glows) {
            ctx.shadowColor = color;
            ctx.shadowBlur = blur * scale;
            ctx.fillText(emoji, box / 2, box / 2 + 1);
        }
        iconCache[key] = L.icon({
            iconUrl: canvas.toDataURL(),
            iconSize: [box, box],
            iconAnchor: [box / 2, box / 2],
        });
    }
    return iconCache[key];
};

// Shows every place of each tentacles question's category as emoji markers
export const TentaclePlaceMarkers = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);

    return (
        <Fragment>
            {$questions.map((question) => {
                if (question.id !== "tentacles" || question.data.hidden)
                    return null;
                const data = question.data;
                const center = turf.point([data.lng, data.lat]);
                const places: Place[] =
                    data.locationType === "custom"
                        ? (data.places ?? []).map((p: any) => ({
                              name: p.properties?.name,
                              lng: p.geometry.coordinates[0],
                              lat: p.geometry.coordinates[1],
                          }))
                        : ((tallinnPlaces as Record<string, Place[]>)[
                              data.locationType
                          ] ?? []);
                const emoji = TENTACLE_EMOJI[data.locationType] ?? "📍";
                const selectedName = data.location
                    ? data.location.properties?.name
                    : null;

                // All Tallinn places are shown; those outside the radius are faded
                return places.map((p) => {
                    const inRange =
                        turf.distance(center, turf.point([p.lng, p.lat]), {
                            units: data.unit,
                        }) <= data.radius;
                    if (!inRange && !isInTallinn(p)) return null;
                    return (
                        <Marker
                            key={`${question.key}-${p.name}`}
                            position={[p.lat, p.lng]}
                            icon={emojiIcon(
                                emoji,
                                p.name === selectedName,
                                inRange,
                            )}
                            zIndexOffset={inRange ? 100 : 0}
                            interactive={true}
                        >
                            <Tooltip direction="top" offset={[0, -12]}>
                                {p.name}
                            </Tooltip>
                        </Marker>
                    );
                });
            })}
        </Fragment>
    );
};

// Country flag for embassies and consulates (white frame + shadow so it shows on any map).
// The frame and shadow are part of one SVG image, so the browser rasterises it once.
const flagCache: Record<string, L.Icon> = {};
const flagIcon = (country: string) => {
    if (!flagCache[country]) {
        const flag = FLAGS[country].replace(
            "<svg",
            '<svg x="3" y="3" width="27" height="18" preserveAspectRatio="none"',
        );
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="33" height="26" viewBox="0 0 33 26"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity=".5"/></filter></defs><rect x="1" y="1" width="31" height="22" rx="3" fill="#fff" stroke="rgba(0,0,0,.45)" stroke-width="1" filter="url(#s)"/>${flag}</svg>`;
        flagCache[country] = L.icon({
            iconUrl:
                "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
            iconSize: [33, 26],
            iconAnchor: [16, 12],
        });
    }
    return flagCache[country];
};

// Shows the places a matching question compares (airports, museums, parks, ...)
export const MatchingPlaceMarkers = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);

    return (
        <Fragment>
            {$questions.map((question) => {
                if (question.id !== "matching" || question.data.hidden)
                    return null;
                const type = question.data.type;
                const category = type.replace(/-full$/, "");
                let places: Place[];
                if (type === "airport") {
                    places = TALLINN_AIRPORTS;
                } else if (type.endsWith("-full")) {
                    // "In zone" variants only count places inside Tallinn
                    places = getTallinnPlaces(category).filter(isInTallinn);
                } else if (TENTACLE_EMOJI[category]) {
                    places = getTallinnPlaces(category);
                } else {
                    return null;
                }
                const emoji = TENTACLE_EMOJI[category] ?? "📍";

                return places.map((p) => (
                    <Marker
                        key={`m${question.key}-${p.name}`}
                        position={[p.lat, p.lng]}
                        icon={
                            p.country && FLAGS[p.country]
                                ? flagIcon(p.country)
                                : emojiIcon(emoji, false, true)
                        }
                        interactive={true}
                    >
                        <Tooltip direction="top" offset={[0, -12]}>
                            {p.name}
                        </Tooltip>
                    </Marker>
                ));
            })}
        </Fragment>
    );
};
