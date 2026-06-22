const fs = require("node:fs");
const path = require("node:path");

function listMigrationFiles(migrationsFolder) {
  return fs
    .readdirSync(migrationsFolder)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function readMigrationJournal(migrationsFolder) {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  return JSON.parse(fs.readFileSync(journalPath, "utf8"));
}

function getMigrationTagFromFile(fileName) {
  return fileName.replace(/\.sql$/i, "");
}

function getMigrationPrefix(tag) {
  const match = tag.match(/^(\d+)_/);
  return match ? match[1] : null;
}

function findDuplicates(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function readMigrationManifest(migrationsFolder) {
  const migrationFiles = listMigrationFiles(migrationsFolder);
  const fileTags = migrationFiles.map(getMigrationTagFromFile);
  const journal = readMigrationJournal(migrationsFolder);
  const journalTags = (journal.entries || []).map((entry) => entry.tag);

  return {
    migrationFiles,
    fileTags,
    journalTags,
    duplicateFileTags: findDuplicates(fileTags),
    duplicateJournalTags: findDuplicates(journalTags),
    duplicatePrefixes: findDuplicates(fileTags.map(getMigrationPrefix).filter(Boolean)),
    missingFiles: journalTags.filter((tag) => !fileTags.includes(tag)),
    orphanFiles: fileTags.filter((tag) => !journalTags.includes(tag)),
  };
}

function validateMigrationManifest(migrationsFolder) {
  const manifest = readMigrationManifest(migrationsFolder);
  const errors = [];

  if (manifest.duplicateFileTags.length) {
    errors.push(`duplicate SQL migration tags: ${manifest.duplicateFileTags.join(", ")}`);
  }

  if (manifest.duplicateJournalTags.length) {
    errors.push(`duplicate journal migration tags: ${manifest.duplicateJournalTags.join(", ")}`);
  }

  if (manifest.duplicatePrefixes.length) {
    errors.push(`duplicate numeric migration prefixes: ${manifest.duplicatePrefixes.join(", ")}`);
  }

  if (manifest.missingFiles.length) {
    errors.push(`journal entries without SQL files: ${manifest.missingFiles.join(", ")}`);
  }

  if (manifest.orphanFiles.length) {
    errors.push(`SQL files missing from journal: ${manifest.orphanFiles.join(", ")}`);
  }

  if (errors.length) {
    const error = new Error(`Migration manifest is inconsistent: ${errors.join("; ")}`);
    error.code = "MIGRATION_MANIFEST_INVALID";
    error.diagnostic = manifest;
    throw error;
  }

  return manifest;
}

module.exports = {
  getMigrationPrefix,
  getMigrationTagFromFile,
  listMigrationFiles,
  readMigrationJournal,
  readMigrationManifest,
  validateMigrationManifest,
};
