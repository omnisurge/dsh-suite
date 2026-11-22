/**
 * Canonical Client Remote envelope unwrapping and bounded-call helper (ADR-117 D2).
 *
 * Converges the duplicated `makeCall` / `unwrap` / `budget` glue across Suite Client cards onto
 * one thin base, reusing `withTimeout` from `../remote-timeout.js` as the single timeout owner.
 */
import {CLIENT_READ_TIMEOUT_MS, withTimeout} from '../remote-timeout.js';

const errorReason = issue => (issue && issue.message ? issue.message : String(issue));

/**
 * Validate a Host `RemoteResult` envelope (`{ ok: true, value } | { ok: false, error }`) and
 * return `result.value`. Callers with specialized error shapes (e.g. `tools/client.js` or
 * `suite/upgrade-flow.js`) pass `onInvalid` / `onRefused` hooks without duplicating envelope checks.
 */
export function assertRemoteEnvelope(result, method, options = {}) {
  const {onInvalid, onRefused} = options;
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    if (typeof onInvalid === 'function') throw onInvalid(result, method);
    throw new Error('SUITE_RESULT_INVALID ' + method);
  }
  if (result.ok === true) return result.value;
  if (typeof onRefused === 'function') throw onRefused(result.error, method);
  const code = result.error && typeof result.error.code === 'string' ? result.error.code : null;
  throw new Error('SUITE_HOST_REFUSED ' + method + (code ? ' [' + code + ']' : ''));
}

/**
 * Unwrap a Host `RemoteResult` envelope (`{ ok: true, value } | { ok: false, error }`).
 * Never treats a missing, malformed, or refused envelope as success.
 */
export function unwrapRemoteResult(result, {fallbackCode = 'REMOTE_FAILED'} = {}) {
  const byCode = error => {
    const code = error && (error.code || error.name);
    const resolved = typeof code === 'string' && code.length > 0 ? code : fallbackCode;
    return Object.assign(new Error(resolved), {code: resolved});
  };
  return assertRemoteEnvelope(result, undefined, {
    onInvalid: invalid => byCode(invalid?.error),
    onRefused: byCode,
  });
}

/**
 * Create a bounded Remote method caller bound to a live `{ namespace }` wire ref.
 * Standardizes the four transport/Host outcomes:
 *   - `SUITE_NAMESPACE_MISSING <method>`
 *   - `SUITE_CARRIER_FAILED <method> → <reason>`
 *   - `SUITE_RESULT_INVALID <method>`
 *   - `SUITE_HOST_REFUSED <method> [<code>]`
 *   - `SUITE_READ_TIMEOUT <method>` (when `timeoutMs > 0` expires)
 */
export function createRemoteCaller(wire, options = {}) {
  const {timeoutMs = CLIENT_READ_TIMEOUT_MS, timeoutCode = 'SUITE_READ_TIMEOUT'} = options;
  return async (method, ...args) => {
    const run = async () => {
      const namespace = wire && wire.namespace;
      if (!namespace || typeof namespace[method] !== 'function') throw new Error('SUITE_NAMESPACE_MISSING ' + method);
      let result;
      try {
        result = await namespace[method](...args);
      } catch (issue) {
        throw new Error('SUITE_CARRIER_FAILED ' + method + ' → ' + errorReason(issue));
      }
      return assertRemoteEnvelope(result, method);
    };
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) return run();
    return withTimeout(run, timeoutMs, {code: timeoutCode, message: timeoutCode + ' ' + method});
  };
}
