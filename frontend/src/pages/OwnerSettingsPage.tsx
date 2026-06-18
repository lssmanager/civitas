import { useEffect, useState } from "react";
import { Alert, Badge, Button, Form, InputGroup, Table } from "react-bootstrap";
import { type OwnerCrmRoleMapping, useOwnerApi } from "../api/owner";
import { ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";
import { useStableResource } from "../shared/hooks/useStableResource";

function ChipEditor({ values, onChange, placeholder }: { values: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...new Set([...values, value])]);
    setDraft("");
  };
  return (
    <div className="d-flex flex-column gap-2">
      <div className="d-flex flex-wrap gap-1">
        {values.map((value) => <Badge key={value} bg="secondary" className="d-inline-flex align-items-center gap-2">{value}<button type="button" className="btn-close btn-close-white" aria-label={`Quitar ${value}`} onClick={() => onChange(values.filter((item) => item !== value))} /></Badge>)}
      </div>
      <InputGroup size="sm"><Form.Control value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /><Button variant="outline-primary" onClick={add}>Agregar</Button></InputGroup>
    </div>
  );
}

export function OwnerSettingsPage() {
  const ownerApi = useOwnerApi();
  const resource = useStableResource({ load: ownerApi.getFluentCrmRoleMappings, getKey: () => "owner-fluentcrm-role-mappings", initialParams: undefined });
  const [mappings, setMappings] = useState<OwnerCrmRoleMapping[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { if (resource.data?.mappings) setMappings(resource.data.mappings); }, [resource.data]);
  const update = (roleName: string, patch: Partial<OwnerCrmRoleMapping>) => setMappings((items) => items.map((item) => item.organizationRoleName === roleName ? { ...item, ...patch } : item));
  const save = async () => { setSaving(true); setMessage(null); try { const response = await ownerApi.updateFluentCrmRoleMappings(mappings); setMappings(response.mappings); setMessage("Mapping guardado y auditado."); } finally { setSaving(false); } };
  const reset = async () => { setSaving(true); setMessage(null); try { const response = await ownerApi.resetFluentCrmRoleMappings(); setMappings(response.mappings); setMessage("Overrides eliminados; usando defaults o fallback env temporal."); } finally { setSaving(false); } };

  return (
    <PageShell eyebrow="Owner settings" title="CRM Role Mapping" description="Mapea roles organizacionales canónicos de Logto hacia tags y lists de FluentCRM. Esto afecta segmentación CRM, no permisos Logto." actions={<Badge bg="info">Fuente efectiva: {resource.data?.effectiveSource ?? "cargando"}</Badge>}>
      {resource.isLoading ? <LoadingState title="Cargando roles" description="Leyendo roles desde Logto y configuración operativa desde Civitas." /> : resource.error ? <ErrorState title="No se pudo cargar el mapping" message={resource.error} action={<Button onClick={resource.retry}>Reintentar</Button>} /> : (
        <PageCard title="FluentCRM role mapping" subtitle="Civitas guarda solo la regla operativa rol Logto → segmentación CRM; no copia memberships ni roles canónicos.">
          {resource.data?.envWarning && <Alert variant="warning">{resource.data.envWarning}</Alert>}
          {message && <Alert variant="success">{message}</Alert>}
          <Table responsive hover className="align-middle">
            <thead><tr><th>Role</th><th>Tags CRM</th><th>Lists CRM</th><th>Tipo</th><th>Source</th><th>Active</th></tr></thead>
            <tbody>{mappings.map((mapping) => <tr key={mapping.organizationRoleName}>
              <td><strong>{mapping.organizationRoleName}</strong>{mapping.isCustomized && <Badge bg="primary" className="ms-2">custom</Badge>}</td>
              <td style={{ minWidth: 260 }}><ChipEditor values={mapping.tags} placeholder="Nuevo tag" onChange={(tags) => update(mapping.organizationRoleName, { tags })} /></td>
              <td style={{ minWidth: 260 }}><ChipEditor values={mapping.lists} placeholder="Nueva list" onChange={(lists) => update(mapping.organizationRoleName, { lists })} /></td>
              <td><Form.Control size="sm" value={mapping.roleType} onChange={(event) => update(mapping.organizationRoleName, { roleType: event.target.value })} /></td>
              <td><Badge bg={mapping.source === "gui_override" ? "primary" : "secondary"}>{mapping.source}</Badge></td>
              <td><Form.Check type="switch" checked={mapping.isActive} onChange={(event) => update(mapping.organizationRoleName, { isActive: event.target.checked })} /></td>
            </tr>)}</tbody>
          </Table>
          <div className="d-flex gap-2"><Button disabled={saving} onClick={save}>Guardar cambios</Button><Button disabled={saving} variant="outline-danger" onClick={reset}>Restaurar defaults</Button></div>
        </PageCard>
      )}
    </PageShell>
  );
}
