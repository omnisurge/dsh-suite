/** Capability descriptor: the facts a caller needs to pick a provider before sending anything (ADR-036 D1). */
export type OcrMode='accurate'|'handwriting'|'both';
export type OcrChannel='accurate'|'handwriting';
export type OcrRefusalCode=
 |'OCR_PROVIDER_UNKNOWN'
 |'OCR_MODE_UNKNOWN'
 |'OCR_CAPABILITY_UNSUPPORTED'
 |'OCR_IMAGE_EMPTY'
 |'OCR_IMAGE_TOO_LARGE'
 |'OCR_IMAGE_UNSUPPORTED'
 |'OCR_DISABLED'
 |'OCR_CROP_UNSUPPORTED'
 |'OCR_CREDENTIAL_MISSING'
 |'OCR_CREDENTIAL_INVALID'
 |'OCR_RATE_LIMITED'
 |'OCR_UPSTREAM_ERROR'
 |'OCR_NO_TEXT'
 |'PDF_RASTERIZER_MISSING'
 |'PDF_PAGE_OUT_OF_RANGE'
 |'PDF_PAGE_RANGE_INVALID'
 |'PDF_UNREADABLE'
 |'PDF_PAGE_BUDGET_EXCEEDED';

export interface OcrProviderDescriptor{
 /** Stable id used in config keys and results. */
 readonly id:string;
 /** Client dictionary key for the display name; the Host never sends a finished sentence. */
 readonly displayKey:string;
 readonly channels:readonly OcrChannel[];
 readonly inputs:readonly ('image'|'pdf')[];
 readonly returnsConfidence:boolean;
 readonly returnsPolygon:boolean;
 readonly maxBytes:number;
}
export interface OcrImage{bytes:Uint8Array;mediaType:'image/png'|'image/jpeg';}
export interface OcrPolygonPoint{x:number;y:number;}
export interface OcrLine{text:string;confidence:number;polygon:OcrPolygonPoint[];}
export interface OcrChannelOutcome{channel:OcrChannel;lines:OcrLine[];requestId:string|null;ms:number;}
/** One provider's live configuration state; the card renders one credential pair from its refs map. */
export interface OcrProviderState{
 readonly id:string;
 readonly refs:Record<string,string>;
 readonly configured:boolean;
 readonly credentials:Record<string,{configured:boolean;writable:boolean}>|null;
 readonly usage:OcrUsageSnapshot|null;
}
/** Durable image reference accepted by the agent tool; mirrors the official attachment reference shape. */
export interface OcrImageAttachment{
 readonly attachmentId:string;
 readonly mediaType:'image/png'|'image/jpeg'|'image/webp'|'image/gif';
 readonly bytes:number;
 readonly width:number;
 readonly height:number;
 readonly name?:string;
}

/** What a provider must be able to do; checked before a request is sent (ADR-036 D1). */
export interface OcrProvider{
 readonly descriptor:OcrProviderDescriptor;
 recognize(request:{channel:OcrChannel;image:OcrImage;credentials:Record<string,string>}):Promise<OcrChannelOutcome>;
}

/** Boundary types for the three OCR Remote methods. typert requires the return type of a Remote to be
 * exported from a public non-root type subpath (./ocr-types), so the wire shapes live here rather than in
 * ocr-service.ts; the service returns structurally identical values. */
export interface OcrUsageSnapshot{calls:number;pages:number;lines:number;lastAt:string|null}
export interface OcrChannelResult{channel:OcrChannel;lines:OcrLine[];ms:number}
export interface OcrReconciledLine{
 page:number;
 channels:{channel:OcrChannel;text:string;confidence:number;polygon:OcrPolygonPoint[]}[];
 agreement:boolean;
 similarity:number;
 disagreements:{a:string;b:string}[];
 confirmed:string|null;
}
export interface OcrCapabilities{
 providers:OcrProviderDescriptor[];
 /** Per-provider credential references, presence and usage facts. The card reads one entry at a time. */
 providerStates:Record<string,OcrProviderState>;
 /** Provider the capability uses by default; the card switches it through ocrSetProvider. */
 selectedProvider:string;
 /** Whether the user switched the capability on; off means the tool refuses, not that it is missing. */
 enabled:boolean;
 /** Legacy selected-provider view retained for older clients and tool consumers. */
 refs:{secretId:string;secretKey:string};
 provider:string;
 configured:boolean;
 maxPages:number;
 usage:OcrUsageSnapshot|null;
 credentials:{secretId:{configured:boolean;writable:boolean};secretKey:{configured:boolean;writable:boolean}}|null;
}
export interface OcrRecognizeResult{
 provider:string;pages:number[];
 /** The raster resolution the polygons are measured in, so a crop can convert pixels to points. */
 dpi:number;
 channels:OcrChannelResult[];
 lines:OcrLine[];
 reconciled:OcrReconciledLine[];
 usageRecorded:boolean;
}
export interface OcrRenderResult{path:string;width:number;height:number;dpi:number;box:{x0:number;y0:number;x1:number;y1:number}|null;temporary:boolean;}
