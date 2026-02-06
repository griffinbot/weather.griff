import { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, Cloud, Wind, Thermometer, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { useWeather, getWindDirectionName, getCeiling, getFlightCategory } from "../hooks/useWeather";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface AIAssistantPanelProps {
  location: Location;
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function AIAssistantPanel({ location, isOpen, onClose }: AIAssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { current, hourly, daily, loading } = useWeather(location.lat, location.lon);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset messages when location changes
  useEffect(() => {
    setMessages([]);
  }, [location]);

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");

    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: generateResponse(inputValue),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 800);
  };

  const generateResponse = (question: string) => {
    const lower = question.toLowerCase();

    if (!current) {
      return `Weather data is still loading for ${location.name}. Please try again in a moment.`;
    }

    if (lower.includes("wind")) {
      const next6h = hourly.slice(0, 6);
      const maxGust = Math.max(...next6h.map(h => h.windGusts));
      return `Current winds at ${location.airport}: ${getWindDirectionName(current.windDirection)} at ${current.windSpeed} kt, gusting ${current.windGusts} kt. Over the next 6 hours, gusts could reach ${maxGust} kt. ${current.windGusts > 20 ? "Use caution with crosswind operations." : "Conditions are manageable for most aircraft."}`;
    }
    if (lower.includes("forecast") || lower.includes("weather") || lower.includes("outlook")) {
      const today = daily[0];
      const tomorrow = daily[1];
      return `Today at ${location.name}: ${today?.condition ?? current.condition}, high of ${today?.high ?? current.temperature}°F, low of ${today?.low ?? current.feelsLike}°F. Winds up to ${today?.windSpeed ?? current.windSpeed} kt gusting ${today?.windGusts ?? current.windGusts} kt. Tomorrow: ${tomorrow?.condition ?? "data unavailable"}, highs near ${tomorrow?.high ?? "—"}°F. ${today?.precipitationProbability > 40 ? `Precipitation likely (${today.precipitationProbability}% chance).` : "Low precipitation risk."}`;
    }
    if (lower.includes("ceiling") || lower.includes("cloud")) {
      const ceiling = getCeiling(current.cloudCover);
      return `Cloud cover at ${location.airport} is ${current.cloudCover}%, estimated ceiling ~${ceiling.toLocaleString()} ft AGL. ${current.cloudCover >= 90 ? "Overcast skies — check for IFR conditions." : current.cloudCover >= 50 ? "Scattered to broken layer present." : "Mostly clear skies above."}`;
    }
    if (lower.includes("temperature") || lower.includes("temp")) {
      return `Current temperature at ${location.airport}: ${current.temperature}°F (feels like ${current.feelsLike}°F). Dew point at ${current.dewPoint}°F, humidity ${current.humidity}%. ${Math.abs(current.temperature - current.dewPoint) < 5 ? "Temperature-dewpoint spread is narrow — fog or low clouds possible." : "Good spread between temp and dewpoint."}`;
    }
    if (lower.includes("fly") || lower.includes("vfr") || lower.includes("ifr")) {
      const ceiling = getCeiling(current.cloudCover);
      const cat = getFlightCategory(current.visibility, ceiling);
      return `Current flight conditions at ${location.airport}: ${cat.category}. Visibility ${current.visibility} mi, estimated ceiling ${ceiling.toLocaleString()} ft, winds ${current.windSpeed} kt gusting ${current.windGusts} kt. ${cat.category === "VFR" ? "Good for VFR operations." : cat.category === "MVFR" ? "Marginal VFR — exercise caution." : "IFR conditions — instrument rating required."}`;
    }
    if (lower.includes("pressure") || lower.includes("altimeter")) {
      return `Current altimeter setting at ${location.airport}: ${current.pressure} inHg (${Math.round(current.pressure / 0.02953)} hPa). ${current.pressure > 30.1 ? "High pressure in the area — generally stable conditions." : current.pressure < 29.9 ? "Low pressure present — watch for changing conditions." : "Pressure is near standard."}`;
    }

    return `Current conditions at ${location.name} (${location.airport}): ${current.condition}, ${current.temperature}°F, winds ${getWindDirectionName(current.windDirection)} at ${current.windSpeed} kt. You can ask about winds, clouds, temperature, flight conditions, or the forecast.`;
  };

  if (!isOpen) return null;

  const ceiling = current ? getCeiling(current.cloudCover) : 0;
  const flightCat = current ? getFlightCategory(current.visibility, ceiling) : null;

  return (
    <div className="fixed right-0 top-0 h-screen w-96 bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">AI Weather Assistant</h2>
            <p className="text-xs text-blue-100">{location.name} • {location.airport}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/20 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* AI Synopsis */}
      <div className="bg-gradient-to-br from-blue-50 to-white p-6 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <h3 className="font-semibold text-gray-900">Weather Synopsis</h3>
          {flightCat && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto ${flightCat.bgColor} ${flightCat.color}`}>
              {flightCat.category}
            </span>
          )}
        </div>

        {loading && !current ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            <span className="text-sm text-gray-500">Loading live data...</span>
          </div>
        ) : current ? (
          <>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              Conditions at {location.airport}: {current.condition} with temperatures at {current.temperature}°F
              (feels like {current.feelsLike}°F). Winds {getWindDirectionName(current.windDirection)} at {current.windSpeed} kt,
              gusting {current.windGusts} kt. Visibility {current.visibility >= 10 ? "excellent" : current.visibility >= 5 ? "moderate" : "reduced"}
              {" "}with {current.cloudCover}% cloud cover.
            </p>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <Wind className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs text-gray-500">Surface Wind</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">
                  {getWindDirectionName(current.windDirection)} @ {current.windSpeed} kt
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <Thermometer className="w-3.5 h-3.5 text-red-600" />
                  <span className="text-xs text-gray-500">Temperature</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{current.temperature}°F</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <Cloud className="w-3.5 h-3.5 text-gray-600" />
                  <span className="text-xs text-gray-500">Cloud Cover</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{current.cloudCover}%</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <Wind className="w-3.5 h-3.5 text-green-600" />
                  <span className="text-xs text-gray-500">Pressure</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{current.pressure} inHg</p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500">Unable to load weather data.</p>
        )}
      </div>

      {/* Chat Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="p-4 bg-blue-100 rounded-full mb-4">
              <Sparkles className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Ask me about the weather</h3>
            <p className="text-sm text-gray-500 mb-4">
              I use live Open-Meteo data to answer your questions about conditions, winds, forecasts, and more.
            </p>
            <div className="text-xs text-gray-400 space-y-1">
              <p>Try asking:</p>
              <p>"What are the winds like?"</p>
              <p>"Is it VFR right now?"</p>
              <p>"What's the forecast?"</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-900 border border-gray-200"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-semibold text-blue-600">AI Assistant</span>
                  </div>
                )}
                <p className="text-sm leading-relaxed">{message.content}</p>
                <p className={`text-[10px] mt-2 ${
                  message.role === "user" ? "text-blue-100" : "text-gray-400"
                }`}>
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-200">
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Ask about weather conditions..."
            className="flex-1 rounded-xl bg-gray-50 border-gray-200 focus:ring-2 focus:ring-blue-500/20"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2 text-center">
          Powered by Open-Meteo live weather data
        </p>
      </div>
    </div>
  );
}
