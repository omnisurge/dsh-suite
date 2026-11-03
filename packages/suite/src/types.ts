// The carried web-search module's Remote boundary types are part of the Suite's public type
// surface: the Remote generator requires every boundary type on a public non-root subpath.
export type {SetupCheck,SetupConfiguration,SetupExpectedConfiguration,SetupInspection,SetupProbe,SetupSettingsOwner} from './search/types.js';

/** ADR-058：极限模式的状态。Remote 边界类型必须住在公开的非 root 类型子路径（typert 生成器的要求），
 * 所以判定逻辑在 limit-mode.ts，跨线缆的形状在这里。 */
export interface LimitModeSelection {provider:string;model:string;}
export interface LimitModeStatus {
 available:boolean;code:string|null;enabled:boolean;models:string[];textLength:number;
 selection:LimitModeSelection|null;matched:boolean;
 /** 用户自己的这段提示文本：页内编辑要回填现值，读与写用同一份事实（ADR-060 D4）。 */
 text:string;
}

/** ADR-054 D1/D6：Agent Teams 诊断。字段白名单就是这些字段（specs/agent-teams-card.md）。 */
export type TeamMemberPhase='provisioning'|'active'|'failed';
export interface TeamMemberRow {id:string;name:string;description:string;provider:string;context:string;phase:TeamMemberPhase;error:string|null;}
export interface TeamRow {rootId:string;members:TeamMemberRow[];failed:number;code:string|null;}
export interface TeamPrecheck {state:'ok'|'warn'|'unknown';provider:string|null;model:string|null;failedMembers:number;code:string|null;providerVerified:boolean;}
export interface TeamStatus {available:boolean;code:string|null;maxMembers:number|null;teams:TeamRow[];precheck:TeamPrecheck;}

/** ADR-054 D1/D4：Agent Teams 的配置读/写。写入口是 profile patch（官方 applyEntryPatches 非 insert 补丁按键覆盖），
 * 不是官方 service——所以结果里必须带 \`restartRequired\`，不能假装热更新。 */
export interface TeamConfigRowView {rowId:string;name:string;maxMembers:number|null;freshProvider:string|null;otherKeys:string[];}
/** 字段值直接给到客户端（来源是各自那一行）；客户端不猜「第几行」，行序不是事实来源。 */
export interface TeamConfigState {available:boolean;code:string|null;profileKnown:boolean;rows:TeamConfigRowView[];maxMembersLimit:number;maxMembers:number|null;freshProvider:string|null;}
/** 只允许这两个声明键；Remote 边界不接受自由形状的 unknown 数据（typert 会拒绝）。 */
export interface TeamConfigPatch {maxMembers?:number;freshProvider?:string;}
export interface TeamConfigWrite {changed:boolean;backupPath:string|null;restartRequired:boolean;code:string|null;changedKeys:string[];maxMembers:number|null;freshProvider:string|null;}
/** 极限模式的写入补丁（本插件自己那一行的 `config.limitMode`）；三个键都可选。 */
/** ADR-061：环境笔记（本插件自己的笔记文件 + 一段系统提示）。文本由用户负责，套件不校验内容。 */
export interface EnvironmentNotesState {available:boolean;code:string|null;text:string;bytes:number;}
/** Client-safe contracts; this module has no Host or SDK runtime imports. */
/** Running capabilities one accepted generation must prove, per side. */
export interface BuildCapabilities {hostStamped:boolean;hostRemote:boolean;clientRemote:boolean;clientFlow:boolean;}
/** Receipt of the fixed build entry: protocol, entry identity and produced byte revisions.
 * Missing capabilities or a foreign protocol mean "not ready", never a successful update. */
export interface BuildResult {
 protocol:string;
 builderVersion:string;
 entryFingerprint:string;
 sourceFingerprint:string;
 hostRevision:string;
 clientRevision:string;
 capabilities:BuildCapabilities;
 changed:number;
}
/** What the loaded business Host module advertises about the bytes actually running. */
export interface HostRuntimeBuild {revision:string;protocol:string;capabilities:{hostStamped:boolean;hostRemote:boolean};}
/** What the business browser Client advertises about the bytes actually running. */
export interface ClientRuntimeBuild {revision:string;protocol:string;capabilities:{clientRemote:boolean;clientFlow:boolean};}
export interface DevelopmentOperation {epoch:number;phase:'idle'|'building'|'published'|'failed';error:string|null;target:BuildResult|null;}
export interface DevelopmentStatus {
 linked:boolean;
 sourceRoot:string|null;
 hostPid:number;
 hostHmr:boolean;
 managerProtocol:string;
 hostRevision:string|null;
 hostProtocol:string|null;
 hostCapabilities:{hostStamped:boolean;hostRemote:boolean}|null;
 operation:DevelopmentOperation;
 /** Machine-readable fact only: wording and language belong to the Client that renders it. */
 notice:{code:'RELEASE_PACKAGE'|'HMR_ENABLED'|'HMR_UNCONFIRMED'|'HOST_PROTOCOL_OLD'};
}

/** One read-only skills catalog row: every field is an official Summary fact, transported unchanged.
 * Declared here because the generated Remote descriptor references the result type as
 * '@omnisurge/dsh-suite/types#SkillsCatalog'; './types' is this package's public type surface. */
export interface SkillCatalogEntry {
 name:string;
 description:string;
 whenToUse?:string;
 path?:string;
 provider:string;
 source?:string;
 modelInvocable:boolean;
 userInvocable:boolean;
}
/** MCP server管理：一台已配置服务器在页面上的事实行。字段全部是机器可读事实，措辞由 Client 拥有。
 * 这里没有 url 的值、没有 headers/env 的值：端点的凭据与请求头只在 Host 写入 profile 的那一刻存在。
 * 例外是 stdio 的启动参数（ADR-055）：`command`/`args`/`cwd` **不是秘密**，它们是「这台服务器是什么」
 * 的一部分，用户没有它就改不了自己配的行，所以只对 stdio 且当前 profile 作用域的行透出；HTTP 行不出这三键。 */
export type McpServerState='running'|'failed'|'disabled'|'pending';
export type McpServerTransport='stdio'|'streamable-http';
/** 连接种类由行加载的客户端包决定（ADR-030 D1）：静态凭证 / OAuth 授权。 */
export type McpServerKind='static'|'oauth';
/** 客户端插件自己报告的连接态（机器事实，不含用户句子）。`modern` = 协商到 v2 协议。 */
export type McpRuntimeState='connected'|'failed'|'not-connected'|'needs-login'|'unknown';
export interface McpRuntimeStatus {
 state:McpRuntimeState;
 /** 该客户端报告的工具数；缺省表示它没报这个事实，不由页面推断。 */
 toolCount?:number;
 /** `modern` = 2026-07-28 协议（v2），`legacy` = 旧协议（v1）。 */
 protocolEra?:'modern'|'legacy';
 /** 原始诊断文本：只进「原始技术诊断」，不当消息显示。 */
 error?:string;
}
export interface McpServerEntry {
 /** 服务器名（`serverName`）：模型可见工具名的命名空间，页面按它排序与定位。 */
 name:string;
 transport:McpServerTransport;
 state:McpServerState;
 /** 该服务器当前注册到工具表的工具数；'mcp__<name>__' 前缀计数，不反解工具名。 */
 toolCount:number;
 /** 行的稳定 id（profile patch 里 `insert` 行的 id），编辑/删除的定位键。 */
 rowId:string;
 /** 'profile' = 行来自本 profile 的 patch；'loaded' = 行来自某个 bundle，删除时改写 disabled 覆盖。 */
 origin:'profile'|'loaded';
 /** 是否可编辑：只有 profile 行的 config 归本页面所有。 */
 editable:boolean;
 /** headers/env 的条目数，仅计数；值永不出 Host。 */
 headerCount:number;
 envCount:number;
 /** stdio 行的启动方式（ADR-055）：编辑表单要能让用户核对与微调。它不是秘值——秘值是 headers/env 的值与
  * 凭据引用；启动命令写在 profile patch 里，本来就是用户自己可读的。**只有本 profile 拥有、可编辑的 stdio 行**
  * 才带这三个键（bundle 行的启动方式归它的作者，不由本页回显）；非 stdio 行三个键都不出现，不是一个空串。 */
 command?:string;
 args?:string[];
 cwd?:string;
 /** 该行由哪个客户端包加载：`static` / `oauth` 由它判定（ADR-030 D1）。 */
 clientPackage:string;
 /** 该行的客户端由谁提供（ADR-033 D4）：`official` = 官方内置；`external-legacy` = 历史外部包（迁移源）；
  * `suite` = 套件携带的子路径模块；`unknown` = 不认识的包。页面按这个事实说话，不在 Client 侧维护包名表。 */
 clientSource:'official'|'external-legacy'|'suite'|'unknown';
 kind:McpServerKind;
 /** OAuth 行的两个非密事实（0.2.0-5）：预注册 client id（空串 = 未设置）与授权等待上限（未设置时键不出现）。
  * 仅 OAuth 行带这两个键；凭据（credentialId、secret）永不进入目录。 */
 staticClientId?:string;
 authorizationTimeoutMs?:number;
 /** 客户端插件报告的连接态；null = 该客户端没有状态控制面（官方/stdio/未知包），页面显示“无连接态可查”。 */
 runtime:McpRuntimeStatus|null;
 /** 该行仍是官方客户端的静态 HTTP 行，且 profile 里有 v2 客户端可用（ADR-030 D5）。 */
 upgradable:boolean;
 /** 该行可以发起用户触发的实时探测（客户端有控制面，且本进程有 loopback 可问）。 */
 probeAvailable:boolean;
 /** 该行可能谈成的协议：`negotiable` = 客户端支持 v2 协商；`v1-only` = 官方客户端/stdio/OAuth（只能 v1）；
  * `unknown` = 不认识的客户端包——不猜它能谈什么，页面因此不显示协议徽标（ADR-030 D4）。 */
 protocolSupport:'v1-only'|'negotiable'|'unknown';
}
/** 'live' = profile 的 patchReload 是 live，写入后由运行时重载；'manual' = 需要重启才生效。 */
export interface McpServerCatalog {servers:McpServerEntry[];reload:'live'|'manual';}
/** 用户触发的实时探测结果（ADR-030 D3）：runtime 为客户端插件当场报告的事实。 */
export interface McpProbeResult {rowId:string;name:string;runtime:McpRuntimeStatus|null;}
/** 旧静态 HTTP 行改走 v2 客户端的结果（ADR-030 D5）：生效需要重启进程。 */
export interface McpMigrationResult {changed:boolean;rows:string[];backupPath:string|null;restartRequired:boolean;}
/** 新增/编辑的输入。headers/env 是用户刚输入的明文，只在写 patch 时使用，不回显、不进日志、不进错误消息。 */
export interface McpServerDraft {
 name:string;
 /** Which carried client this row is for (ADR-033 D1): `static` (default) or `oauth`. It decides the subpath the
  * new row loads; it is not inferred from the profile's current rows or dependencies. */
 kind?:McpServerKind;
 /** The transport a NEW row gets. An edit may omit it — the page names only the fields the user changed, and the
  * stored row already carries its transport — while an add without it is refused with a readable error. */
 transport?:McpServerTransport;
 url?:string;
 command?:string;
 args?:string[];
 cwd?:string;
 toolCallTimeoutMs?:number;
 failOnStartupError?:boolean;
 headers?:Array<{key:string;value:string}>;
 env?:Array<{key:string;value:string}>;
 /** Pre-registered OAuth client id (0.2.0-5): a real AS may refuse dynamic registration. OAuth rows only;
  * a blank value writes nothing. */
 staticClientId?:string;
 /** How long the browser/callback wait may last, in ms (OAuth rows only). Validated before it is written. */
 authorizationTimeoutMs?:number;
}
/** 写入结果：'live' 表示重载后已在 loader 里看到该行；'pending' 表示已写盘但运行时尚未重载。 */
export interface McpServerMutation {mode:'added'|'updated'|'removed';rowId:string;name:string;applied:'live'|'pending';}
/** ADR-032 D5：用途编辑器看到的一行。`enabled:false` 的行页面仍可编辑，段里不显示（D3 与 D5 分开表达）。 */
export interface McpPurposeServer {rowId:string;serverName:string;enabled:boolean;}
/** ADR-032 D6：旁路文件读不出的原因。`raw` 是有界诊断摘录（≤2000 字符），不是给页面直接显示的用户文案。
 * `read-failed` 是 ADR 三种之外的更细分类（文件在但读不动），fail closed 行为与前三种一致。 */
export interface McpPurposeUnreadable {code:'bad-json'|'bad-shape'|'version-unknown'|'read-failed';raw:string;}
/** ADR-032 D5：内存快照 + 当前行。`purposes` 只含当前行键（孤儿已过滤）；`revision` 是每次写入必须回显的 CAS 令牌。 */
export interface McpPurposeSnapshot {routing:boolean;purposes:Record<string,string>;servers:McpPurposeServer[];revision:number;unreadable?:McpPurposeUnreadable;}
/** ADR-032 D5：写入回执给的是写入后的完整事实，页面据此刷新而不是自己猜。 */
export interface McpPurposeWriteResult {revision:number;routing:boolean;purposes:Record<string,string>;}
/** ADR-032 D5：跨文件事务回滚也失败时，删除只完成一半——两个文件各自的当前状态（`other` = 既不是旧字节也不是新字节）。 */
export interface McpPurposePartialDetail {patch:'old'|'new'|'other'|'unknown';purpose:'old'|'new'|'other'|'unknown';}
/** ADR-035/task-35：拒绝一个 draft 时页面需要的机器事实。`message` 仍是可读诊断（可进「原始技术诊断」），
 * 页面按 `field` + `reason` 渲染 locale 文案；`min`/`max` 只在取值有区间时出现（授权超时 1000..600000）。 */
export type McpDraftField='name'|'kind'|'transport'|'url'|'command'|'headers'|'env'|'staticClientId'|'authorizationTimeoutMs'|'rowId'|'row';
export type McpDraftReason='required'|'pattern'|'invalid-value'|'wrong-type'|'not-allowed'|'out-of-range'|'kind-conflict'|'transport-mismatch'|'not-unique'|'not-editable';
export interface McpDraftInvalidDetail {field:McpDraftField;reason:McpDraftReason;min?:number;max?:number;}
/** ADR-032 D5：`mcp/purpose-write-failed` 必须说明**哪个文件、什么原因**失败——同一结局一个码，但原始失败
 * 信息不许被吞掉。`step` 是失败的那个文件（删除事务里的两次 rename 分别对应 purpose/patch），`code`/`message`
 * 是底层失败自身的码与原因。 */
export interface McpPurposeWriteFailureDetail {step:'purpose-backup'|'purpose-stage'|'purpose-rename'|'patch-rename';code:string;message:string;}
/** 同一个「不许吞掉底层失败」的契约也适用于 profile patch 的写失败：`mcp/write-failed` 的 details 必须带
 * 底层 code/message（EPERM/EACCES/ENOSPC…），不是套件自己的包装码。 */
export interface McpWriteFailureDetail {code:string;message:string;}
/** 技能管理：可写范围与写结果。'user' = ~/.dsh/skills；'project' = 项目根的 .dsh/skills。 */
export type SkillScope='user'|'project';
export interface SkillDocument {
 name:string;
 description:string;
 whenToUse?:string;
 body:string;
 modelInvocable:boolean;
 userInvocable:boolean;
 scope:SkillScope;
 /** 指令文件的绝对路径；只给可写来源，随包来源为 null。 */
 path:string|null;
 /** 可编辑性：随包/office/runtime 提供的技能为只读。 */
 editable:boolean;
}
export interface SkillDraft {
 name:string;
 description:string;
 whenToUse?:string;
 body:string;
 modelInvocable?:boolean;
 userInvocable?:boolean;
 scope?:SkillScope;
}
export interface SkillMutation {mode:'created'|'updated'|'removed';name:string;scope:SkillScope;applied:'live'|'pending';}

/** 'complete:false' means discovery finished incompletely: the list is still what was found. */
export interface SkillRoots {
 user?:string;
 project?:string;
}

/** The two writable roots, resolved: the page shows them so the user knows which directory a create/delete
 * actually touches. `project` is the deployment working directory (ADR-026), not a Session's cwd. */
export interface SkillsCatalog {skills:SkillCatalogEntry[];complete:boolean;roots:SkillRoots;}

/** A declared runtime probe: the component's own loaded module answers with the version it was built
 * from, and optionally proves the strict protocol actually dispatches. Data, never per-plugin code. */
export interface ComponentRuntimeSpec {
 service:string;
 versionField:string;
 dispatch:{namespace:string;method:string}|null;
}
/** One member of the Suite's declared module set. The member is a module inside the Suite package
 * itself, so its identity is the row's module name and its version is the running Suite's version. */
export interface ComponentDefinition {
 id:string;
 module:string;
 rowId:string;
 display:{en:string;zh:string};
 runtime:ComponentRuntimeSpec|null;
}

/** Derived from official inventory and the declared runtime probe; never independently persisted.
 * `nextAction` is the single source the summary line and the card both derive from, so one state can
 * never look ready in one place and blocked in another. */
export interface ComponentStatus {
 id:string;
 display:{en:string;zh:string};
 module:string;
 rowId:string;
 /** The version of the Suite that carries and serves this module. */
 carriedVersion:string;
 /** What the running module advertises for itself; null when the module declares no runtime probe. */
 loadedVersion:string|null;
 /** The Suite-owned row state; enabling it is the official switch's fact. */
 rowEnabled:boolean;
 state:'ready'|'restart-required'|'disabled'|'unconfirmed'|'owner-missing';
 /** The one remaining user action, or 'none'. 'enable-row' is performed on the official plugin page. */
 nextAction:'none'|'restart'|'enable-row'|'check-runtime'|'check-owner';
 /** Raw diagnostic for the developer view; never the primary user-facing message. */
 diagnostic:string;
}

/** One durable record of an automatic row-level recovery after a boot that never reached readiness. */
export interface RecoveryReceipt {
 at:string;
 previousPid:number|null;
 reason:string;
 rows:Array<{id:string;rowId:string;application:string;code:string|null}>;
 /** 'rows-disabled' means the official row toggle applied and the next boot will not load them. */
 action:'rows-disabled'|'none';
}
/** One record of what this Suite did about an entry the official inventory reported as failed. It is an
 * act log, never a copy of the official enablement fact: the inventory stays the only authority on
 * whether an entry is enabled or failed. */
export interface HealRecord {
 /** Stable identity of the target: the official entry id, branded and never reconstructed. */
 entryId:string;
 /** The exact module specifier the Loader entry imports, so the user sees a name, not an id. */
 moduleName:string;
 /** 'suite' for our own rows, 'third-party' for anything else that is not an official package. */
 owner:'suite'|'third-party';
 /** 'disabled' only after the official toggle answered `applied`; every other value is a diagnosis.
  *  'recovered' means the retry brought the entry back up, so nothing was disabled. */
 outcome:'disabled'|'recovered'|'refused-readonly'|'not-disabled'|'toggle-failed'|'absent'|'protected';
 /** Why the entry failed, taken from the official operation diagnostic (never from a stack trace).
  *  The inventory carries enablement and phase but not the error, so this is the only public source. */
 reason?:{code:string;text:string};
 /** Which boot spent the last judgement on this row. A re-open happens once per boot, not once per pass. */
 bootId?:string;
 /** The control-plane code behind a non-applied outcome, or the official application value. */
 code:string|null;
 at:string;
 /** How many times this Suite attempted the containment. Retries are bounded, never a loop. */
 attempts:number;
 /** The user has seen this notice and dismissed it; a dismissed notice is never shown again. */
 acknowledged:boolean;
}
/** The declared component set, the latest boot recovery, and what the start-up healer has done. */
export interface ComponentSetStatus {
 components:ComponentStatus[];
 recovery:RecoveryReceipt|null;
 heal:HealRecord[];
}

/** A verified upgrade candidate discovered in the configured release directory. */
export interface UpgradeComponent {id:string;module:string;rowId:string;}
export interface UpgradeCandidate {
 version:string;
 filename:string;
 directory:string;
 suiteSha256:string;
 suiteBytes:number;
 components:UpgradeComponent[];
}
export interface UpgradeStatus {
 mode:'release'|'source';
 currentVersion:string;
 releaseDirectory:string;
 latest:UpgradeCandidate|null;
 refusals:Array<{directory:string;code:string;diagnostic:string|null}>;
 canUpgrade:boolean;
 /** ADR-079: the durable record of the last install attempt this profile saw. The install's own reply can
  * be lost when the plugin tree reloads (the Suite is replacing the plugin that hosts the RPC), so the
  * record — not the reply — is how a later reader learns what happened. `null` when no attempt was recorded
  * (a fixture without a profile, or a profile that never installed anything). */
 lastInstall?:UpgradeInstallRecord|null;
}
export interface UpgradeInstallRecord {
 schema:1;
 target:string;
 /** SHA256 of the archive the attempt was bound to, when the caller knew it. */
 sha256?:string|null;
 /** `installing` is written BEFORE the official transaction starts, so a process that dies mid-install
  * still leaves the intent behind; the other three are written at every exit. */
 phase:'installing'|'written'|'failed'|'interrupted';
 startedAt:string;
 finishedAt?:string|null;
 /** The Host's own verdict code for that attempt (`SUITE_UPGRADE_RESTART_REQUIRED` / a failure code), or
  * the code the reconciler inferred when it found an `installing` record after a restart. */
 code?:string|null;
 /** The version the profile held when the phase was last written, read from disk. */
 onDisk?:string|null;
 /** Who wrote the attempt. A status read must never settle the attempt of the process that is still running
  * it: the reviewer's race turned a live `installing` into `interrupted` (ADR-079 D6). */
 pid?:number|null;
}
export interface UpgradeResult {
 code:string;
 target:string|null;
 /** The version the profile actually holds after the transaction, read from disk (ADR-047 D3): the
  * install call's own outcome is never the authority for "did the bytes land". */
 onDisk?:string|null;
 /** True when the transaction did not confirm activation but the target version is already on disk:
  * the receipt is a restart requirement, not a failure. */
 activationUnconfirmed?:boolean;
 operations:Array<{stage:'component-install'|'component-deselect'|'suite-install';target:string;application:string;changed:boolean;code:string|null;diagnostic:string|null}>;
 diagnostic:string|null;
 status:UpgradeStatus|null;
 /** The record this attempt wrote, so the receipt the caller may never receive is also readable here. */
 lastInstall?:UpgradeInstallRecord|null;
}
