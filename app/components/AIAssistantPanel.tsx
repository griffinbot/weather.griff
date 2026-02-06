import { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, Cloud, Wind, Thermometer, Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useWeather, getWindDirectionName, getCeiling, getFlightCategory } from "../hooks/useWeather";
import type { ChatRequest, ChatResponse } from "../types/ai";

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
  response?: ChatResponse;
  isError?: boolean;
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function AIAssistantPanel({ location, isOpen, onClose }: AIAssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const { current, loading } = useWeather(location.lat, location.lon);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset messages when location changes
  useEffect(() => {
    setMessages([]);
    setRequestError(null);
    sessionIdRef.current = createSessionId();
  }, [location]);

  const handleSendMessage = async () => {
    const question = inputValue.trim();
    if (!question || isResponding) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputValue("");
    setIsResponding(true);
    setRequestError(null);

    const history = nextMessages.map((message) => ({
      role: message.role,
      content: message.content,
      ts: message.timestamp.toISOString(),
    })) as ChatRequest["messages"];

    const payload: ChatRequest = {
      sessionId: sessionIdRef.current,
      location: {
        name: location.name,
        airport: location.airport,
        lat: location.lat,
        lon: location.lon,
      },
      messages: history,
      userQuestion: question,
      options: {
        agentHint: "auto",
        maxTokens: 700,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      let responseJson: any = null;
      try {
        responseJson = await response.json();
      } catch {
        responseJson = null;
      }

      if (!response.ok) {
        const errorMessage = responseJson?.error || `Request failed with status ${response.status}`;
        throw new Error(errorMessage);
      }

      const chatResponse = responseJson as ChatResponse;
      const aiMessage: Message = {
        id: `assistant_${Date.now()}`,
        role: "assistant",
        content: chatResponse.answer || "No response generated.",
        timestamp: new Date(),
        response: chatResponse,
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error: any) {
      const friendly =
        error?.name === "AbortError"
          ? "AI request timed out. Please try again."
          : error?.message || "AI assistant is currently unavailable.";
      setRequestError(friendly);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant_error_${Date.now()}`,
          role: "assistant",
          content: friendly,
          timestamp: new Date(),
          isError: true,
        },
      ]);
    } finally {
      clearTimeout(timeout);
      setIsResponding(false);
    }
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
              I use live weather data plus ballooning references to build operational briefings.
            </p>
            <div className="text-xs text-gray-400 space-y-1">
              <p>Try asking:</p>
              <p>"Summarize launch risk for the next 3 hours."</p>
              <p>"What does drift look like after sunrise?"</p>
              <p>"What checks should I run before launch?"</p>
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
                    : message.isError
                      ? "bg-red-50 text-red-900 border border-red-200"
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

                {message.role === "assistant" && message.response && (
                  <div className="mt-3 space-y-2">
                    {message.response.sections.map((section) => (
                      <div key={section.title} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{section.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-700">{section.content}</p>
                      </div>
                    ))}

                    {message.response.sources.length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Sources</p>
                        <div className="mt-1 space-y-1">
                          {message.response.sources.slice(0, 4).map((source, idx) => (
                            <div key={`${source.title}_${idx}`} className="text-xs text-gray-600">
                              {source.url ? (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {source.title}
                                </a>
                              ) : (
                                <span>{source.title}</span>
                              )}
                              {source.excerpt ? (
                                <p className="text-[11px] text-gray-500 mt-0.5">{source.excerpt}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {message.response.agentTrace.map((agent) => (
                        <span
                          key={agent}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                        >
                          {agent}
                        </span>
                      ))}
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        risk: {message.response.riskLevel}
                      </span>
                    </div>

                    {message.response.followUps.length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Follow-ups</p>
                        <div className="mt-1 space-y-1">
                          {message.response.followUps.slice(0, 2).map((item, idx) => (
                            <p key={`${item}_${idx}`} className="text-xs text-gray-700">
                              {item}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <p className={`text-[10px] mt-2 ${
                  message.role === "user" ? "text-blue-100" : "text-gray-400"
                }`}>
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
        {isResponding && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-white text-gray-900 border border-gray-200">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <p className="text-sm text-gray-600">Generating operational briefing...</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-200">
        {requestError && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{requestError}</span>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSendMessage();
              }
            }}
            placeholder="Ask about ballooning weather, risk, or drift..."
            className="flex-1 rounded-xl bg-gray-50 border-gray-200 focus:ring-2 focus:ring-blue-500/20"
            disabled={isResponding}
          />
          <Button
            onClick={() => {
              void handleSendMessage();
            }}
            disabled={!inputValue.trim() || isResponding}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4"
          >
            {isResponding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2 text-center">
          Advisory assistant only. Always verify with official weather sources before flight.
        </p>
      </div>
    </div>
  );
}
