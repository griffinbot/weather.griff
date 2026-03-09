import {
  ArrowUp,
  FileUp,
  Gauge,
  Loader2,
  LocateFixed,
  MapPin,
  Pause,
  Play,
  Radar,
  Route,
  Settings2,
  Wind,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Pane,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import {
  useWindAloft,
  type PressureLevelRow,
  type WindAloftHour,
} from "../hooks/useWindAloft";
import {
  parseKmlDocument,
  type KmlFeature,
  type ParsedKmlDocument,
} from "../lib/kml";
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

type BasemapStyle = "street" | "dark";
type DistanceUnit = "nm" | "mi";

type WindVizSettings = {
  basemap: BasemapStyle;
  distanceUnit: DistanceUnit;
  showWindField: boolean;
  animateWind: boolean;
  showRangeRings: boolean;
  showUncertaintyBands: boolean;
  showEndpointLabels: boolean;
  autoPlay: boolean;
};

interface WindVectorFeature {
  key: string;
  body: [LatLngTuple, LatLngTuple];
  leftWing: [LatLngTuple, LatLngTuple];
  rightWing: [LatLngTuple, LatLngTuple];
  particles: Array<{
    key: string;
    center: LatLngTuple;
    radius: number;
    opacity: number;
  }>;
  speedKt: number;
}

type GpsFix = {
  lat: number;
  lon: number;
  accuracyM: number | null;
};

const HORIZONS_MIN = [30, 60, 90, 180];
const PROFILE_ALTITUDES = [1000, 2000, 3000, 5000, 8000, 10000, 14000, 18000];
const PLAYBACK_INTERVAL_MS = 1500;
const FLOW_TICK_INTERVAL_MS = 120;
const FLOW_COLUMNS = 7;
const FLOW_ROWS = 7;
const NM_TO_METERS = 1852;
const NM_TO_MI = 1.15078;
const SETTINGS_STORAGE_KEY = "weather.griff.windVizSettings.v2";
const STACK_ALTITUDE_MIN = PROFILE_ALTITUDES[0];
const STACK_ALTITUDE_MAX = PROFILE_ALTITUDES[PROFILE_ALTITUDES.length - 1];

const DEFAULT_SETTINGS: WindVizSettings = {
  basemap: "street",
  distanceUnit: "nm",
  showWindField: true,
  animateWind: true,
  showRangeRings: true,
  showUncertaintyBands: true,
  showEndpointLabels: true,
  autoPlay: false,
};

const BASEMAPS: Record<
  BasemapStyle,
  { label: string; url: string; attribution: string }
> = {
  street: {
    label: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  dark: {
    label: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
};

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
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

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function formatSpeedRange(minKt: number, maxKt: number): string {
  if (Math.abs(minKt - maxKt) < 0.1) return `${Math.round(minKt)} kt`;
  return `${Math.round(minKt)}-${Math.round(maxKt)} kt`;
}

function formatFeatureKind(kind: KmlFeature["kind"]): string {
  if (kind === "point") return "Point";
  if (kind === "line") return "Line";
  return "Polygon";
}

function isBasemapStyle(value: unknown): value is BasemapStyle {
  return value === "street" || value === "dark";
}

function isDistanceUnit(value: unknown): value is DistanceUnit {
  return value === "nm" || value === "mi";
}

function readSettings(): WindVizSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<WindVizSettings>;
    return {
      basemap: isBasemapStyle(parsed.basemap)
        ? parsed.basemap
        : DEFAULT_SETTINGS.basemap,
      distanceUnit: isDistanceUnit(parsed.distanceUnit)
        ? parsed.distanceUnit
        : DEFAULT_SETTINGS.distanceUnit,
      showWindField:
        typeof parsed.showWindField === "boolean"
          ? parsed.showWindField
          : DEFAULT_SETTINGS.showWindField,
      animateWind:
        typeof parsed.animateWind === "boolean"
          ? parsed.animateWind
          : DEFAULT_SETTINGS.animateWind,
      showRangeRings:
        typeof parsed.showRangeRings === "boolean"
          ? parsed.showRangeRings
          : DEFAULT_SETTINGS.showRangeRings,
      showUncertaintyBands:
        typeof parsed.showUncertaintyBands === "boolean"
          ? parsed.showUncertaintyBands
          : DEFAULT_SETTINGS.showUncertaintyBands,
      showEndpointLabels:
        typeof parsed.showEndpointLabels === "boolean"
          ? parsed.showEndpointLabels
          : DEFAULT_SETTINGS.showEndpointLabels,
      autoPlay:
        typeof parsed.autoPlay === "boolean"
          ? parsed.autoPlay
          : DEFAULT_SETTINGS.autoPlay,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function SettingChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-sky-500 bg-sky-50 text-sky-700"
          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="min-w-0">
        <Label className="text-sm font-medium text-slate-900">{label}</Label>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function MapBoundsController({
  bounds,
  fitKey,
}: {
  bounds: LatLngBoundsExpression;
  fitKey: string;
}) {
  const map = useMap();

  useEffect(() => {
    map.fitBounds(bounds, {
      padding: [30, 30],
      maxZoom: 10,
    });
  }, [bounds, fitKey, map]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      map.invalidateSize();
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [map]);

  return null;
}

function MapClickCapture({
  onPick,
}: {
  onPick: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export function WindVisualization({ location }: WindVisualizationProps) {
  const [selectedAltitude, setSelectedAltitude] = useState(5000);
  const [selectedHour, setSelectedHour] = useState(0);
  const [selectedStackHorizon, setSelectedStackHorizon] = useState(60);
  const [startLat, setStartLat] = useState(location.lat);
  const [startLon, setStartLon] = useState(location.lon);
  const [startLatInput, setStartLatInput] = useState(location.lat.toFixed(4));
  const [startLonInput, setStartLonInput] = useState(location.lon.toFixed(4));
  const [inputError, setInputError] = useState<string | null>(null);
  const [tileLoadError, setTileLoadError] = useState(false);
  const [flowTick, setFlowTick] = useState(0);
  const [mapFitNonce, setMapFitNonce] = useState(0);
  const [settings, setSettings] = useState<WindVizSettings>(DEFAULT_SETTINGS);
  const [kmlOverlay, setKmlOverlay] = useState<ParsedKmlDocument | null>(null);
  const [kmlError, setKmlError] = useState<string | null>(null);
  const [isReadingKml, setIsReadingKml] = useState(false);
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isGpsLoading, setIsGpsLoading] = useState(false);

  const { hours, loading, error } = useWindAloft(location.lat, location.lon);
  const hourMax = Math.max(0, hours.length - 1);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (selectedHour > hourMax) setSelectedHour(hourMax);
  }, [hourMax, selectedHour]);

  useEffect(() => {
    if (!settings.autoPlay || hourMax === 0) return;
    const interval = window.setInterval(() => {
      setSelectedHour((currentHour) =>
        currentHour >= hourMax ? 0 : currentHour + 1,
      );
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [hourMax, settings.autoPlay]);

  useEffect(() => {
    if (!settings.animateWind) return;
    const interval = window.setInterval(() => {
      setFlowTick((currentTick) => (currentTick + 1) % 48);
    }, FLOW_TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [settings.animateWind]);

  useEffect(() => {
    setStartLat(location.lat);
    setStartLon(location.lon);
    setStartLatInput(location.lat.toFixed(4));
    setStartLonInput(location.lon.toFixed(4));
    setInputError(null);
    setMapFitNonce((value) => value + 1);
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
    return endpoint.distanceNm > strongest.distanceNm ? endpoint : strongest;
  }, null);

  const getPath = (
    horizonMin: number,
    band: TrajectoryBand,
    side: "left" | "center" | "right",
  ) => pathLookup.get(`${horizonMin}:${band}:${side}`);

  const pointsForExtent = useMemo(() => {
    const points: Array<{ eastNm: number; northNm: number }> = [
      { eastNm: 0, northNm: 0 },
      latLonToLocalNm(location.lat, location.lon, startLat, startLon),
    ];

    for (const path of trajectory?.paths ?? []) {
      if (path.band !== "high") continue;
      for (const point of path.points) {
        points.push({ eastNm: point.eastNm, northNm: point.northNm });
      }
    }

    return points;
  }, [location.lat, location.lon, startLat, startLon, trajectory]);

  const kmlPositions = useMemo(() => {
    if (!kmlOverlay) return [] as Array<[number, number]>;
    return kmlOverlay.features.flatMap((feature) => feature.positions);
  }, [kmlOverlay]);

  const extentNm = useMemo(() => {
    if (pointsForExtent.length === 0) return 20;
    const maxAbs = pointsForExtent.reduce((maxValue, point) => {
      return Math.max(
        maxValue,
        Math.abs(point.eastNm),
        Math.abs(point.northNm),
      );
    }, 0);
    return clamp(roundToStep(Math.max(15, maxAbs * 1.35), 5), 15, 120);
  }, [pointsForExtent]);

  const ringRadii = useMemo(() => {
    const step = extentNm <= 25 ? 5 : 10;
    const values: number[] = [];
    for (let radius = step; radius < extentNm; radius += step) {
      values.push(radius);
    }
    return values.slice(0, 6);
  }, [extentNm]);

  const mapBounds = useMemo<LatLngBoundsExpression>(() => {
    const pad = extentNm * 1.18;
    const northWest = localNmToLatLon(-pad, pad, startLat, startLon);
    const southEast = localNmToLatLon(pad, -pad, startLat, startLon);

    const points: Array<[number, number]> = [
      [northWest.lat, northWest.lon],
      [southEast.lat, southEast.lon],
      [location.lat, location.lon],
      [startLat, startLon],
      ...kmlPositions,
    ];

    if (gpsFix) {
      points.push([gpsFix.lat, gpsFix.lon]);
    }

    const lats = points.map((point) => point[0]);
    const lons = points.map((point) => point[1]);

    return [
      [Math.max(...lats), Math.min(...lons)],
      [Math.min(...lats), Math.max(...lons)],
    ];
  }, [extentNm, gpsFix, kmlPositions, location.lat, location.lon, startLat, startLon]);

  const fitKey = `${location.lat}:${location.lon}:${startLat}:${startLon}:${selectedAltitude}:${kmlOverlay?.features.length ?? 0}:${gpsFix?.lat ?? "na"}:${gpsFix?.lon ?? "na"}:${mapFitNonce}`;

  const speedBands: SpeedBands = trajectory?.speedBands ?? {
    minKt: 0,
    maxKt: 0,
    lowMaxKt: 0,
    medMaxKt: 0,
    highMinKt: 0,
  };

  const getSpeedColor = (speedKt: number) => {
    if (speedKt <= speedBands.lowMaxKt) return "#2dd4bf";
    if (speedKt <= speedBands.medMaxKt) return "#f59e0b";
    return "#f43f5e";
  };

  const bandFillColor = (band: "low" | "medium" | "high") => {
    if (band === "low") return "rgba(45,212,191,0.18)";
    if (band === "medium") return "rgba(245,158,11,0.16)";
    return "rgba(244,63,94,0.16)";
  };

  const horizonStroke = (horizon: number) => {
    if (horizon <= 30) return "#38bdf8";
    if (horizon <= 60) return "#0ea5e9";
    if (horizon <= 90) return "#0284c7";
    return "#0369a1";
  };

  const windVectors = useMemo<WindVectorFeature[]>(() => {
    if (!settings.showWindField || !selectedLevel) return [];

    const vectors: WindVectorFeature[] = [];
    const phase = settings.animateWind ? flowTick / 48 : 0;

    for (let rowIndex = 0; rowIndex < FLOW_ROWS; rowIndex++) {
      for (let columnIndex = 0; columnIndex < FLOW_COLUMNS; columnIndex++) {
        const centerEastNm =
          ((columnIndex + 0.5) / FLOW_COLUMNS - 0.5) * extentNm * 1.7;
        const centerNorthNm =
          (0.5 - (rowIndex + 0.5) / FLOW_ROWS) * extentNm * 1.7;
        const waveDirection =
          Math.sin((columnIndex + selectedHour) * 0.7) * 8 +
          Math.cos((rowIndex + selectedAltitude / 1000) * 0.5) * 6;
        const waveSpeed =
          Math.cos((columnIndex + rowIndex + selectedHour) * 0.55) * 2.8;
        const speedKt = Math.max(0, selectedWind.speedKt + waveSpeed);
        const driftDirection = normalizeDegrees(
          selectedWind.direction + 180 + waveDirection,
        );
        const driftRadians = (driftDirection * Math.PI) / 180;
        const lengthNm = clamp(0.9 + speedKt * 0.07, 1, 3.4);
        const halfLengthNm = lengthNm / 2;
        const headEastNm = centerEastNm + Math.sin(driftRadians) * halfLengthNm;
        const headNorthNm =
          centerNorthNm + Math.cos(driftRadians) * halfLengthNm;
        const tailEastNm = centerEastNm - Math.sin(driftRadians) * halfLengthNm;
        const tailNorthNm =
          centerNorthNm - Math.cos(driftRadians) * halfLengthNm;
        const head = localNmToLatLon(headEastNm, headNorthNm, startLat, startLon);
        const tail = localNmToLatLon(tailEastNm, tailNorthNm, startLat, startLon);

        const wingLengthNm = lengthNm * 0.28;
        const wingLeftRadians = driftRadians + Math.PI - 0.45;
        const wingRightRadians = driftRadians + Math.PI + 0.45;
        const leftWing = localNmToLatLon(
          headEastNm + Math.sin(wingLeftRadians) * wingLengthNm,
          headNorthNm + Math.cos(wingLeftRadians) * wingLengthNm,
          startLat,
          startLon,
        );
        const rightWing = localNmToLatLon(
          headEastNm + Math.sin(wingRightRadians) * wingLengthNm,
          headNorthNm + Math.cos(wingRightRadians) * wingLengthNm,
          startLat,
          startLon,
        );

        const particles = settings.animateWind
          ? [0, 0.48].map((offset, particleIndex) => {
              const progress =
                (phase + offset + (rowIndex + columnIndex) * 0.037) % 1;
              const particleEastNm =
                tailEastNm + (headEastNm - tailEastNm) * progress;
              const particleNorthNm =
                tailNorthNm + (headNorthNm - tailNorthNm) * progress;
              const particleLatLon = localNmToLatLon(
                particleEastNm,
                particleNorthNm,
                startLat,
                startLon,
              );
              return {
                key: `${columnIndex}-${rowIndex}-${particleIndex}`,
                center: [particleLatLon.lat, particleLatLon.lon] as LatLngTuple,
                radius: particleIndex === 0 ? 4 : 2.8,
                opacity: particleIndex === 0 ? 0.8 : 0.45,
              };
            })
          : [];

        vectors.push({
          key: `${columnIndex}-${rowIndex}`,
          body: [
            [tail.lat, tail.lon],
            [head.lat, head.lon],
          ],
          leftWing: [
            [head.lat, head.lon],
            [leftWing.lat, leftWing.lon],
          ],
          rightWing: [
            [head.lat, head.lon],
            [rightWing.lat, rightWing.lon],
          ],
          particles,
          speedKt,
        });
      }
    }

    return vectors;
  }, [
    extentNm,
    flowTick,
    selectedAltitude,
    selectedHour,
    selectedLevel,
    selectedWind.direction,
    selectedWind.speedKt,
    settings.animateWind,
    settings.showWindField,
    startLat,
    startLon,
  ]);

  const uncertaintyBands = useMemo(() => {
    const bands: Array<{
      key: string;
      positions: LatLngTuple[];
      fillColor: string;
    }> = [];

    if (!settings.showUncertaintyBands) return bands;

    for (const horizon of HORIZONS_MIN) {
      for (const band of ["high", "medium", "low"] as const) {
        const left = getPath(horizon, band, "left");
        const right = getPath(horizon, band, "right");
        if (!left || !right || left.points.length < 2 || right.points.length < 2) {
          continue;
        }

        const leftPositions = left.points.map(
          (point) => [point.lat, point.lon] as LatLngTuple,
        );
        const rightPositions = [...right.points]
          .reverse()
          .map((point) => [point.lat, point.lon] as LatLngTuple);

        bands.push({
          key: `${band}-${horizon}`,
          positions: [...leftPositions, ...rightPositions],
          fillColor: bandFillColor(band),
        });
      }
    }

    return bands;
  }, [pathLookup, settings.showUncertaintyBands, trajectory]);

  const baselinePolylines = useMemo(() => {
    return HORIZONS_MIN.map((horizon) => {
      const path = getPath(horizon, "baseline", "center");
      if (!path || path.points.length < 2) return null;
      return {
        horizon,
        positions: path.points.map(
          (point) => [point.lat, point.lon] as LatLngTuple,
        ),
      };
    }).filter(
      (
        path,
      ): path is {
        horizon: number;
        positions: LatLngTuple[];
      } => path !== null,
    );
  }, [pathLookup]);

  const stackTrajectories = useMemo(() => {
    if (!currentHour || hours.length === 0) {
      return [] as Array<{
        altitude: number;
        positions: Array<{ eastNm: number; northNm: number }>;
        endpoint: {
          eastNm: number;
          northNm: number;
          distanceNm: number;
          bearingDeg: number;
          avgGroundspeedKt: number;
          limitedByForecast?: boolean;
        } | null;
        speedKt: number;
        direction: number;
      }>;
    }

    return PROFILE_ALTITUDES.map((altitude) => {
      const result = simulateBalloonTrajectory({
        startLat,
        startLon,
        selectedAltitudeFtMsl: altitude,
        startTime: currentHour.time,
        horizonsMin: [selectedStackHorizon],
        hours,
        stepMinutes: 1,
      });

      const path = result.paths.find(
        (candidate) =>
          candidate.horizonMin === selectedStackHorizon &&
          candidate.band === "baseline" &&
          candidate.side === "center",
      );
      const endpoint = result.endpoints.find(
        (candidate) =>
          candidate.horizonMin === selectedStackHorizon &&
          candidate.band === "baseline" &&
          candidate.side === "center",
      );
      const profile = getProfileForAltitude(altitude);

      return {
        altitude,
        positions:
          path?.points.map((point) => ({
            eastNm: point.eastNm,
            northNm: point.northNm,
          })) ?? [{ eastNm: 0, northNm: 0 }],
        endpoint: endpoint
          ? {
              eastNm:
                path?.points[path.points.length - 1]?.eastNm ?? 0,
              northNm:
                path?.points[path.points.length - 1]?.northNm ?? 0,
              distanceNm: endpoint.distanceNm,
              bearingDeg: endpoint.bearingDeg,
              avgGroundspeedKt: endpoint.avgGroundspeedKt,
              limitedByForecast: endpoint.limitedByForecast,
            }
          : null,
        speedKt: profile.speedKt,
        direction: profile.direction,
      };
    });
  }, [
    currentHour,
    getProfileForAltitude,
    hours,
    selectedStackHorizon,
    startLat,
    startLon,
  ]);

  const bestStackLayer = stackTrajectories.reduce<
    (typeof stackTrajectories)[number] | null
  >((best, layer) => {
    if (!layer.endpoint) return best;
    if (!best?.endpoint) return layer;
    return layer.endpoint.distanceNm > best.endpoint.distanceNm ? layer : best;
  }, null);

  const stackExtentNm = useMemo(() => {
    const maxAbs = stackTrajectories.reduce((currentMax, layer) => {
      const layerMax = layer.positions.reduce((layerCurrentMax, point) => {
        return Math.max(
          layerCurrentMax,
          Math.abs(point.eastNm),
          Math.abs(point.northNm),
        );
      }, 0);
      return Math.max(currentMax, layerMax);
    }, 0);

    return Math.max(maxAbs, 6);
  }, [stackTrajectories]);

  const projectStackPoint = (
    eastNm: number,
    northNm: number,
    altitudeFt: number,
  ) => {
    const scale = 24 / stackExtentNm;
    const altitudeRatio =
      (altitudeFt - STACK_ALTITUDE_MIN) /
      (STACK_ALTITUDE_MAX - STACK_ALTITUDE_MIN || 1);
    const x = 50 + eastNm * scale + northNm * scale * 0.34;
    const y = 84 - altitudeRatio * 56 - northNm * scale * 0.26;
    return { x, y };
  };

  const stackPlanes = PROFILE_ALTITUDES.map((altitude) => {
    const leftNear = projectStackPoint(-stackExtentNm, -stackExtentNm * 0.18, altitude);
    const rightNear = projectStackPoint(stackExtentNm, -stackExtentNm * 0.18, altitude);
    return {
      altitude,
      leftNear,
      rightNear,
      labelPoint: projectStackPoint(-stackExtentNm * 1.02, 0, altitude),
    };
  });

  const stackScene = stackTrajectories.map((layer) => {
    const projectedPoints = layer.positions.map((point) =>
      projectStackPoint(point.eastNm, point.northNm, layer.altitude),
    );
    const endpointProjection = layer.endpoint
      ? projectStackPoint(layer.endpoint.eastNm, layer.endpoint.northNm, layer.altitude)
      : projectStackPoint(0, 0, layer.altitude);

    return {
      ...layer,
      color: getSpeedColor(layer.speedKt),
      projectedPoints,
      endpointProjection,
      startProjection: projectStackPoint(0, 0, layer.altitude),
    };
  });

  const limitedByForecast = baselineEndpoints.some(
    (endpoint) => endpoint.limitedByForecast,
  );

  const launchOffset = latLonToLocalNm(startLat, startLon, location.lat, location.lon);
  const launchDistanceNm = Math.sqrt(
    launchOffset.eastNm ** 2 + launchOffset.northNm ** 2,
  );
  const launchBearingDeg =
    ((Math.atan2(launchOffset.eastNm, launchOffset.northNm) * 180) / Math.PI +
      360) %
    360;

  const formatDistance = (distanceNm: number) => {
    const value =
      settings.distanceUnit === "mi" ? distanceNm * NM_TO_MI : distanceNm;
    const suffix = settings.distanceUnit === "mi" ? "mi" : "NM";
    const decimals = value >= 10 ? 0 : 1;
    return `${value.toFixed(decimals)} ${suffix}`;
  };

  const gpsDistanceFromLaunchNm = gpsFix
    ? Math.sqrt(
        (() => {
          const offset = latLonToLocalNm(gpsFix.lat, gpsFix.lon, startLat, startLon);
          return offset.eastNm ** 2 + offset.northNm ** 2;
        })(),
      )
    : null;

  const kmlLegendItems = useMemo(() => {
    if (!kmlOverlay) return [];
    return kmlOverlay.features.slice(0, 10).map((feature) => ({
      id: feature.id,
      name: feature.name,
      kind: feature.kind,
      color: feature.kind === "polygon" ? feature.style.fillColor : feature.style.strokeColor,
    }));
  }, [kmlOverlay]);

  const kmlFeatureCounts = useMemo(() => {
    if (!kmlOverlay) {
      return { points: 0, lines: 0, polygons: 0 };
    }

    return kmlOverlay.features.reduce(
      (counts, feature) => {
        if (feature.kind === "point") counts.points += 1;
        if (feature.kind === "line") counts.lines += 1;
        if (feature.kind === "polygon") counts.polygons += 1;
        return counts;
      },
      { points: 0, lines: 0, polygons: 0 },
    );
  }, [kmlOverlay]);

  const handleSetStartPosition = (lat: number, lon: number) => {
    setInputError(null);
    setStartLat(lat);
    setStartLon(lon);
    setStartLatInput(lat.toFixed(4));
    setStartLonInput(lon.toFixed(4));
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

    handleSetStartPosition(parsedLat, parsedLon);
    setMapFitNonce((value) => value + 1);
  };

  const handleResetLaunch = () => {
    handleSetStartPosition(location.lat, location.lon);
    setMapFitNonce((value) => value + 1);
  };

  const handleMapPick = (lat: number, lon: number) => {
    handleSetStartPosition(lat, lon);
  };

  const handleKmlUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReadingKml(true);
    setKmlError(null);

    try {
      const text = await file.text();
      const parsed = parseKmlDocument(text, file.name);
      if (parsed.features.length === 0) {
        throw new Error(
          "The KML loaded, but no Point, LineString, or Polygon features were found.",
        );
      }
      setKmlOverlay(parsed);
      setMapFitNonce((value) => value + 1);
    } catch (error) {
      setKmlOverlay(null);
      setKmlError(
        error instanceof Error ? error.message : "Failed to read the KML file.",
      );
    } finally {
      setIsReadingKml(false);
      event.target.value = "";
    }
  };

  const clearKmlOverlay = () => {
    setKmlOverlay(null);
    setKmlError(null);
  };

  const requestGpsFix = () => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGpsError("Geolocation is not available in this browser.");
      return;
    }

    setIsGpsLoading(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
        });
        setIsGpsLoading(false);
        setMapFitNonce((value) => value + 1);
      },
      (error) => {
        setGpsError(error.message || "Unable to get your GPS position.");
        setIsGpsLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    );
  };

  const useGpsForLaunch = () => {
    if (!gpsFix) return;
    handleSetStartPosition(gpsFix.lat, gpsFix.lon);
    setMapFitNonce((value) => value + 1);
  };

  function getProfileForAltitude(altitudeMslFt: number) {
    const nearest = nearestLevelByMsl(currentHour, altitudeMslFt);
    if (!nearest) {
      return { speedKt: 0, direction: 0 };
    }
    return {
      speedKt: mphToKnots(nearest.windSpeed_mph),
      direction: nearest.windDirection,
    };
  }

  const currentBasemap = BASEMAPS[settings.basemap];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.24),_transparent_36%),linear-gradient(135deg,_#06131c_0%,_#0f2740_48%,_#17395c_100%)] p-6 text-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100">
              <Radar className="h-3.5 w-3.5" />
              Wind map
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Real-map wind overlay for {location.name}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-sky-50/80 sm:text-base">
                Use the settings deck to switch map style, toggle overlays, and
                animate how the selected wind layer pushes drift paths across the
                map.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[540px]">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-sky-100/75">
                Selected layer
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {selectedAltitude.toLocaleString()} ft
              </div>
              <div className="mt-1 text-sm text-sky-50/80">
                {selectedWind.speedKt} kt from {formatBearing(selectedWind.direction)}
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
                {strongestEndpoint ? formatDistance(strongestEndpoint.distanceNm) : "0 NM"}
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

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Altitude and playback
                </div>
                <div className="text-xs text-slate-500">
                  Choose a layer, then step or animate forecast frames.
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
            </div>

            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    Frame
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {timeDisplay}
                  </div>
                  <div className="text-xs text-slate-500">{timeLabel}</div>
                </div>
                <Button
                  type="button"
                  variant={settings.autoPlay ? "secondary" : "default"}
                  size="sm"
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      autoPlay: !current.autoPlay,
                    }))
                  }
                  disabled={hourMax === 0}
                >
                  {settings.autoPlay ? (
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
                  Click the map or enter coordinates directly.
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
              <Button type="button" variant="outline" onClick={handleResetLaunch}>
                Reset
              </Button>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={requestGpsFix}
                disabled={isGpsLoading}
              >
                {isGpsLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Getting GPS
                  </>
                ) : (
                  <>
                    <LocateFixed className="h-4 w-4" />
                    Use my GPS
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={useGpsForLaunch}
                disabled={!gpsFix}
              >
                GPS as launch
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
                  : `${formatDistance(launchDistanceNm)} from ${location.airport || location.name} on ${formatBearing(launchBearingDeg)}.`}
              </div>
            </div>

            {(gpsFix || gpsError) && (
              <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-900">
                {gpsFix ? (
                  <>
                    <div className="font-medium">
                      GPS: {formatCoordinate(gpsFix.lat, "N", "S")},{" "}
                      {formatCoordinate(gpsFix.lon, "E", "W")}
                    </div>
                    <div className="mt-1 text-xs text-sky-800/80">
                      {gpsFix.accuracyM != null
                        ? `Accuracy about ${Math.round(gpsFix.accuracyM)} m.`
                        : "Accuracy unavailable."}{" "}
                      {gpsDistanceFromLaunchNm != null
                        ? `Marker is ${formatDistance(gpsDistanceFromLaunchNm)} from the current launch point.`
                        : ""}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-rose-700">{gpsError}</div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  KML landing overlay
                </div>
                <div className="text-xs text-slate-500">
                  Upload a KML file and display it on the map with a visible key.
                </div>
              </div>
              <FileUp className="h-5 w-5 text-sky-600" />
            </div>

            <Input
              type="file"
              accept=".kml,application/vnd.google-earth.kml+xml"
              onChange={handleKmlUpload}
            />

            {isReadingKml && (
              <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                Reading KML…
              </div>
            )}

            {kmlError && (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {kmlError}
              </div>
            )}

            {kmlOverlay ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-semibold text-slate-900">
                    {kmlOverlay.documentName}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {kmlOverlay.sourceName}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl bg-white px-2 py-2 text-center text-slate-600">
                      <div className="font-semibold text-slate-900">
                        {kmlFeatureCounts.points}
                      </div>
                      Points
                    </div>
                    <div className="rounded-xl bg-white px-2 py-2 text-center text-slate-600">
                      <div className="font-semibold text-slate-900">
                        {kmlFeatureCounts.lines}
                      </div>
                      Lines
                    </div>
                    <div className="rounded-xl bg-white px-2 py-2 text-center text-slate-600">
                      <div className="font-semibold text-slate-900">
                        {kmlFeatureCounts.polygons}
                      </div>
                      Polygons
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    KML key
                  </div>
                  <div className="space-y-2">
                    {kmlLegendItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div
                          className="h-3 w-3 rounded-full border border-white/70"
                          style={{ backgroundColor: item.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {item.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatFeatureKind(item.kind)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {kmlOverlay.features.length > kmlLegendItems.length && (
                  <div className="text-xs text-slate-500">
                    Showing the first {kmlLegendItems.length} items in the key.
                  </div>
                )}

                <Button type="button" variant="outline" onClick={clearKmlOverlay}>
                  Remove KML
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Supports KML `Point`, `LineString`, and `Polygon` features.
              </p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Display settings
                </div>
                <div className="text-xs text-slate-500">
                  Control the basemap and overlay density.
                </div>
              </div>
              <Settings2 className="h-5 w-5 text-sky-600" />
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Basemap
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(BASEMAPS).map(([key, value]) => (
                    <SettingChip
                      key={key}
                      active={settings.basemap === key}
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          basemap: key as BasemapStyle,
                        }))
                      }
                    >
                      {value.label}
                    </SettingChip>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Distance unit
                </div>
                <div className="flex flex-wrap gap-2">
                  <SettingChip
                    active={settings.distanceUnit === "nm"}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        distanceUnit: "nm",
                      }))
                    }
                  >
                    Nautical miles
                  </SettingChip>
                  <SettingChip
                    active={settings.distanceUnit === "mi"}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        distanceUnit: "mi",
                      }))
                    }
                  >
                    Statute miles
                  </SettingChip>
                </div>
              </div>

              <SettingToggle
                label="Wind field"
                description="Show the animated directional arrows on top of the map."
                checked={settings.showWindField}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    showWindField: checked,
                  }))
                }
              />
              <SettingToggle
                label="Wind animation"
                description="Animate particles moving through the selected wind layer."
                checked={settings.animateWind}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    animateWind: checked,
                  }))
                }
              />
              <SettingToggle
                label="Distance rings"
                description="Show launch-centered radius circles for distance reading."
                checked={settings.showRangeRings}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    showRangeRings: checked,
                  }))
                }
              />
              <SettingToggle
                label="Uncertainty bands"
                description="Fill the low, medium, and high drift envelopes around each baseline path."
                checked={settings.showUncertaintyBands}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    showUncertaintyBands: checked,
                  }))
                }
              />
              <SettingToggle
                label="Endpoint labels"
                description="Pin the 30, 60, 90, and 180 minute labels directly on the map."
                checked={settings.showEndpointLabels}
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    showEndpointLabels: checked,
                  }))
                }
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Live wind overlay
                  </h3>
                  <p className="text-sm text-slate-500">
                    Real map tiles with drift paths, wind vectors, and launch-centered distances.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Sampled layer{" "}
                    <span className="font-semibold text-slate-900">
                      {selectedWind.sampledAltitudeFt.toLocaleString()} ft
                    </span>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Speed scale{" "}
                    <span className="font-semibold text-slate-900">
                      {formatSpeedRange(speedBands.minKt, speedBands.maxKt)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setMapFitNonce((value) => value + 1)}
                  >
                    <LocateFixed className="h-4 w-4" />
                    Recenter
                  </Button>
                </div>
              </div>
            </div>

            <div className="relative">
              {loading && hours.length === 0 ? (
                <div className="flex h-[680px] items-center justify-center gap-2 bg-slate-950 text-slate-100">
                  <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
                  <span className="text-sm">Loading wind trajectory data…</span>
                </div>
              ) : error && !trajectory ? (
                <div className="flex h-[680px] items-center justify-center bg-slate-950 px-6 text-center text-sm text-rose-300">
                  {error}
                </div>
              ) : (
                <>
                  <MapContainer
                    center={[startLat, startLon]}
                    zoom={8}
                    scrollWheelZoom
                    className="h-[680px] w-full"
                  >
                    <MapBoundsController bounds={mapBounds} fitKey={fitKey} />
                    <MapClickCapture onPick={handleMapPick} />

                    <TileLayer
                      key={settings.basemap}
                      url={currentBasemap.url}
                      attribution={currentBasemap.attribution}
                      eventHandlers={{
                        tileerror: () => setTileLoadError(true),
                        loading: () => setTileLoadError(false),
                      }}
                    />

                    <Pane name="kml-overlay" style={{ zIndex: 470 }}>
                      {kmlOverlay?.features.map((feature) => {
                        if (feature.kind === "point") {
                          const position = feature.positions[0];
                          return (
                            <CircleMarker
                              key={feature.id}
                              pane="kml-overlay"
                              center={position}
                              radius={7}
                              pathOptions={{
                                color: feature.style.strokeColor,
                                fillColor: feature.style.fillColor,
                                opacity: feature.style.strokeOpacity,
                                fillOpacity: Math.max(feature.style.fillOpacity, 0.7),
                                weight: Math.max(feature.style.strokeWidth, 2),
                              }}
                            >
                              <Tooltip direction="top" offset={[0, -8]}>
                                {feature.name}
                              </Tooltip>
                            </CircleMarker>
                          );
                        }

                        if (feature.kind === "line") {
                          return (
                            <Polyline
                              key={feature.id}
                              pane="kml-overlay"
                              positions={feature.positions}
                              pathOptions={{
                                color: feature.style.strokeColor,
                                opacity: feature.style.strokeOpacity,
                                weight: Math.max(feature.style.strokeWidth, 2),
                              }}
                            >
                              <Tooltip sticky>{feature.name}</Tooltip>
                            </Polyline>
                          );
                        }

                        return (
                          <Polygon
                            key={feature.id}
                            pane="kml-overlay"
                            positions={feature.positions}
                            pathOptions={{
                              color: feature.style.strokeColor,
                              opacity: feature.style.strokeOpacity,
                              weight: Math.max(feature.style.strokeWidth, 2),
                              fillColor: feature.style.fillColor,
                              fillOpacity: feature.style.fillOpacity,
                            }}
                          >
                            <Tooltip sticky>{feature.name}</Tooltip>
                          </Polygon>
                        );
                      })}
                    </Pane>

                    <Pane name="bands" style={{ zIndex: 430 }}>
                      {uncertaintyBands.map((band) => (
                        <Polygon
                          key={band.key}
                          pane="bands"
                          positions={band.positions}
                          pathOptions={{
                            stroke: false,
                            fillColor: band.fillColor,
                            fillOpacity: 1,
                          }}
                        />
                      ))}
                    </Pane>

                    <Pane name="rings" style={{ zIndex: 450 }}>
                      {settings.showRangeRings &&
                        ringRadii.map((radiusNm) => (
                          <Circle
                            key={`ring-${radiusNm}`}
                            pane="rings"
                            center={[startLat, startLon]}
                            radius={radiusNm * NM_TO_METERS}
                            pathOptions={{
                              color: settings.basemap === "dark" ? "#cbd5e1" : "#475569",
                              weight: 1,
                              opacity: 0.55,
                              dashArray: "5 7",
                              fillOpacity: 0,
                            }}
                          >
                            <Tooltip direction="top" offset={[0, -8]} permanent>
                              {formatDistance(radiusNm)}
                            </Tooltip>
                          </Circle>
                        ))}
                    </Pane>

                    <Pane name="baseline" style={{ zIndex: 520 }}>
                      {baselinePolylines.map((path) => (
                        <Polyline
                          key={`baseline-${path.horizon}`}
                          pane="baseline"
                          positions={path.positions}
                          pathOptions={{
                            color: horizonStroke(path.horizon),
                            weight: 4,
                            opacity: 0.92,
                          }}
                        />
                      ))}
                    </Pane>

                    <Pane name="wind-field" style={{ zIndex: 560 }}>
                      {windVectors.map((vector) => (
                        <Fragment key={vector.key}>
                          <Polyline
                            pane="wind-field"
                            positions={vector.body}
                            pathOptions={{
                              color: getSpeedColor(vector.speedKt),
                              weight: 2,
                              opacity: 0.8,
                            }}
                          />
                          <Polyline
                            pane="wind-field"
                            positions={vector.leftWing}
                            pathOptions={{
                              color: getSpeedColor(vector.speedKt),
                              weight: 2,
                              opacity: 0.8,
                            }}
                          />
                          <Polyline
                            pane="wind-field"
                            positions={vector.rightWing}
                            pathOptions={{
                              color: getSpeedColor(vector.speedKt),
                              weight: 2,
                              opacity: 0.8,
                            }}
                          />
                          {vector.particles.map((particle) => (
                            <CircleMarker
                              key={particle.key}
                              pane="wind-field"
                              center={particle.center}
                              radius={particle.radius}
                              pathOptions={{
                                color: getSpeedColor(vector.speedKt),
                                fillColor: getSpeedColor(vector.speedKt),
                                fillOpacity: particle.opacity,
                                opacity: particle.opacity,
                                weight: 0,
                              }}
                            />
                          ))}
                        </Fragment>
                      ))}
                    </Pane>

                    <Pane name="markers" style={{ zIndex: 620 }}>
                      {gpsFix?.accuracyM != null && (
                        <Circle
                          pane="markers"
                          center={[gpsFix.lat, gpsFix.lon]}
                          radius={gpsFix.accuracyM}
                          pathOptions={{
                            color: "#2563eb",
                            weight: 1,
                            opacity: 0.5,
                            fillColor: "#60a5fa",
                            fillOpacity: 0.14,
                          }}
                        />
                      )}

                      {launchDistanceNm >= 0.25 && (
                        <Polyline
                          pane="markers"
                          positions={[
                            [location.lat, location.lon],
                            [startLat, startLon],
                          ]}
                          pathOptions={{
                            color: "#34d399",
                            weight: 2,
                            opacity: 0.75,
                            dashArray: "7 6",
                          }}
                        />
                      )}

                      <CircleMarker
                        pane="markers"
                        center={[location.lat, location.lon]}
                        radius={7}
                        pathOptions={{
                          color: "#ffffff",
                          fillColor: "#0f172a",
                          fillOpacity: 0.95,
                          weight: 2,
                        }}
                      >
                        <Tooltip direction="top" offset={[0, -8]} permanent>
                          {location.airport || location.name}
                        </Tooltip>
                      </CircleMarker>

                      {gpsFix && (
                        <CircleMarker
                          pane="markers"
                          center={[gpsFix.lat, gpsFix.lon]}
                          radius={8}
                          pathOptions={{
                            color: "#ffffff",
                            fillColor: "#2563eb",
                            fillOpacity: 0.98,
                            weight: 2,
                          }}
                        >
                          <Tooltip direction="top" offset={[0, -8]} permanent>
                            My GPS
                          </Tooltip>
                        </CircleMarker>
                      )}

                      <CircleMarker
                        pane="markers"
                        center={[startLat, startLon]}
                        radius={8}
                        pathOptions={{
                          color: "#ffffff",
                          fillColor: "#22c55e",
                          fillOpacity: 0.95,
                          weight: 2,
                        }}
                      >
                        <Tooltip direction="top" offset={[0, -8]} permanent>
                          Launch
                        </Tooltip>
                      </CircleMarker>

                      {baselineEndpoints.map((endpoint) => (
                        <CircleMarker
                          key={`endpoint-${endpoint.horizonMin}`}
                          pane="markers"
                          center={[endpoint.lat, endpoint.lon]}
                          radius={6}
                          pathOptions={{
                            color: "#e0f2fe",
                            fillColor: horizonStroke(endpoint.horizonMin),
                            fillOpacity: 0.95,
                            weight: 2,
                          }}
                        >
                          {settings.showEndpointLabels && (
                            <Tooltip direction="top" offset={[0, -8]} permanent>
                              {endpoint.horizonMin}m
                            </Tooltip>
                          )}
                        </CircleMarker>
                      ))}
                    </Pane>
                  </MapContainer>

                  <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-slate-950/78 px-3 py-2 text-[11px] text-slate-100 backdrop-blur-sm">
                    <div className="font-semibold uppercase tracking-[0.16em] text-slate-300">
                      Overlay
                    </div>
                    <div className="mt-1">
                      {selectedWind.speedKt} kt from {formatBearing(selectedWind.direction)}
                    </div>
                    <div className="text-slate-400">
                      {settings.showWindField
                        ? "Wind field visible"
                        : "Wind field hidden"}{" "}
                      on {BASEMAPS[settings.basemap].label.toLowerCase()} map
                    </div>
                  </div>

                  {(kmlOverlay || gpsFix) && (
                    <div className="pointer-events-none absolute left-4 top-24 max-w-[260px] rounded-2xl border border-white/10 bg-slate-950/78 px-3 py-3 text-[11px] text-slate-100 backdrop-blur-sm">
                      <div className="font-semibold uppercase tracking-[0.16em] text-slate-300">
                        Map key
                      </div>
                      {gpsFix && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full border border-white/80 bg-blue-500" />
                          <span>My GPS position</span>
                        </div>
                      )}
                      {kmlOverlay && (
                        <>
                          <div className="mt-2 text-slate-300">{kmlOverlay.documentName}</div>
                          {kmlLegendItems.slice(0, 4).map((item) => (
                            <div key={item.id} className="mt-1 flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded-full border border-white/70"
                                style={{ backgroundColor: item.color }}
                              />
                              <span className="truncate">
                                {item.name} ({formatFeatureKind(item.kind)})
                              </span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  <div className="pointer-events-none absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-slate-950/78 p-3 text-[11px] text-slate-100 backdrop-blur-sm">
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

                  <div className="pointer-events-none absolute right-4 top-4 rounded-2xl border border-white/10 bg-white/86 px-3 py-2 text-[11px] text-slate-700 backdrop-blur-sm">
                    Click anywhere on the map to move the launch point.
                  </div>
                </>
              )}

              {tileLoadError && (
                <div className="absolute bottom-4 left-4 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 shadow-sm">
                  Some map tiles failed to load. Wind overlays still render.
                </div>
              )}
            </div>

            {limitedByForecast && (
              <div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-800">
                Some horizons are limited by available forecast range.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  3D wind volume
                </h3>
                <p className="text-sm text-slate-500">
                  Compare where each altitude layer could carry you from the
                  current launch point.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {HORIZONS_MIN.map((horizon) => (
                  <SettingChip
                    key={`stack-horizon-${horizon}`}
                    active={selectedStackHorizon === horizon}
                    onClick={() => setSelectedStackHorizon(horizon)}
                  >
                    {horizon} min
                  </SettingChip>
                ))}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.22),_transparent_34%),linear-gradient(160deg,_#08101b_0%,_#12263e_48%,_#1e293b_100%)] p-4 text-white">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-slate-100/90">
                    Forecast frame{" "}
                    <span className="font-semibold text-white">{timeLabel}</span>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-slate-100/90">
                    Comparison horizon{" "}
                    <span className="font-semibold text-white">
                      {selectedStackHorizon} min
                    </span>
                  </div>
                  {bestStackLayer?.endpoint && (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-50">
                      Best reach{" "}
                      <span className="font-semibold">
                        {bestStackLayer.altitude.toLocaleString()} ft
                      </span>{" "}
                      to {formatDistance(bestStackLayer.endpoint.distanceNm)}
                    </div>
                  )}
                </div>

                <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/35">
                  <svg
                    viewBox="0 0 100 100"
                    className="h-[360px] w-full"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="stackGround" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#0f172a" stopOpacity="0.04" />
                      </linearGradient>
                    </defs>

                    <rect x="0" y="0" width="100" height="100" fill="transparent" />
                    <polygon
                      points="10,88 90,88 76,98 24,98"
                      fill="url(#stackGround)"
                      opacity="0.85"
                    />

                    {stackPlanes.map((plane) => (
                      <g key={`stack-plane-${plane.altitude}`}>
                        <line
                          x1={plane.leftNear.x}
                          y1={plane.leftNear.y}
                          x2={plane.rightNear.x}
                          y2={plane.rightNear.y}
                          stroke="rgba(226,232,240,0.22)"
                          strokeWidth="0.35"
                          strokeDasharray="1 1.1"
                        />
                        <text
                          x={plane.labelPoint.x}
                          y={plane.labelPoint.y}
                          fill="rgba(226,232,240,0.68)"
                          fontSize="2.5"
                          textAnchor="start"
                        >
                          {plane.altitude.toLocaleString()} ft
                        </text>
                      </g>
                    ))}

                    <line
                      x1={projectStackPoint(0, 0, STACK_ALTITUDE_MIN).x}
                      y1={projectStackPoint(0, 0, STACK_ALTITUDE_MIN).y}
                      x2={projectStackPoint(0, 0, STACK_ALTITUDE_MAX).x}
                      y2={projectStackPoint(0, 0, STACK_ALTITUDE_MAX).y}
                      stroke="rgba(134,239,172,0.8)"
                      strokeWidth="0.45"
                    />

                    {[...stackScene]
                      .sort((left, right) => right.altitude - left.altitude)
                      .map((layer) => {
                        const pointString = layer.projectedPoints
                          .map((point) => `${point.x},${point.y}`)
                          .join(" ");
                        const isSelected = layer.altitude === selectedAltitude;
                        const endpoint = layer.endpoint;
                        return (
                          <g key={`stack-path-${layer.altitude}`}>
                            <circle
                              cx={layer.startProjection.x}
                              cy={layer.startProjection.y}
                              r={isSelected ? 0.85 : 0.55}
                              fill="#f8fafc"
                              opacity={isSelected ? 1 : 0.72}
                            />
                            <polyline
                              points={pointString}
                              fill="none"
                              stroke={layer.color}
                              strokeWidth={isSelected ? 1 : 0.62}
                              opacity={isSelected ? 1 : 0.76}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <circle
                              cx={layer.endpointProjection.x}
                              cy={layer.endpointProjection.y}
                              r={isSelected ? 1.15 : 0.82}
                              fill={layer.color}
                              stroke="#e2e8f0"
                              strokeWidth="0.22"
                            />
                            {endpoint ? (
                              <text
                                x={layer.endpointProjection.x + 1.2}
                                y={layer.endpointProjection.y - 0.6}
                                fill={isSelected ? "#f8fafc" : "rgba(226,232,240,0.74)"}
                                fontSize="2.2"
                              >
                                {layer.altitude.toLocaleString()} ft
                              </text>
                            ) : null}
                          </g>
                        );
                      })}
                  </svg>

                  <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-100 backdrop-blur-sm">
                    <div className="font-semibold uppercase tracking-[0.16em] text-slate-300">
                      How to read
                    </div>
                    <div className="mt-1 max-w-[220px] text-slate-200/85">
                      Each line is one altitude layer leaving the same launch
                      point. Higher shelves represent higher altitudes.
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {stackScene
                  .filter((layer) => layer.endpoint)
                  .sort(
                    (left, right) =>
                      (right.endpoint?.distanceNm ?? 0) -
                      (left.endpoint?.distanceNm ?? 0),
                  )
                  .map((layer) => {
                    const isSelected = layer.altitude === selectedAltitude;
                    return (
                      <button
                        key={`stack-metric-${layer.altitude}`}
                        type="button"
                        onClick={() => setSelectedAltitude(layer.altitude)}
                        className={`w-full rounded-3xl border p-4 text-left transition ${
                          isSelected
                            ? "border-sky-500 bg-sky-50 shadow-sm"
                            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {layer.altitude.toLocaleString()} ft
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                              <ArrowUp
                                className="h-3.5 w-3.5 text-sky-600"
                                style={{ transform: `rotate(${layer.direction}deg)` }}
                              />
                              {layer.speedKt} kt from {getDirectionName(layer.direction)}
                            </div>
                          </div>
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: layer.color }}
                          />
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded-2xl bg-white px-2 py-2">
                            <div className="text-slate-400">Reach</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {layer.endpoint ? formatDistance(layer.endpoint.distanceNm) : "0 NM"}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-white px-2 py-2">
                            <div className="text-slate-400">Bearing</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {layer.endpoint ? formatBearing(layer.endpoint.bearingDeg) : "0°"}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-white px-2 py-2">
                            <div className="text-slate-400">Avg GS</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {layer.endpoint
                                ? `${layer.endpoint.avgGroundspeedKt.toFixed(1)} kt`
                                : "0 kt"}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Reachability endpoints
                  </h3>
                  <p className="text-sm text-slate-500">
                    Distances and bearings for each drift horizon.
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
                      className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[0.8fr_1.15fr_0.85fr_0.85fr_0.8fr]"
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
                          {formatDistance(endpoint.distanceNm)}
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
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Vertical wind profile
                  </h3>
                  <p className="text-sm text-slate-500">
                    Snapshot for {timeLabel} at nearby sampled levels.
                  </p>
                </div>
                <Wind className="h-5 w-5 text-sky-600" />
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
