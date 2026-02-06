import { Calendar, Cloud, CloudRain, Sun, Wind, Droplets, ArrowUp, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, Loader2 } from "lucide-react";
import { useWeather, getWindDirectionName, getFlightCategory, getCeiling, DailyForecastData } from "../hooks/useWeather";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface SevenDayOutlookProps {
  location: Location;
}

function WeatherIcon({ iconType, size }: { iconType: string; size?: string }) {
  const iconClass = size || "w-12 h-12";
  switch (iconType) {
    case "clear": return <Sun className={`${iconClass} text-yellow-500`} />;
    case "partly-cloudy": return <Cloud className={`${iconClass} text-gray-400`} />;
    case "cloudy": return <Cloud className={`${iconClass} text-gray-500`} />;
    case "fog": return <CloudFog className={`${iconClass} text-gray-400`} />;
    case "drizzle": return <CloudDrizzle className={`${iconClass} text-blue-400`} />;
    case "rain":
    case "showers": return <CloudRain className={`${iconClass} text-blue-500`} />;
    case "freezing": return <CloudRain className={`${iconClass} text-cyan-500`} />;
    case "snow": return <CloudSnow className={`${iconClass} text-blue-300`} />;
    case "thunderstorm": return <CloudLightning className={`${iconClass} text-yellow-600`} />;
    default: return <Cloud className={`${iconClass} text-gray-500`} />;
  }
}

function generateSummary(day: DailyForecastData, index: number): string {
  const isCalm = day.windSpeed < 15 && day.windGusts < 20;
  const isRainy = day.precipitationProbability > 50;
  const isSnowy = day.icon === "snow";

  if (index === 0) {
    if (isCalm && !isRainy) return "Good flying conditions today with manageable winds and no significant precipitation.";
    if (isRainy) return "Precipitation expected today. Monitor conditions closely and check current reports before flight.";
    return "Variable conditions today. Review real-time reports for the latest updates.";
  }
  if (isSnowy) return "Snow expected. Icing conditions possible. Not recommended for VFR flight.";
  if (isRainy) return "Rain likely with reduced visibility possible. Check TAF for ceiling and visibility forecasts.";
  if (isCalm) return "Light winds and generally favorable conditions expected. Good for VFR operations.";
  if (day.windGusts > 25) return "Strong gusts expected. Use caution with light aircraft. Check winds aloft data.";
  return "Moderate conditions expected. Standard preflight weather check recommended.";
}

export function SevenDayOutlook({ location }: SevenDayOutlookProps) {
  const { daily, loading, error, refetch } = useWeather(location.lat, location.lon);

  const getDayName = (date: Date, index: number) => {
    if (index === 0) return "Today";
    if (index === 1) return "Tomorrow";
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  };

  if (loading && daily.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 flex items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          <span className="text-gray-500">Loading 7-day forecast...</span>
        </div>
      </div>
    );
  }

  if (error && daily.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-red-100 text-center">
          <p className="text-red-500 mb-2">Failed to load forecast</p>
          <button onClick={refetch} className="px-4 py-2 bg-blue-500 text-white rounded-xl text-sm hover:bg-blue-600 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Generate a week-ahead summary from the daily data
  const rainyDays = daily.filter(d => d.precipitationProbability > 50).length;
  const maxGust = Math.max(...daily.map(d => d.windGusts));
  const avgHigh = Math.round(daily.reduce((s, d) => s + d.high, 0) / daily.length);

  let weekSummary = `The upcoming week for ${location.name} features `;
  if (rainyDays === 0) {
    weekSummary += "dry conditions with no significant precipitation expected. ";
  } else if (rainyDays <= 2) {
    weekSummary += `mostly dry conditions with precipitation possible on ${rainyDays} day${rainyDays > 1 ? "s" : ""}. `;
  } else {
    weekSummary += `unsettled weather with precipitation expected on ${rainyDays} of the 7 days. `;
  }
  weekSummary += `High temperatures will average around ${avgHigh}°F. `;
  if (maxGust > 30) {
    weekSummary += `Strong gusts up to ${maxGust} kt are possible — plan flights accordingly.`;
  } else if (maxGust > 20) {
    weekSummary += `Moderate gusts up to ${maxGust} kt expected at times. Generally favorable for flight operations.`;
  } else {
    weekSummary += `Winds will remain light to moderate, providing excellent flying conditions.`;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold mb-2">7-Day Outlook</h2>
            <p className="text-gray-600">Extended forecast for {location.name} — live data</p>
          </div>
          <Calendar className="w-8 h-8 text-blue-500" />
        </div>
      </div>

      {/* General Outlook */}
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg">
        <h3 className="font-semibold text-lg mb-3">Week Ahead Summary</h3>
        <p className="text-blue-50 leading-relaxed">{weekSummary}</p>
      </div>

      {/* Daily Forecast Cards */}
      <div className="grid grid-cols-1 gap-4">
        {daily.map((day, index) => {
          // Estimate visibility from precipitation
          const estVisibility = day.precipitationProbability > 70 ? 4 : day.precipitationProbability > 40 ? 7 : 10;
          const estCeiling = day.icon === "rain" || day.icon === "showers" ? 3000 : day.icon === "cloudy" ? 5000 : 15000;
          const flightCat = getFlightCategory(estVisibility, estCeiling);

          return (
            <div
              key={index}
              className={`bg-white rounded-2xl p-6 shadow-sm border transition-all hover:shadow-md ${
                index === 0 ? "border-blue-300 ring-2 ring-blue-100" : "border-gray-100"
              }`}
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                {/* Date & Condition */}
                <div className="md:col-span-3">
                  <div className="font-semibold text-lg mb-1">
                    {getDayName(day.date, index)}
                  </div>
                  <div className="text-sm text-gray-500 mb-3">
                    {day.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  </div>
                  <div className="flex items-center gap-3">
                    <WeatherIcon iconType={day.icon} />
                    <div>
                      <div className="font-medium">{day.condition}</div>
                      <div className="text-sm text-gray-500">
                        {day.precipitationProbability > 30 ? `${day.precipitationProbability}% precip` : "Low precip chance"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Temperature */}
                <div className="md:col-span-2 flex items-center">
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500 uppercase">Temperature</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-light">{day.high}°</span>
                      <span className="text-xl text-gray-400">{day.low}°</span>
                    </div>
                  </div>
                </div>

                {/* Wind */}
                <div className="md:col-span-3">
                  <div className="text-xs text-gray-500 uppercase mb-2">Wind Conditions</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ArrowUp 
                        className="w-4 h-4 text-blue-600" 
                        style={{ transform: `rotate(${day.windDirection}deg)` }}
                      />
                      <span className="font-medium">{getWindDirectionName(day.windDirection)}</span>
                      <span className="text-sm text-gray-500">({Math.round(day.windDirection)}°)</span>
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold text-blue-600">{day.windSpeed} kt</span>
                      <span className="text-gray-500"> • Gusts </span>
                      <span className="font-semibold text-orange-600">{day.windGusts} kt</span>
                    </div>
                  </div>
                </div>

                {/* Additional Conditions */}
                <div className="md:col-span-2">
                  <div className="text-xs text-gray-500 uppercase mb-2">Conditions</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Droplets className="w-4 h-4 text-gray-400" />
                      <span>{day.precipitationSum > 0 ? `${day.precipitationSum}" precip` : "No precip"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Cloud className="w-4 h-4 text-gray-400" />
                      <span>~{estVisibility} mi vis</span>
                    </div>
                  </div>
                </div>

                {/* Flight Conditions */}
                <div className="md:col-span-2 flex items-center">
                  <div className={`px-3 py-2 rounded-lg text-xs font-medium text-center ${flightCat.bgColor} ${flightCat.color}`}>
                    {flightCat.category}
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm text-gray-600 italic">{generateSummary(day, index)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Aviation Notes */}
      <div className="bg-yellow-50 rounded-2xl p-6 border border-yellow-200">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Wind className="w-5 h-5 text-yellow-700" />
          <span className="text-yellow-900">Aviation Planning Notes</span>
        </h3>
        <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
          <li>Data sourced from Open-Meteo API — always verify with official TAF/METAR before flight</li>
          <li>Flight categories shown are estimates based on forecast conditions</li>
          <li>Wind conditions can vary significantly throughout the day</li>
          <li>Consider alternate airports if marginal or IFR conditions are forecast</li>
        </ul>
      </div>
    </div>
  );
}
