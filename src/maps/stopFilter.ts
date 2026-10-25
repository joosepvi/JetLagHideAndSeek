import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import { type StationCircle, type StationPlace, stationZone } from "@/maps/api";
import { safeUnion } from "@/maps/geo-utils";

// Flat projection in metres around Tallinn: error well under a metre over a few km
const KX = 111320 * Math.cos((59.43 * Math.PI) / 180);
const KY = 110540;

// One question's answer area, prepared for quick "does this circle reach it" tests
const prepareArea = (
    area: FeatureCollection<Polygon | MultiPolygon>,
    radiusM: number,
) => {
    if (area.features.length === 0) return null;
    const shape = safeUnion(area) as Feature<Polygon | MultiPolygon>;
    // ~5 m simpler shape for the inside test: points near the edge are decided by
    // the edge test anyway
    const simple = turf.simplify(shape, { tolerance: 0.00005 });

    // Edges in a grid of cells as big as the hiding radius
    const cells = new Map<string, number[][]>();
    turf.flattenEach(shape, (polygon) => {
        for (const ring of (polygon.geometry as Polygon).coordinates) {
            for (let i = 0; i < ring.length - 1; i++) {
                const seg = [
                    ring[i][0] * KX,
                    ring[i][1] * KY,
                    ring[i + 1][0] * KX,
                    ring[i + 1][1] * KY,
                ];
                for (
                    let cx = Math.floor(Math.min(seg[0], seg[2]) / radiusM);
                    cx <= Math.floor(Math.max(seg[0], seg[2]) / radiusM);
                    cx++
                ) {
                    for (
                        let cy = Math.floor(Math.min(seg[1], seg[3]) / radiusM);
                        cy <= Math.floor(Math.max(seg[1], seg[3]) / radiusM);
                        cy++
                    ) {
                        const key = `${cx},${cy}`;
                        const list = cells.get(key) ?? [];
                        list.push(seg);
                        cells.set(key, list);
                    }
                }
            }
        }
    });

    const reachesEdge = (px: number, py: number) => {
        const cx = Math.floor(px / radiusM);
        const cy = Math.floor(py / radiusM);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const [x1, y1, x2, y2] of cells.get(
                    `${cx + dx},${cy + dy}`,
                ) ?? []) {
                    const ex = x2 - x1;
                    const ey = y2 - y1;
                    const t =
                        ex === 0 && ey === 0
                            ? 0
                            : Math.max(
                                  0,
                                  Math.min(
                                      1,
                                      ((px - x1) * ex + (py - y1) * ey) /
                                          (ex * ex + ey * ey),
                                  ),
                              );
                    if (
                        Math.hypot(px - (x1 + t * ex), py - (y1 + t * ey)) <=
                        radiusM
                    ) {
                        return true;
                    }
                }
            }
        }
        return false;
    };

    // Does a hiding-radius circle around this point reach the area at all?
    return ([lng, lat]: [number, number]) =>
        reachesEdge(lng * KX, lat * KY) ||
        turf.booleanPointInPolygon([lng, lat], simple);
};

// Splits stops into those whose hiding zone can still hold the hider and those that
// are ruled out.
//
// The hider may move inside their hiding zone, and each answer is about where they
// were at that moment. So a stop point's circle stays possible when, for every
// question separately, some part of it fits that answer. The parts don't have to
// overlap (e.g. "not linnaosa A" answered from the B side of the circle, later "not
// B" from the A side). Each stop point (platform) is its own hiding zone: a stop
// stays while at least one of its points passes, and its zone is drawn from the
// points that pass; the others are ruled out.
export const classifyStops = (
    places: StationPlace[],
    questionAreas: FeatureCollection<Polygon | MultiPolygon>[],
    radius: number,
    units: turf.Units,
): { kept: StationCircle[]; eliminated: StationPlace[] } => {
    const radiusM = turf.convertLength(radius, units, "meters");
    const tests = questionAreas.map((area) => prepareArea(area, radiusM));

    const withPlatforms = (
        place: StationPlace,
        platforms: [number, number][],
    ) =>
        ({
            ...place,
            properties: { ...place.properties, platforms },
        }) as unknown as StationPlace;

    const kept: StationCircle[] = [];
    const eliminated: StationPlace[] = [];

    for (const place of places) {
        const platforms: [number, number][] = (place.properties as any)
            .platforms ?? [turf.getCoord(place)];
        const possible = platforms.filter((coord) =>
            tests.every((reaches) => reaches !== null && reaches(coord)),
        );
        const ruledOut = platforms.filter((coord) => !possible.includes(coord));

        if (possible.length > 0) {
            const place2 =
                ruledOut.length > 0 ? withPlatforms(place, possible) : place;
            kept.push(
                stationZone(
                    place2 as any,
                    radius,
                    units,
                    place2,
                ) as unknown as StationCircle,
            );
        }
        if (ruledOut.length > 0) {
            eliminated.push(
                possible.length > 0 ? withPlatforms(place, ruledOut) : place,
            );
        }
    }

    return { kept, eliminated };
};
