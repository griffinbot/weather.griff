import { ExternalLink, FileText } from "lucide-react";
import { Button } from "./ui/button";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface WeatherDiscussionProps {
  location: Location;
}

// Map coordinates to NWS Weather Forecast Office (WFO) codes
function getNWSOfficeCode(lat: number, lon: number): { code: string; name: string } {
  // This is a simplified mapping based on major regions
  // A complete implementation would use NWS API or a comprehensive lookup table
  
  // Pacific Northwest
  if (lat >= 45.5 && lat <= 49 && lon >= -125 && lon <= -121) {
    return { code: "sew", name: "Seattle/Tacoma" };
  }
  if (lat >= 43 && lat <= 46 && lon >= -125 && lon <= -121) {
    return { code: "pqr", name: "Portland" };
  }
  
  // California
  if (lat >= 37 && lat <= 39 && lon >= -123 && lon <= -121) {
    return { code: "mtr", name: "San Francisco Bay Area" };
  }
  if (lat >= 33 && lat <= 34.5 && lon >= -119 && lon <= -117) {
    return { code: "lox", name: "Los Angeles/Oxnard" };
  }
  if (lat >= 32 && lat <= 33.5 && lon >= -118 && lon <= -116) {
    return { code: "sgx", name: "San Diego" };
  }
  
  // Southwest
  if (lat >= 33 && lat <= 36 && lon >= -115 && lon <= -112) {
    return { code: "psr", name: "Phoenix" };
  }
  if (lat >= 35 && lat <= 37 && lon >= -107 && lon <= -103) {
    return { code: "abq", name: "Albuquerque" };
  }
  
  // Mountain West
  if (lat >= 39 && lat <= 41 && lon >= -112.5 && lon <= -110) {
    return { code: "slc", name: "Salt Lake City" };
  }
  if (lat >= 39 && lat <= 41 && lon >= -106 && lon <= -104) {
    return { code: "bou", name: "Boulder/Denver" };
  }
  
  // Texas
  if (lat >= 29 && lat <= 30.5 && lon >= -96 && lon <= -94) {
    return { code: "hgx", name: "Houston/Galveston" };
  }
  if (lat >= 32 && lat <= 33.5 && lon >= -97.5 && lon <= -96) {
    return { code: "fwd", name: "Dallas/Fort Worth" };
  }
  
  // Midwest
  if (lat >= 41 && lat <= 42.5 && lon >= -88.5 && lon <= -87) {
    return { code: "lot", name: "Chicago" };
  }
  if (lat >= 44 && lat <= 45.5 && lon >= -94 && lon <= -92) {
    return { code: "mpx", name: "Minneapolis/St. Paul" };
  }
  
  // Southeast
  if (lat >= 33 && lat <= 34.5 && lon >= -85 && lon <= -83) {
    return { code: "ffc", name: "Atlanta" };
  }
  if (lat >= 25 && lat <= 26.5 && lon >= -81 && lon <= -79.5) {
    return { code: "mfl", name: "Miami" };
  }
  if (lat >= 27.5 && lat <= 29 && lon >= -83 && lon <= -81.5) {
    return { code: "tbw", name: "Tampa Bay" };
  }
  
  // Northeast
  if (lat >= 40 && lat <= 41.5 && lon >= -75 && lon <= -73) {
    return { code: "okx", name: "New York City" };
  }
  if (lat >= 39.5 && lat <= 40.5 && lon >= -76 && lon <= -74.5) {
    return { code: "phi", name: "Philadelphia" };
  }
  if (lat >= 42 && lat <= 43 && lon >= -72 && lon <= -70) {
    return { code: "box", name: "Boston" };
  }
  if (lat >= 38.5 && lat <= 39.5 && lon >= -77.5 && lon <= -76.5) {
    return { code: "lwx", name: "Washington DC/Baltimore" };
  }
  
  // Default to a central office
  return { code: "oax", name: "Omaha/Valley" };
}

export function WeatherDiscussion({ location }: WeatherDiscussionProps) {
  const nwsOffice = getNWSOfficeCode(location.lat, location.lon);
  const discussionUrl = `https://forecast.weather.gov/product.php?site=nws&issuedby=${nwsOffice.code}&product=afd&format=ci&version=1&glossary=1&highlight=off`;
  
  // Mock discussion data
  const discussion = {
    title: "Area Forecast Discussion",
    office: `National Weather Service ${nwsOffice.name}`,
    issueTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
    forecaster: "Miller",
    content: `
.SHORT TERM...(Tonight through Thursday)

High pressure will remain positioned over the region through the period, maintaining dry conditions and light winds. Coastal stratus and fog will continue to develop each night and morning, with clearing expected by late morning to early afternoon. Inland areas will see mostly clear skies.

Temperatures will remain near seasonal averages, with highs in the upper 60s to low 70s along the coast and mid to upper 70s inland. Overnight lows will range from the mid 40s in sheltered valleys to the mid 50s along the immediate coast.

Light onshore flow will prevail, with afternoon sea breezes developing along the coast and bay. Winds generally light, 5-12 kt, with occasional gusts to 18 kt in wind-prone areas during peak heating hours.

.LONG TERM...(Friday through Tuesday)

The upper ridge will begin to weaken late in the week as an upper-level trough approaches from the northwest. This will bring increased cloud cover and a slight chance of precipitation by the weekend, primarily across northern portions of the forecast area.

Aviation...VFR conditions expected to prevail, with the exception of MVFR CIGs/VSBY in early morning coastal stratus. Stratus deck typically lifts to scattered BKN by 18Z. Light winds with afternoon sea breezes.

Marine...Small Craft Advisory remains in effect for the outer waters through Thursday due to steep seas. Combined seas 8-11 ft with dominant period 12-14 seconds. Winds W 10-20 kt.

$$
    `.trim(),
    relatedLinks: [
      { title: "View Full NWS Discussion", url: discussionUrl },
      { title: "Graphical Forecasts", url: `https://www.weather.gov/` },
      { title: "Radar", url: `https://radar.weather.gov/` },
      { title: "Aviation Weather Center", url: "https://aviationweather.gov/" }
    ]
  };

  const formatTime = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold mb-2">{discussion.title}</h2>
            <p className="text-gray-600">{discussion.office}</p>
          </div>
          <FileText className="w-8 h-8 text-blue-500" />
        </div>
        
        <div className="flex items-center gap-6 text-sm text-gray-600">
          <div>
            <span className="text-gray-500">Issued:</span> {formatTime(discussion.issueTime)}
          </div>
          <div>
            <span className="text-gray-500">Forecaster:</span> {discussion.forecaster}
          </div>
        </div>
      </div>

      {/* Discussion Content */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-700">
          {discussion.content}
        </pre>
      </div>

      {/* Related Links */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-4">Related Resources</h3>
        <div className="grid grid-cols-2 gap-3">
          {discussion.relatedLinks.map((link, index) => (
            <Button
              key={index}
              variant="outline"
              className="justify-between"
              asChild
            >
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.title}
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}