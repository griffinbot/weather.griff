import { useEffect, useMemo, useState } from "react";
import {
  Clock3,
  Loader2,
  MapPin,
  Plane,
  Route,
  Trash2,
  Wind,
} from "lucide-react";
import { useWindAloft } from "../hooks/useWindAloft";
import {
  buildFlightAltitudeOptions,
  distanceBetweenCoordinatesNm,
  formatAltitudeOptionLabel,
  simulateFlight,
  type FlightAltitudeOption,
  type SimulatedFlight,
} from "../lib/flightPlanning";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface FlightPlanningProps {
  location: Location;
}

interface LandingLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface LandingMatch {
  landingId: string;
  landingName: string;
  distanceNm: number;
}

interface FlightCandidate extends SimulatedFlight {
  closestLanding: LandingMatch | null;
}

function parseCoordinate(rawValue: string, kind: "lat" | "lon"): number | null {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  if (kind === "lat" && (parsed < -90 || parsed > 90)) return null;
  if (kind === "lon" && (parsed < -180 || parsed > 180)) return null;
  return parsed;
}

function clampDuration(rawValue: string): number | null {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(10, Math.min(360, Math.round(parsed)));
}

function formatForecastTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCoord(value: number, kind: "lat" | "lon"): string {
  const hemisphere =
    kind === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(4)}°${hemisphere}`;
}

function formatBearing(degrees: number): string {
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
  const direction = directions[Math.round(degrees / 22.5) % 16];
  return `${Math.round(degrees)}° ${direction}`;
}

function findClosestLanding(
  endpointLat: number,
  endpointLon: number,
  landingLocations: LandingLocation[],
): LandingMatch | null {
  if (landingLocations.length === 0) return null;

  let best: LandingMatch | null = null;
  for (const landing of landingLocations) {
    const distanceNm = distanceBetweenCoordinatesNm(
      endpointLat,
      endpointLon,
      landing.lat,
      landing.lon,
    );

    if (!best || distanceNm < best.distanceNm) {
      best = {
        landingId: landing.id,
        landingName: landing.name,
        distanceNm,
      };
    }
  }

  return best;
}

function sortFlightCandidates(left: FlightCandidate, right: FlightCandidate): number {
  if (left.limitedByForecast !== right.limitedByForecast) {
    return left.limitedByForecast ? 1 : -1;
  }

  const leftDistance = left.closestLanding?.distanceNm ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.closestLanding?.distanceNm ?? Number.POSITIVE_INFINITY;
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;

  if (left.distanceNm !== right.distanceNm) return right.distanceNm - left.distanceNm;
  return left.altitudeMSL_ft - right.altitudeMSL_ft;
}

export function FlightPlanning({ location }: FlightPlanningProps) {
  const [launchName, setLaunchName] = useState(location.name);
  const [launchLatInput, setLaunchLatInput] = useState(location.lat.toFixed(4));
  const [launchLonInput, setLaunchLonInput] = useState(location.lon.toFixed(4));
  const [launchPoint, setLaunchPoint] = useState({
    name: location.name,
    lat: location.lat,
    lon: location.lon,
  });
  const [flightTimeInput, setFlightTimeInput] = useState("90");
  const [selectedHourIndex, setSelectedHourIndex] = useState(0);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [landingError, setLandingError] = useState<string | null>(null);
  const [landingNameInput, setLandingNameInput] = useState("");
  const [landingLatInput, setLandingLatInput] = useState("");
  const [landingLonInput, setLandingLonInput] = useState("");
  const [landingLocations, setLandingLocations] = useState<LandingLocation[]>([]);

  const { hours, loading, error } = useWindAloft(launchPoint.lat, launchPoint.lon);

  const durationMin = clampDuration(flightTimeInput);
  const selectedHour = hours[selectedHourIndex] ?? hours[0] ?? null;
  const altitudeOptions = useMemo(
    () => buildFlightAltitudeOptions(selectedHour),
    [selectedHour],
  );

  useEffect(() => {
    setLaunchName(location.name);
    setLaunchLatInput(location.lat.toFixed(4));
    setLaunchLonInput(location.lon.toFixed(4));
    setLaunchPoint({
      name: location.name,
      lat: location.lat,
      lon: location.lon,
    });
    setFlightTimeInput("90");
    setSelectedHourIndex(0);
    setLaunchError(null);
    setLandingError(null);
    setLandingNameInput("");
    setLandingLatInput("");
    setLandingLonInput("");
    setLandingLocations([]);
  }, [location.lat, location.lon, location.name]);

  useEffect(() => {
    if (selectedHourIndex > Math.max(0, hours.length - 1)) {
      setSelectedHourIndex(Math.max(0, hours.length - 1));
    }
  }, [hours.length, selectedHourIndex]);

  const allFlightCandidates = useMemo(() => {
    if (!durationMin || hours.length === 0) return [] as FlightCandidate[];

    const candidates: FlightCandidate[] = [];
    for (const hour of hours) {
      const perHourAltitudeOptions = buildFlightAltitudeOptions(hour);
      for (const altitude of perHourAltitudeOptions) {
        const simulated = simulateFlight(
          hours,
          launchPoint.lat,
          launchPoint.lon,
          hour.time,
          durationMin,
          altitude,
        );
        if (!simulated) continue;

        candidates.push({
          ...simulated,
          closestLanding: findClosestLanding(
            simulated.endpointLat,
            simulated.endpointLon,
            landingLocations,
          ),
        });
      }
    }

    return candidates;
  }, [durationMin, hours, launchPoint.lat, launchPoint.lon, landingLocations]);

  const selectedHourProfiles = useMemo(() => {
    if (!selectedHour || !durationMin || altitudeOptions.length === 0) {
      return [] as FlightCandidate[];
    }

    return altitudeOptions
      .map((altitude) => {
        const simulated = simulateFlight(
          hours,
          launchPoint.lat,
          launchPoint.lon,
          selectedHour.time,
          durationMin,
          altitude,
        );
        if (!simulated) return null;

        return {
          ...simulated,
          closestLanding: findClosestLanding(
            simulated.endpointLat,
            simulated.endpointLon,
            landingLocations,
          ),
        };
      })
      .filter((flight): flight is FlightCandidate => flight !== null)
      .sort((left, right) => left.altitudeMSL_ft - right.altitudeMSL_ft);
  }, [
    altitudeOptions,
    durationMin,
    hours,
    launchPoint.lat,
    launchPoint.lon,
    landingLocations,
    selectedHour,
  ]);

  const bestCurrentHourFlight = useMemo(() => {
    if (selectedHourProfiles.length === 0 || landingLocations.length === 0) return null;
    return [...selectedHourProfiles].sort(sortFlightCandidates)[0] ?? null;
  }, [landingLocations.length, selectedHourProfiles]);

  const landingRecommendations = useMemo(() => {
    return landingLocations
      .map((landing) => {
        const ranked = allFlightCandidates
          .map((flight) => ({
            flight,
            distanceNm: distanceBetweenCoordinatesNm(
              flight.endpointLat,
              flight.endpointLon,
              landing.lat,
              landing.lon,
            ),
          }))
          .sort((left, right) => {
            if (left.flight.limitedByForecast !== right.flight.limitedByForecast) {
              return left.flight.limitedByForecast ? 1 : -1;
            }
            if (left.distanceNm !== right.distanceNm) return left.distanceNm - right.distanceNm;
            if (left.flight.distanceNm !== right.flight.distanceNm) {
              return right.flight.distanceNm - left.flight.distanceNm;
            }
            return left.flight.altitudeMSL_ft - right.flight.altitudeMSL_ft;
          });

        return {
          landing,
          best: ranked[0] ?? null,
        };
      })
      .filter((recommendation) => recommendation.best !== null);
  }, [allFlightCandidates, landingLocations]);

  const availableCoverageMin = useMemo(() => {
    if (!selectedHour || hours.length === 0) return 0;
    const lastHour = hours[hours.length - 1];
    return Math.max(
      0,
      Math.floor((lastHour.time.getTime() - selectedHour.time.getTime()) / 60000),
    );
  }, [hours, selectedHour]);

  const applyLaunchPoint = () => {
    const lat = parseCoordinate(launchLatInput, "lat");
    const lon = parseCoordinate(launchLonInput, "lon");
    if (lat === null || lon === null) {
      setLaunchError("Enter valid launch coordinates. Latitude must be -90..90 and longitude -180..180.");
      return;
    }

    setLaunchPoint({
      name: launchName.trim() || "Launch",
      lat,
      lon,
    });
    setSelectedHourIndex(0);
    setLaunchError(null);
  };

  const resetToSelectedLocation = () => {
    setLaunchName(location.name);
    setLaunchLatInput(location.lat.toFixed(4));
    setLaunchLonInput(location.lon.toFixed(4));
    setLaunchPoint({
      name: location.name,
      lat: location.lat,
      lon: location.lon,
    });
    setSelectedHourIndex(0);
    setLaunchError(null);
  };

  const addLandingLocation = () => {
    const lat = parseCoordinate(landingLatInput, "lat");
    const lon = parseCoordinate(landingLonInput, "lon");
    if (lat === null || lon === null) {
      setLandingError("Enter valid landing coordinates before adding a preferred landing.");
      return;
    }

    const trimmedName = landingNameInput.trim();
    const nextLanding: LandingLocation = {
      id: `${Date.now()}-${landingLocations.length}`,
      name: trimmedName || `Landing ${landingLocations.length + 1}`,
      lat,
      lon,
    };

    setLandingLocations((current) => [...current, nextLanding]);
    setLandingNameInput("");
    setLandingLatInput("");
    setLandingLonInput("");
    setLandingError(null);
  };

  const removeLandingLocation = (landingId: string) => {
    setLandingLocations((current) => current.filter((landing) => landing.id !== landingId));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-sky-100 p-3 text-sky-700">
                <Route className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold">Flight Plan Tool</h2>
                <p className="text-sm text-gray-600">
                  Model drift from the wind tables for a fixed time at altitude and compare
                  predicted endpoints against preferred landing coordinates.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <Badge variant="outline">Weather grid: {launchPoint.name}</Badge>
              {location.airport && <Badge variant="outline">{location.airport}</Badge>}
              <Badge variant="outline">
                Fixed-altitude drift model from the app&apos;s wind-profile tables
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Launch</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">
                {formatCoord(launchPoint.lat, "lat")}
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {formatCoord(launchPoint.lon, "lon")}
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Flight Time</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {durationMin ?? "--"}
              </div>
              <div className="text-xs text-gray-500">minutes at altitude</div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Profiles</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {selectedHourProfiles.length}
              </div>
              <div className="text-xs text-gray-500">altitudes at selected hour</div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Best Miss</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {bestCurrentHourFlight?.closestLanding
                  ? `${bestCurrentHourFlight.closestLanding.distanceNm.toFixed(1)} nm`
                  : "--"}
              </div>
              <div className="text-xs text-gray-500">
                {bestCurrentHourFlight?.closestLanding?.landingName ?? "Add a landing target"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-sky-600" />
            <div>
              <h3 className="text-lg font-semibold">Launch Setup</h3>
              <p className="text-sm text-gray-600">
                Update the launch coordinates to pull the wind tables for that launch point.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="launch-name">Launch Label</Label>
              <Input
                id="launch-name"
                value={launchName}
                onChange={(event) => setLaunchName(event.target.value)}
                placeholder="Launch"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="launch-lat">Launch Latitude</Label>
              <Input
                id="launch-lat"
                value={launchLatInput}
                onChange={(event) => setLaunchLatInput(event.target.value)}
                placeholder="47.4502"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="launch-lon">Launch Longitude</Label>
              <Input
                id="launch-lon"
                value={launchLonInput}
                onChange={(event) => setLaunchLonInput(event.target.value)}
                placeholder="-122.3088"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="flight-time">Flight Time At Altitude (min)</Label>
              <Input
                id="flight-time"
                type="number"
                min={10}
                max={360}
                step={5}
                value={flightTimeInput}
                onChange={(event) => setFlightTimeInput(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="launch-hour">Launch Forecast Hour</Label>
              <Select
                value={String(selectedHourIndex)}
                onValueChange={(value) => setSelectedHourIndex(Number(value))}
                disabled={hours.length === 0}
              >
                <SelectTrigger id="launch-hour">
                  <SelectValue placeholder="Select a forecast hour" />
                </SelectTrigger>
                <SelectContent>
                  {hours.map((hour, index) => (
                    <SelectItem key={hour.time.toISOString()} value={String(index)}>
                      {formatForecastTime(hour.time)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-sky-900">
                <Clock3 className="h-4 w-4" />
                Forecast coverage from this launch hour
              </div>
              <p className="mt-1 text-sm text-sky-800">
                {selectedHour
                  ? `${availableCoverageMin} minutes of downstream wind-table coverage available.`
                  : "Select a launch hour to see available coverage."}
              </p>
            </div>
          </div>

          {launchError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {launchError}
            </div>
          )}

          {!durationMin && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Enter a valid flight time between 10 and 360 minutes.
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={applyLaunchPoint}>Update Launch Weather</Button>
            <Button variant="outline" onClick={resetToSelectedLocation}>
              Reset To {location.airport || location.name}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
          <div className="flex items-center gap-3">
            <Plane className="h-5 w-5 text-sky-600" />
            <div>
              <h3 className="text-lg font-semibold">Preferred Landing Locations</h3>
              <p className="text-sm text-gray-600">
                Add one or more landing targets to rank the best altitude and launch-time
                combinations.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="landing-name">Landing Label</Label>
              <Input
                id="landing-name"
                value={landingNameInput}
                onChange={(event) => setLandingNameInput(event.target.value)}
                placeholder="Primary field"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="landing-lat">Latitude</Label>
              <Input
                id="landing-lat"
                value={landingLatInput}
                onChange={(event) => setLandingLatInput(event.target.value)}
                placeholder="47.6150"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="landing-lon">Longitude</Label>
              <Input
                id="landing-lon"
                value={landingLonInput}
                onChange={(event) => setLandingLonInput(event.target.value)}
                placeholder="-122.3400"
              />
            </div>
          </div>

          {landingError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {landingError}
            </div>
          )}

          <Button variant="outline" onClick={addLandingLocation}>
            Add Preferred Landing
          </Button>

          <div className="space-y-3">
            {landingLocations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                No landing targets yet. Add at least one coordinate pair to get ranked flight
                recommendations.
              </div>
            ) : (
              landingLocations.map((landing) => {
                const fromLaunchNm = distanceBetweenCoordinatesNm(
                  launchPoint.lat,
                  launchPoint.lon,
                  landing.lat,
                  landing.lon,
                );

                return (
                  <div
                    key={landing.id}
                    className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-gray-900">{landing.name}</p>
                        <Badge variant="outline">{fromLaunchNm.toFixed(1)} nm from launch</Badge>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {formatCoord(landing.lat, "lat")} / {formatCoord(landing.lon, "lon")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLandingLocation(landing.id)}
                      aria-label={`Remove ${landing.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <Wind className="h-5 w-5 text-sky-600" />
          <div>
            <h3 className="text-lg font-semibold">Ideal Flights For This Time Aloft</h3>
            <p className="text-sm text-gray-600">
              Best-matching launch-hour and altitude combination for each preferred landing using
              the current wind tables.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-6 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading wind profiles for the current launch coordinates.
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            {error}
          </div>
        ) : landingRecommendations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            Add preferred landing locations to get per-target recommendations.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {landingRecommendations.map(({ landing, best }) => {
              if (!best) return null;
              return (
                <div
                  key={landing.id}
                  className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-sky-700">
                        Best match for
                      </p>
                      <h4 className="mt-1 text-lg font-semibold text-gray-900">{landing.name}</h4>
                    </div>
                    <Badge variant={best.flight.limitedByForecast ? "secondary" : "outline"}>
                      {best.flight.limitedByForecast ? "Forecast limited" : "Full coverage"}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-gray-700">
                    <p>
                      <span className="font-medium text-gray-900">Launch hour:</span>{" "}
                      {formatForecastTime(best.flight.departureTime)}
                    </p>
                    <p>
                      <span className="font-medium text-gray-900">Altitude:</span>{" "}
                      {Math.round(best.flight.altitudeAGL_ft).toLocaleString()} ft AGL
                    </p>
                    <p>
                      <span className="font-medium text-gray-900">Landing miss:</span>{" "}
                      {best.distanceNm.toFixed(1)} nm
                    </p>
                    <p>
                      <span className="font-medium text-gray-900">Predicted endpoint:</span>{" "}
                      {formatCoord(best.flight.endpointLat, "lat")} /{" "}
                      {formatCoord(best.flight.endpointLon, "lon")}
                    </p>
                    <p>
                      <span className="font-medium text-gray-900">Range / track:</span>{" "}
                      {best.flight.distanceNm.toFixed(1)} nm on {formatBearing(best.flight.bearingDeg)}
                    </p>
                    <p>
                      <span className="font-medium text-gray-900">Start wind:</span>{" "}
                      {best.flight.startWindSpeedKt.toFixed(1)} kt from{" "}
                      {formatBearing(best.flight.startWindDirection)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Flight Profiles At Selected Launch Hour</h3>
            <p className="text-sm text-gray-600">
              One row per altitude sampled from the current wind tables for{" "}
              {selectedHour ? formatForecastTime(selectedHour.time) : "the selected hour"}.
            </p>
          </div>
          {bestCurrentHourFlight?.closestLanding && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Best current-hour match: {bestCurrentHourFlight.closestLanding.landingName} at{" "}
              {bestCurrentHourFlight.closestLanding.distanceNm.toFixed(1)} nm miss distance.
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-6 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Building altitude profiles from the wind tables.
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            {error}
          </div>
        ) : selectedHourProfiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            No flight profiles are available for the current inputs.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Altitude</TableHead>
                <TableHead>Start Wind</TableHead>
                <TableHead>Drift Speed</TableHead>
                <TableHead>Range / Track</TableHead>
                <TableHead>Predicted Endpoint</TableHead>
                <TableHead>Preferred Landing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedHourProfiles.map((profile) => {
                const altitude: FlightAltitudeOption = {
                  id: `${profile.altitudeMSL_ft}`,
                  altitudeAGL_ft: profile.altitudeAGL_ft,
                  altitudeMSL_ft: profile.altitudeMSL_ft,
                  source: "pressure",
                };

                return (
                  <TableRow key={`${profile.departureTime.toISOString()}-${profile.altitudeMSL_ft}`}>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium text-gray-900">
                        {formatAltitudeOptionLabel(altitude)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium text-gray-900">
                        {profile.startWindSpeedKt.toFixed(1)} kt
                      </div>
                      <div className="text-xs text-gray-500">
                        from {formatBearing(profile.startWindDirection)}
                      </div>
                    </TableCell>
                    <TableCell>{profile.avgGroundspeedKt.toFixed(1)} kt</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium text-gray-900">
                        {profile.distanceNm.toFixed(1)} nm
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatBearing(profile.bearingDeg)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium text-gray-900">
                        {formatCoord(profile.endpointLat, "lat")}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatCoord(profile.endpointLon, "lon")}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {profile.closestLanding ? (
                        <>
                          <div className="font-medium text-gray-900">
                            {profile.closestLanding.landingName}
                          </div>
                          <div className="text-xs text-gray-500">
                            {profile.closestLanding.distanceNm.toFixed(1)} nm miss
                          </div>
                        </>
                      ) : (
                        <span className="text-sm text-gray-500">No target landing set</span>
                      )}
                      {profile.limitedByForecast && (
                        <div className="mt-2">
                          <Badge variant="secondary">
                            Forecast capped at {profile.effectiveDurationMin} min
                          </Badge>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
