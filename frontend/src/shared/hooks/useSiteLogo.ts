import { useEffect, useState } from "react";

export const DEFAULT_SITE_LOGO_URL = "/favicon.svg";
export const SITE_LOGO_STORAGE_KEY = "civitas.site.logoDataUrl";
export const SITE_LOGO_CHANGED_EVENT = "civitas:site-logo-changed";

const getLogoHrefElement = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]');

export const getStoredSiteLogo = () =>
  window.localStorage.getItem(SITE_LOGO_STORAGE_KEY) || DEFAULT_SITE_LOGO_URL;

export const applySiteLogo = (logoUrl: string) => {
  const favicon = getLogoHrefElement();
  if (favicon) {
    favicon.href = logoUrl;
  }
};

export const setStoredSiteLogo = (logoUrl: string) => {
  window.localStorage.setItem(SITE_LOGO_STORAGE_KEY, logoUrl);
  applySiteLogo(logoUrl);
  window.dispatchEvent(new CustomEvent(SITE_LOGO_CHANGED_EVENT, { detail: logoUrl }));
};

export const resetStoredSiteLogo = () => {
  window.localStorage.removeItem(SITE_LOGO_STORAGE_KEY);
  applySiteLogo(DEFAULT_SITE_LOGO_URL);
  window.dispatchEvent(new CustomEvent(SITE_LOGO_CHANGED_EVENT, { detail: DEFAULT_SITE_LOGO_URL }));
};

export function useSiteLogo() {
  const [logoUrl, setLogoUrl] = useState(DEFAULT_SITE_LOGO_URL);

  useEffect(() => {
    const currentLogo = getStoredSiteLogo();
    setLogoUrl(currentLogo);
    applySiteLogo(currentLogo);

    const handleLogoChange = (event: Event) => {
      const nextLogo = event instanceof CustomEvent && typeof event.detail === "string"
        ? event.detail
        : getStoredSiteLogo();
      setLogoUrl(nextLogo);
      applySiteLogo(nextLogo);
    };

    window.addEventListener(SITE_LOGO_CHANGED_EVENT, handleLogoChange);
    window.addEventListener("storage", handleLogoChange);

    return () => {
      window.removeEventListener(SITE_LOGO_CHANGED_EVENT, handleLogoChange);
      window.removeEventListener("storage", handleLogoChange);
    };
  }, []);

  return logoUrl;
}
