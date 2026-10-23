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
    animateMapMovements,
    autoZoom,
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

import { yieldToPaint } from "./BusyIndicator";
import { getPointsRenderer, raisePlaceIcons } from "./mapPoints";
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

export const ZoneSidebar = () => {
    const $displayHidingZones = useStore(displayHidingZones);
    const $displayStopPoints = useStore(displayStopPoints);
    const $questionFinishedMapData = useStore(questionFinishedMapData);
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
    const isStationSearchActive = stationSearch.trim().length > 0;
    const setStations = trainStations.set;
    const sidebarRef = useRef<HTMLDivElement>(null);

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
            // Canvas: up to ~1100 circles are much cheaper to draw than SVG on phones
            // @ts-expect-error renderer is passed on to each vector layer
            renderer: ((map as any)._zonesRenderer ??= L.canvas({
                padding: 0.3,
            })),
            style: {
                color: "green",
                weight: 0.8,
                fillColor: "green",
                fillOpacity: 0.06,
            },
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
    const showStopPoints = (stationPlaces: StationPlace[]) => {
        if (!map) return;

        removeStopPoints();

        // Shared points canvas (see mapPoints.ts)
        const stopPointRenderer = getPointsRenderer(map);

        const selected: L.CircleMarker[] = [];
        const dots = L.layerGroup(
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

        // @ts-expect-error This is intentionally added as a check
        dots.stopPoints = true;

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

        if ($displayHidingZones && stations.length > 0) {
            // Only the stops whose hiding zones are still possible
            showStopPoints(
                stations
                    .filter(
                        (x) =>
                            !$disabledStations.includes(
                                x.properties.properties.id,
                            ),
                    )
                    .map((x) => x.properties),
            );
        } else {
            showStopPoints(
                getTransitStations(toTransitTypes($displayHidingZonesOptions))
                    .features as unknown as StationPlace[],
            );
        }
    }, [
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

    useEffect(() => {
        if (!map || isLoading.get()) return;

        const initializeHidingZones = async () => {
            isLoading.set(true);
            await yieldToPaint();

            const types = toTransitTypes($displayHidingZonesOptions);
            if (types.length === 0) {
                toast.error("At least one place type must be selected");
                isLoading.set(false);
                return;
            }

            // Built-in Tallinn stops (transport.tallinn.ee + Elron)
            const places = getTransitStations(types)
                .features as unknown as StationPlace[];

            const unionized = safeUnion(
                turf.simplify($questionFinishedMapData, {
                    tolerance: 0.001,
                }),
            );

            let circles = places
                // One zone per stop: circles around each platform, merged
                .map(
                    (place) =>
                        stationZone(
                            place as any,
                            $hidingRadius,
                            $hidingRadiusUnits,
                            place,
                        ) as unknown as StationCircle,
                )
                .filter((circle) => {
                    return !turf.booleanWithin(circle, unionized);
                });

            for (const question of questions.get()) {
                if (planningModeEnabled.get() && question.data.drag) {
                    continue;
                }
                // Hidden questions (eye button) don't filter hiding zones
                if (question.data.hidden) continue;

                if (
                    question.id === "matching" &&
                    (question.data.type === "same-first-letter-station" ||
                        question.data.type === "same-length-station" ||
                        question.data.type === "same-train-line")
                ) {
                    const location = turf.point([
                        question.data.lng,
                        question.data.lat,
                    ]);

                    const nearestTrainStation = turf.nearestPoint(
                        location,
                        turf.featureCollection(
                            circles.map((x) => x.properties),
                        ) as any,
                    );

                    if (question.data.type === "same-train-line") {
                        // Stops share a line if any of their (selected type) lines match
                        circles = circles.filter((circle) => {
                            const shared = sharesLine(
                                nearestTrainStation.properties as any,
                                circle.properties.properties as any,
                            );
                            return question.data.same ? shared : !shared;
                        });
                    }

                    const englishName = extractStationName(nearestTrainStation);

                    if (!englishName)
                        return toast.error("No English name found");

                    if (question.data.type === "same-first-letter-station") {
                        const letter = englishName[0].toUpperCase();

                        circles = circles.filter((circle) => {
                            const name = extractStationName(circle.properties);
                            if (!name) return false;

                            return question.data.same
                                ? name[0].toUpperCase() === letter
                                : name[0].toUpperCase() !== letter;
                        });
                    } else if (question.data.type === "same-length-station") {
                        const seekerLength = englishName.length;
                        const comparison = question.data.lengthComparison;

                        circles = circles.filter((circle) => {
                            const name = extractStationName(circle.properties);
                            if (!name) return false;

                            if (comparison === "same") {
                                return name.length === seekerLength;
                            } else if (comparison === "shorter") {
                                return name.length < seekerLength;
                            } else if (comparison === "longer") {
                                return name.length > seekerLength;
                            }
                            return false;
                        });
                    }
                }
                if (
                    question.id === "measuring" &&
                    question.data.type === "mcdonalds"
                ) {
                    const points = toPoints(getTallinnPlaces("mcdonalds"));

                    const nearestPoint = turf.nearestPoint(
                        turf.point([question.data.lng, question.data.lat]),
                        points as any,
                    );

                    const distance = await arcDistance(
                        turf.point([question.data.lng, question.data.lat]),
                        nearestPoint as any,
                        "miles",
                    );

                    const eligibleCircles = await Promise.all(
                        circles.map(async (circle) => {
                            const point = turf.point(
                                turf.getCoord(circle.properties),
                            );
                            const nearest = turf.nearestPoint(
                                point,
                                points as any,
                            );
                            const stationDistance = await arcDistance(
                                point,
                                nearest as any,
                                "miles",
                            );

                            return question.data.hiderCloser
                                ? stationDistance < distance + $hidingRadius
                                : stationDistance > distance - $hidingRadius;
                        }),
                    );
                    circles = circles.filter(
                        (_, index) => eligibleCircles[index],
                    );
                }
            }

            setStations(circles);
            isLoading.set(false);
        };

        if ($displayHidingZones && $questionFinishedMapData) {
            initializeHidingZones().catch((error) => {
                console.log("Error in hiding zone initialization:", error);
                toast.error(
                    "An error occurred during hiding zone initialization",
                    { toastId: "hiding-zone-initialization-error" },
                );
            });
        }
    }, [
        $questionFinishedMapData,
        $displayHidingZones,
        $displayHidingZonesOptions,
        $hidingRadius,
    ]);

    useEffect(() => {
        if (!map || isLoading.get()) return;

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
                                                    {extractStationLabel(
                                                        station.properties,
                                                    )}
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
    const bbox = turf.bbox(station);

    const bounds: [[number, number], [number, number]] = [
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]],
    ];

    let mapData: any = turf.featureCollection([
        safeUnion(
            turf.featureCollection([
                ...$questionFinishedMapData.features,
                turf.mask(station),
            ]),
        ),
    ]);

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
        if (
            question.id === "measuring" &&
            question.data.type === "rail-measure"
        ) {
            const location = turf.point([question.data.lng, question.data.lat]);

            const nearestTrainStation = turf.nearestPoint(
                location,
                turf.featureCollection(
                    stations.map((x) => x.properties.geometry),
                ),
            );

            const distance = await arcDistance(location, nearestTrainStation);

            const nearbyStations = await Promise.all(
                stations.map(
                    async (x) =>
                        (await arcDistance(
                            station.properties.geometry,
                            x.properties.geometry,
                        )) <
                        distance + 1.61 * $hidingRadius,
                ),
            );
            const circles = stations
                .filter((_, index) => nearbyStations[index])
                .map((x) => turf.circle(x.properties.geometry, distance));

            if (question.data.hiderCloser) {
                mapData = safeUnion(
                    turf.featureCollection([
                        ...mapData.features,
                        holedMask(turf.featureCollection(circles)),
                    ]),
                );
            } else {
                mapData = safeUnion(
                    turf.featureCollection([...mapData.features, ...circles]),
                );
            }
        }
        if (question.id === "measuring" && question.data.type === "mcdonalds") {
            const points = toPoints(getTallinnPlaces("mcdonalds"));

            const seeker = turf.point([question.data.lng, question.data.lat]);
            const nearest = turf.nearestPoint(seeker, points as any);

            const distance = await arcDistance(seeker, nearest, "miles");

            const nearStation = await Promise.all(
                points.features.map(
                    async (x) =>
                        (await arcDistance(
                            x as any,
                            station.properties.geometry,
                            "miles",
                        )) <
                        distance + $hidingRadius,
                ),
            );
            const filtered = points.features.filter(
                (_, index) => nearStation[index],
            );

            const circles = filtered.map((x) =>
                turf.circle(x as any, distance, {
                    units: "miles",
                }),
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
                    turf.featureCollection([...mapData.features, ...circles]),
                );
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

    showGeoJSON(mapData);

    if (autoZoom.get()) {
        if (animateMapMovements.get()) {
            map?.flyToBounds(bounds);
        } else {
            map?.fitBounds(bounds);
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
