/**
 * Stylesheet for the reasoning-effort slider and the composer model seat.
 *
 * The slider visualizes whatever effort levels the current model exposes, so
 * the "peak intensity" effects key off the `[data-top]` existence flag the
 * component stamps on the highest level rather than any hardcoded effort id.
 *
 * @module dsh-reasoning-effort/client/styles
 */
import { CHIBI_STRIP } from './assets.js'

export const CSS = `
.omnieff-effort {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  width: 100%;
  min-width: 0;
  height: auto;
  padding: 11px 2px 9px;
  color: var(--omni-label-secondary);
  user-select: none;
  box-sizing: border-box;
}
.omnieff-effort-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
  line-height: 1.2;
}
.omnieff-effort-caption {
  color: var(--omni-label-secondary);
  font-size: 12px;
  letter-spacing: .01em;
}
.omnieff-effort-current {
  color: var(--omni-label-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .01em;
}
.omnieff-effort-slider {
  --omnieff-progress: 50%;
  position: relative;
  width: 100%;
  height: 38px;
  flex: 1 1 auto;
  border-radius: 999px;
  isolation: isolate;
  transition: filter 180ms ease;
}
.omnieff-effort-ticks {
  position: absolute;
  z-index: 3;
  inset: 50% 16px auto 16px;
  height: 8px;
  transform: translateY(-50%);
  pointer-events: none;
}
.omnieff-effort-tick {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(31, 91, 156, .28);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .42);
  transform: translate(-50%, -50%);
  transition: background 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
.omnieff-effort-tick[data-active] {
  background: var(--omni-brand);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, .72), 0 0 9px rgba(57, 128, 218, .35);
}
.omnieff-effort-endpoints {
  display: flex;
  justify-content: space-between;
  padding: 0 9px;
  color: var(--omni-label-tertiary);
  font-size: 10px;
  line-height: 1;
}
.omnieff-effort-track {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(100deg, #03040a 0%, #071126 22%, #101d4c 45%, #302262 70%, #5d35a0 100%);
  box-shadow:
    inset 0 1px 0 rgba(189, 199, 255, .15),
    inset 0 -1px 0 rgba(0, 0, 0, .55),
    0 3px 10px rgba(12, 17, 55, .34);
}
.omnieff-effort-track::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 45%, rgba(82, 130, 255, .12), transparent 24%),
    linear-gradient(90deg, rgba(0, 0, 0, .28), transparent 42%, rgba(168, 113, 255, .12));
  pointer-events: none;
}
.omnieff-effort-fx {
  position: absolute;
  z-index: 1;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  /*
   * WKWebView 会把 mix-blend-mode 子层提升后绕过 overflow 的圆角裁剪。
   * clip-path 在整个 fx 子树完成合成后统一裁切，因此 canvas 与 flare
   * 靠近 off 时也只能画在轨道胶囊内。
   */
  -webkit-clip-path: inset(0 round 999px);
  clip-path: inset(0 round 999px);
  pointer-events: none;
}
.omnieff-effort-canvas {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 100%;
  /* Canvas 自裁剪是二级防线；整个混合特效层由父级 clip-path 收口。 */
  border-radius: inherit;
  opacity: 1;
  image-rendering: pixelated;
  mix-blend-mode: screen;
  transition: filter 140ms ease;
}
.omnieff-effort-flare {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: var(--omnieff-progress);
  width: 78px;
  height: 46px;
  border-radius: 50%;
  /* 白中心降级：原版 .96 在低档位时呈突兀白盘，收敛为柔和辉光。 */
  background: radial-gradient(ellipse at 100% 50%, rgba(255,255,255,.55) 0 4%, rgba(188,189,255,.7) 11%, rgba(106,87,255,.45) 28%, rgba(105,31,255,.18) 49%, transparent 74%);
  filter: blur(2px) saturate(1.25);
  mix-blend-mode: screen;
  transform: translate(-100%, -50%);
  transition: left 70ms linear, filter 140ms ease;
  pointer-events: none;
}
.omnieff-effort-flare::before,
.omnieff-effort-flare::after {
  content: "";
  position: absolute;
  inset: 50% auto auto 100%;
  border-radius: 999px;
  transform: translate(-50%, -50%);
}
.omnieff-effort-flare::before {
  width: 52px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(100,160,255,.42), #f1ecff, rgba(193,82,255,.65), transparent);
  box-shadow: 0 0 7px #9b7cff, 0 0 13px rgba(72,132,255,.64);
}
.omnieff-effort-flare::after {
  width: 1px;
  height: 20px;
  background: linear-gradient(180deg, transparent, rgba(196,190,255,.84), transparent);
  box-shadow: 0 0 7px #9c7cff;
}
.omnieff-effort-knob {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: clamp(14px, var(--omnieff-progress), calc(100% - 14px));
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255,255,255,.94);
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 0 0 2px rgba(92,105,255,.12),
    0 0 14px rgba(121,82,255,.48),
    0 2px 7px rgba(0,0,0,.3);
  transform: translate(-50%, -50%);
  transition: left 190ms cubic-bezier(.22,1,.36,1), transform 160ms ease, box-shadow 180ms ease;
  pointer-events: none;
}
.omnieff-effort.is-chibi {
  height: auto;
}
.omnieff-effort.is-chibi .omnieff-effort-knob {
  left: clamp(10px, var(--omnieff-progress), calc(100% - 10px));
  width: 40px;
  height: 55px;
  border: 0;
  border-radius: 8px;
  background-color: transparent;
  background-image: url("${CHIBI_STRIP}");
  background-repeat: no-repeat;
  background-position: 0 0;
  background-size: 800% 100%;
  box-shadow: none !important;
  filter:
    drop-shadow(0 1px 1px rgba(0, 0, 0, .28))
    drop-shadow(0 0 5px rgba(92, 105, 255, .34));
  animation: omnieff-chibi-run 720ms step-end infinite;
  transform-origin: 50% 68%;
}
.omnieff-effort.is-chibi.is-dragging .omnieff-effort-knob {
  animation-duration: 420ms;
  filter:
    drop-shadow(0 2px 1px rgba(0, 0, 0, .28))
    drop-shadow(0 0 8px rgba(87, 137, 255, .68));
}
.omnieff-effort-input {
  position: absolute;
  z-index: 5;
  inset: -5px 0;
  width: 100%;
  height: calc(100% + 10px);
  margin: 0;
  opacity: 0;
  cursor: grab;
  touch-action: none;
}
.omnieff-effort-input:active { cursor: grabbing; }
.omnieff-effort-input:focus-visible + .omnieff-effort-knob {
  outline: 2px solid var(--omni-brand);
  outline-offset: 2px;
}
.omnieff-effort.is-dragging .omnieff-effort-knob { outline: none; }
.omnieff-effort.is-dragging .omnieff-effort-canvas {
  filter: saturate(1.45) brightness(1.28) contrast(1.06);
}
.omnieff-effort.is-dragging .omnieff-effort-flare {
  filter: blur(1.5px) saturate(1.6) brightness(1.42);
  transition: none;
}
.omnieff-effort.is-dragging .omnieff-effort-knob {
  transform: translate(-50%, -50%) scale(1.07);
  transition: none;
  box-shadow:
    0 0 0 3px rgba(113,115,255,.25),
    0 0 20px rgba(74,145,255,.86),
    0 0 31px rgba(171,53,255,.66),
    0 3px 8px rgba(0,0,0,.32);
}
.omnieff-effort-slider[data-top] .omnieff-effort-track {
  animation: re-effort-dark-breathe 1.9s ease-in-out infinite;
}
.omnieff-effort-slider[data-top] .omnieff-effort-knob {
  box-shadow:
    0 0 0 3px rgba(119,99,255,.18),
    0 0 22px rgba(135,78,255,.76),
    0 0 34px rgba(53,121,255,.34),
    0 3px 8px rgba(0,0,0,.3);
}
.omnieff-effort.is-error .omnieff-effort-slider {
  outline: 1px solid var(--omni-danger);
  outline-offset: 2px;
}
.omnieff-effort.is-busy { opacity: .72; }
.omnieff-effort-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.omnieff-model-root {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.omnieff-model-root[data-omnieff-pending] {
  align-items: center;
  height: 28px;
  padding: 0 8px 0 10px;
  color: var(--omni-label-tertiary, inherit);
}
.omnieff-chat-readonly {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 260px;
  height: 28px;
  padding: 0 8px 0 10px;
  color: var(--omni-label-primary);
  cursor: default;
}
/* The React gate owns the branch; this CSS closes the transient session-switch frame. */
body[data-omniwc="unavailable"] .omnieff-model-trigger,
body[data-omniwc="unavailable"] .omnieff-model-menu,
body[data-omniwc="chat"] .omnieff-model-trigger,
body[data-omniwc="chat"] .omnieff-model-menu { display: none; }
.omnieff-model-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 230px;
  height: 28px;
  padding: 0 8px 0 10px;
  border: 0;
  border-radius: 9px;
  color: var(--omni-label-primary);
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: background 140ms ease;
}
.omnieff-model-trigger:hover,
.omnieff-model-trigger[aria-expanded="true"] {
  background: var(--omni-fill);
}
.omnieff-model-trigger:disabled { cursor: not-allowed; opacity: .5; }
.omnieff-model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1;
}
.omnieff-model-effort {
  flex: 0 0 auto;
  color: var(--omni-brand);
  font-size: 12px;
  line-height: 1;
}
.omnieff-model-chevron {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin: -3px 1px 0 3px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  opacity: .55;
  transform: rotate(45deg);
  transition: transform 150ms ease, margin 150ms ease;
}
.omnieff-model-trigger[aria-expanded="true"] .omnieff-model-chevron {
  margin-top: 3px;
  transform: rotate(225deg);
}
.omnieff-model-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 1200;
  width: min(312px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid var(--omni-stroke);
  border-radius: 16px;
  color: var(--omni-label-primary);
  background: var(--omni-bg-elevated);
  box-shadow: 0 14px 42px rgba(18, 24, 42, .18), 0 3px 10px rgba(18, 24, 42, .08);
  animation: re-menu-in 150ms cubic-bezier(.22,1,.36,1);
}
.omnieff-advanced {
  padding: 10px 12px 8px;
}
.omnieff-team-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 6px 14px;
  cursor: pointer;
}
.omnieff-menu-separator {
  height: 1px;
  background: var(--omni-stroke);
}
.omnieff-model-row,
.omnieff-model-option,
.omnieff-model-back {
  width: 100%;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.omnieff-model-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 45px;
  padding: 0 14px;
  text-align: left;
}
.omnieff-model-row.has-slider { grid-template-columns: minmax(0, 1fr) auto; }
.omnieff-model-row:hover,
.omnieff-model-option:hover,
.omnieff-model-back:hover { background: var(--omni-fill); }
.omnieff-model-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.omnieff-model-row-effort { color: var(--omni-brand); font-size: 12px; }
.omnieff-row-chevron { font-size: 20px; line-height: 1; opacity: .42; }
.omnieff-model-pane { max-height: min(390px, 60vh); overflow-y: auto; padding: 7px; }
.omnieff-model-back {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  border-radius: 8px;
  text-align: left;
  color: var(--omni-label-secondary);
  font-size: 12px;
}
.omnieff-model-group-title { padding: 10px 9px 5px; color: var(--omni-label-tertiary); font-size: 11px; }
.omnieff-model-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 7px 9px;
  border-radius: 9px;
  text-align: left;
}
.omnieff-model-option-copy { min-width: 0; }
.omnieff-model-option-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.omnieff-model-option-desc { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--omni-label-tertiary); font-size: 10px; }
.omnieff-model-check { color: var(--omni-brand); font-size: 15px; text-align: center; }
.omnieff-model-status { padding: 14px; color: var(--omni-label-tertiary); font-size: 12px; text-align: center; }
.omnieff-model-error { margin: 8px; padding: 8px 10px; border-radius: 8px; color: var(--omni-danger); background: var(--omni-danger-soft); font-size: 11px; }
.omnieff-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--omni-border);
}
.omnieff-setting-copy { min-width: 0; }
.omnieff-setting-title {
  color: var(--omni-label-primary);
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
}
.omnieff-setting-description {
  margin-top: 3px;
  color: var(--omni-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.omnieff-setting-control { display: inline-flex; align-items: center; gap: 10px; flex: none; }
.omnieff-setting-state { color: var(--omni-label-secondary); font-size: 13px; }
.omnieff-setting-switch {
  position: relative;
  width: 38px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--omni-fill-strong);
  cursor: pointer;
  transition: background 150ms ease;
}
.omnieff-setting-switch:hover { filter: brightness(.97); }
.omnieff-setting-switch:disabled { cursor: not-allowed; opacity: .45; }
.omnieff-setting-switch:focus-visible {
  outline: 2px solid var(--omni-brand);
  outline-offset: 2px;
}
.omnieff-setting-switch.is-on { background: var(--omni-brand); }
.omnieff-setting-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.2);
  transition: transform 170ms cubic-bezier(.22,1,.36,1);
}
.omnieff-setting-switch.is-on .omnieff-setting-switch-knob { transform: translateX(16px); }
body[data-ds-dark-theme] .omnieff-model-menu {
  border-color: rgba(136, 145, 180, .2);
  color: var(--omni-label-primary);
  background: var(--omni-bg-elevated);
  box-shadow: 0 18px 46px rgba(0,0,0,.48), 0 3px 12px rgba(0,0,0,.32);
}
body[data-ds-dark-theme] .omnieff-model-trigger { color: var(--omni-label-primary); }
@keyframes re-menu-in {
  from { opacity: 0; transform: translateY(5px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
body:not([data-ds-dark-theme]) .omnieff-effort-slider {
  filter: none;
}
body:not([data-ds-dark-theme]) .omnieff-effort-track {
  background: var(--dsw-static-blue-75, #e5f0ff);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.9),
    inset 0 0 0 1px rgba(80,133,194,.14),
    0 3px 10px rgba(48,101,165,.13);
}
body:not([data-ds-dark-theme]) .omnieff-effort-track::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0 auto 0 0;
  width: var(--omnieff-progress);
  border-radius: inherit;
  background: linear-gradient(90deg, #fff 0%, #e2f0ff 20%, #a8d0fb 57%, #438fdf 100%);
  transition: width 190ms cubic-bezier(.22,1,.36,1);
}
body:not([data-ds-dark-theme]) .omnieff-effort-slider[data-top] .omnieff-effort-track::before {
  background: linear-gradient(90deg, #fff 0%, #d7eaff 18%, #75afea 54%, #0751ad 100%);
}
body:not([data-ds-dark-theme]) .omnieff-effort.is-dragging .omnieff-effort-track::before {
  transition: none;
}
body:not([data-ds-dark-theme]) .omnieff-effort-track::after {
  z-index: 1;
  background: linear-gradient(90deg, rgba(255,255,255,.48), transparent 34%, rgba(23,101,201,.07));
}
body:not([data-ds-dark-theme]) .omnieff-effort-canvas {
  opacity: .78;
  mix-blend-mode: multiply;
}
body[data-ds-dark-theme] .omnieff-effort-tick {
  background: rgba(207, 222, 255, .34);
  box-shadow: 0 0 0 1px rgba(5, 10, 25, .3);
}
body[data-ds-dark-theme] .omnieff-effort-tick[data-active] {
  background: #b8d4ff;
  box-shadow: 0 0 0 2px rgba(20, 38, 78, .65), 0 0 10px rgba(100, 156, 255, .5);
}
body:not([data-ds-dark-theme]) .omnieff-effort-flare {
  background: radial-gradient(ellipse at 100% 50%, rgba(255,255,255,.98) 0 5%, rgba(204,231,255,.88) 13%, rgba(91,162,241,.48) 31%, rgba(37,111,207,.16) 53%, transparent 75%);
  filter: blur(2px) saturate(1.12);
}
body:not([data-ds-dark-theme]) .omnieff-effort-flare::before {
  background: linear-gradient(90deg, transparent, rgba(116,177,244,.34), #fff, rgba(66,139,225,.58), transparent);
  box-shadow: 0 0 7px rgba(58,133,222,.5), 0 0 13px rgba(104,176,255,.38);
}
body:not([data-ds-dark-theme]) .omnieff-effort-flare::after {
  background: linear-gradient(180deg, transparent, rgba(255,255,255,.94), transparent);
  box-shadow: 0 0 7px rgba(64,137,224,.44);
}
body:not([data-ds-dark-theme]) .omnieff-effort-knob {
  border-color: rgba(126,160,197,.32);
  box-shadow:
    0 0 0 2px rgba(58,124,207,.09),
    0 0 13px rgba(48,118,207,.3),
    0 3px 8px rgba(39,77,119,.18);
}
body:not([data-ds-dark-theme]) .omnieff-effort-slider[data-top] .omnieff-effort-track {
  animation-name: re-effort-light-breathe;
}
body:not([data-ds-dark-theme]) .omnieff-effort-slider[data-top] .omnieff-effort-knob,
body:not([data-ds-dark-theme]) .omnieff-effort.is-dragging .omnieff-effort-knob {
  box-shadow:
    0 0 0 3px rgba(36,105,192,.15),
    0 0 20px rgba(25,100,201,.45),
    0 3px 8px rgba(39,77,119,.18);
}
@keyframes re-effort-dark-breathe {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(196,204,255,.16), 0 3px 10px rgba(18,25,72,.4); }
  50% { box-shadow: inset 0 1px 0 rgba(220,214,255,.24), 0 0 21px rgba(111,66,255,.5); }
}
@keyframes re-effort-light-breathe {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(67,124,193,.16), 0 3px 10px rgba(48,101,165,.13); }
  50% { box-shadow: inset 0 1px 0 rgba(255,255,255,.96), inset 0 0 0 1px rgba(31,102,190,.22), 0 0 19px rgba(31,105,201,.24); }
}
@keyframes omnieff-chibi-run {
  0% { background-position: 14.285714% 0; }
  14.285714% { background-position: 28.571429% 0; }
  28.571429% { background-position: 42.857143% 0; }
  42.857143% { background-position: 57.142857% 0; }
  57.142857% { background-position: 71.428571% 0; }
  71.428571% { background-position: 85.714286% 0; }
  85.714286%, 100% { background-position: 100% 0; }
}
.omnieff-adapt {
  padding: 10px 14px 12px;
}
.omnieff-adapt-copy { min-width: 0; }
.omnieff-adapt-title {
  color: var(--omni-label-primary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}
.omnieff-adapt-desc {
  margin-top: 3px;
  color: var(--omni-label-tertiary);
  font-size: 11px;
  line-height: 1.55;
}
.omnieff-adapt-open {
  margin-top: 8px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: var(--omni-brand);
  font-size: 12px;
  cursor: pointer;
}
.omnieff-adapt-open:hover { filter: brightness(1.06); }
.omnieff-adapt-panel {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--omni-stroke);
  border-radius: 10px;
  background: var(--omni-bg-muted);
}
body[data-ds-dark-theme] .omnieff-adapt-panel {
  background: rgba(20, 22, 30, .5);
}
.omnieff-adapt-scroll {
  max-height: min(260px, 40vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
  scrollbar-width: thin;
}
.omnieff-adapt-panel-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--omni-label-secondary);
}
.omnieff-adapt-arrow { color: var(--omni-brand); font-weight: 500; }
.omnieff-adapt-yaml {
  margin: 9px 0 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 8px;
  color: var(--omni-label-secondary);
  background: rgba(120, 125, 140, .08);
  font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.omnieff-adapt-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  color: var(--omni-label-tertiary);
  font-size: 11px;
  line-height: 1.55;
}
.omnieff-adapt-steps code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--omni-fill);
}
.omnieff-adapt-warning {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--omni-warn);
  background: var(--omni-warn-soft);
  font-size: 11px;
  line-height: 1.6;
}
.omnieff-adapt-label {
  margin-top: 10px;
  color: var(--omni-label-secondary);
  font-size: 11px;
  font-weight: 500;
}
.omnieff-adapt-step-title {
  font-weight: 500;
  color: var(--omni-label-secondary);
}
.omnieff-adapt-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.omnieff-adapt-apply,
.omnieff-adapt-cancel {
  padding: 5px 12px;
  border: 0;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
}
.omnieff-adapt-apply {
  color: #fff;
  background: var(--omni-brand);
}
.omnieff-adapt-cancel {
  color: var(--omni-label-secondary);
  background: var(--omni-fill);
}
.omnieff-adapt-apply:disabled,
.omnieff-adapt-cancel:disabled { cursor: wait; opacity: .6; }
@media (prefers-reduced-motion: reduce) {
  .omnieff-effort-slider[data-top] .omnieff-effort-track { animation: none; }
  .omnieff-effort-knob,
  .omnieff-effort-flare,
  body:not([data-ds-dark-theme]) .omnieff-effort-track::before { transition: none; }
  .omnieff-model-menu { animation: none; }
  .omnieff-effort.is-chibi .omnieff-effort-knob { animation: none; }
}
`
