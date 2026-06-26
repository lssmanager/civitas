const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FORM_FIELD_INVENTORY,
  buildFluentCrmCompanyPayloadFromForm,
  buildFluentCrmContactPayloadFromAssignment,
  buildLogtoOrganizationCreatePayload,
  buildLogtoUserCreatePayload,
} = require("../services/organizationProvisioningPayloads");

test("organization payload separates Logto top-level, customData and downstream CRM metadata", () => {
  const canonical = { name: "Colegio Civitas", description: "Desc", administrativeContacts: [{ name: "Ada Admin", email: "ada@colegio.edu.co" }] };
  const extended = { slug: "colegio-civitas", subdomain: "civitas", appBaseDomain: "socialstudies.cloud", entryUrl: "https://civitas.socialstudies.cloud", adminDomain: "colegio.edu.co", oidcRedirectUri: "https://civitas.socialstudies.cloud/callback" };
  const crm = { companyEmail: " INFO@COLEGIO.EDU.CO ", type: "school", industry: "education", nit: "123", verificationDigit: "4", state: " California ", department: "Legacy Department", tags: [" colegios ", "colegios"], lists: [" onboarding "] };
  const payload = buildLogtoOrganizationCreatePayload({ canonical, extended, crm });
  assert.equal(payload.name, "Colegio Civitas");
  assert.equal(payload.description, "Desc");
  assert.equal(payload.customData.provisioning.slug, undefined);
  assert.equal(payload.customData.provisioning.appSubdomain, "civitas");
  assert.equal(payload.customData.provisioning.appBaseDomain, "socialstudies.cloud");
  assert.equal(payload.customData.provisioning.entryUrl, "https://civitas.socialstudies.cloud");
  assert.equal(payload.customData.civitasProfile.business.nit, 123);
  assert.equal(payload.customData.civitasProfile.business.state, "California");
  assert.equal(payload.customData.civitasProfile.business.department, undefined);
  assert.equal(payload.customData.civitasProfile.business.slug, undefined);
  assert.equal(payload.customData.civitasProfile.business.subdomain, undefined);
  assert.equal(payload.customData.civitasProfile.contact.email, "info@colegio.edu.co");
  assert.deepEqual(payload.customData.civitasProfile.downstream.crm.tags, ["colegios"]);
  assert.ok(FORM_FIELD_INVENTORY["baseAdmin.position (deprecated)"].includes("use.administrativeContacts[].position"));
});

test("user payload maps Latin American names to Logto profile and customData", () => {
  const payload = buildLogtoUserCreatePayload({ firstName: "Ana", middleName: "María", firstSurname: "Pérez", secondSurname: "Gómez", email: " ANA@EXAMPLE.COM ", phone: "+571234567890", username: "ana", position: "Rectora", phoneExtension: "123" });
  assert.equal(payload.primaryEmail, "ana@example.com");
  assert.equal(payload.name, "Ana María Pérez Gómez");
  assert.deepEqual(payload.profile, { givenName: "Ana", middleName: "María", familyName: "Pérez", preferredUsername: "ana" });
  assert.equal(payload.customData.secondFamilyName, "Gómez");
  assert.equal(payload.primaryPhone, undefined);
  assert.equal(payload.customData.civitasProfile.position, "Rectora");
  assert.equal(payload.customData.civitasProfile.phone, "+571234567890");
  assert.equal(payload.customData.civitasProfile.phoneExtension, "123");
  assert.equal(payload.profile.position, undefined);
});

test("user payload keeps personal phones as Logto primaryPhone only when no extension is present", () => {
  const payload = buildLogtoUserCreatePayload({ email: "mobile@example.com", phone: "+573001112233" });
  assert.equal(payload.primaryPhone, "+573001112233");
  assert.equal(payload.customData.civitasProfile.phone, "+573001112233");
});

test("FluentCRM builders produce retryable clean snapshots for company and contacts", () => {
  const company = buildFluentCrmCompanyPayloadFromForm({ form: { crm: { companyName: "Acme", numberOfEmployees: "25", department: "Antioquia", tags: ["org"], lists: ["main"] } }, canonical: { name: "Fallback", administrativeContacts: [{ name: "Owner", email: "owner@acme.edu" }] }, extended: { adminDomain: "acme.edu" } });
  assert.equal(company.companyName, "Acme");
  assert.equal(company.numberOfEmployees, 25);
  assert.equal(company.state, "Antioquia");
  assert.equal(company.department, undefined);
  const contact = buildFluentCrmContactPayloadFromAssignment({ assignment: { logtoUserId: "u1", email: "a@b.co", name: "A B", phoneExtension: "9", roleName: "Admin-org" }, companyId: "10", organizationLists: ["main"], organizationTags: ["org"] });
  assert.equal(contact.identity.phoneExtension, "9");
  assert.deepEqual(contact.roleNames, ["Admin-org"]);
  assert.deepEqual(contact.extraLists, ["main"]);
});
