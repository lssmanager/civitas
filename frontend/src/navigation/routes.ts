export type AppRoute = {
  path: string;
  label: string;
  description?: string;
};

export type NavigationNode = AppRoute & {
  children?: AppRoute[];
};

export const appRoutes = {
  owner: {
    path: "/owner",
    label: "Resumen",
    description: "Landing operativa del espacio owner.",
  },
  ownerOrganizations: {
    path: "/owner/organizations",
    label: "Crear organización",
    description: "Alta canónica en Logto con bootstrap por etapas.",
  },
  ownerLogs: {
    path: "/owner/logs",
    label: "Logs",
    description: "Logs y directorio técnico Logto/Civitas.",
  },
  ownerSettings: {
    path: "/owner/settings",
    label: "Settings",
    description: "Scaffold para configuración owner futura.",
  },
  selectOrganization: {
    path: "/select-organization",
    label: "Select Organization",
    description: "Selector visual de organizaciones reales de Logto.",
  },
  account: {
    path: "/account",
    label: "Cuenta",
    description: "Resumen mock del perfil local sin autenticación.",
  },
} as const satisfies Record<string, AppRoute>;

export const primaryNavigation: AppRoute[] = [appRoutes.account];

export const ownerNavigationTree: NavigationNode[] = [
  appRoutes.owner,
  {
    path: "/owner/organizations-section",
    label: "Organizaciones",
    description: "Creación y selección de organizaciones.",
    children: [appRoutes.ownerOrganizations, appRoutes.selectOrganization],
  },
  {
    path: "/owner/observability-section",
    label: "Observabilidad",
    description: "Estado real del sistema y soporte técnico.",
    children: [appRoutes.ownerLogs],
  },
  appRoutes.ownerSettings,
];

export const ownerNavigation: AppRoute[] = [
  appRoutes.owner,
  appRoutes.ownerOrganizations,
  appRoutes.selectOrganization,
  appRoutes.ownerLogs,
  appRoutes.ownerSettings,
];

export type RouteMetadata = { label: string; parentPath?: string };

export const routeMetadata: Record<string, RouteMetadata> = {
  "/owner": { label: "Owner" },
  "/owner/organizations-section": { label: "Organizaciones", parentPath: appRoutes.owner.path },
  "/owner/observability-section": { label: "Observabilidad", parentPath: appRoutes.owner.path },
  "/owner/organizations": { label: "Crear organización", parentPath: appRoutes.owner.path },
  "/owner/logs": { label: appRoutes.ownerLogs.label, parentPath: "/owner/observability-section" },
  "/owner/audit": { label: appRoutes.ownerLogs.label, parentPath: appRoutes.owner.path },
  "/owner/settings": { label: appRoutes.ownerSettings.label, parentPath: appRoutes.owner.path },
  "/select-organization": { label: appRoutes.selectOrganization.label, parentPath: "/owner/organizations-section" },
  "/account": { label: appRoutes.account.label },
};

export const routePatterns: Array<{ pattern: RegExp; metadata: RouteMetadata }> = [
  {
    pattern: /^\/owner\/organizations\/[^/]+\/settings$/,
    metadata: { label: "Settings de organización", parentPath: appRoutes.ownerOrganizations.path },
  },
];
