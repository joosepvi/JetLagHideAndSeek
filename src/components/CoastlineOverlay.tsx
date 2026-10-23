import { useStore } from "@nanostores/react";
import { Fragment } from "react/jsx-runtime";
import { CircleMarker, Polyline, Tooltip } from "react-leaflet";

import { questions, triggerLocalRefresh } from "@/lib/context";
import { formatMeters, nearestCoastline } from "@/maps/questions/coastline";

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
                const { lat, lng } = question.data;
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
                    </Fragment>
                );
            })}
        </Fragment>
    );
};
