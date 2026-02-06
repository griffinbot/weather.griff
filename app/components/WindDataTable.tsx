import {
  Wind,
  Clock,
  Settings,
  Loader2,
  Moon,
  Sun,
  RefreshCw,
} from "lucide-react";
import {
  useWindAloft,
  interpolateToAGL,
  NORMALIZED_ALTITUDES_AGL,
  PRESSURE_LEVELS,
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Wind aloft data from Open-Meteo
  const { hours, elevation_m, loading, error, refetch } =
    useWindAloft(location.lat, location.lon);

  // Settings state (unchanged from before)
  const [altitudeFormat, setAltitudeFormat] = useState<
    "AGL" | "MSL" | "Pressure"
  >("AGL");
  const [altitudeNormalized, setAltitudeNormalized] = useState<
    "normalized" | "raw"
  >("raw");
  const [altitudeUnit, setAltitudeUnit] = useState<"ft" | "m">(
    "ft",
  );
  const [speedUnit, setSpeedUnit] = useState<
    "mph" | "kmh" | "knots" | "ms"
  >("mph");
  const [tempUnit, setTempUnit] = useState<"F" | "C">("F");
  const [distanceUnit, setDistanceUnit] = useState<
    "miles" | "km"
  >("miles");
  const [timeFormat, setTimeFormat] = useState<"12" | "24">(
    "12",
  );

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


  function getLowLevelWindStats(rows: DisplayRow[]) {
    const lowLevelRows = rows.filter((row) => row.altitudeAGL_ft <= 1500);
    if (lowLevelRows.length === 0) return { averageMph: 0, gustMph: 0 };

    const totalSpeed = lowLevelRows.reduce((sum, row) => sum + row.windSpeed, 0);
    const averageMph = Math.round(totalSpeed / lowLevelRows.length);
    const gustMph = Math.round(
      lowLevelRows.reduce((max, row) => Math.max(max, row.windSpeed), 0),
    );

    return { averageMph, gustMph };
  }

  /** Build rows for a single hour based on current settings. */
  function buildRows(hour: WindAloftHour): DisplayRow[] {
    const rows: DisplayRow[] = [];
    const rawAltitudeSet = new Set(
      hour.levels.map((lv) => lv.altitudeAGL_ft),
    );

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
      // Raw pressure-level data + synthetic lower AGL rows when pressure
      // levels start too high above the surface.
      const lowestRawAGL = hour.levels.reduce(
        (min, lv) => Math.min(min, lv.altitudeAGL_ft),
        Infinity,
      );

      if (
        altitudeFormat !== "Pressure" &&
        Number.isFinite(lowestRawAGL) &&
        lowestRawAGL > 100
      ) {
        const supplementalTargets = NORMALIZED_ALTITUDES_AGL.filter(
          (targetAGL) =>
            targetAGL < lowestRawAGL &&
            !rawAltitudeSet.has(targetAGL),
        );

        for (const targetAGL of supplementalTargets) {
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
      }

      // Then include reported model pressure levels.
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

    return rows;
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

  const getWindDirectionArrow = (deg: number) => {
    const n = ((deg % 360) + 360) % 360;
    if (n >= 337.5 || n < 22.5) return "↓";
    if (n < 67.5) return "↙";
    if (n < 112.5) return "←";
    if (n < 157.5) return "↖";
    if (n < 202.5) return "↑";
    if (n < 247.5) return "↗";
    if (n < 292.5) return "→";
    return "↘";
  };

  const getTempColor = (temp: number) => {
    if (temp >= 60) return "text-green-400";
    if (temp >= 50) return "text-green-500";
    if (temp >= 40) return "text-yellow-400";
    if (temp >= 30) return "text-blue-300";
    if (temp >= 20) return "text-blue-400";
    return "text-blue-500";
  };

  const getSpeedColor = (speed: number) => {
    if (speed >= 25) return "text-pink-200";
    if (speed >= 20) return "text-yellow-200";
    if (speed >= 15) return "text-yellow-300";
    if (speed >= 10) return "text-green-200";
    if (speed >= 5) return "text-green-300";
    return "text-white";
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

  // ── Scroll to current time on load ────────────────────────────────

  const getCardWidth = () => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return 208;
    return 280;
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

                  {/* Temperature */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      Temperature
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Pill
                        active={tempUnit === "F"}
                        onClick={() => setTempUnit("F")}
                      >
                        °F
                      </Pill>
                      <Pill
                        active={tempUnit === "C"}
                        onClick={() => setTempUnit("C")}
                      >
                        °C
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

      {/* ── Scrollable cards ─────────────────────────────────────── */}
      <div className="border-t border-gray-100 px-4 sm:px-6 pb-4 sm:pb-6">
        <div
          ref={scrollRef}
          className="flex gap-2 sm:gap-4 py-4 overflow-x-auto"
        >
          {hours.map((hour, hourIndex) => {
            const isNow = hourIndex === nowIndex;
            const rows = buildRows(hour);
            const { averageMph, gustMph } = getLowLevelWindStats(rows);
            const daytime = isDaytime(hour.time);

            return (
              <div
                key={hourIndex}
                className={`flex-shrink-0 w-[200px] sm:w-[260px] rounded-2xl overflow-hidden transition-all ${
                  isNow
                    ? "bg-gradient-to-br from-blue-500 to-blue-600 ring-2 ring-blue-400 ring-offset-2"
                    : "bg-gradient-to-br from-blue-400 to-blue-500"
                }`}
              >
                {/* Header */}
                <div className="p-4 pb-3 text-white">
                  <div className="text-2xl sm:text-3xl font-light mb-2">
                    {formatTime(hour.time)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                    <span className="font-semibold">
                      AVG ≤1500 {convertSpeed(averageMph)} {getSpeedUnitLabel()}
                    </span>
                    <span className="font-semibold">
                      GUST ≤1500 {convertSpeed(gustMph)} {getSpeedUnitLabel()}
                    </span>
                  </div>
                </div>

                {/* Weather info bar */}
                <div className="px-4 pb-3 text-white flex items-center gap-2">
                  {daytime ? (
                    <Sun className="w-4 h-4 text-yellow-300" />
                  ) : (
                    <Moon className="w-4 h-4 text-blue-200" />
                  )}
                  <span className="text-xs bg-blue-700/60 px-1.5 py-0.5 rounded font-mono font-semibold">
                    {location.airport}
                  </span>
                  <span className="text-sm font-medium">
                    {hour.cloudCover}% {cloudLabel(hour)}{" "}
                    {visLabel(hour)}
                  </span>
                </div>

                {/* Altitude data table */}
                <div className="bg-blue-600/40 backdrop-blur-sm">
                  <div className="grid grid-cols-[1.2fr_0.75fr_1fr_0.85fr] sm:grid-cols-[1fr_0.8fr_1fr_0.8fr] gap-2 sm:gap-3 px-3 py-2 text-white text-[11px] sm:text-xs font-semibold border-b border-white/20">
                    <div>ALT. ({altitudeFormat})</div>
                    <div>TEMP</div>
                    <div>DIRECTION</div>
                    <div>SPEED</div>
                  </div>

                  <div className="max-h-[500px] overflow-y-auto">
                    {rows.map((row, ri) => (
                      <div
                        key={ri}
                        className={`grid grid-cols-[1.2fr_0.75fr_1fr_0.85fr] sm:grid-cols-4 gap-2 px-3 py-1.5 text-[13px] sm:text-sm border-b border-white/10 hover:bg-white/10 transition-colors ${
                          row.isSurface ? "bg-white/5" : ""
                        }`}
                      >
                        {/* Altitude */}
                        <div className="text-white font-medium whitespace-nowrap">
                          {getDisplayAltitude(row)}{" "}
                          {!row.isSurface && (
                            <span className="inline-block ml-1 text-[10px] opacity-70">
                              {getAltitudeUnitLabel()}
                            </span>
                          )}
                        </div>

                        {/* Temperature */}
                        <div
                          className={`font-semibold ${getTempColor(row.temperature)}`}
                        >
                          {convertTemp(row.temperature)}°
                          {tempUnit}
                        </div>

                        {/* Direction */}
                        <div className="text-white font-medium flex items-center whitespace-nowrap">
                          <span className="text-lg leading-none">
                            {getWindDirectionArrow(
                              row.windDirection,
                            )}
                          </span>
                          <span className="ml-1 text-xs">
                            {row.windDirection}°
                          </span>
                        </div>

                        {/* Speed */}
                        <div
                          className={`font-semibold whitespace-nowrap ${getSpeedColor(row.windSpeed)}`}
                        >
                          {convertSpeed(row.windSpeed)}{" "}
                          {getSpeedUnitLabel()}
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
