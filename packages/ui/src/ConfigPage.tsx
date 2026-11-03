import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button.js";

/**
 * 「插件配置页」的平铺容器 —— 官方 `PluginConfigForm` 的同款。
 *
 * ## 为什么需要它（2026-09-19 实证）
 *
 * dsh 0.1.6 的侧栏「插件」页里，**每一项就是一个页面**：
 * 宿主 `plugin-manager` 的 `ItemDetail` 先画面包屑（返回）与 `<h3>{label}</h3>`，
 * 再 `renderSlot("plugins.item", { view: "page" })` 把**我们的组件**放进
 * `.detailSections`（`data-plugin-config`）里。
 *
 * 所以注册进 `plugins.item` 的组件：
 *   · `view === "summary"` → 只返回**一行说明**（详情页头部用）；
 *   · 其余（`view === "page"`）→ 返回**平铺内容** ——
 *     **不画标题**（宿主已画）、**不套卡片壳**、**不折叠**。
 *
 * 官方四张卡（bash / agent-loop / subagent / web-search）都走 `PluginConfigForm`：
 * 一个普通 `div` + 字段 + 底部保存按钮。用 `SettingsCard collapsible` 会变成
 * 「点进去还要再点一下才展开」的伸缩卡 —— 那是错的。
 *
 * ## 行为
 *
 * · `available === false` → 只渲染一行提示（namespace 没被服务）。
 * · 只读部署 → 顶部一行提示。
 * · 失败 → 页脚一行提示。
 * · **卸载时自动 `onDiscard()`**（照官方：离开页面丢弃未保存的草稿）。
 */
export interface ConfigPageLabels {
  /** namespace 没被服务时的那行提示。 */
  unavailable: string;
  /** 只读部署的提示。 */
  readOnly: string;
  /** 保存失败（服务端没接受）的提示。 */
  saveFailed: string;
  /** 保存按钮：保存中。 */
  saving: string;
  /** 保存按钮：常态。 */
  save: string;
}

export interface ConfigPageProps {
  readonly available: boolean;
  readonly writable: boolean;
  /**
   * 整页是否有未保存改动。**即时生效的卡不用传** —— 它没有「保存」这回事，
   * 传不传都不影响渲染（只有画保存按钮时才用到它）。
   */
  readonly dirty?: boolean;
  readonly invalid?: boolean;
  readonly saving?: boolean;
  readonly failed?: boolean;
  readonly labels: ConfigPageLabels;
  /**
   * 保存动作。**即时生效的卡不传** —— 那样就不画保存按钮。
   *
   * 有些卡（如 ptc-envelope 的开关）点一下就已经存了，没有「整页脏了就保存」
   * 这回事；给它们画一个保存按钮是错的。
   */
  readonly onSave?: () => void;
  /** 离开页面时调用（官方行为）。 */
  readonly onDiscard?: () => void;
  /** 卡内正文（字段、列表…）。 */
  readonly children?: ReactNode;
  /** 页脚左侧的补充内容（如观测徽标）。 */
  readonly footerLead?: ReactNode;
}

export function ConfigPage(props: ConfigPageProps) {
  const discard = useRef(props.onDiscard);
  discard.current = props.onDiscard;
  useEffect(() => () => {
    discard.current?.();
  }, []);

  if (!props.available) {
    return <p className="omni-ui-tokens omni-ui-hint" role="status">{props.labels.unavailable}</p>;
  }
  const blocked = props.dirty !== true || props.invalid === true || props.saving === true;
  return (
    <div className="omni-ui-configPage omni-ui-tokens">
      {props.writable ? null : (
        <p className="omni-ui-hint" role="status">{props.labels.readOnly}</p>
      )}
      <div className="omni-ui-stack">{props.children}</div>
      <div className="omni-ui-cardFooter">
        {props.footerLead}
        {props.failed === true ? (
          <p className="omni-ui-hint" role="status">{props.labels.saveFailed}</p>
        ) : null}
        {props.onSave === undefined ? null : (
          <Button variant="primary" disabled={blocked} onClick={props.onSave}>
            {props.saving === true ? props.labels.saving : props.labels.save}
          </Button>
        )}
      </div>
    </div>
  );
}
