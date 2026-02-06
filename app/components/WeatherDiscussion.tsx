import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ExternalLink, FileText, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { weatherGovFetch } from "../services/weatherProxy";

interface Location {
  name: string;
  airport: string;
  lat: number;
  lon: number;
}

interface WeatherDiscussionProps {
  location: Location;
}

interface DiscussionData {
  title: string;
  office: string;
  officeCode: string;
  issueTime: string;
  content: string;
  sourceUrl: string;
}

function normalizeOfficeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cleaned)) return null;
  return cleaned;
}

function officeCodeFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const part = value.split("/").filter(Boolean).pop();
  return normalizeOfficeCode(part ?? null);
}

function resolveLatestProductRef(product: any): string | null {
  const atId = product?.["@id"];
  if (typeof atId === "string" && atId.length > 0) return atId;
  const id = product?.id;
  if (typeof id === "string" && id.length > 0) return `/api/weather-gov/products/${id}`;
  if (typeof id === "number") return `/api/weather-gov/products/${String(id)}`;
  return null;
}

function parseDiscussionSection(text: string): string {
  const normalized = text.replace(/\r/g, "").trim();
  const afdIndex = normalized.search(/AREA FORECAST DISCUSSION|\.SYNOPSIS|\.(SHORT TERM|DISCUSSION)/i);
  if (afdIndex > 0) return normalized.slice(afdIndex).trim();
  return normalized;
}

export function WeatherDiscussion({ location }: WeatherDiscussionProps) {
  const [data, setData] = useState<DiscussionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const relatedLinks = useMemo(() => {
    return [
      { title: "Graphical Forecasts", url: "https://www.weather.gov/" },
      { title: "Radar", url: "https://radar.weather.gov/" },
      { title: "Aviation Weather Center", url: "https://aviationweather.gov/" },
    ];
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchDiscussion = async () => {
      setLoading(true);
      setError(null);

      try {
        const points = await weatherGovFetch<any>(
          `/api/weather-gov/points/${location.lat.toFixed(4)},${location.lon.toFixed(4)}`,
          5 * 60_000,
        );

        const officeCode =
          normalizeOfficeCode(points?.properties?.gridId) ||
          officeCodeFromUrl(points?.properties?.forecastOffice);
        if (!officeCode) {
          throw new Error("Could not resolve NWS forecast office for this location.");
        }

        const primaryListUrl = `/api/weather-gov/products/types/AFD/locations/${officeCode}`;
        const primaryListJson = await weatherGovFetch<any>(primaryListUrl, 45_000);
        const products: any[] = Array.isArray(primaryListJson?.["@graph"]) ? primaryListJson["@graph"] : [];

        if (products.length === 0) {
          throw new Error("No Area Forecast Discussion products were found for this office.");
        }

        const sortedProducts = [...products].sort((a, b) => {
          const aTs = Date.parse(a?.issuanceTime ?? "");
          const bTs = Date.parse(b?.issuanceTime ?? "");
          const aValue = Number.isFinite(aTs) ? aTs : 0;
          const bValue = Number.isFinite(bTs) ? bTs : 0;
          return bValue - aValue;
        });

        const latestProduct = sortedProducts[0];
        const latestRef = resolveLatestProductRef(latestProduct);
        if (!latestRef) {
          throw new Error("Could not resolve latest Area Forecast Discussion product reference.");
        }

        const product = await weatherGovFetch<any>(latestRef, 60_000);
        const rawText = typeof product?.productText === "string" ? product.productText : "";
        if (!rawText) {
          throw new Error("Latest Area Forecast Discussion product text was empty.");
        }

        const issued = product?.issuanceTime || latestProduct?.issuanceTime || "";
        const sourceUrl = `https://forecast.weather.gov/product.php?site=nws&issuedby=${officeCode}&product=afd&format=ci&version=1&glossary=1&highlight=off`;

        if (!cancelled) {
          setData({
            title: "Area Forecast Discussion",
            office: `National Weather Service ${officeCode}`,
            officeCode,
            issueTime: issued,
            content: parseDiscussionSection(rawText),
            sourceUrl,
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Unable to load weather discussion.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDiscussion();
    return () => {
      cancelled = true;
    };
  }, [location.lat, location.lon]);

  const formatTime = (iso: string) => {
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return "Unavailable";
    return new Date(parsed).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  if (loading && !data) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl p-10 shadow-sm border border-gray-100 flex items-center justify-center gap-3 text-gray-600">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <span>Loading latest area forecast discussion…</span>
        </div>
      </div>
    );
  }

  if ((error && !data) || !data) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-red-100 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Failed to load weather discussion</span>
          </div>
          <p className="text-sm text-gray-600">{error ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {loading && data && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-sm text-blue-700 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Refreshing discussion…
        </div>
      )}
      {error && data && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2 text-sm text-amber-700">
          Showing previous discussion while refresh retries.
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold mb-2">{data.title}</h2>
            <p className="text-gray-600">{data.office}</p>
          </div>
          <FileText className="w-8 h-8 text-blue-500" />
        </div>

        <div className="flex items-center gap-6 text-sm text-gray-600">
          <div>
            <span className="text-gray-500">Issued:</span> {formatTime(data.issueTime)}
          </div>
          <div>
            <span className="text-gray-500">Office:</span> {data.officeCode}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-700">
          {data.content}
        </pre>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-semibold mb-4">Related Resources</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button variant="outline" className="justify-between" asChild>
            <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">
              View Full NWS Discussion
              <ExternalLink className="w-4 h-4" />
            </a>
          </Button>
          {relatedLinks.map((link) => (
            <Button key={link.title} variant="outline" className="justify-between" asChild>
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
