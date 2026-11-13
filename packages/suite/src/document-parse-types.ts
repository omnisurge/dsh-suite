/** Document parsing boundary types (ADR-086). Kept separate from the handwriting OCR types:
 * one is a synchronous page-to-lines primitive, the other is an asynchronous document-to-artifact job. */

export type DocumentParseProviderId = 'mineru' | 'paddleocr';

export type DocumentParseModeId =
  | 'mineru-agent'
  | 'mineru-api'
  | 'paddleocr-vl-1.6-async'
  | 'paddleocr-pp-ocrv6-async'
  | 'paddleocr-pp-structurev3-async';

export type DocumentParseInputKind = 'pdf' | 'image' | 'office' | 'url';
export type DocumentParseOutputKind = 'markdown' | 'json' | 'images' | 'zip';

export interface DocumentParseModeDescriptor {
  readonly id: DocumentParseModeId;
  readonly provider: DocumentParseProviderId;
  readonly displayKey: string;
  readonly auth: 'none' | 'credential';
  readonly credentialRoles: readonly string[];
  readonly transport: 'async' | 'sync';
  readonly inputs: readonly DocumentParseInputKind[];
  readonly outputs: readonly DocumentParseOutputKind[];
  readonly maxBytes: number | null;
  readonly maxPages: number | null;
}

export interface DocumentParseProviderDescriptor {
  readonly id: DocumentParseProviderId;
  readonly displayKey: string;
  readonly modes: readonly DocumentParseModeDescriptor[];
}

export interface DocumentParseArtifact {
  readonly name: string;
  readonly url: string;
  readonly mediaType: string | null;
}

export interface DocumentParseProviderResult {
  readonly pages: { extracted: number; total: number } | null;
  readonly markdown: string | null;
  readonly artifacts: readonly DocumentParseArtifact[];
  readonly requestId: string | null;
  readonly ms: number;
  /** Non-fatal extraction notes, e.g. a ZIP result could not be unpacked. */
  readonly warnings?: readonly string[];
}

export interface DocumentParseResult extends DocumentParseProviderResult {
  readonly provider: DocumentParseProviderId;
  readonly mode: DocumentParseModeId;
  readonly state: 'done';
  readonly warnings: readonly string[];
}

export interface DocumentParseOptions {
  readonly modelVersion?: 'pipeline' | 'vlm' | 'MinerU-HTML';
  readonly language?: string;
  readonly pageRange?: string;
  readonly isOcr?: boolean;
  readonly enableTable?: boolean;
  readonly enableFormula?: boolean;
  readonly useDocOrientationClassify?: boolean;
  readonly useDocUnwarping?: boolean;
  readonly useChartRecognition?: boolean;
  /** Test-only cap for provider polling; not exposed as a user preference. */
  readonly timeoutMs?: number;
}

export interface DocumentParseRequest {
  readonly path?: string;
  readonly url?: string;
  readonly provider?: string;
  readonly mode?: string;
  readonly options?: DocumentParseOptions;
}

export interface DocumentParseProvider {
  readonly descriptor: DocumentParseProviderDescriptor;
  parse(request: DocumentParseRequest, credentials: Record<string, string>, signal?: AbortSignal): Promise<DocumentParseProviderResult>;
}

export interface DocumentParseUsageSnapshot {
  readonly calls: number;
  readonly pages: number;
  readonly lastAt: string | null;
}

export interface DocumentParseState {
  enabled: boolean;
  lastErrors?: Record<string, { code: string; at: string; retryAfter: number | null; mode?: string | null }>;
}

export interface DocumentParseProviderState {
  readonly id: DocumentParseProviderId;
  readonly refs: Record<string, string>;
  readonly configured: boolean;
  readonly credentials: Record<string, { configured: boolean; writable: boolean }> | null;
  readonly usage: DocumentParseUsageSnapshot | null;
  readonly lastError: { code: string; at: string; retryAfter: number | null; mode?: string | null } | null;
}

export interface DocumentParseCapabilities {
  readonly providers: DocumentParseProviderDescriptor[];
  readonly providerStates: Record<string, DocumentParseProviderState>;
  readonly enabled: boolean;
}

export class DocumentParseRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: { provider?: string; mode?: string; alternatives?: string[]; retryAfter?: number | null } = {},
  ) {
    super(message);
    this.name = 'DocumentParseRefusal';
  }
}

export interface DocumentParseService {
  capabilities(): Promise<DocumentParseCapabilities>;
  parse(input: DocumentParseRequest): Promise<DocumentParseResult>;
  setEnabled(enabled: boolean): Promise<DocumentParseCapabilities>;
}
