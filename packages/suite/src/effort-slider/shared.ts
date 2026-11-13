/**
 * ADR-020: reasoning-effort slider — pure helpers shared by client and tests.
 * 档位语义全部来自目录（适配器声明），本文件不做任何硬编码档位。
 */

/** One selectable effort exactly as the owning adapter advertised it. */
export interface EffortLevel {
  readonly id: string;
  readonly name: string;
}

export const CHAT_ROUTE_PATH = '/plugin-security/channel/route'
export const CHAT_ROUTE_API_VERSION = 1

export function chatRouteUrl(sessionId: string): string {
  return `${CHAT_ROUTE_PATH}?sessionId=${encodeURIComponent(sessionId)}`
}

export type ChatRouteStatus = 'planned' | 'resolved' | 'unavailable' | 'stale'
export type ChatRouteKind = 'inherit' | 'explicit' | 'fallback' | 'host-default'
export type ChatRouteEvidenceSource = 'request/context'

export interface ChatRouteModel {
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
}

export interface ChatRouteEvidence {
  readonly requestId?: string;
  readonly turn?: number;
  readonly step?: number;
  readonly source: ChatRouteEvidenceSource;
  readonly observedAt: number;
}

export interface ChatRouteSnapshot {
  readonly version: 1;
  readonly status: ChatRouteStatus;
  readonly instance: { readonly channelId: string; readonly accountId: string };
  readonly scope?: string;
  readonly conversationId?: string;
  readonly configRevision: string;
  readonly sessionId: string;
  readonly transportId?: string;
  readonly generation?: number;
  readonly routeKind?: ChatRouteKind;
  readonly decisionAt?: number;
  readonly planned?: ChatRouteModel;
  readonly resolved?: ChatRouteModel;
  readonly evidence?: ChatRouteEvidence;
  readonly staleOf?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

export function useChatReadOnlySeat(omniwc: string | undefined): boolean {
  return omniwc === "chat";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function modelRoute(value: unknown): ChatRouteModel | undefined {
  const body = record(value)
  if (!body || !nonEmptyString(body.provider) || !nonEmptyString(body.model)
    || typeof body.effort !== 'string') return undefined
  return {
    provider: body.provider,
    model: body.model,
    effort: body.effort,
  }
}

function routeEvidence(value: unknown): ChatRouteEvidence | undefined {
  const body = record(value)
  if (!body || !finiteNumber(body.observedAt)
    || body.source !== 'request/context') return undefined
  if (body.requestId !== undefined && !nonEmptyString(body.requestId)) return undefined
  if (body.turn !== undefined && !nonNegativeInteger(body.turn)) return undefined
  if (body.step !== undefined && !nonNegativeInteger(body.step)) return undefined
  return {
    ...(body.requestId === undefined ? {} : { requestId: body.requestId }),
    ...(body.turn === undefined ? {} : { turn: body.turn }),
    ...(body.step === undefined ? {} : { step: body.step }),
    source: body.source,
    observedAt: body.observedAt,
  }
}

function sameRouteLineage(left: ChatRouteSnapshot, right: ChatRouteSnapshot): boolean {
  return left.configRevision === right.configRevision
    && left.transportId === right.transportId
    && left.generation === right.generation
}

/**
 * Accept a snapshot only when the contract carries enough facts to prove that
 * it is not older than the currently rendered decision. Config revisions are
 * opaque identifiers: equality is meaningful, lexical ordering is not.
 */
export function chatRouteSnapshotCanReplace(
  previous: ChatRouteSnapshot | undefined,
  next: ChatRouteSnapshot,
): boolean {
  if (previous === undefined) return true
  if (previous.sessionId !== next.sessionId) return false

  // A failure is an explicit invalidation. It must not retain an older
  // resolved model merely because its opaque revision cannot be ordered.
  if (next.status === 'stale' || next.status === 'unavailable') return true

  if (previous.decisionAt !== undefined && next.decisionAt !== undefined) {
    if (next.decisionAt < previous.decisionAt) return false
    if (next.decisionAt === previous.decisionAt && !sameRouteLineage(previous, next)) return false
    return true
  }

  return previous.status === 'stale' || previous.status === 'unavailable'
}

function chatRouteKind(value: unknown): value is ChatRouteKind {
  return value === 'inherit' || value === 'explicit'
    || value === 'fallback' || value === 'host-default'
}

/**
 * Parse the versioned route projection. A legacy primary/runtime payload is
 * deliberately rejected: it cannot prove which model the current request used.
 */
export function parseChatRouteSnapshot(
  value: unknown,
  expectedSessionId: string,
): ChatRouteSnapshot | undefined {
  const body = record(value)
  const instance = record(body?.instance)
  if (!body || body.version !== CHAT_ROUTE_API_VERSION
    || (body.status !== 'planned' && body.status !== 'resolved'
      && body.status !== 'unavailable' && body.status !== 'stale')
    || !instance || !nonEmptyString(instance.channelId) || !nonEmptyString(instance.accountId)
    || !nonEmptyString(body.configRevision) || !nonEmptyString(body.sessionId)
    || body.sessionId !== expectedSessionId) return undefined

  if (body.scope !== undefined && !nonEmptyString(body.scope)) return undefined
  if (body.conversationId !== undefined && !nonEmptyString(body.conversationId)) return undefined
  if (body.transportId !== undefined && !nonEmptyString(body.transportId)) return undefined
  if (body.generation !== undefined && !nonNegativeInteger(body.generation)) return undefined
  if ((body.transportId === undefined) !== (body.generation === undefined)) return undefined
  const routeKind = body.routeKind
  if (routeKind !== undefined && !chatRouteKind(routeKind)) return undefined
  if (body.decisionAt !== undefined && !finiteNumber(body.decisionAt)) return undefined

  const base = {
    version: 1 as const,
    status: body.status,
    instance: { channelId: instance.channelId, accountId: instance.accountId },
    ...(body.scope === undefined ? {} : { scope: body.scope }),
    ...(body.conversationId === undefined ? {} : { conversationId: body.conversationId }),
    configRevision: body.configRevision,
    sessionId: body.sessionId,
    ...(body.transportId === undefined ? {} : { transportId: body.transportId, generation: body.generation }),
    ...(routeKind === undefined ? {} : { routeKind }),
    ...(body.decisionAt === undefined ? {} : { decisionAt: body.decisionAt }),
  } as const

  if (body.status === 'planned') {
    const planned = modelRoute(body.planned)
    if (!planned || routeKind === undefined || body.decisionAt === undefined) return undefined
    return { ...base, status: 'planned', planned }
  }

  if (body.status === 'resolved') {
    const resolved = modelRoute(body.resolved)
    const evidence = routeEvidence(body.evidence)
    if (!resolved || !evidence || routeKind === undefined || body.decisionAt === undefined) return undefined
    return { ...base, status: 'resolved', resolved, evidence }
  }

  if (body.status === 'stale') {
    if (!nonEmptyString(body.staleOf)) return undefined
    return { ...base, status: 'stale', staleOf: body.staleOf }
  }

  if (body.error !== undefined) {
    const error = record(body.error)
    if (!error || !nonEmptyString(error.code) || !nonEmptyString(error.message)) return undefined
    return { ...base, status: 'unavailable', error: { code: error.code, message: error.message } }
  }
  return { ...base, status: 'unavailable' }
}

/** 档位够不够显示滑块：至少两档才有滑的意义（官方 label 同理）。 */
export function sliderEligible(levels: readonly EffortLevel[]): boolean {
  return levels.length >= 2;
}

/** 档位 id → 在列表中的下标；-1 = 不在。 */
export function effortIndex(levels: readonly EffortLevel[], id: string | undefined): number {
  return levels.findIndex((level) => level.id === id);
}

/** 连续值吸附到最近档位（snap-on-release）。 */
export function clampIndex(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(value)));
}

/**
 * 滑块应停留的档位：当前会话档位 > 适配器默认档 > 中间档。
 * 目录为空/未声明时返回 -1（调用方自行隐藏）。
 */
export function effectiveEffortIndex(
  levels: readonly EffortLevel[],
  currentEffort: string | undefined,
  defaultEffort: string | undefined,
): number {
  const current = effortIndex(levels, currentEffort);
  if (current >= 0) return current;
  const fallback = effortIndex(levels, defaultEffort);
  if (fallback >= 0) return fallback;
  if (levels.length === 0) return -1;
  return Math.floor((levels.length - 1) / 2);
}

/** 指针横向位置 → 连续档位值（不做吸附，吸附在释放时）。 */
export function rawFromClientX(
  bounds: { left: number; width: number },
  clientX: number,
  count: number,
): number {
  if (bounds.width <= 0 || count < 2) return 0;
  return Math.max(0, Math.min(count - 1, ((clientX - bounds.left) / bounds.width) * (count - 1)));
}
