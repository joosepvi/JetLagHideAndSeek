import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";

import { getTransitStations, trainStopPoints } from "@/maps/api";
import tallinnBoundary from "@/maps/api/tallinn.json";
import tallinnMatching from "@/maps/api/tallinn-matching.json";
import { cleanArea } from "@/maps/geo-utils/operators";
import { classifyStops } from "@/maps/stopFilter";

const tallinn = tallinnBoundary.features[0] as any;
const nomme = tallinnMatching.districts.features.find((f) =>
    f.properties.name.startsWith("Nõmme"),
) as any;

describe("border slivers", () => {
    it("Tallinn minus Nõmme leaves no hairline pieces", () => {
        const rest = cleanArea(
            turf.difference(turf.featureCollection([tallinn, nomme])) as any,
        )!;
        const pieces = turf.flatten(rest).features;
        // Mainland, Aegna and a few real islets; nothing under 0.25 ha
        for (const piece of pieces) {
            expect(turf.area(piece)).toBeGreaterThan(2500);
        }
        expect(pieces.length).toBeLessThan(12);
    });
});

describe("stops", () => {
    it("train stops are only Elron stops", () => {
        const names = new Set(
            trainStopPoints().features.map((f) => f.properties!.name),
        );
        expect(names.has("Tallinn")).toBe(true);
        expect(names.has("Nõmme")).toBe(true);
        expect(names.has("Viru")).toBe(false);
    });

    it("keeps stops that can still hold the hider and rules out the rest", () => {
        const places = getTransitStations(["bus", "train"]).features as any[];
        const { kept, eliminated } = classifyStops(
            places,
            [turf.featureCollection([nomme])],
            0.5,
            "kilometers",
        );
        const keptNames = new Set(
            kept.map((c: any) => c.properties.properties.name),
        );
        const outNames = new Set(eliminated.map((p: any) => p.properties.name));
        expect(keptNames.has("Nõmme")).toBe(true);
        expect(outNames.has("Viru")).toBe(true);
        // Every stop ends up somewhere (one with some points out can be in both)
        const seen = new Set([
            ...kept.map((c: any) => c.properties.properties.id),
            ...eliminated.map((p: any) => p.properties.id),
        ]);
        expect(seen.size).toBe(places.length);
    });

    // The hider moves inside the zone between questions: "not linnaosa A" answered
    // from the B side of the circle, later "not B" from the A side. The stop near the
    // A|B border must stay possible, although no spot fits both answers at once.
    it("checks each answer separately, not only their common area", () => {
        const district = (name: string) =>
            tallinnMatching.districts.features.find(
                (f) => f.properties.name === name,
            ) as any;
        const a = district("Kristiine");
        const b = district("Mustamäe");
        const others = tallinnMatching.districts.features.filter(
            (f) => f !== a && f !== b,
        ) as any[];
        // Cleaned like in the app (no hairline gaps between the districts)
        const notA = cleanArea(
            turf.difference(turf.featureCollection([tallinn, a])) as any,
        )!;
        const notB = cleanArea(
            turf.difference(turf.featureCollection([tallinn, b])) as any,
        )!;
        const neither = cleanArea(
            turf.difference(turf.featureCollection([notA, b])) as any,
        )!;

        // One stop point in A, close to B but far from the other districts
        const point = (getTransitStations(["bus", "tram"]).features as any[])
            .flatMap((station) => station.properties.platforms)
            .find((coord: [number, number]) => {
                const pt = turf.point(coord);
                return (
                    turf.booleanPointInPolygon(pt, a) &&
                    turf.pointToPolygonDistance(pt, b, { units: "meters" }) <
                        200 &&
                    others.every(
                        (o) =>
                            turf.pointToPolygonDistance(pt, o, {
                                units: "meters",
                            }) > 600,
                    )
                );
            });
        const candidate = point
            ? (turf.point(point, {
                  id: "ab",
                  name: "near A|B",
                  platforms: [point],
              }) as any)
            : undefined;
        expect(candidate).toBeTruthy();

        const separate = classifyStops(
            [candidate],
            [turf.featureCollection([notA]), turf.featureCollection([notB])],
            0.5,
            "kilometers",
        );
        expect(separate.kept).toHaveLength(1);

        const together = classifyStops(
            [candidate],
            [turf.featureCollection([neither])],
            0.5,
            "kilometers",
        );
        expect(together.kept).toHaveLength(0);

        // Control: a point deep inside a wide district (Lasnamäe, over 500 m from
        // its border) is ruled out by "not that district"
        const wide = district("Lasnamäe");
        const notWide = cleanArea(
            turf.difference(turf.featureCollection([tallinn, wide])) as any,
        )!;
        const deep = turf.centerOfMass(wide).geometry.coordinates;
        expect(
            turf.pointToPolygonDistance(deep, notWide, { units: "meters" }),
        ).toBeGreaterThan(500);
        const inside = classifyStops(
            [
                turf.point(deep, {
                    id: "x",
                    name: "x",
                    platforms: [deep],
                }) as any,
            ],
            [turf.featureCollection([notWide])],
            0.5,
            "kilometers",
        );
        expect(inside.kept).toHaveLength(0);
    });

    it("same line keeps only that line's stops", () => {
        const stations = getTransitStations(["tram"]).features;
        const onT4 = stations.filter((s) =>
            s.properties.lines.includes("Tram T4"),
        );
        expect(onT4.length).toBeGreaterThan(5);
        expect(onT4.length).toBeLessThan(stations.length);
    });
});
