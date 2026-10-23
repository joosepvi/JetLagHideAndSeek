// Built-in Tallinn data so matching questions and hiding zones work without Overpass.
// Sources: EHAK (districts), OSM (subdistricts, parks), ETAK huvipunktid (embassies,
// golf), transport.tallinn.ee (buses, trams), national GTFS (Elron trains), eAIP (airports).
import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

import { polyGeoJSON } from "@/lib/context";

import tallinnBoundary from "./tallinn.json";
import tallinnMatching from "./tallinn-matching.json";
import tallinnPlaces from "./tallinn-places.json";
import tallinnTransit from "./tallinn-transit.json";

export type TallinnPlace = { name: string; lat: number; lng: number };
export type TransitType = "train" | "tram" | "bus" | "ferry";
type TransitPlatform = {
    id: string;
    lat: number;
    lng: number;
    types: TransitType[];
    lines: string[];
};
type TransitStop = { name: string; platforms: TransitPlatform[] };
export type StationProperties = {
    id: string;
    name: string;
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
            area.features.some((f) =>
                turf.flatten(turf.polygonToLine(f) as any).features.some(
                    (line: any) =>
                        turf.pointToLineDistance(point, line, {
                            units: "meters",
                        }) <= STOP_BORDER_MARGIN_M,
                ),
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
export const getTransitStations = (types: TransitType[]) => {
    const features: Feature<Point, StationProperties>[] = [];

    for (const stop of tallinnTransit as TransitStop[]) {
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
        const lines = [
            ...new Set(
                platforms.flatMap((p) =>
                    p.lines.filter((line) =>
                        types.some((t) =>
                            line.toLowerCase().startsWith(t + " "),
                        ),
                    ),
                ),
            ),
        ];

        features.push(
            turf.point([main.lng, main.lat], {
                id: `${stop.name}@${main.id}`,
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
