import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import { type StationCircle, type StationPlace, stationZone } from "@/maps/api";
import { safeUnion } from "@/maps/geo-utils";

// Splits stops into those whose hiding zone can still hold the hider and those that
// are ruled out. A stop stays when any of its platform circles reaches the remaining
// area at all (one platform per direction, each with its own circle).
export const classifyStops = (
    places: StationPlace[],
    remaining: FeatureCollection<Polygon | MultiPolygon> | null,
    radius: number,
    units: turf.Units,
): { kept: StationCircle[]; eliminated: StationPlace[] } => {
    const zoneOf = (place: StationPlace) =>
        stationZone(
            place as any,
            radius,
            units,
            place,
        ) as unknown as StationCircle;

    if (!remaining || remaining.features.length === 0) {
        return { kept: [], eliminated: places };
    }

    const area = safeUnion(remaining) as Feature<Polygon | MultiPolygon>;
    const radiusM = turf.convertLength(radius, units, "meters");

    // Every edge of the remaining area as a segment in metres around Tallinn (flat
    // projection: error well under a metre over a few km), for a quick distance test
    const KX = 111320 * Math.cos((59.43 * Math.PI) / 180);
    const KY = 110540;
    const segments: number[][] = [];
    turf.flattenEach(area, (polygon) => {
        for (const ring of (polygon.geometry as Polygon).coordinates) {
            for (let i = 0; i < ring.length - 1; i++) {
                segments.push([
                    ring[i][0] * KX,
                    ring[i][1] * KY,
                    ring[i + 1][0] * KX,
                    ring[i + 1][1] * KY,
                ]);
            }
        }
    });
    // Does a circle of the hiding radius around this point reach the area's edge?
    const reachesEdge = ([lng, lat]: [number, number]) => {
        const px = lng * KX;
        const py = lat * KY;
        for (const [x1, y1, x2, y2] of segments) {
            if (
                Math.min(x1, x2) > px + radiusM ||
                Math.max(x1, x2) < px - radiusM ||
                Math.min(y1, y2) > py + radiusM ||
                Math.max(y1, y2) < py - radiusM
            ) {
                continue;
            }
            const dx = x2 - x1;
            const dy = y2 - y1;
            const t =
                dx === 0 && dy === 0
                    ? 0
                    : Math.max(
                          0,
                          Math.min(
                              1,
                              ((px - x1) * dx + (py - y1) * dy) /
                                  (dx * dx + dy * dy),
                          ),
                      );
            if (Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= radiusM) {
                return true;
            }
        }
        return false;
    };

    const kept: StationCircle[] = [];
    const eliminated: StationPlace[] = [];

    for (const place of places) {
        const platforms: [number, number][] = (place.properties as any)
            .platforms ?? [turf.getCoord(place)];

        const inside = platforms.some((coord) =>
            turf.booleanPointInPolygon(coord, area),
        );
        if (inside) {
            kept.push(zoneOf(place));
            continue;
        }

        if (platforms.some(reachesEdge)) kept.push(zoneOf(place));
        else eliminated.push(place);
    }

    return { kept, eliminated };
};
