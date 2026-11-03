/**
 * Control sheet on top of tokens.ts. Components use --omni-* only.
 */
import { UI_SHEET_VERSION, uiSheetWins } from "./sheet-version.js";
import { TOKEN_SHEET } from "./tokens.js";

const CONTROLS = `
/* Settings-page column: 760px bar width for pages that live inside the official settings surface. Do NOT use
 * it as a full main-panel page root — the sidebar pages fill the panel and carry their own padding (0.1.4
 * shipped that mistake: content was capped at 760px, left-aligned and flush with the sidebar edge). */
.omni-ui{color:var(--omni-label-primary);display:flex;flex-direction:column;gap:var(--omni-gap-section);max-width:760px}
/* Main-panel page root: fills the panel, owns the page padding, keeps the readable column centred on very
 * wide windows, and is the SCROLL CONTAINER for the page. The center column around the main slot is
 * display:flex / flex-direction:column / overflow:hidden, so a page that does not claim the leftover height is
 * clipped with no way to reach the rest (0.1.6: the skills tab with more than a screen of rows could not
 * scroll). flex:1 1 auto claims the height when the slot wrapper is a flex child, height:100% covers a
 * definite-height wrapper, and min-height:0 keeps the flex item shrinkable instead of growing the column. */
.omni-ui-page{box-sizing:border-box;color:var(--omni-label-primary);display:flex;flex-direction:column;gap:var(--omni-gap-section);width:100%;max-width:1120px;margin:0 auto;padding:24px 32px 32px;flex:1 1 auto;min-height:0;height:100%;overflow-y:auto;overscroll-behavior:contain}
/* Embedded bundle-page content: fill and centre the readable column inside the official page, but do not own scrolling. The official page remains the scroll container; using .omni-ui-page here would create a nested scroll box and clip the bottom. */
.omni-ui-pageContent{box-sizing:border-box;color:var(--omni-label-primary);display:flex;flex-direction:column;gap:var(--omni-gap-section);width:100%;max-width:1120px;margin:0 auto;padding:24px 32px 32px}
.omni-ui-pageHead{display:flex;flex-direction:column;gap:4px}
.omni-ui-pageHeadRow{display:flex;align-items:center;justify-content:space-between;gap:var(--omni-gap);min-width:0}
.omni-ui-pageHeadLead{display:flex;align-items:center;gap:var(--omni-gap-tight);min-width:0}
.omni-ui-pageMark{flex:none;display:inline-flex;align-items:center}
.omni-ui-pageTitle{margin:0;font-size:18px;font-weight:600;line-height:1.3;color:var(--omni-label-primary)}
.omni-ui-pageDesc{margin:0;font-size:13px;line-height:1.5;color:var(--omni-label-tertiary)}
.omni-ui-pageHeadActions{flex:none;display:flex;align-items:center;gap:var(--omni-gap-tight)}
.omni-ui-tabs{display:flex;align-items:flex-end;gap:22px;border-bottom:1px solid var(--omni-border);margin:0}
.omni-ui-tab{position:relative;appearance:none;border:0;padding:7px 1px 9px;background:transparent;color:var(--omni-label-tertiary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.omni-ui-tab:hover,.omni-ui-tab[data-active="true"]{color:var(--omni-label-primary)}
.omni-ui-tab[data-active="true"]::after,.omni-ui-tab:focus-visible::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:var(--omni-label-primary);content:""}
.omni-ui-tab:focus-visible{outline:2px solid var(--omni-brand);outline-offset:2px;border-radius:2px}
.omni-ui-card{list-style:none;border:1px solid var(--omni-border);border-radius:var(--omni-radius);background:var(--omni-bg);display:flex;flex-direction:column;transition:border-color .16s,background .16s}
.omni-ui-card:hover{border-color:var(--omni-border-strong)}
.omni-ui-cardOpen{border-color:var(--omni-border-strong)}
.omni-ui-cardHeader{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:var(--omni-gap);padding:14px 16px;border-radius:var(--omni-radius)}
.omni-ui-cardHeader:focus-visible{outline:2px solid var(--omni-brand);outline-offset:-2px}
.omni-ui-cardHeadText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;min-height:calc(21px + 4px + 19.5px)}
.omni-ui-cardTitle{margin:0;font-size:15px;font-weight:600;line-height:1.4;color:var(--omni-label-primary)}
.omni-ui-cardDesc{margin:0;font-size:13px;line-height:1.5;min-height:1.5em;color:var(--omni-label-tertiary);word-break:break-all}
.omni-ui-chevron{flex:none;color:var(--omni-label-tertiary);transition:transform .16s}
.omni-ui-chevronOpen{transform:rotate(180deg)}
.omni-ui-cardBadge{flex:none}
.omni-ui-badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--omni-bg);color:var(--omni-label-secondary);border:1px solid var(--omni-border);flex:none;align-self:flex-start;width:max-content}
.omni-ui-badgeDot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.omni-ui-badgeOk{color:var(--omni-label-primary);border-color:var(--omni-border-strong)}
.omni-ui-badgeWarn{color:var(--omni-brand)}
.omni-ui-badgeErr{color:var(--omni-label-error);border-color:var(--omni-danger)}
.omni-ui-badgeMuted{color:var(--omni-label-tertiary)}
.omni-ui-qrWrap{display:flex;flex-direction:column;gap:var(--omni-gap-tight);align-items:flex-start}
.omni-ui-qr{width:200px;height:200px;border:1px solid var(--omni-border);border-radius:var(--omni-radius-control);background:#fff;object-fit:contain;padding:8px;box-sizing:border-box}
.omni-ui-cardBody{display:flex;flex-direction:column;gap:var(--omni-gap);margin:0 16px;padding:var(--omni-gap-tight) 0 var(--omni-gap);border-top:1px solid var(--omni-border)}
/* Nested provider card body: same inset title/content rule as SettingsCard, but with a title-row action group. */
.omni-ui-cardBodyInset{display:flex;flex-direction:column;gap:var(--omni-gap);margin:0 16px;padding:var(--omni-gap-tight) 0 var(--omni-gap);border-top:1px solid var(--omni-border)}
.omni-ui-cardStatic{padding:14px 16px;gap:var(--omni-gap-tight)}
.omni-ui-cardStatic .omni-ui-cardBody{margin:0;padding:var(--omni-gap-tight) 0 0;border-top:1px solid var(--omni-border)}
.omni-ui-cardFooter{display:flex;flex-wrap:wrap;gap:var(--omni-gap-tight);align-items:center;justify-content:flex-end;margin:0 16px;padding:var(--omni-gap) 0 14px;border-top:1px solid var(--omni-border)}
.omni-ui-cardStatic .omni-ui-cardFooter{margin:0;padding:var(--omni-gap) 0 0}
.omni-ui-field{display:flex;flex-direction:column;gap:6px}
.omni-ui-fieldHead{display:flex;align-items:center;gap:8px}
.omni-ui-fieldHead .omni-ui-label{flex:1;min-width:0}
.omni-ui-textAction{appearance:none;border:0;background:transparent;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--omni-label-tertiary);cursor:pointer;white-space:nowrap}
.omni-ui-textAction:hover:not(:disabled){color:var(--omni-label-primary)}
.omni-ui-textAction:disabled{opacity:.4;cursor:default}
.omni-ui-textAction:focus-visible{outline:2px solid var(--omni-brand);outline-offset:2px;border-radius:2px}
.omni-ui-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--omni-label-primary)}
.omni-ui-hint{margin:0;font-size:12px;line-height:1.5;color:var(--omni-label-tertiary)}
.omni-ui-hintError{color:var(--omni-label-error)}
.omni-ui-input,.omni-ui-textarea{appearance:none;border:1px solid var(--omni-border);background:var(--omni-bg);font:inherit;color:var(--omni-label-primary);border-radius:var(--omni-radius-control);font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}
.omni-ui-input{height:var(--omni-control-height);padding:0 12px}
.omni-ui-textarea{min-height:72px;padding:8px 12px;resize:none;overflow:auto}
.omni-ui-notesPad{display:flex;flex-direction:column;gap:var(--omni-gap-tight);width:100%}
.omni-ui-notesMeta{display:flex;align-items:center;justify-content:space-between;gap:var(--omni-gap);min-height:20px}
.omni-ui-notesStatus{display:flex;align-items:center;min-width:0}
.omni-ui-notesCount{flex:none;font-size:12px;line-height:1.4;font-variant-numeric:tabular-nums;color:var(--omni-label-tertiary)}
.omni-ui-notesCountWarn{color:var(--omni-warn)}
.omni-ui-notesCountOver{color:var(--omni-label-error)}
.omni-ui-textareaNotes{min-height:240px;padding:12px 14px;line-height:1.65;border-color:var(--omni-border)}
.omni-ui-input:focus-visible,.omni-ui-textarea:focus-visible{border-color:var(--omni-brand);outline:none}
.omni-ui-input:disabled,.omni-ui-textarea:disabled{color:var(--omni-label-tertiary);cursor:default}
.omni-ui-input::placeholder,.omni-ui-textarea::placeholder{color:var(--omni-label-tertiary)}
.omni-ui-btn{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:var(--omni-control-height);border:1px solid var(--omni-border);border-radius:var(--omni-radius-control);padding:0 14px;font:inherit;font-size:13px;line-height:1.4;cursor:pointer;background:none;color:var(--omni-label-secondary)}
.omni-ui-btn:hover:not(:disabled){color:var(--omni-label-primary);border-color:var(--omni-border-strong)}
.omni-ui-btn:disabled{opacity:.4;cursor:default}
.omni-ui-btn:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
.omni-ui-btnPrimary{background:var(--omni-label-primary);color:var(--omni-bg);border-color:transparent}
.omni-ui-btnPrimary:hover:not(:disabled){opacity:.9;color:var(--omni-bg);background:var(--omni-label-primary);border-color:transparent}
.omni-ui-btnDanger{border-color:var(--omni-danger);color:var(--omni-danger)}
.omni-ui-btnDanger:hover:not(:disabled){border-color:var(--omni-danger);color:var(--omni-danger);background:transparent}
.omni-ui-btnGhost{border-color:transparent;padding-inline:8px;color:var(--omni-label-secondary)}
.omni-ui-btnGhost:hover:not(:disabled){border-color:transparent;background:var(--omni-fill)}
.omni-ui-btnLink{background:transparent;border-color:transparent;min-height:20px;padding:0 2px;color:var(--omni-label-secondary);font-size:13px;line-height:20px}
.omni-ui-btnLink:hover:not(:disabled){background:transparent;border-color:transparent;color:var(--omni-label-primary);text-decoration:underline}
.omni-ui-btnDangerGhost:hover:not(:disabled),.omni-ui-btnDangerGhost:focus-visible{color:var(--omni-danger);background:var(--omni-danger-soft);border-color:transparent}
.omni-ui-btn[aria-busy=true]{cursor:progress}
.omni-ui-actionGroup{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--omni-gap-section);max-width:100%;min-width:0}
.omni-ui-actionCluster{display:flex;flex-wrap:wrap;align-items:center;gap:var(--omni-gap-tight);min-width:0;max-width:100%}
.omni-ui-actionGroup .omni-ui-btn{max-width:100%;overflow-wrap:anywhere;min-height:34px}
.omni-ui-formGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:var(--omni-gap-section);min-width:0}
.omni-ui-formGrid>*{min-width:0}
.omni-ui-check{display:flex;align-items:center;gap:var(--omni-gap-tight);min-height:34px;font-size:13px;line-height:1.5;color:var(--omni-label-primary);cursor:pointer;overflow-wrap:anywhere}
.omni-ui-check input{flex:none;margin:0;width:16px;height:16px;accent-color:var(--omni-brand)}
.omni-ui-check:has(input:disabled){opacity:.5;cursor:default}
.omni-ui-check input:focus-visible,.omni-ui-slider input:focus-visible{outline:2px solid var(--omni-brand);outline-offset:3px}
.omni-ui-controlHint{display:block}
.omni-ui-switch input{appearance:none;box-sizing:border-box;width:34px;height:20px;border:1px solid var(--omni-border-strong);border-radius:999px;background:var(--omni-bg-muted);position:relative;cursor:inherit}
.omni-ui-switch input::before{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--omni-label-secondary)}
.omni-ui-switch input:checked{background:var(--omni-brand);border-color:var(--omni-brand)}
.omni-ui-switch input:checked::before{left:16px;background:var(--omni-bg)}
.omni-ui-radioGroup{margin:0;padding:0;border:0;display:flex;flex-direction:column;gap:4px;min-width:0}
.omni-ui-radioGroup legend{margin-bottom:4px;padding:0}
.omni-ui-slider{display:flex;flex-direction:column;gap:var(--omni-gap-tight);min-width:0}
.omni-ui-slider output{font-size:12px;font-variant-numeric:tabular-nums;color:var(--omni-label-secondary)}
.omni-ui-slider input{width:100%;margin:0;min-height:32px;accent-color:var(--omni-brand);cursor:pointer}
.omni-ui-slider input:disabled{opacity:.5;cursor:default}
.omni-ui-disclosure{min-width:0;border-top:1px solid var(--omni-border)}
.omni-ui-listRow .omni-ui-disclosure{border-top:0}
.omni-ui-disclosure>summary{padding:12px 0;cursor:pointer;font-size:13px;font-weight:500;color:var(--omni-label-primary);overflow-wrap:anywhere}
.omni-ui-disclosure>summary:focus-visible{outline:2px solid var(--omni-brand);outline-offset:2px}
.omni-ui-disclosure[open]>.omni-ui-stack{padding-bottom:12px}
.omni-ui-progress{display:flex;flex-direction:column;gap:var(--omni-gap-tight)}
.omni-ui-progress progress{width:100%;height:8px;accent-color:var(--omni-brand)}
.omni-ui-skeleton{display:flex;flex-direction:column;gap:var(--omni-gap-tight)}
.omni-ui-skeleton span{display:block;height:14px;border-radius:4px;background:var(--omni-fill);animation:omni-ui-skeleton-pulse 1.4s ease-in-out infinite alternate}
@keyframes omni-ui-skeleton-pulse{to{opacity:.45}}
@media(prefers-reduced-motion:reduce){.omni-ui-skeleton span{animation:none}}
@media(forced-colors:active){.omni-ui-switch input:checked{background:Highlight}.omni-ui-switch input::before{background:ButtonText}.omni-ui-switch input:checked::before{background:HighlightText}.omni-ui-skeleton span{background:GrayText}}
@media(max-width:520px){.omni-ui-actionGroup{justify-content:flex-start}}
.omni-ui-actions{display:flex;flex-wrap:wrap;gap:var(--omni-gap-tight)}
.omni-ui-empty{display:flex;flex-direction:column;gap:var(--omni-gap-tight);padding:var(--omni-gap-tight) 0}
.omni-ui-emptyTitle{margin:0;font-size:13px;font-weight:500;color:var(--omni-label-primary)}
.omni-ui-emptyDesc{margin:0;font-size:12px;line-height:1.5;color:var(--omni-label-tertiary)}
.omni-ui-link{color:var(--omni-brand);text-decoration:underline;text-underline-offset:2px;font-size:13px;line-height:1.5}
.omni-ui-link:hover{opacity:.85}
.omni-ui-status{margin:0;font-size:13px;line-height:1.5;color:var(--omni-label-secondary)}
.omni-ui-capsuleBlock{display:flex;flex-direction:column;gap:var(--omni-gap)}
.omni-ui-capsule{display:flex;flex-wrap:wrap;gap:0;padding:3px;border:1px solid var(--omni-border);border-radius:999px;background:var(--omni-bg);width:fit-content;max-width:100%}
.omni-ui-capsuleItem{appearance:none;border:0;background:transparent;font:inherit;font-size:13px;line-height:1.4;font-weight:500;color:var(--omni-label-secondary);padding:6px 14px;border-radius:999px;cursor:pointer;white-space:nowrap}
.omni-ui-capsuleItem:hover:not(:disabled):not(.omni-ui-capsuleItemActive){color:var(--omni-label-primary)}
.omni-ui-capsuleItem:disabled{opacity:.4;cursor:default}
.omni-ui-capsuleItem:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
.omni-ui-capsuleItemActive{background:var(--omni-label-primary);color:var(--omni-bg)}
.omni-ui-dial{position:relative;box-sizing:border-box;flex:none;width:100%;min-width:0;height:34px;max-width:100%;overflow:hidden;overscroll-behavior:contain;border:0;border-radius:0;background:transparent;cursor:ew-resize;touch-action:none;user-select:none;outline:none;--omni-dial-item:96px;color:var(--omni-label-primary)}
.omni-ui-dial:focus-visible{outline:2px solid var(--omni-brand);outline-offset:2px}
.omni-ui-dialDisabled{opacity:.45;cursor:default}
.omni-ui-dialMarker{position:absolute;left:50%;top:1px;transform:translateX(-50%);z-index:4;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--omni-brand);pointer-events:none}
.omni-ui-dialRail{position:absolute;left:12px;right:12px;z-index:3;height:0;border-top:1px solid var(--omni-border-strong);pointer-events:none}
.omni-ui-dialRailTop{top:9px}
.omni-ui-dialRailBottom{bottom:5px}
.omni-ui-dialFade{position:absolute;top:0;bottom:0;width:12%;z-index:2;pointer-events:none}
.omni-ui-dialFadeStart{left:0;background:linear-gradient(to right,var(--omni-bg,var(--dsw-alias-bg-layer-3,#fff)) 45%,transparent)}
.omni-ui-dialFadeEnd{right:0;background:linear-gradient(to left,var(--omni-bg,var(--dsw-alias-bg-layer-3,#fff)) 45%,transparent)}
.omni-ui-dialTrack{position:absolute;left:50%;top:0;z-index:0;display:flex;flex-direction:row;align-items:stretch;height:100%;box-sizing:border-box;will-change:transform}
.omni-ui-dialItem{display:flex;align-items:center;justify-content:center;flex:none;height:100%;padding:8px 8px 4px;box-sizing:border-box;font-size:12px;line-height:1.2;font-weight:500;color:var(--omni-label-tertiary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent}
.omni-ui-dialItemActive{color:var(--omni-label-primary);font-weight:600;background:transparent}
.omni-ui-dialSr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.omni-ui-select{appearance:none;border:1px solid var(--omni-border);background:var(--omni-bg);font:inherit;color:var(--omni-label-primary);border-radius:var(--omni-radius-control);font-size:13px;line-height:1.5;height:var(--omni-control-height);padding:0 32px 0 12px;width:100%;box-sizing:border-box;background-image:linear-gradient(45deg,transparent 50%,var(--omni-label-tertiary) 50%),linear-gradient(135deg,var(--omni-label-tertiary) 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.omni-ui-select:focus-visible{border-color:var(--omni-brand);outline:none}
.omni-ui-select:disabled{color:var(--omni-label-tertiary);cursor:default}
.omni-ui-selectInline{width:auto;max-width:11em;height:28px;flex:none;padding:0 20px 0 8px;border:none;background-color:transparent;color:var(--omni-label-secondary);font-weight:500;line-height:20px;white-space:nowrap;cursor:pointer}
.omni-ui-selectInline:hover:not(:disabled){background-color:color-mix(in srgb,var(--omni-border) 55%,transparent);color:var(--omni-label-primary)}
.omni-ui-selectInline:focus-visible{border-color:transparent;outline:2px solid var(--omni-brand);outline-offset:2px}
.omni-ui-selectRow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:var(--omni-gap-tight);width:100%}
.omni-ui-tierRow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr) minmax(0,.75fr) auto;gap:var(--omni-gap-tight);align-items:center;width:100%}
.omni-ui-tierRowGrip{grid-template-columns:28px minmax(0,1fr) minmax(0,1.25fr) minmax(0,.75fr) auto}
.omni-ui-tierGrip{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:var(--omni-control-height);padding:0;border:0;border-radius:var(--omni-radius-control);background:transparent;color:var(--omni-label-tertiary);font:inherit;font-size:18px;line-height:1;cursor:grab;touch-action:none;user-select:none}
.omni-ui-tierGrip:hover,.omni-ui-tierGripActive{color:var(--omni-label-primary);background:color-mix(in srgb,var(--omni-border) 55%,transparent)}
.omni-ui-tierGripActive{cursor:grabbing}
.omni-ui-tierRowGhost{position:fixed;z-index:20;margin:0;box-sizing:border-box;opacity:.55;box-shadow:var(--omni-shadow);pointer-events:none;cursor:grabbing}
.omni-ui-tierRowDrop{position:relative}
.omni-ui-tierRowDrop::before{content:"";position:absolute;left:0;right:0;top:-3px;height:2px;border-radius:1px;background:var(--omni-brand);opacity:.9;pointer-events:none;transition:opacity .12s ease}
@media (prefers-reduced-motion:reduce){.omni-ui-tierRowDrop::before{transition:none}}
.omni-ui-tierGrip:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
.omni-ui-tierActions{display:flex;gap:4px;flex:none;justify-content:flex-end;min-width:28px}
.omni-ui-btnIcon{height:var(--omni-control-height);width:28px;min-height:0;padding:0;font-size:12px;line-height:1}
.omni-ui-kvList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--omni-gap-tight);width:100%}
.omni-ui-kvRow{list-style:none;display:grid;grid-template-columns:minmax(0,var(--omni-kv-label)) minmax(0,1fr) auto;gap:var(--omni-gap-tight);align-items:center;width:100%}
.omni-ui-kvValue{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:12px;line-height:1.5;color:var(--omni-label-secondary);overflow-wrap:anywhere}
.omni-ui-mono{font-family:var(--omni-font-mono);letter-spacing:.01em}
.omni-ui-kvHint{font-size:11px;line-height:1.4;color:var(--omni-label-tertiary)}
.omni-ui-kvAction{display:flex;align-items:center;justify-content:flex-end}
.omni-ui-kvAdd{align-self:flex-start}
.omni-ui-badgeRow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
/* ADR-052 / gaps §5.2 行头基线：右侧动作组是一列 34px 高的控件，左侧标题行只有约 20px 的行盒；两者盒顶对齐时
   文字基线相差约 7px，看起来就是「右边比左边低一截」。修法不是动按钮高度，而是让**带动作的行**把标题行撑到控件高度
   并在其中居中——于是标题文字的视觉中心与按钮的视觉中心重合。只作用于带动作的行：普通行不该凭空变高。 */
.omni-ui-listRow--actions .omni-ui-badgeRow{min-height:var(--omni-control-height);align-content:center}
.omni-ui-stack{display:flex;flex-direction:column;gap:var(--omni-gap);width:100%}
.omni-ui-configPage{display:flex;flex-direction:column;gap:var(--omni-gap);width:100%;max-width:760px}
.omni-ui-lightbox{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:40px}
.omni-ui-lightboxMask{position:absolute;inset:0;background:var(--omni-scrim);backdrop-filter:blur(3px)}
.omni-ui-lightboxStage{position:relative;display:grid;place-items:center;width:100%;height:100%;cursor:grab;touch-action:none}
.omni-ui-lightboxStage[data-dragging]{cursor:grabbing}
.omni-ui-lightboxImage{position:relative;display:grid;place-items:center;overflow:hidden;border-radius:var(--omni-radius);background:var(--omni-bg-elevated);box-shadow:var(--omni-shadow)}
.omni-ui-lightboxImage svg{display:block;width:100%;height:100%}
.omni-ui-lightboxTools{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:4px;border:1px solid var(--omni-border);border-radius:999px;background:var(--omni-bg-elevated);box-shadow:var(--omni-shadow)}
.omni-ui-lightboxTool{appearance:none;min-width:30px;height:30px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:var(--omni-label-primary);font:inherit;font-size:14px;line-height:1;cursor:pointer}
.omni-ui-lightboxTool:hover{background:var(--omni-fill)}
.omni-ui-lightboxTool:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
.omni-ui-lightboxToolWide{font-size:12px;padding:0 10px}
.omni-ui-lightboxScale{min-width:44px;text-align:center;color:var(--omni-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.omni-ui-lightboxClose{position:absolute;top:20px;right:20px;width:36px;height:36px;padding:0;border:1px solid var(--omni-border);border-radius:999px;background:var(--omni-bg-elevated);color:var(--omni-label-primary);font-size:20px;line-height:1;cursor:pointer;box-shadow:var(--omni-shadow)}
.omni-ui-lightboxClose:hover{background:var(--omni-fill)}
.omni-ui-lightboxClose:focus-visible{outline:2px solid var(--omni-brand);outline-offset:2px}
.omni-ui-roleEntry{display:flex;flex-direction:column;gap:var(--omni-gap);width:100%}
.omni-ui-roleForm{display:flex;flex-direction:column;gap:var(--omni-gap);box-sizing:border-box;width:100%;padding:var(--omni-gap);border:1px solid var(--omni-border);border-radius:var(--omni-radius);background:var(--omni-bg-muted)}
.omni-ui-roleForm .omni-ui-cardFooter{margin:0;padding:var(--omni-gap) 0 0}
.omni-ui-cardList{display:flex;flex-direction:column;gap:var(--omni-gap-section);width:100%}
.omni-ui-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--omni-gap-tight);width:100%}
.omni-ui-listRow{display:flex;align-items:flex-start;gap:var(--omni-gap);box-sizing:border-box;min-height:52px;min-width:0;width:100%;padding:10px 12px;border:1px solid var(--omni-border);border-radius:var(--omni-radius);background:var(--omni-bg);font:inherit;color:inherit;text-align:left}
button.omni-ui-listRow{appearance:none;cursor:pointer}
button.omni-ui-listRow:hover{border-color:var(--omni-border-strong)}
button.omni-ui-listRow:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
.omni-ui-listMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.omni-ui-metaLine{font-size:12px;line-height:1.5;color:var(--omni-label-tertiary);word-break:break-word}
.omni-ui-listRow .omni-ui-hint{font-size:13px;color:var(--omni-label-secondary)}
.omni-ui-listFacts{display:flex;flex-direction:column;gap:2px;margin-top:5px}
.omni-ui-listTitle{font-size:13px;font-weight:500;color:var(--omni-label-primary);word-break:break-all}
.omni-ui-listMeta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:none}
.omni-ui-listActions{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:flex-end;gap:var(--omni-gap-tight);flex:none;align-self:flex-start;min-width:7.5rem;max-width:100%}
.omni-ui-itemCard{display:flex;flex-direction:column;box-sizing:border-box;min-height:112px;min-width:0;padding:12px 12px 10px;border:1px solid var(--omni-border);border-radius:var(--omni-radius);background:var(--omni-bg)}
.omni-ui-itemCardMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:6px;padding-bottom:10px}
.omni-ui-itemCardHead{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.omni-ui-itemCardTitle{font-size:13px;font-weight:600;color:var(--omni-label-primary);word-break:break-all;text-decoration:none}
a.omni-ui-itemCardTitle:hover{text-decoration:underline}
.omni-ui-itemCardDesc{margin:0;min-height:2.8em;font-size:12px;line-height:1.4;color:var(--omni-label-tertiary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.omni-ui-itemCardActions{position:relative;display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end;min-width:10.5rem;min-height:32px;align-items:center;padding-top:10px}
.omni-ui-itemCardActions::before{content:"";position:absolute;top:0;left:8px;right:8px;border-top:1px solid var(--omni-border);pointer-events:none}
.omni-ui-toolbar{display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;gap:var(--omni-gap-tight);width:100%}
.omni-ui-toolbar>.omni-ui-input{flex:1 1 auto;min-width:0;width:auto}
.omni-ui-toolbar>.omni-ui-hint{flex:1;min-width:0}
.omni-ui-toolbar>.omni-ui-btn{flex:none}
.omni-ui-valueLine{display:flex;flex-direction:row;align-items:center;gap:8px;min-width:0}
.omni-ui-valueLine>.omni-ui-valueText{flex:0 1 auto;min-width:0;overflow-wrap:anywhere;text-align:left}
.omni-ui-valueLine>.omni-ui-inlineEdit{flex:none}
.omni-ui-pencilBtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;color:var(--omni-label-tertiary);background:transparent;cursor:pointer}
.omni-ui-pencilBtn:hover{background:var(--omni-fill);color:var(--omni-label-secondary)}
/* 设计稿（variant-a）里铅笔一浮现就带 22×22 灰底；只在指针压到铅笔时给底色会和设计稿不一致。 */
.omni-ui-listRow:hover .omni-ui-pencilBtn,.omni-ui-listRow:focus-within .omni-ui-pencilBtn{background:var(--omni-fill);color:var(--omni-label-secondary)}
/* 值级动作不常驻：静息只有文字，整行悬停或键盘聚焦才露出铅笔（ADR-046）。触屏/无 hover 设备始终显示，否则等于没有入口。 */
.omni-ui-valueText{color:var(--omni-label-tertiary);text-decoration:none}
.omni-ui-valueText:hover:not(:disabled){color:var(--omni-label-secondary);text-decoration:none;background:transparent}
.omni-ui-inlineEdit{display:inline-flex;align-items:center;opacity:0;transition:opacity .12s ease}
.omni-ui-listRow:hover .omni-ui-inlineEdit,.omni-ui-listRow:focus-within .omni-ui-inlineEdit{opacity:1}
/* task-73：触屏没有 hover，铅笔常显时必须同时有设计稿的灰底与标签色，不能只剩一个没底的 glyph。 */
@media (hover:none){.omni-ui-pencilBtn{background:var(--omni-fill);color:var(--omni-label-secondary)}.omni-ui-inlineEdit{opacity:1}}
.omni-ui-excerpt{margin:0;width:100%;box-sizing:border-box;padding:8px 10px;border-radius:var(--omni-radius-control);border:1px solid var(--omni-border);background:var(--omni-bg);font:inherit;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--omni-label-secondary)}
.omni-ui-cardFooter>.omni-ui-btnPrimary:only-child{width:100%}
.omni-ui-toastHost{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:9010;display:flex;flex-direction:column;align-items:center;gap:var(--omni-gap-tight);width:max-content;max-width:min(480px,calc(100vw - 32px));pointer-events:none}
.omni-ui-toast{pointer-events:auto;box-sizing:border-box;display:flex;align-items:center;gap:10px;max-width:100%;padding:10px 14px;border:1px solid var(--omni-border);border-radius:var(--omni-radius);background:var(--omni-bg);box-shadow:var(--omni-shadow);font-size:13px;line-height:1.45;color:var(--omni-label-primary);animation:omni-ui-toast-in .18s ease-out}
.omni-ui-toastWarn{border-color:var(--omni-warn)}
.omni-ui-toastDanger{border-color:var(--omni-danger)}
.omni-ui-toastText{flex:1;min-width:0;white-space:pre-line;overflow-wrap:break-word}
.omni-ui-toastAction{flex:none;appearance:none;border:0;border-radius:999px;padding:3px 12px;font:inherit;font-size:12px;line-height:1.4;cursor:pointer;background:var(--omni-label-primary);color:var(--omni-bg)}
.omni-ui-toastAction:hover{opacity:.9}
.omni-ui-toastClose{flex:none;appearance:none;border:0;background:transparent;font:inherit;font-size:14px;line-height:1;cursor:pointer;color:var(--omni-label-tertiary);padding:2px 4px}
.omni-ui-toastClose:hover{color:var(--omni-label-primary)}
.omni-ui-toastAction:focus-visible,.omni-ui-toastClose:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
@keyframes omni-ui-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.omni-ui-busyScrim{position:fixed;inset:0;z-index:8900;display:flex;align-items:center;justify-content:center;background:var(--omni-scrim);padding:24px;box-sizing:border-box}
.omni-ui-busy{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:var(--omni-gap);min-width:min(240px,100%);padding:20px 24px;border:1px solid var(--omni-border);border-radius:var(--omni-radius);background:var(--omni-bg);box-shadow:var(--omni-shadow);color:var(--omni-label-primary)}
.omni-ui-busySpin{width:22px;height:22px;border:2px solid var(--omni-border);border-top-color:var(--omni-brand);border-radius:50%;animation:omni-ui-busy-spin .7s linear infinite}
.omni-ui-busyText{margin:0;font-size:14px;line-height:1.45;text-align:center}
@keyframes omni-ui-busy-spin{to{transform:rotate(360deg)}}
.omni-ui-confirmScrim{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:var(--omni-scrim);padding:24px;box-sizing:border-box}
.omni-ui-confirm{box-sizing:border-box;display:flex;flex-direction:column;gap:var(--omni-gap);width:min(440px,100%);max-height:min(70vh,560px);overflow:auto;padding:20px;border:1px solid var(--omni-border);border-radius:var(--omni-radius);background:var(--omni-bg);box-shadow:var(--omni-shadow);color:var(--omni-label-primary);animation:omni-ui-confirm-in .16s ease-out}
.omni-ui-confirmTitle{margin:0;font-size:15px;font-weight:600;line-height:1.4}
.omni-ui-sheetHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.omni-ui-sheetHead .omni-ui-confirmTitle{flex:1;min-width:0}
.omni-ui-dismiss{appearance:none;border:0;background:transparent;padding:0;margin:0;font:inherit;font-size:13px;line-height:1.4;color:var(--omni-label-tertiary);cursor:pointer;flex:none}
.omni-ui-dismiss:hover:not(:disabled){color:var(--omni-label-primary)}
.omni-ui-dismiss:disabled{opacity:.4;cursor:default}
.omni-ui-dismiss:focus-visible{outline:2px solid var(--omni-brand);outline-offset:2px;border-radius:2px}
.omni-ui-confirmText{margin:0;font-size:13px;line-height:1.5;color:var(--omni-label-secondary)}
.omni-ui-confirmList{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
.omni-ui-confirmItem{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:6px 0;border-bottom:1px solid var(--omni-border);font-size:13px;line-height:1.5}
.omni-ui-confirmItem:last-child{border-bottom:0}
.omni-ui-confirmItemPrimary{font-variant-numeric:tabular-nums;color:var(--omni-label-primary)}
.omni-ui-confirmItemSecondary{min-width:0;flex:1;color:var(--omni-label-secondary);word-break:break-all}
.omni-ui-confirmItemMeta{font-variant-numeric:tabular-nums;color:var(--omni-label-tertiary)}
.omni-ui-confirmActions{display:flex;justify-content:flex-end;gap:var(--omni-gap-tight);margin-top:4px}
@keyframes omni-ui-confirm-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.omni-ui-toast,.omni-ui-confirm,.omni-ui-busySpin{animation:none}}
.omni-ui-iconBtn{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:var(--omni-composer-size);height:var(--omni-composer-size);padding:0;border:0;border-radius:var(--omni-radius-control);background:transparent;color:var(--omni-label-secondary);cursor:pointer}
.omni-ui-iconBtn:hover:not(:disabled){background:var(--omni-fill);color:var(--omni-label-primary)}
.omni-ui-iconBtn:disabled{opacity:.6;cursor:default}
.omni-ui-iconBtn:focus-visible{outline:2px solid var(--omni-brand);outline-offset:2px}
.omni-ui-railBtn{appearance:none;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:var(--omni-rail-size);height:var(--omni-rail-size);margin:0 auto 4px;padding:0;border:0;border-radius:var(--omni-radius-control);background:transparent;color:var(--omni-label-tertiary);cursor:pointer}
.omni-ui-railBtn:hover:not(:disabled){background:var(--omni-fill);color:var(--omni-label-primary)}
.omni-ui-railBtn:disabled{opacity:.6;cursor:default}
.omni-ui-railBtn:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
.omni-ui-req{margin-left:2px;color:var(--omni-danger)}
/* ADR-044 D2: chrome-level switch. Full width, 36px tall, pill track, and the SELECTED segment is the primary fill. */
.omni-ui-segments{display:flex;gap:2px;margin:0 var(--omni-gap-tight) 6px;padding:2px;border-radius:999px;background:var(--omni-bg-muted);box-sizing:border-box}
.omni-ui-segment{flex:1;min-height:32px;appearance:none;border:0;border-radius:999px;padding:6px 0;background:transparent;color:var(--omni-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;cursor:pointer}
.omni-ui-segment:hover{color:var(--omni-label-primary)}
.omni-ui-segment[data-active="true"]{background:var(--omni-label-primary);color:var(--omni-bg);box-shadow:none}
.omni-ui-segment:focus-visible{outline:2px solid var(--omni-brand);outline-offset:1px}
.omni-ui-dock{display:flex;flex-wrap:wrap;gap:var(--omni-gap-tight);padding:0 var(--omni-gap) var(--omni-gap-tight)}
.omni-ui-chip{display:flex;align-items:center;gap:var(--omni-gap-tight);max-width:280px;padding:6px 8px;border:1px solid var(--omni-border);border-radius:10px;background:var(--omni-bg)}
.omni-ui-chipThumb{width:40px;height:40px;object-fit:cover;border-radius:6px;background:var(--omni-bg-muted);flex:none}
.omni-ui-chipBadge{width:40px;height:40px;border-radius:6px;background:var(--omni-bg-muted);color:var(--omni-label-secondary);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;letter-spacing:.4px;flex:none}
.omni-ui-chipBadgeMark{font-size:18px;font-weight:400;letter-spacing:0;color:var(--omni-label-primary)}
.omni-ui-chipMeta{min-width:0;display:flex;flex-direction:column;gap:2px;flex:auto}
.omni-ui-chipName{font-size:12px;line-height:16px;color:var(--omni-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.omni-ui-chipStatus{font-size:11px;line-height:14px;color:var(--omni-label-tertiary)}
.omni-ui-chipRemove{width:22px;height:22px;border:none;border-radius:999px;background:transparent;color:var(--omni-label-tertiary);cursor:pointer;flex:none}
.omni-ui-chipRemove:hover{background:var(--omni-fill);color:var(--omni-label-primary)}
.omni-ui-attachRail{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;min-width:0;padding:4px 12px 0}
.omni-ui-attachRail>div:not(.omni-ui-attachTile){flex:1 1 auto;min-width:0;padding:0}
.omni-ui-attachTile{position:relative;flex:none;width:64px;height:64px}
.omni-ui-attachTileFace{box-sizing:border-box;width:64px;height:64px;padding:4px;border:.5px solid var(--omni-border);border-radius:16px;background:var(--omni-fill);color:var(--omni-label-secondary);display:flex;align-items:center;justify-content:center;text-align:center;font-size:10px;font-weight:600;letter-spacing:.4px;line-height:1.2;overflow:hidden}
.omni-ui-attachTileFace:has(img){padding:0}
.omni-ui-attachTileFace img{width:100%;height:100%;object-fit:cover;display:block}
.omni-ui-attachTileFace[data-mark="true"]{font-size:18px;font-weight:400;letter-spacing:0;color:var(--omni-label-primary)}
.omni-ui-attachTileRemove{position:absolute;top:4px;right:4px;z-index:1;width:18px;height:18px;padding:0;border:none;border-radius:999px;background:var(--omni-label-primary);color:var(--omni-bg);cursor:pointer;opacity:0;font-size:12px;line-height:18px}
.omni-ui-attachTile:hover .omni-ui-attachTileRemove,.omni-ui-attachTileRemove:focus-visible{opacity:1}
@media (pointer:coarse){.omni-ui-attachTileRemove{opacity:1}}
@media (prefers-reduced-motion:reduce){.omni-ui-attachTileRemove{transition:none}}
.omni-ui-galleryWrap{display:flex;flex-direction:column;min-width:0}
.omni-ui-gallery{display:flex;flex-wrap:wrap;gap:var(--omni-gap-tight);justify-content:flex-end;margin:0 0 6px}
.omni-ui-galleryThumb{max-width:240px;max-height:240px;border-radius:var(--omni-radius);object-fit:cover;cursor:zoom-in;border:1px solid var(--omni-border);background:var(--omni-bg-muted)}
.omni-ui-galleryThumb[data-expanded="true"]{max-width:min(420px,100%);max-height:420px}
.omni-ui-galleryThumbSvg{box-sizing:border-box;display:block;overflow:hidden}
.omni-ui-galleryThumbSvg svg{display:block;width:100%;height:100%}
.omni-ui-galleryFallback{display:flex;justify-content:flex-end;white-space:pre-wrap;word-break:break-word;color:var(--omni-label-primary);font-size:13px;line-height:1.6}
.omni-ui-statusLine{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;line-height:1.5}
.omni-ui-statusLineOk{color:var(--omni-label-secondary)}
.omni-ui-statusLineWarn{color:var(--omni-label-error)}
.omni-ui-statusDot{width:6px;height:6px;border-radius:999px;flex:none}
.omni-ui-statusDotOk{background:var(--omni-brand)}
.omni-ui-statusDotWarn{background:currentColor}
.omni-ui-statusStack{display:flex;flex-direction:column;gap:4px;padding-top:4px}
.omni-ui-banner{margin:var(--omni-gap) 0 0;padding:10px 12px;border:1px solid color-mix(in srgb,var(--omni-label-error) 35%,transparent);border-radius:10px;background:color-mix(in srgb,var(--omni-label-error) 8%,transparent);color:var(--omni-label-primary);font-size:12px;line-height:1.6}
.omni-ui-heroChip{display:inline-flex;align-items:center;gap:4px;height:var(--omni-composer-size);padding:0 10px;border-radius:999px;background:var(--omni-bg-muted);color:var(--omni-label-secondary);font-size:13px;line-height:20px}
.omni-ui-indexList{display:flex;flex-direction:column;gap:var(--omni-gap-tight);width:100%}
.omni-ui-indexList>.omni-ui-btn{align-self:flex-start}
.omni-ui-indexRow{display:flex;align-items:center;gap:var(--omni-gap-tight)}
.omni-ui-indexRow .omni-ui-select{flex:1;min-width:0;width:auto}
.omni-ui-indexMark{flex:none;width:18px;text-align:center;font-size:11px;color:var(--omni-label-tertiary)}
.omni-ui-fileInput{display:none}
.omni-ui-composerTool{display:inline-flex;align-items:center}
@media (max-width:520px){
  .omni-ui-selectRow,.omni-ui-kvRow{grid-template-columns:1fr}
  .omni-ui-kvRow .omni-ui-btn{width:100%}
  .omni-ui-tierRow,.omni-ui-tierRowGrip{grid-template-columns:1fr}
  .omni-ui-tierGrip{justify-self:start}
  .omni-ui-tierActions{justify-content:flex-start;min-width:0}
  .omni-ui-listRow{flex-wrap:wrap}
  .omni-ui-listActions{width:100%;justify-content:flex-start;min-width:0}
}
.omni-ui-cardTitleRow{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.omni-ui-cardMeta{font-size:12px;font-weight:400;color:var(--omni-label-tertiary)}.omni-ui-stateDot{display:inline-block;width:6px;height:6px;border-radius:50%;flex:none;margin-right:8px;background:var(--omni-label-tertiary)}.omni-ui-stateDot[data-tone="ok"]{background:var(--omni-ok)}.omni-ui-stateDot[data-tone="warn"]{background:var(--omni-warn)}.omni-ui-stateDot[data-tone="error"]{background:var(--omni-label-error)}.omni-ui-stateVersion{margin-left:8px;font-weight:500}.omni-ui-list--flush>.omni-ui-listRow{border:0;background:transparent;padding:0;min-height:0}`;

const TAG_ID = "@omnisurge/dsh-ui/controls.css";

/** Inject token + control sheets once per document; refresh only if this bundle is not older. */
export function injectStyles(): void {
  if (typeof document === "undefined") return;
  const css = TOKEN_SHEET + CONTROLS;
  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`);
  if (existing instanceof HTMLStyleElement) {
    if (!uiSheetWins(existing.dataset.omniUiVersion, UI_SHEET_VERSION)) return;
    if (existing.textContent !== css || existing.dataset.omniUiVersion !== UI_SHEET_VERSION) {
      existing.textContent = css;
      existing.dataset.omniUiVersion = UI_SHEET_VERSION;
    }
    return;
  }
  const tag = document.createElement("style");
  tag.dataset.plugin = "@omnisurge/dsh-ui";
  tag.dataset.pluginCss = TAG_ID;
  tag.dataset.omniUiVersion = UI_SHEET_VERSION;
  tag.textContent = css;
  document.head.appendChild(tag);
}

export const TOKEN_SHEET_ID = TAG_ID;
