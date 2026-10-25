import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";

import { adminBorderLines } from "@/maps/api";
import tallinnBorders from "@/maps/api/tallinn-borders.json";

const length = (lines: [number, number][][]) =>
    lines.reduce((sum, line) => sum + turf.length(turf.lineString(line)), 0);

describe("linnaosa and asum border layer", () => {
    const data = adminBorderLines();

    it("draws each shared district border once", () => {
        const raw = Object.values((tallinnBorders as any).districts).flatMap(
            (g: any) => g.coordinates,
        );
        const rawKm = length(raw);
        const keptKm = length(data.districtLines);
        // Shared borders appear twice in the raw outlines: the kept total is clearly
        // shorter, but every district still has its border
        expect(keptKm).toBeLessThan(rawKm * 0.8);
        expect(keptKm).toBeGreaterThan(rawKm * 0.4);
    });

    it("doesn't repeat district lines among the asum lines", () => {
        const asumKm = length(data.asumLines);
        const rawAsumKm = length(
            Object.values((tallinnBorders as any).subdistricts).flatMap(
                (g: any) => g.coordinates,
            ),
        );
        expect(asumKm).toBeLessThan(rawAsumKm * 0.6);
        expect(asumKm).toBeGreaterThan(20);
    });

    it("has a name inside every zone", () => {
        expect(data.districtLabels).toHaveLength(8);
        expect(data.asumLabels.length).toBeGreaterThan(80);
        expect(data.districtLabels.map((l) => l.name)).toContain("Kesklinna");
    });
});
