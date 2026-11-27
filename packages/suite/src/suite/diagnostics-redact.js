function scrubString(value) {
  return String(value)
    // Strip Bearer / Basic credentials (keeping scheme unrecognizable or masked cleanly).
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED]')
    // Strip URL userinfo (`https://user:pass@host`).
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+:[^/\s@]+)@/gi, '$1[REDACTED]@')
    // Strip common provider/personal access token patterns.
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}\b/g, '[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
}

function sanitizeBoolean(value) {
  if (typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function sanitizeNumber(value) {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  return undefined;
}

function sanitizeString(value) {
  if (value === null) return null;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return scrubString(String(value));
  }
  return undefined;
}

function sanitizeRefString(value) {
  if (value === null) return null;
  if (typeof value === 'string') return scrubString(value);
  return undefined;
}

function pickSchemaFields(value, schema, seen) {
  const out = {};
  for (const [key, handler] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key)) continue;
    const sanitized = handler(value[key], seen);
    if (sanitized !== undefined) {
      out[key] = sanitized;
    }
  }
  return out;
}

function sanitizeSchema(value, schema, seen) {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    return pickSchemaFields(value, schema, seen);
  } finally {
    seen.delete(value);
  }
}

function sanitizeArray(value, itemSanitizer, seen) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    return value.map((item) => {
      const sanitized = itemSanitizer(item, seen);
      return sanitized === undefined ? null : sanitized;
    });
  } finally {
    seen.delete(value);
  }
}

function sanitizeRecord(value, valueSanitizer, seen) {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__') continue;
      const sanitized = valueSanitizer(entry, seen);
      if (sanitized !== undefined) {
        out[key] = sanitized;
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

const ERROR_SCHEMA = {
  name: sanitizeString,
  message: sanitizeString,
};

function sanitizeErrorValue(value, seen) {
  if (value === null) return null;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    if (value instanceof Error) {
      return {
        name: scrubString(value.name || 'Error'),
        message: scrubString(value.message || ''),
      };
    }
    if (Array.isArray(value)) return undefined;
    return pickSchemaFields(value, ERROR_SCHEMA, seen);
  } finally {
    seen.delete(value);
  }
}

const CREDENTIAL_ENTRY_SCHEMA = {
  configured: sanitizeBoolean,
};

const sanitizeRefsRecord = (value, seen) => sanitizeRecord(value, sanitizeRefString, seen);
const sanitizeCredentialsRecord = (value, seen) =>
  sanitizeRecord(value, (entry, inner) => sanitizeSchema(entry, CREDENTIAL_ENTRY_SCHEMA, inner), seen);

const RECOVERY_ROW_SCHEMA = {
  id: sanitizeString,
  rowId: sanitizeString,
  application: sanitizeString,
  code: sanitizeString,
};

const RECOVERY_SCHEMA = {
  at: sanitizeString,
  previousPid: sanitizeNumber,
  reason: sanitizeString,
  action: sanitizeString,
  rows: (value, seen) => sanitizeArray(value, (item, inner) => sanitizeSchema(item, RECOVERY_ROW_SCHEMA, inner), seen),
};

const STATE_HOST_CAPABILITIES_SCHEMA = {
  hostStamped: sanitizeBoolean,
  hostRemote: sanitizeBoolean,
};

const STATE_TARGET_CAPABILITIES_SCHEMA = {
  hostStamped: sanitizeBoolean,
  hostRemote: sanitizeBoolean,
  clientRemote: sanitizeBoolean,
  clientFlow: sanitizeBoolean,
};

const STATE_TARGET_SCHEMA = {
  protocol: sanitizeString,
  builderVersion: sanitizeString,
  entryFingerprint: sanitizeString,
  sourceFingerprint: sanitizeString,
  hostRevision: sanitizeString,
  clientRevision: sanitizeString,
  capabilities: (value, seen) => sanitizeSchema(value, STATE_TARGET_CAPABILITIES_SCHEMA, seen),
  changed: sanitizeNumber,
};

const STATE_OPERATION_SCHEMA = {
  epoch: sanitizeNumber,
  phase: sanitizeString,
  error: sanitizeErrorValue,
  target: (value, seen) => sanitizeSchema(value, STATE_TARGET_SCHEMA, seen),
};

const STATE_NOTICE_SCHEMA = {
  code: sanitizeString,
};

const STATE_SCHEMA = {
  linked: sanitizeBoolean,
  sourceRoot: sanitizeString,
  hostPid: sanitizeNumber,
  hostHmr: sanitizeBoolean,
  managerProtocol: sanitizeString,
  hostRevision: sanitizeString,
  hostProtocol: sanitizeString,
  hostCapabilities: (value, seen) => sanitizeSchema(value, STATE_HOST_CAPABILITIES_SCHEMA, seen),
  operation: (value, seen) => sanitizeSchema(value, STATE_OPERATION_SCHEMA, seen),
  notice: (value, seen) => sanitizeSchema(value, STATE_NOTICE_SCHEMA, seen),
};

const COMPONENT_DISPLAY_SCHEMA = {
  en: sanitizeString,
  zh: sanitizeString,
};

const COMPONENT_EFFECT_POLICY_SCHEMA = {
  checkpointTokens: sanitizeNumber,
  safetyTokens: sanitizeNumber,
  timeoutMs: sanitizeNumber,
};

const COMPONENT_EFFECT_SCHEMA = {
  protocol: sanitizeNumber,
  scope: sanitizeString,
  state: sanitizeString,
  complete: sanitizeBoolean,
  total: sanitizeNumber,
  covered: sanitizeNumber,
  waiting: sanitizeNumber,
  rejected: sanitizeNumber,
  unknown: sanitizeNumber,
  reasons: (value, seen) => sanitizeArray(value, sanitizeString, seen),
  policy: (value, seen) => sanitizeSchema(value, COMPONENT_EFFECT_POLICY_SCHEMA, seen),
};

const COMPONENT_ITEM_SCHEMA = {
  id: sanitizeString,
  display: (value, seen) => sanitizeSchema(value, COMPONENT_DISPLAY_SCHEMA, seen),
  module: sanitizeString,
  rowId: sanitizeString,
  carriedVersion: sanitizeString,
  loadedVersion: sanitizeString,
  rowEnabled: sanitizeBoolean,
  state: sanitizeString,
  nextAction: sanitizeString,
  diagnostic: sanitizeString,
  effect: (value, seen) => sanitizeSchema(value, COMPONENT_EFFECT_SCHEMA, seen),
};

const HEAL_REASON_SCHEMA = {
  code: sanitizeString,
  text: sanitizeString,
};

const HEAL_ITEM_SCHEMA = {
  entryId: sanitizeString,
  moduleName: sanitizeString,
  owner: sanitizeString,
  outcome: sanitizeString,
  reason: (value, seen) => sanitizeSchema(value, HEAL_REASON_SCHEMA, seen),
  bootId: sanitizeString,
  code: sanitizeString,
  at: sanitizeString,
  attempts: sanitizeNumber,
  acknowledged: sanitizeBoolean,
};

const COMPONENTS_SCHEMA = {
  components: (value, seen) => sanitizeArray(value, (item, inner) => sanitizeSchema(item, COMPONENT_ITEM_SCHEMA, inner), seen),
  recovery: (value, seen) => sanitizeSchema(value, RECOVERY_SCHEMA, seen),
  heal: (value, seen) => sanitizeArray(value, (item, inner) => sanitizeSchema(item, HEAL_ITEM_SCHEMA, inner), seen),
};

const UPGRADE_COMPONENT_SCHEMA = {
  id: sanitizeString,
  module: sanitizeString,
  rowId: sanitizeString,
};

const UPGRADE_LATEST_SCHEMA = {
  version: sanitizeString,
  filename: sanitizeString,
  directory: sanitizeString,
  suiteSha256: sanitizeString,
  suiteBytes: sanitizeNumber,
  components: (value, seen) => sanitizeArray(value, (item, inner) => sanitizeSchema(item, UPGRADE_COMPONENT_SCHEMA, inner), seen),
};

const UPGRADE_REFUSAL_SCHEMA = {
  directory: sanitizeString,
  code: sanitizeString,
  diagnostic: sanitizeString,
};

const UPGRADE_LAST_INSTALL_SCHEMA = {
  schema: sanitizeNumber,
  target: sanitizeString,
  sha256: sanitizeString,
  phase: sanitizeString,
  startedAt: sanitizeString,
  finishedAt: sanitizeString,
  code: sanitizeString,
  onDisk: sanitizeString,
  pid: sanitizeNumber,
};

const UPGRADE_SCHEMA = {
  mode: sanitizeString,
  currentVersion: sanitizeString,
  onDiskVersion: sanitizeString,
  releaseDirectory: sanitizeString,
  canUpgrade: sanitizeBoolean,
  latest: (value, seen) => sanitizeSchema(value, UPGRADE_LATEST_SCHEMA, seen),
  refusals: (value, seen) => sanitizeArray(value, (item, inner) => sanitizeSchema(item, UPGRADE_REFUSAL_SCHEMA, inner), seen),
  lastInstall: (value, seen) => sanitizeSchema(value, UPGRADE_LAST_INSTALL_SCHEMA, seen),
};

const OCR_USAGE_SCHEMA = {
  calls: sanitizeNumber,
  pages: sanitizeNumber,
  lines: sanitizeNumber,
  lastAt: sanitizeString,
};

const OCR_PROVIDER_STATE_SCHEMA = {
  id: sanitizeString,
  configured: sanitizeBoolean,
  refs: sanitizeRefsRecord,
  credentials: sanitizeCredentialsRecord,
  usage: (value, seen) => sanitizeSchema(value, OCR_USAGE_SCHEMA, seen),
};

const OCR_SCHEMA = {
  enabled: sanitizeBoolean,
  configured: sanitizeBoolean,
  provider: sanitizeString,
  selectedProvider: sanitizeString,
  maxPages: sanitizeNumber,
  refs: sanitizeRefsRecord,
  credentials: sanitizeCredentialsRecord,
  providerStates: (value, seen) =>
    sanitizeRecord(value, (entry, inner) => sanitizeSchema(entry, OCR_PROVIDER_STATE_SCHEMA, inner), seen),
};

const DOC_PARSE_LAST_ERROR_SCHEMA = {
  code: sanitizeString,
  at: sanitizeString,
  retryAfter: sanitizeNumber,
  mode: sanitizeString,
};

function sanitizeDocParseLastError(value, seen) {
  if (value === null) return null;
  if (typeof value === 'string') return scrubString(value);
  if (value instanceof Error) return sanitizeErrorValue(value, seen);
  return sanitizeSchema(value, DOC_PARSE_LAST_ERROR_SCHEMA, seen);
}

const DOC_PARSE_PROVIDER_STATE_SCHEMA = {
  id: sanitizeString,
  configured: sanitizeBoolean,
  refs: sanitizeRefsRecord,
  credentials: sanitizeCredentialsRecord,
  lastError: sanitizeDocParseLastError,
};

const DOC_PARSE_SCHEMA = {
  enabled: sanitizeBoolean,
  providerStates: (value, seen) =>
    sanitizeRecord(value, (entry, inner) => sanitizeSchema(entry, DOC_PARSE_PROVIDER_STATE_SCHEMA, inner), seen),
};

const MULTIMODAL_SCHEMA = {
  ocr: (value, seen) => sanitizeSchema(value, OCR_SCHEMA, seen),
  docParse: (value, seen) => sanitizeSchema(value, DOC_PARSE_SCHEMA, seen),
};

const CHECK_RECEIPT_SCHEMA = {
  code: sanitizeString,
  directory: sanitizeString,
  reasonKey: sanitizeString,
};

const CHECK_FAILURE_SCHEMA = {
  code: sanitizeString,
  at: sanitizeString,
};

const CHECK_SCHEMA = {
  receipt: (value, seen) => sanitizeSchema(value, CHECK_RECEIPT_SCHEMA, seen),
  failure: (value, seen) => sanitizeSchema(value, CHECK_FAILURE_SCHEMA, seen),
};

const OP_SCHEMA = {
  phase: sanitizeString,
  error: sanitizeErrorValue,
};

const ROOT_SCHEMA = {
  state: (value, seen) => sanitizeSchema(value, STATE_SCHEMA, seen),
  components: (value, seen) => sanitizeSchema(value, COMPONENTS_SCHEMA, seen),
  upgrade: (value, seen) => sanitizeSchema(value, UPGRADE_SCHEMA, seen),
  recovery: (value, seen) => sanitizeSchema(value, RECOVERY_SCHEMA, seen),
  multimodal: (value, seen) => sanitizeSchema(value, MULTIMODAL_SCHEMA, seen),
  check: (value, seen) => sanitizeSchema(value, CHECK_SCHEMA, seen),
  op: (value, seen) => sanitizeSchema(value, OP_SCHEMA, seen),
  error: sanitizeErrorValue,
};

function sanitizePayload(value, seen) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    return pickSchemaFields(value, ROOT_SCHEMA, seen);
  } finally {
    seen.delete(value);
  }
}

/**
 * Formats Suite diagnostic payload into strict allowlist-filtered, redacted JSON safe for UI display and clipboard copy.
 */
export function formatSuiteDiagnostics(payload) {
  const sanitized = sanitizePayload(payload ?? {}, new WeakSet());
  return JSON.stringify(sanitized === undefined ? {} : sanitized, null, 2);
}
