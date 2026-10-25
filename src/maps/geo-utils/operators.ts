import * as units from "@arcgis/core/core/units.js";
import * as geodesicBufferOperator from "@arcgis/core/geometry/operators/geodesicBufferOperator.js";
import * as geodeticDistanceOperator from "@arcgis/core/geometry/operators/geodeticDistanceOperator.js";
import Point from "@arcgis/core/geometry/Point.js";
import * as geometryJsonUtils from "@arcgis/core/geometry/support/jsonUtils.js";
import * as unionTypes from "@arcgis/core/unionTypes.js";
import { arcgisToGeoJSON, geojsonToArcGIS } from "@terraformer/arcgis";
import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    Geometry,
    MultiPolygon,
    Polygon,
} from "geojson";

import { BLANK_GEOJSON } from "@/maps/api";

export { geoSpatialVoronoi } from "@/maps/geo-utils/voronoi";

export const safeUnion = (input: FeatureCollection<Polygon | MultiPolygon>) => {
    if (input.features.length === 1) return input.features[0];
    const union = turf.union(input);
    if (union) return union;
    throw new Error("No features");
};

export const holedMask = (
    input:
        | Feature<Polygon | MultiPolygon>
        | FeatureCollection<Polygon | MultiPolygon>,
) => {
    return turf.difference(
        turf.featureCollection([
            BLANK_GEOJSON.features[0] as Feature<Polygon>,
            "features" in input ? safeUnion(input) : input,
        ]),
    );
};

// Removes slivers: where shapes from different sources (city border, districts,
// buffers) don't share exact edges, cutting one from another leaves hairline pieces
// and holes. Pieces and holes under ~0.25 ha, or thin ones under 2 ha, are dropped.
const MIN_PIECE_M2 = 2500;
const THIN_PIECE_M2 = 20000;
const isSliver = (ring: number[][]) => {
    const polygon = turf.polygon([ring]);
    const area = turf.area(polygon);
    if (area < MIN_PIECE_M2) return true;
    if (area >= THIN_PIECE_M2) return false;
    const perimeter = turf.length(turf.lineString(ring), { units: "meters" });
    // 1 for a circle, close to 0 for a long thin strip
    return (4 * Math.PI * area) / (perimeter * perimeter) < 0.05;
};
export const cleanArea = <T extends Feature<Polygon | MultiPolygon> | null>(
    area: T,
): T => {
    if (!area) return area;
    const polygons = (
        area.geometry.type === "Polygon"
            ? [area.geometry.coordinates]
            : area.geometry.coordinates
    )
        .filter((rings) => rings[0].length >= 4 && !isSliver(rings[0]))
        .map((rings) => [
            rings[0],
            ...rings
                .slice(1)
                .filter((ring) => ring.length >= 4 && !isSliver(ring)),
        ]);
    if (polygons.length === 0) return null as T;
    return turf.multiPolygon(polygons, area.properties) as unknown as T;
};

export const modifyMapData = (
    mapData: FeatureCollection<Polygon | MultiPolygon>,
    modifications:
        | FeatureCollection<Polygon | MultiPolygon>
        | Feature<Polygon | MultiPolygon>,
    withinModifications: boolean,
) => {
    const safeModifications =
        "features" in modifications ? safeUnion(modifications) : modifications;

    if (withinModifications) {
        return cleanArea(
            turf.intersect(
                turf.featureCollection([safeUnion(mapData), safeModifications]),
            ),
        );
    }
    return cleanArea(
        turf.intersect(
            turf.featureCollection([
                safeUnion(mapData),
                holedMask(safeModifications)!,
            ]),
        ),
    );
};

const DEFAULT_BUFFER_UNIT = "miles";
const DEFAULT_DISTANCE_UNIT = "kilometers";

const toArcGISGeometry = (geometry: Feature | Geometry) =>
    geometryJsonUtils.fromJSON(
        geojsonToArcGIS("geometry" in geometry ? geometry.geometry : geometry),
    ) as unionTypes.GeometryUnion;

export const arcDistance = (
    first: Feature | Geometry,
    second: Feature | Geometry,
    unit: units.LengthUnit & turf.Units = DEFAULT_DISTANCE_UNIT,
) =>
    geodeticDistanceOperator
        .load()
        .then(() =>
            geodeticDistanceOperator.execute(
                toArcGISGeometry(first),
                toArcGISGeometry(second),
                { unit },
            ),
        );

// maxDeviation: how far the buffer's curves may stray from the true arc (default 3 feet)
export const arcBuffer = (
    geometry: FeatureCollection,
    distance: number,
    unit: units.LengthUnit & turf.Units = DEFAULT_BUFFER_UNIT,
    maxDeviation?: number,
) => {
    const arcgisGeometry = geometry.features.map((x) =>
        geometryJsonUtils.fromJSON(geojsonToArcGIS(x.geometry)),
    ) as unionTypes.GeometryUnion[];

    return innateArcBuffer(arcgisGeometry, distance, unit, maxDeviation);
};

const innateArcBuffer = async (
    arcgisGeometry: unionTypes.GeometryUnion[],
    distance: number,
    unit: units.LengthUnit & turf.Units = DEFAULT_BUFFER_UNIT,
    maxDeviation?: number,
) => {
    await geodesicBufferOperator.load();

    const bufferedGeometry = geodesicBufferOperator.executeMany(
        arcgisGeometry,
        Array(arcgisGeometry.length).fill(distance),
        {
            union: true,
            unit: unit,
            maxDeviation: maxDeviation ?? turf.convertLength(3, "feet", unit),
        },
    );

    return turf.combine(
        turf.featureCollection([
            turf.feature(arcgisToGeoJSON(bufferedGeometry[0] as any)),
        ]) as any,
    ).features[0] as Feature<MultiPolygon>;
};

export const arcBufferToPoint = async (
    geometry: FeatureCollection,
    lat: number,
    lng: number,
) => {
    const point = new Point({
        latitude: lat,
        longitude: lng,
    });

    const arcgisGeometry = geometry.features.map((x) =>
        geometryJsonUtils.fromJSON(geojsonToArcGIS(x.geometry)),
    ) as unionTypes.GeometryUnion[];

    await geodeticDistanceOperator.load();

    const distances = arcgisGeometry.map((x) =>
        geodeticDistanceOperator.execute(x, point, {
            unit: DEFAULT_BUFFER_UNIT,
        }),
    );

    // 2 m curve accuracy is plenty for the game and much faster than the 3 ft default
    return innateArcBuffer(
        arcgisGeometry,
        Math.min(...distances),
        DEFAULT_BUFFER_UNIT,
        turf.convertLength(2, "meters", DEFAULT_BUFFER_UNIT),
    );
};
