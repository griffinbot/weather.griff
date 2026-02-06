import { useState, useEffect, useCallback, useRef } from "react";
import { openMeteoFetch } from "../services/weatherProxy";

// --- WMO Weather Code Interpretation ---
export function getWeatherCondition(code: number): string {
  const map: Record<number, string> = {
    0: "Clear Sky",
    1: "Mainly Clear",
    2: "Partly Cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime Fog",
    51: "Light Drizzle",
    53: "Moderate Drizzle",
    55: "Dense Drizzle",
    56: "Lt Freezing Drizzle",
    57: "Freezing Drizzle",
    61: "Light Rain",
    63: "Moderate Rain",
    65: "Heavy Rain",
    66: "Lt Freezing Rain",
    67: "Freezing Rain",
    71: "Light Snow",
    73: "Moderate Snow",
    75: "Heavy Snow",
    77: "Snow Grains",
    80: "Light Showers",
    81: "Moderate Showers",
    82: "Violent Showers",
    85: "Light Snow Showers",
    86: "Heavy Snow Showers",
    95: "Thunderstorm",
    96: "T-Storm w/ Hail",
    99: "Severe T-Storm",
  };
  return map[code] ?? "Unknown";
}

export function getWeatherIcon(code: number): "clear" | "partly-cloudy" | "cloudy" | "fog" | "drizzle" | "rain" | "freezing" | "snow" | "showers" | "thunderstorm" {
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code >= 56 && code <= 57) return "freezing";
  if (code >= 61 && code <= 65) return "rain";
  if (code >= 66 && code <= 67) return "freezing";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

// --- Interfaces ---
export interface CurrentWeatherData {
  temperature: number; // °F
  feelsLike: number; // °F
  humidity: number; // %
  weatherCode: number;
  condition: string;
  icon: string;
  windSpeed: number; // knots
  windDirection: number; // degrees
  windGusts: number; // knots
  pressure: number; // inHg
  visibility: number; // statute miles
  cloudCover: number; // %
  dewPoint: number; // °F
  precipitation: number; // inch
  isDay: boolean;
}

export interface HourlyForecastData {
  time: Date;
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
  visibility: number; // miles
  cloudCover: number;
  dewPoint: number;
}

export interface DailyForecastData {
  date: Date;
  high: number;
  low: number;
  weatherCode: number;
  condition: string;
  icon: string;
  windSpeed: number; // max
  windDirection: number; // dominant
  windGusts: number; // max
  precipitationProbability: number;
  precipitationSum: number; // inch
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
}

export interface WeatherState {
  current: CurrentWeatherData | null;
  hourly: HourlyForecastData[];
  daily: DailyForecastData[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

// Simple in-memory cache
const cache: Record<string, { data: any; timestamp: number }> = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

export function useWeather(lat: number, lon: number) {
  const [state, setState] = useState<WeatherState>({
    current: null,
    hourly: [],
    daily: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchWeather = useCallback(async () => {
    const key = getCacheKey(lat, lon);
    const cached = cache[key];

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      setState({
        ...cached.data,
        loading: false,
        error: null,
        lastUpdated: new Date(cached.timestamp),
      });
      return;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const params = new URLSearchParams({
        latitude: lat.toString(),
        longitude: lon.toString(),
        current: [
          "temperature_2m",
          "relative_humidity_2m",
          "apparent_temperature",
          "weather_code",
          "wind_speed_10m",
          "wind_direction_10m",
          "wind_gusts_10m",
          "surface_pressure",
          "cloud_cover",
          "precipitation",
          "is_day",
        ].join(","),
        hourly: [
          "temperature_2m",
          "apparent_temperature",
          "weather_code",
          "wind_speed_10m",
          "wind_direction_10m",
          "wind_gusts_10m",
          "relative_humidity_2m",
          "precipitation_probability",
          "visibility",
          "cloud_cover",
          "dew_point_2m",
        ].join(","),
        daily: [
          "temperature_2m_max",
          "temperature_2m_min",
          "weather_code",
          "wind_speed_10m_max",
          "wind_direction_10m_dominant",
          "wind_gusts_10m_max",
          "precipitation_probability_max",
          "precipitation_sum",
          "sunrise",
          "sunset",
          "uv_index_max",
        ].join(","),
        temperature_unit: "fahrenheit",
        wind_speed_unit: "kn",
        precipitation_unit: "inch",
        timezone: "auto",
        forecast_days: "7",
        forecast_hours: "48",
      });

      // openMeteoFetch returns parsed JSON via the caching proxy
      const data = await openMeteoFetch(
        `/api/open-meteo/forecast?${params.toString()}`
      );

      // Check if we were aborted while waiting
      if (controller.signal.aborted) return;

      // Parse current weather
      const current: CurrentWeatherData = {
        temperature: Math.round(data.current.temperature_2m),
        feelsLike: Math.round(data.current.apparent_temperature),
        humidity: data.current.relative_humidity_2m,
        weatherCode: data.current.weather_code,
        condition: getWeatherCondition(data.current.weather_code),
        icon: getWeatherIcon(data.current.weather_code),
        windSpeed: Math.round(data.current.wind_speed_10m),
        windDirection: data.current.wind_direction_10m,
        windGusts: Math.round(data.current.wind_gusts_10m),
        pressure: Math.round((data.current.surface_pressure * 0.02953) * 100) / 100, // hPa → inHg
        visibility: 10, // Open-Meteo free tier doesn't include current visibility; default good
        cloudCover: data.current.cloud_cover,
        dewPoint: Math.round(data.hourly?.dew_point_2m?.[0] ?? data.current.temperature_2m - 10),
        precipitation: data.current.precipitation,
        isDay: data.current.is_day === 1,
      };

      // Parse hourly forecast
      const hourly: HourlyForecastData[] = (data.hourly.time as string[]).map(
        (t: string, i: number) => ({
          time: new Date(t),
          temperature: Math.round(data.hourly.temperature_2m[i]),
          feelsLike: Math.round(data.hourly.apparent_temperature[i]),
          weatherCode: data.hourly.weather_code[i],
          condition: getWeatherCondition(data.hourly.weather_code[i]),
          icon: getWeatherIcon(data.hourly.weather_code[i]),
          windSpeed: Math.round(data.hourly.wind_speed_10m[i]),
          windDirection: data.hourly.wind_direction_10m[i],
          windGusts: Math.round(data.hourly.wind_gusts_10m[i]),
          humidity: data.hourly.relative_humidity_2m[i],
          precipitationProbability: data.hourly.precipitation_probability[i] ?? 0,
          visibility: Math.round((data.hourly.visibility[i] / 1609.34) * 10) / 10, // m → mi
          cloudCover: data.hourly.cloud_cover[i],
          dewPoint: Math.round(data.hourly.dew_point_2m[i]),
        })
      );

      // Parse daily forecast
      const daily: DailyForecastData[] = (data.daily.time as string[]).map(
        (t: string, i: number) => ({
          date: new Date(t + "T12:00:00"),
          high: Math.round(data.daily.temperature_2m_max[i]),
          low: Math.round(data.daily.temperature_2m_min[i]),
          weatherCode: data.daily.weather_code[i],
          condition: getWeatherCondition(data.daily.weather_code[i]),
          icon: getWeatherIcon(data.daily.weather_code[i]),
          windSpeed: Math.round(data.daily.wind_speed_10m_max[i]),
          windDirection: data.daily.wind_direction_10m_dominant[i],
          windGusts: Math.round(data.daily.wind_gusts_10m_max[i]),
          precipitationProbability: data.daily.precipitation_probability_max[i] ?? 0,
          precipitationSum: data.daily.precipitation_sum[i],
          sunrise: data.daily.sunrise[i],
          sunset: data.daily.sunset[i],
          uvIndexMax: data.daily.uv_index_max[i],
        })
      );

      const result = { current, hourly, daily };
      cache[key] = { data: result, timestamp: Date.now() };

      setState({
        ...result,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || "Failed to fetch weather data",
      }));
    }
  }, [lat, lon]);

  useEffect(() => {
    fetchWeather();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchWeather]);

  return { ...state, refetch: fetchWeather };
}

// Lightweight hook for just current conditions (for widget cards)
export function useCurrentWeather(lat: number, lon: number) {
  const [data, setData] = useState<CurrentWeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const key = getCacheKey(lat, lon);
    const cached = cache[key];

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      setData(cached.data.current);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchCurrent = async () => {
      try {
        const params = new URLSearchParams({
          latitude: lat.toString(),
          longitude: lon.toString(),
          current: [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "weather_code",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
            "surface_pressure",
            "cloud_cover",
            "precipitation",
            "is_day",
          ].join(","),
          hourly: "dew_point_2m",
          temperature_unit: "fahrenheit",
          wind_speed_unit: "kn",
          precipitation_unit: "inch",
          timezone: "auto",
          forecast_hours: "1",
        });

        // openMeteoFetch returns parsed JSON via the caching proxy
        const json = await openMeteoFetch(
          `/api/open-meteo/forecast?${params.toString()}`
        );

        if (cancelled) return;

        const current: CurrentWeatherData = {
          temperature: Math.round(json.current.temperature_2m),
          feelsLike: Math.round(json.current.apparent_temperature),
          humidity: json.current.relative_humidity_2m,
          weatherCode: json.current.weather_code,
          condition: getWeatherCondition(json.current.weather_code),
          icon: getWeatherIcon(json.current.weather_code),
          windSpeed: Math.round(json.current.wind_speed_10m),
          windDirection: json.current.wind_direction_10m,
          windGusts: Math.round(json.current.wind_gusts_10m),
          pressure: Math.round(json.current.surface_pressure * 0.02953 * 100) / 100,
          visibility: 10,
          cloudCover: json.current.cloud_cover,
          dewPoint: Math.round(json.hourly?.dew_point_2m?.[0] ?? json.current.temperature_2m - 10),
          precipitation: json.current.precipitation,
          isDay: json.current.is_day === 1,
        };

        setData(current);
      } catch {
        // Silently fail for widget
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCurrent();
    return () => { cancelled = true; };
  }, [lat, lon]);

  return { data, loading };
}

// Direction helpers
export function getWindDirectionName(degrees: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(degrees / 22.5) % 16];
}

export function getCeiling(cloudCover: number): number {
  // Estimate ceiling from cloud cover percentage
  if (cloudCover >= 90) return 2000;
  if (cloudCover >= 70) return 4500;
  if (cloudCover >= 50) return 8000;
  if (cloudCover >= 25) return 15000;
  return 25000;
}

export function getFlightCategory(visibility: number, ceiling: number): {
  category: string;
  color: string;
  bgColor: string;
} {
  if (visibility < 1 || ceiling < 500) return { category: "LIFR", color: "text-fuchsia-800", bgColor: "bg-fuchsia-100" };
  if (visibility < 3 || ceiling < 1000) return { category: "IFR", color: "text-red-800", bgColor: "bg-red-100" };
  if (visibility < 5 || ceiling < 3000) return { category: "MVFR", color: "text-blue-800", bgColor: "bg-blue-100" };
  return { category: "VFR", color: "text-green-800", bgColor: "bg-green-100" };
}
