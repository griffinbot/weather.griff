import { Plane, MapPin, Clock, Wind, Fuel, Route } from "lucide-react";
import { useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface Location {
  name: string;
  airport: string;
}

interface FlightPlanningProps {
  location: Location;
}

export function FlightPlanning({ location }: FlightPlanningProps) {
  const [departure, setDeparture] = useState(location.airport);
  const [destination, setDestination] = useState("");
  const [cruiseAltitude, setCruiseAltitude] = useState("5500");

  // Mock route waypoints
  const waypoints = [
    { name: departure, distance: 0, eta: new Date(), wind: "320° 15kt", temp: 68 },
    { name: "SUNOL", distance: 25, eta: new Date(Date.now() + 15 * 60000), wind: "315° 18kt", temp: 64 },
    { name: "TRACY", distance: 48, eta: new Date(Date.now() + 30 * 60000), wind: "310° 20kt", temp: 62 },
    { name: destination || "KOAK", distance: 72, eta: new Date(Date.now() + 45 * 60000), wind: "305° 16kt", temp: 66 },
  ];

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold mb-2">Flight Planning</h2>
            <p className="text-gray-600">Plan your route with weather considerations</p>
          </div>
          <Plane className="w-8 h-8 text-blue-500" />
        </div>
      </div>

      {/* Coming Soon Banner */}
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-8 text-white text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-white/20 p-4 rounded-full">
            <Route className="w-12 h-12" />
          </div>
        </div>
        <h3 className="text-2xl font-semibold mb-2">Coming Soon</h3>
        <p className="text-blue-100 max-w-2xl mx-auto">
          Comprehensive flight planning tools with route optimization, fuel calculations, 
          weather briefings, and NOTAM integration are currently in development.
        </p>
      </div>

      {/* Flight Plan Form (Preview) */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 opacity-60">
        <h3 className="font-semibold text-lg mb-4">Route Planning (Preview)</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="space-y-2">
            <Label htmlFor="departure">Departure</Label>
            <Input
              id="departure"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              placeholder="ICAO Code"
              disabled
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="destination">Destination</Label>
            <Input
              id="destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="ICAO Code"
              disabled
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="cruise-alt">Cruise Altitude</Label>
            <Select value={cruiseAltitude} onValueChange={setCruiseAltitude} disabled>
              <SelectTrigger id="cruise-alt">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3500">3,500 ft</SelectItem>
                <SelectItem value="5500">5,500 ft</SelectItem>
                <SelectItem value="7500">7,500 ft</SelectItem>
                <SelectItem value="9500">9,500 ft</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="aircraft">Aircraft Type</Label>
            <Input
              id="aircraft"
              placeholder="e.g., C172, PA28"
              disabled
            />
          </div>
        </div>

        <Button className="w-full" disabled>
          Generate Flight Plan
        </Button>
      </div>

      {/* Features Preview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Route className="w-6 h-6 text-blue-600" />
            </div>
            <h4 className="font-semibold">Route Optimization</h4>
          </div>
          <p className="text-sm text-gray-600">
            Automatically calculate optimal routes considering weather, airspace, and fuel efficiency.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Wind className="w-6 h-6 text-blue-600" />
            </div>
            <h4 className="font-semibold">Wind Analysis</h4>
          </div>
          <p className="text-sm text-gray-600">
            Real-time wind data along your route with headwind/tailwind components at cruise altitude.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Fuel className="w-6 h-6 text-blue-600" />
            </div>
            <h4 className="font-semibold">Fuel Planning</h4>
          </div>
          <p className="text-sm text-gray-600">
            Calculate fuel requirements with reserves, considering winds and aircraft performance.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
            <h4 className="font-semibold">Time Estimates</h4>
          </div>
          <p className="text-sm text-gray-600">
            Accurate ETA calculations for each waypoint based on current weather conditions.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <MapPin className="w-6 h-6 text-blue-600" />
            </div>
            <h4 className="font-semibold">Waypoint Weather</h4>
          </div>
          <p className="text-sm text-gray-600">
            View forecast conditions at each waypoint along your planned route.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Plane className="w-6 h-6 text-blue-600" />
            </div>
            <h4 className="font-semibold">NOTAM Integration</h4>
          </div>
          <p className="text-sm text-gray-600">
            Automatically fetch relevant NOTAMs for departure, destination, and route.
          </p>
        </div>
      </div>
    </div>
  );
}
