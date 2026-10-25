import * as turf from "@turf/turf";
import _ from "lodash";
import { toast } from "react-toastify";

import {
    displayHidingZonesOptions,
    hiderMode,
    hidingRadius,
    hidingRadiusUnits,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
} from "@/lib/context";
import {
    findTallinnZone,
    findTallinnZonesByLetter,
    getTallinnPlaces,
    getTransitStations,
    isInPlayArea,
    nearestToQuestion,
    nearestTransitStation,
    stationZone,
    TALLINN_AIRPORTS,
    toPoints,
    toTransitTypes,
} from "@/maps/api";
import { holedMask, modifyMapData, safeUnion } from "@/maps/geo-utils";
import { transitData } from "@/maps/api/liveTransit";
import { geoSpatialVoronoi } from "@/maps/geo-utils";
import type {
    APILocations,
    HomeGameMatchingQuestions,
    MatchingQuestion,
} from "@/maps/schema";

export const findMatchingPlaces = async (question: MatchingQuestion) => {
    switch (question.type) {
        case "airport": {
            // All airports and airstrips around Tallinn (only EETN is commercial)
            return toPoints(TALLINN_AIRPORTS).features;
        }
        case "custom-points": {
            return question.geo!;
        }
        case "zoo-full":
        case "theme_park-full":
        case "museum-full":
        case "hospital-full":
        case "cinema-full":
        case "library-full":
        case "consulate-full":
        case "park-full": {
            const location = question.type.split("-full")[0] as APILocations;
            return toPoints(
                getTallinnPlaces(location).filter((p) =>
                    isInPlayArea(p.lng, p.lat),
                ),
            ).features;
        }
    }
};

export const determineMatchingBoundary = _.memoize(
    async (question: MatchingQuestion) => {
        let boundary;

        switch (question.type) {
            case "zoo":
            case "theme_park":
            case "museum":
            case "hospital":
            case "cinema":
            case "library":
            case "golf_course":
            case "consulate":
            case "park":
            case "same-first-letter-station":
            case "same-length-station":
            case "same-train-line": {
                return false;
            }
            case "custom-zone": {
                boundary = question.geo;
                break;
            }
            case "zone": {
                boundary = findTallinnZone(
                    question.lat,
                    question.lng,
                    question.cat.adminLevel,
                );

                if (!boundary) {
                    toast.error("No district found at this location");
                    throw new Error("No boundary found");
                }
                break;
            }
            case "letter-zone": {
                const zone = findTallinnZone(
                    question.lat,
                    question.lng,
                    question.cat.adminLevel,
                );

                if (!zone) {
                    toast.error("No district found at this location");
                    throw new Error("No boundary found");
                }

                const letter = zone.properties.name[0].toUpperCase();
                boundary = safeUnion(
                    turf.featureCollection(
                        findTallinnZonesByLetter(
                            question.cat.adminLevel,
                            letter,
                        ),
                    ),
                );
                break;
            }
            case "airport":
            case "zoo-full":
            case "theme_park-full":
            case "museum-full":
            case "hospital-full":
            case "cinema-full":
            case "library-full":
            case "consulate-full":
            case "park-full":
            case "custom-points": {
                const data = await findMatchingPlaces(question);

                const voronoi = geoSpatialVoronoi(data);
                const point = turf.point([question.lng, question.lat]);

                for (const feature of voronoi.features) {
                    if (turf.booleanPointInPolygon(point, feature)) {
                        boundary = feature;
                        break;
                    }
                }
                break;
            }
        }

        return boundary;
    },
    (question: MatchingQuestion & { geo?: unknown; cat?: unknown }) =>
        JSON.stringify({
            type: question.type,
            lat: question.lat,
            lng: question.lng,
            cat: question.cat,
            geo: question.geo,
            entirety: polyGeoJSON.get()
                ? polyGeoJSON.get()
                : mapGeoLocation.get(),
        }),
);

// Same line question: the hider's hiding zone is around a stop of the chosen line
// ("Same") or around any other stop ("Different").
const lineZone = _.memoize(
    (line: string, same: boolean) => {
        const types = toTransitTypes(displayHidingZonesOptions.get());
        const radius = hidingRadius.get();
        const units = hidingRadiusUnits.get();
        const zones = getTransitStations(types)
            .features.filter(
                (station) => station.properties.lines.includes(line) === same,
            )
            .map((station) => stationZone(station, radius, units, {}));
        if (zones.length === 0) return null;
        return safeUnion(turf.featureCollection(zones));
    },
    (line: string, same: boolean) =>
        JSON.stringify([
            line,
            same,
            displayHidingZonesOptions.get(),
            hidingRadius.get(),
            hidingRadiusUnits.get(),
            transitData.get().updated,
        ]),
);

export const adjustPerMatching = async (
    question: MatchingQuestion,
    mapData: any,
) => {
    if (mapData === null) return;

    if (question.type === "same-train-line") {
        // Until a line is picked the question doesn't change the map
        if (!question.line) return mapData;
        const zone = lineZone(question.line, question.same);
        if (!zone) {
            toast.warning(
                `No stops of ${question.line} among the chosen stop types`,
                { toastId: "line-no-stops" },
            );
            return question.same ? null : mapData;
        }
        return modifyMapData(mapData, zone, true);
    }

    const boundary = await determineMatchingBoundary(question);

    if (boundary === false) {
        return mapData;
    }

    return modifyMapData(mapData, boundary, question.same);
};

export const hiderifyMatching = async (question: MatchingQuestion) => {
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
            question as HomeGameMatchingQuestions,
        );
        const hiderNearest = await nearestToQuestion({
            lat: $hiderMode.latitude,
            lng: $hiderMode.longitude,
            same: true,
            type: (question as HomeGameMatchingQuestions).type,
            drag: false,
            color: "black",
            collapsed: false,
            hidden: false,
        });

        question.same =
            questionNearest.properties.name === hiderNearest.properties.name;

        return question;
    }

    if (
        question.type === "same-first-letter-station" ||
        question.type === "same-length-station" ||
        question.type === "same-train-line"
    ) {
        const hiderPoint = turf.point([
            $hiderMode.longitude,
            $hiderMode.latitude,
        ]);
        const seekerPoint = turf.point([question.lng, question.lat]);

        const places = getTransitStations(
            toTransitTypes(displayHidingZonesOptions.get()),
        );

        const nearestHiderTrainStation = turf.nearestPoint(hiderPoint, places);
        const nearestSeekerTrainStation = turf.nearestPoint(
            seekerPoint,
            places,
        );

        if (question.type === "same-train-line") {
            if (!question.line) return question;
            const hiderStop = nearestTransitStation(
                $hiderMode.longitude,
                $hiderMode.latitude,
                toTransitTypes(displayHidingZonesOptions.get()),
            );
            question.same =
                hiderStop?.properties.lines.includes(question.line) ?? false;
            return question;
        }

        const hiderEnglishName = nearestHiderTrainStation.properties.name;
        const seekerEnglishName = nearestSeekerTrainStation.properties.name;

        if (!hiderEnglishName || !seekerEnglishName) {
            return question;
        }

        if (question.type === "same-first-letter-station") {
            if (
                hiderEnglishName[0].toUpperCase() ===
                seekerEnglishName[0].toUpperCase()
            ) {
                question.same = true;
            } else {
                question.same = false;
            }
        } else if (question.type === "same-length-station") {
            if (hiderEnglishName.length === seekerEnglishName.length) {
                question.lengthComparison = "same";
            } else if (hiderEnglishName.length < seekerEnglishName.length) {
                question.lengthComparison = "shorter";
            } else {
                question.lengthComparison = "longer";
            }
        }

        return question;
    }

    const $mapGeoJSON = mapGeoJSON.get();
    if ($mapGeoJSON === null) return question;

    let feature = null;

    try {
        feature = holedMask((await adjustPerMatching(question, $mapGeoJSON))!);
    } catch {
        try {
            feature = await adjustPerMatching(question, {
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
        question.same = !question.same;
    }

    return question;
};

export const matchingPlanningPolygon = async (question: MatchingQuestion) => {
    try {
        const boundary = await determineMatchingBoundary(question);

        if (boundary === false) {
            return false;
        }

        return turf.polygonToLine(boundary);
    } catch {
        return false;
    }
};
