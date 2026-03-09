import { useEffect, useMemo, useState } from "react";
import { Clock3, Loader2, MapPin, Search, Settings2, Sparkles, Wind, Eye, Gauge, X } from "lucide-react";
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
  { id: "briefing", label: "Flight Brief" },
  { id: "winds", label: "Winds" },
  { id: "forecast", label: "Week Ahead" },
] as const;

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

  const current = briefing?.current;

  const getFlightStatus = () => {
    if (!current) return null;
    const windSpeed = current.windSpeed ?? 0;
    const gusts = current.windGusts ?? 0;
    const visibility = current.visibility ?? 10;

    if (gusts > 25 || windSpeed > 20 || visibility < 1) return { label: "NO-GO", color: "bg-red-500/15 text-red-400 border-red-500/20" };
    if (gusts > 15 || windSpeed > 12 || visibility < 3) return { label: "CAUTION", color: "bg-amber-500/15 text-amber-400 border-amber-500/20" };
    return { label: "FLYABLE", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" };
  };

  const flightStatus = getFlightStatus();

  return (
    <div className="min-h-screen bg-surface-ground text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-3 pb-6 pt-4 sm:px-5 lg:px-6">

        {/* ── Top Control Bar ────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Wind className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-bold tracking-wide text-white">GRIFF WEATHER</span>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setSearchOpen(searchResults.length > 0)}
              placeholder="Search airport or city..."
              className="h-9 rounded-lg border-white/8 bg-white/5 pl-9 pr-9 text-sm text-white placeholder:text-slate-500 focus:border-amber-500/30 focus:ring-amber-500/20"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-amber-400" />
            )}

            {searchOpen && (searchResults.length > 0 || searchQuery.trim().length >= 2) && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 rounded-lg border border-white/10 bg-slate-900/98 p-1.5 shadow-2xl backdrop-blur-xl">
                {searchResults.length > 0 ? (
                  searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => void addSearchResult(result)}
                      className="flex w-full items-start justify-between rounded-md px-3 py-2.5 text-left transition hover:bg-white/5"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{result.name}</span>
                          {result.airport && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                              {result.airport}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{result.subtitle || "Airport search result"}</div>
                      </div>
                      <span className="text-[10px] font-medium text-slate-600">{result.source}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2.5 text-sm text-slate-500">No locations found.</div>
                )}
              </div>
            )}
          </div>

          <Button
            size="sm"
            className="h-9 rounded-lg bg-amber-500/15 px-3 text-amber-300 hover:bg-amber-500/25 border border-amber-500/20"
            onClick={() => setAskOpen(true)}
            disabled={!selectedLocation}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Ask
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-lg border-white/10 bg-white/5 px-3 text-slate-300 hover:bg-white/10"
            onClick={() => setProfileOpen(true)}
          >
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            {sessionLoading ? "..." : session?.authenticated ? "Profile" : "Sign in"}
          </Button>
        </div>

        {/* ── Saved Locations Rail ─────────────────────────── */}
        {profile.savedLocations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {profile.savedLocations.map((location) => {
              const selected = selectedLocation?.id === location.id;
              return (
                <div key={location.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => void selectLocation(location.id)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-left transition-all",
                      selected
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                        : "border-white/8 bg-white/3 text-slate-400 hover:border-white/15 hover:text-slate-200",
                    )}
                  >
                    <span className="text-[11px] font-bold tracking-wider">{location.airport}</span>
                    <span className="ml-2 text-[11px] text-slate-500">{location.name}</span>
                  </button>
                  {profile.savedLocations.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void removeLocation(location.id)}
                      className="ml-0.5 rounded p-1 text-slate-600 opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-red-400"
                      aria-label={`Remove ${location.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Hero Summary Panel ──────────────────────────── */}
        <div className="mb-3 rounded-xl border border-white/8 bg-gradient-to-r from-slate-900/80 via-slate-900/60 to-indigo-950/40 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                    {selectedLocation?.name || "Select a location"}
                  </h1>
                  {selectedLocation && (
                    <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-bold tracking-wider text-slate-300">
                      {selectedLocation.airport}
                    </span>
                  )}
                  {flightStatus && (
                    <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider", flightStatus.color)}>
                      {flightStatus.label}
                    </span>
                  )}
                </div>
                {selectedLocation && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    {selectedLocation.lat.toFixed(2)}°, {selectedLocation.lon.toFixed(2)}°
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-5">
              {/* Temperature */}
              <div className="text-center">
                <div className="text-3xl font-light tracking-tight text-white sm:text-4xl">{current?.temperature ?? "--"}°</div>
                <div className="text-[10px] text-slate-500">
                  {current?.condition || "—"}{current?.feelsLike ? ` · Feels ${current.feelsLike}°` : ""}
                </div>
              </div>

              {/* Compact metrics strip */}
              <div className="flex gap-3 rounded-lg bg-white/4 px-3 py-2 sm:gap-4 sm:px-4">
                <div className="text-center">
                  <Wind className="mx-auto h-3.5 w-3.5 text-amber-400" />
                  <div className="mt-0.5 text-sm font-semibold text-white">{current?.windSpeed ?? "--"} <span className="text-[10px] font-normal text-slate-400">kt</span></div>
                  <div className="text-[10px] text-slate-500">Wind</div>
                </div>
                <div className="w-px bg-white/8" />
                <div className="text-center">
                  <Eye className="mx-auto h-3.5 w-3.5 text-sky-400" />
                  <div className="mt-0.5 text-sm font-semibold text-white">{current?.visibility ?? "--"} <span className="text-[10px] font-normal text-slate-400">mi</span></div>
                  <div className="text-[10px] text-slate-500">Vis</div>
                </div>
                <div className="w-px bg-white/8" />
                <div className="text-center">
                  <Gauge className="mx-auto h-3.5 w-3.5 text-violet-400" />
                  <div className="mt-0.5 text-sm font-semibold text-white">{current?.humidity ?? "--"}<span className="text-[10px] font-normal text-slate-400">%</span></div>
                  <div className="text-[10px] text-slate-500">RH</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Clock3 className="h-3 w-3" />
                {briefing?.lastUpdated
                  ? new Date(briefing.lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                  : "—"}
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/6 pt-3">
            <nav className="flex gap-1">
              {PRIMARY_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "rounded-lg px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-all",
                    activeTab === tab.id
                      ? "bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/25"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeTab === "winds" && selectedLocation && (
              <div className="ml-auto flex items-center gap-1 rounded-lg bg-white/5 p-0.5">
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-all",
                    windsSubview === "table" ? "bg-white/15 text-white" : "text-slate-500 hover:text-slate-300",
                  )}
                  onClick={() => setWindsSubview("table")}
                >
                  Table
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-all",
                    windsSubview === "visualization" ? "bg-white/15 text-white" : "text-slate-500 hover:text-slate-300",
                  )}
                  onClick={() => setWindsSubview("visualization")}
                >
                  Trajectory
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Main Content ────────────────────────────────── */}
        <main className="flex-1">
          {activeTab === "briefing" && <BriefingView briefing={briefing} loading={briefingLoading} error={briefingError} />}

          {activeTab === "winds" && selectedLocation && (
            <div>
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
