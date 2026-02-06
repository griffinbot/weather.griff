import { useState, useEffect } from "react";
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

function prioritizeSearchResults(results: SearchResult[], query: string): SearchResult[] {
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

    return 0;
  });
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [savedLocations, setSavedLocations] = useState(initialLocations);
  const [selectedLocation, setSelectedLocation] = useState(savedLocations[0]);
  const [activeTab, setActiveTab] = useState("overview");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  
  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 600); // Slightly increased delay to be nicer to the API with double requests

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

        const proxyData = await fetchJsonWithTimeout<SearchResult[]>(
          `/api/nominatim/search?q=${encodeURIComponent(query)}&limit=8`,
        );
        if (proxyData && proxyData.length > 0) {
          if (!cancelled) setSearchResults(prioritizeSearchResults(dedupeByPlaceId(proxyData), query));
          return;
        }

        // Cloudflare egress can be blocked by Nominatim. Try browser-direct as fallback.
        const directParams = new URLSearchParams({
          q: query,
          format: "json",
          addressdetails: "1",
          extratags: "1",
          limit: "8",
          countrycodes: "us",
        });
        const directNominatim = await fetchJsonWithTimeout<SearchResult[]>(
          `https://nominatim.openstreetmap.org/search?${directParams.toString()}`,
        );
        if (directNominatim && directNominatim.length > 0) {
          if (!cancelled) {
            setSearchResults(
              prioritizeSearchResults(dedupeByPlaceId(directNominatim), query),
            );
          }
          return;
        }

        // Fallback: Open-Meteo geocoding (more tolerant, but no airport tags).
        const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
        geoUrl.searchParams.set("name", query);
        geoUrl.searchParams.set("count", "8");
        geoUrl.searchParams.set("language", "en");
        geoUrl.searchParams.set("format", "json");

        const geoJson = await fetchJsonWithTimeout<{ results?: OpenMeteoGeocodingResult[] }>(
          geoUrl.toString(),
        );
        const results = geoJson?.results ?? [];

        const mapped: SearchResult[] = results.map((r) => ({
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
              : { iata: normalizedCodeQuery })
            : undefined,
        }));

        if (!cancelled) {
          setSearchResults(prioritizeSearchResults(dedupeByPlaceId(mapped), query));
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
  }, [debouncedQuery]);

  // Helper to create location object from search result
  const createLocationFromResult = (result: SearchResult) => {
    // Determine airport code (IATA > ICAO > Generic)
    let airportCode = "GPS";
    if (result.extratags?.iata) airportCode = result.extratags.iata.toUpperCase();
    else if (result.extratags?.icao) airportCode = result.extratags.icao.toUpperCase();
    else if (result.class === 'aeroway' || result.type === 'aerodrome') airportCode = "ARPT";

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
      airport: airportCode
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
    const location = createLocationFromResult(result);
    
    // If not saved, also save it
    if (!isLocationSaved(result)) {
      setSavedLocations([...savedLocations, location]);
    }
    
    setSelectedLocation(location);
    setSearchQuery("");
    setSearchResults([]);
  };

  // Save a location (add to saved list)
  const handleSaveLocation = (result: SearchResult, e: React.MouseEvent) => {
    e.stopPropagation();
    const newLocation = createLocationFromResult(result);
    
    if (!savedLocations.find(loc => loc.id === newLocation.id)) {
      setSavedLocations([...savedLocations, newLocation]);
    }
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

  const getAirportCode = (result: SearchResult) => {
    if (result.extratags?.iata) return result.extratags.iata.toUpperCase();
    if (result.extratags?.icao) return result.extratags.icao.toUpperCase();
    if (result.class === 'aeroway' || result.type === 'aerodrome') return "ARPT";
    return null;
  };

  return (
    <div className="flex flex-col h-screen bg-[#f5f5f7] overflow-hidden">
      {/* Main Content Area with Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navigation - Tab Menu */}
        <div className="bg-white border-b border-gray-200 px-6 pt-4 relative z-50">
          <div className="flex justify-start gap-3 items-center pb-4">
            {/* Search Bar - Outside overflow container so dropdown is not clipped */}
            <div className="relative flex-shrink-0 z-[100]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search airport or city"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-40 sm:w-56 md:w-64 bg-gray-50 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                </div>
              )}
              
              {/* Search Results Dropdown */}
              {(searchResults.length > 0 || (searchQuery.length >= 3 && !isSearching && searchResults.length === 0)) && (
                <div className="absolute left-0 w-96 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-[22rem] overflow-y-auto z-[200]">
                  {searchResults.length > 0 ? (
                    searchResults.map(result => {
                      const code = getAirportCode(result);
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

            {/* Tab Navigation - scrollable independently */}
            <div className="flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <TabsList className="bg-gray-100 p-1 rounded-xl inline-flex mb-0 whitespace-nowrap relative z-40 scrollbar-hide">
                <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <Wind className="w-4 h-4 mr-1.5" />
                  <span className="text-sm">Overview</span>
                </TabsTrigger>
                <TabsTrigger value="discussion" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <FileText className="w-4 h-4 mr-1.5" />
                  <span className="text-sm">Discussion</span>
                </TabsTrigger>
                <TabsTrigger value="airports" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <Plane className="w-4 h-4 mr-1.5" />
                  <span className="text-sm">Airports</span>
                </TabsTrigger>
                <TabsTrigger value="outlook" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  <span className="text-sm">7-Day</span>
                </TabsTrigger>
                <TabsTrigger value="wind-viz" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <Wind className="w-4 h-4 mr-1.5" />
                  <span className="text-sm">Wind Viz</span>
                </TabsTrigger>
                <TabsTrigger value="metadata" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <BarChart3 className="w-4 h-4 mr-1.5" />
                  <span className="text-sm">Metadata</span>
                </TabsTrigger>
                <TabsTrigger value="flight" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <Plane className="w-4 h-4 mr-1.5" />
                  <span className="text-sm">Flight Plan</span>
                </TabsTrigger>
                <TabsTrigger value="settings" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200 flex-shrink-0 px-3">
                  <Settings className="w-4 h-4" />
                </TabsTrigger>
              </TabsList>
            </div>

            {/* AI Assistant Button */}
            <Button
              variant="ghost"
              className="flex-shrink-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl px-3"
              onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
            >
              <MessageSquare className="w-4 h-4" />
            </Button>
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
            <div className="p-6 space-y-6 max-w-7xl mx-auto">
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
