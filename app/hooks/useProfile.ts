import { useCallback, useEffect, useState } from "react";
import { cachedFetch } from "../services/weatherProxy";
import { DEFAULT_PREFERENCES, DEFAULT_SAVED_LOCATIONS } from "../../shared/contracts";
import type { SavedLocationRecord, UserPreferences, UserProfile } from "../../shared/contracts";

const LOCAL_LOCATIONS_KEY = "weather.griff.savedLocations.v1";
const LOCAL_SELECTED_KEY = "weather.griff.selectedLocationId.v1";
const LOCAL_PREFERENCES_KEY = "weather.griff.preferences.v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLocations(value: unknown): SavedLocationRecord[] {
  if (!Array.isArray(value)) return DEFAULT_SAVED_LOCATIONS;
  const next = value.filter((entry): entry is SavedLocationRecord => {
    return (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      typeof entry.lat === "number" &&
      typeof entry.lon === "number" &&
      typeof entry.airport === "string"
    );
  });
  return next.length > 0 ? next : DEFAULT_SAVED_LOCATIONS;
}

function readLocalProfile(): UserProfile {
  if (typeof window === "undefined") {
    return {
      preferences: DEFAULT_PREFERENCES,
      savedLocations: DEFAULT_SAVED_LOCATIONS,
      selectedLocationId: DEFAULT_SAVED_LOCATIONS[0]?.id ?? null,
      migratedLocalDataAt: null,
    };
  }

  let savedLocations = DEFAULT_SAVED_LOCATIONS;
  let selectedLocationId = DEFAULT_SAVED_LOCATIONS[0]?.id ?? null;
  let preferences = DEFAULT_PREFERENCES;

  try {
    const locationsRaw = window.localStorage.getItem(LOCAL_LOCATIONS_KEY);
    if (locationsRaw) {
      savedLocations = parseLocations(JSON.parse(locationsRaw));
    }
  } catch {
    savedLocations = DEFAULT_SAVED_LOCATIONS;
  }

  try {
    selectedLocationId = window.localStorage.getItem(LOCAL_SELECTED_KEY) || savedLocations[0]?.id || null;
  } catch {
    selectedLocationId = savedLocations[0]?.id || null;
  }

  try {
    const preferencesRaw = window.localStorage.getItem(LOCAL_PREFERENCES_KEY);
    if (preferencesRaw) {
      const parsed = JSON.parse(preferencesRaw);
      preferences = {
        ...DEFAULT_PREFERENCES,
        ...parsed,
        flight_tools: {
          ...DEFAULT_PREFERENCES.flight_tools,
          ...(parsed.flight_tools || {}),
        },
      };
    }
  } catch {
    preferences = DEFAULT_PREFERENCES;
  }

  return {
    preferences,
    savedLocations,
    selectedLocationId,
    migratedLocalDataAt: null,
  };
}

function writeLocalProfile(profile: UserProfile) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_LOCATIONS_KEY, JSON.stringify(profile.savedLocations));
  window.localStorage.setItem(LOCAL_SELECTED_KEY, profile.selectedLocationId || "");
  window.localStorage.setItem(LOCAL_PREFERENCES_KEY, JSON.stringify(profile.preferences));
}

export function useProfile(isAuthenticated: boolean) {
  const [localProfile, setLocalProfile] = useState<UserProfile>(() => readLocalProfile());
  const [remoteProfile, setRemoteProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isAuthenticated);

  const effectiveProfile = isAuthenticated ? remoteProfile : localProfile;

  const refetch = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await cachedFetch<{ authenticated: boolean; profile: UserProfile | null }>("/api/profile", undefined, 5000, 8000);
      setRemoteProfile(response.profile);
    } catch {
      setRemoteProfile(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (!isAuthenticated) writeLocalProfile(localProfile);
  }, [isAuthenticated, localProfile]);

  const savePreferences = useCallback(
    async (preferences: UserPreferences) => {
      if (!effectiveProfile) return;
      const next = { ...effectiveProfile, preferences };
      if (isAuthenticated) {
        await fetch("/api/profile/preferences", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            preferences,
            selectedLocationId: next.selectedLocationId,
            migratedLocalDataAt: next.migratedLocalDataAt,
          }),
        });
        await refetch();
      } else {
        setLocalProfile(next);
      }
    },
    [effectiveProfile, isAuthenticated, refetch],
  );

  const saveLocations = useCallback(
    async (savedLocations: SavedLocationRecord[], selectedLocationId: string | null, migratedLocalDataAt?: string | null) => {
      if (!effectiveProfile) return;
      const next: UserProfile = {
        ...effectiveProfile,
        savedLocations,
        selectedLocationId,
        migratedLocalDataAt: migratedLocalDataAt ?? effectiveProfile.migratedLocalDataAt,
      };

      if (isAuthenticated) {
        await fetch("/api/profile/locations", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locations: savedLocations,
            selectedLocationId,
            migratedLocalDataAt: migratedLocalDataAt ?? effectiveProfile.migratedLocalDataAt,
          }),
        });
        await refetch();
      } else {
        setLocalProfile(next);
      }
    },
    [effectiveProfile, isAuthenticated, refetch],
  );

  const migrateLocalData = useCallback(async () => {
    if (!isAuthenticated || !remoteProfile) return;
    const local = readLocalProfile();
    if (remoteProfile.migratedLocalDataAt || local.savedLocations.length === 0) return;
    await fetch("/api/profile/locations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locations: local.savedLocations,
        selectedLocationId: local.selectedLocationId,
        migratedLocalDataAt: new Date().toISOString(),
      }),
    });
    await fetch("/api/profile/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preferences: local.preferences,
        selectedLocationId: local.selectedLocationId,
        migratedLocalDataAt: new Date().toISOString(),
      }),
    });
    await refetch();
  }, [isAuthenticated, refetch, remoteProfile]);

  useEffect(() => {
    migrateLocalData();
  }, [migrateLocalData]);

  return {
    profile: effectiveProfile ?? localProfile,
    loading,
    savePreferences,
    saveLocations,
    refetch,
  };
}
