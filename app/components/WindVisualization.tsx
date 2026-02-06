import { Wind, ArrowUp, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Slider } from "./ui/slider";

interface Location {
  name: string;
  airport: string;
}

interface WindVisualizationProps {
  location: Location;
}

export function WindVisualization({ location }: WindVisualizationProps) {
  const [selectedAltitude, setSelectedAltitude] = useState(5000);
  const [selectedHour, setSelectedHour] = useState(0);

  const altitudes = [1000, 2000, 3000, 5000, 8000, 10000, 14000, 18000];

  // Generate wind vectors for visualization
  const generateWindVectors = () => {
    const vectors = [];
    const gridSize = 8;
    
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const altitudeFactor = selectedAltitude / 1000;
        const baseAngle = 300 + (selectedHour * 5);
        const angle = baseAngle + (Math.random() - 0.5) * 30;
        const speed = 12 + altitudeFactor * 2 + (Math.random() * 5);
        
        vectors.push({
          x: (i / gridSize) * 100,
          y: (j / gridSize) * 100,
          angle,
          speed,
          length: Math.min(speed * 2, 40)
        });
      }
    }
    
    return vectors;
  };

  const windVectors = generateWindVectors();

  const getWindSpeed = (altitude: number) => {
    const altitudeFactor = altitude / 1000;
    return Math.round(12 + altitudeFactor * 2 + selectedHour * 0.5);
  };

  const getWindDirection = (altitude: number) => {
    const altitudeFactor = altitude / 1000;
    return Math.round(300 + altitudeFactor * 5 + selectedHour * 3);
  };

  const formatTime = (hour: number) => {
    const date = new Date();
    date.setHours(date.getHours() + hour);
    const hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:00 ${ampm}`;
  };

  const getDirectionName = (degrees: number) => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[Math.round(degrees / 22.5) % 16];
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold mb-2">Wind Visualization</h2>
            <p className="text-gray-600">Interactive wind field modeling for {location.name}</p>
          </div>
          <Wind className="w-8 h-8 text-blue-500" />
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold">Altitude Selection</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Selected Altitude</span>
              <span className="font-semibold text-lg text-blue-600">{selectedAltitude.toLocaleString()} ft MSL</span>
            </div>
            <Slider
              value={[selectedAltitude]}
              onValueChange={(values) => setSelectedAltitude(values[0])}
              min={1000}
              max={18000}
              step={1000}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>1,000 ft</span>
              <span>18,000 ft</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Wind className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold">Time Selection</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Forecast Hour</span>
              <span className="font-semibold text-lg text-blue-600">{formatTime(selectedHour)}</span>
            </div>
            <Slider
              value={[selectedHour]}
              onValueChange={(values) => setSelectedHour(values[0])}
              min={0}
              max={23}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>Now</span>
              <span>+23 hours</span>
            </div>
          </div>
        </div>
      </div>

      {/* Wind Field Visualization */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-4">Wind Field at {selectedAltitude.toLocaleString()} ft MSL</h3>
        
        {/* Vector Field Display */}
        <div className="relative w-full aspect-square bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200 overflow-hidden">
          <svg className="w-full h-full">
            {/* Grid lines */}
            {[...Array(9)].map((_, i) => (
              <g key={i}>
                <line
                  x1={`${(i / 8) * 100}%`}
                  y1="0%"
                  x2={`${(i / 8) * 100}%`}
                  y2="100%"
                  stroke="#cbd5e1"
                  strokeWidth="1"
                  opacity="0.3"
                />
                <line
                  x1="0%"
                  y1={`${(i / 8) * 100}%`}
                  x2="100%"
                  y2={`${(i / 8) * 100}%`}
                  stroke="#cbd5e1"
                  strokeWidth="1"
                  opacity="0.3"
                />
              </g>
            ))}
            
            {/* Wind vectors */}
            {windVectors.map((vector, index) => {
              const radians = (vector.angle - 90) * (Math.PI / 180);
              const endX = vector.x + Math.cos(radians) * vector.length / 4;
              const endY = vector.y + Math.sin(radians) * vector.length / 4;
              
              // Calculate arrow head points
              const arrowLength = 8;
              const arrowAngle = 25 * (Math.PI / 180);
              const angle1 = radians + Math.PI - arrowAngle;
              const angle2 = radians + Math.PI + arrowAngle;
              
              const arrowX1 = endX + Math.cos(angle1) * arrowLength;
              const arrowY1 = endY + Math.sin(angle1) * arrowLength;
              const arrowX2 = endX + Math.cos(angle2) * arrowLength;
              const arrowY2 = endY + Math.sin(angle2) * arrowLength;
              
              const opacity = Math.min(vector.speed / 30, 1);
              const color = vector.speed > 20 ? '#ef4444' : vector.speed > 15 ? '#f59e0b' : '#3b82f6';
              
              return (
                <g key={index} opacity={opacity}>
                  <line
                    x1={`${vector.x}%`}
                    y1={`${vector.y}%`}
                    x2={`${endX}%`}
                    y2={`${endY}%`}
                    stroke={color}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <polygon
                    points={`${endX},${endY} ${arrowX1},${arrowY1} ${arrowX2},${arrowY2}`}
                    fill={color}
                  />
                </g>
              );
            })}
          </svg>
          
          {/* Legend */}
          <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-md">
            <div className="text-xs font-semibold mb-2">Wind Speed</div>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-blue-500 rounded"></div>
                <span>Light (0-15 kt)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-amber-500 rounded"></div>
                <span>Moderate (15-20 kt)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-red-500 rounded"></div>
                <span>Strong (20+ kt)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wind Profile by Altitude */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-4">Vertical Wind Profile at {formatTime(selectedHour)}</h3>
        
        <div className="space-y-3">
          {altitudes.map((altitude) => {
            const speed = getWindSpeed(altitude);
            const direction = getWindDirection(altitude);
            const maxSpeed = 40;
            const barWidth = (speed / maxSpeed) * 100;
            
            return (
              <div
                key={altitude}
                className={`p-4 rounded-xl border-2 transition-all ${
                  altitude === selectedAltitude
                    ? "bg-blue-50 border-blue-300"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="font-semibold text-sm w-24">{altitude.toLocaleString()} ft</div>
                    <div className="flex items-center gap-2">
                      <ArrowUp 
                        className="w-4 h-4 text-blue-600" 
                        style={{ transform: `rotate(${direction}deg)` }}
                      />
                      <span className="text-sm font-medium">{getDirectionName(direction)}</span>
                      <span className="text-xs text-gray-500">({direction}°)</span>
                    </div>
                  </div>
                  <div className="font-semibold text-blue-600">{speed} kt</div>
                </div>
                
                {/* Speed bar */}
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      speed > 25 ? "bg-red-500" : speed > 18 ? "bg-amber-500" : "bg-blue-500"
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
