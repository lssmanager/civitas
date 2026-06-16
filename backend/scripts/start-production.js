const { spawn } = require("node:child_process");
const { checkDatabaseConnection, getDatabaseConnectionTarget } = require("../db/connection");

const DEFAULT_DATABASE_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_DATABASE_WAIT_INTERVAL_MS = 2_000;
const DEFAULT_DATABASE_CONNECT_TIMEOUT_MS = 1_500;

function parsePositiveIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds`);
  }

  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for production startup");
  }

  try {
    return getDatabaseConnectionTarget();
  } catch (error) {
    throw new Error(`DATABASE_URL is invalid: ${error.message}`);
  }
}

async function waitForDatabase() {
  const target = requireDatabaseUrl();
  const timeoutMs = parsePositiveIntegerEnv("DATABASE_WAIT_TIMEOUT_MS", DEFAULT_DATABASE_WAIT_TIMEOUT_MS);
  const intervalMs = parsePositiveIntegerEnv("DATABASE_WAIT_INTERVAL_MS", DEFAULT_DATABASE_WAIT_INTERVAL_MS);
  const connectTimeoutMs = parsePositiveIntegerEnv("DATABASE_CONNECT_TIMEOUT_MS", DEFAULT_DATABASE_CONNECT_TIMEOUT_MS);
  const startedAt = Date.now();
  let attempt = 1;
  let lastError = "unknown error";

  console.log(
    `[startup] waiting for database at ${target.host}:${target.port}/${target.database} ` +
      `(timeout=${timeoutMs}ms, interval=${intervalMs}ms, connectTimeout=${connectTimeoutMs}ms)...`
  );

  while (Date.now() - startedAt < timeoutMs) {
    const result = await checkDatabaseConnection(connectTimeoutMs);

    if (result.ok) {
      console.log(`[startup] database reachable at ${result.host}:${result.port}/${result.database}`);
      return;
    }

    lastError = result.error;
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(timeoutMs - elapsedMs, 0);

    console.error(
      `[startup] database wait attempt ${attempt} failed: ${lastError}; ` +
        `${remainingMs}ms remaining before startup fails`
    );

    attempt += 1;

    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(intervalMs, remainingMs));
  }

  throw new Error(`database was not reachable within ${timeoutMs}ms: ${lastError}`);
}

function runNodeScript(scriptPath, stepName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { stdio: "inherit" });

    child.on("error", (error) => {
      reject(new Error(`${stepName} failed to start: ${error.message}`));
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${stepName} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

function startServer() {
  console.log("[startup] starting server...");

  const server = spawn(process.execPath, ["index.js"], { stdio: "inherit" });

  const forwardSignal = (signal) => {
    if (!server.killed) {
      server.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  server.on("error", (error) => {
    console.error("[startup] server failed to start", error);
    process.exit(1);
  });

  server.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[startup] server stopped by signal ${signal}`);
      process.exit(1);
    }

    process.exit(code || 0);
  });
}

async function main() {
  try {
    await waitForDatabase();

    console.log("[startup] running migrations...");
    await runNodeScript("scripts/migrate.js", "migrations");
    console.log("[startup] migrations completed");

    startServer();
  } catch (error) {
    console.error(`[startup] ${error.message}`);
    process.exit(1);
  }
}

main();
