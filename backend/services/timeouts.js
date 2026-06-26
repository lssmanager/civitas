function parsePositiveInteger(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function getTimeoutMs(name, defaultValue) {
  return parsePositiveInteger(process.env[name], defaultValue);
}

function buildTimeoutError({ timeoutMs, label, code, name, status } = {}) {
  const timeoutError = new Error(`${label || "operation"} timed out after ${timeoutMs}ms`);
  timeoutError.name = name || "IntegrationTimeoutError";
  timeoutError.code = code || "INTEGRATION_TIMEOUT";
  timeoutError.status = status;
  timeoutError.timeoutMs = timeoutMs;
  return timeoutError;
}

async function withTimeout(promiseFactory, { timeoutMs, label, onTimeout, code, name, status } = {}) {
  const controller = new AbortController();
  let timeout;
  let didTimeout = false;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true;
      onTimeout?.();
      controller.abort();
      reject(buildTimeoutError({ timeoutMs, label, code, name, status }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promiseFactory(controller.signal), timeoutPromise]);
  } catch (error) {
    if (!didTimeout && error?.name === "AbortError") {
      throw buildTimeoutError({ timeoutMs, label, code, name, status });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function measureAsync(label, operation, { warnAfterMs = 1000, logger = console } = {}) {
  const startedAt = Date.now();
  try {
    return await operation();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.error?.(`[diagnostic] ${label} failed after ${durationMs}ms`, { code: error?.code, message: error?.message });
    throw error;
  } finally {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= warnAfterMs) logger.warn?.(`[diagnostic] ${label} was slow`, { durationMs, warnAfterMs });
  }
}

module.exports = { buildTimeoutError, getTimeoutMs, measureAsync, parsePositiveInteger, withTimeout };
