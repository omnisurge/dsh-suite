/** Must match package.json version. Shared sheet is last-writer; never let an older bundle downgrade it. */
export const UI_SHEET_VERSION = "0.1.52";

function parseUiSheetVersion(value: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Incoming wins when newer or same (same-version refresh). Unversioned existing always loses. */
export function uiSheetWins(existingVersion: string | undefined, incomingVersion: string): boolean {
  const incoming = parseUiSheetVersion(incomingVersion);
  if (incoming === null) return false;
  const existing = parseUiSheetVersion(existingVersion ?? "");
  if (existing === null) return true;
  if (incoming[0] !== existing[0]) return incoming[0] > existing[0];
  if (incoming[1] !== existing[1]) return incoming[1] > existing[1];
  return incoming[2] >= existing[2];
}
