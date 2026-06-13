export type OwnerWorkspace = {
  id: string;
  name: string;
  status: "Activo" | "Borrador" | "Revisión";
  updatedAt: string;
};

export const ownerWorkspaces: OwnerWorkspace[] = [
  {
    id: "civ-001",
    name: "Civitas Local",
    status: "Activo",
    updatedAt: "2026-06-12",
  },
  {
    id: "civ-002",
    name: "Piloto Comunitario",
    status: "Revisión",
    updatedAt: "2026-06-10",
  },
  {
    id: "civ-003",
    name: "Mesa de trabajo",
    status: "Borrador",
    updatedAt: "2026-06-08",
  },
];

export const mockOrganizations = [
  {
    id: "org-local",
    name: "Organización local demo",
    description: "Entidad mock para validar navegación y composición visual.",
    members: 12,
  },
  {
    id: "org-civic",
    name: "Laboratorio Cívico",
    description: "Ejemplo de tarjeta seleccionable sin persistencia ni API.",
    members: 8,
  },
];
