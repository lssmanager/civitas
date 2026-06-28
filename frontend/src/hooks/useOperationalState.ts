import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsolidatedOperationalResponse } from "../contracts/operational";

type Loader = (organizationId: string) => Promise<ConsolidatedOperationalResponse>;

export function getOperationalPollingIntervalMs(data?: ConsolidatedOperationalResponse | null) {
  if (!data?.polling?.shouldPoll) return null;
  const seconds = Number(data.polling.intervalSeconds || 0);
  return Math.max(seconds > 0 ? seconds : 5, 1) * 1000;
}

export function useOperationalState(organizationId: string, load: Loader) {
  const loadRef = useRef(load);
  const [data, setData] = useState<ConsolidatedOperationalResponse>();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hasDataRef = useRef(false);

  useEffect(() => { loadRef.current = load; }, [load]);

  const retry = useCallback(() => setRefreshNonce((current) => current + 1), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run(showLoading: boolean) {
      if (!organizationId) return;
      if (showLoading) setIsLoading(true);
      setError(null);
      try {
        const response = await loadRef.current(organizationId);
        if (!alive) return;
        hasDataRef.current = true;
        setData(response);
        const interval = getOperationalPollingIntervalMs(response);
        if (interval) timer = setTimeout(() => void run(false), interval);
      } catch (caught) {
        if (!alive) return;
        setError(caught instanceof Error ? caught.message : "No se pudo cargar el estado operacional consolidado.");
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    void run(!hasDataRef.current);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [organizationId, refreshNonce]);

  return { data, error, isLoading, retry, isPolling: Boolean(data?.polling?.shouldPoll) };
}
