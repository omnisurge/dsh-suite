/**
 * Multi-role credential save (P2-19).
 *
 * A provider row can hold more than one credential role (OCR: SecretId + SecretKey; document parse may
 * grow a second role). Writing them one by one without a preflight used to leave a silent half-written
 * state: the first value was stored, the second was refused, and the page only said "not saved".
 *
 * This helper makes the order explicit:
 *   1. collect only the non-empty draft values;
 *   2. describe every target reference first and refuse before the first write when one role is read-only;
 *   3. write role by role, recording exactly which roles were stored before a refusal;
 *   4. answer a per-role outcome the page can render (never a bare success or a bare failure).
 *
 * Credentials have no compensating delete in the public service, so a mid-loop refusal is reported as a
 * partial outcome with the saved roles named; the UI refreshes its capability snapshot instead of
 * pretending nothing was written.
 */

export const CREDENTIAL_SAVE_OK = 'ok';
export const CREDENTIAL_SAVE_EMPTY = 'empty';
export const CREDENTIAL_SAVE_BLOCKED = 'blocked';
export const CREDENTIAL_SAVE_FAILED = 'failed';
export const CREDENTIAL_SAVE_PARTIAL = 'partial';

/**
 * @param {{role:string, ref:string, value:unknown}[]} entries
 * @param {{describe?:(refs:string[])=>Promise<Record<string,{configured:boolean,writable:boolean}|undefined>>, set:(ref:string,value:string)=>Promise<unknown>}} options
 */
export async function saveCredentialRoles(entries, options = {}) {
  const pending = [];
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.ref !== 'string' || entry.ref.length === 0) continue;
    if (typeof entry.value !== 'string' || entry.value.length === 0) continue;
    pending.push(entry);
  }
  if (pending.length === 0) return {status: CREDENTIAL_SAVE_EMPTY, savedRoles: [], blockedRoles: [], failedRole: null, reason: null};
  if (typeof options.describe === 'function') {
    let described;
    try {
      described = await options.describe(pending.map(entry => entry.ref));
    } catch (error) {
      return {status: CREDENTIAL_SAVE_BLOCKED, savedRoles: [], blockedRoles: pending.map(entry => entry.role), failedRole: null, reason: 'DESCRIBE_FAILED', code: error && error.code ? String(error.code) : null};
    }
    // Fail closed on a missing or non-boolean writable flag: an unanswered presence fact is not permission
    // to write. Only an explicit writable:true proceeds.
    const blockedRoles = pending
      .filter(entry => !described || typeof described !== 'object' || !described[entry.ref] || described[entry.ref].writable !== true)
      .map(entry => entry.role);
    if (blockedRoles.length > 0) return {status: CREDENTIAL_SAVE_BLOCKED, savedRoles: [], blockedRoles, failedRole: null, reason: 'READ_ONLY', code: null};
  }
  const savedRoles = [];
  for (const entry of pending) {
    try {
      await options.set(entry.ref, entry.value);
      savedRoles.push(entry.role);
    } catch (error) {
      return {
        status: savedRoles.length === 0 ? CREDENTIAL_SAVE_FAILED : CREDENTIAL_SAVE_PARTIAL,
        savedRoles,
        blockedRoles: [],
        failedRole: entry.role,
        reason: error && error.code ? String(error.code) : 'CREDENTIAL_WRITE_FAILED',
        code: error && error.code ? String(error.code) : null,
      };
    }
  }
  return {status: CREDENTIAL_SAVE_OK, savedRoles, blockedRoles: [], failedRole: null, reason: null};
}

/** Role names are provider vocabulary, not translated prose; the page decides the label. */
export const credentialRolesText = (roles, label = role => role) => (roles ?? []).map(label).join(', ');
