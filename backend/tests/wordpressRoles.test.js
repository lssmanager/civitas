const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getEffectiveWordPressRoleMapping,
  getWordPressRolesConfig,
  getWordPressMappingDatabaseErrorDiagnostic,
  listWordPressRoles,
  loadWordPressRoleMappingReadModel,
  normalizeWordPressRolesResponse,
  upsertWordPressRoleMappings,
} = require("../services/wordpressRoles");


function restoreWordPressEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const logtoRoles = [
  { id: "role-admin", name: "Admin-org" },
  { id: "role-student", name: "Student-org" },
  { id: "role-new", name: "New Role" },
  { id: "owner", name: "owner_global" },
];

function makeResponse({ ok = true, status = 200, body }) {
  return { ok, status, text: async () => JSON.stringify(body), headers: { get: () => "application/json" } };
}

test("normalizes explicit WordPress roles catalog response", () => {
  const roles = normalizeWordPressRolesResponse({ roles: [{ slug: "subscriber", name: "Subscriber" }, { key: "teacher", label: "Teacher" }] });
  assert.deepEqual(roles.map((role) => role.slug), ["subscriber", "teacher"]);
});

test("lists WordPress roles from explicit WordPress integration endpoint", async () => {
  const calls = [];
  const roles = await listWordPressRoles({
    config: { baseUrl: "https://wp.example", username: "owner", appPassword: "secret", rolesPath: "/wp-json/civitas/v1/roles", timeoutMs: 1000 },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return makeResponse({ body: { roles: [{ slug: "subscriber", name: "Subscriber" }] } }); },
  });
  assert.equal(calls[0].url, "https://wp.example/wp-json/civitas/v1/roles");
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.deepEqual(roles, [{ slug: "subscriber", name: "Subscriber", description: "", source: "wordpress" }]);
});

test("WordPress role mapping is keyed by Logto role id and excludes owner_global", async () => {
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-student", organizationRoleName: "Student-org", wordpressRoleSlug: "subscriber", wordpressRoleName: "Subscriber", isActive: true, source: "gui_override" }] }) };
  const result = await getEffectiveWordPressRoleMapping({ database, logtoRoles });
  assert.equal(result.mapping["role-student"].wordpressRoleSlug, "subscriber");
  assert.equal(result.mapping["role-new"].source, "unmapped");
  assert.equal(result.mapping.owner, undefined);
});

test("WordPress role mapping read model tolerates catalog failures with warning", async () => {
  const database = { select: () => ({ from: async () => [] }) };
  const response = await loadWordPressRoleMappingReadModel({ database, listRoles: async () => logtoRoles, listWpRoles: async () => { throw new Error("missing civitas roles endpoint"); }, logger: { warn: () => {}, error: () => {} } });
  assert.equal(response.wordpressRoles.length, 0);
  assert.match(response.warnings.join("\n"), /missing civitas roles endpoint/);
  assert.match(response.note, /Logto remains canonical/);
});

test("upsert WordPress role mappings writes operational rows only for mappable Logto roles", async () => {
  const inserted = [];
  const database = {
    insert: () => ({ values: (row) => ({ onConflictDoUpdate: async () => inserted.push(row) }) }),
  };
  const rows = await upsertWordPressRoleMappings({
    database,
    wordpressRoles: [{ slug: "subscriber", name: "Subscriber" }],
    mappings: [
      { logtoRoleId: "role-student", organizationRoleName: "Student-org", wordpressRoleSlug: "subscriber" },
      { logtoRoleId: "owner", organizationRoleName: "owner_global", wordpressRoleSlug: "administrator" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(inserted[0].wordpressRoleName, "Subscriber");
  assert.equal(inserted[0].logtoRoleId, "role-student");
});


test("WordPress roles endpoint reports empty catalog as operational error", async () => {
  await assert.rejects(
    listWordPressRoles({
      config: { baseUrl: "https://wp.example", username: "owner", appPassword: "secret", rolesPath: "/wp-json/civitas/v1/roles", timeoutMs: 1000 },
      fetchImpl: async () => makeResponse({ body: { roles: [] } }),
    }),
    (error) => {
      assert.equal(error.code, "WORDPRESS_ROLES_EMPTY");
      return true;
    }
  );
});

test("WordPress roles endpoint reports authentication failure precisely", async () => {
  await assert.rejects(
    listWordPressRoles({
      config: { baseUrl: "https://wp.example", username: "owner", appPassword: "bad", rolesPath: "/wp-json/civitas/v1/roles", timeoutMs: 1000 },
      fetchImpl: async () => makeResponse({ ok: false, status: 401, body: { code: "rest_not_logged_in" } }),
    }),
    (error) => {
      assert.equal(error.code, "WORDPRESS_AUTHENTICATION_FAILED");
      return true;
    }
  );
});

test("WordPress roles endpoint timeout is controlled", async () => {
  await assert.rejects(
    listWordPressRoles({
      config: { baseUrl: "https://wp.example", username: "owner", appPassword: "secret", rolesPath: "/wp-json/civitas/v1/roles", timeoutMs: 10 },
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    }),
    (error) => {
      assert.equal(error.code, "WORDPRESS_ROLES_TIMEOUT");
      return true;
    }
  );
});


test("WordPress config reports invalid base URL precisely", () => {
  const previous = { WORDPRESS_BASE_URL: process.env.WORDPRESS_BASE_URL, WORDPRESS_USERNAME: process.env.WORDPRESS_USERNAME, WORDPRESS_APP_PASSWORD: process.env.WORDPRESS_APP_PASSWORD };
  process.env.WORDPRESS_BASE_URL = "not a url";
  process.env.WORDPRESS_USERNAME = "owner@example.com";
  process.env.WORDPRESS_APP_PASSWORD = "secret";
  assert.throws(() => getWordPressRolesConfig(), (error) => {
    assert.equal(error.code, "WORDPRESS_CONFIG_INVALID");
    assert.match(error.diagnostic, /absolute URL/);
    return true;
  });
  restoreWordPressEnv(previous);
});

test("WordPress config detects swapped base URL and username", () => {
  const previous = { WORDPRESS_BASE_URL: process.env.WORDPRESS_BASE_URL, WORDPRESS_USERNAME: process.env.WORDPRESS_USERNAME, WORDPRESS_APP_PASSWORD: process.env.WORDPRESS_APP_PASSWORD };
  process.env.WORDPRESS_BASE_URL = "johansebastian.rueda@icloud.com";
  process.env.WORDPRESS_USERNAME = "www.learnsocialstudies.com";
  process.env.WORDPRESS_APP_PASSWORD = "secret";
  assert.throws(() => getWordPressRolesConfig(), (error) => {
    assert.equal(error.code, "WORDPRESS_CONFIG_SWAPPED");
    assert.equal(error.body.expected.WORDPRESS_BASE_URL, "https://www.learnsocialstudies.com");
    return true;
  });
  restoreWordPressEnv(previous);
});

test("WordPress role mapping database diagnostic reports missing table", () => {
  const error = new Error('relation "wordpress_role_mappings" does not exist');
  error.code = "42P01";
  assert.match(getWordPressMappingDatabaseErrorDiagnostic(error), /wordpress_role_mappings is missing.*42P01/);
});
