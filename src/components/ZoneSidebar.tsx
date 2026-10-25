import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection } from "geojson";
import * as L from "leaflet";
import _ from "lodash";
import { SidebarCloseIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import {
    Sidebar,
    SidebarContent,
    SidebarContext,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuItem,
} from "@/components/ui/sidebar-r";
import {
    disabledStations,
    displayHidingZones,
    displayHidingZonesOptions,
    displayHidingZonesStyle,
    displayStopPoints,
    hidingRadius,
    hidingRadiusUnits,
    isCalculating,
    isLoading,
    leafletMapContext,
    planningModeEnabled,
    questionAreas,
    questionFinishedMapData,
    questions,
    trainStations,
} from "@/lib/context";
import { cn } from "@/lib/utils";
import {
    BLANK_GEOJSON,
    findTentacleLocations,
    getTallinnPlaces,
    getTransitStations,
    nearestToQuestion,
    nearestTransitStation,
    sharesLine,
    type StationCircle,
    type StationPlace,
    stationZone,
    toPoints,
    toTransitTypes,
    TRANSIT_OPTIONS,
} from "@/maps/api";
import {
    arcDistance,
    extractStationLabel,
    extractStationName,
    geoSpatialVoronoi,
    holedMask,
    lngLatToText,
    safeUnion,
} from "@/maps/geo-utils";

import { loadLiveTransit, transitData } from "@/maps/api/liveTransit";
import { classifyStops } from "@/maps/stopFilter";

import { yieldToPaint } from "./BusyIndicator";
import {
    crossedStopImage,
    getPointsRenderer,
    ImageMarker,
    raisePlaceIcons,
} from "./mapPoints";
import { satelliteMap } from "./SatelliteToggle";
import { Checkbox } from "./ui/checkbox";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "./ui/command";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { MultiSelect } from "./ui/multi-select";
import { ScrollToTop } from "./ui/scroll-to-top";
import { MENU_ITEM_CLASSNAME } from "./ui/sidebar-l";
import { UnitSelect } from "./UnitSelect";

let buttonJustClicked = false;

const zonesPane = (map: L.Map) => {
    if (!map.getPane("hidingZones")) {
        map.createPane("hidingZones").style.zIndex = "450";
    }
    return "hidingZones";
};

const zoneStyle = (): L.PathOptions =>
    satelliteMap.get()
        ? {
              color: "#a3e635",
              weight: 1.4,
              fillColor: "#a3e635",
              fillOpacity: 0.12,
          }
        : {
              color: "green",
              weight: 0.8,
              fillColor: "green",
              fillOpacity: 0.06,
          };

export const ZoneSidebar = () => {
    const $displayHidingZones = useStore(displayHidingZones);
    const $displayStopPoints = useStore(displayStopPoints);
    const $questionFinishedMapData = useStore(questionFinishedMapData);
    const $questionAreas = useStore(questionAreas);
    const $displayHidingZonesOptions = useStore(displayHidingZonesOptions);
    const $displayHidingZonesStyle = useStore(displayHidingZonesStyle);
    const $hidingRadius = useStore(hidingRadius);
    const $hidingRadiusUnits = useStore(hidingRadiusUnits);
    const $isLoading = useStore(isLoading);
    const map = useStore(leafletMapContext);
    const stations = useStore(trainStations);
    const $disabledStations = useStore(disabledStations);
    const [hidingZoneModeStationID, setHidingZoneModeStationID] =
        useState<string>("");
    // The exact stop point (one direction) chosen as the hiding zone
    const [selectedPlatform, setSelectedPlatform] = useState<
        [number, number] | null
    >(null);
    const [stationSearch, setStationSearch] = useState<string>("");
    const [eliminatedStops, setEliminatedStops] = useState<StationPlace[]>([]);
    const $transitData = useStore(transitData);
    // Stops sharing a name (e.g. Tallinn-Väike train and bus) get their type added
    const stationLabel = (() => {
        const counts = new Map<string, number>();
        for (const station of stations) {
            const name = extractStationLabel(station.properties) as string;
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const typeNames: Record<string, string> = {
            train: "train",
            tram: "tram",
            bus: "bus",
            ferry: "ferry",
        };
        return (station: StationCircle) => {
            const name = extractStationLabel(station.properties) as string;
            if ((counts.get(name) ?? 0) < 2) return name;
            const types: string[] =
                (station.properties.properties as any).types ?? [];
            return `${name} (${types.map((t) => typeNames[t] ?? t).join(", ")})`;
        };
    })();
    const isStationSearchActive = stationSearch.trim().length > 0;
    const setStations = trainStations.set;
    const sidebarRef = useRef<HTMLDivElement>(null);

    // Satellite view: zones need a brighter green to show on dark imagery
    useEffect(
        () =>
            satelliteMap.subscribe(() =>
                map?.eachLayer((layer: any) => {
                    if (layer.hidingZones) layer.setStyle(zoneStyle());
                }),
            ),
        [map],
    );

    const removeHidingZones = () => {
        if (!map) return;

        map.eachLayer((layer: any) => {
            if (layer.hidingZones) {
                // Hopefully only geoJSON layers
                map.removeLayer(layer);
            }
        });
    };

    const showGeoJSON = (
        geoJSONData: any,
        nonOverlappingStations: boolean = false,
        additionalOptions: L.GeoJSONOptions = {},
    ) => {
        if (!map) return;

        removeHidingZones();

        const geoJsonLayer = L.geoJSON(geoJSONData, {
            // Zones never catch clicks, so the stop points underneath stay clickable
            interactive: false,
            // Canvas: up to ~1100 circles are much cheaper to draw than SVG on phones.
            // Own pane above the shading of eliminated areas (overlay pane, 400) and
            // below the stop points (590), so zones are never covered by the shading.
            // @ts-expect-error renderer is passed on to each vector layer
            renderer: ((map as any)._zonesRenderer ??= L.canvas({
                padding: 0.3,
                pane: zonesPane(map),
            })),
            style: zoneStyle(),
            onEachFeature: nonOverlappingStations
                ? (feature, layer) => {
                      layer.on("click", async () => {
                          if (!map) return;

                          setHidingZoneModeStationID(
                              feature.properties.properties.id,
                          );
                      });
                  }
                : undefined,
            pointToLayer(geoJsonPoint, latlng) {
                const marker = L.marker(latlng, {
                    icon: L.divIcon({
                        html: `<div class="text-black bg-opacity-0"><svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 448 512" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg"><path d="M96 0C43 0 0 43 0 96L0 352c0 48 35.2 87.7 81.1 94.9l-46 46C28.1 499.9 33.1 512 43 512l39.7 0c8.5 0 16.6-3.4 22.6-9.4L160 448l128 0 54.6 54.6c6 6 14.1 9.4 22.6 9.4l39.7 0c10 0 15-12.1 7.9-19.1l-46-46c46-7.1 81.1-46.9 81.1-94.9l0-256c0-53-43-96-96-96L96 0zM64 96c0-17.7 14.3-32 32-32l256 0c17.7 0 32 14.3 32 32l0 96c0 17.7-14.3 32-32 32L96 224c-17.7 0-32-14.3-32-32l0-96zM224 288a48 48 0 1 1 0 96 48 48 0 1 1 0-96z"></path></svg></div>`,
                        className: "",
                    }),
                });

                marker.bindPopup(
                    `<b>${
                        extractStationName(geoJsonPoint) || "No Name Found"
                    } (${lngLatToText(
                        geoJsonPoint.geometry.coordinates as [number, number],
                    )})</b>`,
                );

                return marker;
            },
            ...additionalOptions,
        });

        // @ts-expect-error This is intentionally added as a check
        geoJsonLayer.hidingZones = true;

        geoJsonLayer.addTo(map);
    };

    const removeStopPoints = () => {
        if (!map) return;

        map.eachLayer((layer: any) => {
            if (layer.stopPoints) map.removeLayer(layer);
        });
    };

    // Small yellow dot at every stop point (one per direction), at its exact position
    const showStopPoints = (
        stationPlaces: StationPlace[],
        ruledOut: StationPlace[] = [],
    ) => {
        if (!map) return;

        removeStopPoints();

        // Shared points canvas (see mapPoints.ts)
        const stopPointRenderer = getPointsRenderer(map);

        const selected: L.CircleMarker[] = [];
        const dots = L.layerGroup();
        const possible = L.layerGroup(
            stationPlaces.flatMap((station) => {
                const id = station.properties.id as string;
                const name = extractStationName(station) || "No Name Found";
                const platforms: [number, number][] = (
                    station.properties as any
                ).platforms ?? [turf.getCoord(station)];
                return platforms.map(([lng, lat]) => {
                    const isSelected =
                        id === hidingZoneModeStationID &&
                        (selectedPlatform
                            ? selectedPlatform[0] === lng &&
                              selectedPlatform[1] === lat
                            : turf.getCoord(station)[0] === lng &&
                              turf.getCoord(station)[1] === lat);
                    const marker = L.circleMarker(
                        [lat, lng],
                        isSelected
                            ? {
                                  pane: "stopPoints",
                                  renderer: stopPointRenderer,
                                  radius: 5,
                                  color: "#7f1d1d",
                                  weight: 2,
                                  fillColor: "#dc2626",
                                  fillOpacity: 1,
                              }
                            : {
                                  pane: "stopPoints",
                                  renderer: stopPointRenderer,
                                  radius: 1.5,
                                  color: "#a16207",
                                  weight: 0.5,
                                  fillColor: "#facc15",
                                  fillOpacity: 1,
                              },
                    ).bindTooltip(name, { direction: "top" });

                    // Clicking a stop point offers to (un)mark it as the hiding zone
                    const content = L.DomUtil.create("div");
                    L.DomUtil.create("b", "", content).textContent = name;
                    const button = L.DomUtil.create(
                        "button",
                        "block mt-2 px-2 py-1 rounded-md text-white " +
                            (isSelected ? "bg-slate-600" : "bg-red-600"),
                        content,
                    );
                    button.textContent = isSelected
                        ? "Remove hiding zone mark"
                        : "Mark as hiding zone";
                    L.DomEvent.on(button, "click", (e) => {
                        L.DomEvent.stop(e);
                        map.closePopup();
                        if (isSelected) {
                            setHidingZoneModeStationID("");
                            setSelectedPlatform(null);
                        } else {
                            if (!$displayHidingZones)
                                displayHidingZones.set(true);
                            setSelectedPlatform([lng, lat]);
                            setHidingZoneModeStationID(id);
                        }
                    });
                    marker.bindPopup(content);
                    // Right click opens the same choice instead of the map's menu
                    marker.on("contextmenu", (e) => {
                        // Stop the map's own menu (Leaflet event) and the browser's (DOM event)
                        L.DomEvent.stopPropagation(e);
                        L.DomEvent.preventDefault(e.originalEvent);
                        marker.openPopup(e.latlng);
                    });

                    if (isSelected) selected.push(marker);
                    return marker;
                });
            }),
        );

        // Ruled-out stops: small red crossed-out dots, name on hover, no zone
        const cross = crossedStopImage();
        for (const station of ruledOut) {
            const name = extractStationName(station) || "No Name Found";
            const platforms: [number, number][] = (station.properties as any)
                .platforms ?? [turf.getCoord(station)];
            for (const [lng, lat] of platforms) {
                const marker = new ImageMarker([lat, lng], {
                    renderer: stopPointRenderer,
                    pane: "stopPoints",
                    radius: 1.5,
                    stroke: false,
                    fill: false,
                    ...cross,
                });
                marker.bindTooltip(name, {
                    direction: "top",
                });
                dots.addLayer(marker);
            }
        }

        // @ts-expect-error This is intentionally added as a check
        dots.stopPoints = true;

        possible.eachLayer((layer) => dots.addLayer(layer));
        dots.addTo(map);
        // Place icons above the stops, the chosen stop above everything
        raisePlaceIcons(map);
        selected.forEach((marker) => marker.bringToFront());
    };

    useEffect(() => {
        if (!map) return;

        // "All Stations" view shows stops only through these points
        const showPoints =
            $displayStopPoints ||
            ($displayHidingZones && $displayHidingZonesStyle === "stations");
        if (!showPoints) {
            removeStopPoints();
            return;
        }

        // Possible stops in yellow, ruled-out ones as red crossed-out dots
        showStopPoints(
            stations
                .filter(
                    (x) =>
                        !$disabledStations.includes(x.properties.properties.id),
                )
                .map((x) => x.properties),
            [
                ...eliminatedStops,
                ...stations
                    .filter((x) =>
                        $disabledStations.includes(x.properties.properties.id),
                    )
                    .map((x) => x.properties),
            ],
        );
    }, [
        eliminatedStops,
        map,
        $displayStopPoints,
        $displayHidingZones,
        $displayHidingZonesStyle,
        $displayHidingZonesOptions,
        $disabledStations,
        stations,
        hidingZoneModeStationID,
        selectedPlatform,
    ]);

    // Live lines from peatus.ee (falls back to the built-in snapshot)
    useEffect(() => {
        loadLiveTransit();
    }, []);

    // Which stops are still possible. Kept stops get green zones and yellow dots, the
    // rest are drawn as red crossed-out dots. If something changes while this runs, it
    // runs once more with the latest settings, so no update is lost.
    const zoneRun = useRef({ running: false, pending: false });
    useEffect(() => {
        if (!map) return;
        if (!($displayHidingZones || $displayStopPoints)) return;
        if (!$questionFinishedMapData && $questionAreas.length === 0) return;

        const classify = async () => {
            const types = toTransitTypes(displayHidingZonesOptions.get());
            if (types.length === 0) {
                toast.error("At least one place type must be selected", {
                    toastId: "no-place-types",
                });
                setStations([]);
                setEliminatedStops([]);
                return;
            }

            const places = getTransitStations(types)
                .features as unknown as StationPlace[];
            const result = classifyStops(
                places,
                questionAreas.get(),
                hidingRadius.get(),
                hidingRadiusUnits.get(),
            );
            let circles = result.kept;
            const eliminated = result.eliminated;
            const drop = (keep: (circle: StationCircle) => boolean) => {
                const next: StationCircle[] = [];
                for (const circle of circles) {
                    if (keep(circle)) next.push(circle);
                    else eliminated.push(circle.properties);
                }
                circles = next;
            };

            for (const question of questions.get()) {
                if (planningModeEnabled.get() && question.data.drag) {
                    continue;
                }
                // Hidden questions (eye button) don't filter hiding zones
                if (question.data.hidden) continue;
                if (question.id !== "matching") continue;

                const data = question.data as any;
                if (data.type === "same-train-line") {
                    // The seeker named a line: keep only its stops (or all others)
                    if (!data.line) continue;
                    drop((circle) => {
                        const onLine = (
                            circle.properties.properties as any
                        ).lines?.includes(data.line);
                        return data.same ? onLine : !onLine;
                    });
                    continue;
                }
                if (
                    data.type !== "same-first-letter-station" &&
                    data.type !== "same-length-station"
                ) {
                    continue;
                }

                // The seeker's own nearest stop, among all stops (not only the
                // ones still possible)
                const seekerStop = nearestTransitStation(
                    data.lng,
                    data.lat,
                    types,
                );
                const seekerName = seekerStop?.properties.name;
                if (!seekerName) continue;

                if (data.type === "same-first-letter-station") {
                    const letter = seekerName[0].toUpperCase();
                    drop((circle) => {
                        const name = extractStationName(circle.properties);
                        if (!name) return false;
                        return data.same
                            ? name[0].toUpperCase() === letter
                            : name[0].toUpperCase() !== letter;
                    });
                } else {
                    const comparison = data.lengthComparison ?? "same";
                    drop((circle) => {
                        const name = extractStationName(circle.properties);
                        if (!name) return false;
                        if (comparison === "shorter") {
                            return name.length < seekerName.length;
                        }
                        if (comparison === "longer") {
                            return name.length > seekerName.length;
                        }
                        return name.length === seekerName.length;
                    });
                }
            }

            // The game has no answer only when no hiding zone fits every answer.
            // A fully shaded map alone doesn't mean that: the hider may have
            // moved inside their zone between questions.
            if (circles.length === 0 && places.length > 0) {
                toast.error(
                    "No solutions found: no hiding zone fits all the answers",
                    { toastId: "no-solutions" },
                );
            } else {
                toast.dismiss("no-solutions");
            }

            setStations(circles);
            setEliminatedStops(eliminated);
        };

        const run = async () => {
            const state = zoneRun.current;
            if (state.running) {
                state.pending = true;
                return;
            }
            state.running = true;
            isCalculating.set(isCalculating.get() + 1);
            try {
                do {
                    state.pending = false;
                    await yieldToPaint();
                    await classify();
                } while (state.pending);
            } catch (error) {
                console.log("Error in hiding zone initialization:", error);
                toast.error(
                    "An error occurred during hiding zone initialization",
                    { toastId: "hiding-zone-initialization-error" },
                );
            } finally {
                state.running = false;
                isCalculating.set(Math.max(0, isCalculating.get() - 1));
            }
        };
        run();
    }, [
        map,
        $questionFinishedMapData,
        $questionAreas,
        $displayHidingZones,
        $displayStopPoints,
        $displayHidingZonesOptions,
        $hidingRadius,
        $hidingRadiusUnits,
        $transitData.stops,
    ]);

    useEffect(() => {
        if (!map) return;

        if ($displayHidingZones && hidingZoneModeStationID) {
            const hiderStation = _.find(
                stations,
                (c) => c.properties.properties.id === hidingZoneModeStationID,
            );

            if (hiderStation !== undefined) {
                // Only the chosen stop point's own circle (not the whole stop)
                const point =
                    selectedPlatform ??
                    (turf.getCoord(hiderStation.properties) as [
                        number,
                        number,
                    ]);
                const place = {
                    ...hiderStation.properties,
                    geometry: { type: "Point", coordinates: point },
                };
                const single = turf.circle(point, $hidingRadius, {
                    steps: 64,
                    units: $hidingRadiusUnits,
                    properties: place,
                });
                isCalculating.set(isCalculating.get() + 1);
                selectionProcess(
                    single,
                    map,
                    stations,
                    showGeoJSON,
                    $questionFinishedMapData,
                    $hidingRadius,
                )
                    .finally(() =>
                        isCalculating.set(Math.max(0, isCalculating.get() - 1)),
                    )
                    .catch((error) => {
                        console.log("Error in hiding zone selection:", error);
                        toast.error(
                            "An error occurred during hiding zone selection",
                            { toastId: "hiding-zone-selection-error" },
                        );
                    });
            } else {
                toast.error("Invalid hiding zone selected", {
                    toastId: "hiding-zone-selection-error",
                });
            }
        } else if ($displayHidingZones) {
            const activeStations = stations.filter(
                (x) => !$disabledStations.includes(x.properties.properties.id),
            );
            showGeoJSON(
                styleStations(
                    activeStations,
                    $displayHidingZonesStyle,
                    $hidingRadius,
                    $hidingRadiusUnits,
                ),
                false, // zones are not clickable; select via a stop point
            );
        } else {
            removeHidingZones();
        }
    }, [
        $disabledStations,
        $displayHidingZones,
        $displayHidingZonesStyle,
        $hidingRadius,
        $hidingRadiusUnits,
        $questionFinishedMapData,
        hidingZoneModeStationID,
        selectedPlatform,
        stations,
    ]);

    return (
        <Sidebar side="right">
            <div className="flex items-center justify-between">
                <h2 className="ml-4 mt-4 font-poppins text-2xl">Hiding Zone</h2>
                <SidebarCloseIcon
                    className="mr-2 visible md:hidden scale-x-[-1]"
                    onClick={() => {
                        SidebarContext.get().setOpenMobile(false);
                    }}
                />
            </div>
            <SidebarContent ref={sidebarRef}>
                <ScrollToTop element={sidebarRef} minHeight={500} />
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem className={MENU_ITEM_CLASSNAME}>
                                <Label className="font-semibold font-poppins">
                                    Display hiding zones?
                                </Label>
                                <Checkbox
                                    defaultChecked={$displayHidingZones}
                                    checked={$displayHidingZones}
                                    onCheckedChange={displayHidingZones.set}
                                    disabled={$isLoading}
                                />
                            </SidebarMenuItem>
                            <SidebarMenuItem className={MENU_ITEM_CLASSNAME}>
                                <Label className="font-semibold font-poppins">
                                    Display transport stop points?
                                </Label>
                                <Checkbox
                                    checked={$displayStopPoints}
                                    onCheckedChange={(v) =>
                                        displayStopPoints.set(!!v)
                                    }
                                />
                            </SidebarMenuItem>
                            <SidebarMenuItem
                                className={cn(
                                    MENU_ITEM_CLASSNAME,
                                    "text-orange-500",
                                )}
                            >
                                Warning: This feature can drastically slow down
                                your device.
                            </SidebarMenuItem>
                            <SidebarMenuItem
                                className={cn(
                                    MENU_ITEM_CLASSNAME,
                                    "text-xs text-slate-400",
                                )}
                            >
                                {$transitData.source === "peatus.ee"
                                    ? `Stops and lines: peatus.ee, updated ${$transitData.updated}`
                                    : "Stops and lines: built-in copy (peatus.ee not reachable)"}
                            </SidebarMenuItem>
                            <SidebarMenuItem className={MENU_ITEM_CLASSNAME}>
                                <MultiSelect
                                    options={TRANSIT_OPTIONS}
                                    onValueChange={
                                        displayHidingZonesOptions.set
                                    }
                                    defaultValue={$displayHidingZonesOptions}
                                    placeholder="Select allowed places"
                                    animation={2}
                                    maxCount={3}
                                    modalPopover
                                    className="!bg-popover bg-opacity-100"
                                    disabled={$isLoading}
                                />
                            </SidebarMenuItem>
                            <SidebarMenuItem>
                                <Label className="font-semibold font-poppins ml-2">
                                    Hiding Zone Radius
                                </Label>
                                <div
                                    className={cn(
                                        MENU_ITEM_CLASSNAME,
                                        "gap-2 flex flex-row",
                                    )}
                                >
                                    <Input
                                        type="number"
                                        className="rounded-md p-2 w-16"
                                        value={$hidingRadius}
                                        onChange={(e) => {
                                            hidingRadius.set(
                                                parseFloat(e.target.value),
                                            );
                                        }}
                                        disabled={$isLoading}
                                    />
                                    <UnitSelect
                                        unit={$hidingRadiusUnits}
                                        disabled={$isLoading}
                                        onChange={(unit) => {
                                            hidingRadiusUnits.set(unit);
                                        }}
                                    />
                                </div>
                            </SidebarMenuItem>
                            {$displayHidingZones && stations.length > 0 && (
                                <SidebarMenuItem
                                    className="bg-popover hover:bg-accent relative flex cursor-pointer gap-2 select-none items-center rounded-sm px-2 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                                    onClick={() => {
                                        setHidingZoneModeStationID("");
                                        displayHidingZonesStyle.set(
                                            "no-display",
                                        );
                                    }}
                                    disabled={$isLoading}
                                >
                                    No Display
                                </SidebarMenuItem>
                            )}
                            {$displayHidingZones && stations.length > 0 && (
                                <SidebarMenuItem
                                    className="bg-popover hover:bg-accent relative flex cursor-pointer gap-2 select-none items-center rounded-sm px-2 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                                    onClick={() => {
                                        setHidingZoneModeStationID("");
                                        displayHidingZonesStyle.set("stations");
                                    }}
                                    disabled={$isLoading}
                                >
                                    All Stations
                                </SidebarMenuItem>
                            )}
                            {$displayHidingZones && stations.length > 0 && (
                                <SidebarMenuItem
                                    className="bg-popover hover:bg-accent relative flex cursor-pointer gap-2 select-none items-center rounded-sm px-2 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                                    onClick={() => {
                                        setHidingZoneModeStationID("");
                                        displayHidingZonesStyle.set("zones");
                                    }}
                                    disabled={$isLoading}
                                >
                                    All Zones
                                </SidebarMenuItem>
                            )}
                            {$displayHidingZones && stations.length > 0 && (
                                <SidebarMenuItem
                                    className="bg-popover hover:bg-accent relative flex cursor-pointer gap-2 select-none items-center rounded-sm px-2 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                                    onClick={() => {
                                        setHidingZoneModeStationID("");
                                        displayHidingZonesStyle.set(
                                            "no-overlap",
                                        );
                                    }}
                                    disabled={$isLoading}
                                >
                                    No Overlap
                                </SidebarMenuItem>
                            )}
                            {$displayHidingZones && hidingZoneModeStationID && (
                                <SidebarMenuItem
                                    className={cn(
                                        MENU_ITEM_CLASSNAME,
                                        "bg-popover hover:bg-accent",
                                    )}
                                    disabled={$isLoading}
                                >
                                    Current:{" "}
                                    {(() => {
                                        const selected = stations.find(
                                            (x) =>
                                                x.properties.properties.id ===
                                                hidingZoneModeStationID,
                                        );
                                        // Stations may still be loading, or the saved id may be gone
                                        if (!selected) return "…";
                                        const displayName = extractStationLabel(
                                            selected.properties,
                                        );
                                        const id = selected?.properties
                                            .properties.id as string;
                                        const coords = selected?.properties
                                            .geometry.coordinates as [
                                            number,
                                            number,
                                        ];
                                        const href = id?.includes("/")
                                            ? `https://www.openstreetmap.org/${id}`
                                            : `https://www.openstreetmap.org/?mlat=${coords[1]}&mlon=${coords[0]}#map=17/${coords[1]}/${coords[0]}`;
                                        return (
                                            <a
                                                href={href}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-blue-500"
                                            >
                                                {displayName}
                                            </a>
                                        );
                                    })()}
                                </SidebarMenuItem>
                            )}
                            {$displayHidingZones &&
                                $disabledStations.length > 0 && (
                                    <SidebarMenuItem
                                        className="bg-popover hover:bg-accent relative flex cursor-pointer gap-2 select-none items-center rounded-sm px-2 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                                        onClick={() => {
                                            disabledStations.set([]);
                                        }}
                                        disabled={$isLoading}
                                    >
                                        Clear Disabled
                                    </SidebarMenuItem>
                                )}
                            {$displayHidingZones && (
                                <SidebarMenuItem
                                    className="bg-popover hover:bg-accent relative flex cursor-pointer gap-2 select-none items-center rounded-sm px-2 py-2.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                                    onClick={() => {
                                        disabledStations.set(
                                            stations.map(
                                                (x) =>
                                                    x.properties.properties.id,
                                            ),
                                        );
                                    }}
                                    disabled={$isLoading}
                                >
                                    Disable All
                                </SidebarMenuItem>
                            )}
                            {$displayHidingZones && (
                                <Command
                                    key={
                                        isStationSearchActive
                                            ? "station-search-active"
                                            : "station-search-idle"
                                    }
                                    shouldFilter={isStationSearchActive}
                                >
                                    <CommandInput
                                        placeholder="Search for a hiding zone..."
                                        value={stationSearch}
                                        onValueChange={setStationSearch}
                                        disabled={$isLoading}
                                    />
                                    <CommandList className="max-h-full">
                                        <CommandEmpty>
                                            No hiding zones found.
                                        </CommandEmpty>
                                        <CommandGroup>
                                            {stations.map((station) => (
                                                <CommandItem
                                                    key={
                                                        station.properties
                                                            .properties.id
                                                    }
                                                    data-station-id={
                                                        station.properties
                                                            .properties.id
                                                    }
                                                    className={cn(
                                                        $disabledStations.includes(
                                                            station.properties
                                                                .properties.id,
                                                        ) && "line-through",
                                                    )}
                                                    onSelect={async () => {
                                                        if (!map) return;

                                                        setTimeout(() => {
                                                            if (
                                                                buttonJustClicked
                                                            ) {
                                                                buttonJustClicked =
                                                                    false;
                                                                return;
                                                            }

                                                            if (
                                                                $disabledStations.includes(
                                                                    station
                                                                        .properties
                                                                        .properties
                                                                        .id,
                                                                )
                                                            ) {
                                                                disabledStations.set(
                                                                    [
                                                                        ...$disabledStations.filter(
                                                                            (
                                                                                x,
                                                                            ) =>
                                                                                x !==
                                                                                station
                                                                                    .properties
                                                                                    .properties
                                                                                    .id,
                                                                        ),
                                                                    ],
                                                                );
                                                            } else {
                                                                disabledStations.set(
                                                                    [
                                                                        ...$disabledStations,
                                                                        station
                                                                            .properties
                                                                            .properties
                                                                            .id,
                                                                    ],
                                                                );
                                                            }

                                                            setStations([
                                                                ...stations,
                                                            ]);
                                                        }, 100);
                                                    }}
                                                    disabled={$isLoading}
                                                >
                                                    {stationLabel(station)}
                                                    <button
                                                        onClick={async () => {
                                                            if (!map) return;

                                                            buttonJustClicked =
                                                                true;

                                                            setSelectedPlatform(
                                                                null,
                                                            );
                                                            setHidingZoneModeStationID(
                                                                station
                                                                    .properties
                                                                    .properties
                                                                    .id,
                                                            );
                                                            // Only this button moves the map: show the chosen zone
                                                            const [w, s, e, n] =
                                                                turf.bbox(
                                                                    station,
                                                                );
                                                            map.flyToBounds(
                                                                [
                                                                    [s, w],
                                                                    [n, e],
                                                                ],
                                                                {
                                                                    maxZoom: 16,
                                                                    duration: 0.6,
                                                                },
                                                            );
                                                            if (
                                                                window.innerWidth <
                                                                768
                                                            ) {
                                                                SidebarContext.get().setOpenMobile(
                                                                    false,
                                                                );
                                                            }
                                                        }}
                                                        className="bg-slate-600 p-0.5 rounded-md"
                                                        disabled={$isLoading}
                                                    >
                                                        View
                                                    </button>
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            )}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
};

function styleStations(
    circles: StationCircle[],
    style: string,
    radius: number,
    units: turf.Units,
): FeatureCollection | Feature {
    switch (style) {
        case "no-display":
            return { type: "FeatureCollection", features: [] };

        case "no-overlap":
            // Union needs at least two shapes (stations may still be loading)
            if (circles.length < 2) return turf.featureCollection(circles);
            return safeUnion(turf.featureCollection(circles));

        case "stations":
            // Stops are shown by the yellow stop points; no zones, no extra icons
            return { type: "FeatureCollection", features: [] };

        default:
            // A separate circle around every stop point (each direction)
            return turf.featureCollection(
                circles.flatMap((c) => {
                    const platforms: [number, number][] | undefined = (
                        c.properties.properties as any
                    ).platforms;
                    if (!platforms) return [c];
                    return platforms.map((coord) =>
                        turf.circle(coord, radius, {
                            steps: 32,
                            units,
                            properties: c.properties,
                        }),
                    );
                }),
            );
    }
}

async function selectionProcess(
    station: any,
    map: L.Map,
    stations: any[],
    showGeoJSON: (geoJSONData: any) => void,
    $questionFinishedMapData: any,
    $hidingRadius: number,
) {
    let mapData: any = turf.featureCollection([
        safeUnion(
            turf.featureCollection([
                ...$questionFinishedMapData.features,
                turf.mask(station),
            ]),
        ),
    ]);
    const before = mapData;

    for (const question of questions.get()) {
        if (planningModeEnabled.get() && question.data.drag) {
            continue;
        }
        if (question.data.hidden) continue;

        if (
            (question.id === "measuring" || question.id === "matching") &&
            (question.data.type === "zoo" ||
                question.data.type === "theme_park" ||
                question.data.type === "museum" ||
                question.data.type === "hospital" ||
                question.data.type === "cinema" ||
                question.data.type === "library" ||
                question.data.type === "golf_course" ||
                question.data.type === "consulate" ||
                question.data.type === "park")
        ) {
            const nearestQuestion = await nearestToQuestion(question.data);

            let radius = 30;

            let instances: any = { features: [] };

            const nearestPoints = [];

            while (instances.features.length === 0) {
                instances = await findTentacleLocations(
                    {
                        lat: station.properties.geometry.coordinates[1],
                        lng: station.properties.geometry.coordinates[0],
                        radius: radius,
                        unit: "miles",
                        locationType: question.data.type,
                    },
                    "Finding matching locations to hiding zone...",
                    true,
                );

                const distances: any[] = await Promise.all(
                    instances.features.map(async (x: any) => ({
                        distance: await arcDistance(
                            turf.point(turf.getCoord(x)),
                            station.properties,
                            "miles",
                        ),
                        point: x,
                    })),
                );

                if (distances.length === 0) {
                    radius += 30;
                    continue;
                }

                const minimumPoint = _.minBy(distances, "distance")!;

                if (minimumPoint.distance + $hidingRadius * 2 > radius) {
                    radius = minimumPoint.distance + $hidingRadius * 2;
                    continue;
                }

                nearestPoints.push(
                    ...distances
                        .filter(
                            (x) =>
                                x.distance <
                                    minimumPoint.distance + $hidingRadius * 2 &&
                                x.point.properties.name, // If it doesn't have a name, it's not a valid location
                        )
                        .map((x) => x.point),
                );
            }

            if (question.id === "matching") {
                const voronoi = geoSpatialVoronoi(
                    turf.featureCollection(nearestPoints),
                );

                const correctPolygon = voronoi.features.find((feature: any) => {
                    return (
                        feature.properties.site.properties.name ===
                        nearestQuestion.properties.name
                    );
                });

                if (!correctPolygon) {
                    if (question.data.same) {
                        mapData = BLANK_GEOJSON;
                    }

                    continue;
                }

                if (question.data.same) {
                    mapData = safeUnion(
                        turf.featureCollection([
                            ...mapData.features,
                            turf.mask(correctPolygon),
                        ]),
                    );
                } else {
                    mapData = safeUnion(
                        turf.featureCollection([
                            ...mapData.features,
                            correctPolygon,
                        ]),
                    );
                }
            } else {
                const circles = nearestPoints.map((x) =>
                    turf.circle(
                        turf.getCoord(x),
                        nearestQuestion.properties.distanceToPoint,
                    ),
                );

                if (question.data.hiderCloser) {
                    mapData = safeUnion(
                        turf.featureCollection([
                            ...mapData.features,
                            holedMask(turf.featureCollection(circles)),
                        ]),
                    );
                } else {
                    mapData = safeUnion(
                        turf.featureCollection([
                            ...mapData.features,
                            ...circles,
                        ]),
                    );
                }
            }
        }
        if (mapData.type !== "FeatureCollection") {
            mapData = {
                type: "FeatureCollection",
                features: [mapData],
            };
        }
    }

    if (_.isEqual(mapData, BLANK_GEOJSON)) {
        toast.warning(
            "The hider cannot be in this hiding zone. This wasn't eliminated on the sidebar as its absence was caused by multiple criteria.",
        );
    }

    // The marked zone is always drawn as its full circle: the questions' shading
    // already shows which parts of it are ruled out
    showGeoJSON(turf.featureCollection([station]));

    // Parts of the zone ruled out only here, by the home game place questions
    // (nearest museum, park, ...), get the same shading as the rest of the map
    if (mapData !== before) {
        try {
            const ruledOut = turf.difference(
                turf.featureCollection([
                    turf.intersect(
                        turf.featureCollection([safeUnion(mapData), station]),
                    )!,
                    safeUnion(before),
                ]),
            );
            if (ruledOut) {
                const extra = L.geoJSON(ruledOut, {
                    style: { className: "elimination-mask", stroke: false },
                    interactive: false,
                });
                // @ts-expect-error Removed together with the hiding zones
                extra.hidingZones = true;
                extra.addTo(map);
            }
        } catch {
            // Nothing extra ruled out
        }
    }

    const element: HTMLDivElement | null = document.querySelector(
        `[data-station-id="${station.properties.properties.id}"]`,
    );

    if (element) {
        element.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
        element.classList.add("selected-card-background-temporary");

        setTimeout(() => {
            element.classList.remove("selected-card-background-temporary");
        }, 5000);
    }
}
