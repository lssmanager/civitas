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
  assert.match(result.errors.find((error) => error.code === "ADMINISTRATIVE_CONTACT_DUPLICATE_EMAIL").message, /unique emails|repeated/i);
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

test("organization provisioning builds Logto username from subdomain and initials", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    subdomain: "colegiot",
    baseAdmin: { firstName: "Mario", lastName: "Báracus", email: "admin@school.edu", phone: "+573001112233", initialOrganizationRole: "Admin-org" },
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.value.baseAdmin.name, "Mario Báracus");
  assert.equal(result.value.baseAdmin.username, "colegiotmb");
  assert.equal(result.value.baseAdmin.phone, "+573001112233");
});

test("organization provisioning rejects invalid base admin phone", () => {
  const result = normalizeCanonicalProvisioningInput({
    ...basePayload,
    subdomain: "colegiot",
    baseAdmin: { firstName: "Mario", lastName: "Baracus", email: "admin@school.edu", phone: "123", initialOrganizationRole: "Admin-org" },
  });

  assert.equal(result.errors.some((error) => error.field === "baseAdmin.phone"), true);
});
