const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeCanonicalProvisioningInput } = require("../services/organizationProvisioningCore");

const basePayload = {
  name: "Colegio Demo",
  baseAdmin: { name: "Admin Demo", email: "admin@school.edu", initialOrganizationRole: "Admin-org" },
  jitProvisioning: { domain: "school.edu", defaultRoleNames: ["Student-org"] },
};

test("organization provisioning rejects duplicate administrative contact emails before FluentCRM", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    administrativeContacts: [
      { kind: "director", name: "Director Uno", email: "director@school.edu", organizationRoleName: "Admin-org" },
      { kind: "responsible1", name: "Director Uno", email: "DIRECTOR@school.edu", organizationRoleName: "Admin-org" },
    ],
  });

  assert.equal(result.errors.some((error) => error.code === "ADMINISTRATIVE_CONTACT_DUPLICATE_EMAIL"), true);
  assert.match(
    result.errors.find((error) => error.code === "ADMINISTRATIVE_CONTACT_DUPLICATE_EMAIL").message,
    /unique emails|repeated/i
  );
});

test("organization provisioning explains duplicate administrative email with different name", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    administrativeContacts: [
      { kind: "director", name: "Director Uno", email: "director@school.edu", organizationRoleName: "Admin-org" },
      { kind: "responsible1", name: "Director Dos", email: "director@school.edu", organizationRoleName: "Admin-org" },
    ],
  });

  const duplicate = result.errors.find((error) => error.code === "ADMINISTRATIVE_CONTACT_DUPLICATE_EMAIL");
  assert.ok(duplicate);
  assert.deepEqual(duplicate.differingFields, ["name"]);
  assert.match(duplicate.message, /different name/);
});

test("organization provisioning explains duplicate administrative email with different role", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    administrativeContacts: [
      { kind: "director", name: "Director Uno", email: "director@school.edu", organizationRoleName: "Admin-org" },
      { kind: "responsible1", name: "Director Uno", email: "director@school.edu", organizationRoleName: "Teacher-org" },
    ],
  });

  const duplicate = result.errors.find((error) => error.code === "ADMINISTRATIVE_CONTACT_DUPLICATE_EMAIL");
  assert.ok(duplicate);
  assert.deepEqual(duplicate.differingFields, ["organizationRoleName"]);
  assert.match(duplicate.message, /different organizationRoleName/);
});

test("organization provisioning ignores legacy base admin during organization creation", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    subdomain: "colegiot",
    baseAdmin: { firstName: "Mario", lastName: "Báracus", email: "j.doe@school.edu", phone: "+573001112233", initialOrganizationRole: "Admin-org" },
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.value.baseAdmin, null);
});

test("organization provisioning builds administrative contact name from first and last names", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    baseAdmin: { firstName: "Admin", lastName: "Demo", email: "admin@school.edu", initialOrganizationRole: "Admin-org" },
    administrativeContacts: [
      { kind: "director", firstName: "Ana", middleName: "María", firstSurname: "Pérez", secondSurname: "Gómez", email: "ana@school.edu", organizationRoleName: "Admin-org" },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.value.administrativeContacts[0].name, "Ana María Pérez Gómez");
  assert.equal(result.value.administrativeContacts[0].firstName, "Ana");
  assert.equal(result.value.administrativeContacts[0].middleName, "María");
  assert.equal(result.value.administrativeContacts[0].firstSurname, "Pérez");
  assert.equal(result.value.administrativeContacts[0].secondSurname, "Gómez");
  assert.equal(result.value.administrativeContacts[0].username, "ana");
});

test("organization provisioning does not validate legacy base admin role or phone", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    baseAdmin: { firstName: "Admin", lastName: "Demo", email: "admin@school.edu", phone: "123", initialOrganizationRole: "Headmaster-org" },
  });

  assert.equal(result.errors.some((error) => error.field?.startsWith("baseAdmin.")), false);
  assert.equal(result.value.baseAdmin, null);
});

const { normalizeExtendedProvisioningInput } = require("../services/organizationProvisioningSettings");

test("extended provisioning builds entry and redirect URL from appSubdomain and appBaseDomain", () => {
  const result = normalizeExtendedProvisioningInput({ name: "FLACSO Ecuador", appSubdomain: "flacso", appBaseDomain: "didaxus.com", adminDomain: "flacso.edu.ec" });
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.entryUrl, "https://flacso.didaxus.com");
  assert.equal(result.value.oidcRedirectUri, "https://flacso.didaxus.com/callback");
  assert.equal(result.value.slug, null);
});

test("extended provisioning rejects full URLs and unsupported base domains for app entry", () => {
  const result = normalizeExtendedProvisioningInput({ appSubdomain: "https://flacso.didaxus.com", appBaseDomain: "example.com", adminDomain: "flacso.edu.ec" });
  assert.equal(result.errors.some((error) => error.field === "subdomain"), true);
  assert.equal(result.errors.some((error) => error.field === "appBaseDomain"), true);
});
