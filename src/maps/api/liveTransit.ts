// Transit stops and lines. The built-in snapshot (tallinn-transit.json: transport.tallinn.ee
// stops, Elron, ferries) is used at once; current lines are then loaded from peatus.ee,
// the national public transport data (Transpordiamet GTFS via OpenTripPlanner), which
// allows browser requests. Stops are matched by their code (e.g. "21106-1"), trains by
// name. Without a connection the snapshot stays in use.
import * as turf from "@turf/turf";
import { atom } from "nanostores";

import snapshot from "./tallinn-transit.json";

export type TransitType = "train" | "tram" | "bus" | "ferry";
export type TransitPlatform = {
    id: string;
    lat: number;
    lng: number;
    types: TransitType[];
    lines: string[];
};
export type TransitStop = { name: string; platforms: TransitPlatform[] };

export type TransitData = {
    stops: TransitStop[];
    source: "peatus.ee" | "snapshot";
    // pp.kk.aaaa of the live data, or null for the snapshot
    updated: string | null;
};

export const transitData = atom<TransitData>({
    stops: snapshot as TransitStop[],
    source: "snapshot",
    updated: null,
});

const API = "https://api.peatus.ee/routing/v1/routers/estonia/index/graphql";
const QUERY = `{ stopsByBbox(minLat:59.30,minLon:24.45,maxLat:59.62,maxLon:25.10){ name code lat lon routes{ shortName mode agency{ name } } } }`;
const CACHE_KEY = "transitLiveV2";
const CACHE_HOURS = 24;

type LiveStop = {
    name: string;
    code: string | null;
    lat: number;
    lon: number;
    routes: { shortName: string; mode: string; agency: { name: string } }[];
};

const CITY_AGENCY = /Tallinna Linnatransport/i;

// Line names as used everywhere in the app: "Bus 17", "Tram T4", "Train R11"
const cityLine = (route: LiveStop["routes"][number]) =>
    route.mode === "TRAM"
        ? `Tram ${route.shortName}`
        : route.mode === "TROLLEYBUS"
          ? `Trolleybus ${route.shortName}`
          : `Bus ${route.shortName}`;

const dateText = (date: Date) =>
    `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;

// Only what the app uses (Tallinn city lines and Elron lines), small enough to cache
type LiveLines = {
    code: string | null;
    name: string;
    lat: number;
    lon: number;
    city: string[];
    rail: string[];
};
const compact = (live: LiveStop[]): LiveLines[] =>
    live
        .map((stop) => ({
            code: stop.code,
            name: stop.name,
            lat: stop.lat,
            lon: stop.lon,
            city: stop.routes
                .filter((r) => CITY_AGENCY.test(r.agency.name))
                .map(cityLine),
            rail: stop.routes
                .filter((r) => r.mode === "RAIL")
                .map((r) => `Train ${r.shortName}`),
        }))
        .filter((stop) => stop.city.length > 0 || stop.rail.length > 0);

const merge = (live: LiveLines[]): TransitStop[] => {
    const byCode = new Map<string, LiveLines>();
    const railByName = new Map<string, LiveLines[]>();
    for (const stop of live) {
        if (stop.code && stop.city.length > 0) byCode.set(stop.code, stop);
        if (stop.rail.length > 0) {
            const list = railByName.get(stop.name) ?? [];
            list.push(stop);
            railByName.set(stop.name, list);
        }
    }

    return (snapshot as TransitStop[]).map((stop) => ({
        ...stop,
        platforms: stop.platforms.map((platform) => {
            const kept = platform.lines.filter(
                (line) => !/^(Bus|Tram|Trolleybus|Train) /.test(line),
            );
            const lines = new Set<string>(byCode.get(platform.id)?.city ?? []);
            if (platform.types.includes("train")) {
                (railByName.get(stop.name) ?? [])
                    .filter(
                        (s) =>
                            turf.distance(
                                [s.lon, s.lat],
                                [platform.lng, platform.lat],
                            ) < 1.5,
                    )
                    .forEach((s) => s.rail.forEach((l) => lines.add(l)));
            }

            // No live match for this platform: keep its snapshot lines
            if (lines.size === 0) return platform;
            return { ...platform, lines: [...lines, ...kept] };
        }),
    }));
};

// Same lines as before: keep the old list, so nothing is recalculated for nothing
const unchangedOr = (stops: TransitStop[]) => {
    const current = transitData.get().stops;
    return JSON.stringify(stops) === JSON.stringify(current) ? current : stops;
};

let started = false;
export const loadLiveTransit = async () => {
    if (started) return;
    started = true;

    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
        if (
            cached &&
            Date.now() - cached.time < CACHE_HOURS * 3600 * 1000 &&
            Array.isArray(cached.live)
        ) {
            transitData.set({
                stops: unchangedOr(merge(cached.live)),
                source: "peatus.ee",
                updated: dateText(new Date(cached.time)),
            });
            return;
        }
    } catch {
        // Unreadable cache: load again
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: QUERY }),
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`peatus.ee ${response.status}`);
        const all: LiveStop[] = (await response.json()).data.stopsByBbox;
        if (!Array.isArray(all) || all.length < 100) {
            throw new Error("peatus.ee returned too few stops");
        }
        const live = compact(all);
        const time = Date.now();
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ time, live }));
        } catch {
            // Storage full or blocked: live data is still used this time
        }
        transitData.set({
            stops: unchangedOr(merge(live)),
            source: "peatus.ee",
            updated: dateText(new Date(time)),
        });
    } catch (error) {
        console.warn("Live transit data unavailable, using snapshot", error);
    }
};
