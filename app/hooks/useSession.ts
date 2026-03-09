import { useCallback, useEffect, useState } from "react";
import { cachedFetch } from "../services/weatherProxy";
import type { SessionResponse } from "../../shared/contracts";

export function useSession() {
  const [state, setState] = useState<{
    data: SessionResponse | null;
    loading: boolean;
  }>({
    data: null,
    loading: true,
  });

  const refetch = useCallback(async () => {
    try {
      const data = await cachedFetch<SessionResponse>("/auth/session", undefined, 15000, 5000);
      setState({ data, loading: false });
    } catch {
      setState({
        data: { authenticated: false, user: null },
        loading: false,
      });
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    ...state,
    refetch,
  };
}
