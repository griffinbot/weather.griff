import { MessageSquare } from "lucide-react";
import { useWeather } from "../hooks/useWeather";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface FooterProps {
  location: Location;
  onOpenChat: () => void;
}

export function Footer({ location, onOpenChat }: FooterProps) {
  const { lastUpdated } = useWeather(location.lat, location.lon);

  return (
    <footer
      className="fixed left-0 right-0 bottom-[-30px] sm:bottom-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 py-2 px-3 sm:px-6"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 text-[11px] sm:text-xs text-gray-500">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
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
        <button
          type="button"
          onClick={onOpenChat}
          className="flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          <MessageSquare className="h-4 w-4" />
          <span>AI Chat</span>
        </button>
      </div>
    </footer>
  );
}
