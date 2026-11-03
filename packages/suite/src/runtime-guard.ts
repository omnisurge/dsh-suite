/**
 * Loadability-first runtime self-check.
 *
 * The manifest's `engines.dsh` only decides whether the official loader may import this package; it is an
 * admission question, answered before any of our code runs. Whether the *running release* is one this
 * generation was verified on is a different fact, and it is readable from the official boot manifest:
 * `window.__DSH_BOOT__.release` carries `{version, commit}` (typed in `@deepseek-ai/dsh-client-modules`).
 *
 * The Client is the right place for it: its module is loaded by the web host from the installed package, so
 * it renders even when this plugin's Host entry failed to activate. That is the difference between "the user
 * sees what happened and what to do" and a plugin that is simply missing from the page.
 *
 * The verdict compares two exact strings -- it never evaluates the compatibility range here. Re-deriving the
 * range in the browser would be a second implementation of official semantics; the list of runtimes we
 * actually exercised is the honest statement, and a version outside it is reported as unverified.
 */

export type RuntimeState = 'verified' | 'unverified' | 'unknown';

export interface RuntimeVerdict {
  state: RuntimeState;
  /** The release version the page reported, or null when the boot manifest carried none. */
  version: string | null;
  /** The verified runtimes this build was stamped with. Always reported, so the page can name them. */
  verified: readonly string[];
}

/** Read `window.__DSH_BOOT__.release.version` without trusting the shape: a missing page is not a crash. */
export function bootReleaseVersion(source: unknown): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const release = (source as { release?: unknown }).release;
  if (typeof release !== 'object' || release === null) return null;
  const version = (release as { version?: unknown }).version;
  return typeof version === 'string' && version.trim() !== '' ? version.trim() : null;
}

/** Compare the observed release with the runtimes this generation was verified on. */
export function runtimeVerdict(observed: string | null, verified: readonly string[]): RuntimeVerdict {
  if (observed === null) return { state: 'unknown', version: null, verified: [...verified] };
  return { state: verified.includes(observed) ? 'verified' : 'unverified', version: observed, verified: [...verified] };
}

/**
 * Which notice, if any, the page renders. Only an unverified runtime produces one: a page without a boot
 * manifest cannot boot at all (the official shell parses it and fails loudly), so "unknown" is not a user
 * state and must not become a warning the user can never act on.
 */
export function runtimeNoticeKey(state: RuntimeState): 'runtimeUnverified' | null {
  return state === 'unverified' ? 'runtimeUnverified' : null;
}

/**
 * The stamp the build writes into the Client bundle: the runtimes this generation was exercised on. It is
 * a comma-joined string rather than a JSON body on purpose -- the bundle's quoting and minification are the
 * bundler's business, and a JSON payload inside a string literal is one quote-style change away from a
 * syntax error at load time (which is exactly how this stamp first failed).
 */
export const VERIFIED_RUNTIMES: readonly string[] = '__OMNISURGE_VERIFIED_RUNTIMES__'.split(',');
