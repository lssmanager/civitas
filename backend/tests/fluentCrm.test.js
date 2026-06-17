const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FluentCrmError,
  findCompanyCandidates,
  findReliableCompanyMatch,
  getFluentCrmConfig,
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
    numberOfEmployees: 42,
    industry: "Education",
    type: "School",
    companyOwner: "Owner",
    about: "About",
    description: "Description",
  });
});

test("buildOrganizationCrmTaxonomy is deterministic so tags/lists need not be stored locally", () => {
  const { buildOrganizationCrmTaxonomy } = require("../services/fluentCrm");
  assert.deepEqual(buildOrganizationCrmTaxonomy({ logtoOrganizationId: "org-1", slug: "school-one", name: "School One" }), {
    tag: { title: "Civitas Organization: School One", slug: "civitas-org-school-one" },
    list: { title: "Civitas School One", slug: "civitas-school-one" },
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
