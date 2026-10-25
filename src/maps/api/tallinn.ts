// Built-in Tallinn data so matching questions and hiding zones work without Overpass.
// Sources: EHAK (districts), OSM (subdistricts, parks), ETAK huvipunktid (embassies,
// golf), transport.tallinn.ee (buses, trams), national GTFS (Elron trains), eAIP (airports).
import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

import { polyGeoJSON } from "@/lib/context";

import tallinnBoundary from "./tallinn.json";
import tallinnBorders from "./tallinn-borders.json";
import tallinnLakes from "./tallinn-lakes.json";
import tallinnMatching from "./tallinn-matching.json";
import tallinnPlaces from "./tallinn-places.json";
import { transitData, type TransitType } from "./liveTransit";

export type { TransitType } from "./liveTransit";
export type TallinnPlace = { name: string; lat: number; lng: number };
export type StationProperties = {
    id: string;
    name: string;
    types: TransitType[];
    lines: string[];
    // [lng, lat] of every platform (one per direction), exact source coordinates
    platforms: [number, number][];
};
type Zone = Feature<Polygon | MultiPolygon, { name: string }>;

export const TALLINN_AIRPORTS = tallinnMatching.airport as TallinnPlace[];

export const getTallinnPlaces = (type: string): TallinnPlace[] =>
    (tallinnPlaces as Record<string, TallinnPlace[] | undefined>)[type] ?? [];

const playArea = () =>
    (polyGeoJSON.get() ?? tallinnBoundary) as FeatureCollection<
        Polygon | MultiPolygon
    >;

export const isInPlayArea = (lng: number, lat: number) =>
    playArea().features.some((f) =>
        turf.booleanPointInPolygon(turf.point([lng, lat]), f),
    );

// Stops just outside the border (e.g. Jõeküla, Tiskre) still count as hiding zones
const STOP_BORDER_MARGIN_M = 500;
const nearCache = new WeakMap<object, Map<string, boolean>>();
// The border as lines (simplified to ~15 m, plenty for a 500 m margin), each with its
// box, built once per play area: measuring to the full border for every stop was slow
const borderCache = new WeakMap<
    object,
    { line: Feature<any>; box: number[] }[]
>();
const borderLines = (area: FeatureCollection<Polygon | MultiPolygon>) => {
    let lines = borderCache.get(area);
    if (!lines) {
        const pad = 0.01; // degrees, more than 500 m
        lines = area.features.flatMap((f) =>
            turf
                .flatten(turf.polygonToLine(f) as any)
                .features.map((line: any) => {
                    const simple = turf.simplify(line, { tolerance: 0.00015 });
                    const [w, s, e, n] = turf.bbox(simple);
                    return {
                        line: simple,
                        box: [w - pad * 2, s - pad, e + pad * 2, n + pad],
                    };
                }),
        );
        borderCache.set(area, lines);
    }
    return lines;
};
const isNearPlayArea = (lng: number, lat: number) => {
    const area = playArea();
    let cache = nearCache.get(area);
    if (!cache) nearCache.set(area, (cache = new Map()));
    const key = `${lng},${lat}`;
    let near = cache.get(key);
    if (near === undefined) {
        const point = turf.point([lng, lat]);
        near =
            isInPlayArea(lng, lat) ||
            borderLines(area).some(
                ({ line, box }) =>
                    lng > box[0] &&
                    lng < box[2] &&
                    lat > box[1] &&
                    lat < box[3] &&
                    turf.pointToLineDistance(point, line, {
                        units: "meters",
                    }) <= STOP_BORDER_MARGIN_M,
            );
        cache.set(key, near);
    }
    return near;
};

export const toPoints = (places: TallinnPlace[]) =>
    turf.featureCollection(
        places.map((p) =>
            turf.point([p.lng, p.lat], { name: p.name } as Record<string, any>),
        ),
    );

// Admin level 9 = linnaosa (EHAK), 10 = asum (OSM)
export const TALLINN_ZONE_LEVELS = {
    9: "Linnaosa (district)",
    10: "Asum (subdistrict)",
} as const;

// Border question levels, as on the measuring cards. 9 and 10 are house rules for a
// Tallinn-only game. Borders are lines between neighbours: Estonia's land border and
// territorial sea limit (OSM), Harju maakond (OSM, sea area included), and Tallinn,
// linnaosa and asum outlines without the parts along the sea shore.
export const BORDER_LEVELS = {
    2: "International border (Estonia)",
    6: "1st admin division border (Harju maakond)",
    7: "2nd admin division border (Tallinn)",
    9: "Linnaosa border (house rule)",
    10: "Asum border (house rule)",
} as const;
export type BorderLevel = keyof typeof BORDER_LEVELS;

// Body of Water question: 23 lakes and ponds in and around Tallinn (names from the
// place names register KNR, shapes from ETAK e_202_seisuveekogu_a), plus the sea shore
// (added in measuring.ts). Rivers and streams are not included.
let lakeShores: Feature<MultiLineString> | null = null;
export const tallinnLakeShores = () =>
    (lakeShores ??= turf.multiLineString(
        tallinnLakes.features.flatMap((lake) =>
            (lake.geometry.coordinates as number[][][]).map((ring) => ring),
        ),
    ));

export const findTallinnBorder = (
    lat: number,
    lng: number,
    level: number,
): { name: string; border: Feature<MultiLineString> } | null => {
    const borders = tallinnBorders as any;
    const fixed = {
        2: borders.international,
        6: borders.county,
        7: borders.municipality,
    }[level as 2 | 6 | 7];
    if (fixed) return { name: fixed.properties.name, border: fixed };
    const zone = findTallinnZone(lat, lng, level);
    if (!zone) return null;
    const name = zone.properties.name;
    const geometry = (level === 9 ? borders.districts : borders.subdistricts)[
        name
    ];
    // A zone whose whole outline is shore has no border with a neighbour
    if (!geometry || geometry.coordinates.length === 0) return null;
    return {
        name,
        border: turf.feature(geometry, { name }) as Feature<MultiLineString>,
    };
};

const zonesFor = (adminLevel: number): Zone[] | null => {
    if (adminLevel === 9) return tallinnMatching.districts.features as Zone[];
    if (adminLevel === 10)
        return tallinnMatching.subdistricts.features as Zone[];
    return null;
};

export const findTallinnZone = (
    lat: number,
    lng: number,
    adminLevel: number,
) => {
    const point = turf.point([lng, lat]);
    return zonesFor(adminLevel)?.find((zone) =>
        turf.booleanPointInPolygon(point, zone),
    );
};

export const findTallinnZonesByLetter = (adminLevel: number, letter: string) =>
    (zonesFor(adminLevel) ?? []).filter(
        (zone) => zone.properties.name[0].toUpperCase() === letter,
    );

// Hiding zone place types offered in the UI
export const TRANSIT_OPTIONS: { label: string; value: TransitType }[] = [
    { label: "Train stops (Elron)", value: "train" },
    { label: "Tram stops", value: "tram" },
    { label: "Bus stops", value: "bus" },
    { label: "Ferry and sea taxi stops", value: "ferry" },
];

// Older saved settings used OSM filters; map them to transit types
export const toTransitTypes = (options: string[]): TransitType[] => {
    const types = new Set<TransitType>();
    for (const option of options) {
        if (
            option === "train" ||
            option === "tram" ||
            option === "bus" ||
            option === "ferry"
        ) {
            types.add(option);
        } else if (/railway=(station|halt|stop)/.test(option)) {
            types.add("train");
        } else if (option.includes("tram_stop")) {
            types.add("tram");
        } else if (option.includes("bus_stop")) {
            types.add("bus");
        } else if (option.includes("ferry")) {
            types.add("ferry");
        }
    }
    return [...types];
};

// Stops of the chosen types inside the play area, as station features.
// A stop keeps every platform of the chosen types (one per direction); the point itself is
// the real platform closest to the stop's middle, never an averaged position.
// Only lines of the chosen types are kept, so "same line" compares like with like.
// The id stays the same whatever types are chosen, so a marked stop keeps its mark.
const stationCache = new WeakMap<object, Map<string, any>>();
export const getTransitStations = (types: TransitType[]) => {
    const stops = transitData.get().stops;
    let byTypes = stationCache.get(stops);
    if (!byTypes) stationCache.set(stops, (byTypes = new Map()));
    const key =
        [...types].sort().join(",") + "|" + (polyGeoJSON.get() ? "custom" : "");
    const cached = byTypes.get(key);
    if (cached) return cached as FeatureCollection<Point, StationProperties>;
    const result = buildTransitStations(stops, types);
    byTypes.set(key, result);
    return result;
};

const buildTransitStations = (
    stops: ReturnType<typeof transitData.get>["stops"],
    types: TransitType[],
) => {
    const features: Feature<Point, StationProperties>[] = [];

    for (const stop of stops) {
        const platforms = stop.platforms.filter(
            (platform) =>
                platform.types.some((t) => types.includes(t)) &&
                isNearPlayArea(platform.lng, platform.lat),
        );
        if (platforms.length === 0) continue;

        const middle = turf.center(
            turf.points(platforms.map((p) => [p.lng, p.lat])),
        );
        const main = platforms.reduce((best, p) =>
            turf.distance(middle, turf.point([p.lng, p.lat])) <
            turf.distance(middle, turf.point([best.lng, best.lat]))
                ? p
                : best,
        );
        // Lines of the kept platforms (a platform only carries lines of its own type)
        const lines = [...new Set(platforms.flatMap((p) => p.lines))];

        features.push(
            turf.point([main.lng, main.lat], {
                types: [...new Set(platforms.flatMap((p) => p.types))],
                id: `${stop.name}@${stop.platforms[0].id}`,
                name: stop.name,
                lines,
                platforms: platforms.map(
                    (p) => [p.lng, p.lat] as [number, number],
                ),
            }),
        );
    }

    return turf.featureCollection(features) as FeatureCollection<
        Point,
        StationProperties
    >;
};

// Hiding zone of a stop: union of the circles around each of its platforms
export const stationZone = <P>(
    station: Feature<Point, any>,
    radius: number,
    units: turf.Units,
    properties: P,
) => {
    const platforms: [number, number][] = station.properties?.platforms ?? [
        turf.getCoord(station) as [number, number],
    ];
    const circles = platforms.map((coord) =>
        turf.circle(coord, radius, { steps: 32, units }),
    );
    const zone =
        circles.length === 1
            ? circles[0]
            : (turf.union(turf.featureCollection(circles)) ?? circles[0]);
    return { ...zone, properties } as Feature<Polygon | MultiPolygon, P>;
};

export const sharesLine = (a: { lines?: string[] }, b: { lines?: string[] }) =>
    (a.lines ?? []).some((line) => (b.lines ?? []).includes(line));

// The stop nearest to a point among all stops of the chosen types (not only the ones
// still possible), as the seeker would see it standing there
export const nearestTransitStation = (
    lng: number,
    lat: number,
    types: TransitType[],
) => {
    const stations = getTransitStations(types);
    if (stations.features.length === 0) return null;
    return turf.nearestPoint(
        turf.point([lng, lat]),
        stations as any,
    ) as unknown as Feature<Point, StationProperties>;
};

const LINE_ORDER: Record<string, number> = {
    Train: 0,
    Tram: 1,
    Trolleybus: 2,
    Bus: 3,
    Ferry: 4,
};
const lineSort = (a: string, b: string) => {
    const [ta, na] = [a.split(" ")[0], a.slice(a.indexOf(" ") + 1)];
    const [tb, nb] = [b.split(" ")[0], b.slice(b.indexOf(" ") + 1)];
    return (
        (LINE_ORDER[ta] ?? 9) - (LINE_ORDER[tb] ?? 9) ||
        na.localeCompare(nb, "et", { numeric: true })
    );
};

// Every line serving a stop of the chosen types, sorted train, tram, bus, ferry
export const allTransitLines = (types: TransitType[]) =>
    [
        ...new Set(
            getTransitStations(types).features.flatMap(
                (f) => f.properties.lines,
            ),
        ),
    ].sort(lineSort);

export const sortLines = (lines: string[]) => [...lines].sort(lineSort);

// Train stops (Elron) near Tallinn, for the "closer to a train station" question
export const trainStopPoints = () =>
    turf.featureCollection(
        getTransitStations(["train"]).features.flatMap((f) =>
            f.properties.platforms.map(([lng, lat]) =>
                turf.point([lng, lat], { name: f.properties.name }),
            ),
        ),
    );

// Linnaosa and asum borders for the always-visible map layer. Neighbours share their
// border, so each edge would be drawn twice (slightly apart, as the shapes were
// simplified separately): a segment is dropped when an already kept one runs within
// a few metres of it. Asum edges on a linnaosa line are dropped too, so only the
// stronger line shows there. Sea shore is left out (see tallinn-borders.json).
type BorderLabel = { name: string; lat: number; lng: number };
export type AdminBorderData = {
    districtLines: [number, number][][];
    asumLines: [number, number][][];
    districtLabels: BorderLabel[];
    asumLabels: BorderLabel[];
};

const SAME_LINE_M = 15;
const KX = 111320 * Math.cos((59.43 * Math.PI) / 180);
const KY = 110540;
const CELL_M = 100;

const segmentDistance = (
    px: number,
    py: number,
    [x1, y1, x2, y2]: number[],
) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t =
        dx === 0 && dy === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(
                      1,
                      ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy),
                  ),
              );
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

// Kept segments (in metres), in a grid for quick "is there a line nearby" checks
const segmentIndex = () => {
    const cells = new Map<string, number[][]>();
    const cellKeys = (x1: number, y1: number, x2: number, y2: number) => {
        const keys: string[] = [];
        for (
            let cx = Math.floor((Math.min(x1, x2) - SAME_LINE_M) / CELL_M);
            cx <= Math.floor((Math.max(x1, x2) + SAME_LINE_M) / CELL_M);
            cx++
        ) {
            for (
                let cy = Math.floor((Math.min(y1, y2) - SAME_LINE_M) / CELL_M);
                cy <= Math.floor((Math.max(y1, y2) + SAME_LINE_M) / CELL_M);
                cy++
            ) {
                keys.push(`${cx},${cy}`);
            }
        }
        return keys;
    };
    return {
        add(segment: number[]) {
            for (const key of cellKeys(
                segment[0],
                segment[1],
                segment[2],
                segment[3],
            )) {
                const list = cells.get(key) ?? [];
                list.push(segment);
                cells.set(key, list);
            }
        },
        // The whole segment (both ends and middle) lies along a kept line
        covered(x1: number, y1: number, x2: number, y2: number) {
            const near = (px: number, py: number) =>
                (
                    cells.get(
                        `${Math.floor(px / CELL_M)},${Math.floor(py / CELL_M)}`,
                    ) ?? []
                ).some((s) => segmentDistance(px, py, s) <= SAME_LINE_M);
            return (
                near(x1, y1) &&
                near(x2, y2) &&
                near((x1 + x2) / 2, (y1 + y2) / 2)
            );
        },
    };
};

// Adds every line, keeping only the stretches no kept line covers yet
const keepNewStretches = (
    lines: number[][][],
    index: ReturnType<typeof segmentIndex>,
) => {
    const out: [number, number][][] = [];
    for (const line of lines) {
        let current: [number, number][] = [];
        for (let i = 0; i < line.length - 1; i++) {
            const [ax, ay] = line[i];
            const [bx, by] = line[i + 1];
            const seg = [ax * KX, ay * KY, bx * KX, by * KY];
            if (index.covered(seg[0], seg[1], seg[2], seg[3])) {
                if (current.length > 1) out.push(current);
                current = [];
                continue;
            }
            if (current.length === 0) current.push([ax, ay]);
            current.push([bx, by]);
        }
        if (current.length > 1) out.push(current);
        // Indexed after the whole line, so a line never hides its own parts
        for (let i = 0; i < line.length - 1; i++) {
            index.add([
                line[i][0] * KX,
                line[i][1] * KY,
                line[i + 1][0] * KX,
                line[i + 1][1] * KY,
            ]);
        }
    }
    return out;
};

// A point inside the zone for its name (the centre, unless that falls outside a
// concave shape)
const labelPoint = (zone: Zone): BorderLabel => {
    // On the largest part (Kesklinna's centre would otherwise drift towards Aegna)
    const largest = (turf.flatten(zone).features as Feature<Polygon>[]).reduce(
        (a, b) => (turf.area(b) > turf.area(a) ? b : a),
    );
    let point = turf.centerOfMass(largest);
    if (!turf.booleanPointInPolygon(point, largest)) {
        point = turf.pointOnFeature(largest);
    }
    const [lng, lat] = point.geometry.coordinates;
    return { name: zone.properties.name, lat, lng };
};

// A real border runs between two zones, or along Tallinn's land border with its
// neighbours. Anything else left in the outlines is shore that the coast clean-up
// missed (harbour piers, e.g. at the cruise terminal), and is dropped.
const BORDER_NEAR_M = 25;
const onlyRealBorders = (
    byName: Record<string, MultiLineString>,
    landBorder: number[][][],
) => {
    type Tagged = { seg: number[]; owner: string };
    const cells = new Map<string, Tagged[]>();
    const add = (seg: number[], owner: string) => {
        for (
            let cx = Math.floor(Math.min(seg[0], seg[2]) / CELL_M);
            cx <= Math.floor(Math.max(seg[0], seg[2]) / CELL_M);
            cx++
        ) {
            for (
                let cy = Math.floor(Math.min(seg[1], seg[3]) / CELL_M);
                cy <= Math.floor(Math.max(seg[1], seg[3]) / CELL_M);
                cy++
            ) {
                const key = `${cx},${cy}`;
                const list = cells.get(key) ?? [];
                list.push({ seg, owner });
                cells.set(key, list);
            }
        }
    };
    const toSegments = (line: number[][]) =>
        line
            .slice(1)
            .map((b, i) => [
                line[i][0] * KX,
                line[i][1] * KY,
                b[0] * KX,
                b[1] * KY,
            ]);
    for (const [name, geometry] of Object.entries(byName)) {
        for (const line of geometry.coordinates) {
            toSegments(line).forEach((seg) => add(seg, name));
        }
    }
    for (const line of landBorder) {
        toSegments(line).forEach((seg) => add(seg, " land"));
    }
    // Is there a border of another zone (or the land border) next to this point?
    const sharedAt = (px: number, py: number, self: string) => {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const list = cells.get(
                    `${Math.floor(px / CELL_M) + dx},${Math.floor(py / CELL_M) + dy}`,
                );
                if (
                    list?.some(
                        ({ seg, owner }) =>
                            owner !== self &&
                            segmentDistance(px, py, seg) <= BORDER_NEAR_M,
                    )
                ) {
                    return true;
                }
            }
        }
        return false;
    };

    const kept: number[][][] = [];
    for (const [name, geometry] of Object.entries(byName)) {
        for (const line of geometry.coordinates) {
            let current: number[][] = [];
            for (let i = 0; i < line.length - 1; i++) {
                const midX = ((line[i][0] + line[i + 1][0]) / 2) * KX;
                const midY = ((line[i][1] + line[i + 1][1]) / 2) * KY;
                if (sharedAt(midX, midY, name)) {
                    if (current.length === 0) current.push(line[i]);
                    current.push(line[i + 1]);
                } else {
                    if (current.length > 1) kept.push(current);
                    current = [];
                }
            }
            if (current.length > 1) kept.push(current);
        }
    }
    return kept;
};

let adminBorderCache: AdminBorderData | null = null;
export const adminBorderLines = (): AdminBorderData => {
    if (adminBorderCache) return adminBorderCache;
    const borders = tallinnBorders as any;
    const landBorder = borders.municipality.geometry.coordinates;
    const index = segmentIndex();
    const districtLines = keepNewStretches(
        onlyRealBorders(borders.districts, landBorder),
        index,
    );
    const asumLines = keepNewStretches(
        onlyRealBorders(borders.subdistricts, landBorder),
        index,
    );

    return (adminBorderCache = {
        districtLines,
        asumLines,
        districtLabels: (tallinnMatching.districts.features as Zone[]).map(
            labelPoint,
        ),
        asumLabels: (tallinnMatching.subdistricts.features as Zone[]).map(
            labelPoint,
        ),
    });
};
