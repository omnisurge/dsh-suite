/**
 * ADR-020 effort slider: Codex-style reasoning-effort slider over the
 * official model seat (conversation.input.model, single slot).
 *
 * 视觉素材移植自 dsh-reasoning-effort（HanaAyane，MIT，署名保留）：
 * canvas 辐射光效、滑块轨道/辉光/粒子结构、模型菜单观感（见 styles.ts）；
 * 保留大肥鱼 chibi 资产；仅移除 host 诊断/指引面板（ADR-020）。
 * 交互：Pointer 捕获拖动 + snap-on-release + 乐观提交 + 失败回滚 + 键盘可达。
 */
import * as React from 'react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelSelection, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ModelDirectory,
  ModelDirectoryState,
  ModelDirectoryResolver,
} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  clampIndex,
  chatRouteSnapshotCanReplace,
  effectiveEffortIndex,
  effortIndex,
  chatRouteUrl,
  parseChatRouteSnapshot,
  rawFromClientX,
  useChatReadOnlySeat,
  type EffortLevel,
} from '../shared.js'
import { remoteSelectAccepted, tryDirectoryFor, unwrapCatalog, type CatalogGroup } from '../directory-bind.js'
import { injectStyles, showConfirm, showToast, Switch } from '@omnisurge/dsh-ui'
import { fillTemplate } from '../../shared/client-copy.js'
import { CSS } from './styles.js'
import type { SlotEntry, SlotHost } from './slot-host.js'
import {
  isOfficialModelEntry,
  MODEL_LABEL_SLOT,
  MODEL_OPTIONS_SLOT,
  MODEL_SLOT,
  orderSlotEntries,
} from './slot-host.js'

export const EFFORT_SLIDER_LOCALE_NS = 'omnisurge.effort-slider'

/**
 * Effort slider copy. The namespace is registered from apply(); `en` and `zh` must stay
 * key-identical because the copy inventory gate pairs them by key and placeholder.
 */
export const en = {
  'level.off': 'Off',
  'level.minimal': 'Minimal',
  'level.low': 'Low',
  'level.medium': 'Medium',
  'level.high': 'High',
  'level.xhigh': 'Very high',
  'level.max': 'Max',
  'toast.dismiss': 'Dismiss',
  'effort.caption': 'Thinking effort',
  'effort.ariaLabel': 'Thinking effort',
  'effort.title': 'Thinking effort · {name}',
  'effort.titleError': 'Thinking effort could not be set: {error}',
  'effort.rangeLow': 'Low',
  'effort.rangeHigh': 'High',
  'effort.default': 'Default',
  'effort.error.noLevels': 'The current model does not provide thinking effort levels',
  'effort.error.notApplied': 'The thinking effort change did not take effect',
  'effort.toast.failed': 'Could not change thinking effort: {error}. Try again later or switch models.',
  'chat.status.loading': 'Reading current chat model…',
  'chat.status.failed': 'Could not read current chat model',
  'chat.status.stale': 'Current chat model status has expired',
  'chat.status.followDefault': 'Using the default',
  'chat.effort.unspecified': 'Effort not specified',
  'chat.phase.planned': 'Planned',
  'chat.phase.sessionOverride': 'Session override',
  'chat.phase.fallback': 'Fallback route',
  'chat.phase.appDefault': 'App default',
  'chat.phase.inherited': 'Inherited',
  'chat.phase.stale': 'Expired',
  'chat.ariaLabel': 'Current chat model {title}',
  'chat.unavailable': 'The conversation surface is not ready yet',
  'model.placeholder': 'Select a model',
  'model.loadFailed': 'Could not load the model list. Try again later: {error}',
  'model.selectFailed': 'Could not switch models. Try again later.',
  'model.selectFailedWithError': 'Could not switch models. Try again later: {error}',
  'model.ariaLabel': 'Model {model}',
  'model.loading': 'Loading models…',
  'model.empty': 'No models available',
  'model.menuAriaLabel': 'Model and thinking effort',
  'model.back': 'Select a model',
  'model.triggerAriaLabel': 'Model {model}, thinking effort {effort}',
  'team.saveFailed': 'Could not save the agent team setting: {error}',
  'team.confirmDisableTitle': 'Turn off agent team collaboration?',
  'team.confirmDisableText': 'Turning off agent team collaboration during a conversation stops shared task tools and team coordination instructions.',
  'team.cancel': 'Cancel',
  'team.confirmDisable': 'Turn off',
  'team.switchLabel': 'Enable agent team collaboration',
  'team.unavailable': 'The agent team collaboration channel is unavailable',
  'team.saveFailedShort': 'Save failed',
  'catalog.unavailable': 'The model list is unavailable',
  'model.channelUnavailable': 'The model channel is unavailable',
} as const

export const zh = {
  'level.off': '关闭',
  'level.minimal': '极低',
  'level.low': '低',
  'level.medium': '中',
  'level.high': '高',
  'level.xhigh': '极高',
  'level.max': '最大',
  'toast.dismiss': '关闭',
  'effort.caption': '思考强度',
  'effort.ariaLabel': '思考强度',
  'effort.title': '思考强度 · {name}',
  'effort.titleError': '思考强度设置失败：{error}',
  'effort.rangeLow': '低',
  'effort.rangeHigh': '高',
  'effort.default': '默认',
  'effort.error.noLevels': '当前模型未提供思考强度档位',
  'effort.error.notApplied': '思考强度切换未生效',
  'effort.toast.failed': '思考强度切换未成功：{error}。请稍后重试，或换用其他模型。',
  'chat.status.loading': '正在读取当前对话模型…',
  'chat.status.failed': '暂时无法获取当前对话模型',
  'chat.status.stale': '当前对话模型信息已过期',
  'chat.status.followDefault': '跟随默认',
  'chat.effort.unspecified': '未指定强度',
  'chat.phase.planned': '计划',
  'chat.phase.sessionOverride': '会话覆盖',
  'chat.phase.fallback': '后备路由',
  'chat.phase.appDefault': '应用默认',
  'chat.phase.inherited': '继承',
  'chat.phase.stale': '过期',
  'chat.ariaLabel': '当前对话模型 {title}',
  'chat.unavailable': '会话界面尚未就绪',
  'model.placeholder': '选择模型',
  'model.loadFailed': '模型清单读取失败，请稍后重试：{error}',
  'model.selectFailed': '模型切换未成功，请稍后重试。',
  'model.selectFailedWithError': '模型切换未成功，请稍后重试：{error}',
  'model.ariaLabel': '模型 {model}',
  'model.loading': '正在加载模型…',
  'model.empty': '没有可用模型',
  'model.menuAriaLabel': '模型与思考强度',
  'model.back': '选择模型',
  'model.triggerAriaLabel': '模型 {model}，思考强度 {effort}',
  'team.saveFailed': '智能体团队协作设置保存失败：{error}',
  'team.confirmDisableTitle': '确认停用智能体团队协作？',
  'team.confirmDisableText': '对话过程中停用智能体团队协作，将停止共享任务工具和团队协调指令。',
  'team.cancel': '取消',
  'team.confirmDisable': '确认停用',
  'team.switchLabel': '启用智能体团队协作',
  'team.unavailable': '智能体团队协作通道不可用',
  'team.saveFailedShort': '保存失败',
  'catalog.unavailable': '模型清单不可用',
  'model.channelUnavailable': '模型通道不可用',
} as const

export type EffortSliderCopyKey = keyof typeof zh
export type EffortSliderTranslate = (key: EffortSliderCopyKey, vars?: Record<string, unknown>) => string

/** Translate through the shipped dictionaries; the fallback keeps the previous Chinese copy without a locale service. */
export function effortSliderTranslate(locale: 'en' | 'zh', key: EffortSliderCopyKey, vars?: Record<string, unknown>): string {
  const table = locale === 'en' ? en : zh
  return fillTemplate(table[key], vars)
}

export const defaultEffortSliderTranslate: EffortSliderTranslate = (key, vars) => effortSliderTranslate('zh', key, vars)

export const inject = ['slots', 'remote', 'remote.session', 'locale']

const SLOT = MODEL_SLOT
const CHAT_ROUTE_REQUEST_TIMEOUT_MS = 1_500

const LEVEL_KEYS: Record<string, EffortSliderCopyKey> = {
  off: 'level.off',
  minimal: 'level.minimal',
  low: 'level.low',
  medium: 'level.medium',
  high: 'level.high',
  xhigh: 'level.xhigh',
  max: 'level.max',
}

function levelName(level: string, t: EffortSliderTranslate): string {
  const key = LEVEL_KEYS[level]
  return key === undefined ? level : t(key)
}

function toastPluginError(t: EffortSliderTranslate, text: string): void {
  showToast({
    kind: 'omnieff-error',
    tone: 'danger',
    text,
    closeLabel: t('toast.dismiss'),
  })
}

function currentModel(state: ModelDirectoryState) {
  if (state.current === null) return undefined
  const group = state.groups.find((candidate) => candidate.id === state.current?.provider)
  return group?.models.find((candidate) => candidate.id === state.current?.model)
}

/** 当前模型声明的档位（适配器顺序）；<2 档坍缩为空。 */
function sliderLevels(state: ModelDirectoryState): readonly EffortLevel[] {
  const efforts = currentModel(state)?.reasoning?.efforts
  return efforts !== undefined && efforts.length >= 2 ? efforts : []
}

/**
 * The official ModelSelect only uses the model metadata to decide whether to
 * render its own effort row. The seat drops that metadata from the view the
 * official component sees; the original directory remains the write owner.
 */
function stripReasoning(state: ModelDirectoryState): ModelDirectoryState {
  return {
    ...state,
    groups: state.groups.map((group) => ({
      ...group,
      models: group.models.map((model) => {
        if (model.reasoning === undefined) return model
        const { reasoning: _reasoning, ...rest } = model
        return rest
      }),
    })),
  }
}

/** chibi（大肥鱼，素材复用自 dsh-reasoning-effort/HanaAyane，MIT）默认开启。 */
const CHIBI_KEY = 'dsh-effort-slider.chibi-thumb'

function readChibiPreference(): boolean {
  try {
    return window.localStorage.getItem(CHIBI_KEY) !== 'false'
  } catch {
    return true
  }
}

let chibiPreference = readChibiPreference()
const chibiListeners = new Set<() => void>()

const chibiStore = {
  getSnapshot: () => chibiPreference,
  subscribe: (listener: () => void) => {
    chibiListeners.add(listener)
    return () => chibiListeners.delete(listener)
  },
  set: (enabled: boolean) => {
    if (chibiPreference === enabled) return
    chibiPreference = enabled
    try { window.localStorage.setItem(CHIBI_KEY, String(enabled)) } catch { /* page-local only */ }
    chibiListeners.forEach((listener) => listener())
  },
}

interface RadiationState {
  progress: number
  dragging: boolean
  /** 档位脉冲：commit 成功瞬间的时间戳（0 = 无）。 */
  pulseAt: number
}

/**
 * 辐射光效（canvas 像素级，移植自 dsh-reasoning-effort/HanaAyane，MIT）。
 * 左 clip 到 thumb，dark/light 双配色，reduced-motion 冻结为静态帧。
 */
function drawRadiation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: RadiationState,
): void {
  const origin = state.progress * width
  const isDark = document.body.hasAttribute('data-ds-dark-theme')
  // 像素网格动效（0.6.2 原版风味）：cell=4 + 1px 间隙；胶囊圆角由
  // canvas border-radius + clip roundRect 保证（2026-08-18 修复）。
  const cell = 4
  const speed = state.dragging ? 2.8 : 1
  // 档位脉冲（600ms 衰减）：commit 成功瞬间整条轨道能量波扩散。
  const pulse = state.pulseAt > 0 ? Math.max(0, 1 - (time - state.pulseAt) / 600) : 0

  context.clearRect(0, 0, width, height)
  if (origin <= 0) return

  context.save()
  context.beginPath()
  // 先裁成完整轨道胶囊，再与静止态的进度矩形求交。此前按 origin
  // 缩小圆角会把 30px 高的左端画成小圆 + 斜边；拖动时又无法覆盖
  // 同级 CSS flare。外层 fx 另用 clip-path 裁整个合成层。
  const radius = Math.min(height / 2, width / 2)
  context.moveTo(radius, 0)
  context.lineTo(width - radius, 0)
  context.quadraticCurveTo(width, 0, width, radius)
  context.lineTo(width, height - radius)
  context.quadraticCurveTo(width, height, width - radius, height)
  context.lineTo(radius, height)
  context.quadraticCurveTo(0, height, 0, height - radius)
  context.lineTo(0, radius)
  context.quadraticCurveTo(0, 0, radius, 0)
  context.closePath()
  context.clip()
  if (!state.dragging) {
    context.beginPath()
    context.rect(0, 0, origin, height)
    context.clip()
  }

  for (let x = 0; x < origin; x += cell) {
    const delta = x + cell * 0.5 - origin
    const distance = Math.abs(delta)
    const phaseA = distance / 10 - time * 0.0074 * speed
    const phaseB = distance / 23 - time * 0.0041 * speed + 1.7
    const phaseC = distance / 40 - time * 0.0022 * speed + 3.4
    const sinA = Math.max(0, Math.sin(phaseA))
    const sinB = Math.max(0, Math.sin(phaseB))
    const sinC = Math.max(0, Math.sin(phaseC))
    const waveA = Math.pow(sinA, 2.6)
    const waveB = Math.pow(sinB, 3.2)
    const waveC = Math.pow(sinC, 4)
    const crest = Math.pow(sinA, 15) + Math.pow(sinB, 18) * 0.78
    const wave = Math.min(1, waveA * 0.76 + waveB * 0.58 + waveC * 0.32)
    const trail = 0.38 + 0.62 * Math.exp(-distance / Math.max(55, width * 0.72))
    const pillar = Math.pow(Math.max(0, Math.sin(x / 20 + time * 0.0016)), 3) * 0.27
    const columnEnergy = trail * (wave * 1.04 + pillar + crest * 0.32)

    if (columnEnergy > 0.012) {
      const nearness = Math.max(0, 1 - distance / Math.max(1, width * 0.78))
      const red = isDark
        ? Math.round(42 + 124 * nearness + 75 * wave)
        : Math.round(28 + 58 * nearness + 15 * wave)
      const green = isDark
        ? Math.round(56 + 58 * nearness + 44 * crest)
        : Math.round(88 + 72 * nearness + 30 * crest)
      const blue = isDark
        ? Math.round(175 + 72 * nearness + 8 * wave)
        : Math.round(182 + 62 * nearness)
      const alpha = isDark
        ? Math.min(0.88, columnEnergy * 0.72)
        : Math.min(0.62, columnEnergy * 0.54)
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
      context.fillRect(x, 0, cell - 1, height)
    }

    for (let y = 0; y < height; y += cell) {
      const deltaY = y + cell * 0.5 - height * 0.5
      const radial = Math.hypot(delta / 38, deltaY / 11)
      const halo = Math.exp(-radial * 0.96) * 1.08
      const verticalShape = 0.58 + 0.42 * Math.cos((deltaY / height) * Math.PI)
      const grain = 0.72 + 0.28 * Math.sin(x * 0.73 + y * 1.31 + time * 0.006)
      const alpha = Math.min(0.96, (columnEnergy * 0.88 + halo + crest * 0.19) * verticalShape * grain)
      if (alpha < 0.035) continue

      const hot = Math.max(0, 1 - radial / 2.4)
      const red2 = isDark
        ? Math.round(54 + 148 * hot + 42 * wave + 35 * crest)
        : Math.round(25 + 72 * hot + 12 * wave)
      const green2 = isDark
        ? Math.round(68 + 78 * hot + 46 * crest)
        : Math.round(98 + 72 * hot + 24 * crest)
      const blue2 = isDark
        ? Math.round(186 + 64 * hot)
        : Math.round(194 + 56 * hot)
      context.fillStyle = `rgba(${red2}, ${green2}, ${blue2}, ${isDark ? alpha : alpha * 0.72})`
      context.fillRect(x, y, cell - 1, cell - 1)
    }
  }

  for (let i = 0; i < 14; i += 1) {
    const travel = (time * (state.dragging ? 0.16 : 0.065) * (0.78 + (i % 5) * 0.09) + i * 23) % Math.max(30, width + 64)
    // 拖拽时半数粒子向右侧迸射（thumb 两侧都有能量）；静止时全向左拖尾。
    const direction = state.dragging && i % 2 === 0 ? 1 : -1
    const particleX = origin + direction * travel
    if (particleX < -24 || particleX > width + 16) continue
    const particleY = 3 + ((i * 13 + Math.sin(time * 0.003 + i) * 5) % Math.max(7, height - 6))
    const length = 4 + (i % 4) * 4 + (state.dragging ? 6 : 0)
    const alpha = 0.28 + (i % 5) * 0.1
    const streak = context.createLinearGradient(particleX, 0, particleX + length, 0)
    streak.addColorStop(0, isDark ? 'rgba(72,118,255,0)' : 'rgba(24,94,184,0)')
    streak.addColorStop(0.68, isDark ? `rgba(112,135,255,${alpha})` : `rgba(36,108,202,${alpha * 0.72})`)
    streak.addColorStop(1, isDark ? `rgba(236,222,255,${Math.min(1, alpha + 0.26)})` : `rgba(103,175,248,${Math.min(0.82, alpha + 0.18)})`)
    context.fillStyle = streak
    context.fillRect(particleX, particleY, length, i % 3 === 0 ? 2 : 1)
  }

  const glow = context.createRadialGradient(origin, height / 2, 0, origin, height / 2, 24)
  glow.addColorStop(0, isDark ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.5)')
  glow.addColorStop(0.14, isDark ? 'rgba(183,190,255,.54)' : 'rgba(162,210,255,.48)')
  glow.addColorStop(0.44, isDark ? 'rgba(103,74,255,.28)' : 'rgba(37,112,207,.22)')
  glow.addColorStop(1, isDark ? 'rgba(86,31,210,0)' : 'rgba(25,91,181,0)')
  context.fillStyle = glow
  context.fillRect(origin - 26, 0, 52, height)
  context.restore()

  // 档位脉冲：能量波从 thumb 向整条轨道扩散衰减（不受 clip 限制）。
  if (pulse > 0) {
    const half = pulse * width
    const beam = context.createLinearGradient(origin - half, 0, origin + half, 0)
    beam.addColorStop(0, 'rgba(255,255,255,0)')
    beam.addColorStop(0.5, 'rgba(255,255,255,' + 0.45 * pulse + ')')
    beam.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = beam
    context.fillRect(origin - half, 0, half * 2, height)
    context.fillStyle = 'rgba(180,200,255,' + 0.6 * pulse + ')'
    context.fillRect(origin - half, 0, 2, height)
    context.fillRect(origin + half, 0, 2, height)
  }
}

function EffortSlider({ directory, locked = false, t }: { directory: ModelDirectory; readonly locked?: boolean; readonly t?: EffortSliderTranslate }) {
  const tr = t ?? defaultEffortSliderTranslate
  const directoryState = useSyncExternalStore(
    (notify) => directory.store.subscribe(notify),
    () => directory.store.getSnapshot(),
  )
  const levels = sliderLevels(directoryState)
  const [effort, setEffort] = useState('')
  const [preview, setPreview] = useState(0)
  const [committing, setCommitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const chibiThumb = useSyncExternalStore(chibiStore.subscribe, chibiStore.getSnapshot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef('')
  const committingRef = useRef(false)
  const previewRef = useRef(0)
  const draggingRef = useRef(false)
  const pointerActiveRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const globalPointerMoveRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerEndRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerCancelRef = useRef<((event: PointerEvent) => void) | null>(null)
  const radiationRef = useRef<RadiationState>({ progress: 0.5, dragging: false, pulseAt: 0 })
  const redrawRef = useRef<(() => void) | null>(null)

  const available = directoryState.current !== null && levels.length >= 2
  const busy = locked || committing || directoryState.status === 'selecting'
  const error = localError ?? directoryState.error

  useEffect(() => {
    if (!available || committingRef.current || draggingRef.current) return
    const index = effectiveEffortIndex(
      levels,
      directoryState.current?.reasoningEffort,
      currentModel(directoryState)?.reasoning?.defaultEffort,
    )
    const next = levels[index]?.id ?? ''
    committedRef.current = next
    previewRef.current = index
    setEffort(next)
    setPreview(index)
    setLocalError(null)
  }, [available, levels, directoryState])

  useEffect(() => {
    directory.load().catch(() => undefined)
  }, [directory])

  useEffect(() => {
    previewRef.current = preview
    radiationRef.current.progress = levels.length >= 2 ? preview / (levels.length - 1) : 0.5
    redrawRef.current?.()
  }, [preview, levels.length])

  useEffect(() => {
    radiationRef.current.dragging = dragging
    redrawRef.current?.()
  }, [dragging])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 1
    let height = 1
    let frame = 0

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = (time = performance.now()) => {
      drawRadiation(context, width, height, time, radiationRef.current)
    }

    const loop = (time: number) => {
      draw(time)
      frame = window.requestAnimationFrame(loop)
    }

    const redraw = () => {
      if (reducedMotion.matches) draw()
    }

    const resizeObserver = new ResizeObserver(() => {
      resize()
      draw()
    })
    const themeObserver = new MutationObserver(() => draw())
    resizeObserver.observe(canvas)
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    redrawRef.current = redraw
    resize()
    draw()
    if (!reducedMotion.matches) frame = window.requestAnimationFrame(loop)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      redrawRef.current = null
    }
  }, [])

  const rollback = useCallback(() => {
    const previous = committedRef.current
    const index = Math.max(0, effortIndex(levels, previous))
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    previewRef.current = index
    setEffort(previous)
    setPreview(index)
    setDragging(false)
  }, [levels])

  const commit = useCallback(
    async (raw: number) => {
      if (committingRef.current || locked) return
      committingRef.current = true
      const previous = committedRef.current

      setDragging(false)
      setCommitting(true)
      setLocalError(null)

      // 乐观 snap 保持跟手；directory 往返后用新鲜数据再校验。
      const optimisticIndex = clampIndex(raw, levels.length)
      const optimistic = levels[optimisticIndex]?.id
      if (optimistic !== undefined) {
        previewRef.current = optimisticIndex
        setPreview(optimisticIndex)
        setEffort(optimistic)
      }

      try {
        const models = await directory.load()
        const fresh: ModelDirectoryState = {
          current: models.current,
          routable: models.routable,
          groups: models.groups,
          failures: models.failures,
          status: 'ready',
          error: null,
        }
        const freshLevels = sliderLevels(fresh)
        const index = clampIndex(raw, freshLevels.length)
        const next = freshLevels[index]?.id
        if (next === undefined) throw new Error(tr('effort.error.noLevels'))

        previewRef.current = index
        setPreview(index)
        setEffort(next)

        const selected = await directory.select({
          provider: models.current.provider,
          model: models.current.model,
          reasoningEffort: next,
        })
        const acceptedSelection = remoteSelectAccepted(selected)
        if (!acceptedSelection.ok) throw new Error(acceptedSelection.error ?? tr('effort.error.notApplied'))

        const snapshot = directory.store.getSnapshot()
        const accepted = effortIndex(freshLevels, snapshot.current?.reasoningEffort)
        const settled = accepted >= 0 ? accepted : index
        const settledId = freshLevels[settled]?.id ?? next
        committedRef.current = settledId
        previewRef.current = settled
        setEffort(settledId)
        setPreview(settled)
        // 换档成功脉冲（能量波扩散）。
        radiationRef.current.pulseAt = performance.now()
        redrawRef.current?.()
      } catch (cause) {
        const restore = Math.max(0, effortIndex(levels, previous))
        committedRef.current = previous
        previewRef.current = restore
        setEffort(previous)
        setPreview(restore)
        setLocalError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        committingRef.current = false
        setCommitting(false)
      }
    },
    [directory, levels],
  )

  const showPointerPreview = (raw: number) => {
    previewRef.current = raw
    setPreview(raw)
    setEffort(levels[clampIndex(raw, levels.length)]?.id ?? '')
  }

  const rawFromPointer = (input: HTMLInputElement, clientX: number) => {
    const bounds = input.getBoundingClientRect()
    return rawFromClientX({ left: bounds.left, width: bounds.width }, clientX, levels.length)
  }

  const beginDragging = (input: HTMLInputElement, pointerId: number, clientX: number) => {
    if (locked || committingRef.current) return
    pointerActiveRef.current = true
    activePointerIdRef.current = pointerId
    draggingRef.current = true
    setDragging(true)
    showPointerPreview(rawFromPointer(input, clientX))
    try {
      if (!input.hasPointerCapture(pointerId)) input.setPointerCapture(pointerId)
    } catch {
      // window 级监听兜底。
    }
  }

  const moveDragging = (input: HTMLInputElement, pointerId: number, clientX: number) => {
    if (!pointerActiveRef.current || activePointerIdRef.current !== pointerId) return
    showPointerPreview(rawFromPointer(input, clientX))
  }

  const stopDragging = (input: HTMLInputElement, pointerId?: number, clientX?: number) => {
    if (!pointerActiveRef.current) return
    if (pointerId !== undefined && activePointerIdRef.current !== pointerId) return
    const raw = clientX === undefined ? previewRef.current : rawFromPointer(input, clientX)
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    if (pointerId !== undefined && input.hasPointerCapture(pointerId)) {
      input.releasePointerCapture(pointerId)
    }
    showPointerPreview(raw)
    void commit(raw)
  }

  globalPointerMoveRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) moveDragging(input, event.pointerId, event.clientX)
  }
  globalPointerEndRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) stopDragging(input, event.pointerId, event.clientX)
  }
  globalPointerCancelRef.current = (event) => {
    if (activePointerIdRef.current !== event.pointerId) return
    rollback()
  }

  useEffect(() => {
    const move = (event: PointerEvent) => globalPointerMoveRef.current?.(event)
    const end = (event: PointerEvent) => globalPointerEndRef.current?.(event)
    const cancel = (event: PointerEvent) => globalPointerCancelRef.current?.(event)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
  }, [])

  useEffect(() => {
    if (!available || error === null) return
    toastPluginError(tr, tr('effort.toast.failed', { error }))
  }, [available, error, tr])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (locked || committingRef.current) return
    const current = clampIndex(Number(event.currentTarget.value), levels.length)
    let target: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      target = Math.max(0, current - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      target = Math.min(levels.length - 1, current + 1)
    } else if (event.key === 'Home') {
      target = 0
    } else if (event.key === 'End') {
      target = levels.length - 1
    }
    if (target === undefined) return
    // The slider lives inside the official menu whose root handles arrow keys
    // for row focus; keep the slider's own keyboard semantics here.
    event.stopPropagation()
    event.preventDefault()
    void commit(target)
  }

  if (!available) return null

  const count = levels.length
  const effortName = levels[effortIndex(levels, effort)]?.name ?? levelName(effort, tr)
  const currentIndex = effortIndex(levels, effort)
  const isTop = currentIndex === count - 1
  const progress = preview / (count - 1) * 100
  const style = { '--omnieff-progress': progress + '%' } as CSSProperties
  const title = error === null ? tr('effort.title', { name: effortName }) : tr('effort.titleError', { error })

  return (
    <div
      className={'omni-ui-tokens omnieff-effort' + (chibiThumb ? ' is-chibi' : '') + (dragging ? ' is-dragging' : '') + (busy ? ' is-busy' : '') + (error === null ? '' : ' is-error')}
      title={title}
    >
      <div className="omnieff-effort-head">
        <span className="omnieff-effort-caption">{tr('effort.caption')}</span>
        <span className="omnieff-effort-current">{effortName}</span>
      </div>
      <div
        className="omnieff-effort-slider"
        data-top={isTop ? 'true' : undefined}
        style={style}
      >
        <div className="omnieff-effort-track" aria-hidden="true" />
        <div className="omnieff-effort-fx" aria-hidden="true">
          <canvas ref={canvasRef} className="omnieff-effort-canvas" />
          <span className="omnieff-effort-flare" />
        </div>
        <div className="omnieff-effort-ticks" aria-hidden="true">
          {Array.from({length: count}, (_, index) => (
            <span
              key={levels[index]?.id ?? index}
              className="omnieff-effort-tick"
              data-active={index <= currentIndex ? 'true' : undefined}
              style={{left: `${count === 1 ? 0 : (index / (count - 1)) * 100}%`}}
            />
          ))}
        </div>
        <input
          ref={inputRef}
          className="omnieff-effort-input"
          type="range"
          min="0"
          max={count - 1}
          step="0.01"
          value={preview}
          // Keep the range focusable while our own commit is in flight: disabling it
          // blurs the official menu root, whose onBlur closes the whole menu.
          aria-disabled={busy ? 'true' : undefined}
          aria-label={tr('effort.ariaLabel')}
          aria-valuetext={effortName}
          onChange={(event) => {
            if (locked || committingRef.current) return
            showPointerPreview(Number(event.currentTarget.value))
          }}
          onPointerDown={(event) => {
            event.preventDefault()
            // 不 focus：pointer 拖动不需要焦点，避免 WKWebView 对 range input
            // 误判 :focus-visible 给 knob 画 outline 框（2026-08-18）。
            beginDragging(event.currentTarget, event.pointerId, event.clientX)
          }}
          onPointerMove={(event) => moveDragging(event.currentTarget, event.pointerId, event.clientX)}
          onPointerUp={(event) => {
            // Pointer dragging deliberately avoids stealing focus; return focus on release
            // so the same control remains reachable with Arrow/Home/End afterwards.
            try { event.currentTarget.focus({preventScroll: true}) } catch { /* focus is optional */ }
            stopDragging(event.currentTarget, event.pointerId, event.clientX)
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            rollback()
          }}
          onBlur={(event) => stopDragging(event.currentTarget)}
          onKeyDown={onKeyDown}
        />
        <span className="omnieff-effort-knob" aria-hidden="true" />
      </div>
      <div className="omnieff-effort-endpoints" aria-hidden="true">
        <span>{tr('effort.rangeLow')}</span>
        <span>{tr('effort.rangeHigh')}</span>
      </div>
      {error === null ? null : <span className="omnieff-effort-sr" role="status">{error}</span>}
    </div>
  )
}

type ChatChromeState = "chat" | "work" | "unavailable"

function useChatBodyGate(): ChatChromeState {
  const read = (): ChatChromeState => {
    const mode = document.body.dataset.omniwc
    if (mode === "unavailable") return "unavailable"
    return useChatReadOnlySeat(mode) ? "chat" : "work"
  }
  const [chat, setChat] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setChat(read()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-omniwc'] })
    setChat(read())
    return () => observer.disconnect()
  }, [])
  return chat
}

function ChatReadOnlySeat({ sessionId, t }: { readonly sessionId: SessionId; readonly t?: EffortSliderTranslate }) {
  const tr = t ?? defaultEffortSliderTranslate
  const [snapshot, setSnapshot] = useState<ReturnType<typeof parseChatRouteSnapshot> | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const acceptedRef = useRef<ReturnType<typeof parseChatRouteSnapshot>>(undefined)

  useEffect(() => {
    let alive = true
    let loading = false
    let sequence = 0
    const requests = new Set<AbortController>()
    setSnapshot(null)
    setStatus('loading')
    acceptedRef.current = undefined
    const refresh = async (): Promise<void> => {
      if (!alive || loading) return
      loading = true
      const current = ++sequence
      const controller = new AbortController()
      requests.add(controller)
      const timeout = window.setTimeout(() => controller.abort(), CHAT_ROUTE_REQUEST_TIMEOUT_MS)
      if (acceptedRef.current === undefined) setStatus('loading')
      try {
        const response = await fetch(chatRouteUrl(sessionId), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const next = parseChatRouteSnapshot(await response.json(), sessionId)
        if (next === undefined) throw new Error('invalid chat route snapshot')
        if (alive && current === sequence) {
          if (!chatRouteSnapshotCanReplace(acceptedRef.current, next)) {
            if (acceptedRef.current !== undefined) setSnapshot(acceptedRef.current)
            setStatus(acceptedRef.current === undefined ? 'unavailable' : 'ready')
          } else {
            acceptedRef.current = next
            setSnapshot(next)
            setStatus('ready')
          }
        }
      } catch {
        if (alive && current === sequence) {
          acceptedRef.current = undefined
          setSnapshot(null)
          setStatus('unavailable')
        }
      } finally {
        window.clearTimeout(timeout)
        requests.delete(controller)
        loading = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      sequence += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      for (const controller of requests) controller.abort()
      requests.clear()
    }
  }, [sessionId])

  const route = snapshot?.status === 'planned'
    ? snapshot.planned
    : snapshot?.status === 'resolved'
      ? snapshot.resolved
      : undefined
  // 区分两种「没有路由」（2026-09-14 修）：
  //  - 服务端 status='unavailable' = **还没有路由决策**（空会话必然如此）——
  //    这是**正常状态**，语义就是「跟随默认」；此前一并写成「不可用」，
  //    把正常说成了故障（Windows 那条误报的直接来源）；
  //  - 客户端 status='unavailable' = 取不到/解析失败——**这才是真异常**。
  const model = status === 'loading'
    ? tr('chat.status.loading')
    : status === 'unavailable'
      ? tr('chat.status.failed')
      : snapshot?.status === 'stale'
        ? tr('chat.status.stale')
        : snapshot?.status === 'unavailable'
          ? tr('chat.status.followDefault')
          : route === undefined
            ? tr('chat.status.failed')
            : `${route.provider}/${route.model}`
  const effort = route?.effort === '' ? tr('chat.effort.unspecified') : route?.effort
  const phase = snapshot?.status === 'planned'
    ? tr('chat.phase.planned')
    : snapshot?.status === 'resolved'
      ? snapshot.routeKind === 'explicit'
        ? tr('chat.phase.sessionOverride')
        : snapshot.routeKind === 'fallback'
          ? tr('chat.phase.fallback')
          : snapshot.routeKind === 'host-default'
            ? tr('chat.phase.appDefault')
            : tr('chat.phase.inherited')
      : snapshot?.status === 'stale'
        ? tr('chat.phase.stale')
        : undefined
  const detail = [phase, effort].filter((item): item is string => item !== undefined).join(' · ')
  const title = detail === '' ? model : `${model} · ${detail}`
  return (
    <div
      className="omnieff-chat-readonly"
      data-chat-readonly="true"
      data-chat-route-status={status === 'ready' ? snapshot?.status ?? status : status}
      role="status"
      aria-label={tr('chat.ariaLabel', { title })}
      title={title}
    >
      <span className="omnieff-model-name">{model}</span>
      {detail === '' ? null : <span className="omnieff-model-effort">{detail}</span>}
    </div>
  )
}

interface TeamModeBinding {
  /** Whether the official agentTeams remote is reachable right now. */
  readonly available: () => boolean
  readonly subscribe: (listener: () => void) => () => void
  /** Save the Team selection through the official agentTeams remote. */
  readonly select: (enabled: boolean) => Promise<string | null>
  /** Called by the mounted row that owns this binding; an in-use binding is never evicted. */
  readonly retain?: () => void
  /** Called when that row unmounts; the binding becomes an idle cache entry again. */
  readonly release?: () => void
}

/**
 * Idle session bindings a long-lived Client keeps. A mounted row retains its own binding, so this cap
 * only bounds sessions nobody is using: a history of 257 sessions cannot grow the map without limit,
 * and an open Team switch can never lose the binding it subscribed to.
 */
export const TEAM_MODE_BINDING_CACHE_LIMIT = 64

interface TeamModeBindingEntry {
  readonly key: string
  binding: TeamModeBinding
  refs: number
}

/**
 * Session-keyed binding cache with an idle-only LRU bound.
 *
 * Map insertion order is the LRU order (oldest first); `touch` re-inserts at the young end and `trim`
 * only removes `refs === 0` entries. The size may therefore exceed the limit while that many rows are
 * mounted, which is the correct trade: evicting an in-use binding would hand the same session two live
 * bindings and lose the one the switch subscribed to. Exported so the focused test can pin the bound and
 * the in-use guarantee without mounting the whole slot.
 */
export class TeamModeBindingCache {
  private readonly entries = new Map<string, TeamModeBindingEntry>()

  constructor(private readonly limit: number = TEAM_MODE_BINDING_CACHE_LIMIT) {}

  get size(): number {
    return this.entries.size
  }

  /** Return the cached binding for a session, creating and trimming one when it is absent. */
  for(sessionId: string, create: () => TeamModeBinding): TeamModeBinding {
    const key = String(sessionId)
    const cached = this.entries.get(key)
    if (cached !== undefined) {
      this.touch(cached)
      return cached.binding
    }
    const entry: TeamModeBindingEntry = {
      key,
      refs: 0,
      binding: {
        ...create(),
        retain: () => this.retain(entry),
        release: () => this.release(entry),
      },
    }
    this.entries.set(key, entry)
    this.trim()
    return entry.binding
  }

  /** Drop every binding; the contribution's owner calls this when it is disposed. */
  clear(): void {
    this.entries.clear()
  }

  private retain(entry: TeamModeBindingEntry): void {
    entry.refs += 1
    const current = this.entries.get(entry.key)
    // A render can hold a binding the cache evicted before React ran the mount effect; re-admit it so
    // the row that is now using it is protected from the next trim. If a newer binding already owns the
    // slot, keep the detached one usable but never let it replace the current cache entry.
    if (current === undefined) this.entries.set(entry.key, entry)
    else if (current !== entry) return
    this.touch(entry)
    this.trim()
  }

  private release(entry: TeamModeBindingEntry): void {
    entry.refs = Math.max(0, entry.refs - 1)
    this.trim()
  }

  private touch(entry: TeamModeBindingEntry): void {
    this.entries.delete(entry.key)
    this.entries.set(entry.key, entry)
  }

  private trim(): void {
    if (this.entries.size <= this.limit) return
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.limit) break
      if (entry.refs === 0) this.entries.delete(key)
    }
  }
}

interface ModelSeatProps {
  readonly locked: boolean
  readonly sessionId: SessionId
  /** Effort slider copy seat; absent only in standalone renders without a locale service. */
  readonly t?: EffortSliderTranslate
  readonly bind: () => ModelDirectory | undefined
  readonly loadCatalog: () => Promise<{ groups: readonly CatalogGroup[]; error?: string }>
  readonly selectRemote: (selection: ModelSelection) => Promise<{ ok: boolean; error?: string }>
  /** Standard session projection/hook face supplied by the slot runtime. */
  readonly useProjection?: (name: 'agentTeam' | 'modelSelection') => { readonly enabled?: boolean; readonly lastUsed?: unknown } | undefined
  readonly useSession?: (selector: (snapshot: { readonly subagent?: unknown }) => unknown) => unknown
  readonly useSessions?: (selector: (state: { readonly byId?: Record<string, { readonly origin?: string }> }) => unknown) => unknown
  /** Live binding to the official agentTeams remote; it may arrive after modelDirectories. */
  readonly teamMode?: TeamModeBinding
  /** Direct test/fallback face; production uses teamMode so a late remote is visible. */
  readonly selectTeamMode?: (enabled: boolean) => Promise<string | null>
  /** Read-only slot ledger used to put the official ModelSelect and its child entries back. */
  readonly slotHost?: SlotHost
}

function ModelSeat(props: ModelSeatProps) {
  const t = props.t ?? defaultEffortSliderTranslate
  const mode = useChatBodyGate()
  if (mode === "unavailable") return <span className="omni-ui-heroChip" role="status">{t('chat.unavailable')}</span>
  return mode === "chat"
    ? <ChatReadOnlySeat sessionId={props.sessionId} t={t} />
    : <WorkModelSeat key={props.sessionId} {...props} t={t} />
}

function WorkModelSeat({ sessionId, locked, bind, loadCatalog, selectRemote, ...rest }: ModelSeatProps) {
  const [controller, setController] = useState<ModelDirectory | undefined>(() => bind())

  useEffect(() => {
    if (controller !== undefined) return
    const tick = () => {
      const next = bind()
      if (next !== undefined) setController(next)
    }
    tick()
    const timer = window.setInterval(tick, 400)
    return () => window.clearInterval(timer)
  }, [bind, controller])

  if (controller !== undefined) return <WorkModelReady controller={controller} sessionId={sessionId} locked={locked} {...rest} />
  return <WorkModelRemoteSeat locked={locked} loadCatalog={loadCatalog} selectRemote={selectRemote} t={rest.t} />
}

function useMenuDismiss(open: boolean, rootRef: RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [close, open, rootRef])
}

function WorkModelRemoteSeat({
  locked,
  loadCatalog,
  selectRemote,
  t,
}: {
  readonly locked: boolean
  readonly loadCatalog: () => Promise<{ groups: readonly CatalogGroup[]; error?: string }>
  readonly selectRemote: (selection: ModelSelection) => Promise<{ ok: boolean; error?: string }>
  readonly t?: EffortSliderTranslate
}) {
  const tr = t ?? defaultEffortSliderTranslate
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [groups, setGroups] = useState<readonly CatalogGroup[]>([])
  const [current, setCurrent] = useState<ModelSelection | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useMenuDismiss(open, rootRef, close)
  const modelLabel = current?.model ?? tr('model.placeholder')

  const load = useCallback(async () => {
    setBusy(true)
    const loaded = await loadCatalog()
    setBusy(false)
    setGroups(loaded.groups)
    if (loaded.error !== undefined) toastPluginError(tr, tr('model.loadFailed', { error: loaded.error }))
  }, [loadCatalog, tr])

  const choose = async (provider: string, model: string, defaultEffort?: string) => {
    const selection = {
      provider,
      model,
      ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }),
    }
    setBusy(true)
    const accepted = await selectRemote(selection)
    setBusy(false)
    if (accepted.ok) {
      setCurrent(selection)
      setOpen(false)
      return
    }
    toastPluginError(tr, accepted.error === undefined ? tr('model.selectFailed') : tr('model.selectFailedWithError', { error: accepted.error }))
  }

  return (
    <div ref={rootRef} className="omni-ui-tokens omnieff-model-root">
      <button
        ref={triggerRef}
        type="button"
        className="omnieff-model-trigger"
        aria-label={tr('model.ariaLabel', { model: modelLabel })}
        aria-haspopup="menu"
        aria-expanded={open}
        title={modelLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setOpen(true)
          void load()
        }}
      >
        <span className="omnieff-model-name">{modelLabel}</span>
        <span className="omnieff-model-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="omnieff-model-menu" role="menu" aria-label={tr('model.menuAriaLabel')} aria-busy={busy}>
          <div className="omnieff-model-pane">
            {busy && groups.length === 0 ? <div className="omnieff-model-status">{tr('model.loading')}</div> : null}
            {groups.map((group) => (
              <section key={group.id}>
                <div className="omnieff-model-group-title">{group.name}</div>
                {group.models.map((model) => {
                  const selected = current?.provider === group.id && current.model === model.id
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className="omnieff-model-option"
                      disabled={busy || locked}
                      onClick={() => void choose(group.id, model.id, model.reasoning?.defaultEffort)}
                    >
                      <span className="omnieff-model-option-copy">
                        <span className="omnieff-model-option-name">{model.name}</span>
                        {model.description === undefined ? null : (
                          <span className="omnieff-model-option-desc">{model.description}</span>
                        )}
                      </span>
                      <span className="omnieff-model-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                    </button>
                  )
                })}
              </section>
            ))}
            {!busy && groups.length === 0 ? <div className="omnieff-model-status">{tr('model.empty')}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TeamModeRow({ sessionId, locked, onDismiss, useProjection, useSession, useSessions, teamMode, selectTeamMode, t }: Pick<ModelSeatProps, 'sessionId' | 't' | 'useProjection' | 'useSession' | 'useSessions' | 'teamMode' | 'selectTeamMode'> & { readonly locked: boolean; readonly onDismiss: () => void }) {
  const tr = t ?? defaultEffortSliderTranslate
  const addressed = useSession === undefined ? false : useSession(snapshot => snapshot.subagent !== null && snapshot.subagent !== undefined) === true
  const listed = useSessions === undefined ? false : useSessions(state => state.byId?.[sessionId]?.origin === 'subagent') === true
  const mode = useProjection === undefined ? undefined : useProjection('agentTeam')
  const selection = useProjection === undefined ? undefined : useProjection('modelSelection')
  const binding = teamMode ?? alwaysTeamMode
  const teamModeAvailable = useSyncExternalStore(binding.subscribe, binding.available)
  const select = teamMode === undefined ? selectTeamMode : binding.select
  const [pending, setPending] = useState(false)
  // The idle cache may only evict bindings nobody is using. This row owns its binding for as long as it
  // is mounted; closing the menu (or losing the seat) releases it back to the idle LRU. Hooks run before
  // the early return below so a hidden switch keeps a stable hook order.
  useEffect(() => {
    teamMode?.retain?.()
    return () => { teamMode?.release?.() }
  }, [teamMode])
  if (addressed || listed || mode === undefined || !teamModeAvailable || select === undefined) return null
  const change = (enabled: boolean) => {
    setPending(true)
    void select(enabled).then(failure => {
      if (failure !== null) toastPluginError(tr, tr('team.saveFailed', { error: failure }))
    }, error => {
      toastPluginError(tr, tr('team.saveFailed', { error: error instanceof Error ? error.message : String(error) }))
    }).finally(() => setPending(false))
  }
  const choose = (enabled: boolean) => {
    if (!enabled && selection !== undefined && (selection.lastUsed ?? null) !== null) {
      onDismiss()
      showConfirm({
        title: tr('team.confirmDisableTitle'),
        text: tr('team.confirmDisableText'),
        cancelLabel: tr('team.cancel'),
        confirmLabel: tr('team.confirmDisable'),
        tone: 'danger',
        onConfirm: () => change(false),
      })
      return
    }
    change(enabled)
  }
  return (
    <>
      <div className="omnieff-menu-separator" />
      <Switch className="omnieff-team-row" label={tr('team.switchLabel')} checked={mode.enabled === true} disabled={locked || pending || selection === undefined} onChange={event => choose(event.currentTarget.checked)} />
    </>
  )
}

type WorkModelReadyProps = {
  readonly controller: ModelDirectory
  readonly sessionId: SessionId
  readonly locked: boolean
  readonly slotHost?: SlotHost
  /** Effort slider copy seat; the official slot runtime supplies it from the locale namespace. */
  readonly t?: EffortSliderTranslate
} & Pick<ModelSeatProps, 'useProjection' | 'useSession' | 'useSessions' | 'teamMode' | 'selectTeamMode'>

type RenderSlotOptions = { readonly fallback?: ReactNode }

type SlotStandardProps = {
  readonly sessionId: SessionId
  readonly useProjection: NonNullable<ModelSeatProps['useProjection']>
  readonly useSession: NonNullable<ModelSeatProps['useSession']>
  readonly useSessions: NonNullable<ModelSeatProps['useSessions']>
}

const fallbackProjection: NonNullable<ModelSeatProps['useProjection']> = () => undefined
const fallbackSession: NonNullable<ModelSeatProps['useSession']> = () => false
const fallbackSessions: NonNullable<ModelSeatProps['useSessions']> = () => false
const alwaysTeamMode: TeamModeBinding = {
  available: () => true,
  subscribe: () => () => undefined,
  select: async () => null,
}

function useSlotEntries(host: SlotHost, key: string, winners: boolean): readonly SlotEntry[] {
  const read = useCallback(
    () => (winners ? host.entriesOfSlot(key) : host.entries(key)),
    [host, key, winners],
  )
  const [entries, setEntries] = useState<readonly SlotEntry[]>(() => read())
  useEffect(() => {
    const sync = () => setEntries(read())
    sync()
    return host.subscribe(key, sync)
  }, [host, key, read])
  return entries
}

function renderSlotEntry(
  entry: SlotEntry,
  sessionId: SessionId,
  owner: Record<string, unknown>,
  host: SlotHost,
  standard: SlotStandardProps,
): ReactNode {
  if (typeof entry.component !== 'function') return null
  let injected: Record<string, unknown> = {}
  if (entry.inject !== undefined) {
    try {
      injected = entry.inject(String(sessionId))
    } catch {
      return null
    }
  }
  const t = entry.locale === undefined ? undefined : host.bindLocale(entry.locale)
  return React.createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
    ...standard,
    ...injected,
    ...owner,
    ...(t === undefined ? {} : { t }),
  })
}

function renderSlotEntries(
  entries: readonly SlotEntry[],
  sessionId: SessionId,
  owner: Record<string, unknown>,
  host: SlotHost,
  standard: SlotStandardProps,
): ReactNode {
  return orderSlotEntries(entries).map((entry, index) => (
    <React.Fragment key={String(entry.options.id ?? entry.locale ?? 'entry') + ':' + index}>
      <OfficialSeatBoundary fallback={null} resetKey={entry}>
        {renderSlotEntry(entry, sessionId, owner, host, standard)}
      </OfficialSeatBoundary>
    </React.Fragment>
  ))
}

function EffortSliderOption({ controller, locked, t }: { readonly controller?: ModelDirectory; readonly locked: boolean; readonly t?: EffortSliderTranslate }) {
  if (controller === undefined) return null
  return (
    <div className="omnieff-advanced">
      <EffortSlider directory={controller} locked={locked} t={t} />
    </div>
  )
}

interface OfficialSeatBoundaryProps {
  readonly fallback: ReactNode
  readonly children: ReactNode
  /** Changes when the official entry is replaced; a failed boundary then retries the new entry. */
  readonly resetKey?: unknown
}

interface OfficialSeatBoundaryState {
  readonly failed: boolean
}

let OfficialSeatBoundaryImplementation: React.ComponentType<OfficialSeatBoundaryProps> | undefined

/** A future official component change must degrade to the local menu, never take the seat down. */
function OfficialSeatBoundary(props: OfficialSeatBoundaryProps): ReactNode {
  // React.Component is a browser external; resolve it only when a real renderer
  // asks for the seat. The module-loader inspection fixture supplies a minimal
  // React stub without Component and must still be able to load the bundle.
  if (OfficialSeatBoundaryImplementation === undefined) {
    OfficialSeatBoundaryImplementation = class extends React.Component<OfficialSeatBoundaryProps, OfficialSeatBoundaryState> {
      state: OfficialSeatBoundaryState = { failed: false }

      static getDerivedStateFromError(): OfficialSeatBoundaryState {
        return { failed: true }
      }

      componentDidCatch(error: unknown): void {
        console.warn('[effort-slider] official ModelSelect rejected the seat entry; using the local menu', error)
      }

      componentDidUpdate(previous: OfficialSeatBoundaryProps): void {
        if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
      }

      render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children
      }
    }
  }
  const Boundary = OfficialSeatBoundaryImplementation
  return <Boundary {...props} />
}

function OfficialModelSeat({ controller, sessionId, locked, slotHost, useProjection, useSession, useSessions, teamMode, selectTeamMode, t }: WorkModelReadyProps & { readonly slotHost: SlotHost }) {
  const entries = useSlotEntries(slotHost, MODEL_SLOT, false)
  const official = entries.find(isOfficialModelEntry)
  const state = useSyncExternalStore(
    (notify) => controller.store.subscribe(notify),
    () => controller.store.getSnapshot(),
  )
  const currentChoice = state.current !== null && state.groups.some((group) => (
    group.id === state.current?.provider && group.models.some((model) => model.id === state.current?.model)
  ))
  // The official ModelSelect opens its model chooser directly when no
  // resolvable selection exists. Keep the existing full menu in that state so
  // the Team switch remains reachable; the official entry takes over as soon
  // as the current model is present in the loaded catalog.
  const fallback = <FallbackWorkModelReady controller={controller} sessionId={sessionId} locked={locked} useProjection={useProjection} useSession={useSession} useSessions={useSessions} teamMode={teamMode} selectTeamMode={selectTeamMode} t={t} />
  if (official === undefined || !currentChoice) return fallback
  return (
    <OfficialSeatBoundary key={String(official.options.id ?? official.locale ?? 'model') + ':' + String(sessionId)} fallback={fallback} resetKey={official}>
      <OfficialModelSeatBody
        entry={official}
        controller={controller}
        sessionId={sessionId}
        locked={locked}
        slotHost={slotHost}
        useProjection={useProjection}
        useSession={useSession}
        useSessions={useSessions}
      />
    </OfficialSeatBoundary>
  )
}

function OfficialModelSeatBody({ entry, controller, sessionId, locked, slotHost, useProjection, useSession, useSessions }: WorkModelReadyProps & { readonly entry: SlotEntry; readonly slotHost: SlotHost }) {
  const original = controller.store
  const originalState = useSyncExternalStore(
    (notify) => original.subscribe(notify),
    () => original.getSnapshot(),
  )
  const strippedState = React.useMemo(() => stripReasoning(originalState), [originalState])
  const directory = React.useMemo(() => ({
    subscribe: (notify: () => void) => original.subscribe(notify),
    getSnapshot: () => strippedState,
  }), [original, strippedState])
  const injected = React.useMemo<Record<string, unknown>>(() => {
    if (entry.inject === undefined) return {}
    try {
      return entry.inject(String(sessionId))
    } catch {
      return {}
    }
  }, [entry, sessionId])
  const t = React.useMemo(
    () => (entry.locale === undefined ? (key: string) => key : slotHost.bindLocale(entry.locale)),
    [entry.locale, slotHost],
  )
  const labelEntries = useSlotEntries(slotHost, MODEL_LABEL_SLOT, true)
  const optionEntries = useSlotEntries(slotHost, MODEL_OPTIONS_SLOT, true)
  const standard = React.useMemo<SlotStandardProps>(() => ({
    sessionId,
    useProjection: useProjection ?? fallbackProjection,
    useSession: useSession ?? fallbackSession,
    useSessions: useSessions ?? fallbackSessions,
  }), [sessionId, useProjection, useSession, useSessions])
  const renderSlot = useCallback((key: string, owner?: Record<string, unknown>, opts?: RenderSlotOptions): ReactNode => {
    if (key === MODEL_LABEL_SLOT) {
      const entry = labelEntries[0]
      return entry === undefined
        ? (opts?.fallback ?? null)
        : renderSlotEntry(entry, sessionId, owner ?? {}, slotHost, standard)
    }
    if (key === MODEL_OPTIONS_SLOT) {
      return renderSlotEntries(optionEntries, sessionId, owner ?? {}, slotHost, standard)
    }
    return opts?.fallback ?? null
  }, [labelEntries, optionEntries, sessionId, slotHost, standard])
  const select = useCallback(async (selection: ModelSelection) => {
    const state = original.getSnapshot()
    const group = state.groups.find((candidate) => candidate.id === selection.provider)
    const model = group?.models.find((candidate) => candidate.id === selection.model)
    const levels = model?.reasoning?.efforts ?? []
    let effort = selection.reasoningEffort
    if (levels.length > 0) {
      const sameRoute = state.current?.provider === selection.provider && state.current.model === selection.model
      const preferred = selection.reasoningEffort
        ?? (sameRoute ? state.current?.reasoningEffort : undefined)
        ?? model?.reasoning?.defaultEffort
      // Preserve the official directory semantics: when the target model has no
      // default effort and the caller did not choose one, omit the field rather
      // than silently forcing the first catalogue level.
      effort = preferred !== undefined && levels.some((level) => level.id === preferred)
        ? preferred
        : undefined
    } else {
      effort = undefined
    }
    const next = {
      ...selection,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    }
    const officialSelect = injected.select
    if (typeof officialSelect === 'function') {
      return (officialSelect as (value: ModelSelection) => Promise<unknown>)(next)
    }
    return controller.select(next)
  }, [original, injected, controller])
  const load = useCallback(() => {
    const officialLoad = injected.load
    if (typeof officialLoad === 'function') {
      ;(officialLoad as () => void)()
      return
    }
    void controller.load().catch(() => undefined)
  }, [injected, controller])
  const resolveText = typeof injected.resolveText === 'function'
    ? injected.resolveText as (text: string) => string
    : (text: string) => text
  const available = injected.available !== false
  return React.createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
    locked,
    available,
    directory,
    load,
    select,
    resolveText,
    t,
    renderSlot,
  })
}

export function WorkModelReady(props: WorkModelReadyProps) {
  return props.slotHost === undefined
    ? <FallbackWorkModelReady {...props} />
    : <OfficialModelSeat {...props} slotHost={props.slotHost} />
}

function FallbackWorkModelReady({ controller, sessionId, locked, useProjection, useSession, useSessions, teamMode, selectTeamMode, t }: WorkModelReadyProps) {
  const tr = t ?? defaultEffortSliderTranslate
  const directory = controller.store
  const load = useCallback(() => {
    void controller.load().then(() => undefined, () => undefined)
  }, [controller])
  const select = useCallback(
    async (selection: ModelSelection) => {
      try {
        return remoteSelectAccepted(await controller.select(selection))
      } catch (error) {
        return {ok: false as const, error: error instanceof Error ? error.message : undefined}
      }
    },
    [controller],
  )
  const state = useSyncExternalStore(
    (notify) => directory.subscribe(notify),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const choice = currentModel(state)
  const levels = sliderLevels(state)
  const effortName = (() => {
    const index = effectiveEffortIndex(levels, state.current?.reasoningEffort, choice?.reasoning?.defaultEffort)
    const level = index >= 0 ? levels[index] : undefined
    return level === undefined ? tr('effort.default') : (level.name ?? levelName(level.id, tr))
  })()
  const modelLabel = choice?.name ?? state.current?.model ?? tr('model.placeholder')
  const busy = state.status === 'loading' || state.status === 'selecting'

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (state.error === null) return
    toastPluginError(tr, tr('model.selectFailedWithError', { error: state.error }))
  }, [state.error, tr])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setModelsOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  const close = (restoreFocus = false) => {
    setOpen(false)
    setModelsOpen(false)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  const chooseModel = async (provider: string, model: string, defaultEffort?: string) => {
    if (state.current?.provider === provider && state.current.model === model) {
      setModelsOpen(false)
      return
    }
    const accepted = await select({
      provider,
      model,
      ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }),
    })
    if (accepted.ok) {
      setModelsOpen(false)
      return
    }
    toastPluginError(tr, accepted.error === undefined ? tr('model.selectFailed') : tr('model.selectFailedWithError', { error: accepted.error }))
  }

  return (
    <div ref={rootRef} className="omni-ui-tokens omnieff-model-root">
      <button
        ref={triggerRef}
        type="button"
        className="omnieff-model-trigger"
        aria-label={tr('model.triggerAriaLabel', { model: modelLabel, effort: effortName })}
        aria-haspopup="menu"
        aria-expanded={open}
        title={modelLabel + ' · ' + effortName}
        disabled={locked}
        onClick={() => {
          if (open) close()
          else {
            setOpen(true)
            setModelsOpen(false)
            load()
          }
        }}
      >
        <span className="omnieff-model-name">{modelLabel}</span>
        <span className="omnieff-model-effort">{effortName}</span>
        <span className="omnieff-model-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="omnieff-model-menu" role="menu" aria-label={tr('model.menuAriaLabel')} aria-busy={busy}>
          {modelsOpen ? (
            <div className="omnieff-model-pane">
              <button type="button" className="omnieff-model-back" onClick={() => setModelsOpen(false)}>
                <span aria-hidden="true">‹</span>
                <span>{tr('model.back')}</span>
              </button>
              {state.status === 'loading' && state.groups.length === 0 ? (
                <div className="omnieff-model-status">{tr('model.loading')}</div>
              ) : null}
              {state.groups.map((group) => (
                <section key={group.id}>
                  <div className="omnieff-model-group-title">{group.name}</div>
                  {group.models.map((model) => {
                    const selected = state.current?.provider === group.id && state.current.model === model.id
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className="omnieff-model-option"
                        disabled={busy}
                        onClick={() => void chooseModel(group.id, model.id, model.reasoning?.defaultEffort)}
                      >
                        <span className="omnieff-model-option-copy">
                          <span className="omnieff-model-option-name">{model.name}</span>
                          {model.description === undefined ? null : (
                            <span className="omnieff-model-option-desc">{model.description}</span>
                          )}
                        </span>
                        <span className="omnieff-model-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                      </button>
                    )
                  })}
                </section>
              ))}
              {state.status === 'ready' && state.groups.every((group) => group.models.length === 0) ? (
                <div className="omnieff-model-status">{tr('model.empty')}</div>
              ) : null}
            </div>
          ) : (
            <>
              {levels.length >= 2 ? (
                <div className="omnieff-advanced">
                  <EffortSlider directory={controller} locked={locked || busy} t={tr} />
                </div>
              ) : null}
              <div className="omnieff-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className={'omnieff-model-row' + (levels.length >= 2 ? ' has-slider' : '')}
                disabled={busy}
                onClick={() => setModelsOpen(true)}
              >
                <span className="omnieff-model-row-name">{modelLabel}</span>
                {levels.length >= 2 ? null : <span className="omnieff-model-row-effort">{effortName}</span>}
                <span className="omnieff-row-chevron" aria-hidden="true">›</span>
              </button>
              <TeamModeRow sessionId={sessionId} locked={locked || busy} onDismiss={() => close(false)} useProjection={useProjection} useSession={useSession} useSessions={useSessions} teamMode={teamMode} selectTeamMode={selectTeamMode} t={tr} />
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface SessionRemote {
  modelCatalog?: () => Promise<unknown>
  selectModel?: (request: { sessionId: SessionId } & ModelSelection) => Promise<unknown>
}

interface AgentTeamsRemote {
  setEnabled: (sessionId: SessionId, enabled: boolean) => Promise<{ ok: boolean; error?: { message?: string } }>
}

interface SlotRegistryFace {
  readonly entries: (key: string) => readonly unknown[]
  readonly entriesOfSlot: (key: string) => readonly unknown[]
  readonly subscribe: (key: string, listener: () => void) => () => void
}

interface LocaleFace {
  readonly bind: (namespace: string) => (key: string, vars?: Record<string, unknown>) => string
}

function createSlotHost(scope: unknown, root: unknown): SlotHost {
  const local = scope as { readonly slots: SlotRegistryFace; readonly locale?: LocaleFace }
  const top = root as { readonly locale?: LocaleFace }
  const locale = local.locale ?? top.locale
  return {
    entries: (key) => local.slots.entries(key) as readonly SlotEntry[],
    entriesOfSlot: (key) => local.slots.entriesOfSlot(key) as readonly SlotEntry[],
    subscribe: (key, listener) => local.slots.subscribe(key, listener),
    bindLocale: (namespace) => locale === undefined
      ? (key: string) => key
      : locale.bind(namespace),
  }
}

export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.locale.register(EFFORT_SLIDER_LOCALE_NS, { en, zh }), 'effort-slider: locale dictionaries')
  const t = ctx.locale.bind(EFFORT_SLIDER_LOCALE_NS)
  // The official agent-team Client plugin owns this Remote face. Read it through a declared inject
  // scope; the seat only presents the same projection and writes through the same endpoint. The
  // service can arrive after modelDirectories, so the binding reads the live variable at call time
  // and notifies the rendered switch when the service is attached or detached.
  let teamRemote: AgentTeamsRemote | undefined
  const teamModeListeners = new Set<() => void>()
  const teamModeBindings = new TeamModeBindingCache()
  const announceTeamMode = () => { for (const listener of teamModeListeners) listener() }
  ctx.inject(['remote', 'remote.agentTeams'], (scope) => {
    const service = scope.get('remote.agentTeams') as AgentTeamsRemote | undefined
    if (service === undefined) return
    teamRemote = service
    announceTeamMode()
    return () => {
      if (teamRemote === service) {
        teamRemote = undefined
        announceTeamMode()
      }
    }
  })
  // Bindings are session-keyed but must not accumulate for the lifetime of the Client. The cache keeps
  // only idle history bounded (TEAM_MODE_BINDING_CACHE_LIMIT); the row that is actually rendered retains
  // its binding, so the Team switch never loses the live face it subscribed to.
  const teamModeFor = (sessionId: SessionId): TeamModeBinding =>
    teamModeBindings.for(String(sessionId), () => ({
      available: () => teamRemote !== undefined,
      subscribe: (listener) => {
        teamModeListeners.add(listener)
        return () => teamModeListeners.delete(listener)
      },
      select: async (enabled: boolean) => {
        const service = teamRemote
        if (service === undefined) return t('team.unavailable')
        try {
          const result = await service.setEnabled(sessionId, enabled)
          return result.ok ? null : (result.error?.message ?? t('team.saveFailedShort'))
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      },
    }))
  // rc.2's official model-selection plugin publishes modelDirectories from its own apply; a sibling
  // client can be mounted before that service exists. Wait for the service instead of reading once at
  // mount, otherwise the seat silently never registers. If the service never appears, no registration
  // happens and the official model seat stays in charge.
  ctx.inject(['modelDirectories'], (scope) => {
    const modelDirectories = scope.get('modelDirectories') as ModelDirectoryResolver | undefined
    if (modelDirectories === undefined) return
    const sessionRemote = scope.get('remote.session') as SessionRemote | undefined
    const slotHost = createSlotHost(scope, ctx)
    const bindDirectory = (sessionId: SessionId) => tryDirectoryFor((id) => modelDirectories.directoryFor(id), sessionId)

    // The official ModelSelect parent entry declares this list slot. Our
    // contribution is an ordinary child entry, not a second parent seat.
    scope.slots.inject(MODEL_OPTIONS_SLOT, () =>
      scope.slots.register(
        {
          name: MODEL_OPTIONS_SLOT,
          id: 'omnisurge-effort-slider',
          order: -10,
          registrant: '@omnisurge/dsh-effort-slider',
          locale: EFFORT_SLIDER_LOCALE_NS,
          inject: (sessionId: SessionId) => ({ controller: bindDirectory(sessionId), t }),
        },
        EffortSliderOption,
      ),
    )

    scope.effect(() => {
      injectStyles()
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-effort-slider'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }, 'effort-slider: styles')

    // The binding cache is plugin-scoped memory: when this contribution goes away, its idle history and
    // its listener set go with it instead of outliving the slot owner.
    scope.effect(() => () => {
      teamModeBindings.clear()
      teamModeListeners.clear()
    }, 'effort-slider: team mode bindings')

    scope.slots.inject(SLOT, () =>
      scope.slots.register(
        {
          name: SLOT,
          // Above the official ModelSelect (priority 0) so the suite can
          // provide the effort wrapper, but below the official
          // experimental-liveshare ViewerModelSeat (-10) so viewer sessions
          // keep their read-only seat.
          priority: -1,
          registrant: '@omnisurge/dsh-effort-slider',
          locale: EFFORT_SLIDER_LOCALE_NS,
          inject: (sessionId: SessionId) => ({
            sessionId,
            t,
            bind: () => bindDirectory(sessionId),
            slotHost,
            loadCatalog: async () => {
              if (sessionRemote?.modelCatalog === undefined) return { groups: [], error: t('catalog.unavailable') }
              try {
                return unwrapCatalog(await sessionRemote.modelCatalog(), t('catalog.unavailable'))
              } catch (error) {
                return { groups: [], error: error instanceof Error ? error.message : t('catalog.unavailable') }
              }
            },
            selectRemote: async (selection: ModelSelection) => {
              if (sessionRemote?.selectModel === undefined) return { ok: false, error: t('model.channelUnavailable') }
              try {
                return remoteSelectAccepted(await sessionRemote.selectModel({ sessionId, ...selection }))
              } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : undefined }
              }
            },
            // The live binding hides the switch until the official owner is reachable and makes a
            // late-mounted remote visible without re-registering the seat.
            teamMode: teamModeFor(sessionId),
          }),
        },
        ModelSeat,
      ),
    )
  })
}
