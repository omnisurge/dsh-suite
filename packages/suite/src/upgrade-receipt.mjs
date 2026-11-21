/**
 * ADR-047 D3 / ADR-079: one convergence point for a Suite upgrade receipt.
 *
 * A durable record describes an *attempt*, not the profile's current identity. If the profile has since
 * been updated by the official installer (or by another generation), an old `written` record must not
 * turn into a permanent "installed, restart required" banner. The Host exposes the profile's actual
 * on-disk version beside the running version for exactly this distinction.
 *
 * The helper is plain JavaScript so the Client bundle and a Node test can share the same decision. It
 * returns a receipt to render, or null when the receipt no longer describes the current attempt.
 */

/** @typedef {{target?:string|null,onDisk?:string|null,code?:string,activationUnconfirmed?:boolean,operations?:unknown[],diagnostic?:string|null}} UpgradeReceipt */
/** @typedef {{currentVersion?:string,onDiskVersion?:string|null,lastInstall?:{target?:string,phase?:string,onDisk?:string|null}|null,latest?:{version?:string}|null}} UpgradeCandidates */

const isString = value => typeof value === 'string';
const isKnown = value => isString(value) && value.length > 0;

/**
 * @param {UpgradeReceipt|null} receipt
 * @param {UpgradeCandidates|null} candidates
 * @returns {UpgradeReceipt|null}
 */
export const convergeUpgradeReceipt = (receipt, candidates) => {
  const running = candidates && isString(candidates.currentVersion) ? candidates.currentVersion : null;
  // null means "the Host could not read the profile". An empty string is not a version and must not be
  // treated as a known disk identity.
  const onDisk = candidates && isString(candidates.onDiskVersion) && candidates.onDiskVersion.length > 0
    ? candidates.onDiskVersion
    : null;
  const record = candidates && candidates.lastInstall && typeof candidates.lastInstall === 'object'
    ? candidates.lastInstall
    : null;
  const recordWritten = record !== null
    && record.phase === 'written'
    && isString(record.target)
    && record.target.length > 0
    && record.onDisk === record.target;
  const targetOnDisk = target => onDisk !== null ? onDisk === target : true;

  if (receipt) {
    // A real failure receipt is terminal; disk presence from an older attempt must never turn it into
    // installed/restart. Only restart/submitted/unconfirmed receipts may converge.
    const terminalFailure = isString(receipt.code)
      && !['SUITE_UPGRADE_RESTART_REQUIRED', 'SUITE_UPGRADE_SUBMITTED', 'SUITE_UPGRADE_UNCONFIRMED'].includes(receipt.code);
    if (terminalFailure) return receipt;
    const target = isString(receipt.target) && receipt.target.length > 0 ? receipt.target : null;
    // The new bytes are already running. A receipt that was created by this generation is the installed
    // acknowledgement the user asked for (the lost-reply case must not turn into "unconfirmed"); it is not
    // the production stale case, which is an old durable record with no Client receipt. Only a readable
    // on-disk identity that differs from the target proves this receipt belongs to another profile state.
    if (target !== null && running === target) return onDisk !== null && onDisk !== target ? null : receipt;
    // A readable profile that no longer holds the target makes the receipt stale even when the shelf still
    // advertises the same version. "Offered" describes release availability, never what is installed.
    if (target !== null && onDisk !== null && onDisk !== target) return null;
    // If the Host could read the profile, only the actual on-disk identity can make the receipt current.
    // A receipt's own `onDisk` field, and an old durable record, are witnesses from an earlier attempt.
    if (target !== null && targetOnDisk(target)) {
      if (receipt.code === 'SUITE_UPGRADE_RESTART_REQUIRED' && receipt.target === target) {
        // Keep the receipt's own wording, but let the technical disclosure report the disk fact this Host
        // actually read instead of an older witness carried by the receipt.
        return onDisk !== null ? {...receipt, onDisk} : receipt;
      }
      return {
        ...receipt,
        code: 'SUITE_UPGRADE_RESTART_REQUIRED',
        target,
        onDisk: onDisk !== null ? onDisk : (recordWritten && record.target === target ? record.onDisk : target),
        activationUnconfirmed: true,
      };
    }
    // No readable disk identity (older Host) falls back to the candidate/receipt facts below. With a
    // readable profile, a receipt for a different on-disk version is stale and must not survive merely
    // because the same version is still advertised by the shelf.
    const offered = candidates && candidates.latest && isString(candidates.latest.version)
      ? candidates.latest.version
      : null;
    return offered === target ? receipt : null;
  }

  // No Client receipt: adopt a durable written record only while the profile still holds its target.
  // A stale record with target 0.3.6-4 beside on-disk 0.3.6-5 is history, not a pending restart.
  if (recordWritten && running !== record.target && targetOnDisk(record.target)) {
    return {
      code: 'SUITE_UPGRADE_RESTART_REQUIRED',
      target: record.target,
      operations: [],
      diagnostic: null,
      onDisk: record.onDisk,
      activationUnconfirmed: true,
    };
  }
  return null;
};

export { isKnown };
