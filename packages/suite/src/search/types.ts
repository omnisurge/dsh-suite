/** Client-safe, shared read-only setup contract. Never carries credential values or upstream text. */
export interface SetupConfiguration {
  endpointConfigured: boolean;
  transport: 'none' | 'http' | 'https';
  credentialReferenceConfigured: boolean;
  engineGroup: string;
  customEngines: string;
  timeoutMs: number;
}
export interface SetupInspection {
  version: string;
  providerId: string;
  capability: 'read-only';
  configurationFingerprint: string;
  schemaJson: string;
  configuration: SetupConfiguration;
  credentialState: 'not-required' | 'configured' | 'missing' | 'unknown';
  globalSelection: 'unknown';
  codes: string[];
  nextSteps: string[];
}
export interface SetupProbe {
  language: 'en' | 'zh';
  query: string;
  elapsedMs: number;
  httpStatus: number | null;
  jsonState: 'unknown' | 'valid' | 'invalid';
  sourceCount: number;
  expectedDomainMatched: boolean;
  unresponsiveEngineCount: number;
  fallbackUsed: boolean;
  codes: string[];
  nextSteps: string[];
}
/** UI supplies only its saved settings; Host compares, never fetches a caller-supplied endpoint. */
export interface SetupExpectedConfiguration {
 baseUrl: string; basicAuthEnv: string; engineGroup: 'default'|'all'|'auto'|'en'|'zh'|'custom'; customEngines: string; timeoutMs: number;
}
export interface SetupCheck {
  inspection: SetupInspection;
  scope: 'own-provider';
  state: 'ready' | 'degraded' | 'blocked' | 'cancelled' | 'busy';
  configurationChanged: boolean;
  elapsedMs: number;
  probes: SetupProbe[];
  codes: string[];
  nextSteps: string[];
}

/** Which bundle owns this plugin row, as the official plugin manager reports it. */
export interface SetupSettingsOwner {
  owner: string;
  rowId: string;
  source: 'plugin-manager' | 'own-package';
  diagnostic: string | null;
}
