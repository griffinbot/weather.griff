import { Plane, MapPin, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import {
  useNearbyStations,
  useMetar,
  useTaf,
  kmhToKnots,
  metersToSM,
  paToInHg,
  cToF,
  formatCloudLayer,
  parseTafPeriods,
} from "../hooks/useAviationWeather";
import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface AirportReportsProps {
  location: Location;
}

function normalizeStationId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,6}$/.test(normalized)) return null;
  return normalized;
}

// ─── METAR display ──────────────────────────────────────────────────
function MetarDisplay({ stationId }: { stationId: string }) {
  const { data: metar, loading, error, refetch } = useMetar(stationId);

  if (loading && !metar) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
        <span className="text-sm text-gray-500">Fetching METAR…</span>
      </div>
    );
  }

  if ((error && !metar) || !metar) {
    return (
      <div className="py-6 text-center space-y-3">
        <div className="flex items-center justify-center gap-2 text-amber-600">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-medium">
            {error ?? "No METAR data available"}
          </span>
        </div>
        <button
          onClick={refetch}
          className="text-sm text-blue-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const windKt = kmhToKnots(metar.windSpeed_kmh);
  const gustKt = kmhToKnots(metar.windGust_kmh);
  const visSM = metersToSM(metar.visibility_m);
  const altimeter = paToInHg(metar.barometricPressure_Pa);
  const tempF = cToF(metar.temperature_C);
  const dewF = cToF(metar.dewpoint_C);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-lg">{stationId} — METAR</h4>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {metar.timestamp
              ? new Date(metar.timestamp).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                })
              : ""}
          </span>
          <button
            onClick={refetch}
            className="text-gray-400 hover:text-blue-500"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-amber-600">
          Showing last successful report while refresh retries.
        </div>
      )}

      {/* Raw METAR */}
      <div className="bg-gray-900 text-green-400 p-6 rounded-xl font-mono text-sm leading-relaxed overflow-x-auto">
        {metar.raw || "Raw METAR not available"}
      </div>

      {/* Decoded */}
      <div className="bg-blue-50 p-4 rounded-xl">
        <h5 className="font-semibold text-sm mb-3 text-blue-900">
          Decoded Information
        </h5>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-blue-700">Wind: </span>
            <span className="font-medium">
              {metar.windDirection != null ? `${metar.windDirection}°` : "VRB"}{" "}
              at {windKt ?? "—"} kt
              {gustKt != null ? `, gusts ${gustKt} kt` : ""}
            </span>
          </div>
          <div>
            <span className="text-blue-700">Visibility: </span>
            <span className="font-medium">{visSM} SM</span>
          </div>
          <div>
            <span className="text-blue-700">Clouds: </span>
            <span className="font-medium">
              {metar.cloudLayers.length > 0
                ? metar.cloudLayers.map(formatCloudLayer).join(", ")
                : "CLR"}
            </span>
          </div>
          <div>
            <span className="text-blue-700">Temperature: </span>
            <span className="font-medium">
              {metar.temperature_C != null
                ? `${metar.temperature_C}°C (${tempF}°F)`
                : "—"}
            </span>
          </div>
          <div>
            <span className="text-blue-700">Dew Point: </span>
            <span className="font-medium">
              {metar.dewpoint_C != null
                ? `${metar.dewpoint_C}°C (${dewF}°F)`
                : "—"}
            </span>
          </div>
          <div>
            <span className="text-blue-700">Altimeter: </span>
            <span className="font-medium">{altimeter} inHg</span>
          </div>
          <div>
            <span className="text-blue-700">Humidity: </span>
            <span className="font-medium">
              {metar.relativeHumidity != null
                ? `${Math.round(metar.relativeHumidity)}%`
                : "—"}
            </span>
          </div>
          <div>
            <span className="text-blue-700">Conditions: </span>
            <span className="font-medium">{metar.description || "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAF display ────────────────────────────────────────────────────
function TafDisplay({ stationId }: { stationId: string }) {
  const { data: taf, loading, error, refetch } = useTaf(stationId);

  if (loading && !taf) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
        <span className="text-sm text-gray-500">Fetching TAF…</span>
      </div>
    );
  }

  if ((error && !taf) || !taf) {
    return (
      <div className="py-6 text-center space-y-3">
        <div className="flex items-center justify-center gap-2 text-amber-600">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-medium">
            {error ?? "No TAF data available for this station"}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          Not all stations issue Terminal Aerodrome Forecasts.
        </p>
        <button
          onClick={refetch}
          className="text-sm text-blue-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const parsed = parseTafPeriods(taf.raw);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-lg">{stationId} — TAF</h4>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {taf.issuanceTime
              ? `Issued ${new Date(taf.issuanceTime).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}`
              : ""}
          </span>
          <button
            onClick={refetch}
            className="text-gray-400 hover:text-blue-500"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-amber-600">
          Showing last successful report while refresh retries.
        </div>
      )}

      {/* Raw TAF */}
      <div className="bg-gray-900 text-green-400 p-6 rounded-xl font-mono text-sm leading-relaxed overflow-x-auto whitespace-pre-wrap">
        {taf.raw}
      </div>

      {/* Decoded TAF periods */}
      {parsed.periods.length > 0 && (
        <div className="bg-blue-50 p-4 rounded-xl">
          <h5 className="font-semibold text-sm mb-3 text-blue-900">
            Forecast Periods
          </h5>
          {parsed.header && (
            <div className="mb-3 text-sm text-gray-700 font-mono bg-blue-100/60 p-2 rounded">
              {parsed.header}
            </div>
          )}
          <div className="space-y-3 text-sm">
            {parsed.periods.map((period, idx) => (
              <div key={idx} className="border-l-4 border-blue-500 pl-3">
                <div className="font-medium text-blue-800">{period.label}</div>
                <div className="text-gray-700 font-mono text-xs mt-0.5">
                  {period.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────
export function AirportReports({ location }: AirportReportsProps) {
  const {
    stations,
    loading: stationsLoading,
    error: stationsError,
    refetch: refetchStations,
  } = useNearbyStations(location.lat, location.lon);

  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    normalizeStationId(location.airport),
  );

  // Auto-select first station when list loads
  useEffect(() => {
    if (stations.length > 0 && !selectedStationId) {
      setSelectedStationId(stations[0].stationId);
    }
  }, [stations, selectedStationId]);

  // Reset selection when location changes
  useEffect(() => {
    setSelectedStationId(normalizeStationId(location.airport));
  }, [location.lat, location.lon, location.airport]);

  // Limit to 8 stations for display
  const displayStations = stations.slice(0, 8);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold mb-2">Airport Reports</h2>
              <span className="text-[10px] bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
                LIVE
              </span>
            </div>
            <p className="text-gray-600">
              Real-time METAR &amp; TAF from weather.gov for nearby stations
            </p>
          </div>
          <Plane className="w-8 h-8 text-blue-500" />
        </div>
      </div>

      {/* Station list */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Nearby Observation Stations</h3>
          <button
            onClick={refetchStations}
            className="text-gray-400 hover:text-blue-500"
            title="Refresh stations"
          >
            <RefreshCw
              className={`w-4 h-4 ${stationsLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {stationsLoading && stations.length === 0 ? (
          <div className="flex items-center gap-2 py-6 justify-center">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            <span className="text-sm text-gray-500">
              Discovering nearby stations…
            </span>
          </div>
        ) : stationsError ? (
          <div className="py-6 text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-amber-600">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">{stationsError}</span>
            </div>
            <p className="text-xs text-gray-500">
              weather.gov station data is only available for US locations.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {displayStations.map((station) => (
              <button
                key={station.stationId}
                onClick={() => setSelectedStationId(station.stationId)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  selectedStationId === station.stationId
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="font-semibold text-lg font-mono">
                    {station.stationId}
                  </div>
                  {station.distance_mi === 0 && (
                    <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600 mb-1 line-clamp-1">
                  {station.name}
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <MapPin className="w-3 h-3" />
                  <span>{station.distance_mi} mi away</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reports */}
      {selectedStationId && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <Tabs defaultValue="metar" className="w-full">
            <div className="px-6 pt-6">
              <TabsList className="bg-gray-100 p-1 rounded-xl">
                <TabsTrigger
                  value="metar"
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  METAR
                </TabsTrigger>
                <TabsTrigger
                  value="taf"
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  TAF
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="metar" className="p-6 pt-4">
              <MetarDisplay stationId={selectedStationId} />
            </TabsContent>

            <TabsContent value="taf" className="p-6 pt-4">
              <TafDisplay stationId={selectedStationId} />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Source note */}
      <div className="text-xs text-gray-400 text-center">
        Data sourced from{" "}
        <a
          href="https://www.weather.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          api.weather.gov
        </a>{" "}
        (National Weather Service). Always verify with official sources before
        flight.
      </div>
    </div>
  );
}
