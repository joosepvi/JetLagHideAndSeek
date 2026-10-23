import * as turf from "@turf/turf";
import { describe, expect, it, vi } from "vitest";

import tallinnBoundary from "@/maps/api/tallinn.json";

// The geodesic ArcGIS buffer needs a browser (WASM); a turf buffer stands in here.
vi.mock("@/maps/geo-utils", () => ({
    arcBuffer: async (fc: any, distance: number, unit: any) =>
        turf.buffer(turf.combine(fc).features[0] as any, distance, {
            units: unit,
            steps: 32,
        }),
}));
vi.mock("@/lib/context", () => ({ polyGeoJSON: { get: () => null } }));

const {
    coastlineZone,
    nearestCoastline,
    removeWater,
    WATER,
} = await import("@/maps/questions/coastline");

const tallinn = tallinnBoundary.features[0] as any;

const answer = async (lng: number, lat: number, closer: boolean) => {
    const zone = await coastlineZone(lat, lng, closer);
    if (!zone) return closer ? null : tallinn;
    const kept = closer
        ? turf.intersect(turf.featureCollection([tallinn, zone]))
        : turf.difference(turf.featureCollection([tallinn, zone]));
    return removeWater(kept as any);
};

const waterLeft = (area: any) => {
    let m2 = 0;
    for (const coords of (WATER.geometry as any).coordinates) {
        const overlap = turf.intersect(
            turf.featureCollection([area, turf.polygon(coords)]),
        );
        if (overlap) m2 += turf.area(overlap);
    }
    return m2;
};

describe("coastline question", { timeout: 30000 }, () => {
    // Seekers in Vanalinn, Pirita and Mustamäe
    for (const [lng, lat] of [
        [24.7453, 59.4372],
        [24.83, 59.47],
        [24.66, 59.42],
    ]) {
        it(`keeps d/2 and drops 2d correctly from ${lat},${lng}`, async () => {
            const { meters: d, nearest } = nearestCoastline(lng, lat);
            const along = (f: number) => [
                nearest[0] + (lng - nearest[0]) * f,
                nearest[1] + (lat - nearest[1]) * f,
            ];
            const half = turf.point(along(0.5));
            const double = turf.point(along(2));
            expect(d).toBeGreaterThan(20);

            const closer = (await answer(lng, lat, true))!;
            const further = (await answer(lng, lat, false))!;

            expect(turf.booleanPointInPolygon(half, closer)).toBe(true);
            expect(turf.booleanPointInPolygon(half, further)).toBe(false);
            if (turf.booleanPointInPolygon(double, tallinn)) {
                expect(turf.booleanPointInPolygon(double, closer)).toBe(false);
                expect(turf.booleanPointInPolygon(double, further)).toBe(
                    true,
                );
            }
            for (const area of [closer, further]) {
                expect(turf.booleanValid(area)).toBe(true);
                expect(waterLeft(area)).toBeLessThan(5000); // m², simplification slack
            }
        });
    }

    it("measures about 900 m from Raekoja plats", () => {
        const { meters } = nearestCoastline(24.745, 59.437);
        expect(meters).toBeGreaterThan(850);
        expect(meters).toBeLessThan(950);
    });
});
