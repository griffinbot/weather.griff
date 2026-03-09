import { LogIn, LogOut, Save, Settings2, UserCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { SessionResponse, UserPreferences } from "../../shared/contracts";

export function ProfileDialog({
  open,
  onOpenChange,
  session,
  preferences,
  onPreferencesChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SessionResponse | null;
  preferences: UserPreferences;
  onPreferencesChange: (next: UserPreferences) => Promise<void>;
}) {
  const update = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    void onPreferencesChange({ ...preferences, [key]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[28px] border-slate-200 p-0">
        <DialogHeader className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-orange-100 p-2 text-orange-700">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Profile and Settings</DialogTitle>
              <DialogDescription>Account-backed preferences for your briefing workflow.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-[24px] bg-slate-950 p-5 text-white">
            <div className="flex items-center gap-3">
              <UserCircle2 className="h-10 w-10 text-orange-300" />
              <div>
                <div className="font-semibold">{session?.user?.name || "Guest session"}</div>
                <div className="text-sm text-slate-300">{session?.user?.email || "Sign in to sync saved airports and settings."}</div>
              </div>
            </div>

            <div className="mt-5">
              {session?.authenticated ? (
                <Button
                  variant="secondary"
                  className="w-full justify-center rounded-xl"
                  onClick={() => void fetch("/auth/logout", { method: "POST" }).then(() => window.location.reload())}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </Button>
              ) : (
                <Button className="w-full justify-center rounded-xl bg-orange-500 hover:bg-orange-600" asChild>
                  <a href="/auth/google/start">
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign in with Google
                  </a>
                </Button>
              )}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[20px] bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Temperature</div>
              <Select value={preferences.temperatureUnit} onValueChange={(value) => update("temperatureUnit", value as UserPreferences["temperatureUnit"])}>
                <SelectTrigger className="rounded-xl bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fahrenheit">Fahrenheit</SelectItem>
                  <SelectItem value="celsius">Celsius</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-[20px] bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Wind Speed</div>
              <Select value={preferences.windSpeedUnit} onValueChange={(value) => update("windSpeedUnit", value as UserPreferences["windSpeedUnit"])}>
                <SelectTrigger className="rounded-xl bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="knots">Knots</SelectItem>
                  <SelectItem value="mph">MPH</SelectItem>
                  <SelectItem value="kmh">KM/H</SelectItem>
                  <SelectItem value="ms">M/S</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-[20px] bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Distance</div>
              <Select value={preferences.distanceUnit} onValueChange={(value) => update("distanceUnit", value as UserPreferences["distanceUnit"])}>
                <SelectTrigger className="rounded-xl bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="miles">Miles</SelectItem>
                  <SelectItem value="kilometers">Kilometers</SelectItem>
                  <SelectItem value="nautical">Nautical miles</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-[20px] bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Default Winds View</div>
              <Select value={preferences.defaultWindsView} onValueChange={(value) => update("defaultWindsView", value as UserPreferences["defaultWindsView"])}>
                <SelectTrigger className="rounded-xl bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">Table</SelectItem>
                  <SelectItem value="visualization">Visualization</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-slate-200 px-6 py-4">
          <Button className="rounded-xl bg-slate-950 hover:bg-slate-800" onClick={() => onOpenChange(false)}>
            <Save className="mr-2 h-4 w-4" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
