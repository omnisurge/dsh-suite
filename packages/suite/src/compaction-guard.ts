/**
 * ADR-099: retired compatibility entry for the former pressure guard.
 *
 * Official compaction owns every entry point. This module deliberately does not
 * resolve services, install wrappers, subscribe to events or restore historical
 * wrappers. A process polluted by an older version requires a fresh start.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ComponentEffectSnapshot } from './types.js';

export const NAME = 'omnisurge-compaction-guard';

/** @deprecated Retained for old configuration documents; all fields are ignored. */
export interface CompactionGuardConfig {
  /** @deprecated Ignored, including an explicit true. */
  readonly enabled?: boolean;
  /** @deprecated Ignored; no cooldown is installed. */
  readonly failureCooldownMs?: number;
  /** @deprecated Ignored; no failure interception is installed. */
  readonly logEachFailure?: boolean;
}

export function apply(ctx: Context, _config: CompactionGuardConfig = {}): void {
  ctx.provide('omnisurgeCompactionGuardStatus', {version:'__OMNISURGE_PACKAGE_VERSION__',snapshot:():ComponentEffectSnapshot=>({protocol:1,scope:'live-agent-bindings',state:'retired',complete:true,total:0,covered:0,waiting:0,rejected:0,unknown:0,reasons:['guard-retired']})});
  ctx.logger.warn('COMPACTION_GUARD_RETIRED', { state: 'retired' });
}

export default { name: NAME, apply };
