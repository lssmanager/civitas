import { useLogto } from "@logto/react";
import { useMemo } from "react";
import { APP_ENV } from "../env";

const API_BASE_URL = APP_ENV.api.baseUrl;
const CIVITAS_API_RESOURCE_INDICATOR = APP_ENV.api.resourceIndicator || undefined;
const inflightGetRequests = new Map<string, Promise<unknown>>();
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

export type ApiError = {
  message?: string;
  error?: string;
  status?: number;
  code?: string | null;
  diagnostic?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
};

export class ApiRequestError extends Error {
  status?: number;
  payload?: ApiError | null;

  constructor(message: string, status?: number, payload?: ApiError | null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload ?? null;
  }
}

const normalizeMethod = (method?: string) => (method ?? "GET").toUpperCase();
const getInflightRequestKey = (method: string, endpoint: string, organizationId?: string) =>
  `${method}:${organizationId ?? "global"}:${endpoint}`;

const getApiErrorMessage = (response: Response, payload: ApiError | null) => {
  const apiMessage = payload?.message || payload?.error;

  if (apiMessage) {
    return `API request failed: ${apiMessage}`;
  }

  if (response.status === 504) {
    return "API request failed: el gateway no respondió a tiempo. Reintenta en unos segundos o valida la disponibilidad del backend.";
  }

  return `API request failed: ${response.statusText || response.status}`;
};

export const useApi = () => {
  const { getAccessToken, getOrganizationToken } = useLogto();

  const fetchWithToken = useMemo(
    () =>
      async <T>(endpoint: string, options: RequestInit = {}, organizationId?: string): Promise<T> => {
        const method = normalizeMethod(options.method);
        const requestKey = getInflightRequestKey(method, endpoint, organizationId);

        if (method === "GET") {
          const inflightRequest = inflightGetRequests.get(requestKey);
          if (inflightRequest) {
            return inflightRequest as Promise<T>;
          }
        }

        const requestPromise: Promise<T> = (async () => {
          try {
            let token: string | undefined;

            if (organizationId) {
              token = await getOrganizationToken(organizationId);
            } else {
              token = await getAccessToken(CIVITAS_API_RESOURCE_INDICATOR);
            }

            if (!token) {
              throw new ApiRequestError(
                organizationId ? "User is not a member of the organization" : "Failed to get access token"
              );
            }

            const abortController = new AbortController();
            const timeoutId = window.setTimeout(() => abortController.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
              ...options,
              signal: options.signal ?? abortController.signal,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                ...options.headers,
              },
            }).finally(() => window.clearTimeout(timeoutId));

            if (!response.ok) {
              const errorPayload = await response.json().catch(() => null) as ApiError | null;
              throw new ApiRequestError(
                getApiErrorMessage(response, errorPayload),
                response.status,
                errorPayload
              );
            }

            return (await response.json()) as T;
          } catch (error) {
            if (error instanceof ApiRequestError) {
              throw error;
            }
            throw new ApiRequestError(error instanceof DOMException && error.name === "AbortError"
              ? "API request failed: la solicitud tardó demasiado y fue cancelada por Civitas."
              : error instanceof Error ? error.message : String(error));
          } finally {
            if (method === "GET") {
              inflightGetRequests.delete(requestKey);
            }
          }
        })();

        if (method === "GET") {
          inflightGetRequests.set(requestKey, requestPromise);
        }

        return requestPromise;
      },
    [getAccessToken, getOrganizationToken]
  );

  return { fetchWithToken };
};