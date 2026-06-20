import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Form, InputGroup, Table } from "react-bootstrap";
import { type OwnerCrmRoleMapping, type OwnerWordPressRoleMapping, useOwnerApi } from "../api/owner";
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
        {values.map((value) => <Badge key={value} bg="secondary" className="d-inline-flex align-items-center gap-2 text-break">{value}<button type="button" className="btn-close btn-close-white" aria-label={`Quitar ${value}`} onClick={() => onChange(values.filter((item) => item !== value))} /></Badge>)}
      </div>
      <InputGroup size="sm"><Form.Control value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /><Button variant="outline-primary" onClick={add}>Agregar</Button></InputGroup>
    </div>
  );
}

function WordPressRoleSelect({ value, disabled, roles, onChange }: { value: string; disabled: boolean; roles: Array<{ slug: string; name: string }>; onChange: (slug: string) => void }) {
  return (
    <Form.Select size="sm" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label="WordPress role mapping">
      <option value="">Sin rol WordPress</option>
      {roles.map((role) => <option key={role.slug} value={role.slug}>{role.name} ({role.slug})</option>)}
    </Form.Select>
  );
}

export function OwnerSettingsPage() {
  const ownerApi = useOwnerApi();
  const crmResource = useStableResource({ load: ownerApi.getFluentCrmRoleMappings, getKey: () => "owner-fluentcrm-role-mappings", initialParams: undefined });
  const wordpressResource = useStableResource({ load: ownerApi.getWordPressRoleMappings, getKey: () => "owner-wordpress-role-mappings", initialParams: undefined });
  const [mappings, setMappings] = useState<OwnerCrmRoleMapping[]>([]);
  const [wordpressMappings, setWordPressMappings] = useState<OwnerWordPressRoleMapping[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { if (crmResource.data?.mappings) setMappings(crmResource.data.mappings); }, [crmResource.data]);
  useEffect(() => { if (wordpressResource.data?.mappings) setWordPressMappings(wordpressResource.data.mappings); }, [wordpressResource.data]);

  const wordpressRoles = wordpressResource.data?.wordpressRoles ?? [];
  const wordpressByLogtoId = useMemo(() => new Map(wordpressMappings.map((mapping) => [mapping.logtoRoleId, mapping])), [wordpressMappings]);
  const wordpressCatalogBySlug = useMemo(() => new Map(wordpressRoles.map((role) => [role.slug, role])), [wordpressRoles]);
  const wordpressLoading = wordpressResource.isLoading;
  const wordpressCatalogDisabled = wordpressLoading || Boolean(wordpressResource.error) || wordpressRoles.length === 0;
  const crmWarnings = useMemo(() => [...new Set(crmResource.data?.warnings ?? [])].filter((warning) => warning !== crmResource.data?.envWarning), [crmResource.data]);
  const wordpressWarnings = useMemo(() => [...new Set(wordpressResource.data?.warnings ?? [])], [wordpressResource.data]);

  const update = (logtoRoleId: string, patch: Partial<OwnerCrmRoleMapping>) => setMappings((items) => items.map((item) => item.logtoRoleId === logtoRoleId ? { ...item, ...patch } : item));
  const updateWordPress = (crmMapping: OwnerCrmRoleMapping, wordpressRoleSlug: string) => {
    const catalogRole = wordpressCatalogBySlug.get(wordpressRoleSlug);
    setWordPressMappings((items) => {
      const existing = wordpressByLogtoId.get(crmMapping.logtoRoleId);
      const next: OwnerWordPressRoleMapping = {
        logtoRoleId: crmMapping.logtoRoleId,
        organizationRoleName: crmMapping.organizationRoleName,
        wordpressRoleSlug,
        wordpressRoleName: catalogRole?.name || "",
        isActive: Boolean(wordpressRoleSlug),
        source: "gui_override",
        isCustomized: true,
      };
      return existing ? items.map((item) => item.logtoRoleId === crmMapping.logtoRoleId ? { ...item, ...next } : item) : [...items, next];
    });
  };

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const [crmResponse, wpResponse] = await Promise.all([ownerApi.updateFluentCrmRoleMappings(mappings), ownerApi.updateWordPressRoleMappings(wordpressMappings)]);
      setMappings(crmResponse.mappings);
      setWordPressMappings(wpResponse.mappings);
      setMessage("Mappings CRM y WordPress guardados y auditados.");
    } finally { setSaving(false); }
  };
  const reset = async () => {
    setSaving(true); setMessage(null);
    try {
      const [crmResponse, wpResponse] = await Promise.all([ownerApi.resetFluentCrmRoleMappings(), ownerApi.resetWordPressRoleMappings()]);
      setMappings(crmResponse.mappings);
      setWordPressMappings(wpResponse.mappings);
      setMessage("Overrides eliminados; Logto sigue siendo canónico y los mappings operativos vuelven a defaults/unmapped.");
    } finally { setSaving(false); }
  };

  const renderWordPressSelect = (mapping: OwnerCrmRoleMapping) => {
    const wpMapping = wordpressByLogtoId.get(mapping.logtoRoleId);
    return <WordPressRoleSelect roles={wordpressRoles} value={wpMapping?.wordpressRoleSlug ?? ""} disabled={wordpressCatalogDisabled} onChange={(slug) => updateWordPress(mapping, slug)} />;
  };

  return (
    <PageShell eyebrow="Owner settings" title="Role Mapping" description="Mapea roles organizacionales canónicos de Logto hacia segmentación CRM y, opcionalmente, hacia roles WordPress operativos. Logto sigue siendo la fuente de verdad de autorización." actions={<div className="d-flex flex-wrap gap-2"><Badge bg="info">CRM: {crmResource.data?.effectiveSource ?? "cargando"}</Badge><Badge bg="secondary">WP: {wordpressResource.data?.effectiveSource ?? "cargando"}</Badge></div>}>
      {crmResource.isLoading ? <LoadingState title="Cargando roles" description="Leyendo roles desde Logto y configuración operativa desde Civitas." /> : crmResource.error ? <ErrorState title="No se pudo cargar el mapping" message={crmResource.error} action={<Button onClick={crmResource.retry}>Reintentar</Button>} /> : (
        <PageCard title="Logto → CRM / WordPress role mapping" subtitle="Civitas guarda mappings operativos subordinados a logtoRoleId; WordPress no define permisos ni roles canónicos del producto.">
          {crmResource.data?.envWarning && <Alert variant="warning">{crmResource.data.envWarning}</Alert>}
          {crmWarnings.map((warning) => <Alert key={warning} variant="warning">{warning}</Alert>)}
          {wordpressLoading && <Alert variant="info">Cargando catálogo real de roles WordPress…</Alert>}
          {wordpressResource.error && <Alert variant="warning">No se pudo cargar roles WordPress: {wordpressResource.error}. Puedes editar CRM; el dropdown WordPress queda deshabilitado hasta reintentar. <Button size="sm" variant="outline-warning" className="ms-2" onClick={wordpressResource.retry}>Reintentar WordPress</Button></Alert>}
          {!wordpressLoading && !wordpressResource.error && wordpressRoles.length === 0 && <Alert variant="warning">WordPress respondió sin roles disponibles. Verifica el endpoint configurado para el catálogo de roles.</Alert>}
          {wordpressWarnings.map((warning) => <Alert key={warning} variant="warning">{warning}</Alert>)}
          {message && <Alert variant="success">{message}</Alert>}
          <Alert variant="light" className="border small mb-3">Separación canónica: Logto controla identidad, tenant context, memberships, roles y permisos. WordPress/FluentCRM solo reciben mappings operativos para sincronización, CRM y segmentación.</Alert>

          <div className="d-none d-md-block">
            <Table responsive hover className="align-middle">
              <thead><tr><th>Role Logto</th><th>WordPress role</th><th>Tags CRM</th><th>Lists CRM</th><th>Tipo</th><th>Source</th><th>Active</th></tr></thead>
              <tbody>{mappings.map((mapping) => <tr key={mapping.logtoRoleId}>
                <td><strong>{mapping.organizationRoleName}</strong><div className="small text-muted text-break">{mapping.logtoRoleId}</div>{mapping.isCustomized && <Badge bg="primary" className="ms-2">custom CRM</Badge>}{wordpressByLogtoId.get(mapping.logtoRoleId)?.isCustomized && <Badge bg="dark" className="ms-2">custom WP</Badge>}</td>
                <td style={{ minWidth: 220 }}>{renderWordPressSelect(mapping)}<div className="small text-muted mt-1">Solo sincronización; no autorización.</div></td>
                <td style={{ minWidth: 260 }}><ChipEditor values={mapping.tags} placeholder="Nuevo tag" onChange={(tags) => update(mapping.logtoRoleId, { tags })} /></td>
                <td style={{ minWidth: 260 }}><ChipEditor values={mapping.lists} placeholder="Nueva list" onChange={(lists) => update(mapping.logtoRoleId, { lists })} /></td>
                <td><Form.Control size="sm" value={mapping.roleType} onChange={(event) => update(mapping.logtoRoleId, { roleType: event.target.value })} /></td>
                <td><Badge bg={mapping.source === "gui_override" ? "primary" : "secondary"}>{mapping.source}</Badge></td>
                <td><Form.Check type="switch" checked={mapping.isActive} onChange={(event) => update(mapping.logtoRoleId, { isActive: event.target.checked })} /></td>
              </tr>)}</tbody>
            </Table>
          </div>

          <div className="d-md-none d-flex flex-column gap-3">
            {mappings.map((mapping) => <div key={mapping.logtoRoleId} className="border rounded p-3 bg-body">
              <div className="d-flex justify-content-between align-items-start gap-2 mb-3"><div><strong>{mapping.organizationRoleName}</strong><div className="small text-muted text-break">{mapping.logtoRoleId}</div></div><div className="d-flex flex-wrap gap-1 justify-content-end">{mapping.isCustomized && <Badge bg="primary">CRM</Badge>}{wordpressByLogtoId.get(mapping.logtoRoleId)?.isCustomized && <Badge bg="dark">WP</Badge>}</div></div>
              <Form.Group className="mb-3"><Form.Label>WordPress role operativo</Form.Label>{renderWordPressSelect(mapping)}<Form.Text muted>Opcional; no cambia permisos en Civitas.</Form.Text></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Tags CRM</Form.Label><ChipEditor values={mapping.tags} placeholder="Nuevo tag" onChange={(tags) => update(mapping.logtoRoleId, { tags })} /></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Lists CRM</Form.Label><ChipEditor values={mapping.lists} placeholder="Nueva list" onChange={(lists) => update(mapping.logtoRoleId, { lists })} /></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Tipo</Form.Label><Form.Control size="sm" value={mapping.roleType} onChange={(event) => update(mapping.logtoRoleId, { roleType: event.target.value })} /></Form.Group>
              <div className="d-flex justify-content-between align-items-center"><Badge bg={mapping.source === "gui_override" ? "primary" : "secondary"}>{mapping.source}</Badge><Form.Check type="switch" label="Activo" checked={mapping.isActive} onChange={(event) => update(mapping.logtoRoleId, { isActive: event.target.checked })} /></div>
            </div>)}
          </div>

          <div className="d-flex flex-column flex-sm-row gap-2 mt-3"><Button disabled={saving} onClick={save}>Guardar cambios</Button><Button disabled={saving} variant="outline-danger" onClick={reset}>Restaurar defaults</Button></div>
        </PageCard>
      )}
    </PageShell>
  );
}
