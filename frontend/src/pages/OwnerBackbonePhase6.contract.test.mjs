import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const owner = readFileSync(new URL("./OwnerPage/index.tsx", import.meta.url), "utf8");
const selector = readFileSync(new URL("./SelectOrganizationPage/index.tsx", import.meta.url), "utf8");
const logs = readFileSync(new URL("./OwnerAuditPage/index.tsx", import.meta.url), "utf8");
const backbone = readFileSync(new URL("../operational/backbone.ts", import.meta.url), "utf8");

test("/owner reads the worker-queues backbone instead of legacy operations summary", () => {
  assert.match(owner, /getWorkerQueuesObservability/);
  assert.doesNotMatch(owner, /getOperationsSummary/);
  assert.match(owner, /blockedOrganizations/);
  assert.match(owner, /activeOperations/);
  assert.match(owner, /nextAction/);
});

test("/select-organization uses operational-state for canonical, downstream, blocker and next action", () => {
  assert.match(selector, /getOrganizationOperationalState/);
  assert.match(selector, /compactOperationalState/);
  assert.match(selector, /Logto:/);
  assert.match(selector, /FluentCRM:/);
  assert.match(selector, /WordPress:/);
  assert.match(selector, /blocker:/);
  assert.match(selector, /compact\.nextAction/);
});

test("/owner/logs distinguishes live, worker, local and audit planes", () => {
  assert.match(logs, /getLogPlane/);
  assert.match(logs, /getVerificationLevel/);
  assert.match(backbone, /"live" \| "worker" \| "local" \| "audit"/);
  assert.match(backbone, /provider_verification\|live/);
  assert.match(backbone, /bullmq\|worker\|queue\|runtime/);
  assert.match(backbone, /local\|reconciled\|db_poll_fallback/);
});

test("badges and CTAs reuse operational fields from the shared backbone", () => {
  assert.match(backbone, /actionLabel/);
  assert.match(backbone, /sourceLabel/);
  assert.match(backbone, /dominantSource/);
  assert.match(backbone, /freshness/);
  assert.match(backbone, /providerStatus/);
  assert.match(owner + selector, /actionLabel\[String\([^\)]*nextAction/);
});
