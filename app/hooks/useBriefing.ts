import { useCallback, useEffect, useState } from "react";
import { cachedFetch } from "../services/weatherProxy";
import type { BriefingResponse, SavedLocationRecord } from "../../shared/contracts";

interface BriefingState {
  data: BriefingResponse | null;
  loading: boolean;
  error: string | null;
}

export function useBriefing(location: SavedLocationRecord | null) {
  const [state, setState] = useState<BriefingState>({
    data: null,
    loading: !!location,
    error: null,
  });

  const fetchBriefing = useCallback(async () => {
    if (!location) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lon: location.lon.toString(),
        airport: location.airport,
        name: location.name,
      });
      const data = await cachedFetch<BriefingResponse>(`/api/briefing?${params.toString()}`, undefined, 120000, 12000);
      setState({ data, loading: false, error: null });
    } catch (error: any) {
      setState({
        data: null,
        loading: false,
        error: error?.message || "Failed to fetch briefing",
      });
    }
  }, [location]);

  useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  return {
    ...state,
    refetch: fetchBriefing,
  };
}
