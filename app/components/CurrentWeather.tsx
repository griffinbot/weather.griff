import { Cloud, Wind, Droplets, Eye, Gauge, Thermometer, ArrowDown, ChevronDown, ChevronUp, Clock, Sun, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, Loader2, Sunrise, Sunset } from "lucide-react";
import { useState } from "react";
import { HourlyForecast } from "./HourlyForecast";
import { useWeather, getWindDirectionName, getCeiling, getFlightCategory } from "../hooks/useWeather";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface CurrentWeatherProps {
  location: Location;
  onOpenWindViz?: () => void;
}

function WeatherIcon({ iconType, className }: { iconType: string; className?: string }) {
  const iconClass = className || "w-5 h-5";
  switch (iconType) {
    case "clear": return <Sun className={`${iconClass} text-yellow-400`} />;
    case "partly-cloudy": return <Cloud className={`${iconClass} text-gray-300`} />;
    case "cloudy": return <Cloud className={`${iconClass} text-gray-400`} />;
    case "fog": return <CloudFog className={`${iconClass} text-gray-400`} />;
    case "drizzle": return <CloudDrizzle className={`${iconClass} text-blue-300`} />;
    case "rain":
    case "showers": return <CloudRain className={`${iconClass} text-blue-400`} />;
    case "freezing": return <CloudRain className={`${iconClass} text-cyan-400`} />;
    case "snow": return <CloudSnow className={`${iconClass} text-blue-200`} />;
    case "thunderstorm": return <CloudLightning className={`${iconClass} text-yellow-500`} />;
    default: return <Cloud className={`${iconClass} text-gray-300`} />;
  }
}

export function CurrentWeather({ location, onOpenWindViz }: CurrentWeatherProps) {
  const [showHourly, setShowHourly] = useState(false);
  const { current, hourly, daily, loading, error, lastUpdated, refetch } = useWeather(location.lat, location.lon);

  if (loading && !current) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 flex items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="text-gray-500">Loading weather data...</span>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-red-100 text-center">
        <p className="text-red-500 mb-2">Failed to load weather data</p>
        <p className="text-sm text-gray-500 mb-4">{error}</p>
        <button onClick={refetch} className="px-4 py-2 bg-blue-500 text-white rounded-xl text-sm hover:bg-blue-600 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!current) return null;

  const ceiling = getCeiling(current.cloudCover);
  const flightCat = getFlightCategory(current.visibility, ceiling);

  // Get today's sunrise/sunset times
  const todaySunrise = daily?.[0]?.sunrise;
  const todaySunset = daily?.[0]?.sunset;
  
  const formatSunTime = (isoString: string) => {
    const date = new Date(isoString);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const windCardClassName = onOpenWindViz
    ? "bg-gray-50 rounded-lg p-2 text-left transition-colors hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 cursor-pointer"
    : "bg-gray-50 rounded-lg p-2";

  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <h2 className="text-xl font-semibold leading-tight">{location.name}</h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${flightCat.bgColor} ${flightCat.color}`}>
                {flightCat.category}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-blue-600 text-xs font-mono font-semibold">{location.airport}</p>
              <span className="text-gray-300">•</span>
              <p className="text-gray-400 text-[10px] font-mono">
                {location.lat.toFixed(4)}°, {location.lon.toFixed(4)}°
              </p>
            </div>
          </div>
          <div className="text-right flex items-start gap-2 sm:gap-3 flex-shrink-0">
            <WeatherIcon iconType={current.icon} className="w-8 h-8 sm:w-10 sm:h-10" />
            <div>
              <div className="text-3xl sm:text-4xl font-light leading-none">{current.temperature}°</div>
              <div className="text-gray-500 text-xs mt-0.5">Feels like {current.feelsLike}°</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          {/* Sunrise/Sunset Pills */}
          {todaySunrise && todaySunset && (
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl">
                <Sunrise className="w-3.5 h-3.5 text-orange-600" />
                <span className="font-medium text-xs text-orange-700">{formatSunTime(todaySunrise)}</span>
              </div>

              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl">
                <Sunset className="w-3.5 h-3.5 text-indigo-600" />
                <span className="font-medium text-xs text-indigo-700">{formatSunTime(todaySunset)}</span>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowHourly(!showHourly)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl transition-colors w-full sm:w-auto sm:ml-auto"
          >
            <Clock className="w-4 h-4" />
            <span className="font-medium text-sm">View Hourly</span>
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2 text-base">
          <WeatherIcon iconType={current.icon} className="w-4 h-4" />
          <span>{current.condition}</span>
          {current.precipitation > 0 && (
            <span className="text-sm text-blue-500 ml-2">
              • {current.precipitation}" precip
            </span>
          )}
        </div>
      </div>

      {/* Weather Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 mb-1.5">
        <button
          type="button"
          onClick={onOpenWindViz}
          disabled={!onOpenWindViz}
          className={windCardClassName}
          aria-label="Open winds aloft"
        >
          <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">
            <Wind className="w-3 h-3" />
            <span>Wind</span>
          </div>
          <div className="font-semibold text-sm">{current.windSpeed} kt</div>
          <div className="text-[10px] text-gray-500">
            {getWindDirectionName(current.windDirection)} ({current.windDirection}°)
          </div>
        </button>

        <div className="bg-gray-50 rounded-lg p-2">
          <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">
            <Wind className="w-3 h-3" />
            <span>Gusts</span>
          </div>
          <div className="font-semibold text-sm">{current.windGusts} kt</div>
          <div className="text-[10px] text-gray-500">Peak</div>
        </div>

        <div className="bg-gray-50 rounded-lg p-2">
          <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">
            <Droplets className="w-3 h-3" />
            <span>Humidity</span>
          </div>
          <div className="font-semibold text-sm">{current.humidity}%</div>
          <div className="text-[10px] text-gray-500">Dew Pt {current.dewPoint}°</div>
        </div>

        <div className="bg-gray-50 rounded-lg p-2">
          <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">
            <Eye className="w-3 h-3" />
            <span>Visibility</span>
          </div>
          <div className="font-semibold text-sm">{current.visibility} mi</div>
          <div className="text-[10px] text-gray-500">{current.visibility >= 10 ? "Clear" : current.visibility >= 5 ? "Moderate" : "Low"}</div>
        </div>

        <div className="bg-gray-50 rounded-lg p-2">
          <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">
            <Gauge className="w-3 h-3" />
            <span>Pressure</span>
          </div>
          <div className="font-semibold text-sm">{current.pressure}</div>
          <div className="text-[10px] text-gray-500">inHg</div>
        </div>

        <div className="bg-gray-50 rounded-lg p-2">
          <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">
            <Cloud className="w-3 h-3" />
            <span>Clouds</span>
          </div>
          <div className="font-semibold text-sm">{current.cloudCover}%</div>
          <div className="text-[10px] text-gray-500">
            {current.cloudCover >= 90 ? "OVC" : current.cloudCover >= 70 ? "BKN" : current.cloudCover >= 50 ? "SCT" : current.cloudCover >= 25 ? "FEW" : "CLR"}
          </div>
        </div>
      </div>

      {/* Hourly Forecast Expansion */}
      {showHourly && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <HourlyForecast location={location} hourlyData={hourly} />
        </div>
      )}
    </div>
  );
}
