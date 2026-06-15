import { Badge } from "react-bootstrap";
import { PageCard, PageShell } from "../shared/ui";

export function OwnerSettingsPage() {
  return (
    <PageShell
      eyebrow="Owner"
      title="Settings owner"
      description="Espacio reservado para configuración owner y futuras opciones operativas sin mezclar responsabilidades en el resumen."
      actions={<Badge bg="secondary">Scaffold</Badge>}
    >
      <PageCard
        title="Configuración pendiente"
        subtitle="Este scaffold deja una ruta estable para settings de organización, provisioning avanzado y controles owner futuros."
      >
        <p className="text-secondary mb-0">
          La configuración se conectará en fases posteriores. Por ahora esta vista existe para mantener la navegación escalable sin reintroducir lógica de reconciliación o provisioning en el dashboard owner.
        </p>
      </PageCard>
    </PageShell>
  );
}
