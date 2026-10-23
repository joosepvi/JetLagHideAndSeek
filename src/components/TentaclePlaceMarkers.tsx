import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import * as L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

import { questions, triggerLocalRefresh } from "@/lib/context";
import { getTallinnPlaces, TALLINN_AIRPORTS } from "@/maps/api";
import { FLAGS } from "@/maps/api/flags";
import tallinnBoundary from "@/maps/api/tallinn.json";
import tallinnPlaces from "@/maps/api/tallinn-places.json";

import {
    getPointsRenderer,
    ImageMarker,
    registerPlaceIcons,
} from "./mapPoints";

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

type Picture = { image: CanvasImageSource; width: number; height: number };

// Emoji with a white glow (yellow too when selected), drawn once into a canvas
const emojiCache: Record<string, Picture> = {};
const emojiPicture = (emoji: string, selected: boolean, inRange: boolean) => {
    const key = `${emoji}-${selected}-${inRange}`;
    if (!emojiCache[key]) {
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
        emojiCache[key] = { image: canvas, width: box, height: box };
    }
    return emojiCache[key];
};

// Country flag with white frame + shadow, one SVG image per country.
// It loads asynchronously; markers waiting for it are redrawn when it is ready.
const flagCache: Record<
    string,
    { picture: Picture; ready: boolean; waiting: Set<L.CircleMarker> }
> = {};
const flagPicture = (country: string, marker: L.CircleMarker) => {
    let entry = flagCache[country];
    if (!entry) {
        const flag = FLAGS[country].replace(
            "<svg",
            '<svg x="3" y="3" width="27" height="18" preserveAspectRatio="none"',
        );
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="99" height="78" viewBox="0 0 33 26"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity=".5"/></filter></defs><rect x="1" y="1" width="31" height="22" rx="3" fill="#fff" stroke="rgba(0,0,0,.45)" stroke-width="1" filter="url(#s)"/>${flag}</svg>`;
        const image = new Image();
        entry = flagCache[country] = {
            picture: { image, width: 33, height: 26 },
            ready: false,
            waiting: new Set(),
        };
        const current = entry;
        image.onload = () => {
            current.ready = true;
            current.waiting.forEach((m) => m.redraw());
            current.waiting.clear();
        };
        image.src =
            "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }
    if (!entry.ready) entry.waiting.add(marker);
    return entry.picture;
};

type PointIcon = {
    key: string;
    place: Place;
    emoji: string;
    selected?: boolean;
    inRange?: boolean;
    flag?: string;
};

// Draws place icons on the shared points canvas, with a name tooltip on hover/tap
const usePlaceIcons = (icons: PointIcon[], layerKey: string) => {
    const map = useMap();

    useEffect(() => {
        const renderer = getPointsRenderer(map);
        const group = L.layerGroup();
        // In-range and selected icons are drawn last, so they end up on top
        const rank = (i: PointIcon) =>
            Number(i.inRange ?? true) + Number(!!i.selected) * 2;
        const ordered = [...icons].sort((a, b) => rank(a) - rank(b));
        for (const icon of ordered) {
            const marker = new ImageMarker([icon.place.lat, icon.place.lng], {
                renderer,
                pane: "stopPoints",
                radius: 12,
                stroke: false,
                fill: false,
                image: null,
                width: 28,
                height: 28,
            });
            const picture =
                icon.flag && FLAGS[icon.flag]
                    ? flagPicture(icon.flag, marker)
                    : emojiPicture(
                          icon.emoji,
                          !!icon.selected,
                          icon.inRange ?? true,
                      );
            Object.assign(marker.options, picture);
            marker.bindTooltip(icon.place.name, {
                direction: "top",
                offset: [0, -12],
            });
            group.addLayer(marker);
        }
        group.addTo(map);
        const unregister = registerPlaceIcons(map, group);
        return () => {
            unregister();
            group.remove();
        };
    }, [map, layerKey]);
};

// Shows every place of each tentacles question's category
export const TentaclePlaceMarkers = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);

    const icons: PointIcon[] = [];
    for (const question of $questions) {
        if (question.id !== "tentacles" || question.data.hidden) continue;
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
        for (const p of places) {
            const inRange =
                turf.distance(center, turf.point([p.lng, p.lat]), {
                    units: data.unit,
                }) <= data.radius;
            if (!inRange && !isInTallinn(p)) continue;
            icons.push({
                key: `${question.key}-${p.name}`,
                place: p,
                emoji,
                inRange,
                selected: p.name === selectedName,
            });
        }
    }

    usePlaceIcons(
        icons,
        icons
            .map((i) => `${i.key}:${i.inRange ? 1 : 0}${i.selected ? 1 : 0}`)
            .join("|"),
    );
    return null;
};

// Shows the places a matching question compares (airports, museums, parks, ...)
export const MatchingPlaceMarkers = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);

    const icons: PointIcon[] = [];
    for (const question of $questions) {
        if (question.id !== "matching" || question.data.hidden) continue;
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
            continue;
        }
        const emoji = TENTACLE_EMOJI[category] ?? "📍";
        for (const p of places) {
            icons.push({
                key: `m${question.key}-${p.name}`,
                place: p,
                emoji,
                flag: p.country,
            });
        }
    }

    usePlaceIcons(icons, icons.map((i) => i.key).join("|"));
    return null;
};
