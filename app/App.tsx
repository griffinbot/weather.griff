import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Settings2, Sparkles } from "lucide-react";
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

function App() {
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
    const nextLocations = profile.savedLocations.filter((location) => location.id !== locationId);
    const nextSelected =
      profile.selectedLocationId === locationId ? nextLocations[0]?.id ?? null : profile.selectedLocationId;
    await persistLocations(nextLocations.length > 0 ? nextLocations : profile.savedLocations.slice(0, 1), nextSelected);
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7f4ec_0%,#f5f5f7_24%,#eef2f7_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <header className="sticky top-4 z-40 mb-5 rounded-[32px] border border-white/70 bg-white/90 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex items-center gap-3">
                <div className="rounded-[22px] bg-slate-950 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-orange-300">
                  Griff Weather
                </div>
                <div className="hidden rounded-[22px] bg-slate-100 px-4 py-3 text-sm text-slate-500 sm:block">
                  Aviation briefing-first
                </div>
              </div>

              <div className="relative lg:flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={() => setSearchOpen(searchResults.length > 0)}
                  placeholder="Search airport or city"
                  className="h-12 rounded-[22px] border-slate-200 bg-slate-50 pl-11 pr-11 text-base"
                />
                {searching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-orange-500" />}

                {searchOpen && (searchResults.length > 0 || searchQuery.trim().length >= 2) && (
                  <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] rounded-[24px] border border-slate-200 bg-white p-2 shadow-2xl">
                    {searchResults.length > 0 ? (
                      searchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => void addSearchResult(result)}
                          className="flex w-full items-start justify-between rounded-[18px] px-4 py-3 text-left transition hover:bg-slate-50"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900">{result.name}</span>
                              {result.airport && (
                                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800">
                                  {result.airport}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">{result.subtitle || "Airport search result"}</div>
                          </div>
                          <span className="text-xs font-medium text-slate-400">{result.source}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-slate-500">No locations found.</div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button className="h-12 rounded-[22px] bg-slate-950 px-4 hover:bg-slate-800" onClick={() => setAskOpen(true)} disabled={!selectedLocation}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Ask
                </Button>
                <Button variant="outline" className="h-12 rounded-[22px] border-slate-200 px-4" onClick={() => setProfileOpen(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  {sessionLoading ? "Account" : session?.authenticated ? "Profile" : "Sign in"}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {profile.savedLocations.map((location) => {
                  const selected = selectedLocation?.id === location.id;
                  const temperature = selected ? briefing?.current?.temperature : null;
                  return (
                    <div key={location.id} className="group flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void selectLocation(location.id)}
                        className={cn(
                          "flex min-w-[170px] items-center justify-between rounded-[22px] border px-4 py-3 text-left transition",
                          selected
                            ? "border-slate-950 bg-slate-950 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                        )}
                      >
                        <div>
                          <div className="text-sm font-semibold">{location.airport}</div>
                          <div className={cn("mt-1 text-xs", selected ? "text-slate-300" : "text-slate-500")}>{location.name}</div>
                        </div>
                        {temperature != null && <div className="text-2xl font-light">{temperature}°</div>}
                      </button>
                      {profile.savedLocations.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void removeLocation(location.id)}
                          className="rounded-full px-2 py-1 text-xs text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-white hover:text-red-500"
                          aria-label={`Remove ${location.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <nav className="grid gap-2 sm:grid-cols-3">
                {PRIMARY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "rounded-[20px] px-4 py-3 text-sm font-semibold transition",
                      activeTab === tab.id
                        ? "bg-orange-500 text-white shadow-[0_10px_30px_rgba(249,115,22,0.28)]"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main className="flex-1">
          {activeTab === "briefing" && (
            <BriefingView briefing={briefing} loading={briefingLoading} error={briefingError} />
          )}

          {activeTab === "winds" && selectedLocation && (
            <div className="space-y-5">
              <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Winds</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Table and visualization views read from the same backend winds contract.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-[22px] bg-slate-100 p-1">
                    <button
                      type="button"
                      className={cn(
                        "rounded-[18px] px-4 py-2 text-sm font-medium transition",
                        windsSubview === "table" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                      )}
                      onClick={() => setWindsSubview("table")}
                    >
                      Table
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-[18px] px-4 py-2 text-sm font-medium transition",
                        windsSubview === "visualization" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
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

        <footer className="mt-6 border-t border-slate-200 px-2 py-4 text-sm text-slate-500">
          {briefing?.lastUpdated
            ? `Data current as of ${new Date(briefing.lastUpdated).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "Weather data updates when a location is selected."}
        </footer>
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

export default App;
