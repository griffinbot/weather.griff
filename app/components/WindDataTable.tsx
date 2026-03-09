import {
  Wind,
  Clock,
  Settings,
  Loader2,
  Moon,
  Sun,
  RefreshCw,
  ArrowUp,
} from "lucide-react";
import {
  useWindAloft,
  interpolateToAGL,
  NORMALIZED_ALTITUDES_AGL,
  WindAloftHour,
} from "../hooks/useWindAloft";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { cn } from "./ui/utils";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface WindDataTableProps {
  location: Location;
}

const WIND_TABLE_SETTINGS_STORAGE_KEY = "weather.griff.windDataSettings.v1";
const RAW_ALTITUDE_DEDUPE_TOLERANCE_FT = 5;

type AltitudeFormat = "AGL" | "MSL" | "Pressure";
type AltitudeNormalized = "normalized" | "raw";
type AltitudeUnit = "ft" | "m";
type SpeedUnit = "mph" | "kmh" | "knots" | "ms";
type TempUnit = "F" | "C";
type DistanceUnit = "miles" | "km";
type TimeFormat = "12" | "24";

type WindTableSettings = {
  altitudeFormat: AltitudeFormat;
  altitudeNormalized: AltitudeNormalized;
  altitudeUnit: AltitudeUnit;
  speedUnit: SpeedUnit;
  tempUnit: TempUnit;
  distanceUnit: DistanceUnit;
  timeFormat: TimeFormat;
};

const DEFAULT_WIND_TABLE_SETTINGS: WindTableSettings = {
  altitudeFormat: "AGL",
  altitudeNormalized: "normalized",
  altitudeUnit: "ft",
  speedUnit: "mph",
  tempUnit: "F",
  distanceUnit: "miles",
  timeFormat: "12",
};

function isAltitudeFormat(value: unknown): value is AltitudeFormat {
  return value === "AGL" || value === "MSL" || value === "Pressure";
}

function isAltitudeNormalized(value: unknown): value is AltitudeNormalized {
  return value === "normalized" || value === "raw";
}

function isAltitudeUnit(value: unknown): value is AltitudeUnit {
  return value === "ft" || value === "m";
}

function isSpeedUnit(value: unknown): value is SpeedUnit {
  return value === "mph" || value === "kmh" || value === "knots" || value === "ms";
}

function isTempUnit(value: unknown): value is TempUnit {
  return value === "F" || value === "C";
}

function isDistanceUnit(value: unknown): value is DistanceUnit {
  return value === "miles" || value === "km";
}

function isTimeFormat(value: unknown): value is TimeFormat {
  return value === "12" || value === "24";
}

function readWindTableSettings(): WindTableSettings {
  if (typeof window === "undefined") return DEFAULT_WIND_TABLE_SETTINGS;
  const raw = window.localStorage.getItem(WIND_TABLE_SETTINGS_STORAGE_KEY);
  if (!raw) return DEFAULT_WIND_TABLE_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<WindTableSettings>;
    return {
      altitudeFormat: isAltitudeFormat(parsed.altitudeFormat)
        ? parsed.altitudeFormat
        : DEFAULT_WIND_TABLE_SETTINGS.altitudeFormat,
      altitudeNormalized: isAltitudeNormalized(parsed.altitudeNormalized)
        ? parsed.altitudeNormalized
        : DEFAULT_WIND_TABLE_SETTINGS.altitudeNormalized,
      altitudeUnit: isAltitudeUnit(parsed.altitudeUnit)
        ? parsed.altitudeUnit
        : DEFAULT_WIND_TABLE_SETTINGS.altitudeUnit,
      speedUnit: isSpeedUnit(parsed.speedUnit)
        ? parsed.speedUnit
        : DEFAULT_WIND_TABLE_SETTINGS.speedUnit,
      tempUnit: isTempUnit(parsed.tempUnit)
        ? parsed.tempUnit
        : DEFAULT_WIND_TABLE_SETTINGS.tempUnit,
      distanceUnit: isDistanceUnit(parsed.distanceUnit)
        ? parsed.distanceUnit
        : DEFAULT_WIND_TABLE_SETTINGS.distanceUnit,
      timeFormat: isTimeFormat(parsed.timeFormat)
        ? parsed.timeFormat
        : DEFAULT_WIND_TABLE_SETTINGS.timeFormat,
    };
  } catch {
    return DEFAULT_WIND_TABLE_SETTINGS;
  }
}

// ─── Settings pill toggle ────────────────────────────────────────────
function SettingsPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3.5 py-1.5 rounded-md text-xs font-medium transition-all border",
        active
          ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
          : "border-white/8 bg-white/3 text-slate-400 hover:border-white/15 hover:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function WindDataTable({
  location,
}: WindDataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { hours, elevation_m, loading, error, refetch } =
    useWindAloft(location.lat, location.lon);

  const [altitudeFormat, setAltitudeFormat] = useState<AltitudeFormat>(
    DEFAULT_WIND_TABLE_SETTINGS.altitudeFormat,
  );
  const [altitudeNormalized, setAltitudeNormalized] = useState<AltitudeNormalized>(
    DEFAULT_WIND_TABLE_SETTINGS.altitudeNormalized,
  );
  const [altitudeUnit, setAltitudeUnit] = useState<AltitudeUnit>(
    DEFAULT_WIND_TABLE_SETTINGS.altitudeUnit,
  );
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>(
    DEFAULT_WIND_TABLE_SETTINGS.speedUnit,
  );
  const [tempUnit, setTempUnit] = useState<TempUnit>(
    DEFAULT_WIND_TABLE_SETTINGS.tempUnit,
  );
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(
    DEFAULT_WIND_TABLE_SETTINGS.distanceUnit,
  );
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(
    DEFAULT_WIND_TABLE_SETTINGS.timeFormat,
  );

  useEffect(() => {
    const loaded = readWindTableSettings();
    setAltitudeFormat(loaded.altitudeFormat);
    setAltitudeNormalized(loaded.altitudeNormalized);
    setAltitudeUnit(loaded.altitudeUnit);
    setSpeedUnit(loaded.speedUnit);
    setTempUnit(loaded.tempUnit);
    setDistanceUnit(loaded.distanceUnit);
    setTimeFormat(loaded.timeFormat);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const settingsToSave: WindTableSettings = {
      altitudeFormat,
      altitudeNormalized,
      altitudeUnit,
      speedUnit,
      tempUnit,
      distanceUnit,
      timeFormat,
    };
    window.localStorage.setItem(
      WIND_TABLE_SETTINGS_STORAGE_KEY,
      JSON.stringify(settingsToSave),
    );
  }, [
    altitudeFormat,
    altitudeNormalized,
    altitudeUnit,
    speedUnit,
    tempUnit,
    distanceUnit,
    timeFormat,
  ]);

  const elevationFt = elevation_m * 3.28084;

  // ── Derive display rows from raw API data ─────────────────────────

  type DisplayRow = {
    label: string;
    temperature: number;
    windSpeed: number;
    windDirection: number;
    altitudeAGL_ft: number;
    altitudeMSL_ft: number;
    pressureLevel: number;
    isSurface?: boolean;
  };

  function buildRows(hour: WindAloftHour): DisplayRow[] {
    const rows: DisplayRow[] = [];

    rows.push({
      label: "Surface",
      temperature: hour.surfaceTemp_F,
      windSpeed: hour.surfaceWindSpeed_mph,
      windDirection: hour.surfaceWindDirection,
      altitudeAGL_ft: 0,
      altitudeMSL_ft: Math.round(elevationFt),
      pressureLevel: 0,
      isSurface: true,
    });

    if (
      altitudeNormalized === "normalized" &&
      altitudeFormat !== "Pressure"
    ) {
      for (const targetAGL of NORMALIZED_ALTITUDES_AGL) {
        const interp = interpolateToAGL(hour.levels, targetAGL);
        if (interp) {
          rows.push({
            label: String(targetAGL),
            temperature: interp.temperature_F,
            windSpeed: interp.windSpeed_mph,
            windDirection: interp.windDirection,
            altitudeAGL_ft: targetAGL,
            altitudeMSL_ft: targetAGL + Math.round(elevationFt),
            pressureLevel: interp.pressureLevel,
          });
        }
      }
    } else {
      if (altitudeFormat !== "Pressure") {
        for (const lv of hour.nearSurfaceLevels) {
          rows.push({
            label: String(lv.altitudeAGL_ft),
            temperature: lv.temperature_F,
            windSpeed: lv.windSpeed_mph,
            windDirection: lv.windDirection,
            altitudeAGL_ft: lv.altitudeAGL_ft,
            altitudeMSL_ft: lv.altitudeMSL_ft,
            pressureLevel: 0,
          });
        }
      }

      for (const lv of hour.levels) {
        rows.push({
          label:
            altitudeFormat === "Pressure"
              ? String(lv.pressureLevel)
              : String(lv.altitudeAGL_ft),
          temperature: lv.temperature_F,
          windSpeed: lv.windSpeed_mph,
          windDirection: lv.windDirection,
          altitudeAGL_ft: lv.altitudeAGL_ft,
          altitudeMSL_ft: lv.altitudeMSL_ft,
          pressureLevel: lv.pressureLevel,
        });
      }

      rows.sort((a, b) => a.altitudeAGL_ft - b.altitudeAGL_ft);
    }

    if (rows.length <= 1) return rows;
    const [surface, ...upperRows] = rows;
    upperRows.sort((a, b) => a.altitudeAGL_ft - b.altitudeAGL_ft);
    if (altitudeNormalized === "raw" && altitudeFormat !== "Pressure") {
      const dedupedRows = upperRows.filter((row, index) => {
        if (index === 0) return true;
        const previous = upperRows[index - 1];
        return (
          Math.abs(row.altitudeAGL_ft - previous.altitudeAGL_ft) >
          RAW_ALTITUDE_DEDUPE_TOLERANCE_FT
        );
      });
      return [surface, ...dedupedRows];
    }
    return [surface, ...upperRows];
  }

  // ── Display helpers ───────────────────────────────────────────────

  const getDisplayAltitude = (row: DisplayRow): string => {
    if (row.isSurface) return "SFC";
    if (altitudeFormat === "Pressure")
      return `${row.pressureLevel}`;
    const baseFt =
      altitudeFormat === "MSL"
        ? row.altitudeMSL_ft
        : row.altitudeAGL_ft;
    const converted =
      altitudeUnit === "m"
        ? Math.round(baseFt * 0.3048)
        : baseFt;
    return converted.toLocaleString();
  };

  const getAltitudeUnitLabel = (): string => {
    if (altitudeFormat === "Pressure") return "mb";
    return altitudeUnit;
  };

  const convertSpeed = (mph: number): number => {
    switch (speedUnit) {
      case "kmh":
        return Math.round(mph * 1.60934);
      case "knots":
        return Math.round(mph * 0.868976);
      case "ms":
        return Math.round(mph * 0.44704 * 10) / 10;
      default:
        return mph;
    }
  };

  const convertTemp = (f: number): number => {
    if (tempUnit === "C") return Math.round(((f - 32) * 5) / 9);
    return f;
  };

  const getSpeedUnitLabel = (): string => {
    switch (speedUnit) {
      case "kmh":
        return "km/h";
      case "knots":
        return "kt";
      case "ms":
        return "m/s";
      default:
        return "mph";
    }
  };

  const formatTime = (date: Date) => {
    const h = date.getHours();
    const m = date.getMinutes();
    if (timeFormat === "24")
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    const ampm = h >= 12 ? "p" : "a";
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
  };

  const getWindDirectionRotation = (deg: number) => {
    const normalized = ((deg % 360) + 360) % 360;
    return (normalized + 180) % 360;
  };

  const getTempColor = (temp: number) => {
    if (temp >= 60) return "text-emerald-400";
    if (temp >= 50) return "text-emerald-500";
    if (temp >= 40) return "text-amber-400";
    if (temp >= 30) return "text-sky-300";
    if (temp >= 20) return "text-sky-400";
    return "text-blue-400";
  };

  const getSpeedColor = (speed: number) => {
    if (speed >= 25) return "text-red-300";
    if (speed >= 20) return "text-orange-300";
    if (speed >= 15) return "text-amber-300";
    if (speed >= 10) return "text-emerald-300";
    if (speed >= 5) return "text-emerald-400";
    return "text-slate-300";
  };

  const getHourlyWindSummary = (hour: WindAloftHour) => {
    const profileSpeedsMph = [
      hour.surfaceWindSpeed_mph,
      ...hour.nearSurfaceLevels.map((level) => level.windSpeed_mph),
      ...hour.levels.map((level) => level.windSpeed_mph),
    ].filter((value) => Number.isFinite(value) && value >= 0);

    const avgMph =
      profileSpeedsMph.length > 0
        ? Math.round(
            profileSpeedsMph.reduce((sum, value) => sum + value, 0) /
              profileSpeedsMph.length,
          )
        : hour.surfaceWindSpeed_mph;

    const profilePeakMph =
      profileSpeedsMph.length > 0
        ? Math.max(...profileSpeedsMph)
        : hour.surfaceWindSpeed_mph;

    return {
      avgMph,
      gustMph: Math.max(hour.surfaceWindGust_mph, profilePeakMph),
    };
  };

  const cloudLabel = (hour: WindAloftHour) => {
    const pct = hour.cloudCover;
    let cover = "CLR";
    if (pct >= 90) cover = "OVC";
    else if (pct >= 70) cover = "BKN";
    else if (pct >= 50) cover = "SCT";
    else if (pct >= 25) cover = "FEW";

    let ceiling = "—";
    if (hour.cloudCoverHigh > 20) ceiling = "@20k+";
    if (hour.cloudCoverMid > 20) ceiling = "@10k";
    if (hour.cloudCoverLow > 20) ceiling = "@3k";
    if (pct < 25) ceiling = "";

    return `${cover}${ceiling}`;
  };

  const visLabel = (hour: WindAloftHour) => {
    const sm = hour.visibility_m / 1609.34;
    if (sm >= 10) return "10+SM";
    if (sm >= 6) return `${Math.round(sm)}SM`;
    return `${sm.toFixed(1)}SM`;
  };

  const isDaytime = (date: Date) => {
    const h = date.getHours();
    return h >= 6 && h < 20;
  };

  // ── Find closest-to-now index ─────────────────────────────────────

  const nowIndex = useMemo(() => {
    if (hours.length === 0) return 0;
    const now = Date.now();
    let best = 0;
    let bestDiff = Infinity;
    hours.forEach((h, i) => {
      const d = Math.abs(h.time.getTime() - now);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    });
    return best;
  }, [hours]);

  // ── Scroll to current time on load ────────────────────────────────

  const getCardWidth = () => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return 220;
    return 268;
  };

  useEffect(() => {
    if (scrollRef.current && hours.length > 0) {
      const container = scrollRef.current;
      const cardWidth = getCardWidth();
      const scrollPosition =
        cardWidth * nowIndex -
        container.clientWidth / 2 +
        cardWidth / 2;
      container.scrollLeft = Math.max(0, scrollPosition);
    }
  }, [hours, nowIndex]);

  const scrollToCurrentTime = () => {
    if (scrollRef.current && hours.length > 0) {
      const container = scrollRef.current;
      const cardWidth = getCardWidth();
      const scrollPosition =
        cardWidth * nowIndex -
        container.clientWidth / 2 +
        cardWidth / 2;
      container.scrollTo({
        left: Math.max(0, scrollPosition),
        behavior: "smooth",
      });
    }
  };

  // ── Loading / Error states ────────────────────────────────────────

  if (loading && hours.length === 0) {
    return (
      <div className="rounded-xl border border-white/8 bg-surface-elevated p-8 flex items-center justify-center gap-3">
        <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
        <span className="text-sm text-slate-400">Loading wind aloft data...</span>
      </div>
    );
  }

  if (error && hours.length === 0) {
    return (
      <div className="rounded-xl border border-red-500/15 bg-surface-elevated p-8 text-center">
        <p className="text-sm text-red-400 mb-2">Failed to load wind aloft data</p>
        <p className="text-xs text-slate-500 mb-4">{error}</p>
        <button
          onClick={refetch}
          className="px-4 py-1.5 bg-amber-500/15 text-amber-300 rounded-lg text-xs font-medium hover:bg-amber-500/25 transition border border-amber-500/20"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-white/8 bg-surface-elevated">
      <div className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Wind Aloft Data</h3>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-400 border border-emerald-500/20">
                LIVE
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {location.airport} · Elev {Math.round(elevationFt).toLocaleString()} ft MSL
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Dialog>
              <DialogTrigger asChild>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/8 text-slate-400 rounded-lg transition border border-white/8">
                  <Settings className="w-3.5 h-3.5" />
                  <span className="text-xs">Settings</span>
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-surface-elevated border-white/10">
                <DialogHeader>
                  <DialogTitle className="text-white">Wind Data Display Settings</DialogTitle>
                  <DialogDescription className="text-slate-400">
                    Customize how wind aloft data is displayed and formatted
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-3">
                  <div className="space-y-2.5">
                    <Label className="text-sm font-semibold text-slate-300">Altitude format</Label>
                    <div className="flex flex-wrap gap-1.5">
                      <SettingsPill active={altitudeFormat === "AGL"} onClick={() => setAltitudeFormat("AGL")}>AGL</SettingsPill>
                      <SettingsPill active={altitudeFormat === "MSL"} onClick={() => setAltitudeFormat("MSL")}>MSL</SettingsPill>
                      <SettingsPill active={altitudeFormat === "Pressure"} onClick={() => setAltitudeFormat("Pressure")}>Pressure</SettingsPill>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <Label className="text-sm font-semibold text-slate-300">Altitude levels</Label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Select "normalized" to interpolate data at fixed altitudes.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <SettingsPill active={altitudeNormalized === "normalized"} onClick={() => setAltitudeNormalized("normalized")}>Normalized</SettingsPill>
                      <SettingsPill active={altitudeNormalized === "raw"} onClick={() => setAltitudeNormalized("raw")}>Raw</SettingsPill>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-sm font-semibold text-slate-300">Altitude unit</Label>
                    <div className="flex flex-wrap gap-1.5">
                      <SettingsPill active={altitudeUnit === "ft"} onClick={() => setAltitudeUnit("ft")}>ft</SettingsPill>
                      <SettingsPill active={altitudeUnit === "m"} onClick={() => setAltitudeUnit("m")}>m</SettingsPill>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-sm font-semibold text-slate-300">Speed</Label>
                    <div className="flex flex-wrap gap-1.5">
                      <SettingsPill active={speedUnit === "mph"} onClick={() => setSpeedUnit("mph")}>mph</SettingsPill>
                      <SettingsPill active={speedUnit === "kmh"} onClick={() => setSpeedUnit("kmh")}>km/h</SettingsPill>
                      <SettingsPill active={speedUnit === "knots"} onClick={() => setSpeedUnit("knots")}>knots</SettingsPill>
                      <SettingsPill active={speedUnit === "ms"} onClick={() => setSpeedUnit("ms")}>m/s</SettingsPill>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-sm font-semibold text-slate-300">Temperature</Label>
                    <div className="flex flex-wrap gap-1.5">
                      <SettingsPill active={tempUnit === "F"} onClick={() => setTempUnit("F")}>°F</SettingsPill>
                      <SettingsPill active={tempUnit === "C"} onClick={() => setTempUnit("C")}>°C</SettingsPill>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-sm font-semibold text-slate-300">Distance</Label>
                    <div className="flex flex-wrap gap-1.5">
                      <SettingsPill active={distanceUnit === "miles"} onClick={() => setDistanceUnit("miles")}>miles</SettingsPill>
                      <SettingsPill active={distanceUnit === "km"} onClick={() => setDistanceUnit("km")}>km</SettingsPill>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label className="text-sm font-semibold text-slate-300">Time format</Label>
                    <div className="flex flex-wrap gap-1.5">
                      <SettingsPill active={timeFormat === "12"} onClick={() => setTimeFormat("12")}>12-hour</SettingsPill>
                      <SettingsPill active={timeFormat === "24"} onClick={() => setTimeFormat("24")}>24-hour</SettingsPill>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <button
              onClick={refetch}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/8 text-slate-400 rounded-lg transition border border-white/8"
              title="Refresh data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>

            <button
              onClick={scrollToCurrentTime}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-lg transition border border-amber-500/20"
            >
              <Clock className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Now</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable cards ─────────────────────────────────────── */}
      <div className="border-t border-white/6 px-3 sm:px-4 pb-3 sm:pb-4">
        <div
          ref={scrollRef}
          className="flex gap-2 sm:gap-3 py-3 overflow-x-auto overscroll-x-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {hours.map((hour, hourIndex) => {
            const isNow = hourIndex === nowIndex;
            const rows = buildRows(hour);
            const daytime = isDaytime(hour.time);
            const windSummary = getHourlyWindSummary(hour);

            return (
              <div
                key={hourIndex}
                className={cn(
                  "flex-shrink-0 w-[212px] sm:w-[252px] rounded-lg overflow-hidden transition-all",
                  isNow
                    ? "bg-gradient-to-b from-slate-800 to-slate-900 ring-1 ring-amber-500/40"
                    : "bg-gradient-to-b from-slate-800/60 to-slate-900/60 border border-white/6",
                )}
              >
                {/* Header */}
                <div className="p-3 pb-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-lg sm:text-xl font-light text-white">
                      {formatTime(hour.time)}
                    </div>
                    {isNow && (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-amber-300 border border-amber-500/25">
                        NOW
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                    <span className="font-semibold">CIN {hour.cin}</span>
                    <span className="font-semibold">CAPE {hour.cape}</span>
                    <span className="font-semibold">AVG {convertSpeed(windSummary.avgMph)} {getSpeedUnitLabel()}</span>
                    <span className="font-semibold text-orange-300">G{convertSpeed(windSummary.gustMph)}</span>
                  </div>
                </div>

                {/* Weather info bar */}
                <div className="px-3 pb-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                  {daytime ? (
                    <Sun className="w-3 h-3 text-amber-300" />
                  ) : (
                    <Moon className="w-3 h-3 text-indigo-300" />
                  )}
                  <span className="font-mono font-bold text-slate-500">{location.airport}</span>
                  <span>{hour.cloudCover}% {cloudLabel(hour)} {visLabel(hour)}</span>
                </div>

                {/* Altitude data table */}
                <div className="bg-white/[0.02]">
                  <div className="grid grid-cols-[1.05fr_0.7fr_0.95fr_1fr] gap-1 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-600 border-b border-white/6">
                    <div>ALT</div>
                    <div>TMP</div>
                    <div>DIR</div>
                    <div>SPD</div>
                  </div>

                  <div>
                    {rows.map((row, ri) => (
                      <div
                        key={ri}
                        className={cn(
                          "grid grid-cols-[1.05fr_0.7fr_0.95fr_1fr] gap-1 px-2.5 py-1 text-[11px] border-b border-white/4 hover:bg-white/[0.04] transition-colors",
                          row.isSurface && "bg-white/[0.03]",
                        )}
                      >
                        <div className="text-slate-300 font-medium whitespace-nowrap">
                          {getDisplayAltitude(row)}
                          {!row.isSurface && (
                            <span className="ml-0.5 text-[8px] text-slate-600">{getAltitudeUnitLabel()}</span>
                          )}
                        </div>
                        <div className={`font-semibold ${getTempColor(row.temperature)}`}>
                          {convertTemp(row.temperature)}°
                        </div>
                        <div className="text-slate-300 flex items-center whitespace-nowrap">
                          <ArrowUp
                            className="w-3 h-3 shrink-0"
                            style={{
                              transform: `rotate(${getWindDirectionRotation(row.windDirection)}deg)`,
                            }}
                          />
                          <span className="ml-0.5 text-[10px]">{row.windDirection}°</span>
                        </div>
                        <div className={`font-semibold whitespace-nowrap ${getSpeedColor(row.windSpeed)}`}>
                          {convertSpeed(row.windSpeed)} <span className="text-[8px] font-normal text-slate-600">{getSpeedUnitLabel()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
