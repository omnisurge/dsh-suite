/**
 * Bringing the app window back to the front after a loopback OAuth callback (ADR-052 D4 / ADR-056).
 *
 * Why this file exists at all: the callback lands in the system browser, so when the user finishes consenting
 * the window they are looking at is the browser — and the fact that matters ("this row is now connected") is in
 * the app. The user should not have to hunt for it.
 *
 * There is **no public seam** for this: the target runtime's service table has no window/desktop service
 * (checked against the 0.2.1-rc.3 contract snapshot — `webServer`, `shell`, `shellEnv` exist; nothing that can
 * raise a window), and `@deepseek-ai/dsh-desktop-host` ships only `lib/cli.js` + `lib/index.js` with no focus
 * entry point. AGENTS §1.9 forbids editing the official desktop lifecycle to add one, so this is the
 * "injection-free" shape: ask the **operating system** to activate an application that is already running.
 *
 * Contract:
 * - darwin only, and only when the running host is inside a bundled application
 *   (`…/Foo.app/Contents/MacOS/Foo`). A node process running from a source checkout has no application to
 *   activate, and guessing an application by name would activate somebody else's window.
 * - `open <bundle>.app` is the OS's own activation path: it raises the already-running instance instead of
 *   starting a second one, and it needs no accessibility/automation permission.
 * - Failure is silent and total: a missing `open`, a sandbox that refuses the spawn, or a non-darwin platform
 *   is "we did not do it", never an error the caller has to handle, and never a thrown exception in the
 *   callback path (the callback response must be sent regardless — the row still becomes connected).
 * - The caller decides whether to ask (see `authorizationFocus`), so the behaviour has an off switch and the
 *   outcome is reported as a machine fact instead of a sentence.
 */
import { spawn } from "node:child_process";

export type FocusMethod = "open" | "none";

/** What the caller may learn about a focus attempt. It is a machine fact; no sentence lives here (AGENTS §5.10). */
export interface FocusOutcome {
  /** `true` only when an activation command was actually handed to the system. */
  readonly attempted: boolean;
  readonly method: FocusMethod;
  /** Why nothing was attempted. Present only when `attempted` is false. */
  readonly reason?: "no-bundle" | "unsupported-platform" | "spawn-failed";
}

// Absolute only: a *relative* `Example.app/Contents/MacOS/Example` is not a bundle location, and matching it would
// send `open` a path resolved against whatever working directory the app happens to have.
const MAC_BUNDLE = /^(\/.+\.app)\/Contents\/MacOS\//u;

export interface FocusRuntime {
  readonly platform: string;
  /** The running host's executable path (`process.execPath`), used to locate the bundle it belongs to. */
  readonly execPath: string;
  /** The one side effect, injectable so the contract can be tested without launching anything. */
  readonly run: (command: string, args: readonly string[]) => void;
}

const liveRuntime: FocusRuntime = {
  platform: process.platform,
  execPath: process.execPath,
  run(command, args) {
    try {
      spawn(command, [...args], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } catch {
      // Silent by contract: the callback has already been answered, and focus is a convenience.
    }
  },
};

/** The `.app` bundle the running host belongs to, or null when it does not run from one. */
export function applicationBundleOf(execPath: string): string | null {
  const match = MAC_BUNDLE.exec(execPath);
  if (match === null) return null;
  const bundle = match[1];
  return bundle.trim() === "" ? null : bundle;
}

/**
 * Ask the system to bring the application that owns this host process to the front.
 *
 * Returns what was attempted. Never throws; never waits for the command.
 */
export function activateApplicationWindow(
  options: { readonly enabled?: boolean; readonly runtime?: FocusRuntime } = {},
): FocusOutcome {
  if (options.enabled === false) return { attempted: false, method: "none", reason: "unsupported-platform" };
  const runtime = options.runtime ?? liveRuntime;
  if (runtime.platform !== "darwin") {
    // Other platforms have no equivalent one-shot command that is guaranteed to exist and to be harmless;
    // "we do not attempt it" is honest, and the row's connected state is still the user's receipt.
    return { attempted: false, method: "none", reason: "unsupported-platform" };
  }
  const bundle = applicationBundleOf(runtime.execPath);
  if (bundle === null) return { attempted: false, method: "none", reason: "no-bundle" };
  try {
    runtime.run("open", [bundle]);
  } catch {
    return { attempted: false, method: "none", reason: "spawn-failed" };
  }
  return { attempted: true, method: "open" };
}
