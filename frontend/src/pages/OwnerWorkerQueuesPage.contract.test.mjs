import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("./OwnerWorkerQueuesPage.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../api/owner.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../navigation/routes.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("./App/index.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useWorkerQueuesObservability.ts", import.meta.url), "utf8");

test("worker queues page is routed and visible under Observabilidad", () => {
  assert.match(routes, /ownerWorkerQueues/);
  assert.match(routes, /\/owner\/system\/worker-queues/);
  assert.match(routes, /children: \[appRoutes\.ownerLogs, appRoutes\.ownerSystem, appRoutes\.ownerWorkerQueues\]/);
  assert.match(app, /path="system\/worker-queues"/);
});

test("page consumes only the worker-queues aggregate endpoint", () => {
  assert.match(api, /getWorkerQueuesObservability:[\s\S]*\/owner\/system\/worker-queues/);
  assert.match(page, /ownerApi\.getWorkerQueuesObservability/);
  assert.doesNotMatch(page, /getOrganizationProfile|getOrganizationOperationalState|pending-sync/);
});

test("required operational sections render from aggregate shape", () => {
  for (const label of ["Readiness", "Heartbeat state", "Freshness", "Suggested action", "Colas", "Operaciones activas", "Organizaciones bloqueadas", "Timeline operacional corto"]) {
    assert.match(page, new RegExp(label));
  }
  for (const field of ["workerHealth", "queues", "activeOperations", "blockedOrganizations", "timeline"]) {
    assert.match(page, new RegExp(`data\\.${field}|${field}`));
  }
});

test("critical classifications are visually explicit", () => {
  for (const state of ["bullmq", "db_poll_fallback", "worker_offline", "worker_heartbeat_stale", "stuck_in_queue", "backlog_growing"]) {
    assert.match(page, new RegExp(state));
  }
});

test("actions use operational nextAction and availableActions", () => {
  assert.match(page, /nextAction/);
  assert.match(page, /availableActions/);
  assert.match(page, /retry/);
  assert.match(page, /verify_provider/);
  assert.match(page, /open_organization/);
  assert.match(page, /manual_retry_required/);
  assert.match(page, /human_action_required/);
});

test("refresh follows backend freshness instead of hard-coded page polling", () => {
  assert.match(hook, /shouldAutoRefresh/);
  assert.match(hook, /staleAfterSeconds/);
});
