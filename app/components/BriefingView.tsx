import { AlertCircle, Cloud, Droplets, Eye, Gauge, Loader2, Thermometer, Wind, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
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
  return distance === 0 ? "On field" : `${distance} mi`;
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
  const [discussionExpanded, setDiscussionExpanded] = useState(false);

  if (loading && !briefing) {
    return (
      <div className="rounded-xl border border-white/8 bg-surface-elevated p-10 text-center">
        <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-amber-400" />
        <span className="text-sm text-slate-400">Loading live briefing...</span>
      </div>
    );
  }

  if (!briefing || !briefing.current) {
    return (
      <div className="rounded-xl border border-red-500/15 bg-surface-elevated p-10 text-center">
        <AlertCircle className="mx-auto mb-3 h-5 w-5 text-red-400" />
        <span className="text-sm text-slate-400">{error || "Briefing data is unavailable for this location."}</span>
      </div>
    );
  }

  const { current } = briefing;
  const primaryBundle = briefing.stationBundles[0];

  const metrics = [
    { icon: Wind, label: "Wind", value: `${current.windSpeed} kt`, sub: `${current.windDirection}°`, color: "text-amber-400" },
    { icon: Wind, label: "Gust", value: `${current.windGusts} kt`, sub: "Peak", color: "text-orange-400" },
    { icon: Eye, label: "Visibility", value: `${current.visibility} mi`, sub: `${current.cloudCover}% cover`, color: "text-sky-400" },
    { icon: Gauge, label: "Pressure", value: `${current.pressure} inHg`, sub: "Altimeter", color: "text-violet-400" },
    { icon: Droplets, label: "Humidity", value: `${current.humidity}%`, sub: `DP ${current.dewPoint}°`, color: "text-cyan-400" },
    { icon: Thermometer, label: "Temp", value: `${current.temperature}°F`, sub: current.condition, color: "text-emerald-400" },
  ];

  const discussionContent = briefing.discussion?.content || "";
  const discussionExcerpt = discussionContent.slice(0, 500);
  const hasMoreDiscussion = discussionContent.length > 500;

  return (
    <div className="space-y-3">
      {/* ── Top Summary ──────────────────────────────── */}
      <section className="rounded-xl border border-white/8 bg-surface-elevated p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold tracking-tight text-white">{briefing.location.name}</h2>
              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-300">
                {briefing.location.airport}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Updated {formatTime(briefing.lastUpdated)} · Station reports and area forecast composed into one view
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-white/5 px-4 py-3">
            <Cloud className="h-7 w-7 text-amber-300" />
            <div>
              <div className="text-3xl font-light leading-none text-white">{current.temperature}°</div>
              <div className="mt-0.5 text-xs text-slate-400">{current.condition}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Compact Metric Cards ─────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-white/6 bg-white/[0.03] p-3 transition hover:bg-white/[0.05]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{m.label}</span>
            </div>
            <div className="text-base font-semibold text-white leading-tight">{m.value}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Two Column: Reports + Discussion ─────────── */}
      <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        {/* Airport Reports */}
        <div className="rounded-xl border border-white/8 bg-surface-elevated p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Airport Reports</h3>
              <p className="text-[11px] text-slate-500">METAR and TAF bundles for this briefing area</p>
            </div>
            {error && <span className="text-[10px] font-medium text-amber-400">{error}</span>}
          </div>

          <div className="space-y-2.5">
            {briefing.stationBundles.map((bundle) => (
              <article key={bundle.station.stationId} className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold tracking-wide text-white">{bundle.station.stationId}</span>
                    <span className="text-xs text-slate-500">{bundle.station.name}</span>
                  </div>
                  <span className="rounded bg-white/8 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                    {formatDistance(bundle.station.distance_mi)}
                  </span>
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                  <div className="rounded-md bg-white/[0.03] p-3">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">METAR</div>
                    <p className="font-mono text-xs leading-relaxed text-slate-300">
                      {bundle.metar?.raw || bundle.metar?.description || "No METAR available."}
                    </p>
                  </div>
                  <div className="rounded-md bg-white/[0.03] p-3">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">TAF</div>
                    <p className="font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
                      {bundle.taf?.raw || "No TAF available for this station."}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* Area Forecast Discussion */}
        <div className="rounded-xl border border-white/8 bg-surface-elevated p-4 sm:p-5">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white">Area Forecast Discussion</h3>
            <p className="text-[11px] text-slate-500">
              Latest office narrative for {briefing.location.name}
            </p>
          </div>

          {briefing.discussion ? (
            <>
              <div className="mb-3 flex items-center justify-between rounded-md bg-white/[0.03] p-2.5">
                <span className="text-xs font-medium text-slate-300">{briefing.discussion.office}</span>
                <span className="text-[10px] text-slate-500">Issued {formatTime(briefing.discussion.issueTime)}</span>
              </div>
              <div className="rounded-md border border-white/6 bg-white/[0.02] p-3">
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-400">
                  {discussionExpanded || !hasMoreDiscussion ? discussionContent : discussionExcerpt + "..."}
                </pre>
                {hasMoreDiscussion && (
                  <button
                    type="button"
                    onClick={() => setDiscussionExpanded(!discussionExpanded)}
                    className="mt-2 flex items-center gap-1 text-[11px] font-medium text-amber-400 hover:text-amber-300 transition"
                  >
                    {discussionExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {discussionExpanded ? "Show less" : "Show full discussion"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-md bg-white/[0.03] p-3 text-xs text-slate-500">
              No discussion was available for the current forecast office.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
