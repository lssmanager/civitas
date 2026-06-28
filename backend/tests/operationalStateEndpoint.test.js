const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("owner operational-state endpoint is wired through the dedicated assembler without replacing legacy endpoints", () => {
  const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");
  assert.match(source, /require\("\.\/services\/operationalStateAssembler"\)/);
  assert.match(source, /app\.get\("\/owner\/organizations\/:organizationId\/operational-state", requireAuth\(API_RESOURCE\), requireOwner/);
  assert.match(source, /buildConsolidatedOperationalResponse\(\{/);
  assert.doesNotMatch(source, /getWorkerHealthSnapshot\(\)\.catch/);
  assert.match(source, /const workerHealth = getWorkerHealthSnapshot\(\);/);
  assert.match(source, /if \(error\?\.status === 404\) return null;/);
  assert.match(source, /__operationalFetchState: "unavailable"/);
  assert.match(source, /loadWorkerQueuesObservability/);
  assert.match(source, /app\.get\("\/owner\/system\/worker-queues", requireAuth\(API_RESOURCE\), requireOwner/);
  assert.match(source, /app\.get\("\/owner\/organizations\/:organizationId\/profile"/);
  assert.match(source, /app\.get\("\/owner\/organizations\/:organizationId\/pending-sync"/);
  assert.match(source, /app\.get\("\/owner\/organizations\/:organizationId\/events"/);
});
