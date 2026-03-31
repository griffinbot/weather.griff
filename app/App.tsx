import { useState, useEffect, useRef } from "react";
import { Search, Wind, FileText, Plane, Calendar, Loader2, Bookmark, BookmarkCheck, MessageSquare, SlidersHorizontal, Navigation } from "lucide-react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { CurrentWeather } from "./components/CurrentWeather";
import { WindDataTable } from "./components/WindDataTable";
import { WeatherDiscussion } from "./components/WeatherDiscussion";
import { AirportReports } from "./components/AirportReports";
import { WindVisualization } from "./components/WindVisualization";
import { FlightPlanning } from "./components/FlightPlanning";
import { SevenDayOutlook } from "./components/SevenDayOutlook";
import { AIAssistantPanel } from "./components/AIAssistantPanel";
import { SavedLocationWidget } from "./components/SavedLocationWidget";
import { Footer } from "./components/Footer";
import { cachedFetch, weatherGovFetch } from "./services/weatherProxy";
import { DEFAULT_SAVED_LOCATIONS } from "../shared/contracts";
import type { SavedLocationRecord } from "../shared/contracts";

const navTabs = [
  { value: "overview", label: "Overview", icon: SlidersHorizontal },
  { value: "discussion", label: "Discussion", icon: FileText },
  { value: "airports", label: "Airports", icon: Plane },
  { value: "outlook", label: "7-Day", icon: Calendar },
  { value: "wind-viz", label: "Wind Viz", icon: Wind },
  { value: "flight", label: "Flight Plan", icon: Navigation },
] as const;

type TabValue = (typeof navTabs)[number]["value"];

interface SearchResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  class?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country_code?: string;
  };
  extratags?: {
    iata?: string;
    icao?: string;
    ref?: string;
    local_ref?: string;
    [key: string]: string | undefined;
  };
}

interface OpenMeteoGeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  admin1?: string;
  timezone?: string;
}

interface SavedLocation extends SavedLocationRecord {
  airportLookupPending?: boolean;
}

const SAVED_LOCATIONS_STORAGE_KEY = "weather.griff.savedLocations.v1";
const SELECTED_LOCATION_ID_STORAGE_KEY = "weather.griff.selectedLocationId.v1";

interface UserCoordinates {
  lat: number;
  lon: number;
}

async function safeParseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 5500): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await safeParseJson<T>(res);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isAirportLike(result: SearchResult): boolean {
  return (
    !!result.extratags?.iata ||
    !!result.extratags?.icao ||
    result.class === "aeroway" ||
    result.type === "aerodrome" ||
    result.display_name.toLowerCase().includes("airport")
  );
}

function isUSResult(result: SearchResult): boolean {
  const countryCode = result.address?.country_code?.toLowerCase();
  if (countryCode) return countryCode === "us";
  return result.display_name.toLowerCase().includes("united states");
}

function normalizeAirportCode(value: string | undefined | null): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{3,5}$/.test(normalized)) return null;
  return normalized;
}

function normalizeIcaoCode(value: string | undefined | null): string | null {
  const normalized = normalizeAirportCode(value);
  if (!normalized) return null;
  if (!/^[A-Z]{4}$/.test(normalized)) return null;
  return normalized;
}

function normalizeAirportSearchCode(value: string | undefined | null): string | null {
  const normalized = normalizeAirportCode(value);
  if (!normalized) return null;
  return normalized.length >= 3 && normalized.length <= 4 ? normalized : null;
}

function airportCodeFromUserSearch(
  value: string | undefined | null,
  result: SearchResult,
): string | null {
  const normalized = normalizeAirportSearchCode(value);
  if (!normalized) return null;
  if (normalized.length === 3 && isUSResult(result)) return `K${normalized}`;
  return normalized;
}

function bestAirportCodeFromResult(result: SearchResult): string | null {
  const directIcao = normalizeIcaoCode(result.extratags?.icao);
  if (directIcao) return directIcao;

  const iata = normalizeAirportCode(result.extratags?.iata);
  if (iata && /^[A-Z]{3}$/.test(iata) && isUSResult(result)) return `K${iata}`;

  return (
    normalizeIcaoCode(result.extratags?.ref) ||
    normalizeIcaoCode(result.extratags?.local_ref)
  );
}

function isPlaceholderAirportCode(code: string): boolean {
  return code === "ARPT" || code === "GPS";
}

function isIcaoAirportResult(result: SearchResult): boolean {
  return bestAirportCodeFromResult(result) !== null;
}

function normalizeOfficeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cleaned)) return null;
  return cleaned;
}

function officeCodeFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const part = value.split("/").filter(Boolean).pop();
  return normalizeOfficeCode(part ?? null);
}

function toWeatherGovProxyPath(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("https://api.weather.gov/")) {
    const parsed = new URL(pathOrUrl);
    return `/api/weather-gov${parsed.pathname}${parsed.search}`;
  }
  if (pathOrUrl.startsWith("/api/weather-gov/")) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return `/api/weather-gov${pathOrUrl}`;
  return `/api/weather-gov/${pathOrUrl}`;
}

function resolveLatestProductPath(product: any): string | null {
  const atId = product?.["@id"];
  if (typeof atId === "string" && atId.length > 0) return toWeatherGovProxyPath(atId);
  const id = product?.id;
  if (typeof id === "string" && id.length > 0) return `/api/weather-gov/products/${id}`;
  if (typeof id === "number") return `/api/weather-gov/products/${String(id)}`;
  return null;
}

function officeMatchesProduct(product: any, officeCode: string): boolean {
  const code = officeCode.toUpperCase();
  const issuingOffice = String(product?.issuingOffice ?? product?.office ?? "").toUpperCase();
  const wmo = String(product?.wmoCollectiveId ?? product?.productIdentifier ?? "").toUpperCase();
  return issuingOffice.includes(`/${code}`) || issuingOffice.endsWith(code) || wmo.includes(code);
}

function normalizeMajorStationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase();
  if (!/^[KP][A-Z]{3}$/.test(cleaned)) return null;
  return cleaned;
}

function pickNearbyMajorStations(features: any[], currentAirport: string): string[] {
  const current = normalizeMajorStationId(currentAirport);
  const rows = features
    .map((feature) => {
      const id = normalizeMajorStationId(feature?.properties?.stationIdentifier);
      if (!id) return null;
      const name = String(feature?.properties?.name ?? "").toUpperCase();
      const majorHint =
        name.includes("INTERNATIONAL") ||
        name.includes("INTL") ||
        name.includes("REGIONAL") ||
        name.includes("MUNICIPAL") ||
        name.includes("FIELD") ||
        name.includes("AIRPORT");
      let score = 0;
      if (id === current) score += 100;
      if (majorHint) score += 20;
      if (id.startsWith("K")) score += 10;
      return { id, score };
    })
    .filter((row): row is { id: string; score: number } => row !== null);

  rows.sort((a, b) => b.score - a.score);
  const unique: string[] = [];
  for (const row of rows) {
    if (!unique.includes(row.id)) unique.push(row.id);
    if (unique.length >= 2) break;
  }

  if (current && !unique.includes(current)) {
    return [current, ...unique].slice(0, 2);
  }
  return unique;
}

function dedupeByPlaceId(results: SearchResult[]): SearchResult[] {
  const seen = new Set<number>();
  const output: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.place_id)) continue;
    seen.add(result.place_id);
    output.push(result);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSavedLocationsFromStorage(value: unknown): SavedLocation[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: SavedLocation[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;

    const { id, name, lat, lon, airport, airportLookupPending } = entry;
    if (typeof id !== "string" || id.trim().length === 0) return null;
    if (typeof name !== "string" || name.trim().length === 0) return null;
    if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
    if (typeof lon !== "number" || !Number.isFinite(lon)) return null;
    if (typeof airport !== "string" || airport.trim().length === 0) return null;

    parsed.push({
      id,
      name,
      lat,
      lon,
      airport,
      airportLookupPending:
        typeof airportLookupPending === "boolean" ? airportLookupPending : undefined,
    });
  }

  return parsed.length > 0 ? parsed : null;
}

function loadInitialLocationsState(): {
  savedLocations: SavedLocation[];
  selectedLocation: SavedLocation;
} {
  if (typeof window === "undefined") {
    return { savedLocations: DEFAULT_SAVED_LOCATIONS, selectedLocation: DEFAULT_SAVED_LOCATIONS[0] };
  }

  try {
    const storedLocations = window.localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY);
    const storedSelectedLocationId = window.localStorage.getItem(
      SELECTED_LOCATION_ID_STORAGE_KEY,
    );
    const parsedLocations = storedLocations
      ? parseSavedLocationsFromStorage(JSON.parse(storedLocations))
      : null;
    const savedLocations = parsedLocations ?? DEFAULT_SAVED_LOCATIONS;
    const selectedLocation =
      (storedSelectedLocationId
        ? savedLocations.find((location) => location.id === storedSelectedLocationId)
        : null) ?? savedLocations[0];

    return { savedLocations, selectedLocation };
  } catch {
    return { savedLocations: DEFAULT_SAVED_LOCATIONS, selectedLocation: DEFAULT_SAVED_LOCATIONS[0] };
  }
}

function distanceMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * sinHalfLon * sinHalfLon;
  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function prioritizeSearchResults(
  results: SearchResult[],
  query: string,
  userCoordinates: UserCoordinates | null,
): SearchResult[] {
  const airportCodeQuery = query.trim().toUpperCase();
  return [...results].sort((a, b) => {
    const aAirport = isAirportLike(a) ? 1 : 0;
    const bAirport = isAirportLike(b) ? 1 : 0;
    if (aAirport !== bAirport) return bAirport - aAirport;

    const aCode =
      a.extratags?.icao?.toUpperCase() ||
      a.extratags?.iata?.toUpperCase() ||
      "";
    const bCode =
      b.extratags?.icao?.toUpperCase() ||
      b.extratags?.iata?.toUpperCase() ||
      "";
    const aCodeMatch = aCode === airportCodeQuery ? 1 : 0;
    const bCodeMatch = bCode === airportCodeQuery ? 1 : 0;
    if (aCodeMatch !== bCodeMatch) return bCodeMatch - aCodeMatch;

    if (userCoordinates) {
      const aLat = Number.parseFloat(a.lat);
      const aLon = Number.parseFloat(a.lon);
      const bLat = Number.parseFloat(b.lat);
      const bLon = Number.parseFloat(b.lon);
      const aValid = Number.isFinite(aLat) && Number.isFinite(aLon);
      const bValid = Number.isFinite(bLat) && Number.isFinite(bLon);
      if (aValid && bValid) {
        const aDistance = distanceMiles(userCoordinates.lat, userCoordinates.lon, aLat, aLon);
        const bDistance = distanceMiles(userCoordinates.lat, userCoordinates.lon, bLat, bLon);
        if (Math.abs(aDistance - bDistance) > 0.5) return aDistance - bDistance;
      }
    }

    return 0;
  });
}

export default function App() {
  const initialStateRef = useRef<ReturnType<typeof loadInitialLocationsState> | null>(
    null,
  );
  if (initialStateRef.current === null) {
    initialStateRef.current = loadInitialLocationsState();
  }
  const initialState = initialStateRef.current;

  const [searchQuery, setSearchQuery] = useState("");
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(
    initialState.savedLocations,
  );
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation>(
    initialState.selectedLocation,
  );
  const [activeTab, setActiveTab] = useState<TabValue>("overview");
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [userCoordinates, setUserCoordinates] = useState<UserCoordinates | null>(null);
  const [isMobileLocationCardsCollapsed, setIsMobileLocationCardsCollapsed] = useState(false);
  const resolvingAirportIdsRef = useRef<Set<string>>(new Set());
  const prefetchKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SAVED_LOCATIONS_STORAGE_KEY,
        JSON.stringify(savedLocations),
      );
    } catch {
      // Ignore storage failures so the app still works.
    }
  }, [savedLocations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SELECTED_LOCATION_ID_STORAGE_KEY,
        selectedLocation.id,
      );
    } catch {
      // Ignore storage failures so the app still works.
    }
  }, [selectedLocation.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("geolocation" in navigator)) return;

    const storageKey = "weather_griff_user_location_prompted_v1";
    if (window.localStorage.getItem(storageKey) === "1") return;
    window.localStorage.setItem(storageKey, "1");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoordinates({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      () => {},
      {
        enableHighAccuracy: false,
        timeout: 6000,
        maximumAge: 30 * 60 * 1000,
      },
    );
  }, []);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Perform search when debounced query changes
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 3) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;

    const searchLocations = async () => {
      setIsSearching(true);
      try {
        const query = debouncedQuery.trim();
        const normalizedCodeQuery = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const looksLikeAirportCode = /^[A-Z0-9]{3,4}$/.test(normalizedCodeQuery);
        const proxyParams = new URLSearchParams({
          q: query,
          limit: "8",
          format: "json",
          addressdetails: "1",
          extratags: "1",
          countrycodes: "us",
        });
        if (userCoordinates) {
          const left = (userCoordinates.lon - 4).toFixed(4);
          const right = (userCoordinates.lon + 4).toFixed(4);
          const top = (userCoordinates.lat + 3).toFixed(4);
          const bottom = (userCoordinates.lat - 3).toFixed(4);
          proxyParams.set("viewbox", `${left},${top},${right},${bottom}`);
        }

        const proxyData = await fetchJsonWithTimeout<SearchResult[]>(
          `/api/position/search?${proxyParams.toString()}`,
          1800,
        );
        const usProxyResults = (proxyData ?? []).filter(isUSResult);
        const airportProxyResults = usProxyResults.filter(isIcaoAirportResult);
        if (airportProxyResults.length > 0) {
          if (!cancelled) {
            setSearchResults(
              prioritizeSearchResults(dedupeByPlaceId(airportProxyResults), query, userCoordinates),
            );
          }
          return;
        }

        const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
        geoUrl.searchParams.set("name", query);
        geoUrl.searchParams.set("count", "8");
        geoUrl.searchParams.set("language", "en");
        geoUrl.searchParams.set("format", "json");
        geoUrl.searchParams.set("countryCode", "US");

        const [directNominatim, geoJson] = await Promise.all([
          fetchJsonWithTimeout<SearchResult[]>(
            `https://nominatim.openstreetmap.org/search?${proxyParams.toString()}`,
            1800,
          ),
          fetchJsonWithTimeout<{ results?: OpenMeteoGeocodingResult[] }>(geoUrl.toString(), 2200),
        ]);

        const usDirectResults = (directNominatim ?? []).filter(isUSResult);
        const airportDirectResults = usDirectResults.filter(isIcaoAirportResult);
        if (airportDirectResults.length > 0) {
          if (!cancelled) {
            setSearchResults(
              prioritizeSearchResults(dedupeByPlaceId(airportDirectResults), query, userCoordinates),
            );
          }
          return;
        }

        const results = geoJson?.results ?? [];
        const mapped: SearchResult[] = results
          .filter((r) => (r.country_code ?? "").toUpperCase() === "US")
          .filter(() => looksLikeAirportCode)
          .map((r) => ({
            place_id: r.id,
            lat: String(r.latitude),
            lon: String(r.longitude),
            display_name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
            type: "place",
            class: "place",
            address: {
              city: r.name,
              state: r.admin1,
              country_code: r.country_code?.toLowerCase(),
            },
            extratags:
              normalizedCodeQuery.length === 4
                ? { icao: normalizedCodeQuery }
                : { iata: normalizedCodeQuery, icao: `K${normalizedCodeQuery}` },
          }));

        if (!cancelled) {
          setSearchResults(prioritizeSearchResults(dedupeByPlaceId(mapped), query, userCoordinates));
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    };

    searchLocations();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, userCoordinates]);

  const getAirportCode = (result: SearchResult, preferredAirportCode?: string | null) => {
    const preferred = airportCodeFromUserSearch(preferredAirportCode, result);
    if (normalizeIcaoCode(preferred)) return preferred;
    const resolved = bestAirportCodeFromResult(result);
    if (resolved) return resolved;
    return null;
  };

  const createLocationFromResult = (result: SearchResult, preferredAirportCode?: string | null) => {
    const airportCode = getAirportCode(result, preferredAirportCode);
    if (!airportCode) return null;

    let locationName = result.display_name.split(',')[0];
    const address = result.address;

    if (address) {
      const city = address.city || address.town || address.village;
      const state = address.state;

      if (city && state) {
        const stateAbbrev = state.split(' ').map(word => word.substring(0, 2).toUpperCase()).join('');
        locationName = `${city}, ${stateAbbrev}`;
      } else if (locationName && state) {
        const stateAbbrev = state.split(' ').map(word => word.substring(0, 2).toUpperCase()).join('');
        locationName = `${locationName}, ${stateAbbrev}`;
      }
    }

    return {
      id: String(result.place_id),
      name: locationName,
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      airport: airportCode,
      airportLookupPending: false,
    };
  };

  const isLocationSaved = (result: SearchResult) => {
    return savedLocations.some(loc => loc.id === String(result.place_id));
  };

  const handleSelectLocation = (result: SearchResult) => {
    const nextLocation = createLocationFromResult(result, searchQuery);
    if (!nextLocation) return;

    setSavedLocations((prev) => {
      const existing = prev.find((loc) => loc.id === nextLocation.id);
      if (!existing) return [...prev, nextLocation];

      const shouldPromoteAirportCode =
        isPlaceholderAirportCode(existing.airport) && !isPlaceholderAirportCode(nextLocation.airport);
      if (!shouldPromoteAirportCode) return prev;

      return prev.map((loc) =>
        loc.id === nextLocation.id
          ? { ...loc, airport: nextLocation.airport, airportLookupPending: nextLocation.airportLookupPending }
          : loc,
      );
    });

    setSelectedLocation((prev) => {
      if (prev.id !== nextLocation.id) return nextLocation;
      if (isPlaceholderAirportCode(prev.airport) && !isPlaceholderAirportCode(nextLocation.airport)) {
        return { ...prev, airport: nextLocation.airport, airportLookupPending: nextLocation.airportLookupPending };
      }
      return nextLocation;
    });
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleSaveLocation = (result: SearchResult, e: React.MouseEvent) => {
    e.stopPropagation();
    const newLocation = createLocationFromResult(result, searchQuery);
    if (!newLocation) return;

    setSavedLocations((prev) => {
      if (!prev.find((loc) => loc.id === newLocation.id)) {
        return [...prev, newLocation];
      }
      return prev;
    });
  };

  const handleDeleteLocation = (locationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSavedLocations = savedLocations.filter(loc => loc.id !== locationId);
    if (newSavedLocations.length === 0) {
      setSavedLocations(DEFAULT_SAVED_LOCATIONS);
      setSelectedLocation(DEFAULT_SAVED_LOCATIONS[0]);
      return;
    }

    setSavedLocations(newSavedLocations);
    if (selectedLocation.id === locationId) {
      setSelectedLocation(newSavedLocations[0]);
    }
  };

  useEffect(() => {
    const pending = savedLocations.filter(
      (location) =>
        location.airportLookupPending &&
        isPlaceholderAirportCode(location.airport) &&
        !resolvingAirportIdsRef.current.has(location.id),
    );

    if (pending.length === 0) return;

    let cancelled = false;

    const resolveAirportCodes = async () => {
      for (const location of pending) {
        if (cancelled) break;
        resolvingAirportIdsRef.current.add(location.id);

        try {
          const stationData = await weatherGovFetch<{
            features?: Array<{
              properties?: { stationIdentifier?: string };
            }>;
          }>(`/api/weather-gov/points/${location.lat.toFixed(4)},${location.lon.toFixed(4)}/stations`, 10 * 60_000);

          const resolvedCode =
            normalizeAirportCode(stationData?.features?.[0]?.properties?.stationIdentifier) ?? null;

          if (!cancelled) {
            setSavedLocations((prev) =>
              prev.map((loc) =>
                loc.id === location.id
                  ? {
                      ...loc,
                      airport: resolvedCode ?? loc.airport,
                      airportLookupPending: false,
                    }
                  : loc,
              ),
            );

            setSelectedLocation((prev) => {
              if (prev.id !== location.id) return prev;
              return {
                ...prev,
                airport: resolvedCode ?? prev.airport,
                airportLookupPending: false,
              };
            });
          }
        } finally {
          resolvingAirportIdsRef.current.delete(location.id);
        }
      }
    };

    resolveAirportCodes();

    return () => {
      cancelled = true;
    };
  }, [savedLocations]);

  useEffect(() => {
    const prefetchKey = `${selectedLocation.lat.toFixed(3)},${selectedLocation.lon.toFixed(3)}:${Math.floor(Date.now() / 600000)}`;
    if (prefetchKeysRef.current.has(prefetchKey)) return;
    prefetchKeysRef.current.add(prefetchKey);

    let cancelled = false;
    let cancelIdlePrefetch: (() => void) | null = null;

    const scheduleIdle = (task: () => void): (() => void) => {
      if (typeof window === "undefined") {
        task();
        return () => undefined;
      }
      const withIdle = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      if (typeof withIdle.requestIdleCallback === "function") {
        const handle = withIdle.requestIdleCallback(() => task(), { timeout: 1200 });
        return () => {
          if (typeof withIdle.cancelIdleCallback === "function") {
            withIdle.cancelIdleCallback(handle);
          }
        };
      }
      const timeout = window.setTimeout(task, 250);
      return () => window.clearTimeout(timeout);
    };

    const prefetchRegionalData = async () => {
      const pointsPath = `/api/weather-gov/points/${selectedLocation.lat.toFixed(4)},${selectedLocation.lon.toFixed(4)}`;
      const stationsPath = `${pointsPath}/stations`;

      const [points, stations] = await Promise.all([
        weatherGovFetch<any>(pointsPath, 5 * 60_000).catch(() => null),
        weatherGovFetch<any>(stationsPath, 10 * 60_000).catch(() => null),
      ]);

      if (cancelled) return;

      const officeCode =
        normalizeOfficeCode(points?.properties?.gridId) ||
        officeCodeFromUrl(points?.properties?.forecastOffice);

      const stationFeatures: any[] = Array.isArray(stations?.features) ? stations.features : [];
      const stationIds = pickNearbyMajorStations(stationFeatures, selectedLocation.airport);

      const primaryStation = stationIds[0];
      if (primaryStation) {
        await Promise.all([
          weatherGovFetch(`/api/weather-gov/stations/${primaryStation}/observations/latest`, 3 * 60_000).catch(() => null),
          cachedFetch(`/api/aviationweather?type=metar&ids=${encodeURIComponent(primaryStation)}&format=json`, undefined, 3 * 60_000).catch(() => null),
        ]);
      }

      if (cancelled) return;

      cancelIdlePrefetch = scheduleIdle(async () => {
        if (cancelled) return;

        const secondaryStationIds = stationIds.slice(1, 2);
        for (const stationId of secondaryStationIds) {
          if (cancelled) return;
          await Promise.all([
            cachedFetch(`/api/aviationweather?type=metar&ids=${encodeURIComponent(stationId)}&format=json`, undefined, 3 * 60_000).catch(() => null),
            cachedFetch(`/api/aviationweather?type=taf&ids=${encodeURIComponent(stationId)}&format=json`, undefined, 5 * 60_000).catch(() => null),
          ]);
        }

        if (!officeCode || cancelled) return;
        let products: any[] = [];
        const list = await weatherGovFetch<any>(`/api/weather-gov/products/types/AFD/locations/${officeCode}`, 45_000).catch(() => null);
        products = Array.isArray(list?.["@graph"]) ? list["@graph"] : [];
        if (products.length === 0) {
          const fallback = await weatherGovFetch<any>("/api/weather-gov/products/types/AFD", 45_000).catch(() => null);
          const fallbackProducts: any[] = Array.isArray(fallback?.["@graph"]) ? fallback["@graph"] : [];
          products = fallbackProducts.filter((item) => officeMatchesProduct(item, officeCode));
        }
        if (products.length === 0 || cancelled) return;

        products.sort((a, b) => {
          const aTs = Date.parse(a?.issuanceTime ?? "");
          const bTs = Date.parse(b?.issuanceTime ?? "");
          const aValue = Number.isFinite(aTs) ? aTs : 0;
          const bValue = Number.isFinite(bTs) ? bTs : 0;
          return bValue - aValue;
        });

        const latestProductPath = resolveLatestProductPath(products[0]);
        if (!latestProductPath || cancelled) return;
        await weatherGovFetch(latestProductPath, 60_000).catch(() => null);
      });
    };

    prefetchRegionalData();

    return () => {
      cancelled = true;
      if (cancelIdlePrefetch) cancelIdlePrefetch();
    };
  }, [selectedLocation.lat, selectedLocation.lon, selectedLocation.airport]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobileViewport = () => window.matchMedia("(max-width: 767px)").matches;
    const shouldUseCompactMode = () =>
      isMobileViewport() && (activeTab === "overview" || activeTab === "airports" || activeTab === "wind-viz");

    const updateCompactState = () => {
      if (!shouldUseCompactMode()) {
        setIsMobileLocationCardsCollapsed(false);
        return;
      }
      const next = window.scrollY > 110;
      setIsMobileLocationCardsCollapsed((prev) => (prev === next ? prev : next));
    };

    let rafId = 0;
    const throttledUpdate = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateCompactState();
      });
    };

    updateCompactState();
    window.addEventListener("scroll", throttledUpdate, { passive: true });
    window.addEventListener("resize", throttledUpdate);
    return () => {
      window.removeEventListener("scroll", throttledUpdate);
      window.removeEventListener("resize", throttledUpdate);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activeTab]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f5f7] pb-8 sm:pb-[72px] lg:h-[100dvh] lg:min-h-[100dvh] lg:overflow-hidden">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="flex min-h-0 flex-1 flex-col">
        {/* Top Navigation */}
        <div className="bg-white border-b border-gray-200 px-3 sm:px-6 pt-3 sm:pt-4 relative z-50">
          <div className="pb-3 sm:pb-4 space-y-2">
            <div className="flex items-center gap-2 sm:gap-3 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-3">
              <div className="flex shrink-0 items-center gap-2">
                <img
                  src="/favicon.svg"
                  alt="Griff"
                  className="h-9 w-9 rounded-xl border border-gray-200 bg-black p-1.5 sm:hidden"
                />
                <img
                  src="/griff-weather-logo.svg"
                  alt="Griff Weather"
                  className="hidden sm:block h-9 w-auto rounded-xl border border-gray-200 bg-white px-2 py-1"
                />
              </div>

              {/* Search Bar */}
              <div className="relative z-[100] flex-1 min-w-0 lg:w-full lg:min-w-0">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search airport or city"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 sm:h-10 text-sm w-full sm:w-56 md:w-64 lg:w-full bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
                {isSearching && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  </div>
                )}

                {/* Search Results Dropdown */}
                {(searchResults.length > 0 || (searchQuery.length >= 3 && !isSearching && searchResults.length === 0)) && (
                  <div className="absolute left-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-[22rem] overflow-y-auto z-[200] w-[min(24rem,calc(100vw-1.5rem))] sm:w-[min(24rem,calc(100vw-3rem))] lg:w-full lg:max-w-none">
                    {searchResults.length > 0 ? (
                      searchResults.map(result => {
                        const code = getAirportCode(result, searchQuery);
                        const isSaved = isLocationSaved(result);

                        return (
                          <div
                            key={result.place_id}
                            onClick={() => handleSelectLocation(result)}
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-start gap-3 text-sm border-b border-gray-100 last:border-0 transition-colors cursor-pointer group"
                          >
                            {isAirportLike(result) ? (
                              <Plane className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            ) : (
                              <Search className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            )}

                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 truncate flex items-center gap-2">
                                {code && code !== "ARPT" && (
                                  <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider">
                                    {code}
                                  </span>
                                )}
                                <span className={isAirportLike(result) ? "font-semibold" : ""}>
                                  {result.display_name.split(',')[0]}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 truncate mt-1 leading-snug">
                                {result.display_name.split(',').slice(1).join(',')}
                              </div>
                            </div>

                            <div className="flex-shrink-0">
                              {isSaved ? (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 text-green-700">
                                  <BookmarkCheck className="w-3.5 h-3.5" />
                                  <span className="text-[10px] font-semibold">Saved</span>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => handleSaveLocation(result, e)}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <Bookmark className="w-3.5 h-3.5" />
                                  <span className="text-[10px] font-semibold">Save</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-sm text-gray-500">
                        No locations found
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 lg:justify-self-end">
                <Button
                  variant="ghost"
                  className="h-9 sm:h-10 flex-shrink-0 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-xl px-2.5 sm:px-3 border border-gray-200 bg-white"
                  onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-xs font-medium ml-1">Chat</span>
                </Button>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="min-w-0 w-full overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <TabsList className="bg-gray-100 p-1 rounded-2xl mb-0 relative z-40 inline-flex w-max whitespace-nowrap gap-1 h-auto md:grid md:w-full md:grid-cols-6 md:whitespace-normal md:rounded-xl md:h-10">
                {navTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="flex-row gap-1.5 rounded-xl px-2.5 py-2 text-center data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 md:flex-1 md:justify-center md:px-2"
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 sm:w-4 sm:h-4" />
                      {tab.label && (
                        <span className="text-[11px] font-medium leading-tight truncate sm:text-sm">
                          {tab.label}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>
        </div>

        {/* Saved Locations Weather Widget Cards */}
        <SavedLocationWidget
          locations={savedLocations}
          selectedLocation={selectedLocation}
          onSelectLocation={setSelectedLocation}
          onDeleteLocation={handleDeleteLocation}
          compactOnMobile={isMobileLocationCardsCollapsed}
        />

        {/* Tab Content */}
        <div className="flex-1 min-h-0 bg-[#f5f5f7] lg:overflow-y-auto">
          <TabsContent value="overview" className="m-0 h-full focus-visible:ring-0">
            <div className="w-full p-3 sm:p-6 space-y-4 sm:space-y-6">
              <CurrentWeather
                location={selectedLocation}
                onOpenWindViz={() => {
                  setActiveTab("wind-viz");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
              <WindDataTable location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="discussion" className="m-0 h-full focus-visible:ring-0">
            <div className="w-full">
              <WeatherDiscussion location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="airports" className="m-0 h-full focus-visible:ring-0">
            <div className="w-full">
              <AirportReports location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="outlook" className="m-0 h-full focus-visible:ring-0">
            <div className="w-full">
              <SevenDayOutlook location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="wind-viz" className="m-0 h-full focus-visible:ring-0">
            <div className="w-full">
              <WindVisualization location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="flight" className="m-0 h-full focus-visible:ring-0">
            <div className="w-full">
              <FlightPlanning location={selectedLocation} />
            </div>
          </TabsContent>

        </div>
      </Tabs>

      {/* AI Assistant Panel */}
      <AIAssistantPanel
        location={selectedLocation}
        isOpen={isAIPanelOpen}
        onClose={() => setIsAIPanelOpen(false)}
      />

      {/* Footer */}
      <Footer location={selectedLocation} />
    </div>
  );
}
