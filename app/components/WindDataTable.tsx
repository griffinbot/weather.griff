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
const RAW_ALTITUDE_BUCKET_FT = 250;

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

// ─── Pill toggle button (reusable) ──────────────────────────────────
function Pill({
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
      className={`px-6 py-2 rounded-full border-2 transition-all font-medium ${
        active
          ? "border-green-500 text-green-500 bg-green-50"
          : "border-gray-300 text-gray-500 bg-white hover:border-gray-400"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function WindDataTable({
  location,
}: WindDataTableProps) {
  const hourColumnRefs = useRef<Array<HTMLTableCellElement | null>>([]);

  // Wind aloft data from Open-Meteo
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
    label: string; // e.g. "Surface", "262", "1000"
    temperature: number; // °F (raw)
    windSpeed: number; // mph (raw)
    windDirection: number; // degrees
    altitudeAGL_ft: number;
    altitudeMSL_ft: number;
    pressureLevel: number;
    isSurface?: boolean;
  };

  /** Build rows for a single hour based on current settings. */
  function buildRows(hour: WindAloftHour): DisplayRow[] {
    const rows: DisplayRow[] = [];

    // Surface row
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
      // Interpolate to fixed AGL altitudes
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

      // Raw pressure-level data
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
    if (row.isSurface) return "Surface";
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

  const getRowKey = (row: DisplayRow): string => {
    if (row.isSurface) return "surface";
    if (altitudeFormat === "Pressure") return `pressure-${row.pressureLevel}`;
    if (altitudeNormalized === "normalized") return `agl-${row.altitudeAGL_ft}`;
    const bucketedAltitude =
      Math.round(row.altitudeAGL_ft / RAW_ALTITUDE_BUCKET_FT) *
      RAW_ALTITUDE_BUCKET_FT;
    return `agl-${bucketedAltitude}`;
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

  const getSpeedColor = (speed: number) => {
    if (speed >= 25) return "text-rose-600";
    if (speed >= 20) return "text-amber-600";
    if (speed >= 15) return "text-yellow-600";
    if (speed >= 10) return "text-emerald-600";
    if (speed >= 5) return "text-teal-600";
    return "text-slate-700";
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

  // Cloud height label helper
  const cloudLabel = (hour: WindAloftHour) => {
    const pct = hour.cloudCover;
    let cover = "CLR";
    if (pct >= 90) cover = "OVC";
    else if (pct >= 70) cover = "BKN";
    else if (pct >= 50) cover = "SCT";
    else if (pct >= 25) cover = "FEW";

    // Estimate ceiling from low/mid/high cloud layers
    let ceiling = "—";
    if (hour.cloudCoverHigh > 20) ceiling = "@20k+";
    if (hour.cloudCoverMid > 20) ceiling = "@10k";
    if (hour.cloudCoverLow > 20) ceiling = "@3k";
    if (pct < 25) ceiling = "";

    return `${cover}${ceiling}`;
  };

  // Visibility in ground-friendly format
  const visLabel = (hour: WindAloftHour) => {
    const sm = hour.visibility_m / 1609.34;
    if (sm >= 10) return "10+SM";
    if (sm >= 6) return `${Math.round(sm)}SM`;
    return `${sm.toFixed(1)}SM`;
  };

  const getCellAltitudeLabel = (row: DisplayRow) => {
    if (row.isSurface) return "Surface";
    return `${getDisplayAltitude(row)} ${getAltitudeUnitLabel()}`;
  };

  // Is it daytime?
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

  const hourRows = useMemo(
    () => hours.map((hour) => buildRows(hour)),
    [hours, altitudeFormat, altitudeNormalized, elevationFt],
  );

  const rowDefinitions = useMemo(() => {
    const definitionMap = new Map<
      string,
      {
        key: string;
        sample: DisplayRow;
      }
    >();

    hourRows.forEach((rows) => {
      rows.forEach((row) => {
        const key = getRowKey(row);
        if (!definitionMap.has(key)) {
          definitionMap.set(key, { key, sample: row });
        }
      });
    });

    return Array.from(definitionMap.values())
      .sort((left, right) => {
        if (left.sample.isSurface) return -1;
        if (right.sample.isSurface) return 1;
        return left.sample.altitudeAGL_ft - right.sample.altitudeAGL_ft;
      })
      .map((entry) => entry.sample);
  }, [hourRows]);

  const cellLookup = useMemo(() => {
    const lookup = new Map<string, DisplayRow>();

    hourRows.forEach((rows, hourIndex) => {
      rows.forEach((row) => {
        lookup.set(`${getRowKey(row)}:${hourIndex}`, row);
      });
    });

    return lookup;
  }, [hourRows]);

  useEffect(() => {
    const hourColumn = hourColumnRefs.current[nowIndex];
    hourColumn?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "auto",
    });
  }, [hours, nowIndex]);

  const scrollToCurrentTime = () => {
    const hourColumn = hourColumnRefs.current[nowIndex];
    hourColumn?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  };

  // ── Loading / Error states ────────────────────────────────────────

  if (loading && hours.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="text-gray-500">
          Loading wind aloft data from Open-Meteo…
        </span>
      </div>
    );
  }

  if (error && hours.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 text-center">
        <p className="text-red-500 mb-2">
          Failed to load wind aloft data
        </p>
        <p className="text-sm text-gray-500 mb-4">{error}</p>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-blue-500 text-white rounded-xl text-sm hover:bg-blue-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="p-4 sm:p-6 pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-lg mb-1">
                Wind Aloft Data
              </h3>
              <span className="text-[10px] bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
                LIVE
              </span>
            </div>
            <p className="text-sm text-gray-500">
              Upper Level Winds {location.airport} · Elev{" "}
              {Math.round(elevationFt).toLocaleString()} ft MSL
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* ── Settings dialog ───────────────── */}
            <Dialog>
              <DialogTrigger asChild>
                <button className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-colors shadow-sm">
                  <Settings className="w-4 h-4" />
                  <span className="font-medium text-sm">
                    Settings
                  </span>
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white">
                <DialogHeader>
                  <DialogTitle>
                    Wind Data Display Settings
                  </DialogTitle>
                  <DialogDescription>
                    Customize how wind aloft data is displayed
                    and formatted
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  {/* Altitude Format */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      Altitude format
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={altitudeFormat === "AGL"}
                        onClick={() => setAltitudeFormat("AGL")}
                      >
                        AGL
                      </Pill>
                      <Pill
                        active={altitudeFormat === "MSL"}
                        onClick={() => setAltitudeFormat("MSL")}
                      >
                        MSL
                      </Pill>
                      <Pill
                        active={altitudeFormat === "Pressure"}
                        onClick={() =>
                          setAltitudeFormat("Pressure")
                        }
                      >
                        Pressure
                      </Pill>
                    </div>
                  </div>

                  {/* Altitude Levels */}
                  <div className="space-y-3">
                    <div>
                      <Label className="text-base font-semibold">
                        Altitude levels
                      </Label>
                      <p className="text-sm text-gray-500 mt-1">
                        Altitudes are derived from pressure
                        altitude, which varies by hour. Select
                        "normalized" to interpolate data at
                        fixed altitudes.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={
                          altitudeNormalized === "normalized"
                        }
                        onClick={() =>
                          setAltitudeNormalized("normalized")
                        }
                      >
                        Normalized
                      </Pill>
                      <Pill
                        active={altitudeNormalized === "raw"}
                        onClick={() =>
                          setAltitudeNormalized("raw")
                        }
                      >
                        Raw
                      </Pill>
                    </div>
                  </div>

                  {/* Altitude Unit */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      Altitude unit
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={altitudeUnit === "ft"}
                        onClick={() => setAltitudeUnit("ft")}
                      >
                        ft
                      </Pill>
                      <Pill
                        active={altitudeUnit === "m"}
                        onClick={() => setAltitudeUnit("m")}
                      >
                        m
                      </Pill>
                    </div>
                  </div>

                  {/* Speed */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      Speed
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={speedUnit === "mph"}
                        onClick={() => setSpeedUnit("mph")}
                      >
                        mph
                      </Pill>
                      <Pill
                        active={speedUnit === "kmh"}
                        onClick={() => setSpeedUnit("kmh")}
                      >
                        km/h
                      </Pill>
                      <Pill
                        active={speedUnit === "knots"}
                        onClick={() => setSpeedUnit("knots")}
                      >
                        knots
                      </Pill>
                      <Pill
                        active={speedUnit === "ms"}
                        onClick={() => setSpeedUnit("ms")}
                      >
                        m/s
                      </Pill>
                    </div>
                  </div>

                  {/* Distance */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      Distance
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={distanceUnit === "miles"}
                        onClick={() => setDistanceUnit("miles")}
                      >
                        miles
                      </Pill>
                      <Pill
                        active={distanceUnit === "km"}
                        onClick={() => setDistanceUnit("km")}
                      >
                        km
                      </Pill>
                    </div>
                  </div>

                  {/* Time Format */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      Time format
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={timeFormat === "12"}
                        onClick={() => setTimeFormat("12")}
                      >
                        12-hour
                      </Pill>
                      <Pill
                        active={timeFormat === "24"}
                        onClick={() => setTimeFormat("24")}
                      >
                        24-hour
                      </Pill>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <button
              onClick={refetch}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-colors shadow-sm"
              title="Refresh data"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>

            <button
              onClick={scrollToCurrentTime}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-colors shadow-sm"
            >
              <Clock className="w-4 h-4" />
              <span className="font-medium text-sm">Now</span>
            </button>
            <Wind className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes windAloftColumnIn {
          0% {
            opacity: 0;
            transform: translateX(-14px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes windAloftSweep {
          0% {
            transform: translateX(-28%);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            transform: translateX(128%);
            opacity: 0;
          }
        }
      `}</style>

      {/* ── Hour/Altitude matrix ─────────────────────────────────── */}
      <div className="border-t border-gray-100 px-4 sm:px-6 pb-4 sm:pb-6">
        <div
          className="relative overflow-x-auto overscroll-x-contain py-4"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div
            className="pointer-events-none absolute top-[5.25rem] bottom-4 left-[13rem] w-32 bg-gradient-to-r from-transparent via-blue-200/35 to-transparent"
            style={{
              animation: `windAloftSweep 6s ease-in-out infinite`,
            }}
          />

          <table className="min-w-max border-separate border-spacing-0 rounded-3xl border border-slate-200 bg-slate-200/80">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-40 w-52 min-w-52 rounded-tl-3xl border-r border-slate-200 bg-slate-950 px-4 py-4 text-left align-top text-white">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                    Altitude rows
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    Winds Aloft
                  </div>
                  <div className="mt-2 text-xs text-slate-300">
                    Rows are {altitudeFormat}{" "}
                    {altitudeFormat === "Pressure" ? "pressure levels" : "altitudes"}.
                  </div>
                  <div className="mt-3 rounded-2xl bg-white/8 px-3 py-2 text-xs text-slate-200">
                    Columns animate and read left to right by hour.
                  </div>
                </th>

                {hours.map((hour, hourIndex) => {
                  const isNow = hourIndex === nowIndex;
                  const daytime = isDaytime(hour.time);
                  const windSummary = getHourlyWindSummary(hour);

                  return (
                    <th
                      key={`hour-header-${hourIndex}`}
                      ref={(element) => {
                        hourColumnRefs.current[hourIndex] = element;
                      }}
                      className={`sticky top-0 z-30 min-w-40 border-l border-slate-200 px-4 py-4 text-left align-top text-white ${
                        isNow
                          ? "bg-gradient-to-br from-blue-600 to-blue-700"
                          : "bg-gradient-to-br from-sky-500 to-blue-600"
                      } ${hourIndex === hours.length - 1 ? "rounded-tr-3xl" : ""}`}
                      style={{
                        animation: `windAloftColumnIn 520ms ease-out both`,
                        animationDelay: `${hourIndex * 70}ms`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-2xl font-light">{formatTime(hour.time)}</div>
                        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
                          {daytime ? (
                            <Sun className="h-3.5 w-3.5 text-yellow-300" />
                          ) : (
                            <Moon className="h-3.5 w-3.5 text-blue-100" />
                          )}
                          {isNow ? "Now" : "Hour"}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-blue-50/90">
                        <span className="rounded-full bg-white/12 px-2 py-0.5 font-semibold">
                          AVG {convertSpeed(windSummary.avgMph)} {getSpeedUnitLabel()}
                        </span>
                        <span className="rounded-full bg-white/12 px-2 py-0.5 font-semibold">
                          GUST {convertSpeed(windSummary.gustMph)} {getSpeedUnitLabel()}
                        </span>
                      </div>
                      <div className="mt-3 text-xs text-blue-50/85">
                        {hour.cloudCover}% {cloudLabel(hour)} · {visLabel(hour)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {rowDefinitions.map((rowDefinition, rowIndex) => {
                const rowKey = getRowKey(rowDefinition);

                return (
                  <tr key={`row-${rowKey}`}>
                    <th
                      scope="row"
                      className={`sticky left-0 z-20 w-52 min-w-52 border-r border-t border-slate-200 px-4 py-3 text-left shadow-[10px_0_22px_rgba(15,23,42,0.16)] ${
                        rowDefinition.isSurface
                          ? "bg-slate-950 text-white"
                          : "bg-slate-900 text-slate-100"
                      } ${rowIndex === rowDefinitions.length - 1 ? "rounded-bl-3xl" : ""}`}
                    >
                      <div className="text-base font-semibold whitespace-nowrap">
                        {getDisplayAltitude(rowDefinition)}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-200">
                          {rowDefinition.isSurface ? "Launch level" : getAltitudeUnitLabel()}
                        </span>
                        {!rowDefinition.isSurface && (
                          <span className="text-slate-400">
                            {altitudeFormat}
                          </span>
                        )}
                      </div>
                    </th>

                    {hours.map((_, hourIndex) => {
                      const row = cellLookup.get(`${rowKey}:${hourIndex}`);
                      const isNow = hourIndex === nowIndex;
                      const baseCellClass = rowDefinition.isSurface
                        ? "bg-slate-50"
                        : "bg-white";

                      return (
                        <td
                          key={`cell-${rowKey}-${hourIndex}`}
                          className={`min-w-40 border-l border-t border-slate-200 px-3 py-3 align-top ${baseCellClass} ${
                            isNow ? "bg-blue-50/80" : ""
                          } ${
                            rowIndex === rowDefinitions.length - 1 && hourIndex === hours.length - 1
                              ? "rounded-br-3xl"
                              : ""
                          }`}
                        >
                          <div
                            style={{
                              animation: `windAloftColumnIn 520ms ease-out both`,
                              animationDelay: `${hourIndex * 70 + rowIndex * 18}ms`,
                            }}
                          >
                            {row ? (
                              <div className="flex min-h-[92px] flex-col justify-between rounded-2xl border border-slate-100 bg-gradient-to-br from-white via-slate-50 to-sky-50 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                                <div className="flex items-center justify-between gap-2">
                                  <div
                                    className={`text-lg font-semibold ${getSpeedColor(row.windSpeed)}`}
                                  >
                                    {convertSpeed(row.windSpeed)}
                                    <span className="ml-1 text-[11px] font-medium text-slate-500">
                                      {getSpeedUnitLabel()}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-slate-600">
                                    <ArrowUp
                                      className="h-4 w-4 shrink-0 text-sky-600"
                                      style={{
                                        transform: `rotate(${getWindDirectionRotation(
                                          row.windDirection,
                                        )}deg)`,
                                      }}
                                    />
                                    <span className="text-xs font-medium">
                                      {row.windDirection}°
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                                  <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold uppercase tracking-[0.14em] text-slate-600">
                                    {getCellAltitudeLabel(row)}
                                  </span>
                                  <span className="text-slate-500">
                                    {row.isSurface ? "Launch" : "Altitude"}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="flex min-h-[92px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                                No sample
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
