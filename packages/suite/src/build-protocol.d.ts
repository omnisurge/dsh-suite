/** Types only. Runtime definitions are copied byte-for-byte from scripts/shared/build-protocol.mjs. */
import type {BuildCapabilities,BuildResult} from './types.js';
export declare const SUITE_DEVELOPMENT_PROTOCOL:string;
export declare const BUILDER_VERSION:string;
export declare const ENTRY_FILES:ReadonlyArray<string>;
export declare const CAPABILITY_OWNERS:Readonly<Record<keyof BuildCapabilities,'host'|'client'>>;
export declare const REQUIRED_CAPABILITIES:ReadonlyArray<keyof BuildCapabilities>;
export declare const RECEIPT_PREFIX:string;
export declare const ERROR_PREFIX:string;
export declare function bootstrapRequired(message:string):Error;
export declare function verifyBuildReceipt(value:unknown,protocol?:string):BuildResult;
