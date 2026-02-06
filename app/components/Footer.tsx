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
    <footer className="mt-3 sm:mt-4 border-t border-gray-200 bg-white/70 py-1.5 px-3 sm:px-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 text-[11px] sm:text-xs text-gray-500">
        <div className="min-w-0">
          <span className="truncate">
            Data current as of {lastUpdated ? lastUpdated.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }) : 'loading...'}
          </span>
        </div>
        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md flex-shrink-0">
          Made by Griff
        </span>
      </div>
    </footer>
  );
}
