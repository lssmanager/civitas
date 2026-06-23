const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { readMigrationManifest, validateMigrationManifest } = require("../scripts/migrationManifest");

function createManifestFixture({ sqlFiles, journalTags }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "civitas-migrations-"));
  const migrationsFolder = path.join(tempRoot, "drizzle");
  const metaFolder = path.join(migrationsFolder, "meta");

  fs.mkdirSync(metaFolder, { recursive: true });

  for (const fileName of sqlFiles) {
    fs.writeFileSync(path.join(migrationsFolder, fileName), "-- test migration\n", "utf8");
  }

  fs.writeFileSync(
    path.join(metaFolder, "_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect: "postgresql",
        entries: journalTags.map((tag, idx) => ({ idx, version: "7", when: idx + 1, tag, breakpoints: true })),
      },
      null,
      2
    ),
    "utf8"
  );

  return migrationsFolder;
}

test("migration manifest accepts matching SQL files and journal entries", () => {
  const migrationsFolder = createManifestFixture({
    sqlFiles: ["0000_initial.sql", "0001_users.sql"],
    journalTags: ["0000_initial", "0001_users"],
  });

  const manifest = validateMigrationManifest(migrationsFolder);
  assert.deepEqual(manifest.missingFiles, []);
  assert.deepEqual(manifest.orphanFiles, []);
  assert.deepEqual(manifest.duplicatePrefixes, []);
});

test("migration manifest reports orphan SQL files and duplicate prefixes", () => {
  const migrationsFolder = createManifestFixture({
    sqlFiles: ["0015_first.sql", "0015_second.sql"],
    journalTags: ["0015_first"],
  });

  const manifest = readMigrationManifest(migrationsFolder);
  assert.deepEqual(manifest.orphanFiles, ["0015_second"]);
  assert.deepEqual(manifest.duplicatePrefixes, ["0015"]);

  assert.throws(() => validateMigrationManifest(migrationsFolder), /Migration manifest is inconsistent/);
});

test("repository migration manifest stays in sync", () => {
  const migrationsFolder = path.resolve(__dirname, "..", "drizzle");
  assert.doesNotThrow(() => validateMigrationManifest(migrationsFolder));
});
