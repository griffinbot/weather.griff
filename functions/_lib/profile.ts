import { DEFAULT_PREFERENCES } from "../../shared/contracts";
import type { SavedLocationRecord, UserPreferences, UserProfile } from "../../shared/contracts";
import type { Env } from "./rateLimiter";

type ProfileRow = {
  preferences_json: string | null;
  migrated_local_data_at: string | null;
  selected_location_id: string | null;
};

type SavedLocationRow = SavedLocationRecord & {
  user_id: string;
  sort_order: number;
};

export async function loadUserProfile(env: Env, userId: string): Promise<UserProfile> {
  if (!env.DB) {
    return {
      preferences: DEFAULT_PREFERENCES,
      savedLocations: [],
      selectedLocationId: null,
      migratedLocalDataAt: null,
    };
  }

  const profile = await env.DB.prepare(
    "SELECT preferences_json, migrated_local_data_at, selected_location_id FROM user_preferences WHERE user_id = ?1",
  )
    .bind(userId)
    .first<ProfileRow>();

  const savedLocationsResult = await env.DB.prepare(
    "SELECT user_id, id, name, lat, lon, airport, sort_order FROM saved_locations WHERE user_id = ?1 ORDER BY sort_order ASC, name ASC",
  )
    .bind(userId)
    .all<SavedLocationRow>();

  let preferences: UserPreferences = DEFAULT_PREFERENCES;
  if (profile?.preferences_json) {
    try {
      preferences = {
        ...DEFAULT_PREFERENCES,
        ...JSON.parse(profile.preferences_json),
        flight_tools: {
          ...DEFAULT_PREFERENCES.flight_tools,
          ...(JSON.parse(profile.preferences_json).flight_tools || {}),
        },
      };
    } catch {
      preferences = DEFAULT_PREFERENCES;
    }
  }

  return {
    preferences,
    savedLocations: savedLocationsResult.results.map(({ id, name, lat, lon, airport }) => ({
      id,
      name,
      lat,
      lon,
      airport,
    })),
    selectedLocationId: profile?.selected_location_id ?? null,
    migratedLocalDataAt: profile?.migrated_local_data_at ?? null,
  };
}

export async function saveUserPreferences(
  env: Env,
  userId: string,
  preferences: UserPreferences,
  selectedLocationId?: string | null,
  migratedLocalDataAt?: string | null,
): Promise<void> {
  if (!env.DB) return;

  await env.DB.prepare(
    "INSERT INTO user_preferences (user_id, preferences_json, selected_location_id, migrated_local_data_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id) DO UPDATE SET preferences_json = excluded.preferences_json, selected_location_id = COALESCE(excluded.selected_location_id, user_preferences.selected_location_id), migrated_local_data_at = COALESCE(excluded.migrated_local_data_at, user_preferences.migrated_local_data_at), updated_at = excluded.updated_at",
  )
    .bind(
      userId,
      JSON.stringify(preferences),
      selectedLocationId ?? null,
      migratedLocalDataAt ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function saveUserLocations(
  env: Env,
  userId: string,
  locations: SavedLocationRecord[],
  selectedLocationId: string | null,
  migratedLocalDataAt: string | null,
): Promise<void> {
  if (!env.DB) return;

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM saved_locations WHERE user_id = ?1").bind(userId),
    ...locations.map((location, index) =>
      env.DB
        .prepare(
          "INSERT INTO saved_locations (user_id, id, name, lat, lon, airport, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(
          userId,
          location.id,
          location.name,
          location.lat,
          location.lon,
          location.airport,
          index,
          now,
          now,
        ),
    ),
    env.DB
      .prepare(
        "INSERT INTO user_preferences (user_id, preferences_json, selected_location_id, migrated_local_data_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id) DO UPDATE SET selected_location_id = excluded.selected_location_id, migrated_local_data_at = excluded.migrated_local_data_at, updated_at = excluded.updated_at",
      )
      .bind(userId, JSON.stringify(DEFAULT_PREFERENCES), selectedLocationId, migratedLocalDataAt, now),
  ]);
}
