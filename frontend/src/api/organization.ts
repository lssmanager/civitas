import { useLogto } from "@logto/react";
import { useMemo } from "react";
import { useApi } from "./base";
import { Document } from "../pages/OrganizationPage/types";

type DocumentsResponse = {
  documents?: Document[];
  document?: Document;
};

const hasDocumentPayload = (response: Document | DocumentsResponse): response is DocumentsResponse => {
  return typeof response === "object" && response !== null && "document" in response;
};

export const useOrganizationApi = () => {
  const { fetchWithToken } = useApi();
  const { getOrganizationToken, getOrganizationTokenClaims } = useLogto();

  return useMemo(() => ({
    getDocuments: async (organizationId: string): Promise<Document[]> => {
      const response = await fetchWithToken<DocumentsResponse | Document[]>(`/organizations/${organizationId}/documents`, {
        method: "GET",
      }, organizationId);
      return Array.isArray(response) ? response : (response.documents ?? []);
    },

    createDocument: async (organizationId: string, data: {
      title: string;
      content: string;
    }): Promise<Document> => {
      const response = await fetchWithToken<DocumentsResponse | Document>(`/organizations/${organizationId}/documents`, {
        method: "POST",
        body: JSON.stringify(data),
      }, organizationId);

      if (hasDocumentPayload(response)) {
        return response.document as Document;
      }

      return response;
    },

    getUserOrganizationScopes: async (organizationId: string): Promise<string[]> => {
      const organizationToken = await getOrganizationToken(organizationId);
      if (!organizationToken) {
        throw new Error("User is not a member of the organization");
      }

      const tokenClaims = await getOrganizationTokenClaims(organizationId);
      return tokenClaims?.scope?.split(" ") || [];
    },
  }), [fetchWithToken, getOrganizationToken, getOrganizationTokenClaims]);
};
