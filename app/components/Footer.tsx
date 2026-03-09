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
    <footer
      className="fixed left-0 right-0 bottom-[-30px] sm:bottom-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 py-2 px-3 sm:px-6"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-center sm:justify-start gap-2 text-[11px] sm:text-xs text-gray-500">
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
        </div>
      </div>
    </footer>
  );
}
