/**
 * Bounded Client transport (P2-17/P2-20).
 *
 * The Client reaches the Host through a generated Remote namespace, and the MCP OAuth panel reaches its
 * loopback control plane through fetch. Neither transport carries its own deadline: a carrier or local
 * route that never answers used to leave a page in a permanent busy/loading state. A timeout is a
 * transport fact, not a Host verdict, so it is surfaced as a typed failure with a machine code; callers
 * must render it as a readable, retryable failure and must never turn it into a success.
 */

const REMOTE_TIMEOUT = 'REMOTE_TIMEOUT';
const REMOTE_ABORTED = 'REMOTE_ABORTED';
/** Quick reads: capability snapshots, status and list reads. */
export const CLIENT_READ_TIMEOUT_MS = 10000;
/** Ordinary actions a page may wait for (enable switches, credential writes, probes). */
export const CLIENT_ACTION_TIMEOUT_MS = 30000;

export class RemoteTimeoutError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'RemoteTimeoutError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Race a promise (or a factory that starts it) against a deadline and an optional caller signal.
 * The losing task's later rejection is consumed by the race and never becomes an unhandled rejection.
 */
export function withTimeout(task, timeoutMs, options = {}) {
  const {code = REMOTE_TIMEOUT, message = 'REMOTE_TIMEOUT', signal, abortCode = REMOTE_ABORTED} = options;
  const wait = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  // A caller signal that is already aborted must not start the transport at all: the guard below would
  // reject the page, but the factory would still have dispatched its call.
  const pending = signal !== undefined && signal !== null && signal.aborted
    ? Promise.reject(new RemoteTimeoutError(abortCode, 'REMOTE_ABORTED'))
    : (typeof task === 'function' ? Promise.resolve().then(task) : Promise.resolve(task));
  let timer;
  let abortListener;
  const guard = new Promise((_resolve, reject) => {
    if (wait > 0) timer = setTimeout(() => reject(new RemoteTimeoutError(code, message)), wait);
    if (signal !== undefined && signal !== null) {
      if (signal.aborted) reject(new RemoteTimeoutError(abortCode, 'REMOTE_ABORTED'));
      else {
        abortListener = () => reject(new RemoteTimeoutError(abortCode, 'REMOTE_ABORTED'));
        signal.addEventListener('abort', abortListener, {once: true});
      }
    }
  });
  return Promise.race([pending, guard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (abortListener !== undefined) signal.removeEventListener('abort', abortListener);
  });
}

/**
 * fetch with a real AbortController plus a race deadline. The race matters on its own: a fixture fetch
 * that ignores the signal must still settle the page instead of hanging it forever.
 */
export async function fetchWithTimeout(fetcher, input, init = {}, timeoutMs, options = {}) {
  const {code = REMOTE_TIMEOUT, message = 'REMOTE_TIMEOUT ' + String(input), signal, abortCode = REMOTE_ABORTED} = options;
  const controller = new AbortController();
  const wait = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const timer = wait > 0 ? setTimeout(() => controller.abort(), wait) : undefined;
  const onAbort = () => controller.abort();
  if (signal !== undefined && signal !== null) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, {once: true});
  }
  try {
    return await withTimeout(() => fetcher(input, {...init, signal: controller.signal}), timeoutMs, {code, message, signal, abortCode});
  } catch (error) {
    if (error instanceof RemoteTimeoutError) throw error;
    if (signal !== undefined && signal !== null && signal.aborted) throw new RemoteTimeoutError(abortCode, 'REMOTE_ABORTED');
    if (controller.signal.aborted) throw new RemoteTimeoutError(code, message);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal !== undefined && signal !== null) signal.removeEventListener('abort', onAbort);
  }
}

/** One unary Remote call. Kept separate so every page applies the same deadline and code shape. */
export function boundedRemoteCall(namespace, method, args = [], options = {}) {
  const {timeoutMs = CLIENT_ACTION_TIMEOUT_MS, code = 'SUITE_REMOTE_TIMEOUT', message = 'SUITE_REMOTE_TIMEOUT ' + method, signal} = options;
  return withTimeout(() => {
    if (!namespace || typeof namespace[method] !== 'function') throw new Error('SUITE_NAMESPACE_MISSING ' + method);
    return namespace[method](...args);
  }, timeoutMs, {code, message, signal});
}
