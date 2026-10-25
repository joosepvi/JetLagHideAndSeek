import * as turf from "@turf/turf";
import _ from "lodash";
import { toast } from "react-toastify";

import {
    hiderMode,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
} from "@/lib/context";
import {
    findTallinnBorder,
    tallinnLakeShores,
    getTallinnPlaces,
    nearestToQuestion,
    TALLINN_AIRPORTS,
    toPoints,
    trainStopPoints,
} from "@/maps/api";
import {
    arcBufferToPoint,
    arcDistance,
    holedMask,
    modifyMapData,
} from "@/maps/geo-utils";
import type {
    APILocations,
    HomeGameMeasuringQuestions,
    MeasuringQuestion,
} from "@/maps/schema";

import {
    bodyOfWaterZone,
    coastlineZone,
    linesNear,
    isImpossibleCloser,
    nearestCoastline,
    removeWater,
} from "./coastline";

export interface AdminZoneInfo {
    name: string;
    boundary: any;
}

export const findAdminZoneInfo = _.memoize(
    async (
        lat: number,
        lng: number,
        adminLevel: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
    ): Promise<AdminZoneInfo | null> => {
        // Built-in borders (see BORDER_LEVELS)
        const found = findTallinnBorder(lat, lng, adminLevel);
        return found ? { name: found.name, boundary: found.border } : null;
    },
    (lat, lng, adminLevel) =>
        `${lat.toFixed(6)},${lng.toFixed(6)},${adminLevel}`,
);

export const determineMeasuringBoundary = async (
    question: MeasuringQuestion,
) => {
    switch (question.type) {
        case "admin-measure": {
            const adminLevel = (question as any).cat?.adminLevel ?? 2;
            const found = findTallinnBorder(
                question.lat,
                question.lng,
                adminLevel,
            );

            if (!found) {
                toast.error("No border found at this location");
                return false;
            }

            // Store the zone name for display
            if (!(question as any).cat) {
                (question as any).cat = { adminLevel };
            }
            (question as any).cat.zoneName = found.name;

            return [found.border];
        }
        case "coastline":
            // Handled separately (see coastline.ts)
            return false;
        case "body_of_water": {
            // Nearest shore of the sea or one of the listed lakes and ponds. Only sea
            // shore that can reach the play area within the seeker's distance is used.
            const seaMeters = nearestCoastline(
                question.lng,
                question.lat,
            ).meters;
            const sea = linesNear(seaMeters + 50).features.map(
                (line) => line.geometry.coordinates,
            );
            return [
                tallinnLakeShores(),
                ...(sea.length > 0 ? [turf.multiLineString(sea)] : []),
            ];
        }
        case "airport":
            // Airports and airstrips around Tallinn
            return [turf.combine(toPoints(TALLINN_AIRPORTS)).features[0]];
        case "zoo-full":
        case "theme_park-full":
        case "museum-full":
        case "hospital-full":
        case "cinema-full":
        case "library-full":
        case "golf_course-full":
        case "consulate-full":
        case "park-full": {
            // Nearest one may be just outside Tallinn, so the whole built-in list counts
            const location = question.type.split("-full")[0] as APILocations;
            return [
                turf.combine(toPoints(getTallinnPlaces(location))).features[0],
            ];
        }
        case "custom-measure":
            return turf.combine(
                turf.featureCollection((question as any).geo.features),
            ).features;
        case "zoo":
        case "theme_park":
        case "museum":
        case "hospital":
        case "cinema":
        case "library":
        case "golf_course":
        case "consulate":
        case "park":
            return false;
        case "mcdonalds":
            // McDonald's restaurants in and around Tallinn
            return [
                turf.combine(toPoints(getTallinnPlaces("mcdonalds")))
                    .features[0],
            ];
        case "rail-measure": {
            // Elron train stops (every platform), including those just outside Tallinn
            const stops = trainStopPoints();
            if (stops.features.length === 0) return false;
            return [turf.combine(stops).features[0]];
        }
    }
};

const bufferedDeterminer = _.memoize(
    async (question: MeasuringQuestion) => {
        if (question.type === "body_of_water") {
            return bodyOfWaterZone(question.lat, question.lng);
        }
        if (question.type === "coastline") {
            return coastlineZone(
                question.lat,
                question.lng,
                question.hiderCloser,
            );
        }

        const placeData = await determineMeasuringBoundary(question);

        if (placeData === false || placeData === undefined) return false;

        return arcBufferToPoint(
            turf.featureCollection(placeData as any),
            question.lat,
            question.lng,
        );
    },
    (question) =>
        JSON.stringify({
            type: question.type,
            lat: question.lat,
            lng: question.lng,
            entirety: polyGeoJSON.get()
                ? polyGeoJSON.get()
                : mapGeoLocation.get(),
            geo: (question as any).geo,
            cat: (question as any).cat,
            // The coastline buffer depends on the answer (tolerance direction)
            hiderCloser:
                question.type === "coastline" ? question.hiderCloser : null,
        }),
);

export const adjustPerMeasuring = async (
    question: MeasuringQuestion,
    mapData: any,
) => {
    if (mapData === null) return;

    const buffer = await bufferedDeterminer(question);

    if (question.type === "coastline") {
        if (
            question.hiderCloser &&
            isImpossibleCloser(question.lat, question.lng)
        ) {
            toast.warning(
                "The seeker is standing on the coastline, so nobody can be closer to it. Check the answer.",
                { toastId: "coastline-impossible" },
            );
        }
        // d ≈ 0 and "further": nothing to remove
        if (!buffer) return question.hiderCloser ? null : mapData;
        return removeWater(
            modifyMapData(mapData, buffer, question.hiderCloser),
        );
    }

    if (!buffer) return mapData;

    // Nobody hides in the water
    if (question.type === "body_of_water") {
        return removeWater(
            modifyMapData(mapData, buffer, question.hiderCloser),
        );
    }

    return modifyMapData(mapData, buffer, question.hiderCloser);
};

export const hiderifyMeasuring = async (question: MeasuringQuestion) => {
    const $hiderMode = hiderMode.get();
    if ($hiderMode === false) {
        return question;
    }

    if (
        [
            "zoo",
            "theme_park",
            "museum",
            "hospital",
            "cinema",
            "library",
            "golf_course",
            "consulate",
            "park",
        ].includes(question.type)
    ) {
        const questionNearest = await nearestToQuestion(
            question as HomeGameMeasuringQuestions,
        );
        const hiderNearest = await nearestToQuestion({
            lat: $hiderMode.latitude,
            lng: $hiderMode.longitude,
            hiderCloser: true,
            type: (question as HomeGameMeasuringQuestions).type,
            drag: false,
            color: "black",
            collapsed: false,
            hidden: false,
        });

        question.hiderCloser =
            questionNearest.properties.distanceToPoint >
            hiderNearest.properties.distanceToPoint;

        return question;
    }

    if (question.type === "coastline") {
        question.hiderCloser =
            nearestCoastline($hiderMode.longitude, $hiderMode.latitude).meters <
            nearestCoastline(question.lng, question.lat).meters;
        return question;
    }

    if (question.type === "rail-measure" || question.type === "mcdonalds") {
        const points =
            question.type === "rail-measure"
                ? trainStopPoints()
                : toPoints(getTallinnPlaces("mcdonalds"));
        if (points.features.length === 0) return question;

        const seeker = turf.point([question.lng, question.lat]);
        const nearest = turf.nearestPoint(seeker, points as any);

        const distance = await arcDistance(seeker, nearest, "miles");

        const hider = turf.point([$hiderMode.longitude, $hiderMode.latitude]);
        const hiderNearest = turf.nearestPoint(hider, points as any);

        const hiderDistance = await arcDistance(hider, hiderNearest, "miles");

        question.hiderCloser = hiderDistance < distance;
        return question;
    }

    const $mapGeoJSON = mapGeoJSON.get();
    if ($mapGeoJSON === null) return question;

    let feature = null;

    try {
        feature = holedMask((await adjustPerMeasuring(question, $mapGeoJSON))!);
    } catch {
        try {
            feature = await adjustPerMeasuring(question, {
                type: "FeatureCollection",
                features: [holedMask($mapGeoJSON)],
            });
        } catch {
            return question;
        }
    }

    if (feature === null || feature === undefined) return question;

    const hiderPoint = turf.point([$hiderMode.longitude, $hiderMode.latitude]);

    if (turf.booleanPointInPolygon(hiderPoint, feature)) {
        question.hiderCloser = !question.hiderCloser;
    }

    return question;
};

export const measuringPlanningPolygon = async (question: MeasuringQuestion) => {
    try {
        const buffered = await bufferedDeterminer(question);

        if (!buffered) return false;

        return turf.polygonToLine(buffered);
    } catch {
        return false;
    }
};
