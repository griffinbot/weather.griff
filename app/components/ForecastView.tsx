import { CalendarDays, Wind, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cn } from "./ui/utils";
import type { BriefingResponse } from "../../shared/contracts";

function dayLabel(value: string, index: number) {
  const date = new Date(value);
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ForecastView({ briefing }: { briefing: BriefingResponse | null }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  if (!briefing) return null;
  const rainyDays = briefing.daily.filter((day) => day.precipitationProbability > 50).length;
  const gustMax = Math.max(...briefing.daily.map((day) => day.windGusts), 0);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-xl border border-white/8 bg-surface-elevated p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">Week Ahead</h2>
            <p className="mt-1 text-xs text-slate-500">
              {briefing.location.name} trends {rainyDays >= 4 ? "unsettled" : "relatively stable"} · Gusts to {gustMax} kt · Precip risk on {rainyDays} day{rainyDays === 1 ? "" : "s"}
            </p>
          </div>
          <CalendarDays className="h-5 w-5 text-amber-400" />
        </div>
      </div>

      {/* Compact Daily Cards */}
      <div className="space-y-1.5">
        {briefing.daily.map((day, index) => {
          const isExpanded = expandedDay === index;
          const isToday = index === 0;
          const precipHigh = day.precipitationProbability > 50;

          return (
            <article
              key={day.date}
              className={cn(
                "rounded-lg border bg-surface-elevated overflow-hidden transition-all",
                isToday ? "border-amber-500/15" : "border-white/6",
              )}
            >
              {/* Compact Row */}
              <button
                type="button"
                onClick={() => setExpandedDay(isExpanded ? null : index)}
                className="w-full px-3 sm:px-4 py-2.5 flex items-center gap-3 text-left hover:bg-white/[0.02] transition"
              >
                {/* Day */}
                <div className="w-16 sm:w-20 shrink-0">
                  <div className={cn("text-sm font-semibold", isToday ? "text-amber-300" : "text-white")}>
                    {dayLabel(day.date, index)}
                  </div>
                  <div className="text-[10px] text-slate-600">{dateLabel(day.date)}</div>
                </div>

                {/* Condition */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-300 truncate">{day.condition}</div>
                </div>

                {/* Temps */}
                <div className="flex items-baseline gap-1 w-16 justify-end shrink-0">
                  <span className="text-sm font-semibold text-white">{day.high}°</span>
                  <span className="text-xs text-slate-600">{day.low}°</span>
                </div>

                {/* Wind */}
                <div className="hidden sm:flex items-center gap-1 w-20 shrink-0 justify-end">
                  <Wind className="h-3 w-3 text-slate-500" />
                  <span className="text-xs text-slate-400">{day.windSpeed} kt</span>
                  {day.windGusts > day.windSpeed && (
                    <span className="text-[10px] text-orange-400">G{day.windGusts}</span>
                  )}
                </div>

                {/* Precip */}
                <div className="w-10 text-right shrink-0">
                  <span className={cn(
                    "text-xs font-medium",
                    precipHigh ? "text-sky-400" : "text-slate-600",
                  )}>
                    {day.precipitationProbability}%
                  </span>
                </div>

                {/* Expand toggle */}
                <div className="shrink-0 text-slate-600">
                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </div>
              </button>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="px-3 sm:px-4 pb-3 border-t border-white/6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5">
                    <div className="rounded-md bg-white/[0.03] p-2.5">
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Temperature</div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-xl font-light text-white">{day.high}°</span>
                        <span className="text-sm text-slate-500">{day.low}°</span>
                      </div>
                    </div>

                    <div className="rounded-md bg-white/[0.03] p-2.5">
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Wind</div>
                      <div className="mt-1 text-sm font-semibold text-white">{day.windSpeed} kt</div>
                      <div className="text-[10px] text-slate-500">{day.windDirection}° · Gusts {day.windGusts} kt</div>
                    </div>

                    <div className="rounded-md bg-white/[0.03] p-2.5">
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Precipitation</div>
                      <div className="mt-1 text-sm font-semibold text-white">{day.precipitationProbability}%</div>
                      <div className="text-[10px] text-slate-500">Total {day.precipitationSum}"</div>
                    </div>

                    <div className="rounded-md bg-white/[0.03] p-2.5">
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Sun</div>
                      <div className="mt-1 text-xs text-slate-300">
                        Rise {new Date(day.sunrise).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </div>
                      <div className="text-xs text-slate-300">
                        Set {new Date(day.sunset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
