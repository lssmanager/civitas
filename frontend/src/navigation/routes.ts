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
  ownerSystem: {
    path: "/owner/system",
    label: "Sistema",
    description: "Vista técnica interna de worker, Redis y colas.",
  },
  ownerLogs: {
    path: "/owner/logs",
    label: "Logs",
    description: "Eventos owner registrados por Civitas.",
  },
  ownerSettings: {
    path: "/owner/settings",
    label: "Settings",
    description: "Configuración owner agrupada por submódulos.",
  },
  ownerBranding: {
    path: "/owner/settings/branding",
    label: "Branding",
    description: "Logo y marca visual del shell Civitas.",
  },
  ownerRoleMapping: {
    path: "/owner/settings/role-mapping",
    label: "Role Mapping",
    description: "Mapeo operativo de roles Logto hacia FluentCRM y WordPress.",
  },
  selectOrganization: {
    path: "/select-organization",
    label: "Seleccionar organización",
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
    description: "Trazabilidad operativa del portal owner.",
    children: [appRoutes.ownerLogs, appRoutes.ownerSystem],
  },
  {
    path: "/owner/settings-section",
    label: appRoutes.ownerSettings.label,
    description: appRoutes.ownerSettings.description,
    children: [appRoutes.ownerBranding, appRoutes.ownerRoleMapping],
  },
];

export const ownerNavigation: AppRoute[] = [
  appRoutes.owner,
  appRoutes.ownerOrganizations,
  appRoutes.selectOrganization,
  appRoutes.ownerLogs,
  appRoutes.ownerSystem,
  appRoutes.ownerBranding,
  appRoutes.ownerRoleMapping,
];

export type RouteMetadata = { label: string; parentPath?: string };

export const routeMetadata: Record<string, RouteMetadata> = {
  "/owner": { label: "Owner" },
  "/owner/organizations": { label: "Organizaciones", parentPath: appRoutes.owner.path },
  "/owner/logs": { label: appRoutes.ownerLogs.label, parentPath: appRoutes.owner.path },
  "/owner/system": { label: appRoutes.ownerSystem.label, parentPath: appRoutes.owner.path },
  "/owner/audit": { label: appRoutes.ownerLogs.label, parentPath: appRoutes.owner.path },
  "/owner/settings": { label: appRoutes.ownerSettings.label, parentPath: appRoutes.owner.path },
  "/owner/settings/branding": { label: appRoutes.ownerBranding.label, parentPath: appRoutes.ownerSettings.path },
  "/owner/settings/role-mapping": { label: appRoutes.ownerRoleMapping.label, parentPath: appRoutes.ownerSettings.path },
  "/select-organization": { label: appRoutes.selectOrganization.label, parentPath: appRoutes.ownerOrganizations.path },
  "/account": { label: appRoutes.account.label },
};

export const routePatterns: Array<{ pattern: RegExp; metadata: RouteMetadata }> = [
  {
    pattern: /^\/owner\/organizations\/[^/]+\/settings$/,
    metadata: { label: "Settings de organización", parentPath: appRoutes.ownerOrganizations.path },
  },
];
