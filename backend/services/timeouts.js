function parsePositiveInteger(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function getTimeoutMs(name, defaultValue) {
  return parsePositiveInteger(process.env[name], defaultValue);
}

async function withTimeout(promiseFactory, { timeoutMs, label, onTimeout } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    onTimeout?.();
    controller.abort();
  }, timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`${label || "operation"} timed out after ${timeoutMs}ms`);
      timeoutError.name = "IntegrationTimeoutError";
      timeoutError.code = "INTEGRATION_TIMEOUT";
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
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

module.exports = { getTimeoutMs, measureAsync, parsePositiveInteger, withTimeout };
