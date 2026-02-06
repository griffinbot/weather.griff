import { useWeather } from "../hooks/useWeather";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface FooterProps {
  location: Location;
}

export function Footer({ location }: FooterProps) {
  const { lastUpdated } = useWeather(location.lat, location.lon);

  return (
    <footer className="sticky bottom-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200 py-2 px-3 sm:px-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 text-[11px] sm:text-xs text-gray-500">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <img
            src="/griff-weather-logo.svg"
            alt="Griff Weather"
            className="hidden md:block h-6 w-auto"
          />
          <span className="truncate">
            Data current as of {lastUpdated ? lastUpdated.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }) : 'loading...'}
          </span>
          <span className="hidden sm:inline text-gray-300">•</span>
          <span className="hidden sm:inline">Made by Griff</span>
        </div>
        <span className="px-2 py-1 sm:px-3 sm:py-1.5 bg-gray-100 text-gray-700 rounded-lg flex-shrink-0">
          Made by Griff
        </span>
      </div>
    </footer>
  );
}
