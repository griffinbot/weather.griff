import { useState, useEffect, useRef } from "react";
import { Search, MapPin, Settings, Wind, FileText, Plane, BarChart3, Calendar, Loader2, Bookmark, BookmarkCheck, X, Trash2, ChevronLeft, ChevronRight, Menu, MessageSquare } from "lucide-react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";
import { CurrentWeather } from "./components/CurrentWeather";
import { WindDataTable } from "./components/WindDataTable";
import { WeatherDiscussion } from "./components/WeatherDiscussion";
import { MetadataReport } from "./components/MetadataReport";
import { AirportReports } from "./components/AirportReports";
import { SettingsPanel } from "./components/SettingsPanel";
import { WindVisualization } from "./components/WindVisualization";
import { FlightPlanning } from "./components/FlightPlanning";
import { SevenDayOutlook } from "./components/SevenDayOutlook";
import { AIAssistantPanel } from "./components/AIAssistantPanel";
import { SavedLocationWidget } from "./components/SavedLocationWidget";
import { Footer } from "./components/Footer";
import { cachedFetch, weatherGovFetch } from "./services/weatherProxy";

// Initial mock data to populate the app before any search
const initialLocations = [
  { id: "1", name: "SeaTac, WA", lat: 47.4502, lon: -122.3088, airport: "KSEA" },
  { id: "2", name: "Enumclaw, WA", lat: 47.1850, lon: -121.9644, airport: "WA77" },
  { id: "3", name: "Joint Base Lewis-McChord, WA", lat: 47.1376, lon: -122.4762, airport: "KTCM" },
  { id: "4", name: "Boeing Field, WA", lat: 47.5300, lon: -122.3019, airport: "KBFI" },
];

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

interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  airport: string;
  airportLookupPending?: boolean;
}

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
  return (
    normalizeAirportCode(result.extratags?.icao) ||
    normalizeAirportCode(result.extratags?.iata) ||
    normalizeAirportCode(result.extratags?.ref) ||
    normalizeAirportCode(result.extratags?.local_ref)
  );
}

function isPlaceholderAirportCode(code: string): boolean {
  return code === "ARPT" || code === "GPS";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(initialLocations);
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation>(initialLocations[0]);
  const [activeTab, setActiveTab] = useState("overview");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  
  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [userCoordinates, setUserCoordinates] = useState<UserCoordinates | null>(null);
  const resolvingAirportIdsRef = useRef<Set<string>>(new Set());
  const prefetchKeysRef = useRef<Set<string>>(new Set());

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
      () => {
        // User denied or browser blocked geolocation. Search still works with US fallback logic.
      },
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
        if (usProxyResults.length > 0) {
          if (!cancelled) {
            setSearchResults(
              prioritizeSearchResults(dedupeByPlaceId(usProxyResults), query, userCoordinates),
            );
          }
          return;
        }

        // Cloudflare egress can be blocked by Nominatim. Try browser-direct as fallback.
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
        if (usDirectResults.length > 0) {
          if (!cancelled) {
            setSearchResults(
              prioritizeSearchResults(dedupeByPlaceId(usDirectResults), query, userCoordinates),
            );
          }
          return;
        }

        // Fallback: Open-Meteo geocoding (more tolerant, but no airport tags).
        const results = geoJson?.results ?? [];

        const mapped: SearchResult[] = results
          .filter((r) => (r.country_code ?? "").toUpperCase() === "US")
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
          extratags: looksLikeAirportCode
            ? (normalizedCodeQuery.length === 4
              ? { icao: normalizedCodeQuery }
              : { iata: normalizedCodeQuery, icao: `K${normalizedCodeQuery}` })
            : undefined,
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

  // Helper to create location object from search result
  const createLocationFromResult = (result: SearchResult, preferredAirportCode?: string | null) => {
    // Determine airport code (IATA > ICAO > Generic)
    const airportLike = isAirportLike(result);
    const resolvedAirportCode = bestAirportCodeFromResult(result);
    const preferred = airportLike ? airportCodeFromUserSearch(preferredAirportCode, result) : null;
    const airportCode = preferred || resolvedAirportCode || (airportLike ? "ARPT" : "GPS");

    // Format the location name (City, State)
    let locationName = result.display_name.split(',')[0];
    const address = result.address;
    
    if (address) {
      const city = address.city || address.town || address.village;
      const state = address.state;
      
      if (city && state) {
        // Use "City, ST" format with state abbreviation
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
      airportLookupPending: airportLike && !preferred && !resolvedAirportCode,
    };
  };

  // Helper to format display location for search results
  const formatSearchResultDisplay = (result: SearchResult) => {
    const address = result.address;
    const city = address?.city || address?.town || address?.village || result.display_name.split(',')[0];
    const state = address?.state;
    
    // Primary name
    const primaryName = city;
    
    // Secondary info (state only for cleaner look)
    const secondaryInfo = state || '';
    
    return { primaryName, secondaryInfo };
  };

  // Check if a location is saved
  const isLocationSaved = (result: SearchResult) => {
    return savedLocations.some(loc => loc.id === String(result.place_id));
  };

  // Select a location from search (doesn't automatically save)
  const handleSelectLocation = (result: SearchResult) => {
    const nextLocation = createLocationFromResult(result, searchQuery);

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

  // Save a location (add to saved list)
  const handleSaveLocation = (result: SearchResult, e: React.MouseEvent) => {
    e.stopPropagation();
    const newLocation = createLocationFromResult(result, searchQuery);
    
    setSavedLocations((prev) => {
      if (!prev.find((loc) => loc.id === newLocation.id)) {
        return [...prev, newLocation];
      }
      return prev;
    });
  };

  // Delete a location from saved list
  const handleDeleteLocation = (locationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSavedLocations = savedLocations.filter(loc => loc.id !== locationId);
    setSavedLocations(newSavedLocations);
    
    // If we deleted the selected location, select the first one
    if (selectedLocation.id === locationId && newSavedLocations.length > 0) {
      setSelectedLocation(newSavedLocations[0]);
    }
  };

  const getAirportCode = (result: SearchResult, preferredAirportCode?: string | null) => {
    const preferred = isAirportLike(result) ? airportCodeFromUserSearch(preferredAirportCode, result) : null;
    if (preferred) return preferred;
    const resolved = bestAirportCodeFromResult(result);
    if (resolved) return resolved;
    if (isAirportLike(result)) return "ARPT";
    return null;
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

  return (
    <div className="flex flex-col h-screen bg-[#f5f5f7] overflow-hidden">
      {/* Main Content Area with Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navigation - Tab Menu */}
        <div className="bg-white border-b border-gray-200 px-3 sm:px-6 pt-3 sm:pt-4 relative z-50">
          <div className="pb-3 sm:pb-4 space-y-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex-shrink-0">
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
            {/* Search Bar - Outside overflow container so dropdown is not clipped */}
              <div className="relative z-[100] flex-1 min-w-0 sm:flex-none sm:w-auto sm:flex-shrink-0">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search airport or city"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 sm:h-10 text-sm w-full sm:w-56 md:w-64 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                </div>
              )}
              
              {/* Search Results Dropdown */}
              {(searchResults.length > 0 || (searchQuery.length >= 3 && !isSearching && searchResults.length === 0)) && (
                <div className="absolute left-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-[22rem] overflow-y-auto z-[200] w-[min(24rem,calc(100vw-1.5rem))] sm:w-96">
                  {searchResults.length > 0 ? (
                    searchResults.map(result => {
                      const code = getAirportCode(result, searchQuery);
                      const isAirport = !!code;
                      const isSaved = isLocationSaved(result);
                      
                      return (
                        <div
                          key={result.place_id}
                          onClick={() => handleSelectLocation(result)}
                          className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-start gap-3 text-sm border-b border-gray-100 last:border-0 transition-colors cursor-pointer group"
                        >
                          {isAirport ? (
                            <Plane className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          )}
                          
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate flex items-center gap-2">
                              {code && code !== "ARPT" && (
                                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider">
                                  {code}
                                </span>
                              )}
                              <span className={isAirport ? "font-semibold" : ""}>
                                {result.display_name.split(',')[0]}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 truncate mt-1 leading-snug">
                              {result.display_name.split(',').slice(1).join(',')}
                            </div>
                          </div>
                          
                          {/* Saved indicator or Save button */}
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

              {/* AI Assistant Button */}
              <Button
                variant="ghost"
                className="h-9 sm:h-10 flex-shrink-0 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-xl px-2.5 sm:px-3 border border-gray-200 bg-white"
                onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-xs font-medium ml-1">Chat</span>
              </Button>
            </div>

            {/* Tab Navigation - compact on mobile */}
            <div className="min-w-0 w-full sm:flex-1 sm:overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <TabsList className="bg-gray-100 p-1 rounded-xl mb-0 relative z-40 h-auto sm:h-9 w-full grid grid-cols-4 gap-1 sm:w-auto sm:inline-flex sm:whitespace-nowrap">
                <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <Wind className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
                  <span className="text-[11px] sm:text-sm truncate">Overview</span>
                </TabsTrigger>
                <TabsTrigger value="discussion" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
                  <span className="text-[11px] sm:text-sm truncate">Discussion</span>
                </TabsTrigger>
                <TabsTrigger value="airports" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <Plane className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
                  <span className="text-[11px] sm:text-sm truncate">Airports</span>
                </TabsTrigger>
                <TabsTrigger value="outlook" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
                  <span className="text-[11px] sm:text-sm truncate">7-Day</span>
                </TabsTrigger>
                <TabsTrigger value="wind-viz" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <Wind className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
                  <span className="text-[11px] sm:text-sm truncate">Wind Viz</span>
                </TabsTrigger>
                <TabsTrigger value="metadata" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
                  <span className="text-[11px] sm:text-sm truncate">Metadata</span>
                </TabsTrigger>
                <TabsTrigger value="flight" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <Plane className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
                  <span className="text-[11px] sm:text-sm truncate">Flight Plan</span>
                </TabsTrigger>
                <TabsTrigger value="settings" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                  <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

        {/* Saved Locations Weather Widget Cards - Below Tabs */}
        <SavedLocationWidget
          locations={savedLocations}
          selectedLocation={selectedLocation}
          onSelectLocation={setSelectedLocation}
          onDeleteLocation={handleDeleteLocation}
        />

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto bg-[#f5f5f7]">
          <TabsContent value="overview" className="m-0 h-full focus-visible:ring-0">
            <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
              {/* Current Weather */}
              <CurrentWeather location={selectedLocation} />

              {/* Wind Data Table */}
              <WindDataTable location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="discussion" className="m-0 h-full focus-visible:ring-0">
            <div className="max-w-7xl mx-auto">
              <WeatherDiscussion location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="airports" className="m-0 h-full focus-visible:ring-0">
            <div className="max-w-7xl mx-auto">
              <AirportReports location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="outlook" className="m-0 h-full focus-visible:ring-0">
            <div className="max-w-7xl mx-auto">
              <SevenDayOutlook location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="wind-viz" className="m-0 h-full focus-visible:ring-0">
            <div className="max-w-7xl mx-auto">
              <WindVisualization location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="metadata" className="m-0 h-full focus-visible:ring-0">
            <div className="max-w-7xl mx-auto">
              <MetadataReport location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="flight" className="m-0 h-full focus-visible:ring-0">
            <div className="max-w-7xl mx-auto">
              <FlightPlanning location={selectedLocation} />
            </div>
          </TabsContent>

          <TabsContent value="settings" className="m-0 h-full focus-visible:ring-0">
            <div className="max-w-7xl mx-auto">
              <SettingsPanel />
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
