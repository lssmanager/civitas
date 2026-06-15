import { useLogto } from "@logto/react";
import { useMemo } from "react";
import { APP_ENV } from "../env";

const API_BASE_URL = APP_ENV.api.baseUrl;
const CIVITAS_API_RESOURCE_INDICATOR = APP_ENV.api.resourceIndicator;
const inflightGetRequests = new Map<string, Promise<unknown>>();

export type ApiError = {
  message?: string;
  error?: string;
  status?: number;
};

export class ApiRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

const normalizeMethod = (method?: string) => (method ?? "GET").toUpperCase();
const getInflightRequestKey = (method: string, endpoint: string, organizationId?: string) =>
  `${method}:${organizationId ?? "global"}:${endpoint}`;

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

            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
              ...options,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                ...options.headers,
              },
            });

            if (!response.ok) {
              const errorPayload = await response.json().catch(() => null) as ApiError | null;
              const apiMessage = errorPayload?.message || errorPayload?.error;
              throw new ApiRequestError(
                apiMessage ? `API request failed: ${apiMessage}` : `API request failed: ${response.statusText || response.status}`,
                response.status
              );
            }

            return (await response.json()) as T;
          } catch (error) {
            if (error instanceof ApiRequestError) {
              throw error;
            }
            throw new ApiRequestError(error instanceof Error ? error.message : String(error));
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
