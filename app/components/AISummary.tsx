import { Sparkles } from "lucide-react";

interface Location {
  name: string;
  airport: string;
}

interface AISummaryProps {
  location: Location;
}

export function AISummary({ location }: AISummaryProps) {
  // Mock AI-generated summary
  const summary = `Current conditions at ${location.airport} show favorable flying weather with light to moderate winds. The wind is primarily from the northwest at 12-18 knots with occasional gusts to 22 knots. Visibility is excellent at 10+ statute miles with scattered clouds at 4,500 feet. Temperature is 68°F with a dew point of 52°F, indicating comfortable conditions. The barometric pressure is steady at 30.12 inHg. Over the next 12 hours, expect winds to shift to the west-southwest and decrease slightly to 8-14 knots. No significant weather is forecast, making this an ideal period for flight operations.`;

  return (
    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5" />
        <h3 className="font-semibold">AI Weather Synopsis</h3>
      </div>
      <p className="text-blue-50 leading-relaxed text-sm">
        {summary}
      </p>
    </div>
  );
}
