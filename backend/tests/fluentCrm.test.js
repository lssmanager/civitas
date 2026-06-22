const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FluentCrmError,
  findCompanyCandidates,
  findReliableCompanyMatch,
  getFluentCrmConfig,
  getFluentCrmDiagnostic,
  getFluentCrmRoleSyncMapping,
  getOrCreateCompanyForOrganization,
  sanitizeForDiagnostics,
  searchCompanies,
} = require("../services/fluentCrm");
const { AUDIT_ACTIONS, AUDIT_RESULTS } = require("../services/auditLogs");

const ORIGINAL_ENV = { ...process.env };

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function configureFluentCrmEnv(overrides = {}) {
  process.env.FLUENTCRM_BASE_URL = "https://crm.example.com/";
  process.env.FLUENTCRM_USERNAME = "owner@example.com";
  process.env.FLUENTCRM_APP_PASSWORD = "app-password-secret";
  Object.assign(process.env, overrides);
}

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

test.afterEach(() => {
  resetEnv();
  delete global.fetch;
});

test("missing FluentCRM configuration returns a controlled error", () => {
  delete process.env.FLUENTCRM_BASE_URL;
  delete process.env.FLUENTCRM_USERNAME;
  delete process.env.FLUENTCRM_APP_PASSWORD;

  assert.throws(
    () => getFluentCrmConfig(),
    (error) => {
      assert.equal(error instanceof FluentCrmError, true);
      assert.equal(error.code, "FLUENTCRM_CONFIG_MISSING");
      assert.match(error.message, /FluentCRM is not configured/);
      assert.deepEqual(error.body.missing, ["FLUENTCRM_BASE_URL", "FLUENTCRM_USERNAME", "FLUENTCRM_APP_PASSWORD"]);
      return true;
    }
  );
});

test("invalid FluentCRM URL returns a controlled error", () => {
  configureFluentCrmEnv({ FLUENTCRM_BASE_URL: "not a url" });

  assert.throws(
    () => getFluentCrmConfig(),
    (error) => {
      assert.equal(error instanceof FluentCrmError, true);
      assert.equal(error.code, "FLUENTCRM_CONFIG_INVALID");
      assert.match(error.message, /valid absolute URL/);
      return true;
    }
  );
});

test("searchCompanies searches by companyId", async () => {
  configureFluentCrmEnv();
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return jsonResponse({ id: 123, name: "Colegio San José" });
  };

  const companies = await searchCompanies({ companyId: "123" });

  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, 123);
  assert.equal(new URL(requests[0].url).pathname, "/wp-json/fluent-crm/v2/companies/123");
  assert.match(requests[0].options.headers.Authorization, /^Basic /);
  assert.doesNotMatch(requests[0].options.headers.Authorization, /app-password-secret/);
});

test("findCompanyCandidates searches by domain, email, and normalized name", async () => {
  configureFluentCrmEnv();
  const searches = [];
  global.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    searches.push(requestUrl.searchParams.get("search"));
    return jsonResponse({ companies: [{ id: searches.length, name: requestUrl.searchParams.get("search") }] });
  };

  const candidates = await findCompanyCandidates({ adminDomain: "https://www.school.edu/path", contactEmail: "info@school.edu", name: "Colegio San José" });

  assert.deepEqual(searches, ["school.edu", "info@school.edu", "Colegio San José"]);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((candidate) => candidate.sources[0]), ["domain", "email", "name"]);
});

test("findReliableCompanyMatch returns a unique reliable match", () => {
  const result = findReliableCompanyMatch(
    { adminDomain: "school.edu", contactEmail: "info@school.edu", name: "Colegio San José" },
    [
      { company: { id: 1, website: "https://school.edu", email: "other@school.edu", name: "Other" } },
      { company: { id: 2, website: "https://other.edu", email: "other@other.edu", name: "Other" } },
    ]
  );

  assert.equal(result.status, "matched");
  assert.equal(result.reason, "domain");
  assert.equal(result.company.id, 1);
});

test("findReliableCompanyMatch reports conflicts for duplicate domains", () => {
  const result = findReliableCompanyMatch({ adminDomain: "school.edu" }, [
    { company: { id: 1, website: "https://school.edu" } },
    { company: { id: 2, website: "https://www.school.edu" } },
  ]);

  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "duplicate_domain");
  assert.equal(result.candidates.length, 2);
});

test("findReliableCompanyMatch reports conflicts for duplicate emails", () => {
  const result = findReliableCompanyMatch({ contactEmail: "info@school.edu" }, [
    { company: { id: 1, email: "info@school.edu" } },
    { company: { id: 2, email: "INFO@school.edu" } },
  ]);

  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "duplicate_email");
  assert.equal(result.candidates.length, 2);
});

test("findReliableCompanyMatch reports conflicts for duplicate normalized names", () => {
  const result = findReliableCompanyMatch({ name: "Colegio San José" }, [
    { company: { id: 1, name: "Colegio San Jose" } },
    { company: { id: 2, name: "colegio san josé" } },
  ]);

  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "duplicate_name");
  assert.equal(result.candidates.length, 2);
});

test("getOrCreateCompanyForOrganization creates a Company when no reliable match exists and persists pending/linked with success audit", async () => {
  configureFluentCrmEnv();
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (options.method === "POST") return jsonResponse({ id: 77, name: "Colegio Nuevo" }, 201);
    return jsonResponse({ companies: [] });
  };
  const stateEvents = [];
  const auditEvents = [];

  const result = await getOrCreateCompanyForOrganization(
    { id: "profile-1", logtoOrganizationId: "org-1", fluentcrmCompanyId: null, nameCache: "Colegio Nuevo", adminDomain: "nuevo.edu" },
    {},
    { actorUserId: "user-1", markSync: async (event) => stateEvents.push(event), audit: async (event) => auditEvents.push(event) }
  );

  assert.equal(result.status, "created");
  assert.equal(result.company.id, 77);
  assert.deepEqual(stateEvents.map((event) => event.status), ["pending", "linked"]);
  assert.equal(stateEvents[1].companyId, "77");
  assert.equal(stateEvents[1].synced, true);
  assert.equal(auditEvents[0].action, AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC);
  assert.equal(auditEvents[0].result, AUDIT_RESULTS.SUCCESS);
  const postPayload = JSON.parse(requests.find((request) => request.options.method === "POST").options.body);
  assert.deepEqual(postPayload, { name: "Colegio Nuevo", website: "nuevo.edu" });
  assert.equal(Object.hasOwn(postPayload, "email"), false);
});

test("getOrCreateCompanyForOrganization persists conflict and emits conflict audit", async () => {
  configureFluentCrmEnv();
  global.fetch = async () => jsonResponse({ companies: [{ id: 1, website: "school.edu" }, { id: 2, website: "https://www.school.edu" }] });
  const stateEvents = [];
  const auditEvents = [];

  const result = await getOrCreateCompanyForOrganization(
    { id: "profile-1", logtoOrganizationId: "org-1", fluentcrmCompanyId: null, adminDomain: "school.edu" },
    {},
    { markSync: async (event) => stateEvents.push(event), audit: async (event) => auditEvents.push(event) }
  );

  assert.equal(result.status, "conflict");
  assert.deepEqual(stateEvents.map((event) => event.status), ["pending", "conflict"]);
  assert.match(stateEvents[1].errorMessage, /Ambiguous FluentCRM company match/);
  assert.equal(auditEvents[0].action, AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_CONFLICT);
  assert.equal(auditEvents[0].result, AUDIT_RESULTS.ERROR);
});

test("getOrCreateCompanyForOrganization persists error and emits error audit", async () => {
  configureFluentCrmEnv();
  global.fetch = async () => jsonResponse({ error: "boom" }, 500);
  const stateEvents = [];
  const auditEvents = [];

  await assert.rejects(
    getOrCreateCompanyForOrganization(
      { id: "profile-1", logtoOrganizationId: "org-1", fluentcrmCompanyId: null, nameCache: "Colegio Error" },
      {},
      { markSync: async (event) => stateEvents.push(event), audit: async (event) => auditEvents.push(event) }
    ),
    /FluentCRM request failed/
  );

  assert.deepEqual(stateEvents.map((event) => event.status), ["pending", "error"]);
  assert.equal(auditEvents[0].action, AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR);
  assert.equal(auditEvents[0].result, AUDIT_RESULTS.ERROR);
});

test("sanitizeForDiagnostics redacts secrets recursively", () => {
  const sanitized = sanitizeForDiagnostics({ Authorization: "Basic secret", nested: { appPassword: "secret", safe: "ok" }, token: "abc" });

  assert.deepEqual(sanitized, { Authorization: "[Redacted]", nested: { appPassword: "[Redacted]", safe: "ok" }, token: "[Redacted]" });
});

test("normalizeCrmCompanyInput maps minimal FluentCRM company fields without identity canon changes", () => {
  const { normalizeCrmCompanyInput } = require("../services/fluentCrm");
  const normalized = normalizeCrmCompanyInput({ companyName: " School ", companyEmail: "INFO@SCHOOL.EDU ", companyPhone: " +1555 ", website: "https://school.edu", numberOfEmployees: "42", industry: "Education", type: "School", companyOwner: "Owner", about: "About", description: "Description" }, { name: "Fallback" });

  assert.deepEqual(normalized, {
    companyName: "School",
    companyEmail: "info@school.edu",
    companyPhone: "+1555",
    website: "https://school.edu",
    address: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    numberOfEmployees: 42,
    industry: "Education",
    type: "School",
    companyOwner: "Owner",
    about: "About",
    description: "Description",
    nit: null,
    verificationDigit: null,
    tags: [],
    lists: [],
  });
});

test("buildOrganizationCrmTaxonomy is deterministic so tags/lists need not be stored locally", () => {
  const { buildOrganizationCrmTaxonomy } = require("../services/fluentCrm");
  assert.deepEqual(buildOrganizationCrmTaxonomy({ logtoOrganizationId: "org-1", slug: "school-one", name: "School One" }), {
    tag: { title: "School One", slug: "school-one" },
    list: { title: "School One", slug: "school-one" },
  });
});

test("updateContactEmailAfterLogtoChange updates email and writes previous email only when configured", async () => {
  const { updateContactEmailAfterLogtoChange } = require("../services/fluentCrm");
  configureFluentCrmEnv({ FLUENTCRM_PREVIOUS_EMAIL_FIELD_KEY: "previous_email" });
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/subscribers?") || String(url).endsWith("/subscribers?search=user-1&per_page=20")) return jsonResponse({ subscribers: [{ id: 9, email: "old@school.edu" }] });
    if (String(url).endsWith("/subscribers/9")) return jsonResponse({ id: 9, email: "new@school.edu" });
    return jsonResponse({ subscribers: [{ id: 9, email: "old@school.edu" }] });
  };

  const result = await updateContactEmailAfterLogtoChange({ previousEmail: "old@school.edu", newEmail: "new@school.edu", logtoUserId: "user-1", logtoOrganizationId: "org-1", profile: { name: "User One", phone: "+1555" } });

  assert.equal(result.status, "updated");
  const updateRequest = requests.find((request) => request.options.method === "PUT");
  assert.equal(new URL(updateRequest.url).pathname, "/wp-json/fluent-crm/v2/subscribers/9");
  assert.deepEqual(JSON.parse(updateRequest.options.body), { email: "new@school.edu", full_name: "User One", phone: "+1555", custom_values: { previous_email: "old@school.edu" } });
});

test("mapOrganizationRolesToCrmTaxonomy maps configured org roles and excludes owner_global", () => {
  const { mapOrganizationRolesToCrmTaxonomy } = require("../services/fluentCrm");
  const taxonomy = mapOrganizationRolesToCrmTaxonomy(["Admin-org", "Teacher-org", "owner_global", "unknown-role"]);

  assert.deepEqual(taxonomy.tags.sort(), ["civitas-role-admin-org", "civitas-role-teacher-org"].sort());
  assert.deepEqual(taxonomy.lists.sort(), ["Civitas Admins", "Civitas Teachers"].sort());
  assert.deepEqual(taxonomy.excludedRoles, ["owner_global"]);
  assert.deepEqual(taxonomy.unmappedRoles, ["unknown-role"]);
});


test("getFluentCrmRoleSyncMapping rejects duplicated env key prefix", () => {
  const { getFluentCrmRoleSyncMapping } = require("../services/fluentCrm");
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = 'FLUENTCRM_ROLE_SYNC_MAPPING_JSON={"Custom-role":{"tags":["custom-tag"],"lists":[]}}';
  const mapping = getFluentCrmRoleSyncMapping();
  assert.equal(mapping["Custom-role"], undefined);
  assert.deepEqual(mapping["Admin-org"].tags, ["civitas-role-admin-org"]);
  delete process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
});

test("getFluentCrmRoleSyncMapping falls back to defaults when env JSON is malformed", () => {
  const { getFluentCrmRoleSyncMapping } = require("../services/fluentCrm");
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = "not-json";
  const mapping = getFluentCrmRoleSyncMapping();
  assert.deepEqual(mapping["Admin-org"].tags, ["civitas-role-admin-org"]);
  assert.equal(Object.hasOwn(mapping, "owner_global"), false);
  delete process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
});

test("syncOrganizationContactsToFluentCrm returns organization-level error when company is not linked", async () => {
  const { syncOrganizationContactsToFluentCrm } = require("../services/fluentCrm");
  const persisted = [];
  const audits = [];
  const summary = await syncOrganizationContactsToFluentCrm({
    profile: { id: "profile-1", fluentcrmCompanyId: null },
    members: [{ id: "user-1", primaryEmail: "user@school.edu" }],
    getMemberRoles: async () => ["Student-org"],
    markOrganizationSync: async (event) => persisted.push(event),
    audit: async (event) => audits.push(event),
  });

  assert.equal(summary.status, "error");
  assert.equal(summary.reason, "company_not_linked");
  assert.deepEqual(persisted, [summary]);
  assert.equal(audits[0].result, "error");
});

test("syncOrganizationContactsToFluentCrm handles missing email and duplicate contacts as partial errors", async () => {
  const { syncOrganizationContactsToFluentCrm } = require("../services/fluentCrm");
  configureFluentCrmEnv();
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("duplicate%40school.edu")) return jsonResponse({ subscribers: [{ id: 1, email: "duplicate@school.edu" }, { id: 2, email: "DUPLICATE@school.edu" }] });
    if (String(url).includes("ok%40school.edu")) return jsonResponse({ subscribers: [] });
    if (String(url).endsWith("/wp-json/fluent-crm/v2/subscribers") && options.method === "POST") return jsonResponse({ id: 3, email: "ok@school.edu" }, 201);
    return jsonResponse({ subscribers: [] });
  };
  const audits = [];
  const summary = await syncOrganizationContactsToFluentCrm({
    profile: { id: "profile-1", fluentcrmCompanyId: "company-1" },
    members: [
      { id: "missing-email" },
      { id: "duplicate", primaryEmail: "duplicate@school.edu" },
      { id: "ok", primaryEmail: "ok@school.edu", name: "Ok User" },
    ],
    getMemberRoles: async () => ["Student-org", "owner_global"],
    audit: async (event) => audits.push(event),
  });

  assert.equal(summary.status, "conflict");
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.conflicts, 1);
  assert.ok(summary.errors.some((error) => error.reason === "missing_email"));
  assert.ok(summary.errors.some((error) => error.reason === "duplicate_contact"));
  assert.equal(audits.filter((event) => event.result === "success").length, 1);
  assert.equal(audits.filter((event) => event.result === "error").length, 2);
});

test("cleanupContactInFluentCrm returns no_contact_found without claiming deletion", async () => {
  const { cleanupContactInFluentCrm } = require("../services/fluentCrm");
  configureFluentCrmEnv();
  global.fetch = async () => jsonResponse({ subscribers: [] });

  const result = await cleanupContactInFluentCrm({
    identity: { logtoUserId: "user-1", email: "missing@school.edu" },
    profile: { logtoOrganizationId: "org-1", fluentcrmCompanyId: "company-1", slug: "school", nameCache: "School" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.strategy, "no_contact_found");
  assert.match(result.message, /No FluentCRM contact/);
});

test("cleanupContactInFluentCrm refuses duplicate FluentCRM contacts", async () => {
  const { cleanupContactInFluentCrm } = require("../services/fluentCrm");
  configureFluentCrmEnv();
  global.fetch = async () => jsonResponse({ subscribers: [{ id: 1, email: "duplicate@school.edu" }, { id: 2, email: "DUPLICATE@school.edu" }] });

  const result = await cleanupContactInFluentCrm({
    identity: { logtoUserId: "user-1", email: "duplicate@school.edu" },
    profile: { logtoOrganizationId: "org-1", fluentcrmCompanyId: "company-1" },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.strategy, "duplicate_conflict");
  assert.equal(result.candidateCount, 2);
});

test("cleanupContactInFluentCrm conservatively dissociates organization data and keeps other tags/lists", async () => {
  const { cleanupContactInFluentCrm } = require("../services/fluentCrm");
  configureFluentCrmEnv();
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (options.method === "PUT") return jsonResponse({ id: 9, status: "unsubscribed" });
    return jsonResponse({ subscribers: [{ id: 9, email: "student@school.edu", company_id: "company-1", tags: [{ title: "Civitas Organization: School" }, { title: "Other Org" }, { title: "civitas-role-student-org" }], lists: [{ title: "Civitas School" }, { title: "Global Newsletter" }] }] });
  };

  const result = await cleanupContactInFluentCrm({
    identity: { logtoUserId: "user-1", email: "student@school.edu" },
    profile: { logtoOrganizationId: "org-1", fluentcrmCompanyId: "company-1", slug: "school", nameCache: "School" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.strategy, "dissociate_only");
  const payload = JSON.parse(requests.find((request) => request.options.method === "PUT").options.body);
  assert.deepEqual(payload, { company_id: null, tags: ["Other Org", "civitas-role-student-org"], lists: ["Global Newsletter"], status: "unsubscribed" });
  assert.match(result.message, /not claimed as deleted/);
});

test("cleanupContactInFluentCrm does not hard delete multi-organization users", async () => {
  const { cleanupContactInFluentCrm } = require("../services/fluentCrm");
  configureFluentCrmEnv({ FLUENTCRM_CONTACT_CLEANUP_STRATEGY: "hard_delete" });
  const methods = [];
  global.fetch = async (url, options = {}) => {
    methods.push(options.method || "GET");
    if (options.method === "PUT") return jsonResponse({ id: 9 });
    return jsonResponse({ subscribers: [{ id: 9, email: "shared@school.edu", company_id: "company-1", tags: [], lists: [] }] });
  };

  const result = await cleanupContactInFluentCrm({
    identity: { logtoUserId: "user-1", email: "shared@school.edu" },
    profile: { logtoOrganizationId: "org-1", fluentcrmCompanyId: "company-1" },
    remainingOrganizationIds: ["org-2"],
  });

  assert.equal(result.strategy, "dissociate_only");
  assert.equal(methods.includes("DELETE"), false);
});

test("cleanupContactInFluentCrm supports explicit hard delete when not shared", async () => {
  const { cleanupContactInFluentCrm } = require("../services/fluentCrm");
  configureFluentCrmEnv({ FLUENTCRM_CONTACT_CLEANUP_STRATEGY: "hard_delete" });
  const methods = [];
  global.fetch = async (url, options = {}) => {
    methods.push(options.method || "GET");
    if (options.method === "DELETE") return jsonResponse({ deleted: true });
    return jsonResponse({ subscribers: [{ id: 9, email: "single@school.edu", company_id: "company-1" }] });
  };

  const result = await cleanupContactInFluentCrm({
    identity: { logtoUserId: "user-1", email: "single@school.edu" },
    profile: { logtoOrganizationId: "org-1", fluentcrmCompanyId: "company-1" },
  });

  assert.equal(result.strategy, "hard_delete");
  assert.equal(methods.includes("DELETE"), true);
});

test("searchContacts revalidates exact normalized email and ignores broad search false positives", async () => {
  const { searchContacts } = require("../services/fluentCrm");
  configureFluentCrmEnv();
  global.fetch = async () => jsonResponse({ subscribers: [{ id: 1, email: "other@school.edu" }, { id: 2, email: "USER@SCHOOL.EDU" }] });
  const contacts = await searchContacts({ email: " user@school.edu " });
  assert.deepEqual(contacts.map((contact) => contact.id), [2]);
});

test("searchContacts prioritizes exact external_id before falling back to email", async () => {
  const { searchContacts } = require("../services/fluentCrm");
  configureFluentCrmEnv();
  const searches = [];
  global.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    searches.push(requestUrl.searchParams.get("search"));
    if (searches.length === 1) return jsonResponse({ subscribers: [{ id: 9, external_id: "user-1", email: "wrong@school.edu" }, { id: 10, external_id: "other", email: "user@school.edu" }] });
    return jsonResponse({ subscribers: [{ id: 10, email: "user@school.edu" }] });
  };
  const contacts = await searchContacts({ email: "user@school.edu", externalId: "user-1" });
  assert.deepEqual(searches, ["user-1"]);
  assert.deepEqual(contacts.map((contact) => contact.id), [9]);
});

test("FluentCRM timeout aborts remote requests with controlled diagnostic", async () => {
  const { searchCompanies } = require("../services/fluentCrm");
  configureFluentCrmEnv({ FLUENTCRM_TIMEOUT_MS: "5" });
  global.fetch = async (_url, options = {}) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(searchCompanies({ search: "slow" }), (error) => {
    assert.equal(error.code, "FLUENTCRM_TIMEOUT");
    assert.equal(error.status, 504);
    assert.equal(error.diagnostic.timeoutMs, 5);
    return true;
  });
});

test("FluentCRM 401 reports authentication diagnostic instead of generic request failure", async () => {
  const { searchCompanies } = require("../services/fluentCrm");
  configureFluentCrmEnv();
  global.fetch = async () => jsonResponse({ code: "rest_not_logged_in", message: "You are not logged in" }, 401);
  await assert.rejects(searchCompanies({ search: "school" }), (error) => {
    assert.equal(error.code, "FLUENTCRM_AUTHENTICATION_FAILED");
    assert.match(error.message, /authentication failed \(401\)/i);
    assert.ok(error.diagnostic.likelyCauses.includes("invalid_application_password"));
    return true;
  });
});

test("normalizeCrmCompanyInput accepts owner tax fields for FluentCRM companies", () => {
  const { normalizeCrmCompanyInput } = require("../services/fluentCrm");
  const normalized = normalizeCrmCompanyInput({
    companyName: "Colegio San Jose",
    nit: "900123456",
    verificationDigit: "7",
    address: " Calle 123 ",
    tags: ["Admin-org", "Admin-org", ""],
    lists: ["Colegio San Jose", "Colegio San Jose"],
  });

  assert.equal(normalized.nit, 900123456);
  assert.equal(normalized.verificationDigit, 7);
  assert.equal(normalized.address, "Calle 123");
  assert.deepEqual(normalized.tags, ["Admin-org"]);
  assert.deepEqual(normalized.lists, ["Colegio San Jose"]);
});

test("normalizeCrmCompanyInput builds legacy address from structured owner address fields", () => {
  const { normalizeCrmCompanyInput, buildFluentCrmCompanyPayload } = require("../services/fluentCrm");
  const normalized = normalizeCrmCompanyInput({ addressLine1: " Calle 1 ", addressLine2: " Piso 2 ", city: " Bogotá ", state: " Cundinamarca ", postalCode: "110111", country: "Colombia" }, { name: "Colegio" });

  const payload = buildFluentCrmCompanyPayload(normalized);

  assert.equal(normalized.address, "Calle 1, Piso 2, Bogotá, Cundinamarca, 110111, Colombia");
  assert.equal(payload.address, "Calle 1, Piso 2, Bogotá, Cundinamarca, 110111, Colombia");
  assert.equal(payload.address_line_1, "Calle 1");
  assert.equal(payload.address_line_2, "Piso 2");
  assert.equal(payload.city, "Bogotá");
  assert.equal(payload.state, "Cundinamarca");
  assert.equal(payload.postal_code, "110111");
  assert.equal(payload.country, "Colombia");
  assert.deepEqual(payload.custom_values, {
    address_line_1: "Calle 1",
    address_line_2: "Piso 2",
    city: "Bogotá",
    state: "Cundinamarca",
    postal_code: "110111",
    country: "Colombia",
  });
});

test("buildFluentCrmCompanyPayload maps NIT and verification digit to custom values", () => {
  const { buildFluentCrmCompanyPayload } = require("../services/fluentCrm");
  const payload = buildFluentCrmCompanyPayload({
    companyName: "Colegio San Jose",
    companyEmail: "contacto@colegio.edu.co",
    nit: 900123456,
    verificationDigit: 5,
    address: "Calle 123",
    addressLine1: "Calle 123",
    city: "Bogotá",
    state: "Cundinamarca",
    postalCode: "110111",
    country: "Colombia",
    numberOfEmployees: 42,
    tags: ["Admin-org"],
    lists: ["Colegio San Jose"],
  });

  assert.deepEqual(payload.custom_values, {
    nit: 900123456,
    "digito_de_verificación": 5,
    address_line_1: "Calle 123",
    city: "Bogotá",
    state: "Cundinamarca",
    postal_code: "110111",
    country: "Colombia",
    employees_number: 42,
  });
  assert.equal(payload.address, "Calle 123");
  assert.equal(payload.address_line_1, "Calle 123");
  assert.equal(payload.city, "Bogotá");
  assert.equal(payload.state, "Cundinamarca");
  assert.equal(payload.postal_code, "110111");
  assert.equal(payload.country, "Colombia");
  assert.equal(payload.employees_number, 42);
  assert.deepEqual(payload.tags, ["Admin-org"]);
  assert.deepEqual(payload.lists, ["Colegio San Jose"]);
});


test("buildFluentCrmCompanyPayload maps employees_number from Logto customData sources", () => {
  const { buildFluentCrmCompanyPayload, normalizeCrmCompanyInput } = require("../services/fluentCrm");
  const normalized = normalizeCrmCompanyInput({
    companyName: "Colegio Logto",
    civitasProfile: { business: { numberOfEmployees: "37" } },
    crm: { numberOfEmployees: "12" },
  });
  const payload = buildFluentCrmCompanyPayload({
    companyName: "Colegio Logto",
    civitasProfile: { business: { numberOfEmployees: "37" } },
  });

  assert.equal(normalized.numberOfEmployees, 37);
  assert.equal(payload.employees_number, 37);
  assert.deepEqual(payload.custom_values, { employees_number: 37 });
  assert.equal(payload.number_of_employees, undefined);
});


test("legacy FluentCRM role sync mapping rejects accidental KEY= prefix", () => {
  configureFluentCrmEnv({
    FLUENTCRM_ROLE_SYNC_MAPPING_JSON: 'FLUENTCRM_ROLE_SYNC_MAPPING_JSON={"Teacher-org":{"tags":["teacher-prefixed"],"lists":["Teachers"]}}',
  });

  const mapping = getFluentCrmRoleSyncMapping();

  assert.deepEqual(mapping["Teacher-org"].tags, ["civitas-role-teacher-org"]);
});

test("mapOrganizationRolesToCrmTaxonomy maps by logtoRoleId and treats inactive as unmapped", () => {
  const { mapOrganizationRolesToCrmTaxonomy } = require("../services/fluentCrm");
  const taxonomy = mapOrganizationRolesToCrmTaxonomy([
    { logtoRoleId: "role-student", organizationRoleName: "Renamed Student" },
    { logtoRoleId: "role-inactive", organizationRoleName: "Inactive" },
    { logtoRoleId: "role-owner", organizationRoleName: "owner_global" },
  ], {
    "role-student": { tags: ["student-by-id"], lists: ["Students"], roleType: "organizational", isActive: true },
    "role-inactive": { tags: ["inactive"], lists: ["Inactive"], roleType: "organizational", isActive: false },
  });

  assert.deepEqual(taxonomy.tags, ["student-by-id"]);
  assert.deepEqual(taxonomy.lists, ["Students"]);
  assert.deepEqual(taxonomy.unmappedRoles, ["role-inactive"]);
  assert.deepEqual(taxonomy.excludedRoles, ["owner_global"]);
});


test("FluentCRM 422 duplicate contact diagnostic preserves safe body and cause", () => {
  const diagnostic = getFluentCrmDiagnostic(
    { status: 422 },
    { message: "The given email already exists", errors: { email: ["subscriber already exists"] } },
    "/subscribers"
  );

  assert.equal(diagnostic.code, "FLUENTCRM_DUPLICATE_CONTACT");
  assert.deepEqual(diagnostic.likelyCauses, ["duplicate_email", "invalid_payload"]);
  assert.match(diagnostic.message, /email: subscriber already exists/);
  assert.equal(diagnostic.validationTarget, "contacto/subscriber");
  assert.equal(diagnostic.fieldErrors.email[0], "subscriber already exists");
  assert.equal(diagnostic.fluentCrmError.errors.email[0], "subscriber already exists");
});

test("FluentCRM 422 invalid company/tag/list diagnostic is classified", () => {
  const diagnostic = getFluentCrmDiagnostic(
    { status: 422 },
    { message: "company_id is invalid and tags/lists contain unknown values" },
    "/subscribers"
  );

  assert.equal(diagnostic.code, "FLUENTCRM_VALIDATION_FAILED");
  assert.deepEqual(diagnostic.likelyCauses.sort(), ["invalid_company_id", "invalid_list", "invalid_payload", "invalid_tag"].sort());
  assert.match(diagnostic.message, /company_id is invalid and tags\/lists contain unknown values/);
  assert.equal(diagnostic.validationDetail, "company_id is invalid and tags/lists contain unknown values");
});
