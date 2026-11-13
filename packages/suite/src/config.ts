import type {Volatile} from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import {homedir} from 'node:os';
import {join} from 'node:path';
/** The default self-upgrade source is the public release repository (ADR-080 D2); the local release
 * directory remains available to developers, and discovery never installs anything without an explicit
 * version-bound consent. */
export const DEFAULT_RELEASE_DIRECTORY=join(homedir(),'Omnisurge','releases');
export interface LimitModeConfig{enabled:boolean;models:string[];text:string;}
/** ADR-068/ADR-080: where new Suite releases come from. `github` is the factory default and names the
 * public release repository (`omnisurge/dsh-suite`, channel `stable`); `local` is the historical
 * release directory a developer can still select. The kind is a closed set: an unreadable value keeps the
 * factory default instead of inventing a third source. */
export type UpdateSourceKind='local'|'github';
export type ReleaseChannel='stable'|'prerelease';
export interface UpdateSource {
 kind:UpdateSourceKind;
 owner:string;
 repo:string;
 channel:ReleaseChannel;
 /** Name of a credential reference (never the secret). Blank means "public repository, no token". */
 credentialRef:string;
}
export const DEFAULT_UPDATE_SOURCE:UpdateSource={kind:'github',owner:'omnisurge',repo:'dsh-suite',channel:'stable',credentialRef:''};
/** GitHub owner/repository names: alphanumerics plus `._-`; no slashes, no whitespace, no path parts.
 * Empty is allowed: it is the "not configured yet" default of a field the source can leave unused. */
const REPOSITORY_NAME=/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/;
/** A credential reference is a POSIX shell identifier, exactly like the search row's reference field. */
const CREDENTIAL_REF_NAME=/^(?:[A-Za-z_][A-Za-z0-9_]*)?$/;
export const UpdateSourceSchema=z.object({
 kind:z.union(['local','github'] as const).default('github').description('Where new Suite releases come from: the public GitHub Release repository (default), or a local release directory a developer selects.'),
 owner:z.string().pattern(REPOSITORY_NAME).default('omnisurge').description('GitHub repository owner, for example "omnisurge". Required when the source is github.'),
 repo:z.string().pattern(REPOSITORY_NAME).default('dsh-suite').description('GitHub repository name, for example "dsh-suite". Required when the source is github.'),
 channel:z.union(['stable','prerelease'] as const).default('stable').description('stable asks for the latest published release; prerelease also accepts pre-releases.'),
 credentialRef:z.string().pattern(CREDENTIAL_REF_NAME).role('credential-ref').default('').description('Credential reference holding a read-only token for a private repository. Blank for public repositories; the secret is never stored here.'),
});
export interface Config {releaseDirectory:Volatile<string>;updateSource:Volatile<UpdateSource>;multimodal:Volatile<OcrConfig>;}

/** ADR-036 D4: credentials are references, never values. Both references are POSIX identifiers, so a user
 * who types a secret into the reference field is rejected instead of storing it. */
export type OcrProviderId='tencent'|'baidu';
export interface OcrConfig{
 provider:OcrProviderId;
 /** Tencent Cloud pair. */
 secretIdRef:string;
 secretKeyRef:string;
 /** Baidu Intelligent Cloud pair. */
 baiduApiKeyRef:string;
 baiduSecretKeyRef:string;
 /** ADR-086 document parsing credentials; never values. */
 mineruApiKeyRef:string;
 paddleOcrTokenRef:string;
 maxPages:number;
}
/** The reference names are product-defined, exactly as the confirmed design shows them: the user pastes
 * a value into the card, the card writes it through the official credential service under these names, and
 * the configuration only ever holds the names. */
export const OCR_SECRET_ID_REF='OMNISURGE_OCR_SECRET_ID';
export const OCR_SECRET_KEY_REF='OMNISURGE_OCR_SECRET_KEY';
export const BAIDU_OCR_API_KEY_REF='OMNISURGE_BAIDU_OCR_API_KEY';
export const BAIDU_OCR_SECRET_KEY_REF='OMNISURGE_BAIDU_OCR_SECRET_KEY';
export const MINERU_API_KEY_REF='OMNISURGE_MINERU_API_KEY';
export const PADDLEOCR_TOKEN_REF='OMNISURGE_PADDLEOCR_TOKEN';
export const DEFAULT_OCR_CONFIG:OcrConfig={provider:'tencent',secretIdRef:OCR_SECRET_ID_REF,secretKeyRef:OCR_SECRET_KEY_REF,baiduApiKeyRef:BAIDU_OCR_API_KEY_REF,baiduSecretKeyRef:BAIDU_OCR_SECRET_KEY_REF,mineruApiKeyRef:MINERU_API_KEY_REF,paddleOcrTokenRef:PADDLEOCR_TOKEN_REF,maxPages:40};
export const OcrConfigSchema=z.object({
 provider:z.union(['tencent','baidu'] as const).default('tencent').description('Which OCR supplier the capability uses by default. The card can switch it; switching affects this card only.'),
 secretIdRef:z.string().pattern(CREDENTIAL_REF_NAME).role('credential-ref').default(OCR_SECRET_ID_REF).description('Credential reference holding the Tencent SecretId. The value itself never enters this file; the card writes it through the official credential service.'),
 secretKeyRef:z.string().pattern(CREDENTIAL_REF_NAME).role('credential-ref').default(OCR_SECRET_KEY_REF).description('Credential reference holding the Tencent SecretKey. The value itself never enters this file; the card writes it through the official credential service.'),
 baiduApiKeyRef:z.string().pattern(CREDENTIAL_REF_NAME).role('credential-ref').default(BAIDU_OCR_API_KEY_REF).description('Credential reference holding the Baidu API Key. The value itself never enters this file; the card writes it through the official credential service.'),
 baiduSecretKeyRef:z.string().pattern(CREDENTIAL_REF_NAME).role('credential-ref').default(BAIDU_OCR_SECRET_KEY_REF).description('Credential reference holding the Baidu Secret Key. The value itself never enters this file; the card writes it through the official credential service.'),
 mineruApiKeyRef:z.string().pattern(CREDENTIAL_REF_NAME).role('credential-ref').default(MINERU_API_KEY_REF).description('Credential reference holding the optional MinerU API token used by the precise document parsing mode.'),
 paddleOcrTokenRef:z.string().pattern(CREDENTIAL_REF_NAME).role('credential-ref').default(PADDLEOCR_TOKEN_REF).description('Credential reference holding the PaddleOCR API token used by all PaddleOCR document parsing modes.'),
 maxPages:z.number().min(1).max(200).default(40).description('How many pages one recognition call may render. A longer document is refused with the page count, so the caller can pass a range.'),
});
export function normalizeOcrConfig(value:unknown):OcrConfig{
 const wrapper=value!==null&&typeof value==='object'?value as Record<PropertyKey,unknown>:null;
 const read=wrapper!==null&&VOLATILE_WRITE in wrapper?wrapper.get:undefined;
 const candidate=typeof read==='function'?read.call(wrapper):value;
 if(candidate===null||typeof candidate!=='object')return {...DEFAULT_OCR_CONFIG};
 const settings=candidate as Record<string,unknown>;
 const text=(key:keyof OcrConfig,fallback=''):string=>typeof settings[key]==='string'?String(settings[key]).trim():fallback;
 const pages=Number(settings.maxPages);
 return {
  provider:text('provider')==='baidu'?'baidu':'tencent',
  secretIdRef:text('secretIdRef',OCR_SECRET_ID_REF),
  secretKeyRef:text('secretKeyRef',OCR_SECRET_KEY_REF),
  baiduApiKeyRef:text('baiduApiKeyRef',BAIDU_OCR_API_KEY_REF),
  baiduSecretKeyRef:text('baiduSecretKeyRef',BAIDU_OCR_SECRET_KEY_REF),
  mineruApiKeyRef:text('mineruApiKeyRef',MINERU_API_KEY_REF),
  paddleOcrTokenRef:text('paddleOcrTokenRef',PADDLEOCR_TOKEN_REF),
  maxPages:Number.isInteger(pages)&&pages>=1&&pages<=200?pages:DEFAULT_OCR_CONFIG.maxPages,
 };
}

/** The cross-copy volatile protocol symbol: a `.volatile()` field resolves to a live reference whose
 * `get()` must be called for the current value, and the symbol is how every copy of cosmokit agrees on
 * that shape without importing each other's implementation. */
const VOLATILE_WRITE=Symbol.for('cosmokit.volatile.write');
/** Read the source configuration once per operation. A `.volatile()` field resolves to a live reference,
 * so it is unwrapped first; anything unreadable falls back to the factory default (ADR-080 D2: the public
 * release repository). An explicitly selected `local` channel is preserved. */
export function normalizeUpdateSource(value:unknown):UpdateSource{
 const wrapper=value!==null&&typeof value==='object'?value as Record<PropertyKey,unknown>:null;
 const read=wrapper!==null&&VOLATILE_WRITE in wrapper?wrapper.get:undefined;
 const candidate=typeof read==='function'?read.call(wrapper):value;
 if(candidate===null||typeof candidate!=='object')return {...DEFAULT_UPDATE_SOURCE};
 const settings=candidate as Record<string,unknown>;
 const text=(key:string):string=>typeof settings[key]==='string'?String(settings[key]).trim():'';
 return {
  kind:settings.kind==='local'?'local':'github',
  owner:text('owner'),
  repo:text('repo'),
  channel:settings.channel==='prerelease'?'prerelease':'stable',
  credentialRef:text('credentialRef'),
 };
}

/** 极限模式（ADR-058）：默认关闭；文本默认空，所以即使被打开也不会注入空段之外的东西。
 * 这里不做"命中校验"——运行期判定在 limit-mode.ts 里，页面只显示事实。 */
export const Config=z.object({
 releaseDirectory:z.string().default(DEFAULT_RELEASE_DIRECTORY).description('Absolute directory holding one subdirectory per release (manifest.json plus SHA256SUMS). Blank disables the self-upgrade release channel.'),
 updateSource:UpdateSourceSchema.description('Where new Suite releases are discovered: the public GitHub Release repository (default, ADR-080) or a local release directory; a verified download lands in the separate fetched root (ADR-068).').volatile(),
 multimodal:OcrConfigSchema.description('Handwriting and document recognition (ADR-036): which supplier to call, the two credential references it needs, and the per-call page budget. Secrets never live here.').volatile(),
});