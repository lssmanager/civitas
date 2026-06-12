const net = require("node:net");

const DEFAULT_DATABASE_URL = "postgres://civitas:civitas@localhost:5432/civitas";

function getDatabaseUrl() {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

function getDatabaseConnectionTarget() {
  const databaseUrl = new URL(getDatabaseUrl());

  return {
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 5432),
    database: databaseUrl.pathname.replace(/^\//, ""),
  };
}

function checkDatabaseConnection(timeoutMs = 1500) {
  const { host, port, database } = getDatabaseConnectionTarget();

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const settle = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve({ ...result, host, port, database });
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => settle({ ok: true }));
    socket.on("timeout", () => settle({ ok: false, error: "connection timeout" }));
    socket.on("error", (error) => settle({ ok: false, error: error.message }));
  });
}

module.exports = {
  DEFAULT_DATABASE_URL,
  checkDatabaseConnection,
  getDatabaseConnectionTarget,
  getDatabaseUrl,
};
