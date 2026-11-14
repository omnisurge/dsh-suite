/**
 * Narrow adapter over the public SlotRegistry surface used by the model seat.
 *
 * The official ModelSelect entry is not exported from its package. The seat
 * reads the registered entry itself and renders the official component from
 * the same entry; this file keeps the structural types and slot read helpers
 * separate from the React wrapper.
 */
export const MODEL_SLOT = 'conversation.input.model'
export const MODEL_LABEL_SLOT = 'conversation.input.model.label'
export const MODEL_OPTIONS_SLOT = 'conversation.input.model.options'

export interface SlotEntryOptions {
  readonly priority?: number
  readonly order?: number
  readonly id?: string
  readonly [key: string]: unknown
}

/** The subset of a registered slot entry the adapter needs. */
export interface SlotEntry {
  readonly component: unknown
  readonly options: SlotEntryOptions
  readonly children?: Readonly<Record<string, unknown>>
  readonly locale?: string
  readonly inject?: (sessionId: string) => Record<string, unknown>
}

/** Read-only slot access plus the locale binding face used for official entries. */
export interface SlotHost {
  readonly entries: (key: string) => readonly SlotEntry[]
  readonly entriesOfSlot: (key: string) => readonly SlotEntry[]
  readonly subscribe: (key: string, listener: () => void) => () => void
  readonly bindLocale: (namespace: string) => (key: string, vars?: Record<string, unknown>) => string
}

/** The official parent entry owns both child declarations; identify it by that ownership. */
export function isOfficialModelEntry(entry: SlotEntry): boolean {
  return entry.locale === 'model'
    && entry.children !== undefined
    && Object.prototype.hasOwnProperty.call(entry.children, MODEL_OPTIONS_SLOT)
}

/** Stable list order matching the slot renderer: priority first, then order. */
export function orderSlotEntries(entries: readonly SlotEntry[]): readonly SlotEntry[] {
  return [...entries].sort((left, right) => {
    const priority = (left.options.priority ?? 0) - (right.options.priority ?? 0)
    if (priority !== 0) return priority
    return (left.options.order ?? 0) - (right.options.order ?? 0)
  })
}

