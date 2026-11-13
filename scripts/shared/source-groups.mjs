/** 套件源码的唯一归属表：谁是 Host、谁是 Client、谁两侧共用。
 *
 * 这张表只能有一份。之前它在两个门禁里各存一份（分层门禁与 UI 词汇门禁），
 * 一处改了另一处不改，就会出现"分类说它是 Host、规则却按 Client 检查"的静默错位。
 */

/** 每个源文件的唯一归属。改归属是有意的架构动作，必须改这张表并说明理由。 */
export const GROUP={
  'client.js':'client',
  'failure-view.js':'client',
  'readiness.js':'client',
  'search/client.js':'client',
  'search/client-flow.js':'client',
  'tools/client.js':'client',
  'teams/client.js':'client',
  // ADR-036：OCR 设置卡（配置面）。Client 侧只用官方 remote 与库组件，不碰 node:*。
  'ocr/client.js':'client',
  // ADR-086：文档解析设置卡。Client 只走官方 remote 与库组件，不碰 node:*。
  'document-parse/client.js':'client',
  // ADR-088：思考强度滑块的 Client 产品皮；canvas/chibi/轨道沿用既有产品皮肤，
  // 按 ADR-028 对会话域皮肤的裁定不走通用 dsh-ui 控件集。
  'effort-slider/shared.ts':'client',
  'effort-slider/directory-bind.ts':'client',
  'effort-slider/client/index.tsx':'client',
  'effort-slider/client/styles.ts':'client',
  'effort-slider/client/assets.ts':'client',

  'ambient.ts':'shared',
  'build-protocol.d.ts':'shared',
  'loopback-origin.ts':'shared',
  'runtime-guard.ts':'shared',
  'search/diagnosis.ts':'shared',
  'search/engines.ts':'shared',
  'search/identity.ts':'shared',
  'search/types.ts':'shared',
  // Host-only since the skills failures cross the wire as RemoteError codes: the module imports the
  // official protocol, which the shared group may not depend on.
  'skills-catalog.ts':'host',
  // Same reason as skills-catalog.ts: the MCP reader raises protocol RemoteError codes, so it is Host-only.
  // ADR-025: the MCP server catalog and profile-patch writer are Host-only (node:fs + yaml, no Client use).
  'mcp-servers.ts':'host',
  // ADR-032: the purpose bypass file and its prompt section are Host-only (node:fs + the official protocol,
  // and the loader/row identification they reuse is the Host catalog's).
  'mcp-purpose.ts':'host',
  // ADR-026: the skill write path is Host-only (node:fs, no Client use).
  'skills-manage.ts':'host',
  // ADR-027: the local-root scan is Host-only for the same reason.
  'skills-local.ts':'host',
  // ADR-036：OCR 的 Host 侧实现（node:fs、子进程、官方凭据服务），Client 不引用。
  'ocr-baidu.ts':'host',
  'ocr-contract.ts':'host',
  'ocr-core.ts':'host',
  'ocr-raster.ts':'host',
  'ocr-reconcile.ts':'host',
  'ocr-service.ts':'host',
  'ocr-tencent.ts':'host',
  'ocr-usage.ts':'host',
  // ADR-086：文档解析的 Host 适配器/service/tool；不进入 Client 运行时。
  'document-parse-mineru.ts':'host',
  'document-parse-paddle.ts':'host',
  'document-parse-service.ts':'host',
  'document-parse-tool.ts':'host',
  // ADR-091：文档解析的产品文案（工具描述 + 常驻提示词段）。纯常量、无 import，所以测试能直接取源。
  'document-parse-presence.ts':'host',
  // 只有类型与联合，无副作用、无 node:*：Client 与 Host 共用。
  'document-parse-types.ts':'shared',
  'ocr-types.ts':'shared',
  'types.ts':'shared',

  'components.ts':'host',
  'config.ts':'host',
  // ADR-058 / ADR-054：极限模式的判定与团队诊断都是纯 Host 读逻辑（无 node:*、无 Client 依赖），
  // 但它们的 Remote 边界类型在 types.ts 里，跨线缆时才类型化。
  'limit-mode.ts':'host',
  // profile patch 的读写是 Host-only（node:fs + yaml），与 MCP 行的 patch 写入器同一条纪律。
  // ADR-093：团队成员卡退役后，这条自定义行的唯一 Host 读入口（极限模式配置）。
  'agent-teams-row.ts':'shared',
  // ADR-094：官方 MCP manager 的 Host 适配层（Settings 修订栅栏 + 状态映射），只被 host 使用。
  'mcp-managed.ts':'host',
  // 环境笔记的读写是 Host-only（node:fs），提示段与 mcp-purpose 同款注册纪律。
  'environment-notes.ts':'host',

  'development.ts':'host',
  // ADR-068: the release fetcher is Host-only (node:fs/node:crypto, network, the credentials seam); the
  // Client never downloads anything and only renders the machine codes it reports.
  // 官方 DSH home 解析（DSH_HOME / ~/.dsh）：skills 根与抓取根共用一份，避免各自漂移（review 0.2.2-1 F1）。
  'dsh-home.ts':'host',
  'github-release.ts':'host',
  'heal.ts':'host',
  'host.ts':'host',
  'index.ts':'host',
  'recovery.ts':'host',
  'search/config.ts':'host',
  'search/index.ts':'host',
  'search/provider.ts':'host',
  'search/setup-core.ts':'host',
  'search/setup.ts':'host',
  'search/skill.ts':'host',
  'searxng.ts':'host',
  'tar.ts':'host',
  'tool.ts':'host',
  'upgrade.ts':'host',
};

/** ADR-033：`src/clients/` 下的东西是**套件内嵌的 MCP 客户端模块**，不是 Host manager 也不是浏览器 Client：
 * 它们在源码层依赖 MCP SDK 与 node 内置，但会被 esbuild 各打成一个单独的 lib 模块，从不与 Host 管理器共享
 * 模块图。归属按目录给，新增一个 carried 模块不必再改这张表；单个文件的例外仍优先用 GROUP。 */
export const GROUP_PREFIX={
  'clients/':'clients',
};

export function groupOf(file){
  if(GROUP[file])return GROUP[file];
  for(const [prefix,group] of Object.entries(GROUP_PREFIX))if(file.startsWith(prefix))return group;
  return undefined;
}

/** 允许的组间边；不在表里的方向即禁止。 */
export const EDGES={
  host:new Set(['host','shared']),
  client:new Set(['client','shared']),
  shared:new Set(['shared']),
  clients:new Set(['clients','shared']),
};
