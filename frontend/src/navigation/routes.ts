export type AppRoute = {
  path: string;
  label: string;
  description?: string;
};

export const appRoutes = {
  owner: {
    path: "/owner",
    label: "Owner",
    description: "Vista mock del espacio principal de administración.",
  },
  ownerAudit: {
    path: "/owner/audit",
    label: "Auditoría",
    description: "Eventos owner básicos registrados por Civitas.",
  },
  selectOrganization: {
    path: "/select-organization",
    label: "Seleccionar organización",
    description: "Selector visual sin conexión a organizaciones reales.",
  },
  account: {
    path: "/account",
    label: "Cuenta",
    description: "Resumen mock del perfil local sin autenticación.",
  },
} as const satisfies Record<string, AppRoute>;

export const primaryNavigation: AppRoute[] = [
  appRoutes.owner,
  appRoutes.ownerAudit,
  appRoutes.selectOrganization,
  appRoutes.account,
];

export const routeMetadata: Record<string, { label: string; parentPath?: string }> = {
  "/owner": { label: appRoutes.owner.label },
  "/owner/audit": { label: appRoutes.ownerAudit.label, parentPath: appRoutes.owner.path },
  "/select-organization": { label: appRoutes.selectOrganization.label },
  "/account": { label: appRoutes.account.label },
};
