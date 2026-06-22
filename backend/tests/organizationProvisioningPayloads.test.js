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
  const canonical = { name: "Colegio Civitas", description: "Desc", baseAdmin: { name: "Ada Admin" } };
  const extended = { slug: "colegio-civitas", subdomain: "civitas", adminDomain: "colegio.edu.co", oidcRedirectUri: "https://civitas.learnsocialstudies.com/callback" };
  const crm = { companyEmail: " INFO@COLEGIO.EDU.CO ", type: "school", industry: "education", nit: "123", verificationDigit: "4", tags: [" colegios ", "colegios"], lists: [" onboarding "] };
  const payload = buildLogtoOrganizationCreatePayload({ canonical, extended, crm });
  assert.equal(payload.name, "Colegio Civitas");
  assert.equal(payload.description, "Desc");
  assert.equal(payload.customData.provisioning.slug, "colegio-civitas");
  assert.equal(payload.customData.civitasProfile.business.nit, 123);
  assert.equal(payload.customData.civitasProfile.contact.email, "info@colegio.edu.co");
  assert.deepEqual(payload.customData.civitasProfile.downstream.crm.tags, ["colegios"]);
  assert.ok(FORM_FIELD_INVENTORY["baseAdmin.position"].includes("logto.user.customData.civitasProfile.position"));
});

test("user payload keeps OIDC profile standard and business data in customData", () => {
  const payload = buildLogtoUserCreatePayload({ firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", email: " ADA@EXAMPLE.COM ", phone: "+571234567890", username: "ada", position: "Rectora", phoneExtension: "123" });
  assert.equal(payload.primaryEmail, "ada@example.com");
  assert.equal(payload.name, "Ada Lovelace");
  assert.deepEqual(payload.profile, { givenName: "Ada", familyName: "Lovelace", preferredUsername: "ada" });
  assert.equal(payload.customData.civitasProfile.position, "Rectora");
  assert.equal(payload.customData.civitasProfile.phoneExtension, "123");
  assert.equal(payload.profile.position, undefined);
});

test("FluentCRM builders produce retryable clean snapshots for company and contacts", () => {
  const company = buildFluentCrmCompanyPayloadFromForm({ form: { crm: { companyName: "Acme", numberOfEmployees: "25", tags: ["org"], lists: ["main"] } }, canonical: { name: "Fallback", baseAdmin: { name: "Owner" } }, extended: { adminDomain: "acme.edu" } });
  assert.equal(company.companyName, "Acme");
  assert.equal(company.numberOfEmployees, 25);
  const contact = buildFluentCrmContactPayloadFromAssignment({ assignment: { logtoUserId: "u1", email: "a@b.co", name: "A B", phoneExtension: "9", roleName: "Admin-org" }, companyId: "10", organizationLists: ["main"], organizationTags: ["org"] });
  assert.equal(contact.identity.phoneExtension, "9");
  assert.deepEqual(contact.roleNames, ["Admin-org"]);
  assert.deepEqual(contact.extraLists, ["main"]);
});
