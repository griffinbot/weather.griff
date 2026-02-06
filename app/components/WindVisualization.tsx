import { Wind, ArrowUp, TrendingUp, Loader2, MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
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

export function WindVisualization({ location }: WindVisualizationProps) {
  const [selectedAltitude, setSelectedAltitude] = useState(5000);
  const [selectedHour, setSelectedHour] = useState(0);
  const [startLat, setStartLat] = useState(location.lat);
  const [startLon, setStartLon] = useState(location.lon);
  const [startLatInput, setStartLatInput] = useState(location.lat.toFixed(4));
  const [startLonInput, setStartLonInput] = useState(location.lon.toFixed(4));
  const [inputError, setInputError] = useState<string | null>(null);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);

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

  const mapImageUrl = useMemo(() => {
    const params = new URLSearchParams({
      bbox: `${mapBounds.west},${mapBounds.south},${mapBounds.east},${mapBounds.north}`,
      size: "1400x1400",
      maptype: "mapnik",
    });
    return `https://staticmap.openstreetmap.de/staticmap.php?${params.toString()}`;
  }, [mapBounds]);

  useEffect(() => {
    setMapLoadFailed(false);
  }, [mapImageUrl]);

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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold mb-2">Wind Visualization</h2>
            <p className="text-gray-600">Balloon drift planner for {location.name}</p>
          </div>
          <Wind className="w-8 h-8 text-blue-500" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold">Altitude</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Fixed Balloon Altitude</span>
              <span className="font-semibold text-lg text-blue-600">{selectedAltitude.toLocaleString()} ft MSL</span>
            </div>
            <Slider
              value={[selectedAltitude]}
              onValueChange={(values) => setSelectedAltitude(values[0])}
              min={1000}
              max={18000}
              step={1000}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>1,000 ft</span>
              <span>18,000 ft</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Wind className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold">Forecast Time</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Start Time</span>
              <span className="font-semibold text-lg text-blue-600">{timeDisplay}</span>
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
            <div className="flex justify-between text-xs text-gray-500">
              <span>Earliest</span>
              <span>Latest</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold">Balloon Launch</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Latitude</label>
                <Input value={startLatInput} onChange={(e) => setStartLatInput(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Longitude</label>
                <Input value={startLonInput} onChange={(e) => setStartLonInput(e.target.value)} />
              </div>
            </div>
            {inputError && <p className="text-xs text-red-600">{inputError}</p>}
            <div className="flex gap-2">
              <Button onClick={handleSetStartFromInputs} className="flex-1">
                Set Launch Point
              </Button>
              <Button variant="outline" onClick={handleUseSelectedLocation}>
                Use Selected
              </Button>
            </div>
            <p className="text-xs text-gray-500">Tip: tap inside the map below to place launch point.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-1">Balloon Reachability at {selectedAltitude.toLocaleString()} ft MSL</h3>
        <p className="text-sm text-gray-500 mb-4">Start time {timeDisplay}</p>

        <div className="relative w-full aspect-square bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200 overflow-hidden">
          {loading && hours.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-gray-600">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span className="text-sm">Loading trajectory data…</span>
            </div>
          ) : error && !trajectory ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 px-6 text-center">
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
              {gridTicks.map((tick, index) => {
                const pointX = getPlotPoint(tick, 0).x;
                const pointY = getPlotPoint(0, tick).y;
                return (
                  <g key={`grid-${index}`}>
                    <line x1={pointX} y1={0} x2={pointX} y2={100} stroke="#cbd5e1" strokeWidth={0.2} opacity={0.45} />
                    <line x1={0} y1={pointY} x2={100} y2={pointY} stroke="#cbd5e1" strokeWidth={0.2} opacity={0.45} />
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
                  <g key={`vec-${index}`} opacity={0.5}>
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

              <circle cx={centerMarker.x} cy={centerMarker.y} r={1.1} fill="#0f172a" opacity={0.8} />
              <circle cx={startMarker.x} cy={startMarker.y} r={1.2} fill="#16a34a" stroke="#ffffff" strokeWidth={0.3} />

              {baselineEndpoints.map((endpoint) => {
                const plot = plotPointFromLatLon(endpoint.lat, endpoint.lon);
                const offset = labelOffsets[endpoint.horizonMin] ?? { dx: 1.5, dy: -1.5 };
                return (
                  <g key={`endpoint-${endpoint.horizonMin}`}>
                    <circle cx={plot.x} cy={plot.y} r={1.05} fill={horizonStroke(endpoint.horizonMin)} stroke="#ffffff" strokeWidth={0.3} />
                    <text x={plot.x + offset.dx} y={plot.y + offset.dy} fontSize="2.7" fill="#1e293b" fontWeight={600}>
                      {endpoint.horizonMin}m
                    </text>
                  </g>
                );
              })}

              <text x={2} y={4} fontSize="2.4" fill="#475569">N</text>
              <text x={96} y={52} fontSize="2.4" fill="#475569">E</text>
              <text x={2} y={98} fontSize="2.4" fill="#475569">S</text>
              <text x={2} y={52} fontSize="2.4" fill="#475569">W</text>
            </svg>
          )}

          <div className="absolute top-3 right-3 bg-white/92 backdrop-blur-sm rounded-lg p-2.5 shadow-md">
            <div className="text-[11px] font-semibold mb-1.5">Wind Speed (Dynamic)</div>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center gap-2">
                <div className="w-5 h-1 bg-blue-500 rounded" />
                <span>Low ({formatSpeedRange(speedBands.minKt, speedBands.lowMaxKt)})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-1 bg-amber-500 rounded" />
                <span>Medium ({formatSpeedRange(speedBands.lowMaxKt, speedBands.medMaxKt)})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-1 bg-red-500 rounded" />
                <span>Strong ({formatSpeedRange(speedBands.highMinKt, speedBands.maxKt)})</span>
              </div>
            </div>
          </div>
        </div>

        {limitedByForecast && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
            Some horizons are limited by available forecast range.
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-4">Reachability Endpoints</h3>
        {baselineEndpoints.length === 0 ? (
          <p className="text-sm text-gray-500">No trajectory endpoints available.</p>
        ) : (
          <div className="space-y-2">
            {baselineEndpoints.map((endpoint) => (
              <div
                key={`metric-${endpoint.horizonMin}`}
                className="grid grid-cols-2 md:grid-cols-5 gap-2 bg-gray-50 rounded-xl p-3 text-sm"
              >
                <div>
                  <div className="text-xs text-gray-500">Horizon</div>
                  <div className="font-semibold">{endpoint.horizonMin} min</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Endpoint</div>
                  <div className="font-medium">{endpoint.lat.toFixed(4)}, {endpoint.lon.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Distance</div>
                  <div className="font-medium">{endpoint.distanceNm.toFixed(1)} NM</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Bearing</div>
                  <div className="font-medium">{Math.round(endpoint.bearingDeg)}°</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Avg GS</div>
                  <div className="font-medium">{endpoint.avgGroundspeedKt.toFixed(1)} kt</div>
                </div>
                {endpoint.limitedByForecast && (
                  <div className="col-span-2 md:col-span-5 text-xs text-amber-700">Limited by forecast range.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-4">Vertical Wind Profile at {timeDisplay}</h3>

        <div className="space-y-3">
          {PROFILE_ALTITUDES.map((altitude) => {
            const { speedKt, direction } = getProfileForAltitude(altitude);
            const maxSpeed = Math.max(speedBands.maxKt, 30);
            const barWidth = Math.min(100, (speedKt / maxSpeed) * 100);

            return (
              <div
                key={altitude}
                className={`p-4 rounded-xl border-2 transition-all ${
                  altitude === selectedAltitude ? "bg-blue-50 border-blue-300" : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="font-semibold text-sm w-24">{altitude.toLocaleString()} ft</div>
                    <div className="flex items-center gap-2">
                      <ArrowUp className="w-4 h-4 text-blue-600" style={{ transform: `rotate(${direction}deg)` }} />
                      <span className="text-sm font-medium">{getDirectionName(direction)}</span>
                      <span className="text-xs text-gray-500">({Math.round(direction)}°)</span>
                    </div>
                  </div>
                  <div className="font-semibold text-blue-600">{speedKt} kt</div>
                </div>

                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, backgroundColor: getSpeedColor(speedKt) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
