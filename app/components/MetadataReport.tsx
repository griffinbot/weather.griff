import { BarChart3, Database, Clock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

interface Location {
  name: string;
  airport: string;
}

interface MetadataReportProps {
  location: Location;
  embedded?: boolean;
}

export function MetadataReport({ location, embedded = false }: MetadataReportProps) {
  const metadata = {
    dataSources: [
      { name: "METAR", station: location.airport, updateFrequency: "Hourly", lastUpdate: new Date(Date.now() - 15 * 60 * 1000), status: "Active" },
      { name: "TAF", station: location.airport, updateFrequency: "6 hours", lastUpdate: new Date(Date.now() - 3 * 60 * 60 * 1000), status: "Active" },
      { name: "Winds Aloft", station: "Regional", updateFrequency: "12 hours", lastUpdate: new Date(Date.now() - 5 * 60 * 60 * 1000), status: "Active" },
      { name: "PIREP", station: "Area", updateFrequency: "As reported", lastUpdate: new Date(Date.now() - 45 * 60 * 1000), status: "Active" },
      { name: "Radar", station: "NEXRAD", updateFrequency: "5 minutes", lastUpdate: new Date(Date.now() - 3 * 60 * 1000), status: "Active" },
      { name: "Satellite", station: "GOES-18", updateFrequency: "15 minutes", lastUpdate: new Date(Date.now() - 12 * 60 * 1000), status: "Active" },
    ],
    modelRuns: [
      { model: "GFS", resolution: "0.25°", runtime: new Date(Date.now() - 6 * 60 * 60 * 1000), forecast: "384 hours", status: "Complete" },
      { model: "NAM", resolution: "12km", runtime: new Date(Date.now() - 4 * 60 * 60 * 1000), forecast: "84 hours", status: "Complete" },
      { model: "HRRR", resolution: "3km", runtime: new Date(Date.now() - 1 * 60 * 60 * 1000), forecast: "48 hours", status: "Complete" },
      { model: "RAP", resolution: "13km", runtime: new Date(Date.now() - 2 * 60 * 60 * 1000), forecast: "51 hours", status: "Complete" },
    ],
    qualityMetrics: [
      { metric: "Temperature Accuracy", value: "±2°F", confidence: "95%" },
      { metric: "Wind Speed Accuracy", value: "±3 kt", confidence: "90%" },
      { metric: "Wind Direction Accuracy", value: "±15°", confidence: "85%" },
      { metric: "Visibility Accuracy", value: "±1 mi", confidence: "88%" },
      { metric: "Ceiling Accuracy", value: "±500 ft", confidence: "82%" },
    ]
  };

  const formatTime = (date: Date) => {
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className={embedded ? "w-full space-y-6" : "w-full p-6 xl:px-8 space-y-6"}>
      {!embedded && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold mb-2">Metadata Report</h2>
              <p className="text-gray-600">Data sources, model information, and quality metrics for {location.name}</p>
            </div>
            <BarChart3 className="w-8 h-8 text-blue-500" />
          </div>
        </div>
      )}

      {/* Data Sources */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="p-6 pb-4 flex items-center gap-2 border-b border-gray-100">
          <Database className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold text-lg">Data Sources</h3>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Source</TableHead>
                <TableHead className="font-semibold">Station</TableHead>
                <TableHead className="font-semibold">Update Frequency</TableHead>
                <TableHead className="font-semibold">Last Update</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metadata.dataSources.map((source, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{source.name}</TableCell>
                  <TableCell>{source.station}</TableCell>
                  <TableCell className="text-gray-600">{source.updateFrequency}</TableCell>
                  <TableCell className="text-gray-600">{formatTime(source.lastUpdate)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                      {source.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Model Runs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="p-6 pb-4 flex items-center gap-2 border-b border-gray-100">
          <Clock className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold text-lg">Forecast Model Runs</h3>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Model</TableHead>
                <TableHead className="font-semibold">Resolution</TableHead>
                <TableHead className="font-semibold">Runtime</TableHead>
                <TableHead className="font-semibold">Forecast Length</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metadata.modelRuns.map((model, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{model.model}</TableCell>
                  <TableCell>{model.resolution}</TableCell>
                  <TableCell className="text-gray-600">
                    {model.runtime.toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </TableCell>
                  <TableCell className="text-gray-600">{model.forecast}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                      {model.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Quality Metrics */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-lg mb-4">Forecast Quality Metrics</h3>
        <div className="space-y-3">
          {metadata.qualityMetrics.map((metric, index) => (
            <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <div className="font-medium">{metric.metric}</div>
                <div className="text-sm text-gray-600 mt-1">Typical variance: {metric.value}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-500">Confidence</div>
                <div className="text-lg font-semibold text-blue-600">{metric.confidence}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
