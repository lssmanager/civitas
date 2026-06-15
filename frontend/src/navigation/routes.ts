export type AppRoute = {
  path: string;
  label: string;
  description?: string;
};

export const appRoutes = {
  owner: {
    path: "/owner",
    label: "Resumen",
    description: "Resumen del espacio owner.",
  },
  ownerOrganizations: {
    path: "/owner/organizations",
    label: "Organizaciones",
    description: "Directorio canónico Logto / Civitas.",
  },
  ownerLogs: {
    path: "/owner/logs",
    label: "Logs",
    description: "Eventos owner registrados por Civitas.",
  },
  selectOrganization: {
    path: "/select-organization",
    label: "Select Organization",
    description: "Selector visual sin conexión a organizaciones reales.",
  },
  account: {
    path: "/account",
    label: "Cuenta",
    description: "Resumen mock del perfil local sin autenticación.",
  },
} as const satisfies Record<string, AppRoute>;

export const primaryNavigation: AppRoute[] = [appRoutes.account];

export const ownerNavigation: AppRoute[] = [
  appRoutes.owner,
  appRoutes.ownerOrganizations,
  appRoutes.selectOrganization,
  appRoutes.ownerLogs,
  { path: "/owner/settings", label: "Settings", description: "Placeholder para settings owner." },
];

export const routeMetadata: Record<string, { label: string; parentPath?: string }> = {
  "/owner": { label: appRoutes.owner.label },
  "/owner/organizations": { label: appRoutes.ownerOrganizations.label, parentPath: appRoutes.owner.path },
  "/owner/logs": { label: appRoutes.ownerLogs.label, parentPath: appRoutes.owner.path },
  "/owner/settings": { label: "Settings", parentPath: appRoutes.owner.path },
  "/select-organization": { label: appRoutes.selectOrganization.label, parentPath: appRoutes.owner.path },
  "/account": { label: appRoutes.account.label },
};
