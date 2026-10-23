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

import tallinnCoast from "@/maps/api/tallinn-coast.json";
import { arcBuffer } from "@/maps/geo-utils";

// Lakes whose shores also count as coastline, by ETAK name, e.g. "Ülemiste järv".
// Available: Ülemiste järv, Harku järv, Maardu järv, Raku järv, Tammemäe järv, Männiku järv
export const COASTLINE_LAKES: string[] = [];

// Boundary tolerance: when in doubt the area is kept
const TOLERANCE_M = 10;

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
        cachedLines = turf.featureCollection(
            parts.flatMap(
                (part) =>
                    turf.flatten(part as any)
                        .features as unknown as Feature<LineString>[],
            ),
        );
    }
    return cachedLines;
};

export const WATER = tallinnCoast.water as unknown as Feature<
    Polygon | MultiPolygon
>;

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
    return (await arcBuffer(
        coastlineLines() as FeatureCollection,
        radius,
        "meters",
    )) as Feature<Polygon | MultiPolygon>;
};

export const removeWater = (
    area: Feature<Polygon | MultiPolygon> | null | undefined,
) => {
    if (!area) return area;
    const dry = turf.difference(turf.featureCollection([area, WATER]));
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
