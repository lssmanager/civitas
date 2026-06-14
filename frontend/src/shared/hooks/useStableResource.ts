import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type StableResourceState<TData, TParams> = {
  data: TData | undefined;
  error: string | null;
  isLoading: boolean;
  params: TParams;
  reload: (nextParams?: TParams | ((current: TParams) => TParams)) => void;
  retry: () => void;
};

type UseStableResourceOptions<TData, TParams> = {
  initialParams: TParams;
  load: (params: TParams) => Promise<TData>;
  getKey?: (params: TParams) => string;
  getErrorMessage?: (error: unknown) => string;
};

const defaultGetKey = <TParams,>(params: TParams) => JSON.stringify(params);

const defaultGetErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "No se pudo cargar el recurso solicitado.";

export function useStableResource<TData, TParams>({
  initialParams,
  load,
  getKey = defaultGetKey,
  getErrorMessage = defaultGetErrorMessage,
}: UseStableResourceOptions<TData, TParams>): StableResourceState<TData, TParams> {
  const loadRef = useRef(load);
  const getErrorMessageRef = useRef(getErrorMessage);
  const [params, setParams] = useState(initialParams);
  const paramsRef = useRef(params);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [data, setData] = useState<TData>();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    getErrorMessageRef.current = getErrorMessage;
  }, [getErrorMessage]);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const paramsKey = useMemo(() => getKey(params), [getKey, params]);

  useEffect(() => {
    let isMounted = true;

    async function loadResource() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await loadRef.current(paramsRef.current);

        if (isMounted) {
          setData(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessageRef.current(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadResource();

    return () => {
      isMounted = false;
    };
  }, [paramsKey, refreshNonce]);

  const retry = useCallback(() => {
    setRefreshNonce((current) => current + 1);
  }, []);

  const reload = useCallback((nextParams?: TParams | ((current: TParams) => TParams)) => {
    if (typeof nextParams === "function") {
      setParams((current) => (nextParams as (current: TParams) => TParams)(current));
      return;
    }

    if (nextParams) {
      setParams(nextParams);
      return;
    }

    setRefreshNonce((current) => current + 1);
  }, []);

  return {
    data,
    error,
    isLoading,
    params,
    reload,
    retry,
  };
}
