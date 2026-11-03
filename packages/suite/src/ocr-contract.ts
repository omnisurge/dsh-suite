import type {OcrImage,OcrMode,OcrProvider,OcrRefusalCode} from './ocr-types.js';
export type {OcrImage,OcrLine,OcrProvider,OcrChannelOutcome,OcrPolygonPoint} from './ocr-types.js';

/** One provider's refusal. The code is machine readable; the message is developer diagnosis only (AGENTS 5.10). */
export class OcrRefusal extends Error{
 constructor(readonly code:OcrRefusalCode,message:string){super(message);this.name='OcrRefusal';}
}

/** The public mode vocabulary (ADR-036 D2). Provider private switches never appear here. */
export const OCR_MODES:readonly OcrMode[]=['accurate','handwriting','both'];

export function channelsFor(mode:OcrMode):('accurate'|'handwriting')[]{
 if(mode==='both')return ['accurate','handwriting'];
 return [mode];
}

/** Fail closed before spending bytes: unknown provider, unsupported mode, oversized image. */
export function validateRequest(provider:OcrProvider|null,request:{mode:OcrMode;image:OcrImage}):void{
 if(provider===null)throw new OcrRefusal('OCR_PROVIDER_UNKNOWN','no provider with that id is registered');
 if(!OCR_MODES.includes(request.mode))throw new OcrRefusal('OCR_MODE_UNKNOWN','mode "'+String(request.mode)+'" is not in the vocabulary');
 const wanted=channelsFor(request.mode);
 const missing=wanted.filter(channel=>!provider.descriptor.channels.includes(channel));
 if(missing.length>0)throw new OcrRefusal('OCR_CAPABILITY_UNSUPPORTED',provider.descriptor.id+' does not offer '+missing.join('/'));
 if(request.image.bytes.byteLength===0)throw new OcrRefusal('OCR_IMAGE_EMPTY','the image has no bytes');
 if(request.image.bytes.byteLength>provider.descriptor.maxBytes)throw new OcrRefusal('OCR_IMAGE_TOO_LARGE','the image exceeds '+provider.descriptor.maxBytes+' bytes');
}