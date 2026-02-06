import { MapPin, X, Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, Wind, CloudFog, Loader2 } from "lucide-react";
import {
  useCurrentWeather,
  getWindDirectionName,
  getCeiling,
  getFlightCategory,
} from "../hooks/useWeather";

interface Location {
  id: string;
  name: string;
  lat: number;
  lon: number;
  airport: string;
}

interface SavedLocationWidgetProps {
  locations: Location[];
  selectedLocation: Location;
  onSelectLocation: (loc: Location) => void;
  onDeleteLocation: (id: string, e: React.MouseEvent) => void;
  compactOnMobile?: boolean;
}

function WeatherIcon({ iconType, className }: { iconType: string; className?: string }) {
  const iconClass = className || "w-5 h-5";
  switch (iconType) {
    case "clear":
      return <Sun className={`${iconClass} text-yellow-400`} />;
    case "partly-cloudy":
      return <Cloud className={`${iconClass} text-gray-300`} />;
    case "cloudy":
      return <Cloud className={`${iconClass} text-gray-400`} />;
    case "fog":
      return <CloudFog className={`${iconClass} text-gray-400`} />;
    case "drizzle":
      return <CloudDrizzle className={`${iconClass} text-blue-300`} />;
    case "rain":
    case "showers":
      return <CloudRain className={`${iconClass} text-blue-400`} />;
    case "freezing":
      return <CloudRain className={`${iconClass} text-cyan-400`} />;
    case "snow":
      return <CloudSnow className={`${iconClass} text-blue-200`} />;
    case "thunderstorm":
      return <CloudLightning className={`${iconClass} text-yellow-500`} />;
    default:
      return <Cloud className={`${iconClass} text-gray-300`} />;
  }
}

function LocationCard({
  loc,
  isSelected,
  onSelect,
  onDelete,
}: {
  loc: Location;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const { data: weather, loading } = useCurrentWeather(loc.lat, loc.lon);
  const flightCat =
    weather ? getFlightCategory(weather.visibility, getCeiling(weather.cloudCover)) : null;

  return (
    <div
      onClick={onSelect}
      className={`relative flex-shrink-0 rounded-2xl p-2.5 sm:p-3 cursor-pointer transition-all duration-200 min-w-[150px] sm:min-w-[180px] max-w-[190px] sm:max-w-[210px] group ${
        isSelected
          ? "bg-white shadow-md border-2 border-blue-500 ring-2 ring-blue-100"
          : "bg-white/70 border border-gray-200 hover:bg-white hover:shadow-sm hover:border-gray-300"
      }`}
    >
      {/* Delete button */}
      <button
        onClick={onDelete}
        className={`absolute top-2 right-2 p-1 rounded-full transition-all ${
          isSelected
            ? "text-gray-400 hover:text-red-500 hover:bg-red-50"
            : "text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100"
        }`}
        title="Remove location"
      >
        <X className="w-3 h-3" />
      </button>

      {/* Location name + code */}
      <div className="flex items-center gap-1.5 mb-2 pr-5">
        <MapPin className={`w-3 h-3 flex-shrink-0 ${isSelected ? "text-blue-500" : "text-gray-400"}`} />
        <span className="text-xs font-semibold text-gray-800 truncate">{loc.name}</span>
        <span className="text-[9px] font-mono font-bold text-blue-600 bg-blue-50 px-1 py-0.5 rounded flex-shrink-0">
          {loc.airport}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
        </div>
      ) : !weather ? (
        <div className="flex items-center justify-center py-3">
          <span className="text-[11px] text-gray-400">Weather unavailable</span>
        </div>
      ) : (
        <>
          {/* Temperature + Condition */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <WeatherIcon iconType={weather.icon} className="w-6 h-6" />
              <span className="text-2xl font-light text-gray-900">{weather.temperature}°</span>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-gray-500">Feels {weather.feelsLike}°</div>
            </div>
          </div>

          {/* Condition text + Flight category */}
          <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
            <div className="text-[10px] text-gray-500 truncate">{weather.condition}</div>
            {flightCat && (
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${flightCat.bgColor} ${flightCat.color}`}
              >
                {flightCat.category}
              </span>
            )}
          </div>

          {/* Wind + Humidity row */}
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            <div className="flex items-center gap-1">
              <Wind className="w-3 h-3" />
              <span>
                {weather.windSpeed}kt {getWindDirectionName(weather.windDirection)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">|</span>
              <span>{weather.humidity}%</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CompactLocationCard({
  loc,
  isSelected,
  onSelect,
  onDelete,
}: {
  loc: Location;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`relative flex-shrink-0 rounded-xl px-3 py-2 cursor-pointer transition-all duration-200 min-w-[160px] max-w-[200px] group ${
        isSelected
          ? "bg-white shadow-sm border-2 border-blue-500"
          : "bg-white/80 border border-gray-200 hover:bg-white hover:border-gray-300"
      }`}
    >
      <button
        onClick={onDelete}
        className={`absolute top-1.5 right-1.5 p-1 rounded-full transition-all ${
          isSelected
            ? "text-gray-400 hover:text-red-500 hover:bg-red-50"
            : "text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100"
        }`}
        title="Remove location"
      >
        <X className="w-3 h-3" />
      </button>

      <div className="flex items-center gap-1.5 pr-5 min-w-0">
        <MapPin className={`w-3 h-3 flex-shrink-0 ${isSelected ? "text-blue-500" : "text-gray-400"}`} />
        <span className="text-xs font-semibold text-gray-800 truncate">{loc.name}</span>
        <span className="text-[9px] font-mono font-bold text-blue-600 bg-blue-50 px-1 py-0.5 rounded flex-shrink-0">
          {loc.airport}
        </span>
      </div>
    </div>
  );
}

export function SavedLocationWidget({
  locations,
  selectedLocation,
  onSelectLocation,
  onDeleteLocation,
  compactOnMobile = false,
}: SavedLocationWidgetProps) {
  if (locations.length === 0) return null;

  return (
    <div
      className={`bg-[#f5f5f7] px-3 sm:px-6 border-b border-gray-200 transition-all duration-300 ${
        compactOnMobile
          ? "py-1.5 sticky top-0 z-40 shadow-sm"
          : "py-3"
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <span
          className={`text-[10px] uppercase tracking-wider text-gray-400 font-semibold flex-shrink-0 ${
            compactOnMobile ? "hidden sm:inline" : ""
          }`}
        >
          Locations
        </span>
        <div
          className={`flex items-center overflow-x-auto w-full sm:flex-1 pb-1 transition-all duration-300 ${
            compactOnMobile ? "gap-2" : "gap-2 sm:gap-3"
          }`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {locations.map((loc) => (
            compactOnMobile ? (
              <div key={loc.id}>
                <div className="block sm:hidden">
                  <CompactLocationCard
                    loc={loc}
                    isSelected={selectedLocation.id === loc.id}
                    onSelect={() => onSelectLocation(loc)}
                    onDelete={(e) => onDeleteLocation(loc.id, e)}
                  />
                </div>
                <div className="hidden sm:block">
                  <LocationCard
                    loc={loc}
                    isSelected={selectedLocation.id === loc.id}
                    onSelect={() => onSelectLocation(loc)}
                    onDelete={(e) => onDeleteLocation(loc.id, e)}
                  />
                </div>
              </div>
            ) : (
              <LocationCard
                key={loc.id}
                loc={loc}
                isSelected={selectedLocation.id === loc.id}
                onSelect={() => onSelectLocation(loc)}
                onDelete={(e) => onDeleteLocation(loc.id, e)}
              />
            )
          ))}
        </div>
      </div>
    </div>
  );
}
