import { useLogto } from "@logto/react";
import { useCallback } from "react";
import { APP_ENV } from "../env";

const API_BASE_URL = APP_ENV.api.baseUrl;
const CIVITAS_API_RESOURCE_INDICATOR = APP_ENV.api.resourceIndicator;

export type ApiError = {
  message: string;
  status?: number;
};

export class ApiRequestError extends Error {
  status?: number;
  isNetworkError: boolean;

  constructor(message: string, status?: number, isNetworkError = false) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.isNetworkError = isNetworkError;
  }
}

const buildApiUrl = (endpoint: string) => {
  const normalizedBaseUrl = API_BASE_URL.replace(/\/+$/, "");
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  return `${normalizedBaseUrl}${normalizedEndpoint}`;
};

const getErrorMessage = async (response: Response) => {
  try {
    const body = await response.json();
    if (typeof body?.message === "string" && body.message.trim()) {
      return body.message;
    }

    if (typeof body?.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Fall back to HTTP status text below when the response is not JSON.
  }

  return response.statusText || `HTTP ${response.status}`;
};

export const useApi = () => {
  const { getAccessToken, getOrganizationToken } = useLogto();

  const fetchWithToken = useCallback(
    async (endpoint: string, options: RequestInit = {}, organizationId?: string) => {
      try {
        const token = organizationId
          ? await getOrganizationToken(organizationId)
          : await getAccessToken(CIVITAS_API_RESOURCE_INDICATOR);

        if (!token) {
          throw new ApiRequestError(
            organizationId ? "User is not a member of the organization" : "Failed to get access token"
          );
        }

        const response = await fetch(buildApiUrl(endpoint), {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...options.headers,
          },
        });

        if (!response.ok) {
          throw new ApiRequestError(await getErrorMessage(response), response.status);
        }

        return await response.json();
      } catch (error) {
        if (error instanceof ApiRequestError) {
          throw error;
        }

        throw new ApiRequestError(error instanceof Error ? error.message : String(error), undefined, true);
      }
    },
    [getAccessToken, getOrganizationToken]
  );

  return { fetchWithToken };
};
