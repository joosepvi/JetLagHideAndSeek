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
