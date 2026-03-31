import { Settings, BarChart3 } from "lucide-react";
import { useWeather } from "../hooks/useWeather";
import { Button } from "./ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger,
} from "./ui/drawer";
import { MetadataReport } from "./MetadataReport";
import { SettingsPanel } from "./SettingsPanel";

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
      <div className="max-w-7xl mx-auto flex items-center justify-between text-[11px] sm:text-xs text-gray-500">
        <span className="truncate">
          Data current as of {lastUpdated ? lastUpdated.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }) : 'loading...'}
        </span>

        <div className="flex items-center gap-1">
          <Drawer>
            <DrawerTrigger asChild>
              <Button
                variant="ghost"
                className="text-gray-500 hover:text-gray-700 gap-1.5 h-7 px-2 text-[11px] sm:text-xs"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Metadata</span>
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Metadata</DrawerTitle>
                <DrawerDescription>
                  Data sources and forecast model information for {location.name}
                </DrawerDescription>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-6">
                <MetadataReport location={location} embedded />
              </div>
            </DrawerContent>
          </Drawer>

          <Drawer>
            <DrawerTrigger asChild>
              <Button
                variant="ghost"
                className="text-gray-500 hover:text-gray-700 gap-1.5 h-7 px-2 text-[11px] sm:text-xs"
              >
                <Settings className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Settings</span>
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Settings</DrawerTitle>
                <DrawerDescription>
                  Customize your weather experience
                </DrawerDescription>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-6">
                <SettingsPanel location={location} embedded />
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </footer>
  );
}
