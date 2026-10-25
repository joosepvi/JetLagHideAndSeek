import * as turf from "@turf/turf";

import { lastGpsPosition, remainingArea } from "@/lib/context";
import tallinnBoundary from "@/maps/api/tallinn.json";

// Vanalinn: the fallback when nothing better is known
const TALLINN_CENTRE = { lat: 59.437, lng: 24.745 };
const PLAY_BBOX = turf.bbox(tallinnBoundary as any);
const GPS_MAX_AGE_MS = 10 * 60 * 1000;

const nearPlayArea = (lat: number, lng: number) =>
    lng > PLAY_BBOX[0] - 0.1 &&
    lng < PLAY_BBOX[2] + 0.1 &&
    lat > PLAY_BBOX[1] - 0.05 &&
    lat < PLAY_BBOX[3] + 0.05;

// Where a new question's pin starts: the player's own GPS position (Follow Me on and a
// recent fix near Tallinn), otherwise inside the largest area the hider can still be in.
export const defaultQuestionPosition = () => {
    const gps = lastGpsPosition.get();
    if (
        gps &&
        Date.now() - gps.time < GPS_MAX_AGE_MS &&
        nearPlayArea(gps.lat, gps.lng)
    ) {
        return { lat: gps.lat, lng: gps.lng };
    }

    const area = remainingArea.get() ?? (tallinnBoundary as any);
    try {
        const parts = turf.flatten(area).features as any[];
        const largest = parts.reduce((a, b) =>
            turf.area(b) > turf.area(a) ? b : a,
        );
        let point = turf.centerOfMass(largest);
        if (!turf.booleanPointInPolygon(point, largest)) {
            point = turf.pointOnFeature(largest);
        }
        const [lng, lat] = point.geometry.coordinates;
        return { lat, lng };
    } catch {
        return TALLINN_CENTRE;
    }
};

// Second thermometer pin: a short walk east of the first
export const thermometerEnd = (lat: number, lng: number) => {
    const [lngB, latB] = turf.destination([lng, lat], 0.5, 90, {
        units: "kilometers",
    }).geometry.coordinates;
    return { latB, lngB };
};
