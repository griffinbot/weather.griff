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
