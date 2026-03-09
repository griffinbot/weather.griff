import { CalendarDays, Wind } from "lucide-react";
import type { BriefingResponse } from "../../shared/contracts";

function dayLabel(value: string, index: number) {
  const date = new Date(value);
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

export function ForecastView({ briefing }: { briefing: BriefingResponse | null }) {
  if (!briefing) return null;
  const rainyDays = briefing.daily.filter((day) => day.precipitationProbability > 50).length;
  const gustMax = Math.max(...briefing.daily.map((day) => day.windGusts), 0);

  return (
    <div className="space-y-5">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Week Ahead</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {briefing.location.name} trends {rainyDays >= 4 ? "unsettled" : "relatively stable"} through the next seven days, with gusts up to {gustMax} kt and precipitation risk on {rainyDays} day{rainyDays === 1 ? "" : "s"}.
            </p>
          </div>
          <CalendarDays className="h-8 w-8 text-orange-500" />
        </div>
      </section>

      <div className="grid gap-4">
        {briefing.daily.map((day, index) => (
          <article key={day.date} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
              <div>
                <div className="text-2xl font-semibold text-slate-950">{dayLabel(day.date, index)}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {new Date(day.date).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </div>
                <div className="mt-4 text-lg font-medium text-slate-800">{day.condition}</div>
                <div className="mt-2 text-sm text-slate-500">Precipitation chance {day.precipitationProbability}% • Total {day.precipitationSum}"</div>
              </div>

              <div className="rounded-[20px] bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Temperature</div>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-4xl font-light text-slate-950">{day.high}°</span>
                  <span className="pb-1 text-lg text-slate-500">{day.low}°</span>
                </div>
                <div className="mt-3 text-sm text-slate-500">
                  Sunrise {new Date(day.sunrise).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} • Sunset {new Date(day.sunset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </div>
              </div>

              <div className="rounded-[20px] bg-slate-950 p-4 text-white">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                  <Wind className="h-3.5 w-3.5" />
                  Wind
                </div>
                <div className="mt-3 text-2xl font-semibold">{day.windSpeed} kt</div>
                <div className="mt-1 text-sm text-slate-300">Dominant {day.windDirection}° • Gusts {day.windGusts} kt</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
