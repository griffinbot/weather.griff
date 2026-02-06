import { Mail } from "lucide-react";
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
    <footer className="bg-white border-t border-gray-200 py-3 px-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span>
            Data current as of {lastUpdated ? lastUpdated.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }) : 'loading...'}
          </span>
          <span className="text-gray-300">•</span>
          <span>Made by Griff</span>
        </div>
        <a
          href="mailto:griff@example.com?subject=Aviation Weather App - Bug Report"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
        >
          <Mail className="w-3.5 h-3.5" />
          <span>Report a bug</span>
        </a>
      </div>
    </footer>
  );
}
