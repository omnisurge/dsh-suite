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
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
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
import { injectStyles, showToast } from '@omnisurge/dsh-ui'
import { CSS } from './styles.js'

export const inject = ['slots', 'remote', 'remote.session']

const SLOT = 'conversation.input.model'
const CHAT_ROUTE_REQUEST_TIMEOUT_MS = 1_500

const LEVEL_NAMES: Record<string, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

function levelName(level: string): string {
  return LEVEL_NAMES[level] ?? level
}

function toastPluginError(text: string): void {
  showToast({
    kind: 'omnieff-error',
    tone: 'danger',
    text,
    closeLabel: '忽略',
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

function EffortSlider({ directory }: { directory: ModelDirectory }) {
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
  const busy = committing || directoryState.status === 'selecting'
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
      if (committingRef.current) return
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
        if (next === undefined) throw new Error('当前模型未提供推理强度档位')

        previewRef.current = index
        setPreview(index)
        setEffort(next)

        await directory.select({
          provider: models.current.provider,
          model: models.current.model,
          reasoningEffort: next,
        })

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
    toastPluginError(`没能改推理强度。${error}`)
  }, [available, error])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
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
    event.preventDefault()
    void commit(target)
  }

  if (!available) return null

  const count = levels.length
  const effortName = levels[effortIndex(levels, effort)]?.name ?? levelName(effort)
  const currentIndex = effortIndex(levels, effort)
  const isTop = currentIndex === count - 1
  const progress = preview / (count - 1) * 100
  const style = { '--omnieff-progress': progress + '%' } as CSSProperties
  const title = error === null ? '推理强度 · ' + effortName : '推理强度设置失败：' + error

  return (
    <div
      className={'omni-ui-tokens omnieff-effort' + (chibiThumb ? ' is-chibi' : '') + (dragging ? ' is-dragging' : '') + (busy ? ' is-busy' : '') + (error === null ? '' : ' is-error')}
      title={title}
    >
      <div className="omnieff-effort-head">
        <span className="omnieff-effort-caption">思考强度</span>
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
          disabled={busy}
          aria-label="推理强度"
          aria-valuetext={effortName}
          onChange={(event) => {
            showPointerPreview(Number(event.currentTarget.value))
          }}
          onPointerDown={(event) => {
            event.preventDefault()
            // 不 focus：pointer 拖动不需要焦点，避免 WKWebView 对 range input
            // 误判 :focus-visible 给 knob 画 outline 框（2026-08-18）。
            beginDragging(event.currentTarget, event.pointerId, event.clientX)
          }}
          onPointerMove={(event) => moveDragging(event.currentTarget, event.pointerId, event.clientX)}
          onPointerUp={(event) => stopDragging(event.currentTarget, event.pointerId, event.clientX)}
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
        <span>低</span>
        <span>高</span>
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

function ChatReadOnlySeat({ sessionId }: { readonly sessionId: SessionId }) {
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
    ? '正在读取 Chat 路由…'
    : status === 'unavailable'
      ? 'Chat 路由读取失败'
      : snapshot?.status === 'stale'
        ? 'Chat 路由已过期'
        : snapshot?.status === 'unavailable'
          ? '跟随默认'
          : route === undefined
            ? 'Chat 路由读取失败'
            : `${route.provider}/${route.model}`
  const effort = route?.effort === '' ? '未指定强度' : route?.effort
  const phase = snapshot?.status === 'planned'
    ? '计划'
    : snapshot?.status === 'resolved'
      ? snapshot.routeKind === 'explicit'
        ? '会话覆盖'
        : snapshot.routeKind === 'fallback'
          ? '后备路由'
          : snapshot.routeKind === 'host-default'
            ? '宿主默认'
            : '继承'
      : snapshot?.status === 'stale'
        ? '过期'
        : undefined
  const detail = [phase, effort].filter((item): item is string => item !== undefined).join(' · ')
  const title = detail === '' ? model : `${model} · ${detail}`
  return (
    <div
      className="omnieff-chat-readonly"
      data-chat-readonly="true"
      data-chat-route-status={status === 'ready' ? snapshot?.status ?? status : status}
      role="status"
      aria-label={`Chat 路由 ${title}`}
      title={title}
    >
      <span className="omnieff-model-name">{model}</span>
      {detail === '' ? null : <span className="omnieff-model-effort">{detail}</span>}
    </div>
  )
}

interface ModelSeatProps {
  readonly locked: boolean
  readonly sessionId: SessionId
  readonly bind: () => ModelDirectory | undefined
  readonly loadCatalog: () => Promise<{ groups: readonly CatalogGroup[]; error?: string }>
  readonly selectRemote: (selection: ModelSelection) => Promise<{ ok: boolean; error?: string }>
}

function ModelSeat(props: ModelSeatProps) {
  const mode = useChatBodyGate()
  if (mode === "unavailable") return <span className="omni-ui-heroChip" role="status">会话界面尚未就绪</span>
  return mode === "chat"
    ? <ChatReadOnlySeat sessionId={props.sessionId} />
    : <WorkModelSeat key={props.sessionId} {...props} />
}

function WorkModelSeat({ locked, bind, loadCatalog, selectRemote }: ModelSeatProps) {
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

  if (controller !== undefined) return <WorkModelReady controller={controller} locked={locked} />
  return <WorkModelRemoteSeat locked={locked} loadCatalog={loadCatalog} selectRemote={selectRemote} />
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
}: {
  readonly locked: boolean
  readonly loadCatalog: () => Promise<{ groups: readonly CatalogGroup[]; error?: string }>
  readonly selectRemote: (selection: ModelSelection) => Promise<{ ok: boolean; error?: string }>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [groups, setGroups] = useState<readonly CatalogGroup[]>([])
  const [current, setCurrent] = useState<ModelSelection | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useMenuDismiss(open, rootRef, close)
  const modelLabel = current?.model ?? '选择模型'

  const load = useCallback(async () => {
    setBusy(true)
    const loaded = await loadCatalog()
    setBusy(false)
    setGroups(loaded.groups)
    if (loaded.error !== undefined) toastPluginError(`没能加载模型清单。${loaded.error}`)
  }, [loadCatalog])

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
    toastPluginError(accepted.error === undefined ? '没能切换模型。' : `没能切换模型。${accepted.error}`)
  }

  return (
    <div ref={rootRef} className="omni-ui-tokens omnieff-model-root">
      <button
        ref={triggerRef}
        type="button"
        className="omnieff-model-trigger"
        aria-label={'模型 ' + modelLabel}
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
        <div className="omnieff-model-menu" role="menu" aria-label="选择模型" aria-busy={busy}>
          <div className="omnieff-model-pane">
            {busy && groups.length === 0 ? <div className="omnieff-model-status">正在加载模型…</div> : null}
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
            {!busy && groups.length === 0 ? <div className="omnieff-model-status">没有可用模型</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function WorkModelReady({ controller, locked }: { readonly controller: ModelDirectory; readonly locked: boolean }) {
  const directory = controller.store
  const load = useCallback(() => {
    void controller.load().then(() => undefined, () => undefined)
  }, [controller])
  const select = useCallback(
    (selection: ModelSelection) => controller.select(selection).then(() => true, () => false),
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
    return level === undefined ? '默认' : (level.name ?? levelName(level.id))
  })()
  const modelLabel = choice?.name ?? state.current?.model ?? '选择模型'
  const busy = state.status === 'loading' || state.status === 'selecting'

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (state.error === null) return
    toastPluginError(`没能切换模型。${state.error}`)
  }, [state.error])

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
    if (accepted) setModelsOpen(false)
  }

  return (
    <div ref={rootRef} className="omni-ui-tokens omnieff-model-root">
      <button
        ref={triggerRef}
        type="button"
        className="omnieff-model-trigger"
        aria-label={'模型 ' + modelLabel + '，推理强度 ' + effortName}
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
        <div className="omnieff-model-menu" role="menu" aria-label="模型与推理强度" aria-busy={busy}>
          {modelsOpen ? (
            <div className="omnieff-model-pane">
              <button type="button" className="omnieff-model-back" onClick={() => setModelsOpen(false)}>
                <span aria-hidden="true">‹</span>
                <span>选择模型</span>
              </button>
              {state.status === 'loading' && state.groups.length === 0 ? (
                <div className="omnieff-model-status">正在加载模型…</div>
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
                <div className="omnieff-model-status">没有可用模型</div>
              ) : null}
            </div>
          ) : (
            <>
              {levels.length >= 2 ? (
                <div className="omnieff-advanced">
                  <EffortSlider directory={controller} />
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

export function apply(ctx: ClientContext) {
  // rc.2's official model-selection plugin publishes modelDirectories from its own apply; a sibling
  // client can be mounted before that service exists. Wait for the service instead of reading once at
  // mount, otherwise the seat silently never registers. If the service never appears, no registration
  // happens and the official model seat stays in charge.
  ctx.inject(['modelDirectories'], (scope) => {
    const modelDirectories = scope.get('modelDirectories') as ModelDirectoryResolver | undefined
    if (modelDirectories === undefined) return
    const sessionRemote = scope.get('remote.session') as SessionRemote | undefined

    scope.effect(() => {
      injectStyles()
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-effort-slider'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }, 'effort-slider: styles')

    scope.slots.inject(SLOT, () =>
      scope.slots.register(
        {
          name: SLOT,
          priority: -100, // OMNI_SEAT_PRIORITY — abdicate onto official model chip
          registrant: "@omnisurge/dsh-effort-slider",
          inject: (sessionId: SessionId) => ({
            sessionId,
            bind: () => tryDirectoryFor((id) => modelDirectories.directoryFor(id), sessionId),
            loadCatalog: async () => {
              if (sessionRemote?.modelCatalog === undefined) return { groups: [], error: '模型清单不可用' }
              try {
                return unwrapCatalog(await sessionRemote.modelCatalog())
              } catch (error) {
                return { groups: [], error: error instanceof Error ? error.message : '模型清单不可用' }
              }
            },
            selectRemote: async (selection: ModelSelection) => {
              if (sessionRemote?.selectModel === undefined) return { ok: false, error: '模型通道不可用' }
              try {
                return remoteSelectAccepted(await sessionRemote.selectModel({ sessionId, ...selection }))
              } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : undefined }
              }
            },
          }),
        },
        ModelSeat,
      ),
    )
  })
}
