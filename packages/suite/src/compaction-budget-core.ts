/** Budget-only checks around one unwrapped official summarize call (ADR-100).
 * No generation, routing defaults, session writes, or hook installation lives here.
 * TokenMeter is heuristic; these checks do not assert provider-exact token counts.
 */
export interface BudgetPolicy {
  checkpointTokens: number
  safetyTokens: number
  timeoutMs: number
}

// Local structural contracts avoid another SDK runtime dependency.
export interface BudgetBlock { readonly type: string; readonly text?: string }
export interface BudgetMessage { readonly role: string; readonly content: readonly BudgetBlock[] }
export interface BudgetSummaryInput {
  readonly messages: readonly BudgetMessage[]
  readonly tools?: readonly unknown[]
}
export interface BudgetSummaryResult {
  readonly summary: readonly BudgetBlock[]
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
  readonly rawOutput?: readonly BudgetBlock[]
  readonly usage?: unknown
  readonly llmStreamCall?: true
}
interface Target { readonly provider: string; readonly model: string }
interface SummaryFields {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}
export interface BudgetService {
  readonly config: SummaryFields & {
    readonly modelPolicies: readonly (Target & Partial<SummaryFields>)[]
  }
  readonly ctx: {
    readonly tokenMeter: { estimateMessage(message: BudgetMessage): number }
    readonly llm: {
      resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ readonly context?: { readonly contextWindow: number } }>
    }
  }
}
export interface BudgetAgent {
  readonly options: { readonly provider?: string; readonly model?: string }
  readonly session: { requestHeader(): { readonly config: Target } | undefined }
}
export type BudgetOriginalSummary<Result extends BudgetSummaryResult = BudgetSummaryResult> =
  (input: BudgetSummaryInput, agent: BudgetAgent, signal?: AbortSignal) => Promise<Result>

export const OFFICIAL_INSTRUCTION_RESERVE = 2048 // Integration must validate the pinned instruction.
export const CHECKPOINT_FRAMING_RESERVE = 94 // Integration must validate the pinned official frame.
export const MINIMUM_BODY_TOKENS = 32 // Preferred body floor only, never a feasibility or acceptance limit.
export const SOURCE_TARGET_RATIO = 0.5 // Compatibility export: input-message heuristic for advice, not a source/hard limit.

function fail(code: string): never {
  // Machine-only diagnostics: no history, tools, or generated text.
  throw Object.assign(new Error(code), { code })
}
function integer(value: unknown, minimum: number, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail(code)
  return value
}
function add(left: number, right: number): number {
  return integer(left + right, 0, 'COMPACTION_BUDGET_ESTIMATE_INVALID')
}
function pair(provider: unknown, model: unknown): Target | undefined {
  if (provider === undefined && model === undefined) return undefined
  if (provider === '' && model === '') return undefined
  if (typeof provider !== 'string' || typeof model !== 'string'
    || provider.trim().length === 0 || model.trim().length === 0) fail('COMPACTION_BUDGET_ROUTE_INVALID')
  return { provider, model }
}
function availableTarget(provider: unknown, model: unknown): Target | undefined {
  return typeof provider === 'string' && provider.length > 0
    && typeof model === 'string' && model.length > 0 ? { provider, model } : undefined
}
function envelope(service: BudgetService, agent: BudgetAgent): Target & { maxTokens: number } {
  const latest = agent.session.requestHeader()?.config
  // Policy selection ignores incomplete committed/options pairs, as the
  // official conversationTarget does. An explicit summary may still be valid.
  const committed = latest === undefined ? undefined : availableTarget(latest.provider, latest.model)
  const options = availableTarget(agent.options.provider, agent.options.model)
  const conversation = committed ?? options
  const config = service.config
  if (typeof config.summarizationProvider !== 'string' || typeof config.summarizationModel !== 'string'
    || !Array.isArray(config.modelPolicies)) fail('COMPACTION_BUDGET_CONFIG_INVALID')
  integer(config.maxTokens, 1, 'COMPACTION_BUDGET_CAP_INVALID')
  const override = conversation === undefined ? undefined : config.modelPolicies.find(row =>
    row.provider === conversation.provider && row.model === conversation.model)
  // Only the three already-resolved official summary fields are projected.
  const summary = pair(override?.summarizationProvider ?? config.summarizationProvider,
    override?.summarizationModel ?? config.summarizationModel)
  // Official summarizeWithLlm uses the present latest envelope (even when
  // unusable) before options. Do not silently reroute that invalid request.
  const target = summary ?? (latest === undefined ? options : committed)
  if (target === undefined) fail('COMPACTION_BUDGET_ROUTE_INVALID')
  return { ...target, maxTokens: integer(override?.maxTokens ?? config.maxTokens, 1, 'COMPACTION_BUDGET_CAP_INVALID') }
}
function textMessage(role: string, text: string): BudgetMessage {
  return { role, content: [{ type: 'text', text }] }
}

/** Service must be the effective invocation receiver, never a cached discovery proxy (ADR-101).
 * Preflight reads and the unwrapped official method share that exact receiver.
 * Await cooperative cancellation: this promise never settles before the delegated official method does.
 */
export async function runBudgetSummary<Result extends BudgetSummaryResult>(
  service: BudgetService,
  original: BudgetOriginalSummary<Result>,
  input: BudgetSummaryInput,
  agent: BudgetAgent,
  policy: BudgetPolicy,
  signal?: AbortSignal,
): Promise<Result> {
  signal?.throwIfAborted()
  const snapshot = Object.freeze({
    checkpointTokens: integer(policy.checkpointTokens, 1, 'COMPACTION_BUDGET_POLICY_INVALID'),
    safetyTokens: integer(policy.safetyTokens, 0, 'COMPACTION_BUDGET_POLICY_INVALID'),
    timeoutMs: integer(policy.timeoutMs, 1, 'COMPACTION_BUDGET_POLICY_INVALID'),
  })
  if (snapshot.timeoutMs > 2_147_483_647) fail('COMPACTION_BUDGET_POLICY_INVALID')
  const controller = new AbortController()
  const combinedSignal = controller.signal
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Compaction budget deadline exceeded', 'TimeoutError')),
    snapshot.timeoutMs)
  try {
    const predicted = envelope(service, agent)
    const info = await service.ctx.llm.resolveModelInfo(predicted.provider, predicted.model, combinedSignal)
    combinedSignal.throwIfAborted()
    const window = integer(info.context?.contextWindow, 1, 'COMPACTION_BUDGET_WINDOW_INVALID')
    const estimate = (message: BudgetMessage) => integer(service.ctx.tokenMeter.estimateMessage(message),
      0, 'COMPACTION_BUDGET_ESTIMATE_INVALID')
    // Under the pinned meter/frame a nonempty text checkpoint needs at least
    // 8 message tokens + ceil(1 / 4) text token + 94 framing tokens. This is
    // only mechanical space, not a guarantee of the required semantic fidelity.
    if (snapshot.checkpointTokens < 103) fail('COMPACTION_BUDGET_TARGET_TOO_SMALL')
    let inputTokens = 0
    for (const message of input.messages) inputTokens = add(inputTokens, estimate(message))
    // All input messages inform advice only, including any fixed head or later
    // system messages. This is not the selected history cost or a shrink proof;
    // only the official transaction owns selection and strict net reduction.
    const preferred = Math.min(snapshot.checkpointTokens, Math.max(
      CHECKPOINT_FRAMING_RESERVE + MINIMUM_BODY_TOKENS, Math.floor(inputTokens * SOURCE_TARGET_RATIO)))
    const bodyHardLimit = snapshot.checkpointTokens - CHECKPOINT_FRAMING_RESERVE
    const preferredBody = preferred - CHECKPOINT_FRAMING_RESERVE
    const instruction = textMessage('user', [
      'Additional checkpoint budget constraint for the following official summarization request:',
      'Aim for a summary body within ' + preferredBody + ' estimated tokens (preferred, not a hard limit); '
        + 'the preferred complete checkpoint target is ' + preferred + '.',
      'The hard summary body limit is ' + bodyHardLimit + ' estimated tokens; the hard complete checkpoint limit is '
        + snapshot.checkpointTokens + ', including ' + CHECKPOINT_FRAMING_RESERVE + ' tokens reserved for framing.',
      'Keep the required official structure. Use concise text only; do not emit images or tool calls.',
      'Preserve goals, authorization and prohibitions, corrections, unfinished work, exact identifiers and paths, and active resources.',
      'Consolidate any earlier checkpoint rather than copying it unchanged. Summarize the history selected by the official request.',
    ].join('\n'))
    inputTokens = add(inputTokens, estimate(instruction))
    if (input.tools !== undefined && input.tools.length > 0) {
      const json = JSON.stringify(input.tools)
      // Conservative schema bound; not a claim about provider tokenization.
      inputTokens = add(inputTokens, Math.max(estimate(textMessage('system', json)), new TextEncoder().encode(json).byteLength))
    }
    const required = add(add(add(inputTokens, OFFICIAL_INSTRUCTION_RESERVE), snapshot.safetyTokens), predicted.maxTokens)
    if (required > window) fail('COMPACTION_BUDGET_INPUT_TOO_LARGE')
    combinedSignal.throwIfAborted()
    const augmentedInput = { ...input, messages: [...input.messages, instruction] }
    const result = await Reflect.apply(original, service, [augmentedInput, agent, combinedSignal]) as Result
    // Await first, then reject abandoned candidates; no Promise.race orphan.
    combinedSignal.throwIfAborted()
    if (result.provider !== predicted.provider || result.model !== predicted.model || result.maxTokens !== predicted.maxTokens)
      fail('COMPACTION_BUDGET_ENVELOPE_MISMATCH')
    if (!Array.isArray(result.summary) || result.summary.length === 0
      || result.summary.some(block => block.type !== 'text' || typeof block.text !== 'string')
      || !result.summary.some(block => block.text!.trim().length > 0)) fail('COMPACTION_BUDGET_SUMMARY_INVALID')
    if (!Array.isArray(result.rawOutput) || result.rawOutput.length === 0
      || result.rawOutput.some(block => block.type !== 'text' && block.type !== 'reasoning')
      || !result.rawOutput.some(block => block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0))
      fail('COMPACTION_BUDGET_RAW_OUTPUT_INVALID')
    const body = estimate({ role: 'user', content: result.summary })
    if (add(body, CHECKPOINT_FRAMING_RESERVE) > snapshot.checkpointTokens) fail('COMPACTION_BUDGET_SUMMARY_TOO_LARGE')
    return result // Preserve official result identity, usage, output, call provenance.
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
