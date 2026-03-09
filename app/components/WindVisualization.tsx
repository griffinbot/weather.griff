import {
  ArrowUp,
  Gauge,
  Loader2,
  MapPin,
  Pause,
  Play,
  Radar,
  Route,
  Wind,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  useWindAloft,
  type PressureLevelRow,
  type WindAloftHour,
} from "../hooks/useWindAloft";
import {
  latLonToLocalNm,
  localNmToLatLon,
  simulateBalloonTrajectory,
  type SpeedBands,
  type TrajectoryBand,
  type TrajectoryPath,
} from "../lib/balloonTrajectory";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface WindVisualizationProps {
  location: Location;
}

interface TileBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface MapTile {
  key: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const HORIZONS_MIN = [30, 60, 90, 180];
const PROFILE_ALTITUDES = [1000, 2000, 3000, 5000, 8000, 10000, 14000, 18000];
const PLAYBACK_INTERVAL_MS = 1500;
const FLOW_TICK_INTERVAL_MS = 120;
const FLOW_COLUMNS = 8;
const FLOW_ROWS = 8;

function mphToKnots(valueMph: number): number {
  return Math.round(valueMph * 0.868976);
}

function nearestLevelByMsl(
  hour: WindAloftHour | null,
  targetMslFt: number,
): PressureLevelRow | null {
  if (!hour || hour.levels.length === 0) return null;
  return hour.levels.reduce((closest, current) => {
    const currentDistance = Math.abs(current.altitudeMSL_ft - targetMslFt);
    const closestDistance = Math.abs(closest.altitudeMSL_ft - targetMslFt);
    return currentDistance < closestDistance ? current : closest;
  }, hour.levels[0]);
}

function formatForecastTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatForecastLabel(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getDirectionName(degrees: number): string {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return directions[Math.round(degrees / 22.5) % 16];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function formatSpeedRange(minKt: number, maxKt: number): string {
  if (Math.abs(minKt - maxKt) < 0.1) return `${Math.round(minKt)} kt`;
  return `${Math.round(minKt)}-${Math.round(maxKt)} kt`;
}

function formatDistanceNm(distanceNm: number): string {
  return `${distanceNm.toFixed(distanceNm >= 10 ? 0 : 1)} NM`;
}

function formatBearing(degrees: number): string {
  return `${Math.round(degrees)}° ${getDirectionName(degrees)}`;
}

function formatCoordinate(
  value: number,
  positiveLabel: string,
  negativeLabel: string,
): string {
  const suffix = value >= 0 ? positiveLabel : negativeLabel;
  return `${Math.abs(value).toFixed(3)}° ${suffix}`;
}

function latToMercatorYNormalized(latDeg: number): number {
  const lat = clamp(latDeg, -85, 85);
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function mercatorYNormalizedToLat(mercY: number): number {
  const y = clamp(mercY, 0, 1);
  const n = Math.PI * (1 - 2 * y);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function lonToTileX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat: number, zoom: number): number {
  return latToMercatorYNormalized(lat) * 2 ** zoom;
}

function tileXToLon(tileX: number, zoom: number): number {
  return (tileX / 2 ** zoom) * 360 - 180;
}

function tileYToLat(tileY: number, zoom: number): number {
  return mercatorYNormalizedToLat(tileY / 2 ** zoom);
}

function wrapTileX(tileX: number, zoom: number): number {
  const tileCount = 2 ** zoom;
  return ((tileX % tileCount) + tileCount) % tileCount;
}

function pickTileZoom(bounds: TileBounds): number {
  const lonSpan = Math.max(0.01, Math.abs(bounds.east - bounds.west));
  const mercNorth = latToMercatorYNormalized(bounds.north);
  const mercSouth = latToMercatorYNormalized(bounds.south);
  const mercSpan = Math.max(0.0001, Math.abs(mercSouth - mercNorth));
  const targetPixels = 1200;
  const zoomLon = Math.log2((targetPixels * 360) / (256 * lonSpan));
  const zoomLat = Math.log2(targetPixels / (256 * mercSpan));
  return Math.max(3, Math.min(14, Math.floor(Math.min(zoomLon, zoomLat))));
}

export function WindVisualization({ location }: WindVisualizationProps) {
  const [selectedAltitude, setSelectedAltitude] = useState(5000);
  const [selectedHour, setSelectedHour] = useState(0);
  const [startLat, setStartLat] = useState(location.lat);
  const [startLon, setStartLon] = useState(location.lon);
  const [startLatInput, setStartLatInput] = useState(location.lat.toFixed(4));
  const [startLonInput, setStartLonInput] = useState(location.lon.toFixed(4));
  const [inputError, setInputError] = useState<string | null>(null);
  const [tileLoadError, setTileLoadError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [flowTick, setFlowTick] = useState(0);

  const plotRef = useRef<SVGSVGElement | null>(null);
  const { hours, loading, error } = useWindAloft(location.lat, location.lon);

  const hourMax = Math.max(0, hours.length - 1);

  useEffect(() => {
    if (selectedHour > hourMax) setSelectedHour(hourMax);
  }, [hourMax, selectedHour]);

  useEffect(() => {
    if (hourMax === 0) setIsPlaying(false);
  }, [hourMax]);

  useEffect(() => {
    if (!isPlaying || hourMax === 0) return;
    const interval = window.setInterval(() => {
      setSelectedHour((currentHour) =>
        currentHour >= hourMax ? 0 : currentHour + 1,
      );
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [hourMax, isPlaying]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setFlowTick((currentTick) => (currentTick + 1) % 48);
    }, FLOW_TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setStartLat(location.lat);
    setStartLon(location.lon);
    setStartLatInput(location.lat.toFixed(4));
    setStartLonInput(location.lon.toFixed(4));
    setInputError(null);
  }, [location.lat, location.lon]);

  const currentHour = hours[selectedHour] ?? null;
  const timeDisplay = currentHour
    ? formatForecastTime(currentHour.time)
    : "Loading...";
  const timeLabel = currentHour
    ? formatForecastLabel(currentHour.time)
    : "Forecast loading";

  const selectedLevel = useMemo(
    () => nearestLevelByMsl(currentHour, selectedAltitude),
    [currentHour, selectedAltitude],
  );

  const selectedWind = useMemo(() => {
    if (!selectedLevel) {
      return { speedKt: 0, direction: 0, sampledAltitudeFt: selectedAltitude };
    }
    return {
      speedKt: mphToKnots(selectedLevel.windSpeed_mph),
      direction: selectedLevel.windDirection,
      sampledAltitudeFt: selectedLevel.altitudeMSL_ft,
    };
  }, [selectedAltitude, selectedLevel]);

  const trajectory = useMemo(() => {
    if (!currentHour || hours.length === 0) return null;
    return simulateBalloonTrajectory({
      startLat,
      startLon,
      selectedAltitudeFtMsl: selectedAltitude,
      startTime: currentHour.time,
      horizonsMin: HORIZONS_MIN,
      hours,
      stepMinutes: 1,
    });
  }, [currentHour, hours, selectedAltitude, startLat, startLon]);

  const pathLookup = useMemo(() => {
    const map = new Map<string, TrajectoryPath>();
    for (const path of trajectory?.paths ?? []) {
      map.set(`${path.horizonMin}:${path.band}:${path.side}`, path);
    }
    return map;
  }, [trajectory]);

  const baselineEndpoints = useMemo(() => {
    return (trajectory?.endpoints ?? [])
      .filter(
        (endpoint) =>
          endpoint.band === "baseline" && endpoint.side === "center",
      )
      .sort((a, b) => a.horizonMin - b.horizonMin);
  }, [trajectory]);

  const strongestEndpoint = baselineEndpoints.reduce<
    (typeof baselineEndpoints)[number] | null
  >((strongest, endpoint) => {
    if (!strongest) return endpoint;
    return endpoint.avgGroundspeedKt > strongest.avgGroundspeedKt
      ? endpoint
      : strongest;
  }, null);

  const pathsForExtent = useMemo(() => {
    if (!trajectory) return [] as Array<{ eastNm: number; northNm: number }>;
    const points: Array<{ eastNm: number; northNm: number }> = [];
    points.push({ eastNm: 0, northNm: 0 });
    points.push(latLonToLocalNm(startLat, startLon, location.lat, location.lon));

    for (const path of trajectory.paths) {
      if (path.band !== "high") continue;
      for (const point of path.points) {
        points.push(
          latLonToLocalNm(point.lat, point.lon, location.lat, location.lon),
        );
      }
    }

    for (const endpoint of baselineEndpoints) {
      points.push(
        latLonToLocalNm(endpoint.lat, endpoint.lon, location.lat, location.lon),
      );
    }

    return points;
  }, [trajectory, startLat, startLon, location.lat, location.lon, baselineEndpoints]);

  const extentNm = useMemo(() => {
    if (pathsForExtent.length === 0) return 20;
    const maxAbs = pathsForExtent.reduce((maxValue, point) => {
      return Math.max(
        maxValue,
        Math.abs(point.eastNm),
        Math.abs(point.northNm),
      );
    }, 0);
    return clamp(roundToStep(Math.max(15, maxAbs * 1.25), 5), 15, 90);
  }, [pathsForExtent]);

  const gridTicks = useMemo(() => {
    const half = extentNm / 2;
    return [-extentNm, -half, 0, half, extentNm];
  }, [extentNm]);

  const ringRadii = useMemo(() => {
    const step = extentNm <= 25 ? 5 : 10;
    const values: number[] = [];
    for (let radius = step; radius < extentNm; radius += step) {
      values.push(radius);
    }
    return values.slice(0, 6);
  }, [extentNm]);

  const mapBounds = useMemo(() => {
    const pad = extentNm * 1.12;
    const nw = localNmToLatLon(-pad, pad, location.lat, location.lon);
    const ne = localNmToLatLon(pad, pad, location.lat, location.lon);
    const sw = localNmToLatLon(-pad, -pad, location.lat, location.lon);
    const se = localNmToLatLon(pad, -pad, location.lat, location.lon);

    const north = clamp(Math.max(nw.lat, ne.lat, sw.lat, se.lat), -85, 85);
    const south = clamp(Math.min(nw.lat, ne.lat, sw.lat, se.lat), -85, 85);
    const east = clamp(Math.max(nw.lon, ne.lon, sw.lon, se.lon), -180, 180);
    const west = clamp(Math.min(nw.lon, ne.lon, sw.lon, se.lon), -180, 180);

    return { north, south, east, west };
  }, [extentNm, location.lat, location.lon]);

  const speedBands: SpeedBands = trajectory?.speedBands ?? {
    minKt: 0,
    maxKt: 0,
    lowMaxKt: 0,
    medMaxKt: 0,
    highMinKt: 0,
  };

  const getPlotPointFromLatLon = (lat: number, lon: number) => {
    const x =
      ((lon - mapBounds.west) / (mapBounds.east - mapBounds.west || 1e-6)) * 100;
    const topMerc = latToMercatorYNormalized(mapBounds.north);
    const bottomMerc = latToMercatorYNormalized(mapBounds.south);
    const valueMerc = latToMercatorYNormalized(lat);
    const y =
      ((valueMerc - topMerc) / (bottomMerc - topMerc || 1e-6)) * 100;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  };

  const getPlotPoint = (eastNm: number, northNm: number) => {
    const latLon = localNmToLatLon(eastNm, northNm, location.lat, location.lon);
    return getPlotPointFromLatLon(latLon.lat, latLon.lon);
  };

  const startMarker = getPlotPointFromLatLon(startLat, startLon);
  const centerMarker = getPlotPointFromLatLon(location.lat, location.lon);

  const rangeRings = useMemo(() => {
    return ringRadii.map((radiusNm) => {
      const points: string[] = [];
      for (let degrees = 0; degrees <= 360; degrees += 15) {
        const radians = (degrees * Math.PI) / 180;
        const pointLatLon = localNmToLatLon(
          Math.sin(radians) * radiusNm,
          Math.cos(radians) * radiusNm,
          startLat,
          startLon,
        );
        const plot = getPlotPointFromLatLon(pointLatLon.lat, pointLatLon.lon);
        points.push(`${plot.x},${plot.y}`);
      }

      const labelLatLon = localNmToLatLon(0, radiusNm, startLat, startLon);
      const labelPoint = getPlotPointFromLatLon(labelLatLon.lat, labelLatLon.lon);

      return {
        radiusNm,
        points: points.join(" "),
        labelPoint,
      };
    });
  }, [ringRadii, startLat, startLon, mapBounds]);

  const mapTiles = useMemo(() => {
    const zoom = pickTileZoom(mapBounds);
    const minTileX = Math.floor(lonToTileX(mapBounds.west, zoom));
    const maxTileX = Math.floor(lonToTileX(mapBounds.east, zoom));
    const minTileY = Math.floor(latToTileY(mapBounds.north, zoom));
    const maxTileY = Math.floor(latToTileY(mapBounds.south, zoom));
    const maxY = Math.max(0, 2 ** zoom - 1);
    const tiles: MapTile[] = [];

    for (
      let tileY = Math.max(0, minTileY);
      tileY <= Math.min(maxY, maxTileY);
      tileY++
    ) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        const westLon = tileXToLon(tileX, zoom);
        const eastLon = tileXToLon(tileX + 1, zoom);
        const northLat = tileYToLat(tileY, zoom);
        const southLat = tileYToLat(tileY + 1, zoom);
        const topLeft = getPlotPointFromLatLon(northLat, westLon);
        const bottomRight = getPlotPointFromLatLon(southLat, eastLon);
        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;
        if (width <= 0 || height <= 0) continue;

        tiles.push({
          key: `${zoom}-${tileX}-${tileY}`,
          url: `https://tile.openstreetmap.org/${zoom}/${wrapTileX(
            tileX,
            zoom,
          )}/${tileY}.png`,
          x: topLeft.x,
          y: topLeft.y,
          width,
          height,
        });
      }
    }

    return tiles;
  }, [mapBounds]);

  useEffect(() => {
    setTileLoadError(false);
  }, [mapBounds]);

  const getPath = (
    horizonMin: number,
    band: TrajectoryBand,
    side: "left" | "center" | "right",
  ) => {
    return pathLookup.get(`${horizonMin}:${band}:${side}`);
  };

  const windVectors = useMemo(() => {
    const vectors: Array<{
      x: number;
      y: number;
      angle: number;
      speedKt: number;
      length: number;
      key: string;
    }> = [];

    const baseDirection = selectedLevel?.windDirection ?? 300;
    const baseSpeed = selectedLevel ? mphToKnots(selectedLevel.windSpeed_mph) : 12;

    for (let rowIndex = 0; rowIndex < FLOW_ROWS; rowIndex++) {
      for (let columnIndex = 0; columnIndex < FLOW_COLUMNS; columnIndex++) {
        const eastNm =
          ((columnIndex + 0.5) / FLOW_COLUMNS - 0.5) * extentNm * 1.65;
        const northNm =
          (0.5 - (rowIndex + 0.5) / FLOW_ROWS) * extentNm * 1.65;
        const latLon = localNmToLatLon(eastNm, northNm, startLat, startLon);
        const plot = getPlotPointFromLatLon(latLon.lat, latLon.lon);
        const waveDirection =
          Math.sin((columnIndex + selectedHour) * 0.65) * 7 +
          Math.cos((rowIndex + selectedAltitude / 1000) * 0.55) * 5;
        const waveSpeed =
          Math.cos((columnIndex + rowIndex + selectedHour) * 0.55) * 3.2;
        const angle = (baseDirection + waveDirection + 360) % 360;
        const speedKt = Math.max(0, baseSpeed + waveSpeed);
        const length = 1.4 + Math.max(0, speedKt) * 0.1;

        vectors.push({
          x: plot.x,
          y: plot.y,
          angle,
          speedKt,
          length,
          key: `${columnIndex}-${rowIndex}`,
        });
      }
    }

    return vectors;
  }, [
    extentNm,
    selectedAltitude,
    selectedHour,
    selectedLevel,
    startLat,
    startLon,
    mapBounds,
  ]);

  const flowParticles = useMemo(() => {
    const phase = flowTick / 48;
    return windVectors.flatMap((vector, index) => {
      const radians = ((vector.angle - 90) * Math.PI) / 180;
      const progressA = (phase + index * 0.037) % 1;
      const progressB = (phase + 0.45 + index * 0.017) % 1;
      const trail = [progressA, progressB];

      return trail.map((progress, particleIndex) => {
        const offset = (progress - 0.5) * vector.length * 1.9;
        return {
          key: `${vector.key}-${particleIndex}`,
          x: vector.x + Math.cos(radians) * offset,
          y: vector.y + Math.sin(radians) * offset,
          radius: particleIndex === 0 ? 0.5 : 0.34,
          opacity: particleIndex === 0 ? 0.85 : 0.45,
          speedKt: vector.speedKt,
        };
      });
    });
  }, [flowTick, windVectors]);

  const getSpeedColor = (speedKt: number) => {
    if (speedKt <= speedBands.lowMaxKt) return "#2dd4bf";
    if (speedKt <= speedBands.medMaxKt) return "#f59e0b";
    return "#f43f5e";
  };

  const bandFillColor = (band: "low" | "medium" | "high") => {
    if (band === "low") return "rgba(45,212,191,0.14)";
    if (band === "medium") return "rgba(245,158,11,0.14)";
    return "rgba(244,63,94,0.14)";
  };

  const horizonStroke = (horizon: number) => {
    if (horizon <= 30) return "#38bdf8";
    if (horizon <= 60) return "#0ea5e9";
    if (horizon <= 90) return "#0284c7";
    return "#0369a1";
  };

  const limitedByForecast = baselineEndpoints.some(
    (endpoint) => endpoint.limitedByForecast,
  );
  const labelOffsets: Record<number, { dx: number; dy: number }> = {
    30: { dx: 1.2, dy: -1.3 },
    60: { dx: 1.2, dy: 1.8 },
    90: { dx: -8.4, dy: -1.3 },
    180: { dx: -9.5, dy: 1.8 },
  };

  const getProfileForAltitude = (altitudeMslFt: number) => {
    const nearest = nearestLevelByMsl(currentHour, altitudeMslFt);
    if (!nearest) {
      return { speedKt: 0, direction: 0 };
    }
    return {
      speedKt: mphToKnots(nearest.windSpeed_mph),
      direction: nearest.windDirection,
    };
  };

  const launchOffset = latLonToLocalNm(startLat, startLon, location.lat, location.lon);
  const launchDistanceNm = Math.sqrt(
    launchOffset.eastNm ** 2 + launchOffset.northNm ** 2,
  );
  const launchBearing = Math.atan2(launchOffset.eastNm, launchOffset.northNm);
  const launchBearingDeg =
    ((launchBearing * 180) / Math.PI + 360) % 360;

  const handleSetStartFromInputs = () => {
    const parsedLat = Number.parseFloat(startLatInput);
    const parsedLon = Number.parseFloat(startLonInput);

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
      setInputError("Enter valid numeric latitude and longitude.");
      return;
    }
    if (parsedLat < -90 || parsedLat > 90) {
      setInputError("Latitude must be between -90 and 90.");
      return;
    }
    if (parsedLon < -180 || parsedLon > 180) {
      setInputError("Longitude must be between -180 and 180.");
      return;
    }

    setInputError(null);
    setStartLat(parsedLat);
    setStartLon(parsedLon);
    setStartLatInput(parsedLat.toFixed(4));
    setStartLonInput(parsedLon.toFixed(4));
  };

  const handleUseSelectedLocation = () => {
    setInputError(null);
    setStartLat(location.lat);
    setStartLon(location.lon);
    setStartLatInput(location.lat.toFixed(4));
    setStartLonInput(location.lon.toFixed(4));
  };

  const handlePlotTap = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const xPct = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const yPct = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const lon = mapBounds.west + xPct * (mapBounds.east - mapBounds.west);
    const topMerc = latToMercatorYNormalized(mapBounds.north);
    const bottomMerc = latToMercatorYNormalized(mapBounds.south);
    const targetMerc = topMerc + yPct * (bottomMerc - topMerc);
    const lat = mercatorYNormalizedToLat(targetMerc);

    setInputError(null);
    setStartLat(lat);
    setStartLon(lon);
    setStartLatInput(lat.toFixed(4));
    setStartLonInput(lon.toFixed(4));
  };

  const mapOverlayTitle = selectedLevel
    ? `${selectedWind.speedKt} kt from ${formatBearing(selectedWind.direction)}`
    : "Waiting for sampled wind layer";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.22),_transparent_38%),linear-gradient(135deg,_#06131c_0%,_#0f2740_50%,_#15314f_100%)] p-6 text-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100">
              <Radar className="h-3.5 w-3.5" />
              Wind deck
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Animated winds aloft for {location.name}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-sky-50/80 sm:text-base">
                Scrub or play the forecast, shift launch position on the map,
                and compare wind speed, direction, and drift reach at multiple
                altitudes.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-sky-100/75">
                Selected layer
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {selectedAltitude.toLocaleString()} ft
              </div>
              <div className="mt-1 text-sm text-sky-50/80">
                {mapOverlayTitle}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-sky-100/75">
                Forecast frame
              </div>
              <div className="mt-2 text-2xl font-semibold">{timeDisplay}</div>
              <div className="mt-1 text-sm text-sky-50/80">{timeLabel}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-sky-100/75">
                Max drift horizon
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {strongestEndpoint
                  ? formatDistanceNm(strongestEndpoint.distanceNm)
                  : "0 NM"}
              </div>
              <div className="mt-1 text-sm text-sky-50/80">
                {strongestEndpoint
                  ? `${strongestEndpoint.horizonMin} min at ${strongestEndpoint.avgGroundspeedKt.toFixed(1)} kt`
                  : "Waiting for trajectory"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Altitude focus
                </div>
                <div className="text-xs text-slate-500">
                  Quick-select layers, then fine-tune with the slider.
                </div>
              </div>
              <Gauge className="h-5 w-5 text-sky-600" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PROFILE_ALTITUDES.map((altitude) => {
                const { speedKt, direction } = getProfileForAltitude(altitude);
                const active = altitude === selectedAltitude;
                return (
                  <button
                    key={altitude}
                    type="button"
                    onClick={() => setSelectedAltitude(altitude)}
                    className={`rounded-2xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-sky-500 bg-sky-50 shadow-sm"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {altitude.toLocaleString()} ft
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      <ArrowUp
                        className="h-3.5 w-3.5 text-sky-600"
                        style={{ transform: `rotate(${direction}deg)` }}
                      />
                      {speedKt} kt
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Altitude</span>
                <span className="font-semibold text-slate-900">
                  {selectedAltitude.toLocaleString()} ft MSL
                </span>
              </div>
              <Slider
                value={[selectedAltitude]}
                onValueChange={(values) => setSelectedAltitude(values[0])}
                min={1000}
                max={18000}
                step={1000}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>1,000 ft</span>
                <span>18,000 ft</span>
              </div>
              {selectedLevel && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  Sampled level: {selectedLevel.altitudeMSL_ft.toLocaleString()} ft
                  MSL / {selectedLevel.altitudeAGL_ft.toLocaleString()} ft AGL
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Forecast playback
                </div>
                <div className="text-xs text-slate-500">
                  Animate the next few forecast frames.
                </div>
              </div>
              <Wind className="h-5 w-5 text-sky-600" />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Start time
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {timeDisplay}
                  </div>
                  <div className="text-xs text-slate-500">{timeLabel}</div>
                </div>
                <Button
                  type="button"
                  variant={isPlaying ? "secondary" : "default"}
                  size="sm"
                  onClick={() => setIsPlaying((currentValue) => !currentValue)}
                  disabled={hourMax === 0}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="h-4 w-4" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Play
                    </>
                  )}
                </Button>
              </div>

              <Slider
                value={[selectedHour]}
                onValueChange={(values) => setSelectedHour(values[0])}
                min={0}
                max={hourMax}
                step={1}
                className="w-full"
                disabled={hourMax === 0}
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>Earliest frame</span>
                <span>Latest frame</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Launch point
                </div>
                <div className="text-xs text-slate-500">
                  Tap the map or enter coordinates directly.
                </div>
              </div>
              <MapPin className="h-5 w-5 text-emerald-600" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Latitude
                </label>
                <Input
                  value={startLatInput}
                  onChange={(event) => setStartLatInput(event.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Longitude
                </label>
                <Input
                  value={startLonInput}
                  onChange={(event) => setStartLonInput(event.target.value)}
                />
              </div>
            </div>

            {inputError && (
              <p className="mt-2 text-xs text-rose-600">{inputError}</p>
            )}

            <div className="mt-3 flex gap-2">
              <Button type="button" onClick={handleSetStartFromInputs} className="flex-1">
                Set launch point
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleUseSelectedLocation}
              >
                Reset
              </Button>
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-medium">
                {formatCoordinate(startLat, "N", "S")},{" "}
                {formatCoordinate(startLon, "E", "W")}
              </div>
              <div className="mt-1 text-xs text-emerald-800/80">
                {launchDistanceNm < 0.25
                  ? "Launch pinned to the selected location."
                  : `${formatDistanceNm(launchDistanceNm)} from ${location.airport || location.name} on ${formatBearing(launchBearingDeg)}.`}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Wind overlay and drift envelope
                  </h3>
                  <p className="text-sm text-slate-500">
                    {selectedAltitude.toLocaleString()} ft MSL, launched at{" "}
                    {timeDisplay}. Distance rings are centered on the launch
                    point.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Wind at layer
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {selectedWind.speedKt} kt
                    </div>
                    <div className="text-xs text-slate-500">
                      From {formatBearing(selectedWind.direction)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Envelope
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {formatSpeedRange(speedBands.minKt, speedBands.maxKt)}
                    </div>
                    <div className="text-xs text-slate-500">
                      Dynamic speed scale
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Range window
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {extentNm} NM
                    </div>
                    <div className="text-xs text-slate-500">
                      Half-width from map center
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative aspect-[1.08/1] bg-slate-950">
              {loading && hours.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-slate-100">
                  <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
                  <span className="text-sm">Loading wind trajectory data…</span>
                </div>
              ) : error && !trajectory ? (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-rose-300">
                  {error}
                </div>
              ) : (
                <svg
                  ref={plotRef}
                  className="h-full w-full cursor-crosshair"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  onClick={handlePlotTap}
                >
                  <rect
                    x={0}
                    y={0}
                    width={100}
                    height={100}
                    fill="#020617"
                  />
                  {mapTiles.map((tile) => (
                    <image
                      key={tile.key}
                      href={tile.url}
                      x={tile.x}
                      y={tile.y}
                      width={tile.width}
                      height={tile.height}
                      preserveAspectRatio="none"
                      onError={() => setTileLoadError(true)}
                    />
                  ))}
                  <rect
                    x={0}
                    y={0}
                    width={100}
                    height={100}
                    fill="rgba(2,6,23,0.46)"
                  />
                  <rect
                    x={0}
                    y={0}
                    width={100}
                    height={100}
                    fill="url(#windFade)"
                    opacity={0.55}
                  />
                  <defs>
                    <linearGradient id="windFade" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.32" />
                      <stop offset="55%" stopColor="#0f172a" stopOpacity="0.04" />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity="0.18" />
                    </linearGradient>
                  </defs>

                  {gridTicks.map((tick, index) => {
                    const pointX = getPlotPoint(tick, 0).x;
                    const pointY = getPlotPoint(0, tick).y;
                    return (
                      <g key={`grid-${index}`}>
                        <line
                          x1={pointX}
                          y1={0}
                          x2={pointX}
                          y2={100}
                          stroke="#cbd5e1"
                          strokeWidth={0.16}
                          opacity={0.18}
                        />
                        <line
                          x1={0}
                          y1={pointY}
                          x2={100}
                          y2={pointY}
                          stroke="#cbd5e1"
                          strokeWidth={0.16}
                          opacity={0.18}
                        />
                      </g>
                    );
                  })}

                  {rangeRings.map((ring) => (
                    <g key={`ring-${ring.radiusNm}`}>
                      <polygon
                        points={ring.points}
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth={0.18}
                        opacity={0.26}
                        strokeDasharray="0.8 0.9"
                      />
                      <text
                        x={ring.labelPoint.x + 0.8}
                        y={ring.labelPoint.y - 0.5}
                        fontSize="2.1"
                        fill="#e2e8f0"
                        opacity={0.7}
                      >
                        {ring.radiusNm} NM
                      </text>
                    </g>
                  ))}

                  {Math.abs(centerMarker.x - startMarker.x) > 0.5 ||
                  Math.abs(centerMarker.y - startMarker.y) > 0.5 ? (
                    <line
                      x1={centerMarker.x}
                      y1={centerMarker.y}
                      x2={startMarker.x}
                      y2={startMarker.y}
                      stroke="#a7f3d0"
                      strokeWidth={0.34}
                      strokeDasharray="1.2 0.9"
                      opacity={0.85}
                    />
                  ) : null}

                  {HORIZONS_MIN.map((horizon) =>
                    (["high", "medium", "low"] as const).map((band) => {
                      const left = getPath(horizon, band, "left");
                      const right = getPath(horizon, band, "right");
                      if (
                        !left ||
                        !right ||
                        left.points.length < 2 ||
                        right.points.length < 2
                      ) {
                        return null;
                      }

                      const leftPoints = left.points.map((point) => {
                        const local = latLonToLocalNm(
                          point.lat,
                          point.lon,
                          location.lat,
                          location.lon,
                        );
                        const plot = getPlotPoint(local.eastNm, local.northNm);
                        return `${plot.x},${plot.y}`;
                      });
                      const rightPoints = [...right.points]
                        .reverse()
                        .map((point) => {
                          const local = latLonToLocalNm(
                            point.lat,
                            point.lon,
                            location.lat,
                            location.lon,
                          );
                          const plot = getPlotPoint(
                            local.eastNm,
                            local.northNm,
                          );
                          return `${plot.x},${plot.y}`;
                        });

                      return (
                        <polygon
                          key={`band-${band}-${horizon}`}
                          points={[...leftPoints, ...rightPoints].join(" ")}
                          fill={bandFillColor(band)}
                          stroke="none"
                        />
                      );
                    }),
                  )}

                  {windVectors.map((vector) => {
                    const radians = ((vector.angle - 90) * Math.PI) / 180;
                    const endX = vector.x + Math.cos(radians) * vector.length;
                    const endY = vector.y + Math.sin(radians) * vector.length;
                    const arrowLength = 0.85 + vector.length * 0.24;
                    const arrowAngle = 25 * (Math.PI / 180);
                    const angle1 = radians + Math.PI - arrowAngle;
                    const angle2 = radians + Math.PI + arrowAngle;
                    const arrowX1 = endX + Math.cos(angle1) * arrowLength;
                    const arrowY1 = endY + Math.sin(angle1) * arrowLength;
                    const arrowX2 = endX + Math.cos(angle2) * arrowLength;
                    const arrowY2 = endY + Math.sin(angle2) * arrowLength;
                    const color = getSpeedColor(vector.speedKt);
                    return (
                      <g key={`vec-${vector.key}`} opacity={0.58}>
                        <line
                          x1={vector.x}
                          y1={vector.y}
                          x2={endX}
                          y2={endY}
                          stroke={color}
                          strokeWidth={0.42}
                          strokeLinecap="round"
                        />
                        <polygon
                          points={`${endX},${endY} ${arrowX1},${arrowY1} ${arrowX2},${arrowY2}`}
                          fill={color}
                        />
                      </g>
                    );
                  })}

                  {flowParticles.map((particle) => (
                    <circle
                      key={particle.key}
                      cx={particle.x}
                      cy={particle.y}
                      r={particle.radius}
                      fill={getSpeedColor(particle.speedKt)}
                      opacity={particle.opacity}
                    />
                  ))}

                  {HORIZONS_MIN.map((horizon) => {
                    const path = getPath(horizon, "baseline", "center");
                    if (!path || path.points.length < 2) return null;
                    const points = path.points.map((point) => {
                      const local = latLonToLocalNm(
                        point.lat,
                        point.lon,
                        location.lat,
                        location.lon,
                      );
                      const plot = getPlotPoint(local.eastNm, local.northNm);
                      return `${plot.x},${plot.y}`;
                    });

                    return (
                      <polyline
                        key={`center-${horizon}`}
                        points={points.join(" ")}
                        fill="none"
                        stroke={horizonStroke(horizon)}
                        strokeWidth={0.72}
                        strokeLinecap="round"
                      />
                    );
                  })}

                  <circle
                    cx={centerMarker.x}
                    cy={centerMarker.y}
                    r={1.05}
                    fill="#f8fafc"
                    opacity={0.95}
                  />
                  <circle
                    cx={startMarker.x}
                    cy={startMarker.y}
                    r={1.28}
                    fill="#22c55e"
                    stroke="#f8fafc"
                    strokeWidth={0.3}
                  />
                  <circle
                    cx={startMarker.x}
                    cy={startMarker.y}
                    r={2.1}
                    fill="none"
                    stroke="#86efac"
                    strokeWidth={0.2}
                    opacity={0.9}
                  />

                  {baselineEndpoints.map((endpoint) => {
                    const plot = getPlotPointFromLatLon(endpoint.lat, endpoint.lon);
                    const offset = labelOffsets[endpoint.horizonMin] ?? {
                      dx: 1.5,
                      dy: -1.5,
                    };
                    return (
                      <g key={`endpoint-${endpoint.horizonMin}`}>
                        <circle
                          cx={plot.x}
                          cy={plot.y}
                          r={1.02}
                          fill={horizonStroke(endpoint.horizonMin)}
                          stroke="#e0f2fe"
                          strokeWidth={0.26}
                        />
                        <text
                          x={plot.x + offset.dx}
                          y={plot.y + offset.dy}
                          fontSize="2.5"
                          fill="#e2e8f0"
                          fontWeight={700}
                        >
                          {endpoint.horizonMin}m
                        </text>
                      </g>
                    );
                  })}

                  <text x={2.2} y={4} fontSize="2.2" fill="#e2e8f0" opacity={0.78}>
                    N
                  </text>
                  <text x={96.5} y={52} fontSize="2.2" fill="#e2e8f0" opacity={0.78}>
                    E
                  </text>
                  <text x={2.2} y={98} fontSize="2.2" fill="#e2e8f0" opacity={0.78}>
                    S
                  </text>
                  <text x={2.2} y={52} fontSize="2.2" fill="#e2e8f0" opacity={0.78}>
                    W
                  </text>
                </svg>
              )}

              <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-100 backdrop-blur-sm">
                <div className="font-semibold uppercase tracking-[0.16em] text-slate-300">
                  Overlay
                </div>
                <div className="mt-1">{mapOverlayTitle}</div>
                <div className="text-slate-400">
                  Launch drift envelope over {HORIZONS_MIN.join(", ")} min
                </div>
              </div>

              <div className="pointer-events-none absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-[11px] text-slate-100 backdrop-blur-sm">
                <div className="mb-2 font-semibold uppercase tracking-[0.16em] text-slate-300">
                  Speed bands
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-6 rounded bg-teal-400" />
                    <span>
                      Low ({formatSpeedRange(speedBands.minKt, speedBands.lowMaxKt)})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-6 rounded bg-amber-400" />
                    <span>
                      Medium ({formatSpeedRange(speedBands.lowMaxKt, speedBands.medMaxKt)})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-6 rounded bg-rose-400" />
                    <span>
                      Strong ({formatSpeedRange(speedBands.highMinKt, speedBands.maxKt)})
                    </span>
                  </div>
                </div>
              </div>

              {tileLoadError && (
                <div className="absolute bottom-4 left-4 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 shadow-sm">
                  Some map tiles failed to load. Trajectory data is still available.
                </div>
              )}
            </div>

            {limitedByForecast && (
              <div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-800">
                Some horizons are limited by available forecast range.
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Reachability endpoints
                  </h3>
                  <p className="text-sm text-slate-500">
                    Distances and bearings for each time horizon.
                  </p>
                </div>
                <Route className="h-5 w-5 text-sky-600" />
              </div>

              {baselineEndpoints.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No trajectory endpoints available.
                </p>
              ) : (
                <div className="space-y-3">
                  {baselineEndpoints.map((endpoint) => (
                    <div
                      key={`metric-${endpoint.horizonMin}`}
                      className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[0.85fr_1.2fr_0.9fr_0.8fr_0.85fr]"
                    >
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          Horizon
                        </div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">
                          {endpoint.horizonMin} min
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          Endpoint
                        </div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {endpoint.lat.toFixed(4)}, {endpoint.lon.toFixed(4)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          Distance
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {formatDistanceNm(endpoint.distanceNm)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          Bearing
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {formatBearing(endpoint.bearingDeg)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          Avg GS
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {endpoint.avgGroundspeedKt.toFixed(1)} kt
                        </div>
                      </div>
                      {endpoint.limitedByForecast && (
                        <div className="text-xs text-amber-700 md:col-span-5">
                          Limited by available forecast range.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-slate-900">
                  Vertical wind profile
                </h3>
                <p className="text-sm text-slate-500">
                  Snapshot for {timeLabel} at nearby sampled levels.
                </p>
              </div>

              <div className="space-y-3">
                {PROFILE_ALTITUDES.map((altitude) => {
                  const { speedKt, direction } = getProfileForAltitude(altitude);
                  const maxSpeed = Math.max(speedBands.maxKt, 30);
                  const barWidth = Math.min(100, (speedKt / maxSpeed) * 100);
                  const active = altitude === selectedAltitude;

                  return (
                    <button
                      key={altitude}
                      type="button"
                      onClick={() => setSelectedAltitude(altitude)}
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        active
                          ? "border-sky-500 bg-sky-50 shadow-sm"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-24 text-sm font-semibold text-slate-900">
                            {altitude.toLocaleString()} ft
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <ArrowUp
                              className="h-4 w-4 text-sky-600"
                              style={{ transform: `rotate(${direction}deg)` }}
                            />
                            <span className="font-medium">
                              {getDirectionName(direction)}
                            </span>
                            <span className="text-xs text-slate-500">
                              ({Math.round(direction)}°)
                            </span>
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          {speedKt} kt
                        </div>
                      </div>

                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: getSpeedColor(speedKt),
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
