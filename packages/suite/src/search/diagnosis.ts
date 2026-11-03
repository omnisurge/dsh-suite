/**
 * SearXNG 搜索诊断（ADR-015 提案 §3.1，2026-09-15 实现）。
 *
 * SearXNG 的 JSON 响应里本来就带 `unresponsive_engines`——本插件此前**完全没读**它，
 * 于是「为什么返回空」在界面上无从判断：是引擎都挂了，还是这条查询本来就没结果。
 *
 * 这里把判断收敛成一个**纯函数**，三条判据按提案原文：
 *
 * 1. 全部引擎不可用        → 部署/网络问题（指向 §4 调优）——**要打扰**
 * 2. 少数不可用但结果非空  → 正常——**不打扰**
 * 3. 0 结果且引擎都可用    → 大概率是查询本身没结果——**不报警**
 *
 * 外加一条提案未明说、但最有用的情况：**0 结果且有引擎不可用**——这解释了空结果，要提示。
 *
 * 措辞纪律：`degraded` 一律**不得**说成「服务故障」——少数引擎不可达是常态，不是故障。
 */

export type SearxngVerdict =
  /** 没有引擎不可用。（哪怕 0 结果也属于这档：那是查询本身没结果。） */
  | "healthy"
  /** 有引擎不可用，但拿到了结果——常态，**不打扰用户**。 */
  | "degraded"
  /** 0 结果**且**有引擎不可用——空结果可能由此解释，值得提示。 */
  | "blocked"
  /** 本次请求的引擎**全部**不可用——部署/网络问题。 */
  | "unavailable";

export interface SearchDiagnosis {
  readonly verdict: SearxngVerdict;
  /** 本次不可用的引擎名（去重、按名排序）。 */
  readonly unresponsive: readonly string[];
  /** 本次实际请求的引擎名；未知（服务端默认集）时为空数组。 */
  readonly requested: readonly string[];
  /** 是否需要让用户看见（卡片提示 / 明显日志）。 */
  readonly notify: boolean;
}

/** 把 `unresponsive_engines` 归一化：SearXNG 可能给字符串或 [引擎名, 原因] 二元组。 */
export function normalizeUnresponsive(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) names.add(entry);
    else if (Array.isArray(entry) && typeof entry[0] === "string" && entry[0].length > 0) names.add(entry[0]);
  }
  return [...names].sort();
}

/**
 * 判定本次搜索的诊断结论。**纯函数**——不读网络、不读配置。
 *
 * @param unresponsive 本次不可用的引擎（已归一化）
 * @param requested   本次请求的引擎；空数组表示「服务端默认集，未知具体名单」
 * @param resultCount 实际拿到的结果条数
 */
export function diagnoseSearch(
  unresponsive: readonly string[],
  requested: readonly string[],
  resultCount: number,
): SearchDiagnosis {
  const un = [...unresponsive];
  const base = { unresponsive: un, requested: [...requested] } as const;

  if (un.length === 0) {
    // 判据 3：引擎都可用。0 结果不报警。
    return { ...base, verdict: "healthy", notify: false };
  }

  // 判据 1：本次请求的引擎全挂（只有知道请求名单时才能断言「全部」）。
  const allRequestedDown = requested.length > 0
    && requested.every((name) => un.includes(name));
  if (allRequestedDown) {
    return { ...base, verdict: "unavailable", notify: true };
  }

  if (resultCount === 0) {
    // 提案未明说、但最有用的那档：空结果且有引擎挂 → 提示，别让人以为「这条查询没结果」。
    return { ...base, verdict: "blocked", notify: true };
  }

  // 判据 2：拿到结果了，少数引擎不可达是常态——不打扰。
  return { ...base, verdict: "degraded", notify: false };
}
