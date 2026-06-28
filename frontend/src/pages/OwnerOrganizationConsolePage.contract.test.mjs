import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("./OwnerOrganizationConsolePage.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useOperationalState.ts", import.meta.url), "utf8");

test("organization console renders primary operational-state blocks", () => {
  for (const label of ["Logto canónico", "FluentCRM downstream", "WordPress esperado", "Worker y cola", "Verificación live", "Contactos downstream"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /state\.canonical/);
  assert.match(page, /state\.fluentcrm/);
  assert.match(page, /state\.wordpress/);
  assert.match(page, /state\.worker/);
  assert.match(page, /state\.liveVerification/);
});

test("live vs local freshness is visible and live checks dominate", () => {
  assert.match(page, /sourceLabel/);
  assert.match(page, /checkedAt/);
  assert.match(page, /isStale/);
  assert.match(page, /live_provider_check/);
  assert.match(page, /domina visualmente/);
});

test("polling follows backend policy", () => {
  assert.match(hook, /data\?\.polling\?\.shouldPoll/);
  assert.match(hook, /intervalSeconds/);
  assert.match(page, /Polling activo por política backend/);
  assert.match(page, /polling detenido por el contrato backend/);
});

test("contacts_not_started_due_to_company_failure and nextAction are explicit", () => {
  assert.match(page, /contacts_not_started_due_to_company_failure/);
  assert.match(page, /state\.summary\.nextAction/);
  assert.match(page, /availableActions/);
});

test("pending-sync and events are secondary details only", () => {
  assert.match(page, /Detalle secundario legacy/);
  assert.match(page, /no alimentan badges, CTA ni mensaje principal/);
});
