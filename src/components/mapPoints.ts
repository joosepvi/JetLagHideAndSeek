import * as L from "leaflet";

// One shared canvas for all small map points (stop points and place icons).
// Hundreds of separate DOM markers made zooming and panning slow on phones;
// a single canvas is redrawn in one go. The pane sits above the green zones
// (overlay pane, 400) and below question markers (600), so those keep their drag.
export const getPointsRenderer = (map: L.Map): L.Canvas => {
    if (!map.getPane("stopPoints")) {
        const pane = map.createPane("stopPoints");
        pane.style.zIndex = "590";
    }
    // One renderer per map instance; the tolerance keeps small dots easy to hit
    return ((map as any)._stopPointRenderer ??= L.canvas({
        pane: "stopPoints",
        tolerance: 6,
    }));
};

type ImageMarkerOptions = L.CircleMarkerOptions & {
    image: CanvasImageSource | null;
    width: number;
    height: number;
};

// A canvas-drawn picture (emoji or flag) that behaves like a circle marker:
// tooltips, clicks and hit-testing all work as usual.
export const ImageMarker = L.CircleMarker.extend({
    _updatePath(this: any) {
        const renderer = this._renderer;
        const { image, width, height } = this.options as ImageMarkerOptions;
        if (!renderer._drawing || this._empty() || !image) return;
        const p = this._point;
        renderer._ctx.drawImage(
            image,
            Math.round(p.x - width / 2),
            Math.round(p.y - height / 2),
            width,
            height,
        );
    },
}) as unknown as new (
    latlng: L.LatLngExpression,
    options: ImageMarkerOptions,
) => L.CircleMarker;

// Place icons are kept above the stop points on the shared canvas (the topmost
// drawn item is the one that gets hover and clicks).
const placeIconSets = (map: L.Map): Set<L.LayerGroup> =>
    ((map as any)._placeIconSets ??= new Set<L.LayerGroup>());
export const registerPlaceIcons = (map: L.Map, group: L.LayerGroup) => {
    placeIconSets(map).add(group);
    return () => placeIconSets(map).delete(group);
};
export const raisePlaceIcons = (map: L.Map) =>
    placeIconSets(map).forEach((group) =>
        group.eachLayer((layer) => (layer as L.Path).bringToFront()),
    );
