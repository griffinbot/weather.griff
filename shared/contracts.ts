export interface CurrentWeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  weatherCode: number;
  condition: string;
  icon: string;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  pressure: number;
  visibility: number;
  cloudCover: number;
  dewPoint: number;
  precipitation: number;
  isDay: boolean;
}

export interface HourlyForecastData {
  time: string;
  temperature: number;
  feelsLike: number;
  weatherCode: number;
  condition: string;
  icon: string;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  humidity: number;
  precipitationProbability: number;
  visibility: number;
  cloudCover: number;
  dewPoint: number;
}

export interface DailyForecastData {
  date: string;
  high: number;
  low: number;
  weatherCode: number;
  condition: string;
  icon: string;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  precipitationProbability: number;
  precipitationSum: number;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
}

export interface NearbyStation {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  distance_mi: number;
}

export interface MetarData {
  raw: string;
  timestamp: string;
  description: string;
  temperature_C: number | null;
  dewpoint_C: number | null;
  windDirection: number | null;
  windSpeed_kmh: number | null;
  windGust_kmh: number | null;
  visibility_m: number | null;
  barometricPressure_Pa: number | null;
  relativeHumidity: number | null;
  cloudLayers: { base_m: number | null; amount: string }[];
}

export interface TafData {
  raw: string;
  issuanceTime: string;
}

export interface DiscussionData {
  title: string;
  office: string;
  officeCode: string;
  issueTime: string;
  content: string;
  sourceUrl: string;
}

export interface SavedLocationRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  airport: string;
}

export interface UserPreferences {
  temperatureUnit: "fahrenheit" | "celsius";
  windSpeedUnit: "knots" | "mph" | "kmh" | "ms";
  pressureUnit: "inhg" | "mb" | "hpa";
  distanceUnit: "miles" | "kilometers" | "nautical";
  altitudeUnit: "feet" | "meters";
  timeFormat: "12" | "24";
  autoRefresh: boolean;
  defaultWindsView: "table" | "visualization";
  showDetailedWindTable: boolean;
  enableDiscussionInBriefing: boolean;
  flight_tools: {
    preferredCruiseAltitudeFt: number | null;
    defaultAircraftType: string;
  };
}

export interface UserProfile {
  preferences: UserPreferences;
  savedLocations: SavedLocationRecord[];
  selectedLocationId: string | null;
  migratedLocalDataAt: string | null;
}

export interface SearchResultNormalized {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  airport: string | null;
  source: "nominatim" | "open-meteo";
}

export interface BriefingStationBundle {
  station: NearbyStation;
  metar: MetarData | null;
  taf: TafData | null;
}

export interface BriefingResponse {
  location: SavedLocationRecord;
  current: CurrentWeatherData | null;
  hourly: HourlyForecastData[];
  daily: DailyForecastData[];
  nearbyStations: NearbyStation[];
  stationBundles: BriefingStationBundle[];
  discussion: DiscussionData | null;
  lastUpdated: string;
}

export interface PressureLevelRow {
  pressureLevel: number;
  altitudeMSL_m: number;
  altitudeMSL_ft: number;
  altitudeAGL_ft: number;
  temperature_F: number;
  windSpeed_mph: number;
  windDirection: number;
}

export interface NearSurfaceLevelRow {
  altitudeAGL_ft: number;
  altitudeMSL_ft: number;
  temperature_F: number;
  windSpeed_mph: number;
  windDirection: number;
  source: "open-meteo" | "derived";
}

export interface WindAloftHour {
  time: string;
  cape: number;
  cin: number;
  cloudCover: number;
  cloudCoverLow: number;
  cloudCoverMid: number;
  cloudCoverHigh: number;
  visibility_m: number;
  surfaceTemp_F: number;
  surfaceWindSpeed_mph: number;
  surfaceWindGust_mph: number;
  surfaceWindDirection: number;
  nearSurfaceLevels: NearSurfaceLevelRow[];
  levels: PressureLevelRow[];
  normalizedLevels: PressureLevelRow[];
}

export interface WindResponse {
  location: {
    lat: number;
    lon: number;
  };
  elevation_m: number;
  hours: WindAloftHour[];
  lastUpdated: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface SessionResponse {
  authenticated: boolean;
  user: SessionUser | null;
}

export interface AssistantQueryRequest {
  question: string;
  location: SavedLocationRecord;
}

export interface AssistantQueryResponse {
  answer: string;
  generatedAt: string;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  temperatureUnit: "fahrenheit",
  windSpeedUnit: "knots",
  pressureUnit: "inhg",
  distanceUnit: "miles",
  altitudeUnit: "feet",
  timeFormat: "12",
  autoRefresh: true,
  defaultWindsView: "table",
  showDetailedWindTable: true,
  enableDiscussionInBriefing: true,
  flight_tools: {
    preferredCruiseAltitudeFt: null,
    defaultAircraftType: "",
  },
};

export const DEFAULT_SAVED_LOCATIONS: SavedLocationRecord[] = [
  { id: "1", name: "SeaTac, WA", lat: 47.4502, lon: -122.3088, airport: "KSEA" },
  { id: "2", name: "Boeing Field, WA", lat: 47.53, lon: -122.3019, airport: "KBFI" },
  {
    id: "3",
    name: "Joint Base Lewis-McChord, WA",
    lat: 47.1376,
    lon: -122.4762,
    airport: "KTCM",
  },
  { id: "4", name: "Renton Municipal, WA", lat: 47.4931, lon: -122.2162, airport: "KRNT" },
];
