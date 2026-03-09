import { AlertCircle, Cloud, Eye, Gauge, Loader2, Wind } from "lucide-react";
import type { BriefingResponse } from "../../shared/contracts";

function formatTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDistance(distance: number) {
  return distance === 0 ? "On field" : `${distance} mi away`;
}

export function BriefingView({
  briefing,
  loading,
  error,
}: {
  briefing: BriefingResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !briefing) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
        <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-orange-500" />
        Loading live briefing...
      </div>
    );
  }

  if (!briefing || !briefing.current) {
    return (
      <div className="rounded-[28px] border border-red-100 bg-white p-10 text-center text-slate-600 shadow-sm">
        <AlertCircle className="mx-auto mb-3 h-6 w-6 text-red-500" />
        {error || "Briefing data is unavailable for this location."}
      </div>
    );
  }

  const { current } = briefing;
  const primaryBundle = briefing.stationBundles[0];

  return (
    <div className="space-y-5">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{briefing.location.name}</h1>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800">
                {briefing.location.airport}
              </span>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Briefing updated {formatTime(briefing.lastUpdated)}. Nearby station reports and the latest area forecast discussion are composed into one view.
            </p>
          </div>

          <div className="flex items-end gap-4 rounded-[24px] bg-slate-950 px-5 py-4 text-white">
            <Cloud className="h-9 w-9 text-orange-300" />
            <div>
              <div className="text-4xl font-light leading-none">{current.temperature}°</div>
              <div className="mt-1 text-sm text-slate-300">{current.condition}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Wind className="h-3.5 w-3.5" />
              Wind
            </div>
            <div className="text-lg font-semibold text-slate-900">{current.windSpeed} kt</div>
            <div className="text-sm text-slate-500">Dir {current.windDirection}° • Gust {current.windGusts} kt</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Eye className="h-3.5 w-3.5" />
              Visibility
            </div>
            <div className="text-lg font-semibold text-slate-900">{current.visibility} mi</div>
            <div className="text-sm text-slate-500">Cloud cover {current.cloudCover}%</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Gauge className="h-3.5 w-3.5" />
              Pressure
            </div>
            <div className="text-lg font-semibold text-slate-900">{current.pressure} inHg</div>
            <div className="text-sm text-slate-500">Humidity {current.humidity}% • Dew point {current.dewPoint}°</div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Source</div>
            <div className="text-lg font-semibold text-slate-900">{primaryBundle?.station.stationId || briefing.location.airport}</div>
            <div className="text-sm text-slate-500">{primaryBundle ? formatDistance(primaryBundle.station.distance_mi) : "Primary station unresolved"}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Airport Reports</h2>
              <p className="text-sm text-slate-500">Nearest METAR and TAF bundles for this briefing area.</p>
            </div>
            {error && <span className="text-xs font-medium text-amber-700">{error}</span>}
          </div>

          <div className="space-y-4">
            {briefing.stationBundles.map((bundle) => (
              <article key={bundle.station.stationId} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{bundle.station.stationId}</div>
                    <div className="text-sm text-slate-500">{bundle.station.name}</div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                    {formatDistance(bundle.station.distance_mi)}
                  </span>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-[18px] bg-white p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">METAR</div>
                    <p className="text-sm leading-6 text-slate-700">
                      {bundle.metar?.raw || bundle.metar?.description || "No METAR available."}
                    </p>
                  </div>
                  <div className="rounded-[18px] bg-white p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">TAF</div>
                    <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">
                      {bundle.taf?.raw || "No TAF available for this station."}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-950">Area Forecast Discussion</h2>
            <p className="text-sm text-slate-500">
              Latest office narrative for {briefing.location.name}.
            </p>
          </div>

          {briefing.discussion ? (
            <>
              <div className="mb-4 rounded-[20px] bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-900">{briefing.discussion.office}</div>
                <div className="mt-1 text-xs text-slate-500">Issued {formatTime(briefing.discussion.issueTime)}</div>
              </div>
              <div className="max-h-[34rem] overflow-y-auto rounded-[20px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <pre className="whitespace-pre-wrap font-mono">{briefing.discussion.content}</pre>
              </div>
            </>
          ) : (
            <div className="rounded-[20px] bg-slate-50 p-4 text-sm text-slate-600">
              No discussion was available for the current forecast office.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
