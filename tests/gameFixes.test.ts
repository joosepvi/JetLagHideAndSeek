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
        const places = getTransitStations(["bus", "train"])
            .features as any[];
        const { kept, eliminated } = classifyStops(
            places,
            turf.featureCollection([nomme]),
            0.5,
            "kilometers",
        );
        const keptNames = new Set(
            kept.map((c: any) => c.properties.properties.name),
        );
        const outNames = new Set(
            eliminated.map((p: any) => p.properties.name),
        );
        expect(keptNames.has("Nõmme")).toBe(true);
        expect(outNames.has("Viru")).toBe(true);
        expect(kept.length + eliminated.length).toBe(places.length);
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
