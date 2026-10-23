// "Compared to me, are you closer to or further from a coastline?"
// Coastline = where land meets the sea (islands included). Lakes count only if listed
// in COASTLINE_LAKES. Data is built in: ETAK (Maa- ja Ruumiamet) sea shoreline for the
// play area plus a margin, simplified to about 10 m. See tallinn-coast.json.
import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiPolygon,
    Polygon,
} from "geojson";

import tallinnBoundary from "@/maps/api/tallinn.json";
import tallinnCoast from "@/maps/api/tallinn-coast.json";
import { arcBuffer } from "@/maps/geo-utils";

// Lakes whose shores also count as coastline, by ETAK name, e.g. "Ülemiste järv".
// Available: Ülemiste järv, Harku järv, Maardu järv, Raku järv, Tammemäe järv, Männiku järv
export const COASTLINE_LAKES: string[] = [];

// Boundary tolerance: when in doubt the area is kept
const TOLERANCE_M = 10;
// Speed: coastline simplified to ~20 m for the calculation, buffer arcs within 5 m
const SIMPLIFY_DEG = 0.00018;
const ARC_DEVIATION_M = 5;
// Play area box (Tallinn) the result is ever shown in
const PLAY_BBOX = turf.bbox(tallinnBoundary as any);

let cachedLines: FeatureCollection<LineString> | null = null;
export const coastlineLines = () => {
    if (!cachedLines) {
        const parts = [
            tallinnCoast.coastline,
            ...COASTLINE_LAKES.map(
                (name) =>
                    (tallinnCoast.lakes as Record<string, any>)[name] ?? null,
            ).filter(Boolean),
        ];
        const lines: Feature<LineString>[] = [];
        for (const part of parts) {
            for (const line of turf.flatten(part as any)
                .features as unknown as Feature<LineString>[]) {
                const simple = turf.simplify(line, {
                    tolerance: SIMPLIFY_DEG,
                    highQuality: true,
                }) as Feature<LineString>;
                // Tiny islands can collapse to one repeated point; those are dropped
                // (a zero-length line breaks the distance calculation)
                const coords = turf
                    .cleanCoords(simple)
                    .geometry.coordinates.filter(
                        (c: number[]) =>
                            Number.isFinite(c[0]) && Number.isFinite(c[1]),
                    );
                const distinct = new Set(
                    coords.map((c: number[]) => c.join(",")),
                );
                if (coords.length >= 2 && distinct.size >= 2)
                    lines.push(turf.lineString(coords, line.properties));
            }
        }
        cachedLines = turf.featureCollection(lines);
    }
    return cachedLines;
};

export const WATER = tallinnCoast.water as unknown as Feature<
    Polygon | MultiPolygon
>;

// Water near Tallinn only, simplified: removing it from results is much faster
let cachedNearWater: Feature<Polygon | MultiPolygon> | null = null;
const nearWater = () => {
    if (!cachedNearWater) {
        const [w, s, e, n] = PLAY_BBOX;
        const clipped = turf.bboxClip(WATER, [
            w - 0.02,
            s - 0.01,
            e + 0.02,
            n + 0.01,
        ]) as Feature<Polygon | MultiPolygon>;
        const simple = turf.simplify(clipped, {
            tolerance: 0.00005,
            highQuality: true,
        });
        // Clipping and simplifying can leave rings with too few points; keep valid ones
        const polygons = (
            simple.geometry.type === "Polygon"
                ? [simple.geometry.coordinates]
                : simple.geometry.coordinates
        )
            .map((rings) => rings.filter((ring) => ring.length >= 4))
            .filter((rings) => rings.length > 0);
        cachedNearWater = turf.multiPolygon(polygons);
    }
    return cachedNearWater;
};

// Only coastline that can reach the play area within the given distance matters
const linesNear = (meters: number) => {
    const pad = meters / 1000 / 111 + 0.005; // degrees latitude, generous
    const padLng = pad / Math.cos((59.43 * Math.PI) / 180);
    const [w, s, e, n] = PLAY_BBOX;
    const box: [number, number, number, number] = [
        w - padLng,
        s - pad,
        e + padLng,
        n + pad,
    ];
    return turf.featureCollection(
        coastlineLines().features.flatMap((line) => {
            const [lw, ls, le, ln] = turf.bbox(line);
            if (le < box[0] || lw > box[2] || ln < box[1] || ls > box[3])
                return [];
            return (
                turf.flatten(turf.bboxClip(line, box) as any)
                    .features as unknown as Feature<LineString>[]
            ).filter((part) => part.geometry.coordinates.length >= 2);
        }),
    );
};

// Shortest straight-line distance (metres) from a point to the coastline, and where
export const nearestCoastline = (lng: number, lat: number) => {
    const point = turf.point([lng, lat]);
    let best: { meters: number; line: Feature<LineString> } | null = null;
    for (const line of coastlineLines().features) {
        const meters = turf.pointToLineDistance(point, line, {
            units: "meters",
        });
        if (!best || meters < best.meters) best = { meters, line };
    }
    const nearest = turf.nearestPointOnLine(best!.line, point);
    return {
        meters: best!.meters,
        nearest: nearest.geometry.coordinates as [number, number],
    };
};

// B = coastline buffered by the seeker's distance d (round corners, geodesic).
// "Closer" keeps the inside of B, so it is grown by the tolerance; "further"
// removes B, so it is shrunk by the tolerance. Either way borderline areas stay.
export const coastlineZone = async (
    lat: number,
    lng: number,
    hiderCloser: boolean,
) => {
    const { meters } = nearestCoastline(lng, lat);
    const radius = hiderCloser
        ? meters + TOLERANCE_M
        : Math.max(meters - TOLERANCE_M, 0);
    if (radius <= 0) return null;
    const lines = linesNear(radius);
    if (lines.features.length === 0) return null;
    return (await arcBuffer(
        lines as FeatureCollection,
        radius,
        "meters",
        ARC_DEVIATION_M,
    )) as Feature<Polygon | MultiPolygon>;
};

export const removeWater = (
    area: Feature<Polygon | MultiPolygon> | null | undefined,
) => {
    if (!area) return area;
    const dry = turf.difference(turf.featureCollection([area, nearWater()]));
    if (!dry) return null;
    // Snap to ~1 cm and drop repeated points so the result stays a valid polygon
    return turf.cleanCoords(turf.truncate(dry, { precision: 7 }));
};

export const isImpossibleCloser = (lat: number, lng: number) =>
    nearestCoastline(lng, lat).meters < TOLERANCE_M;

export const formatMeters = (meters: number) =>
    meters >= 1000
        ? `${(meters / 1000).toFixed(2)} km`
        : `${Math.round(meters)} m`;
