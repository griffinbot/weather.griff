import { ArrowUp, Wind, Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog } from "lucide-react";
import { HourlyForecastData, getWindDirectionName } from "../hooks/useWeather";

interface Location {
  name: string;
}

interface HourlyForecastProps {
  location: Location;
  hourlyData?: HourlyForecastData[];
}

function WeatherIcon({ iconType, className }: { iconType: string; className?: string }) {
  const iconClass = className || "w-6 h-6";
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

export function HourlyForecast({ location, hourlyData }: HourlyForecastProps) {
  // Use the first 24 hours of data
  const data = (hourlyData || []).slice(0, 24);

  if (data.length === 0) {
    return <div className="text-sm text-gray-500 text-center py-4">No hourly data available</div>;
  }

  const formatTime = (date: Date) => {
    const hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}${ampm}`;
  };

  // Find index closest to "now"
  const now = Date.now();
  let closestIdx = 0;
  let closestDiff = Infinity;
  data.forEach((h, i) => {
    const diff = Math.abs(h.time.getTime() - now);
    if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
  });

  return (
    <div>
      <div className="mb-4">
        <h3 className="font-semibold text-lg mb-1">Hourly Forecast</h3>
        <p className="text-sm text-gray-500">Next 24 hours — live data from Open-Meteo</p>
      </div>

      <div
        className="w-full overflow-x-auto overscroll-x-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex gap-3 pb-2 w-max pr-1">
          {data.map((hour, index) => (
            <div
              key={index}
              className={`flex-shrink-0 w-28 rounded-xl p-4 border ${
                index === closestIdx
                  ? "bg-blue-50 border-blue-200"
                  : "bg-gray-50 border-gray-100"
              }`}
            >
              {/* Time */}
              <div className="text-center mb-3">
                <div className={`font-semibold ${index === closestIdx ? "text-blue-600" : ""}`}>
                  {index === closestIdx ? "Now" : formatTime(hour.time)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {hour.time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>

              {/* Temperature */}
              <div className="text-center mb-3">
                <div className="text-2xl font-light">{hour.temperature}°</div>
              </div>

              {/* Condition Icon */}
              <div className="flex justify-center mb-3">
                <WeatherIcon iconType={hour.icon} />
              </div>

              {/* Wind */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Wind</span>
                  <span className="font-medium">{hour.windSpeed} kt</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Dir</span>
                  <div className="flex items-center gap-1">
                    <ArrowUp 
                      className="w-3 h-3" 
                      style={{ transform: `rotate(${hour.windDirection}deg)` }}
                    />
                    <span className="font-medium">{getWindDirectionName(hour.windDirection)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Gust</span>
                  <span className="font-medium">{hour.windGusts} kt</span>
                </div>
              </div>

              {/* Precipitation */}
              {hour.precipitationProbability > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="text-xs text-center text-blue-600">
                    {hour.precipitationProbability}% rain
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
