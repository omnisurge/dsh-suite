/** Owned build protocol: one shared tag for the loaded Suite manager, the fixed
 * build entry and every produced artifact advertisement.
 *
 * A receipt whose tag does not match the tag compiled into the loaded manager is
 * refused (BUILDER_PROTOCOL_MISMATCH), never reported as a successful update.
 * Bump the tag whenever the produced Host/Client capability contract changes. */
export const SUITE_DEVELOPMENT_PROTOCOL = 'omnisurge-suite-development/2';
/** Implementation version of the fixed entry; diagnostics only, never a readiness proof. */
export const BUILDER_VERSION = '2';
/** Files that implement the fixed build entry. Their current bytes are what a
 * click must execute and what the reported entry fingerprint covers. */
export const ENTRY_FILES = [
  'scripts/shared/build-protocol.mjs',
  'scripts/build/build-target.mjs',
  'scripts/shared/build-target-core.mjs',
  'scripts/build/build-suite.mjs',
  'scripts/build/build-management-client.mjs',
  'scripts/build/build-management-remote.mjs',
];
/** Running capabilities every accepted build must actually prove. */
export const CAPABILITY_OWNERS = Object.freeze({hostStamped:'host',hostRemote:'host',clientRemote:'client',clientFlow:'client'});
export const REQUIRED_CAPABILITIES = Object.freeze(Object.keys(CAPABILITY_OWNERS));
export const RECEIPT_PREFIX = 'OMNISURGE_BUILD_RECEIPT ';
export const ERROR_PREFIX = 'OMNISURGE_BUILD_ERROR ';
export function bootstrapRequired(message) {
 return Error('BUILDER_BOOTSTRAP_REQUIRED: '+message+' — rebuild the whole Suite from source and load the new manager once; the button cannot upgrade the loaded manager itself');
}
/** Canonical receipt validation. Runtime exit success is an additional caller-owned precondition. */
export function verifyBuildReceipt(value, protocol=SUITE_DEVELOPMENT_PROTOCOL) {
 if(!value||typeof value!=='object')throw bootstrapRequired('the fixed build entry returned no protocol receipt');
 if(typeof value.protocol!=='string'||value.protocol.length===0)throw bootstrapRequired('the build receipt carries no build protocol');
 if(value.protocol!==protocol)throw Error('BUILDER_PROTOCOL_MISMATCH: the loaded manager speaks '+protocol+' but the build entry produced '+value.protocol+'; complete the one-time Suite rebuild and reload');
 const missing=REQUIRED_CAPABILITIES.filter(name=>value.capabilities?.[name]!==true);
 if(missing.length)throw Error('BUILD_CAPABILITY_MISSING: '+missing.join(',')+' — this generation does not prove the required running Host/Client capability, so no success receipt is issued');
 for(const field of ['builderVersion','entryFingerprint','sourceFingerprint','hostRevision','clientRevision'])if(typeof value[field]!=='string'||value[field].length===0)throw Error('BUILDER_RECEIPT_INVALID: missing '+field);
 if(!Number.isSafeInteger(value.changed)||value.changed<0)throw Error('BUILDER_RECEIPT_INVALID: invalid changed count');
 return value;
}
