import { Settings, Bell, Globe, Thermometer, Wind, Gauge, Mail, BarChart3 } from "lucide-react";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { MetadataReport } from "./MetadataReport";

interface SettingsPanelProps {
  location: {
    name: string;
    airport: string;
  };
  embedded?: boolean;
}

export function SettingsPanel({ location, embedded = false }: SettingsPanelProps) {
  return (
    <div className={embedded ? "w-full space-y-4" : "w-full p-6 xl:px-8 space-y-6"}>
      {/* Header */}
      {!embedded && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold mb-2">Settings</h2>
              <p className="text-gray-600">Customize your weather app experience</p>
            </div>
            <Settings className="w-8 h-8 text-blue-500" />
          </div>
        </div>
      )}

      {/* Units */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-500" />
          Units & Display
        </h3>
        
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-gray-400" />
                Temperature
              </Label>
              <p className="text-sm text-gray-500">Choose temperature display unit</p>
            </div>
            <Select defaultValue="fahrenheit">
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fahrenheit">Fahrenheit (°F)</SelectItem>
                <SelectItem value="celsius">Celsius (°C)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base flex items-center gap-2">
                <Wind className="w-4 h-4 text-gray-400" />
                Wind Speed
              </Label>
              <p className="text-sm text-gray-500">Choose wind speed unit</p>
            </div>
            <Select defaultValue="knots">
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="knots">Knots (kt)</SelectItem>
                <SelectItem value="mph">Miles per hour (mph)</SelectItem>
                <SelectItem value="kph">Kilometers per hour (km/h)</SelectItem>
                <SelectItem value="ms">Meters per second (m/s)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base flex items-center gap-2">
                <Gauge className="w-4 h-4 text-gray-400" />
                Pressure
              </Label>
              <p className="text-sm text-gray-500">Choose pressure unit</p>
            </div>
            <Select defaultValue="inhg">
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inhg">Inches of Mercury (inHg)</SelectItem>
                <SelectItem value="mb">Millibars (mb)</SelectItem>
                <SelectItem value="hpa">Hectopascals (hPa)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Distance/Visibility</Label>
              <p className="text-sm text-gray-500">Choose distance unit</p>
            </div>
            <Select defaultValue="miles">
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="miles">Miles (mi)</SelectItem>
                <SelectItem value="kilometers">Kilometers (km)</SelectItem>
                <SelectItem value="nautical">Nautical Miles (nm)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Altitude</Label>
              <p className="text-sm text-gray-500">Choose altitude unit</p>
            </div>
            <Select defaultValue="feet">
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feet">Feet (ft)</SelectItem>
                <SelectItem value="meters">Meters (m)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-500" />
          Notifications & Alerts
        </h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="severe-weather" className="text-base">Severe Weather Alerts</Label>
              <p className="text-sm text-gray-500">Receive alerts for severe weather conditions</p>
            </div>
            <Switch id="severe-weather" defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="wind-alerts" className="text-base">High Wind Alerts</Label>
              <p className="text-sm text-gray-500">Get notified when winds exceed 25 knots</p>
            </div>
            <Switch id="wind-alerts" defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="visibility-alerts" className="text-base">Low Visibility Alerts</Label>
              <p className="text-sm text-gray-500">Alert when visibility drops below 3 miles</p>
            </div>
            <Switch id="visibility-alerts" defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="forecast-updates" className="text-base">Forecast Updates</Label>
              <p className="text-sm text-gray-500">Notify when forecasts are updated</p>
            </div>
            <Switch id="forecast-updates" />
          </div>
        </div>
      </div>

      {/* Data & Privacy */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-lg mb-4">Data & Display Preferences</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="auto-refresh" className="text-base">Auto-Refresh Data</Label>
              <p className="text-sm text-gray-500">Automatically update weather data every 15 minutes</p>
            </div>
            <Switch id="auto-refresh" defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="detailed-view" className="text-base">Detailed Wind Tables</Label>
              <p className="text-sm text-gray-500">Show comprehensive wind data by default</p>
            </div>
            <Switch id="detailed-view" defaultChecked />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="24-hour" className="text-base">24-Hour Time Format</Label>
              <p className="text-sm text-gray-500">Use 24-hour clock instead of 12-hour</p>
            </div>
            <Switch id="24-hour" />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="save-locations" className="text-base">Save Location History</Label>
              <p className="text-sm text-gray-500">Remember previously searched locations</p>
            </div>
            <Switch id="save-locations" defaultChecked />
          </div>
        </div>
      </div>

      {!embedded && (
        <>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  Metadata
                </h3>
                <p className="text-sm text-gray-500">
                  Data sources, model runs, and confidence metrics for {location.name}
                </p>
              </div>
            </div>
          </div>

          <MetadataReport location={location} embedded />
        </>
      )}

      {/* About */}
      <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200">
        <div className="text-center space-y-2">
          <img
            src="/griff-weather-logo.svg"
            alt="Griff Weather"
            className="h-14 sm:h-16 w-auto mx-auto"
          />
          <h4 className="font-semibold">Weather App for Aviation</h4>
          <p className="text-sm text-gray-600">Version 1.0.0</p>
          <p className="text-xs text-gray-500 mt-4">
            Data provided by NOAA, National Weather Service, and Aviation Weather Center
          </p>
        </div>
      </div>

      {/* Feedback */}
      <a
        href="mailto:griff@example.com?subject=Aviation Weather App - Bug Report"
        className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl p-4 sm:p-5 flex items-center justify-center gap-2 font-semibold text-base shadow-sm transition-colors"
      >
        <Mail className="w-5 h-5" />
        <span>Report a Bug</span>
      </a>
    </div>
  );
}
