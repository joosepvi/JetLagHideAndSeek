import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import * as L from "leaflet";
import { Fragment } from "react/jsx-runtime";
import { Marker, Tooltip } from "react-leaflet";

import { questions, triggerLocalRefresh } from "@/lib/context";
import { getTallinnPlaces, TALLINN_AIRPORTS } from "@/maps/api";
import tallinnBoundary from "@/maps/api/tallinn.json";
import tallinnPlaces from "@/maps/api/tallinn-places.json";

type Place = { name: string; lat: number; lng: number };

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
    consulate: "🏳️",
    park: "🌳",
    golf_course: "⛳",
    airport: "✈️",
    custom: "📍",
};

const iconCache: Record<string, L.DivIcon> = {};
const emojiIcon = (emoji: string, selected: boolean, inRange: boolean) => {
    const key = `${emoji}-${selected}-${inRange}`;
    iconCache[key] ??= L.divIcon({
        html: `<div style="font-size:${selected ? 26 : inRange ? 20 : 16}px;line-height:1;opacity:${inRange ? 1 : 0.45};filter:drop-shadow(0 0 2px #fff)${selected ? " drop-shadow(0 0 4px #facc15)" : ""}">${emoji}</div>`,
        className: "",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
    });
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
                        icon={emojiIcon(emoji, false, true)}
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
