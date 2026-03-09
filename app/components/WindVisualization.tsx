import { Wind, ArrowUp, TrendingUp, Loader2, MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";
import { useWindAloft, type PressureLevelRow, type WindAloftHour } from "../hooks/useWindAloft";
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

function mphToKnots(valueMph: number): number {
  return Math.round(valueMph * 0.868976);
}

function nearestLevelByMsl(hour: WindAloftHour | null, targetMslFt: number): PressureLevelRow | null {
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

function getDirectionName(degrees: number): string {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
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

  const plotRef = useRef<SVGSVGElement | null>(null);
  const { hours, loading, error } = useWindAloft(location.lat, location.lon);

  const hourMax = Math.max(0, hours.length - 1);

  useEffect(() => {
    if (selectedHour > hourMax) setSelectedHour(hourMax);
  }, [hourMax, selectedHour]);

  useEffect(() => {
    setStartLat(location.lat);
    setStartLon(location.lon);
    setStartLatInput(location.lat.toFixed(4));
    setStartLonInput(location.lon.toFixed(4));
    setInputError(null);
  }, [location.lat, location.lon]);

  const currentHour = hours[selectedHour] ?? null;
  const timeDisplay = currentHour ? formatForecastTime(currentHour.time) : "Loading...";
  const selectedLevel = useMemo(
    () => nearestLevelByMsl(currentHour, selectedAltitude),
    [currentHour, selectedAltitude],
  );

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
      .filter((endpoint) => endpoint.band === "baseline" && endpoint.side === "center")
      .sort((a, b) => a.horizonMin - b.horizonMin);
  }, [trajectory]);

  const pathsForExtent = useMemo(() => {
    if (!trajectory) return [] as Array<{ eastNm: number; northNm: number }>;
    const points: Array<{ eastNm: number; northNm: number }> = [];
    points.push({ eastNm: 0, northNm: 0 });
    points.push(latLonToLocalNm(startLat, startLon, location.lat, location.lon));

    for (const path of trajectory.paths) {
      if (path.band !== "high") continue;
      for (const point of path.points) {
        points.push(latLonToLocalNm(point.lat, point.lon, location.lat, location.lon));
      }
    }

    for (const endpoint of baselineEndpoints) {
      points.push(latLonToLocalNm(endpoint.lat, endpoint.lon, location.lat, location.lon));
    }

    return points;
  }, [trajectory, startLat, startLon, location.lat, location.lon, baselineEndpoints]);

  const extentNm = useMemo(() => {
    if (pathsForExtent.length === 0) return 20;
    const maxAbs = pathsForExtent.reduce((maxValue, point) => {
      return Math.max(maxValue, Math.abs(point.eastNm), Math.abs(point.northNm));
    }, 0);
    return clamp(roundToStep(Math.max(15, maxAbs * 1.2), 5), 15, 80);
  }, [pathsForExtent]);

  const gridTicks = useMemo(() => {
    const half = extentNm / 2;
    return [-extentNm, -half, 0, half, extentNm];
  }, [extentNm]);

  const mapBounds = useMemo(() => {
    const pad = extentNm * 1.1;
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

  const windVectors = useMemo(() => {
    const vectors: Array<{ x: number; y: number; angle: number; speedKt: number; length: number }> = [];
    const columns = 8;
    const rows = 8;

    const baseDirection = selectedLevel?.windDirection ?? 300;
    const baseSpeed = selectedLevel ? mphToKnots(selectedLevel.windSpeed_mph) : 12;

    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
        const x = ((columnIndex + 0.5) / columns) * 100;
        const y = ((rowIndex + 0.5) / rows) * 100;
        const waveDirection = Math.sin((columnIndex + selectedHour) * 0.65) * 4 + Math.cos((rowIndex + selectedAltitude / 1000) * 0.55) * 3;
        const waveSpeed = Math.cos((columnIndex + rowIndex + selectedHour) * 0.5) * 2.2;
        const angle = (baseDirection + waveDirection + 360) % 360;
        const speedKt = Math.max(0, baseSpeed + waveSpeed);
        const length = 2.7 + Math.max(0, speedKt) * 0.14;
        vectors.push({ x, y, angle, speedKt, length });
      }
    }

    return vectors;
  }, [selectedAltitude, selectedHour, selectedLevel]);

  const getPlotPointFromLatLon = (lat: number, lon: number) => {
    const x = ((lon - mapBounds.west) / (mapBounds.east - mapBounds.west || 1e-6)) * 100;
    const topMerc = latToMercatorYNormalized(mapBounds.north);
    const bottomMerc = latToMercatorYNormalized(mapBounds.south);
    const valueMerc = latToMercatorYNormalized(lat);
    const y = ((valueMerc - topMerc) / (bottomMerc - topMerc || 1e-6)) * 100;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  };

  const getPlotPoint = (eastNm: number, northNm: number) => {
    const latLon = localNmToLatLon(eastNm, northNm, location.lat, location.lon);
    return getPlotPointFromLatLon(latLon.lat, latLon.lon);
  };

  const mapTiles = useMemo(() => {
    const zoom = pickTileZoom(mapBounds);
    const minTileX = Math.floor(lonToTileX(mapBounds.west, zoom));
    const maxTileX = Math.floor(lonToTileX(mapBounds.east, zoom));
    const minTileY = Math.floor(latToTileY(mapBounds.north, zoom));
    const maxTileY = Math.floor(latToTileY(mapBounds.south, zoom));
    const maxY = Math.max(0, (2 ** zoom) - 1);
    const tiles: MapTile[] = [];

    for (let tileY = Math.max(0, minTileY); tileY <= Math.min(maxY, maxTileY); tileY++) {
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
          url: `https://tile.openstreetmap.org/${zoom}/${wrapTileX(tileX, zoom)}/${tileY}.png`,
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

  const getPath = (horizonMin: number, band: TrajectoryBand, side: "left" | "center" | "right") => {
    return pathLookup.get(`${horizonMin}:${band}:${side}`);
  };

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

  const getSpeedColor = (speedKt: number) => {
    if (speedKt <= speedBands.lowMaxKt) return "#3b82f6";
    if (speedKt <= speedBands.medMaxKt) return "#f59e0b";
    return "#ef4444";
  };

  const bandFillColor = (band: "low" | "medium" | "high") => {
    if (band === "low") return "rgba(59,130,246,0.18)";
    if (band === "medium") return "rgba(245,158,11,0.14)";
    return "rgba(239,68,68,0.12)";
  };

  const horizonStroke = (horizon: number) => {
    if (horizon <= 30) return "#1d4ed8";
    if (horizon <= 60) return "#2563eb";
    if (horizon <= 90) return "#3b82f6";
    return "#60a5fa";
  };

  const limitedByForecast = baselineEndpoints.some((endpoint) => endpoint.limitedByForecast);
  const startMarker = getPlotPointFromLatLon(startLat, startLon);
  const centerMarker = getPlotPointFromLatLon(location.lat, location.lon);
  const labelOffsets: Record<number, { dx: number; dy: number }> = {
    30: { dx: 1.4, dy: -1.5 },
    60: { dx: 1.4, dy: 1.8 },
    90: { dx: -8, dy: -1.5 },
    180: { dx: -8, dy: 1.8 },
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

  return (
    <div className="space-y-3">
      {/* ── Control Console ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {/* Altitude Control */}
        <div className="rounded-xl border border-white/8 bg-surface-elevated p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Altitude</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Fixed Balloon Altitude</span>
              <span className="font-semibold text-sm text-amber-300">{selectedAltitude.toLocaleString()} ft MSL</span>
            </div>
            <Slider
              value={[selectedAltitude]}
              onValueChange={(values) => setSelectedAltitude(values[0])}
              min={1000}
              max={18000}
              step={1000}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>1,000 ft</span>
              <span>18,000 ft</span>
            </div>
          </div>
        </div>

        {/* Forecast Time Control */}
        <div className="rounded-xl border border-white/8 bg-surface-elevated p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wind className="w-4 h-4 text-sky-400" />
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Forecast Time</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Start Time</span>
              <span className="font-semibold text-sm text-sky-300">{timeDisplay}</span>
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
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>Earliest</span>
              <span>Latest</span>
            </div>
          </div>
        </div>

        {/* Launch Point Control */}
        <div className="rounded-xl border border-white/8 bg-surface-elevated p-4">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Launch Point</h3>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">Lat</label>
                <Input
                  value={startLatInput}
                  onChange={(e) => setStartLatInput(e.target.value)}
                  className="h-8 text-xs bg-white/5 border-white/8 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">Lon</label>
                <Input
                  value={startLonInput}
                  onChange={(e) => setStartLonInput(e.target.value)}
                  className="h-8 text-xs bg-white/5 border-white/8 text-white"
                />
              </div>
            </div>
            {inputError && <p className="text-[10px] text-red-400">{inputError}</p>}
            <div className="flex gap-1.5">
              <Button
                onClick={handleSetStartFromInputs}
                className="flex-1 h-7 text-xs bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/20"
              >
                Set Point
              </Button>
              <Button
                variant="outline"
                onClick={handleUseSelectedLocation}
                className="h-7 text-xs border-white/10 text-slate-400 hover:bg-white/5"
              >
                Reset
              </Button>
            </div>
            <p className="text-[10px] text-slate-600">Tap the map to drop the launch pin</p>
          </div>
        </div>
      </div>

      {/* ── Trajectory Map (Hero) ─────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-surface-elevated p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Balloon Reachability</h3>
            <p className="text-[11px] text-slate-500">{selectedAltitude.toLocaleString()} ft MSL · Start {timeDisplay}</p>
          </div>
        </div>

        <div className="relative w-full aspect-square rounded-lg border border-white/8 overflow-hidden bg-slate-900">
          {loading && hours.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
              <span className="text-sm text-slate-400">Loading trajectory data...</span>
            </div>
          ) : error && !trajectory ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-400 px-6 text-center">
              {error}
            </div>
          ) : (
            <svg
              ref={plotRef}
              className="w-full h-full cursor-crosshair"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              onClick={handlePlotTap}
            >
              <rect x={0} y={0} width={100} height={100} fill="#0f172a" />
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
              <rect x={0} y={0} width={100} height={100} fill="rgba(15,23,42,0.35)" />

              {gridTicks.map((tick, index) => {
                const pointX = getPlotPoint(tick, 0).x;
                const pointY = getPlotPoint(0, tick).y;
                return (
                  <g key={`grid-${index}`}>
                    <line x1={pointX} y1={0} x2={pointX} y2={100} stroke="#334155" strokeWidth={0.15} opacity={0.5} />
                    <line x1={0} y1={pointY} x2={100} y2={pointY} stroke="#334155" strokeWidth={0.15} opacity={0.5} />
                  </g>
                );
              })}

              {windVectors.map((vector, index) => {
                const radians = ((vector.angle - 90) * Math.PI) / 180;
                const endX = vector.x + Math.cos(radians) * vector.length;
                const endY = vector.y + Math.sin(radians) * vector.length;
                const arrowLength = 1.1 + vector.length * 0.2;
                const arrowAngle = 26 * (Math.PI / 180);
                const angle1 = radians + Math.PI - arrowAngle;
                const angle2 = radians + Math.PI + arrowAngle;
                const arrowX1 = endX + Math.cos(angle1) * arrowLength;
                const arrowY1 = endY + Math.sin(angle1) * arrowLength;
                const arrowX2 = endX + Math.cos(angle2) * arrowLength;
                const arrowY2 = endY + Math.sin(angle2) * arrowLength;
                const color = getSpeedColor(vector.speedKt);
                return (
                  <g key={`vec-${index}`} opacity={0.45}>
                    <line x1={vector.x} y1={vector.y} x2={endX} y2={endY} stroke={color} strokeWidth={0.5} strokeLinecap="round" />
                    <polygon points={`${endX},${endY} ${arrowX1},${arrowY1} ${arrowX2},${arrowY2}`} fill={color} />
                  </g>
                );
              })}

              {HORIZONS_MIN.map((horizon) =>
                (["high", "medium", "low"] as const).map((band) => {
                  const left = getPath(horizon, band, "left");
                  const right = getPath(horizon, band, "right");
                  if (!left || !right || left.points.length < 2 || right.points.length < 2) return null;

                  const leftPoints = left.points.map((point) => {
                    const local = latLonToLocalNm(point.lat, point.lon, location.lat, location.lon);
                    const plot = getPlotPoint(local.eastNm, local.northNm);
                    return `${plot.x},${plot.y}`;
                  });
                  const rightPoints = [...right.points].reverse().map((point) => {
                    const local = latLonToLocalNm(point.lat, point.lon, location.lat, location.lon);
                    const plot = getPlotPoint(local.eastNm, local.northNm);
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

              {HORIZONS_MIN.map((horizon) => {
                const path = getPath(horizon, "baseline", "center");
                if (!path || path.points.length < 2) return null;
                const points = path.points.map((point) => {
                  const local = latLonToLocalNm(point.lat, point.lon, location.lat, location.lon);
                  const plot = getPlotPoint(local.eastNm, local.northNm);
                  return `${plot.x},${plot.y}`;
                });

                return (
                  <polyline
                    key={`center-${horizon}`}
                    points={points.join(" ")}
                    fill="none"
                    stroke={horizonStroke(horizon)}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                  />
                );
              })}

              <circle cx={centerMarker.x} cy={centerMarker.y} r={1.1} fill="#f8fafc" opacity={0.7} />
              <circle cx={startMarker.x} cy={startMarker.y} r={1.2} fill="#22c55e" stroke="#ffffff" strokeWidth={0.3} />

              {baselineEndpoints.map((endpoint) => {
                const plot = getPlotPointFromLatLon(endpoint.lat, endpoint.lon);
                const offset = labelOffsets[endpoint.horizonMin] ?? { dx: 1.5, dy: -1.5 };
                return (
                  <g key={`endpoint-${endpoint.horizonMin}`}>
                    <circle cx={plot.x} cy={plot.y} r={1.05} fill={horizonStroke(endpoint.horizonMin)} stroke="#ffffff" strokeWidth={0.3} />
                    <text x={plot.x + offset.dx} y={plot.y + offset.dy} fontSize="2.7" fill="#94a3b8" fontWeight={600}>
                      {endpoint.horizonMin}m
                    </text>
                  </g>
                );
              })}

              <text x={2} y={4} fontSize="2.2" fill="#475569" fontWeight={500}>N</text>
              <text x={96} y={52} fontSize="2.2" fill="#475569" fontWeight={500}>E</text>
              <text x={2} y={98} fontSize="2.2" fill="#475569" fontWeight={500}>S</text>
              <text x={2} y={52} fontSize="2.2" fill="#475569" fontWeight={500}>W</text>
            </svg>
          )}

          {/* Speed Legend */}
          <div className="absolute top-2.5 right-2.5 bg-slate-900/90 backdrop-blur-sm rounded-lg p-2 border border-white/8">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Speed</div>
            <div className="space-y-1 text-[10px]">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-blue-500 rounded" />
                <span className="text-slate-400">Low ({formatSpeedRange(speedBands.minKt, speedBands.lowMaxKt)})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-amber-500 rounded" />
                <span className="text-slate-400">Med ({formatSpeedRange(speedBands.lowMaxKt, speedBands.medMaxKt)})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-red-500 rounded" />
                <span className="text-slate-400">High ({formatSpeedRange(speedBands.highMinKt, speedBands.maxKt)})</span>
              </div>
            </div>
          </div>

          {tileLoadError && (
            <div className="absolute bottom-2.5 left-2.5 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-1 text-[10px] text-amber-400">
              Some map tiles failed to load.
            </div>
          )}
        </div>

        {limitedByForecast && (
          <p className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/15 rounded-md px-2.5 py-1.5 mt-2">
            Some horizons are limited by available forecast range.
          </p>
        )}
      </div>

      {/* ── Reachability Endpoints ────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-surface-elevated p-3 sm:p-4">
        <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">Reachability Endpoints</h3>
        {baselineEndpoints.length === 0 ? (
          <p className="text-xs text-slate-500">No trajectory endpoints available.</p>
        ) : (
          <div className="space-y-1.5">
            {baselineEndpoints.map((endpoint) => (
              <div
                key={`metric-${endpoint.horizonMin}`}
                className="grid grid-cols-2 md:grid-cols-5 gap-2 bg-white/[0.03] rounded-lg p-2.5 text-xs border border-white/4"
              >
                <div>
                  <div className="text-[10px] text-slate-600">Horizon</div>
                  <div className="font-semibold text-white">{endpoint.horizonMin} min</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">Endpoint</div>
                  <div className="font-medium text-slate-300">{endpoint.lat.toFixed(4)}, {endpoint.lon.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">Distance</div>
                  <div className="font-medium text-slate-300">{endpoint.distanceNm.toFixed(1)} NM</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">Bearing</div>
                  <div className="font-medium text-slate-300">{Math.round(endpoint.bearingDeg)}°</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">Avg GS</div>
                  <div className="font-medium text-slate-300">{endpoint.avgGroundspeedKt.toFixed(1)} kt</div>
                </div>
                {endpoint.limitedByForecast && (
                  <div className="col-span-2 md:col-span-5 text-[10px] text-amber-400">Limited by forecast range.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Vertical Wind Profile ─────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-surface-elevated p-3 sm:p-4">
        <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">Vertical Wind Profile · {timeDisplay}</h3>

        <div className="space-y-1.5">
          {PROFILE_ALTITUDES.map((altitude) => {
            const { speedKt, direction } = getProfileForAltitude(altitude);
            const maxSpeed = Math.max(speedBands.maxKt, 30);
            const barWidth = Math.min(100, (speedKt / maxSpeed) * 100);
            const isSelected = altitude === selectedAltitude;

            return (
              <div
                key={altitude}
                className={cn(
                  "p-2.5 rounded-lg border transition-all",
                  isSelected
                    ? "bg-amber-500/8 border-amber-500/20"
                    : "bg-white/[0.02] border-white/4 hover:bg-white/[0.04]",
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2.5">
                    <div className={cn("font-semibold text-xs w-20", isSelected ? "text-amber-300" : "text-slate-300")}>
                      {altitude.toLocaleString()} ft
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ArrowUp
                        className={cn("w-3.5 h-3.5", isSelected ? "text-amber-400" : "text-slate-500")}
                        style={{ transform: `rotate(${direction}deg)` }}
                      />
                      <span className="text-xs text-slate-400">{getDirectionName(direction)}</span>
                      <span className="text-[10px] text-slate-600">({Math.round(direction)}°)</span>
                    </div>
                  </div>
                  <div className={cn("font-semibold text-xs", isSelected ? "text-amber-300" : "text-slate-300")}>{speedKt} kt</div>
                </div>

                <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${barWidth}%`, backgroundColor: getSpeedColor(speedKt) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
