/**
 * 全窗口预览幕（lightbox）—— **命令式 body 挂载**。
 *
 * **为什么有它**：会话里 agent 画的矢量图原来只有「240px → 420px」这一档"放大"
 * （`image-generate/OutputRow.tsx` 的 `svgContainBox(aspect, open ? 420 : 240)`）——
 * 点一下只大 1.75 倍，没有遮罩、没有关闭按钮、不能缩放。这里换成真正的预览。
 *
 * **为什么不用 React**：dsh 运行时的模块表里**没有 `react-dom`**（seed words 只有
 * `react` / `react/jsx-runtime`）。所以 `createPortal` 不可用 —— 本包的
 * `toast.ts` / `confirm.ts` / `busy.ts` 全是这个理由走命令式 DOM。
 * 见 `confirm.ts` 的头注释：「命令式 body 挂载（同 toast.ts 的 react-dom 缺席理由）」。
 *
 * **形态照官方** `@deepseek-ai/dsh-client-ui-attachment` 的 `ImageLightbox`（官方只管
 * conversation input / message-image / trajectory image 三个槽位，管不到我们的工具行）：
 * 固定定位铺满窗口 + mask + 关闭按钮 + Esc + 点遮罩关闭 + 焦点管理。
 *
 * **缩放**：滚轮以光标为锚；加减按钮 ×1.25；双击在「适应窗口」与「原始大小」之间切；
 * 放大后可拖拽平移。范围 10% ~ 800%。
 *
 * **Token 宿主**：挂在 body 上之后不在任何 `.omni-ui-tokens` 里 —— 根元素必须自带
 * 这个类，否则 `var(--omni-*)` 全部失效（2026-09-19 的坑）。
 */

import { injectStyles } from "./styles.js";
import { documentOwner } from "./document-owner.js";

export interface LightboxLabels {
  readonly dialog: string;
  readonly close: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
  readonly fit: string;
  readonly actual: string;
}

export interface LightboxSpec {
  /** 已净化的 SVG 标记（`sanitizeSvg` 的产物）。 */
  readonly markup: string;
  /** viewBox 的固有尺寸 —— 「原始大小（1:1）」的基准：viewBox 一个单位 = 一个 CSS 像素。 */
  readonly intrinsic: { readonly width: number; readonly height: number };
  readonly labels: LightboxLabels;
}

export interface LightboxHandle {
  close(): void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STEP = 1.25;
const PADDING = 40;
/**
 * 滚轮灵敏度：`scale *= Math.exp(-deltaY * WHEEL_SENSITIVITY)`。
 *
 * **为什么按 deltaY 连续算，而不是每个事件乘固定倍率**：
 * 触摸板一个手势会触发**几十次** wheel 事件，固定 ×1.25 会变成 1.25^30 ≈ 800 倍
 * （用户原话：「触摸板滑动的大小调节速度太快了」）；鼠标滚轮一格才 ~1 次，
 * 同样的固定倍率对鼠标又刚好。按 deltaY 连续算，两种设备手感一致。
 *
 * 取值：鼠标一格 deltaY ≈ 100 → exp(-0.15) ≈ 1.16 倍，与原来的一格手感接近。
 */
const WHEEL_SENSITIVITY = 0.0015;
/**
 * 图片至少要有这么多像素留在幕内 —— 否则用户可以把它整个推出视野、再也找不回来。
 * （用户原话：「他会偏移导致找不到图片位置」）
 */
const MIN_VISIBLE = 80;

const CLOSED: LightboxHandle = { close: () => undefined };

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 打开全窗口预览幕。
 * @param spec - 标记、固有尺寸与文案。
 * @returns 句柄；调用 `close()` 关闭。
 */
export function showSvgLightbox(spec: LightboxSpec): LightboxHandle {
  return documentOwner("lightbox", () => openLightbox)(spec);
}

let seq = 0;
let active: LightboxHandle | null = null;

function openLightbox(spec: LightboxSpec): LightboxHandle {
  if (typeof document === "undefined") return CLOSED;
  injectStyles();
  // 同屏一次只开一张：新开顶掉旧的。
  active?.close();

  seq += 1;

  const root = document.createElement("div");
  // 根元素自带 token 宿主 —— 挂在 body 上，没有祖先给它 --omni-*。
  root.className = "omni-ui-lightbox omni-ui-tokens";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", spec.labels.dialog);

  const mask = document.createElement("div");
  mask.className = "omni-ui-lightboxMask";
  mask.setAttribute("aria-hidden", "true");

  const stage = document.createElement("div");
  stage.className = "omni-ui-lightboxStage";

  const image = document.createElement("div");
  image.className = "omni-ui-lightboxImage";
  image.setAttribute("aria-hidden", "true");
  // markup 已由 sanitizeSvg 净化（只留白名单标签/属性、剥脚本与外链）。
  image.innerHTML = spec.markup;
  stage.appendChild(image);

  const tools = document.createElement("div");
  tools.className = "omni-ui-lightboxTools";

  const mkTool = (label: string, text: string, wide: boolean): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = wide ? "omni-ui-lightboxTool omni-ui-lightboxToolWide" : "omni-ui-lightboxTool";
    button.setAttribute("aria-label", label);
    button.textContent = text;
    return button;
  };

  const zoomOut = mkTool(spec.labels.zoomOut, "−", false);
  const zoomIn = mkTool(spec.labels.zoomIn, "+", false);
  const fitBtn = mkTool(spec.labels.fit, spec.labels.fit, true);
  const actualBtn = mkTool(spec.labels.actual, spec.labels.actual, true);

  const scaleText = document.createElement("span");
  scaleText.className = "omni-ui-lightboxScale";
  scaleText.setAttribute("aria-live", "polite");

  tools.append(zoomOut, scaleText, zoomIn, fitBtn, actualBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "omni-ui-lightboxClose";
  closeBtn.setAttribute("aria-label", spec.labels.close);
  closeBtn.textContent = "×";

  root.append(mask, stage, tools, closeBtn);

  // ── 状态 ────────────────────────────────────────────────────────────────
  const base = {
    width: spec.intrinsic.width > 0 ? spec.intrinsic.width : 300,
    height: spec.intrinsic.height > 0 ? spec.intrinsic.height : 150,
  };
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let fitted = false;

  const stageBox = (): { w: number; h: number } => ({
    w: Math.max(1, stage.clientWidth - PADDING * 2),
    h: Math.max(1, stage.clientHeight - PADDING * 2),
  });

  const fitScale = (): number => {
    const box = stageBox();
    return Math.min(box.w / base.width, box.h / base.height);
  };

  /**
   * 把位移钳制住：图片至少要有 `MIN_VISIBLE` 像素留在幕内。
   *
   * **为什么需要**：原来只钳了 scale，offset 完全自由 —— 以光标为锚缩放时，
   * 光标靠近边缘就会把图推向另一侧，几下手势之后图整个跑出视野、再也找不回来
   * （用户原话：「他会偏移导致找不到图片位置」）。
   *
   * 图中心相对幕中心的允许范围：图右边缘 > MIN_VISIBLE 且左边缘 < 幕宽 - MIN_VISIBLE。
   * 图比幕还小时上下界会交叉，那时直接居中（offset = 0）。
   */
  const clampOffset = (): void => {
    const w = base.width * scale;
    const h = base.height * scale;
    const mx = Math.min(MIN_VISIBLE, w / 2);
    const my = Math.min(MIN_VISIBLE, h / 2);
    const loX = mx - stage.clientWidth / 2 - w / 2;
    const hiX = stage.clientWidth / 2 + w / 2 - mx;
    const loY = my - stage.clientHeight / 2 - h / 2;
    const hiY = stage.clientHeight / 2 + h / 2 - my;
    offsetX = loX > hiX ? 0 : clamp(offsetX, loX, hiX);
    offsetY = loY > hiY ? 0 : clamp(offsetY, loY, hiY);
  };

  const paint = (): void => {
    clampOffset();
    image.style.width = base.width * scale + "px";
    image.style.height = base.height * scale + "px";
    image.style.transform = "translate(" + offsetX + "px, " + offsetY + "px)";
    scaleText.textContent = Math.round(scale * 100) + "%";
  };

  const fit = (): void => {
    scale = fitScale();
    offsetX = 0;
    offsetY = 0;
    paint();
  };

  const actual = (): void => {
    scale = clamp(1, MIN_SCALE, MAX_SCALE);
    offsetX = 0;
    offsetY = 0;
    paint();
  };

  /** 以某个屏幕点为锚缩放（滚轮用）：锚点下的内容不动。 */
  const zoomAt = (next: number, anchorX: number, anchorY: number): void => {
    const target = clamp(next, MIN_SCALE, MAX_SCALE);
    if (target === scale) return;
    const k = target / scale;
    offsetX = anchorX - (anchorX - offsetX) * k;
    offsetY = anchorY - (anchorY - offsetY) * k;
    scale = target;
    paint();
  };

  // ── 关闭 ────────────────────────────────────────────────────────────────
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (active !== null && active.close === close) active = null;
    root.remove();
    document.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("resize", onResize);
    if (previousFocus !== null && previousFocus.isConnected) {
      try {
        previousFocus.focus();
      } catch {
        // 原焦点元素已经不可聚焦——不打扰用户。
      }
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  const onResize = (): void => {
    if (closed) return;
    // 窗口变了：重算适应比例；用户已经缩放过就只钳制，不重置。
    if (!fitted) fit();
    else paint();
  };

  mask.addEventListener("mousedown", close);
  closeBtn.addEventListener("click", close);
  zoomOut.addEventListener("click", () => { scale = clamp(scale / STEP, MIN_SCALE, MAX_SCALE); paint(); });
  zoomIn.addEventListener("click", () => { scale = clamp(scale * STEP, MIN_SCALE, MAX_SCALE); paint(); });
  fitBtn.addEventListener("click", fit);
  actualBtn.addEventListener("click", actual);

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const ax = event.clientX - rect.left - rect.width / 2;
    const ay = event.clientY - rect.top - rect.height / 2;
    // 按 deltaY 连续缩放 —— 触摸板一个手势几十次小 delta，鼠标一格一次大 delta，
    // 这样两种设备的手感一致。固定倍率会让触摸板 1.25^30 ≈ 800 倍。
    zoomAt(scale * Math.exp(-event.deltaY * WHEEL_SENSITIVITY), ax, ay);
  }, { passive: false });

  // 拖拽平移（放大后看局部）。
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, ox: offsetX, oy: offsetY };
    stage.setPointerCapture(event.pointerId);
    stage.dataset.dragging = "true";
  });
  stage.addEventListener("pointermove", (event) => {
    if (drag === null) return;
    offsetX = drag.ox + (event.clientX - drag.x);
    offsetY = drag.oy + (event.clientY - drag.y);
    paint();
  });
  const endDrag = (event: PointerEvent): void => {
    drag = null;
    delete stage.dataset.dragging;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // 双击：适应 ↔ 原始大小。
  stage.addEventListener("dblclick", () => {
    if (Math.abs(scale - 1) < 0.001) fit();
    else actual();
  });

  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("resize", onResize);
  document.body.appendChild(root);
  closeBtn.focus();
  fit();
  fitted = true;

  const handle: LightboxHandle = { close };
  active = handle;
  return handle;
}
