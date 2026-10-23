import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import type { Feature, LineString,MultiLineString } from "geojson";
import { useEffect, useState } from "react";
import { Fragment } from "react/jsx-runtime";
import { CircleMarker, GeoJSON, Polyline, Tooltip } from "react-leaflet";

import { polyGeoJSON, questions, triggerLocalRefresh } from "@/lib/context";
import tallinnBoundary from "@/maps/api/tallinn.json";
import {
    coastlineZone,
    formatMeters,
    nearestCoastline,
} from "@/maps/questions/coastline";

// Outline of B (the coastline buffered by d), only inside the play area
const BufferOutline = ({
    lat,
    lng,
    hiderCloser,
}: {
    lat: number;
    lng: number;
    hiderCloser: boolean;
}) => {
    const [outline, setOutline] = useState<Feature<
        LineString | MultiLineString
    > | null>(null);

    useEffect(() => {
        let cancelled = false;
        coastlineZone(lat, lng, hiderCloser)
            .then((zone) => {
                if (cancelled || !zone) return setOutline(null);
                const area = (polyGeoJSON.get() ?? tallinnBoundary) as any;
                const inside = turf.intersect(
                    turf.featureCollection([
                        turf.combine(area).features[0] as any,
                        zone,
                    ]),
                );
                setOutline(inside ? (turf.polygonToLine(inside) as any) : null);
            })
            .catch(() => setOutline(null));
        return () => {
            cancelled = true;
        };
    }, [lat, lng, hiderCloser]);

    if (!outline) return null;
    return (
        <GeoJSON
            key={`${lat},${lng},${hiderCloser}`}
            data={outline}
            style={{ color: "#2563eb", weight: 1.5, dashArray: "4 4" }}
            interactive={false}
        />
    );
};

// For each coastline question: nearest coastline point, the straight line to it and d
export const CoastlineOverlay = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);

    return (
        <Fragment>
            {$questions.map((question) => {
                if (
                    question.id !== "measuring" ||
                    question.data.type !== "coastline" ||
                    question.data.hidden
                )
                    return null;
                const { lat, lng, hiderCloser } = question.data;
                const { meters, nearest } = nearestCoastline(lng, lat);

                return (
                    <Fragment key={`coast-${question.key}`}>
                        <Polyline
                            positions={[
                                [lat, lng],
                                [nearest[1], nearest[0]],
                            ]}
                            pathOptions={{
                                color: "#2563eb",
                                weight: 2,
                                dashArray: "6 4",
                            }}
                        >
                            <Tooltip permanent direction="center">
                                d = {formatMeters(meters)}
                            </Tooltip>
                        </Polyline>
                        <CircleMarker
                            center={[nearest[1], nearest[0]]}
                            radius={5}
                            pathOptions={{
                                color: "#1e3a8a",
                                weight: 2,
                                fillColor: "#60a5fa",
                                fillOpacity: 1,
                            }}
                        >
                            <Tooltip direction="top">
                                Nearest coastline ({formatMeters(meters)})
                            </Tooltip>
                        </CircleMarker>
                        <BufferOutline
                            lat={lat}
                            lng={lng}
                            hiderCloser={hiderCloser}
                        />
                    </Fragment>
                );
            })}
        </Fragment>
    );
};
