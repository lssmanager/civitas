import { useRef } from "react";
import { Alert, Button } from "react-bootstrap";
import { useAuthorization } from "../authz/useAuthorization";
import { PageCard, PageShell } from "../shared/ui";
import { resetStoredSiteLogo, setStoredSiteLogo, useSiteLogo } from "../shared/hooks/useSiteLogo";

function SiteLogoSettingsCard() {
  const logoUrl = useSiteLogo();
  const { canExecute } = useAuthorization();
  const canUpdateBranding = canExecute("owner.branding.update");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        return;
      }

      setStoredSiteLogo(reader.result);
    });
    reader.readAsDataURL(file);
  };

  return (
    <PageCard
      title="Logo del sitio"
      subtitle="Actualiza el logo visible del sidebar y del favicon local de Civitas."
      actions={
        <div className="d-flex flex-wrap gap-2">
          <Button type="button" variant="outline-primary" disabled={!canUpdateBranding} onClick={() => fileInputRef.current?.click()}>
            Subir logo
          </Button>
          <Button type="button" variant="outline-secondary" disabled={!canUpdateBranding} onClick={resetStoredSiteLogo}>
            Restaurar
          </Button>
        </div>
      }
    >
      {!canUpdateBranding ? <Alert variant="info">Modo solo lectura: puedes ver el branding, pero no subir ni restaurar logos.</Alert> : null}
      <div className="civitas-site-logo-settings d-flex align-items-center gap-3">
        <img className="civitas-site-logo-settings__preview" src={logoUrl} alt="Logo actual de Civitas" />
        <div>
          <p className="fw-semibold mb-1">Logo activo</p>
          <p className="text-secondary small mb-0">Usa una imagen cuadrada SVG, PNG o JPG. Se guarda localmente para no cambiar contratos API.</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          disabled={!canUpdateBranding}
          onChange={handleLogoUpload}
        />
      </div>
    </PageCard>
  );
}

export function OwnerBrandingSettingsPage() {
  return (
    <PageShell
      eyebrow="Owner settings"
      title="Branding"
      description="Configuración visual local del shell Civitas. Logto y los datos canónicos de organización no cambian desde esta pantalla."
    >
      <SiteLogoSettingsCard />
    </PageShell>
  );
}
