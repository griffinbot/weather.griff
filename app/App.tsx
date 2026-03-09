import { useEffect, useMemo, useState } from "react";
import { Clock3, Loader2, MapPin, Search, Settings2, Sparkles, Wind } from "lucide-react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { cn } from "./components/ui/utils";
import { WindDataTable } from "./components/WindDataTable";
import { WindVisualization } from "./components/WindVisualization";
import { BriefingView } from "./components/BriefingView";
import { ForecastView } from "./components/ForecastView";
import { ProfileDialog } from "./components/ProfileDialog";
import { AskDialog } from "./components/AskDialog";
import { useBriefing } from "./hooks/useBriefing";
import { useProfile } from "./hooks/useProfile";
import { useSession } from "./hooks/useSession";
import { cachedFetch } from "./services/weatherProxy";
import type { SavedLocationRecord, SearchResultNormalized } from "../shared/contracts";

const PRIMARY_TABS = [
  { id: "briefing", label: "Briefing" },
  { id: "winds", label: "Winds" },
  { id: "forecast", label: "Forecast" },
] as const;

<<<<<<< Updated upstream
type PrimaryTab = (typeof PRIMARY_TABS)[number]["id"];
type WindsSubview = "table" | "visualization";

export default function App() {
  const [activeTab, setActiveTab] = useState<PrimaryTab>("briefing");
  const [windsSubview, setWindsSubview] = useState<WindsSubview>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultNormalized[]>([]);
  const [searching, setSearching] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: session, loading: sessionLoading } = useSession();
  const { profile, savePreferences, saveLocations } = useProfile(!!session?.authenticated);

  useEffect(() => {
    setWindsSubview(profile.preferences.defaultWindsView);
  }, [profile.preferences.defaultWindsView]);
=======
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSavedLocationsFromStorage(value: unknown): SavedLocation[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: SavedLocation[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;

    const id = entry.id;
    const name = entry.name;
    const lat = entry.lat;
    const lon = entry.lon;
    const airport = entry.airport;
    const airportLookupPending = entry.airportLookupPending;

    if (typeof id !== "string" || id.trim().length === 0) return null;
    if (typeof name !== "string" || name.trim().length === 0) return null;
    if (typeof airport !== "string" || airport.trim().length === 0) return null;
    if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
    if (typeof lon !== "number" || !Number.isFinite(lon)) return null;

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
    return { savedLocations: initialLocations, selectedLocation: initialLocations[0] };
  }

  try {
    const storedLocations = window.localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY);
    const storedSelectedId = window.localStorage.getItem(SELECTED_LOCATION_ID_STORAGE_KEY);

    const parsedLocations = storedLocations
      ? parseSavedLocationsFromStorage(JSON.parse(storedLocations))
      : null;

    const savedLocations = parsedLocations ?? initialLocations;
    const selectedLocation =
      (storedSelectedId
        ? savedLocations.find((loc) => loc.id === storedSelectedId) ?? null
        : null) ?? savedLocations[0] ?? initialLocations[0];

    return { savedLocations, selectedLocation };
  } catch {
    return { savedLocations: initialLocations, selectedLocation: initialLocations[0] };
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
  const initialLocationsStateRef = useRef<ReturnType<typeof loadInitialLocationsState> | null>(
    null,
  );
  if (initialLocationsStateRef.current === null) {
    initialLocationsStateRef.current = loadInitialLocationsState();
  }
  const initialLocationsState = initialLocationsStateRef.current;

  const [searchQuery, setSearchQuery] = useState("");
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(
    initialLocationsState.savedLocations,
  );
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation>(
    initialLocationsState.selectedLocation,
  );
  const [activeTab, setActiveTab] = useState("overview");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
      window.localStorage.setItem(SAVED_LOCATIONS_STORAGE_KEY, JSON.stringify(savedLocations));
    } catch {
      // ignore storage/quota errors
    }
  }, [savedLocations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SELECTED_LOCATION_ID_STORAGE_KEY, selectedLocation.id);
    } catch {
      // ignore storage/quota errors
    }
  }, [selectedLocation.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("geolocation" in navigator)) return;
>>>>>>> Stashed changes

  const selectedLocation = useMemo(() => {
    const selected = profile.savedLocations.find((location) => location.id === profile.selectedLocationId);
    return selected || profile.savedLocations[0] || null;
  }, [profile.savedLocations, profile.selectedLocationId]);

  const { data: briefing, loading: briefingLoading, error: briefingError } = useBriefing(selectedLocation);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await cachedFetch<{ results: SearchResultNormalized[] }>(
          `/api/search?q=${encodeURIComponent(searchQuery.trim())}`,
          undefined,
          30000,
          5000,
        );
        if (!cancelled) {
          setSearchResults(response.results || []);
          setSearchOpen(true);
        }
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  const persistLocations = async (locations: SavedLocationRecord[], selectedLocationId: string | null) => {
    await saveLocations(locations, selectedLocationId);
  };

  const selectLocation = async (locationId: string) => {
    await persistLocations(profile.savedLocations, locationId);
    setSearchOpen(false);
  };

  const addSearchResult = async (result: SearchResultNormalized) => {
    const nextLocation: SavedLocationRecord = {
      id: result.id,
      name: result.name,
      lat: result.lat,
      lon: result.lon,
      airport: result.airport || "ARPT",
    };

    const existing = profile.savedLocations.find((location) => location.id === nextLocation.id);
    const nextLocations = existing
      ? profile.savedLocations.map((location) =>
          location.id === nextLocation.id ? { ...location, airport: nextLocation.airport } : location,
        )
      : [...profile.savedLocations, nextLocation];

    await persistLocations(nextLocations, nextLocation.id);
    setSearchQuery("");
    setSearchResults([]);
    setSearchOpen(false);
  };

  const removeLocation = async (locationId: string) => {
    if (profile.savedLocations.length <= 1) return;
    const nextLocations = profile.savedLocations.filter((location) => location.id !== locationId);
    const nextSelected =
      profile.selectedLocationId === locationId ? nextLocations[0]?.id ?? null : profile.selectedLocationId;
    await persistLocations(nextLocations, nextSelected);
  };

<<<<<<< Updated upstream
  const current = briefing?.current;
=======
  // Delete a location from saved list
  const handleDeleteLocation = (locationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSavedLocations = savedLocations.filter(loc => loc.id !== locationId);
    if (newSavedLocations.length === 0) {
      // Keep the app usable if someone removes everything.
      setSavedLocations(initialLocations);
      setSelectedLocation(initialLocations[0]);
      return;
    }

    setSavedLocations(newSavedLocations);

    // If we deleted the selected location, select the first one
    if (selectedLocation.id === locationId) {
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobileViewport = () => window.matchMedia("(max-width: 767px)").matches;
    const shouldUseCompactMode = () =>
      isMobileViewport() && (activeTab === "overview" || activeTab === "wind-viz");

    const updateCompactState = () => {
      if (!shouldUseCompactMode()) {
        setIsMobileLocationCardsCollapsed(false);
        return;
      }
      const next = window.scrollY > 110;
      setIsMobileLocationCardsCollapsed((prev) => (prev === next ? prev : next));
    };

    updateCompactState();
    window.addEventListener("scroll", updateCompactState, { passive: true });
    window.addEventListener("resize", updateCompactState);
    return () => {
      window.removeEventListener("scroll", updateCompactState);
      window.removeEventListener("resize", updateCompactState);
    };
  }, [activeTab]);
>>>>>>> Stashed changes

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <header className="relative overflow-visible rounded-[30px] border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-5 shadow-[0_26px_70px_rgba(15,23,42,0.45)] sm:p-6">
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-orange-400/10 blur-3xl" />

          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-orange-300/20 bg-orange-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-orange-200">
                  Griff Weather
                </div>
                <div className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-slate-300">
                  Rebuilt UI • Aviation-first workflow
                </div>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={() => setSearchOpen(searchResults.length > 0)}
                  placeholder="Search airport or city"
                  className="h-12 rounded-2xl border-white/10 bg-slate-800/80 pl-11 pr-11 text-base text-white placeholder:text-slate-400"
                />
                {searching && (
                  <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-orange-300" />
                )}

                {searchOpen && (searchResults.length > 0 || searchQuery.trim().length >= 2) && (
                  <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-30 rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-xl">
                    {searchResults.length > 0 ? (
                      searchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => void addSearchResult(result)}
                          className="flex w-full items-start justify-between rounded-xl px-4 py-3 text-left transition hover:bg-white/5"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white">{result.name}</span>
                              {result.airport && (
                                <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-200">
                                  {result.airport}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-slate-400">{result.subtitle || "Airport search result"}</div>
                          </div>
                          <span className="text-xs font-medium text-slate-500">{result.source}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-slate-400">No locations found.</div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {profile.savedLocations.map((location) => {
                  const selected = selectedLocation?.id === location.id;
                  return (
                    <div key={location.id} className="group flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void selectLocation(location.id)}
                        className={cn(
                          "rounded-2xl border px-4 py-2.5 text-left transition",
                          selected
                            ? "border-orange-300/30 bg-orange-300/10 text-orange-50"
                            : "border-white/15 bg-white/5 text-slate-200 hover:border-white/30",
                        )}
                      >
                        <div className="text-xs font-bold tracking-wide">{location.airport}</div>
                        <div className="text-xs text-slate-300">{location.name}</div>
                      </button>
                      {profile.savedLocations.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void removeLocation(location.id)}
                          className="rounded-full px-2 py-1 text-xs text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-red-300"
                          aria-label={`Remove ${location.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Current Conditions</p>
                  <h1 className="mt-2 text-2xl font-semibold text-white">
                    {selectedLocation?.name || "Select a location"}
                  </h1>
                  {selectedLocation && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-slate-300">
                      <MapPin className="h-4 w-4" />
                      {selectedLocation.airport}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-5xl font-light text-white">{current?.temperature ?? "--"}°</div>
                  <div className="text-xs text-slate-400">Feels like {current?.feelsLike ?? "--"}°</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-xs text-slate-400">Wind</p>
                  <p className="mt-1 flex items-center gap-1 text-sm font-medium text-white">
                    <Wind className="h-4 w-4 text-orange-200" />
                    {current?.windSpeed ?? "--"} kt
                  </p>
                </div>
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-xs text-slate-400">Visibility</p>
                  <p className="mt-1 text-sm font-medium text-white">{current?.visibility ?? "--"} mi</p>
                </div>
                <div className="rounded-2xl bg-white/5 p-3">
                  <p className="text-xs text-slate-400">Humidity</p>
                  <p className="mt-1 text-sm font-medium text-white">{current?.humidity ?? "--"}%</p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  className="h-11 rounded-xl bg-white px-4 text-slate-900 hover:bg-slate-200"
                  onClick={() => setAskOpen(true)}
                  disabled={!selectedLocation}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Ask Assistant
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-white/20 bg-transparent px-4 text-slate-100 hover:bg-white/10"
                  onClick={() => setProfileOpen(true)}
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  {sessionLoading ? "Account" : session?.authenticated ? "Profile" : "Sign in"}
                </Button>
              </div>
            </section>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <nav className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
              {PRIMARY_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                    activeTab === tab.id
                      ? "bg-orange-400 text-slate-950"
                      : "bg-white/5 text-slate-300 hover:bg-white/10",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Clock3 className="h-4 w-4" />
              {briefing?.lastUpdated
                ? `Updated ${new Date(briefing.lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Awaiting location data"}
            </div>
          </div>
        </header>

        <main className="mt-5 flex-1">
          {activeTab === "briefing" && <BriefingView briefing={briefing} loading={briefingLoading} error={briefingError} />}

          {activeTab === "winds" && selectedLocation && (
            <div className="space-y-5">
              <section className="rounded-[28px] border border-white/10 bg-slate-900/80 p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-white">Winds Aloft</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Compare tabular reports with vector visualization for route planning.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl bg-white/5 p-1">
                    <button
                      type="button"
                      className={cn(
                        "rounded-lg px-4 py-2 text-sm font-medium transition",
                        windsSubview === "table" ? "bg-white text-slate-900" : "text-slate-300",
                      )}
                      onClick={() => setWindsSubview("table")}
                    >
                      Table
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-lg px-4 py-2 text-sm font-medium transition",
                        windsSubview === "visualization" ? "bg-white text-slate-900" : "text-slate-300",
                      )}
                      onClick={() => setWindsSubview("visualization")}
                    >
                      Visualization
                    </button>
                  </div>
                </div>
              </section>

              {windsSubview === "table" ? (
                <WindDataTable location={selectedLocation} />
              ) : (
                <WindVisualization location={selectedLocation} />
              )}
            </div>
          )}

          {activeTab === "forecast" && <ForecastView briefing={briefing} />}
        </main>
      </div>

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        session={session}
        preferences={profile.preferences}
        onPreferencesChange={savePreferences}
      />
      <AskDialog open={askOpen} onOpenChange={setAskOpen} location={selectedLocation} />
    </div>
  );
}
