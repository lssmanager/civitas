import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerWorkerQueuesObservabilityResponse } from "../api/owner";

type Loader = () => Promise<OwnerWorkerQueuesObservabilityResponse>;

export function getWorkerQueuesRefreshIntervalMs(data?: OwnerWorkerQueuesObservabilityResponse | null) {
  const freshness = data?.workerHealth?.freshness;
  if (!freshness?.shouldAutoRefresh) return null;
  const seconds = Number(freshness.staleAfterSeconds || 0);
  return Math.max(seconds > 0 ? seconds : 30, 5) * 1000;
}

export function useWorkerQueuesObservability(load: Loader) {
  const loadRef = useRef(load);
  const [data, setData] = useState<OwnerWorkerQueuesObservabilityResponse>();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hasDataRef = useRef(false);

  useEffect(() => { loadRef.current = load; }, [load]);
  const retry = useCallback(() => setRefreshNonce((current) => current + 1), []);

  const lastIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function run(showLoading: boolean) {
      if (showLoading) setIsLoading(true);
      setError(null);
      try {
        const response = await loadRef.current();
        if (!alive) return;
        hasDataRef.current = true;
        setData(response);
        const interval = getWorkerQueuesRefreshIntervalMs(response);
        lastIntervalRef.current = interval;
        if (interval) timer = setTimeout(() => void run(false), interval);
      } catch (caught) {
        if (!alive) return;
        setError(caught instanceof Error ? caught.message : "No se pudo cargar Observabilidad > Worker y colas.");
        if (lastIntervalRef.current) timer = setTimeout(() => void run(false), lastIntervalRef.current);
      } finally {
        if (alive) setIsLoading(false);
      }
    }
    void run(!hasDataRef.current);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [refreshNonce]);

  return { data, error, isLoading, retry, isAutoRefreshing: Boolean(getWorkerQueuesRefreshIntervalMs(data)) };
}
