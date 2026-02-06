import type { PressureLevelRow, WindAloftHour } from "../hooks/useWindAloft";

export type TrajectoryBand = "baseline" | "low" | "medium" | "high";
export type TrajectorySide = "center" | "left" | "right";

export interface TrajectoryPoint {
  minute: number;
  lat: number;
  lon: number;
  eastNm: number;
  northNm: number;
}

export interface TrajectoryPath {
  horizonMin: number;
  band: TrajectoryBand;
  side: TrajectorySide;
  points: TrajectoryPoint[];
  limitedByForecast?: boolean;
}

export interface TrajectoryEndpoint {
  horizonMin: number;
  band: TrajectoryBand;
  side: TrajectorySide;
  lat: number;
  lon: number;
  distanceNm: number;
  bearingDeg: number;
  avgGroundspeedKt: number;
  limitedByForecast?: boolean;
}

export interface SpeedBands {
  lowMaxKt: number;
  medMaxKt: number;
  highMinKt: number;
  minKt: number;
  maxKt: number;
}

export interface TrajectoryResult {
  paths: TrajectoryPath[];
  endpoints: TrajectoryEndpoint[];
  speedBands: SpeedBands;
}

export interface SimulateBalloonTrajectoryParams {
  startLat: number;
  startLon: number;
  selectedAltitudeFtMsl: number;
  startTime: Date;
  horizonsMin: number[];
  hours: WindAloftHour[];
  stepMinutes?: number;
}

interface WindSample {
  timeMs: number;
  speedKt: number;
  directionDeg: number;
}

interface Variability {
  dirStdDeg: number;
  speedStdKt: number;
  meanSpeedKt: number;
}

interface BandConfig {
  band: TrajectoryBand;
  side: TrajectorySide;
  dirOffsetDeg: number;
  speedScale: number;
}

const NM_PER_DEG_LAT = 60;
const MPH_TO_KT = 0.868976;

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function shortestAngularDelta(fromDeg: number, toDeg: number): number {
  let delta = toDeg - fromDeg;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function nearestLevelByMsl(levels: PressureLevelRow[], targetMslFt: number): PressureLevelRow {
  return levels.reduce((closest, current) => {
    const currentDistance = Math.abs(current.altitudeMSL_ft - targetMslFt);
    const closestDistance = Math.abs(closest.altitudeMSL_ft - targetMslFt);
    return currentDistance < closestDistance ? current : closest;
  }, levels[0]);
}

function buildWindProfile(hours: WindAloftHour[], selectedAltitudeFtMsl: number): WindSample[] {
  return [...hours]
    .filter((hour) => hour.levels.length > 0 && Number.isFinite(hour.time.getTime()))
    .sort((a, b) => a.time.getTime() - b.time.getTime())
    .map((hour) => {
      const nearest = nearestLevelByMsl(hour.levels, selectedAltitudeFtMsl);
      return {
        timeMs: hour.time.getTime(),
        speedKt: Math.max(0, nearest.windSpeed_mph * MPH_TO_KT),
        directionDeg: normalizeDegrees(nearest.windDirection),
      };
    });
}

function interpolateWind(profile: WindSample[], targetTimeMs: number): WindSample {
  if (profile.length === 0) {
    return { timeMs: targetTimeMs, speedKt: 0, directionDeg: 0 };
  }
  if (targetTimeMs <= profile[0].timeMs) return { ...profile[0], timeMs: targetTimeMs };
  if (targetTimeMs >= profile[profile.length - 1].timeMs) {
    return { ...profile[profile.length - 1], timeMs: targetTimeMs };
  }

  for (let index = 0; index < profile.length - 1; index++) {
    const left = profile[index];
    const right = profile[index + 1];
    if (targetTimeMs < left.timeMs || targetTimeMs > right.timeMs) continue;

    const span = right.timeMs - left.timeMs;
    const t = span <= 0 ? 0 : (targetTimeMs - left.timeMs) / span;
    const speedKt = left.speedKt + (right.speedKt - left.speedKt) * t;
    const deltaDir = shortestAngularDelta(left.directionDeg, right.directionDeg);
    const directionDeg = normalizeDegrees(left.directionDeg + deltaDir * t);

    return { timeMs: targetTimeMs, speedKt, directionDeg };
  }

  return { ...profile[profile.length - 1], timeMs: targetTimeMs };
}

function computeWindVariability(profile: WindSample[]): Variability {
  if (profile.length === 0) return { dirStdDeg: 0, speedStdKt: 0, meanSpeedKt: 0 };

  const speeds = profile.map((entry) => entry.speedKt);
  const meanSpeedKt = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  const speedVariance =
    speeds.reduce((sum, speed) => sum + (speed - meanSpeedKt) ** 2, 0) / speeds.length;
  const speedStdKt = Math.sqrt(Math.max(0, speedVariance));

  const unitX = profile.reduce((sum, entry) => sum + Math.cos((entry.directionDeg * Math.PI) / 180), 0) / profile.length;
  const unitY = profile.reduce((sum, entry) => sum + Math.sin((entry.directionDeg * Math.PI) / 180), 0) / profile.length;
  const meanDirection = normalizeDegrees((Math.atan2(unitY, unitX) * 180) / Math.PI);
  const directionVariance =
    profile.reduce((sum, entry) => {
      const delta = shortestAngularDelta(meanDirection, entry.directionDeg);
      return sum + delta * delta;
    }, 0) / profile.length;
  const dirStdDeg = Math.sqrt(Math.max(0, directionVariance));

  return { dirStdDeg, speedStdKt, meanSpeedKt };
}

function getBandConfigs(variability: Variability): BandConfig[] {
  const baseSpeed = Math.max(variability.meanSpeedKt, 1);

  const lowDir = Math.max(4, 0.5 * variability.dirStdDeg);
  const medDir = Math.max(8, variability.dirStdDeg);
  const highDir = Math.max(14, 1.5 * variability.dirStdDeg);

  const lowRatio = Math.max(0.05, (0.35 * variability.speedStdKt) / baseSpeed);
  const medRatio = Math.max(0.1, (0.7 * variability.speedStdKt) / baseSpeed);
  const highRatio = Math.max(0.18, variability.speedStdKt / baseSpeed);

  return [
    { band: "baseline", side: "center", dirOffsetDeg: 0, speedScale: 1 },
    { band: "low", side: "left", dirOffsetDeg: -lowDir, speedScale: Math.max(0.2, 1 - lowRatio) },
    { band: "low", side: "right", dirOffsetDeg: lowDir, speedScale: 1 + lowRatio },
    { band: "medium", side: "left", dirOffsetDeg: -medDir, speedScale: Math.max(0.2, 1 - medRatio) },
    { band: "medium", side: "right", dirOffsetDeg: medDir, speedScale: 1 + medRatio },
    { band: "high", side: "left", dirOffsetDeg: -highDir, speedScale: Math.max(0.2, 1 - highRatio) },
    { band: "high", side: "right", dirOffsetDeg: highDir, speedScale: 1 + highRatio },
  ];
}

function findPointAtMinute(points: TrajectoryPoint[], minute: number): TrajectoryPoint {
  if (points.length === 0) {
    return { minute, lat: 0, lon: 0, eastNm: 0, northNm: 0 };
  }

  const exact = points.find((point) => point.minute === minute);
  if (exact) return exact;
  if (minute <= points[0].minute) return { ...points[0], minute };
  if (minute >= points[points.length - 1].minute) return { ...points[points.length - 1], minute };

  for (let index = 0; index < points.length - 1; index++) {
    const left = points[index];
    const right = points[index + 1];
    if (minute < left.minute || minute > right.minute) continue;

    const span = right.minute - left.minute;
    const t = span <= 0 ? 0 : (minute - left.minute) / span;
    return {
      minute,
      lat: left.lat + (right.lat - left.lat) * t,
      lon: left.lon + (right.lon - left.lon) * t,
      eastNm: left.eastNm + (right.eastNm - left.eastNm) * t,
      northNm: left.northNm + (right.northNm - left.northNm) * t,
    };
  }

  return { ...points[points.length - 1], minute };
}

function bearingFromDisplacement(eastNm: number, northNm: number): number {
  if (Math.abs(eastNm) < 1e-9 && Math.abs(northNm) < 1e-9) return 0;
  return normalizeDegrees((Math.atan2(eastNm, northNm) * 180) / Math.PI);
}

export function latLonToLocalNm(
  lat: number,
  lon: number,
  originLat: number,
  originLon: number,
): { eastNm: number; northNm: number } {
  const northNm = (lat - originLat) * NM_PER_DEG_LAT;
  const lonScale = Math.cos((originLat * Math.PI) / 180);
  const eastNm = (lon - originLon) * NM_PER_DEG_LAT * lonScale;
  return { eastNm, northNm };
}

export function localNmToLatLon(
  eastNm: number,
  northNm: number,
  originLat: number,
  originLon: number,
): { lat: number; lon: number } {
  const lat = originLat + northNm / NM_PER_DEG_LAT;
  const lonScale = Math.cos((originLat * Math.PI) / 180);
  const lon = originLon + eastNm / (NM_PER_DEG_LAT * (Math.abs(lonScale) > 1e-6 ? lonScale : 1e-6));
  return { lat, lon };
}

export function deriveDynamicSpeedBands(hoursAtAltitude: number[]): SpeedBands {
  if (hoursAtAltitude.length === 0) {
    return {
      minKt: 0,
      maxKt: 0,
      lowMaxKt: 0,
      medMaxKt: 0,
      highMinKt: 0,
    };
  }

  const sorted = [...hoursAtAltitude].sort((a, b) => a - b);
  const minKt = sorted[0];
  const maxKt = sorted[sorted.length - 1];
  const lowMaxKt = quantile(sorted, 0.4);
  const medMaxKt = Math.max(lowMaxKt, quantile(sorted, 0.75));
  const highMinKt = medMaxKt;

  return { minKt, maxKt, lowMaxKt, medMaxKt, highMinKt };
}

export function simulateBalloonTrajectory(params: SimulateBalloonTrajectoryParams): TrajectoryResult {
  const horizons = Array.from(new Set(params.horizonsMin))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (horizons.length === 0) {
    return {
      paths: [],
      endpoints: [],
      speedBands: deriveDynamicSpeedBands([]),
    };
  }

  const stepMinutes = Math.max(1, Math.floor(params.stepMinutes ?? 1));
  const startTimeMs = params.startTime.getTime();
  const profile = buildWindProfile(params.hours, params.selectedAltitudeFtMsl);

  if (profile.length === 0) {
    return {
      paths: [],
      endpoints: [],
      speedBands: deriveDynamicSpeedBands([]),
    };
  }

  const maxAvailableMinutes = Math.max(0, Math.floor((profile[profile.length - 1].timeMs - startTimeMs) / 60000));
  const effectiveHorizons = horizons.map((horizon) => Math.min(horizon, maxAvailableMinutes));
  const maxEffectiveHorizon = effectiveHorizons[effectiveHorizons.length - 1];

  const sampledBaseline: WindSample[] = [];
  for (let minute = 0; minute <= maxEffectiveHorizon; minute += stepMinutes) {
    sampledBaseline.push(interpolateWind(profile, startTimeMs + minute * 60000));
  }
  const speedBands = deriveDynamicSpeedBands(sampledBaseline.map((sample) => sample.speedKt));
  const variability = computeWindVariability(sampledBaseline);
  const configs = getBandConfigs(variability);

  const generatedPaths: TrajectoryPath[] = [];
  const generatedEndpoints: TrajectoryEndpoint[] = [];

  for (const config of configs) {
    const points: TrajectoryPoint[] = [
      { minute: 0, lat: params.startLat, lon: params.startLon, eastNm: 0, northNm: 0 },
    ];
    let eastNm = 0;
    let northNm = 0;

    for (let minute = stepMinutes; minute <= maxEffectiveHorizon; minute += stepMinutes) {
      const sample = interpolateWind(profile, startTimeMs + minute * 60000);
      const driftBearingDeg = normalizeDegrees(sample.directionDeg + config.dirOffsetDeg + 180);
      const driftBearingRad = (driftBearingDeg * Math.PI) / 180;
      const speedKt = Math.max(0, sample.speedKt * config.speedScale);
      const distanceNm = speedKt * (stepMinutes / 60);

      eastNm += Math.sin(driftBearingRad) * distanceNm;
      northNm += Math.cos(driftBearingRad) * distanceNm;

      const latLon = localNmToLatLon(eastNm, northNm, params.startLat, params.startLon);
      points.push({
        minute,
        lat: latLon.lat,
        lon: latLon.lon,
        eastNm,
        northNm,
      });
    }

    horizons.forEach((horizon, index) => {
      const effectiveHorizon = effectiveHorizons[index];
      const endpoint = findPointAtMinute(points, effectiveHorizon);
      const pathPoints = points.filter((point) => point.minute <= effectiveHorizon);
      const distanceNm = Math.sqrt(endpoint.eastNm ** 2 + endpoint.northNm ** 2);
      const avgGroundspeedKt = effectiveHorizon > 0 ? distanceNm / (effectiveHorizon / 60) : 0;

      generatedPaths.push({
        horizonMin: horizon,
        band: config.band,
        side: config.side,
        points: pathPoints,
        limitedByForecast: effectiveHorizon < horizon,
      });

      generatedEndpoints.push({
        horizonMin: horizon,
        band: config.band,
        side: config.side,
        lat: endpoint.lat,
        lon: endpoint.lon,
        distanceNm,
        bearingDeg: bearingFromDisplacement(endpoint.eastNm, endpoint.northNm),
        avgGroundspeedKt,
        limitedByForecast: effectiveHorizon < horizon,
      });
    });
  }

  return {
    paths: generatedPaths,
    endpoints: generatedEndpoints,
    speedBands,
  };
}
