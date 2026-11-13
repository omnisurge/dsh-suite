/**
 * The "Skills & MCP" sidebar panel: one whole-page surface with two management tabs.
 *
 * Entry and page are one contribution (ADR-023): the sidebar slot supplies the button and its own SVG
 * glyph, and the keyed main slot supplies the page under the same id. The official shell owns the button
 * and the panel switch; this page never calls selectPanel or rewrites panelInfo.
 *
 * Both tabs are independent management surfaces with their own read chain (ADR-025): each keeps its own
 * last-read receipt, busy state, failure fact and last good result, and the state object is created here at
 * registration time so switching tabs never loses or repeats a read. The Host sends machine facts only;
 * every sentence belongs to this Client's dictionaries (AGENTS section 5.10).
 *
 * The MCP tab lists SERVERS, not tools (ADR-025 D4): the 0.1.4/0.1.5 flat tool wall had no reading value at
 * hundreds of model-facing names. A row's identity for editing/removing is the Loader/patch rowId; a public
 * tool name is never parsed back into (serverName, rawName) (ADR-024 correction 2).
 *
 * remote.omnisurgeSuiteDev is a Cordis service, not a field: it is read only inside the inject scope that
 * declares it. Registration never waits for the handle, so a Host that is unreachable, still starting, or
 * failed to mount its generated Remote still leaves the user a page that names the reason (AGENTS 5.8).
 */
import * as React from 'react';
import {ActionGroup,Badge,Button,CapsuleSwitch,Disclosure,EmptyState,Field,FormGrid,IconButton,KeyValueList,ListRow,NumberInput,PageHead,SearchInput,SectionTabs,Select,SheetHead,StatusLine,Switch,TextArea,TextInput,injectStyles,showConfirm,showToast} from '@omnisurge/dsh-ui';

/** Sidebar id and main-panel key are the same value: the shell dispatches one by the other. */
export const TOOLS_PANEL_ID='omnisurge-skills-mcp';
export const TOOLS_LOCALE_NS='omnisurge.tools';
/** The 0.1.3 skills dictionary keeps its namespace and its exact 30 keys; the tab still reads from it. */
export const SKILLS_LOCALE_NS='omnisurge.skills';

const h=React.createElement;
const NAMESPACE_INJECT=['remote','remote.omnisurgeSuiteDev'];
const SKILLS_METHOD='listSkills';
const MCP_METHOD='listMcpServers';
// ADR-032: the purpose sidecar is its own fact source. The page reads the Host's in-memory snapshot (never the
// disk) and writes through per-key CAS calls; both write answers carry the new snapshot facts.
const MCP_PURPOSES_METHOD='readMcpPurposes';
const MCP_PURPOSE_WRITE='writeMcpPurpose';
const MCP_ROUTING_WRITE='setMcpRouting';
const MCP_PURPOSE_MAX=200;
const SIDEBAR_SLOT='sidebar.panellist';
const MAIN_SLOT='main';

/**
 * Page frame, tab labels and the MCP tab wording. The skills tab keeps omnisurge.skills for the 30 keys it
 * shipped with in 0.1.3; the row-expansion words this new page adds live here so that dictionary neither
 * grows nor drifts from the published 0.1.3 key set.
 */
const en={
  nav:'Skills & MCP',
  title:'Skills & MCP',
  intro:"Manage this app’s skills and MCP servers: create, edit or delete skills, and add, edit or remove MCP servers.",
  tabsLabel:'Sections',
  tabSkills:'Skills',
  tabMcp:'MCP servers',
  refresh:'Refresh',
  refreshing:'Reading…',
  checkedAt:'Last read: {time}',
  rawDetails:'Original technical diagnostics',
  notConnected:"Suite not connected; refresh to retry.",
  componentNotStarted:"The Suite component did not start here; refresh.",
  answerUnreadable:"Suite reply unreadable; refresh.",
  summaryPending:'Not read yet',
  details:'Details',
  whenToUse:'When to use',
  providerLabel:'Provider',
  sourceLabel:'Source',
  skillsSummary:'{skills} skills · {sources} sources · {providers} providers',
  mcpServersSummary:'{servers} servers · {running} running · {tools} tools',
  mcpAdd:'Add server',
  edit:'Edit',
  remove:'Delete',
  mcpToolCount:'{count} tools',
  mcpStateRunning:'Running',
  mcpStateFailed:'Start failed',
  mcpStateDisabled:'Disabled',
  mcpStatePending:'Not loaded',
  mcpTransportHttp:'HTTP',
  mcpTransportStdio:'stdio',
  mcpEndpoint:'Endpoint',
  mcpEndpointConfigured:"Configured; value hidden.",
  mcpEndpointReplace:'Replace endpoint',
  mcpEndpointReplaceHint:'Type the new endpoint. Leaving the field blank submits nothing and keeps the current one.',
  mcpStartCommand:'Start command',
  mcpStartCommandConfigured:'Configured. The launch command is not a secret, so it can be read and edited below.',
  mcpStartCommandReplace:'Replace start command',
  mcpStartCommandReplaceHint:'Type the new command, its arguments and the working directory. Blank fields submit nothing and keep the current values.',
  mcpKeepUnlessChanged:"The saved value is not shown; only your edits change it.",
  mcpEmptyTitle:'No MCP servers yet',
  mcpEmptyDescription:'Add a server and its tools become available to the model.',
  mcpProfileUnavailable:"No writable configuration is available.",
  mcpPatchUnreadable:"Unsupported configuration format; editing unavailable.",
  mcpAddTitle:'Add MCP server',
  mcpEditTitle:'Edit MCP server',
  back:'Back',
  mcpServerName:'Server name',
  mcpServerNameHint:'Letters, digits, underscore or hyphen; 1–32 characters.',
  mcpTransport:'Transport',
  mcpUrl:'URL',
  mcpUrlHint:'The streamable HTTP endpoint.',
  mcpCommand:'Command',
  mcpCommandHint:"The executable the app launches.",
  mcpArgs:'Arguments',
  mcpArgsHint:'One argument per line.',
  mcpCwd:'Working directory',
  mcpCwdHint:'Optional. Leave it blank to use the default working directory.',
  mcpCwdHintEdit:'Empty keeps the existing value.',
  mcpTimeout:'Tool call timeout (ms)',
  mcpTimeoutHint:'Optional. Default 300000 (5 minutes); range 1000-600000.',
  mcpTimeoutHintEdit:'Optional; empty keeps the existing value.',
  mcpFailOnStartup:'Abort when startup fails',
  mcpFailOnStartupHint:"When on, a startup failure is an error instead of leaving a degraded server.",
  mcpGroupOfficial:'Servers managed by the app',
  mcpGroupOfficialHint:'Same configuration as the official plugin page; changes here are visible there.',
  mcpGroupSuite:"This suite's MCP clients",
  mcpGroupSuiteHint:'OAuth sign-in and connection handling, maintained by this suite.',
  mcpEnabled:'Enabled',
  mcpEnabledHint:'A disabled server stays listed but does not start.',
  mcpManagedUnavailable:"The app's MCP manager is not available here, so servers cannot be changed on this page.",
  mcpHeaders:'HTTP headers',
  mcpEnv:'Environment variables',
  mcpConfiguredCount:'{count} configured',
  mcpPairsKeep:'Unchanged',
  mcpPairsClear:'Clear',
  mcpPairsReplace:'Replace',
  mcpPairsClearHint:'Saving submits an empty list, which removes every saved entry.',
  mcpPairsReplaceHint:'Saving submits exactly the rows below; they replace every saved entry.',
  mcpPairsHint:"Saved values are not shown. A blank row leaves that entry unset.",
  mcpPairsHintEdit:"Saved values are not shown. Blank rows are skipped; saving replaces all saved entries with the rows below.",
  mcpKeyLabel:'Name',
  mcpValueLabel:'Value',
  mcpKeyPlaceholder:'Name',
  mcpValuePlaceholder:'Value',
  mcpRemoveRow:'Remove',
  mcpAddRow:'Add row',
  save:'Save',
  saving:'Saving…',
  cancel:'Cancel',
  mcpDeleteTitle:'Delete MCP server?',
  mcpDeleteTextProfile:"Remove this row from the configuration: {name}.",
  mcpDeleteTextLoaded:"This row comes from a plugin bundle; this action disables it: {name}.",
  mcpAdded:'Added',
  mcpUpdated:'Saved',
  mcpRemoved:'Deleted',
  mcpApplied:'Applied',
  mcpPending:'Submitted, waiting for reload',
  mutationToast:'{action} · {state}: {name}',
  mcpDraftInvalid:'Some fields are missing or invalid: check the name, transport and URL or command.',
  mcpServerExists:'A server with this name already exists.',
  mcpServerMissing:'That server row no longer exists; refresh and try again.',
  mcpServerNotEditable:"This row belongs to another configuration and cannot be edited here.",
  mcpWriteLocked:"Another writer is editing the configuration; try again shortly.",
  mcpWriteFailed:"Writing the configuration failed; nothing changed. Retry later.",
  mcpSaveFailed:"Change failed; see diagnostic code, then retry.",
  closeToast:'Close',
  skillsCreate:'New skill',
  skillsAddTitle:'New skill',
  skillsEditTitle:'Edit skill',
  skillsName:'Name',
  skillsNameHint:"Used as the skill directory name; validated on save.",
  skillsDescription:'Description',
  skillsBody:'Body',
  skillsBodyHint:'The skill instructions (Markdown).',
  skillsScope:'Write location',
  skillsScopeUser:'User (~/.dsh/skills)',
  skillsScopeProject:'Project (.dsh/skills)',
  skillsScopeUserHint:'Writes into ~/.dsh/skills.',
  skillsScopeProjectHint:'Writes into the project’s .dsh/skills, which may enter git.',
  skillsBundled:'Shipped with a package',
  skillsManagedElsewhere:'Managed by another tool',
  skillsCreated:'Created',
  skillsUpdated:'Saved',
  skillsDeleted:'Deleted',
  skillsWritten:'Written',
  skillsRemovedToast:'{action}: {name}',
  skillsDeleteTitle:'Delete skill?',
  skillsDeleteText:'This removes the skill file: {path}.',
  skillsSaveFailed:"Change failed; see diagnostic code, then retry.",
  skillsNameTaken:'A skill with this name already exists.',
  skillsNotEditable:"This skill comes from a package or the app; this page cannot change it.",
  skillsInvalidDraft:'Some fields are missing or invalid: check the name, description and body.',
  skillsPathEscape:'The skill path would leave the allowed directories; the write was refused.',
  skillsWriteFailed:"Writing the skill file failed; nothing changed. Retry later.",
  mcpKind:'Connection type',
  mcpKindStatic:'Static credentials',
  mcpKindOauth:'OAuth',
  mcpOauthFlowHint:'OAuth rows use the HTTP transport and carry no headers here: saving the row starts its sign-in flow in that client.',
  mcpStaticClientId:'Static client ID',
  mcpStaticClientIdHint:'Optional. Only when the service cannot register dynamically: the client ID pre-registered for this server. Never paste the client secret.',
  mcpStaticClientIdHintEdit:'Leave blank to keep the current value (it cannot be cleared here). Only for servers that cannot register dynamically; paste the client ID, never the client secret.',
  mcpAuthTimeout:'Authorization timeout (ms)',
  mcpAuthTimeoutHint:'Optional. Default 300000 (5 minutes); range 1000–600000.',
  mcpAuthTimeoutHintEdit:'Leave blank to keep the current value (it cannot be cleared here). Range 1000–600000.',
  mcpPurpose:'Purpose',
  mcpPurposeHint:'One line, up to 200 characters. Empty means no purpose yet.',
  mcpPurposeUnfilled:'No purpose yet',
  mcpPurposeLine:'Purpose: {text}',
  mcpPurposeEditValue:'{text} (click to edit)',
  mcpPurposeClear:'Clear and save',
  mcpPurposeSaved:'Purpose saved',
  mcpPurposeCleared:'Purpose cleared',
  mcpPurposeConflict:'The purpose file changed elsewhere; the latest revision is shown — please try again.',
  mcpPurposeKeyUnknown:'That server is no longer in the list; the list was refreshed.',
  mcpPurposeInvalid:'The purpose was refused: one line, up to 200 characters.',
  mcpPurposeWriteFailed:"Could not save purpose; see diagnostic code, then retry.",
  mcpPurposeUnavailable:"Purpose file unreadable; retry. Purposes cannot be saved.",
  mcpPurposePartial:"Last delete was partial; refresh and retry.",
  mcpPurposeReadFailed:"Could not read purposes; see diagnostic code, then retry.",
  mcpPurposeUnreadable:"Purpose file unreadable; retry. Purposes are hidden.",
  mcpRouting:"Session MCP purpose",
  mcpRoutingHint:"When off, purposes are not added to the session and remain saved.",
  mcpRoutingSaved:"Session purpose updated",
  mcpRow:'Server row',
  mcpDraftRequired:'{label} is required.',
  mcpDraftPattern:'{label} has an invalid format.',
  mcpDraftInvalidValue:'{label} has an invalid value.',
  mcpDraftWrongType:'{label} has the wrong type.',
  mcpDraftNotAllowed:'{label} is not allowed here.',
  mcpDraftOutOfRange:'{label} must be between {min} and {max}.',
  mcpDraftKindConflict:'{label} conflicts with the connection type.',
  mcpDraftTransportMismatch:'{label} does not match the transport.',
  mcpDraftNotUnique:'{label} is already in use.',
  mcpDraftNotEditable:'{label} cannot be edited here.',
  mcpHttpOnlyClientHint:'This row is loaded by an HTTP-only client. To use stdio, delete it and add a new row.',
  mcpRuntimeUnknown:'Status unknown',
  mcpOauthLogin:'Sign in',
  mcpOauthLogout:'Sign out',
  mcpOauthPasteHint:'Open the authorization link, finish the sign-in in the browser, then paste the code here.',
  mcpOauthConnected:'Connected',
  mcpOauthWaiting:'Waiting for authorization…',
  mcpOauthWaitingHint:'Finish the sign-in in the browser; this page checks by itself and updates when it is done, so there is nothing to paste.',
  mcpOauthCancel:'Cancel sign-in',
  mcpOauthCancelled:'Sign-in cancelled',
  mcpOauthCancelFailed:"Could not cancel sign-in; see diagnostic code, then retry.",
  mcpOauthWaitTimeout:'The sign-in wait timed out; start the sign-in again to retry.',
  mcpOauthWaitUnreadable:"Sign-in status unreadable; see diagnostic code, then retry.",
  mcpOauthIncomplete:'The sign-in did not complete; start it again to retry.',
  mcpOauthCodeLabel:'Authorization code',
  mcpOauthCodeHint:'Pasted here only: submitted once, never logged; if it is refused the value stays so you can retry.',
  mcpOauthSubmit:'Submit',
  mcpOauthSubmitted:'Signed in',
  mcpOauthLoggedOut:'Signed out',
  mcpOauthLoginFailed:"Could not start sign-in; see diagnostic code, then retry.",
  mcpOauthSubmitFailed:"Code refused; check it and retry; see diagnostic code.",
  mcpOauthLogoutFailed:"Sign-out failed; see diagnostic code, then retry.",
  mcpProtocolV2:'v2',
  mcpProtocolV1:'v1',
  mcpProtocolOnlyV1:'v1 only',
  mcpProtocolNegotiating:'Negotiating',
  mcpRuntimeConnected:'Connected',
  mcpRuntimeFailed:'Connection failed',
  mcpRuntimeNotConnected:'Not connected',
  mcpRuntimeNeedsLogin:'Sign-in required',
  mcpRuntimeNone:'No connection status available',
  mcpSettings:'Settings',
  mcpCheckConnection:'Check connection',
  mcpProbeDone:'Check finished: {state}',
  mcpProbeNoAnswer:"Check finished without a connection status; try the check again.",
  mcpProbeFailed:"The connection check failed; see the technical diagnostics for the error code.",
  mcpUpgradableNotice:'{count} static HTTP rows are still loaded by the official client (v1 only).',
  mcpMigrate:'Switch to the v2 client',
  mcpMigrating:'Switching…',
  mcpMigrateTitle:'Switch static HTTP rows to the v2 client?',
  mcpMigrateText:"This changes the client used by {count} rows, backs up the configuration, and takes effect after a restart.",
  mcpMigrateConfirm:'Switch and back up',
  mcpMigrateDone:'Switched {count} rows · restart required',
  mcpMigrateNoop:'Every row already uses the v2 client',
  mcpMigrationFailed:"Switch failed; see diagnostic code, then retry.",
  mcpProbeUnavailable:"This MCP server does not support connection checks.",
  mcpMigrationUnavailable:"No configured MCP client supports v2.",
  mcpLegacyNotice:'{count} rows still load an old external client package: {names}',
  mcpMigrateClients:'Switch to the built-in clients',
  mcpMigratingClients:'Switching…',
  mcpMigrateClientsTitle:'Switch rows to the built-in MCP clients?',
  mcpMigrateClientsText:"This changes the client used by {count} rows, backs up the configuration, and takes effect after a restart.",
  mcpMigrateClientsConfirm:'Switch and back up',
  mcpMigrateClientsDone:'Switched {count} rows · restart required',
  mcpMigrateClientsNoop:'Every row already uses the built-in clients',
  mcpClientsRestart:'Restart the app for the switch to take effect.',
  mcpClientsMigrationFailed:"Client switch failed; see diagnostic code, then retry.",
  mcpClientsBackup:'Backup file',
};

const zh={
  nav:'技能 · MCP',
  title:'技能 · MCP',
  intro:"管理此应用的技能与 MCP 服务器：技能可新建、编辑、删除；MCP 服务器可添加、编辑、删除。",
  tabsLabel:'分区',
  tabSkills:'技能',
  tabMcp:'MCP 服务器',
  refresh:'刷新',
  refreshing:'正在读取…',
  checkedAt:'最近读取：{time}',
  rawDetails:'原始技术诊断',
  notConnected:"尚未连接套件，请刷新重试。",
  componentNotStarted:"组件未启动，请刷新。",
  answerUnreadable:"套件回复无法读取，请刷新重试。",
  summaryPending:'尚未读取',
  details:'详情',
  whenToUse:'使用时机',
  providerLabel:'提供方',
  sourceLabel:'来源',
  skillsSummary:"{skills} 个技能 · {sources} 个来源 · {providers} 个提供方",
  mcpServersSummary:'{servers} 个服务器 · {running} 个运行中 · {tools} 个工具',
  mcpAdd:'添加服务器',
  edit:'编辑',
  remove:'删除',
  mcpToolCount:'{count} 个工具',
  mcpStateRunning:'运行中',
  mcpStateFailed:'启动失败',
  mcpStateDisabled:'已禁用',
  mcpStatePending:'未加载',
  mcpTransportHttp:'HTTP',
  mcpTransportStdio:'stdio',
  mcpEndpoint:'端点',
  mcpEndpointConfigured:"已配置（不显示）。",
  mcpEndpointReplace:'更换端点',
  mcpEndpointReplaceHint:'填写新的端点；留空不提交，保留原端点。',
  mcpStartCommand:'启动命令',
  mcpStartCommandConfigured:'已配置（启动命令不是秘密，可在下面查看并修改）。',
  mcpStartCommandReplace:'更换启动命令',
  mcpStartCommandReplaceHint:'填写新的命令、参数与工作目录；留空的字段不提交，保留原值。',
  mcpKeepUnlessChanged:"当前值不显示；编辑后才更改。",
  mcpEmptyTitle:'还没有 MCP 服务器',
  mcpEmptyDescription:'添加一台服务器后，它的工具会出现在模型可用的工具表里。',
  mcpProfileUnavailable:"当前没有可写的配置文件。",
  mcpPatchUnreadable:"当前配置格式不受支持，本页无法编辑。",
  mcpAddTitle:'添加 MCP 服务器',
  mcpEditTitle:'编辑 MCP 服务器',
  back:'返回',
  mcpServerName:'服务器名',
  mcpServerNameHint:'字母、数字、下划线或连字符，1–32 个字符。',
  mcpTransport:'传输方式',
  mcpUrl:'URL',
  mcpUrlHint:'streamable HTTP 端点。',
  mcpCommand:'命令',
  mcpCommandHint:"应用启动的可执行文件。",
  mcpArgs:'参数',
  mcpArgsHint:'每行一个参数。',
  mcpCwd:'工作目录',
  mcpCwdHint:'可选。留空用默认工作目录。',
  mcpCwdHintEdit:'留空 = 保留原值。',
  mcpTimeout:'工具调用超时（毫秒）',
  mcpTimeoutHint:'可选。默认 300000（5 分钟）；范围 1000-600000。',
  mcpTimeoutHintEdit:'可选；留空 = 保留原值。',
  mcpFailOnStartup:'启动失败时中止',
  mcpFailOnStartupHint:"开启后，启动失败会报错，不会降级运行。",
  mcpGroupOfficial:'由应用管理的服务器',
  mcpGroupOfficialHint:'与官方插件页使用同一份配置；这里改的服务器，官方页面也看得到。',
  mcpGroupSuite:'本套件自带的 MCP 客户端',
  mcpGroupSuiteHint:'这些客户端提供 OAuth 登录与连接方式适配，由本套件维护。',
  mcpEnabled:'启用',
  mcpEnabledHint:'停用的服务器仍会列出，但不会启动。',
  mcpManagedUnavailable:'当前环境没有可用的 MCP 管理器，这里暂时不能改服务器。',
  mcpHeaders:'HTTP 头',
  mcpEnv:'环境变量',
  mcpConfiguredCount:'已配置 {count} 项',
  mcpPairsKeep:'不变',
  mcpPairsClear:'清空',
  mcpPairsReplace:'替换',
  mcpPairsClearHint:'保存时提交空列表，已保存的条目会全部删除。',
  mcpPairsReplaceHint:'保存时提交下面这些行，它们会替换已保存的全部条目。',
  mcpPairsHint:"已存值不显示。空行表示不设置。",
  mcpPairsHintEdit:"不会显示已保存的值。空行会跳过；保存时用下面的行替换全部已存条目。",
  mcpKeyLabel:'键名',
  mcpValueLabel:'值',
  mcpKeyPlaceholder:'键名',
  mcpValuePlaceholder:'值',
  mcpRemoveRow:'移除',
  mcpAddRow:'添加一行',
  save:'保存',
  saving:'保存中…',
  cancel:'取消',
  mcpDeleteTitle:'删除 MCP 服务器？',
  mcpDeleteTextProfile:"将从当前配置中移除此行：{name}。",
  mcpDeleteTextLoaded:"该行由插件包提供；此操作会将其停用：{name}。",
  mcpAdded:'已添加',
  mcpUpdated:'已保存',
  mcpRemoved:'已删除',
  mcpApplied:'已生效',
  mcpPending:'已提交，等待重载',
  mutationToast:'{action} · {state}：{name}',
  mcpDraftInvalid:'字段不完整或格式不对：检查名称、传输方式与地址/命令。',
  mcpServerExists:'同名服务器已存在。',
  mcpServerMissing:'该服务器行已不存在，刷新后重试。',
  mcpServerNotEditable:"此行不属于当前配置，无法在此编辑。",
  mcpWriteLocked:"另一个写入者正在修改配置，请稍后重试。",
  mcpWriteFailed:"写入配置失败，原文件未更改；请稍后重试。",
  mcpSaveFailed:"改动失败；机器码见诊断，请重试。",
  closeToast:'关闭',
  skillsCreate:'新建技能',
  skillsAddTitle:'新建技能',
  skillsEditTitle:'编辑技能',
  skillsName:'名称',
  skillsNameHint:"用作技能目录名；保存时会校验。",
  skillsDescription:'描述',
  skillsBody:'正文',
  skillsBodyHint:'技能指令正文（Markdown）。',
  skillsScope:'写入位置',
  skillsScopeUser:'用户（~/.dsh/skills）',
  skillsScopeProject:'项目（.dsh/skills）',
  skillsScopeUserHint:'写入 ~/.dsh/skills。',
  skillsScopeProjectHint:'会写入项目 .dsh/skills，可能进 git。',
  skillsBundled:'随包提供',
  skillsManagedElsewhere:'由其它工具维护',
  skillsCreated:'已创建',
  skillsUpdated:'已保存',
  skillsDeleted:'已删除',
  skillsWritten:'已写入',
  skillsRemovedToast:'{action}：{name}',
  skillsDeleteTitle:'删除技能？',
  skillsDeleteText:'将删除技能文件：{path}。',
  skillsSaveFailed:"改动失败；机器码见诊断，请重试。",
  skillsNameTaken:'同名技能已存在。',
  skillsNotEditable:"该技能由插件包或应用提供，本页不能修改。",
  skillsInvalidDraft:'字段不完整或格式不对：检查名称、描述与正文。',
  skillsPathEscape:'技能路径越出允许的目录，已拒绝写入。',
  skillsWriteFailed:"技能文件写入失败，原文件未改；请重试。",
  mcpKind:'连接种类',
  mcpKindStatic:'静态凭证',
  mcpKindOauth:'OAuth',
  mcpOauthFlowHint:'OAuth 行走 HTTP 传输，不在这里填 header：保存该行后由该行客户端发起授权流。',
  mcpStaticClientId:'静态客户端 ID',
  mcpStaticClientIdHint:'可选。只有服务不支持动态注册时才需要：填预注册的 client ID，不要填 client secret。',
  mcpStaticClientIdHintEdit:'留空 = 保留当前值（不能在这里清除）。仅用于不支持动态注册的服务；填 client id，不要填 client secret。',
  mcpAuthTimeout:'授权超时（毫秒）',
  mcpAuthTimeoutHint:'可选。默认 300000（5 分钟）；范围 1000–600000。',
  mcpAuthTimeoutHintEdit:'留空 = 保留当前值（不能在这里清除）。范围 1000–600000。',
  mcpPurpose:'用途',
  mcpPurposeHint:'单行，最多 200 字符。留空 = 未填用途。',
  mcpPurposeUnfilled:'未填用途',
  mcpPurposeLine:'用途：{text}',
  mcpPurposeEditValue:'{text}（点击编辑）',
  mcpPurposeClear:'清空并保存',
  mcpPurposeSaved:'用途已保存',
  mcpPurposeCleared:'用途已清除',
  mcpPurposeConflict:'用途文件已被其他窗口更新，已显示最新版本；请重试。',
  mcpPurposeKeyUnknown:'该服务器已不在当前列表，列表已刷新。',
  mcpPurposeInvalid:'用途被拒绝：请用单行、不超过 200 字符。',
  mcpPurposeWriteFailed:"用途保存失败；机器码见诊断，请重试。",
  mcpPurposeUnavailable:"用途文件读不到，请重试；暂不能保存。",
  mcpPurposePartial:"上次删除未全部完成；请刷新重试。",
  mcpPurposeReadFailed:"用途读取失败；机器码见诊断，请重试。",
  mcpPurposeUnreadable:"用途读取失败，暂不显示；请重试。",
  mcpRouting:"MCP 会话用途",
  mcpRoutingHint:"关闭后，会话不会包含用途内容；已填用途仍保留。",
  mcpRoutingSaved:"会话用途设置已更新",
  mcpRow:'服务器行',
  mcpDraftRequired:'缺少{label}。',
  mcpDraftPattern:'{label}格式不对。',
  mcpDraftInvalidValue:'{label}的值不合法。',
  mcpDraftWrongType:'{label}的类型不对。',
  mcpDraftNotAllowed:'这里不允许填{label}。',
  mcpDraftOutOfRange:'{label}需在 {min}–{max} 之间。',
  mcpDraftKindConflict:'{label}与连接种类冲突。',
  mcpDraftTransportMismatch:'{label}与传输方式不匹配。',
  mcpDraftNotUnique:'{label}已被占用。',
  mcpDraftNotEditable:'{label}不能在这里编辑。',
  mcpHttpOnlyClientHint:'该行由只支持 HTTP 的客户端加载。要用 stdio，请删除后重新添加。',
  mcpRuntimeUnknown:'状态未知',
  mcpOauthLogin:'登录',
  mcpOauthLogout:'登出',
  mcpOauthPasteHint:'打开授权链接，在浏览器完成登录后，把授权码粘贴到这里。',
  mcpOauthWaiting:'等待授权中…',
  mcpOauthWaitingHint:'在浏览器里完成授权即可；本页会自动检查并在完成后更新，不需要粘贴任何东西。',
  mcpOauthCancel:'取消登录',
  mcpOauthCancelled:'已取消登录',
  mcpOauthCancelFailed:"无法取消登录；机器码见诊断，请重试。",
  mcpOauthWaitTimeout:'等待授权超时；请重新开始登录。',
  mcpOauthWaitUnreadable:"无法读取登录状态；机器码见诊断，请重试。",
  mcpOauthIncomplete:'登录未完成；请重新开始登录。',
  mcpOauthConnected:'已连接',
  mcpOauthCodeLabel:'授权码',
  mcpOauthCodeHint:'只在这里粘贴：提交一次，不写日志；若被拒绝会保留以便重试。',
  mcpOauthSubmit:'提交',
  mcpOauthSubmitted:'已登录',
  mcpOauthLoggedOut:'已登出',
  mcpOauthLoginFailed:"无法开始登录；机器码见诊断，请重试。",
  mcpOauthSubmitFailed:"授权码被拒绝；请核对重试，机器码见诊断。",
  mcpOauthLogoutFailed:"登出失败；机器码见诊断，请重试。",
  mcpProtocolV2:'v2',
  mcpProtocolV1:'v1',
  mcpProtocolOnlyV1:'只支持 v1',
  mcpProtocolNegotiating:'协商中',
  mcpRuntimeConnected:'已连接',
  mcpRuntimeFailed:'连接失败',
  mcpRuntimeNotConnected:'未连接',
  mcpRuntimeNeedsLogin:'需要登录',
  mcpRuntimeNone:'无连接态可查',
  mcpSettings:'设置',
  mcpCheckConnection:'检查连接',
  mcpProbeDone:'检查完成：{state}',
  mcpProbeNoAnswer:"检查完成但未返回连接状态，请重新检查。",
  mcpProbeFailed:"检查连接失败；错误码见原始技术诊断。",
  mcpUpgradableNotice:'{count} 条旧静态 HTTP 行仍由官方客户端加载（只支持 v1）。',
  mcpMigrate:'改走 v2 客户端',
  mcpMigrating:'正在切换…',
  mcpMigrateTitle:'把静态 HTTP 行改走 v2 客户端？',
  mcpMigrateText:"会更改 {count} 行使用的客户端、备份当前配置，并在重启后生效。",
  mcpMigrateConfirm:'切换并备份',
  mcpMigrateDone:'已改 {count} 条 · 需要重启生效',
  mcpMigrateNoop:'已全部在 v2 客户端上',
  mcpMigrationFailed:"切换失败；机器码见诊断，请重试。",
  mcpProbeUnavailable:"此 MCP 服务器不支持连接状态检查。",
  mcpMigrationUnavailable:"当前配置没有支持 v2 的 MCP 客户端，无法切换。",
  mcpLegacyNotice:'{count} 行仍由旧外部客户端包加载：{names}',
  mcpMigrateClients:'改走内嵌客户端',
  mcpMigratingClients:'正在切换…',
  mcpMigrateClientsTitle:'把这些行改走套件内嵌 MCP 客户端？',
  mcpMigrateClientsText:"会更改 {count} 行使用的客户端、备份当前配置，并在重启后生效。",
  mcpMigrateClientsConfirm:'切换并备份',
  mcpMigrateClientsDone:'已改 {count} 行 · 需要重启生效',
  mcpMigrateClientsNoop:'已全部在内嵌客户端上',
  mcpClientsRestart:'重启应用后切换才生效。',
  mcpClientsMigrationFailed:"客户端切换失败；机器码见诊断，请重试。",
  mcpClientsBackup:'备份文件',
};

/** The 0.1.3 skills dictionary, carried over verbatim (30 keys per language). */
const skillsEn={
  nav:'Skills',
  title:'Skills',
  intro:"A read-only list of skills found by the app, with provider, source, invocation policy and path. The providing plugin or directory owns each skill’s content.",
  filterLabel:'Filter skills',
  filterPlaceholder:'Filter by name, description or when to use',
  refresh:'Refresh',
  refreshing:'Reading…',
  checkedAt:'Last read: {time}',
  rawDetails:'Original technical diagnostics',
  notConnected:"Suite not connected; refresh to retry.",
  componentNotStarted:"The Suite component did not start here; refresh.",
  registryUnavailable:"Skills did not load; refresh to retry. The rest of the Suite is unaffected.",
  answerUnreadable:"Suite reply unreadable; refresh.",
  incomplete:"Skill list may be incomplete; refresh to retry.",
  emptyTitle:'No skills to show',
  emptyDescription:'Nothing is registered right now, or nothing matches the filter.',
  path:'Path',
  copyPath:'Copy path',
  copiedPath:'Copied',
  invocationNone:'Not callable',
  invocationModel:'Model-invocable',
  invocationUser:'User-invocable',
  providerRuntime:"App",
  providerFilesystem:'Filesystem',
  sourceProjectDsh:'Project (.dsh)',
  sourceProjectAgents:'Project (.agents)',
  sourceUserDsh:'User (.dsh)',
  sourceUserAgents:'User (.agents)',
  sourceCustom:'Custom',
  sourceBundled:'Bundled',
  scopeProjectNote:"Default deployment project root, not this session’s working directory.",
  scopeProjectUnavailable:"The project root could not be determined; only the user directory is available.",
  deleteTextUser:'This removes the skill file from the user directory: {path}.',
  deleteTextProject:'This removes the skill file from the project directory: {path}.',
};

const skillsZh={
  nav:'技能',
  title:'技能',
  intro:"只读显示应用发现的技能：每行一个技能，附来源、调用策略与路径；技能内容由提供它的插件或目录管理。",
  filterLabel:'筛选技能',
  filterPlaceholder:'按名称、描述或使用时机筛选',
  refresh:'刷新',
  refreshing:'正在读取…',
  checkedAt:'最近读取：{time}',
  rawDetails:'原始技术诊断',
  notConnected:"尚未连接套件，请刷新重试。",
  componentNotStarted:"组件未启动，请刷新。",
  registryUnavailable:"技能未加载；请刷新重试。套件其他功能不受影响。",
  answerUnreadable:"套件回复无法读取，请刷新重试。",
  incomplete:"技能列表可能不全；请刷新重试",
  emptyTitle:'没有可显示的技能',
  emptyDescription:'当前没有注册技能，或者没有匹配筛选的技能。',
  path:'路径',
  copyPath:'复制路径',
  copiedPath:'已复制',
  invocationNone:'不可调用',
  invocationModel:'模型可调用',
  invocationUser:'用户可调用',
  providerRuntime:"应用",
  providerFilesystem:'文件系统',
  sourceProjectDsh:'项目（.dsh）',
  sourceProjectAgents:'项目（.agents）',
  sourceUserDsh:'用户（.dsh）',
  sourceUserAgents:'用户（.agents）',
  sourceCustom:'自定义',
  sourceBundled:"随包提供",
  scopeProjectNote:"这是部署默认的项目根目录，不是当前会话的工作目录。",
  scopeProjectUnavailable:"无法确定项目根目录，只能写入用户目录。",
  deleteTextUser:'将删除用户目录下的技能文件：{path}。',
  deleteTextProject:'将删除项目目录下的技能文件：{path}。',
};

/** Source values the Host documents; any other value is shown verbatim, never invented into an enum. */
const SOURCE_WORDS=new Map([
  ['project-dsh','sourceProjectDsh'],
  ['project-agents','sourceProjectAgents'],
  ['user-dsh','sourceUserDsh'],
  ['user-agents','sourceUserAgents'],
  ['custom','sourceCustom'],
  ['bundled','sourceBundled'],
  ['runtime','providerRuntime'],
]);

/** A failure fact: the kind chooses the one sentence, the raw text goes to the technical disclosure. */
const failure=(kind,message,code)=>{const error=new Error(message);error.failure={kind,raw:message};if(typeof code==='string'&&code.length>0)error.code=code;return error;};
const reason=error=>error&&typeof error==='object'?String(error.code??error.name??'REMOTE_ERROR')+': '+String(error.message??error):String(error);
/** The code is the machine fact; the sentence is chosen from it and nothing else. The gateway collapses a
 * plain Host Error into 'gateway/internal', so a message prefix is never parsed here: guessing a code from
 * prose is how a fixture-green claim reaches a real window as the wrong sentence. */
const SKILLS_CODES=new Map([['skills/registry-unavailable','registry']]);
const MCP_CODES=new Map([['mcp/profile-unavailable','profile-unavailable'],['mcp/profile-patch-unreadable','patch-unreadable']]);
const refusalKind=code=>SKILLS_CODES.get(code)??MCP_CODES.get(code)??'refused';
const codeOf=error=>error&&typeof error==='object'&&typeof error.code==='string'&&error.code.length>0?error.code:null;

/** HH:MM only: the receipt is a clock reading, not a locale-formatted date sentence. */
const clock=()=>{
  try{return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});}
  catch{return new Date().toTimeString().slice(0,5);}
};
const fill=(template,values)=>Object.entries(values).reduce((line,entry)=>line.split('{'+entry[0]+'}').join(String(entry[1])),String(template));

const skillsSentence=(t,issue)=>issue===null?null:
  issue.kind==='namespace'?t('notConnected'):
  issue.kind==='mount'?t('componentNotStarted'):
  issue.kind==='registry'?t('registryUnavailable'):
  issue.kind==='answer'?t('answerUnreadable'):
  t('componentNotStarted');
const mcpSentence=(t,issue)=>issue===null?null:
  issue.kind==='namespace'?t('notConnected'):
  issue.kind==='mount'?t('componentNotStarted'):
  issue.kind==='profile-unavailable'?t('mcpProfileUnavailable'):
  issue.kind==='patch-unreadable'?t('mcpPatchUnreadable'):
  issue.kind==='answer'?t('answerUnreadable'):
  t('componentNotStarted');
/** The four server states the Host reports; an unknown value is shown verbatim, never guessed into a state. */
const MCP_STATE_KEYS=new Map([['running','mcpStateRunning'],['failed','mcpStateFailed'],['disabled','mcpStateDisabled'],['pending','mcpStatePending']]);
const MCP_STATE_TONES=new Map([['running','ok'],['failed','err'],['disabled','muted'],['pending','muted']]);
const MCP_RUNTIME_KEYS=new Map([
  ['connected','mcpRuntimeConnected'],
  ['failed','mcpRuntimeFailed'],
  ['not-connected','mcpRuntimeNotConnected'],
  ['needs-login','mcpRuntimeNeedsLogin'],
  ['unknown','mcpRuntimeUnknown'],
]);
const MCP_RUNTIME_TONES=new Map([['connected','ok'],['failed','err'],['not-connected','warn'],['needs-login','warn'],['unknown','warn']]);
/** The protocol word is derived from the Host's protocolSupport fact (ADR-030 D4/ADR-031), never from the client
 * package name or from kind: this page carries no adapter table. A package capability (v1-only) is a load-time
 * fact and stays visible in every state; a failed row states no protocol at all (ADR-031 D1); a non-running row
 * or a silent runtime has nothing to report; and only a connected runtime that has not named its era yet is said
 * to be negotiating (ADR-031 D2). The protocol date itself never becomes copy. */
const mcpProtocolOf=server=>{
  if(server.protocolSupport==='unknown')return null;
  if(server.protocolSupport==='v1-only')return {key:'mcpProtocolOnlyV1'};
  if(server.state==='failed')return null;
  if(server.state!=='running')return null;
  const runtime=server.runtime;
  if(runtime===null||runtime===undefined)return null;
  if(runtime.state!=='connected')return null;
  if(runtime.protocolEra==='modern')return {key:'mcpProtocolV2'};
  if(runtime.protocolEra==='legacy')return {key:'mcpProtocolV1'};
  return {key:'mcpProtocolNegotiating'};
};
/** Write refusals, each with its own sentence. A code that is not here still gets one readable sentence; the
 * machine code only ever travels to the technical disclosure. */
const MCP_MUTATION_ERRORS=new Map([
  ['mcp/draft-invalid','mcpDraftInvalid'],
  ['mcp/server-exists','mcpServerExists'],
  ['mcp/server-missing','mcpServerMissing'],
  ['mcp/server-not-editable','mcpServerNotEditable'],
  ['mcp/profile-unavailable','mcpProfileUnavailable'],
  ['mcp/profile-patch-unreadable','mcpPatchUnreadable'],
  ['mcp/write-locked','mcpWriteLocked'],
  ['mcp/write-failed','mcpWriteFailed'],
  ['mcp/probe-unavailable','mcpProbeUnavailable'],
  ['mcp/row-missing','mcpServerMissing'],
  ['mcp/migration-unavailable','mcpMigrationUnavailable'],
  ['mcp/managed-unavailable','mcpManagedUnavailable'],
  ['mcp/managed-write-failed','mcpWriteFailed'],
]);
/** ADR-032 purpose refusals: conflict and key-unknown are refreshable, the rest are sentences; the machine code
 * still only ever reaches the technical disclosure. */
const MCP_PURPOSE_ERRORS=new Map([
  ['mcp/purpose-conflict','mcpPurposeConflict'],
  ['mcp/purpose-key-unknown','mcpPurposeKeyUnknown'],
  ['mcp/purpose-invalid','mcpPurposeInvalid'],
  ['mcp/purpose-write-failed','mcpPurposeWriteFailed'],
  ['mcp/purpose-unavailable','mcpPurposeUnavailable'],
  ['mcp/purpose-partial','mcpPurposePartial'],
]);
const mcpPurposeSentence=(t,failed)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:MCP_PURPOSE_ERRORS.get(code);
  return key===undefined?t('mcpPurposeWriteFailed'):t(key);
};
const mcpPurposeRefreshable=failed=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  return code==='mcp/purpose-conflict'||code==='mcp/purpose-key-unknown';
};
const mcpMutationSentence=(t,failed)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:MCP_MUTATION_ERRORS.get(code);
  return key===undefined?t('mcpSaveFailed'):t(key);
};
/** Draft field names (the Host's machine facts) to the label the form already shows for that field. */
const MCP_DRAFT_FIELD_LABELS=new Map([
  ['name','mcpServerName'],
  ['serverName','mcpServerName'],
  ['rowId','mcpRow'],
  ['row','mcpRow'],
  ['kind','mcpKind'],
  ['transport','mcpTransport'],
  ['url','mcpUrl'],
  ['command','mcpCommand'],
  ['args','mcpArgs'],
  ['cwd','mcpCwd'],
  ['toolCallTimeoutMs','mcpTimeout'],
  ['failOnStartupError','mcpFailOnStartup'],
  ['staticClientId','mcpStaticClientId'],
  ['authorizationTimeoutMs','mcpAuthTimeout'],
  ['headers','mcpHeaders'],
  ['env','mcpEnv'],
]);
/** One sentence per machine reason; `out-of-range` additionally names the interval the Host reported. */
const MCP_DRAFT_REASONS=new Map([
  ['required','mcpDraftRequired'],
  ['pattern','mcpDraftPattern'],
  ['invalid-value','mcpDraftInvalidValue'],
  ['wrong-type','mcpDraftWrongType'],
  ['not-allowed','mcpDraftNotAllowed'],
  ['out-of-range','mcpDraftOutOfRange'],
  ['kind-conflict','mcpDraftKindConflict'],
  ['transport-mismatch','mcpDraftTransportMismatch'],
  ['not-unique','mcpDraftNotUnique'],
  ['not-editable','mcpDraftNotEditable'],
]);
/**
 * A structured `mcp/draft-invalid` refusal becomes one readable sentence about the field it names (ADR §5.10: the
 * Host sends field/reason/min/max, this page owns the wording). An unknown field or reason falls back to the
 * generic sentence, and the machine code never leaves the technical disclosure.
 */
const mcpDraftInvalidSentence=(t,failed)=>{
  if(codeOf(failed)!=='mcp/draft-invalid')return null;
  const details=failed&&typeof failed==='object'?failed.details:null;
  if(!details||typeof details!=='object')return null;
  const reason=typeof details.reason==='string'?details.reason:null;
  const field=typeof details.field==='string'?details.field:null;
  const labelKey=field===null?undefined:MCP_DRAFT_FIELD_LABELS.get(field);
  const reasonKey=reason===null?undefined:MCP_DRAFT_REASONS.get(reason);
  if(reasonKey===undefined||labelKey===undefined)return null;
  const label=t(labelKey);
  if(reason==='out-of-range'){
    if(!Number.isFinite(details.min)||!Number.isFinite(details.max))return null;
    return fill(t(reasonKey),{label,min:String(details.min),max:String(details.max)});
  }
  return fill(t(reasonKey),{label});
};
const mutationRaw=failed=>failed&&failed.failure&&typeof failed.failure.raw==='string'?failed.failure.raw:String(failed&&failed.message?failed.message:failed);
/** Probe/migration refusals reuse the MCP code table but need their own fallback sentence: a failed check is not a
 * failed save. The machine code still only travels to the technical disclosure. */
const mcpActionSentence=(t,failed,fallbackKey)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:MCP_MUTATION_ERRORS.get(code);
  return key===undefined?t(fallbackKey):t(key);
};
/** The OAuth client publishes its own loopback control plane on the app's own origin (ADR-033/ADR-034 D1).
 * The page is an entry to that canonical flow: it POSTs the sign-in start, POSTs the pasted code (paste
 * downgrade only) and reads the live status while the Host waits for the callback in the background
 * (ADR-052 D3). The path is the published contract, not a package name; the body is JSON and nothing else
 * travels — never a code, never a token. */
const mcpOauthPath=(serverName,action)=>'/mcp-oauth-client/'+encodeURIComponent(serverName)+'/'+action;
/** ADR-052 D3: the page never holds the long request. It asks the Host once (the Host waits in the background)
 * and then polls this read-only route on a bounded timer. The interval is fixed so a real authorization is
 * observed within a couple of seconds while the idle page stays quiet. */
const MCP_OAUTH_POLL_MS=1500;
/** The wait budget the page enforces on itself. The Host has its own authorization timeout (default 300000 ms,
 * configurable up to 600000 on an OAuth row); the page allows the configured budget plus one poll of slack for
 * the status round trip, and never waits forever if the Host forgot to publish a terminal state. */
const MCP_OAUTH_WAIT_DEFAULT_MS=300_000;
const MCP_OAUTH_WAIT_CEILING_MS=600_000;
const mcpOauthWaitBudgetMs=server=>{
  const configured=server&&typeof server.authorizationTimeoutMs==='number'&&Number.isFinite(server.authorizationTimeoutMs)&&server.authorizationTimeoutMs>0?server.authorizationTimeoutMs:MCP_OAUTH_WAIT_DEFAULT_MS;
  return Math.min(configured,MCP_OAUTH_WAIT_CEILING_MS)+MCP_OAUTH_POLL_MS;
};
/** The pasted authorization code is a credential: a diagnostic may quote a control-plane error, never the code
 * the user pasted, so the value is masked before it can reach any rendered raw block. */
const mcpRedactCode=(raw,code)=>{
  const text=String(raw);
  const secret=String(code).trim();
  return secret.length===0?text:text.split(secret).join('<code>');
};
/** One control-plane call. POST carries a JSON body (and, for /login, the mode); GET is the read-only status
 * poll (ADR-052 D2) and therefore sends neither a body nor a content type. */
const mcpOauthCall=async(serverName,action,{method='POST',body=null}={})=>{
  const response=method==='GET'
    ?await fetch(mcpOauthPath(serverName,action),{method:'GET'})
    :await fetch(mcpOauthPath(serverName,action),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body??{})});
  const text=await response.text();
  let value=null;
  try{value=text.length>0?JSON.parse(text):null;}catch{value=null;}
  if(!response.ok){
    const detail=value!==null&&typeof value==='object'&&typeof value.error==='string'?value.error:text;
    throw failure('refused','OAUTH_CONTROL '+action+' '+String(response.status)+' → '+detail);
  }
  return value;
};
const mcpOauthPost=(serverName,action,body)=>mcpOauthCall(serverName,action,{method:'POST',body});
const mcpOauthStatus=serverName=>mcpOauthCall(serverName,'status',{method:'GET'});
/**
 * The authorization face of a StatusView (ADR-052 D2). `authorization` is authoritative; the older top-level
 * `authorizationUrl`/`prefer` pair is read only as a compatibility fallback for a Host that has not published
 * the nested object yet, because the nested object is the one that also says whether a wait is still running.
 * The shape deliberately carries no code and no token: what the page renders is a URL, a state word and the
 * resolved preference.
 */
const MCP_OAUTH_PREFS=new Set(['loopback','paste']);
const mcpAuthorizationOf=view=>{
  if(view===null||typeof view!=='object')return {state:'idle',authorizationUrl:null,prefer:null,startedAt:null};
  const nested=view.authorization!==null&&typeof view.authorization==='object'?view.authorization:null;
  const readUrl=value=>typeof value==='string'&&value.length>0?value:null;
  const readPrefer=value=>MCP_OAUTH_PREFS.has(value)?value:null;
  if(nested!==null){
    return {
      state:nested.state==='waiting'?'waiting':'idle',
      authorizationUrl:readUrl(nested.authorizationUrl)??readUrl(view.authorizationUrl),
      prefer:readPrefer(nested.prefer)??readPrefer(view.prefer),
      // The Host publishes an ISO-8601 string (it is a wall-clock fact, not a duration); a finite number is
      // accepted for a Host that sent epoch milliseconds, because refusing it would silently drop a real fact.
      startedAt:typeof nested.startedAt==='string'&&nested.startedAt.length>0?nested.startedAt:(typeof nested.startedAt==='number'&&Number.isFinite(nested.startedAt)?nested.startedAt:null),
    };
  }
  // Compatibility only: a Host that publishes just the flat pair is treated as idle with a usable URL, so the
  // page still offers the link and the paste box instead of claiming a wait nobody is running.
  return {state:'idle',authorizationUrl:readUrl(view.authorizationUrl),prefer:readPrefer(view.prefer),startedAt:null};
};
/** The connection status word of a StatusView; only the documented values count, anything else is 'error' so the
 * page states a terminal outcome instead of polling forever. */
const mcpOauthStatusOf=view=>{
  const status=view!==null&&typeof view==='object'?view.status:null;
  return status==='connected'||status==='needs_login'||status==='idle'||status==='error'?status:'error';
};
const SKILLS_MUTATION_ERRORS=new Map([
  ['skills/name-taken','skillsNameTaken'],
  ['skills/not-editable','skillsNotEditable'],
  ['skills/invalid-draft','skillsInvalidDraft'],
  ['skills/path-escape','skillsPathEscape'],
  ['skills/write-failed','skillsWriteFailed'],
]);
const skillsMutationSentence=(t,failed)=>{
  const code=failed&&typeof failed==='object'?codeOf(failed):null;
  const key=code===null?undefined:SKILLS_MUTATION_ERRORS.get(code);
  return key===undefined?t('skillsSaveFailed'):t(key);
};
/** One draft line is a non-empty name plus its value; blank lines are "keep the existing value", so they are
 * not submitted as an empty entry (the Host replaces the whole object it receives). */
const pairList=rows=>rows
  .filter(pair=>pair&&typeof pair.key==='string'&&pair.key.trim().length>0&&typeof pair.value==='string'&&pair.value.length>0)
  .map(pair=>({key:pair.key.trim(),value:pair.value}));

/**
 * The value-level edit glyph (ADR-046): a 14px pencil that only appears while the row is hovered or holds
 * focus. It is decoration, not a control — the value text itself is the accessible button, so this carries
 * aria-hidden and never enters the tab order; it exists so the mouse target sits right where the value ends.
 */
function PencilIcon(){
  return h('svg',{xmlns:'http://www.w3.org/2000/svg',viewBox:'0 0 14 14',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.4,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false','data-testid':'pencil-icon'},
    h('path',{d:'M2.2 11.8 L2.9 9.1 L9.4 2.6 L11.4 4.6 L4.9 11.1 Z'}),
    h('path',{d:'M8.9 3.1 L10.9 5.1'}));
}

/**
 * The suite-owned sidebar glyph (V1: a skill spark plus a socket with a short cable). Owner props are the
 * shell's size and active flags; the selected state thickens the same stroke instead of swapping artwork.
 */
export function ToolsPanelIcon({size=18,active=false}){
  return h('svg',{
    xmlns:'http://www.w3.org/2000/svg',
    viewBox:'0 0 24 24',
    width:size,
    height:size,
    fill:'none',
    stroke:'currentColor',
    strokeWidth:active?2.2:1.8,
    strokeLinecap:'round',
    strokeLinejoin:'round',
    'aria-hidden':'true',
    focusable:'false',
    'data-testid':'tools-icon',
    'data-active':active?'true':'false',
  },
  h('path',{key:'spark',d:'M9 3.2l1.1 2.9 2.9 1.1-2.9 1.1L9 11.2 7.9 8.3 5 7.2l2.9-1.1z'}),
  h('rect',{key:'socket',x:12.2,y:10.2,width:7.6,height:6.4,rx:1.6}),
  h('path',{key:'prongs',d:'M14.4 16.6v2.2M17.6 16.6v2.2'}),
  h('path',{key:'cable',d:'M20 13.4h1.6'}));
}

/** No reader face (a headless fixture mounted the page without its contribution): render and name it. */
const DETACHED_ISSUE={kind:'namespace',raw:'SUITE_NAMESPACE_MISSING tools panel (the page was mounted without its reader)'};
const DETACHED={tab:'skills',skills:{data:null,complete:null,lastRead:null,phase:'idle',started:true,issue:DETACHED_ISSUE},mcp:{data:null,purposes:null,purposesIssue:DETACHED_ISSUE,lastRead:null,phase:'idle',started:true,issue:DETACHED_ISSUE}};
const noopSubscribe=()=>()=>{};
const zeroRevision=()=>0;

/** The whole page: one head, two tabs, and each tab's own read chain. */
function ToolsPanel(props){
  const t=typeof props.t==='function'?props.t:key=>typeof en[key]==='string'?en[key]:key;
  const tSkills=typeof props.tSkills==='function'?props.tSkills:key=>typeof skillsEn[key]==='string'?skillsEn[key]:key;
  const panel=props.panel??DETACHED;
  const subscribe=typeof props.subscribe==='function'?props.subscribe:noopSubscribe;
  const getRevision=typeof props.getRevision==='function'?props.getRevision:zeroRevision;
  const start=typeof props.start==='function'?props.start:()=>undefined;
  const notify=typeof props.notify==='function'?props.notify:()=>undefined;
  // The registration-time state object is the only store: switching tabs re-renders, it never re-reads.
  React.useSyncExternalStore(subscribe,getRevision,getRevision);
  const tab=panel.tab==='mcp'?'mcp':'skills';
  // "This tab already ran its first read" is this page's own fact, keyed by tab: it must not depend on the identity
  // of the slot object the Host/registration store owns, and it must survive switching tabs (this component stays
  // mounted while the tab content swaps). The slot keeps its own started flag for the store's readers.
  const firstReadRef=React.useRef({skills:false,mcp:false});
  React.useEffect(()=>{
    const slot=panel[tab];
    if(slot&&firstReadRef.current[tab]!==true){
      firstReadRef.current[tab]=true;
      slot.started=true;
      start(tab);
    }
  },[tab,panel,start]);
  const select=id=>{if(panel.tab===id)return;panel.tab=id;notify();};
  // A main-panel page root, not the settings column: .omni-ui-page fills the panel and carries the page
  // padding (.omni-ui is the 760px settings bar width — using it here is what shifted 0.1.4's content).
  return h('div',{className:'omni-ui-tokens omni-ui-page','data-testid':'tools-panel'},
    h('div',{'data-testid':'skills-page-head'},h(PageHead,{title:t('title'),description:t('intro')})),
    h(SectionTabs,{value:tab,ariaLabel:t('tabsLabel'),options:[{id:'skills',label:t('tabSkills')},{id:'mcp',label:t('tabMcp')}],onChange:select}),
    tab==='mcp'
      ?h(McpTab,{t,panel:panel.mcp,start:()=>start('mcp'),mutate:typeof props.mutate==='function'?props.mutate:async()=>{throw failure('namespace','SUITE_MUTATE_MISSING the page was mounted without its writer');}})
      :h(SkillsTab,{t,skillsT:tSkills,panel:panel.skills,start:()=>start('skills'),mutate:typeof props.mutate==='function'?props.mutate:async()=>{throw failure('namespace','SUITE_MUTATE_MISSING the page was mounted without its writer');}}));
}

/** Sources the Host documents as package/runtime-owned, shown as "shipped with a package". */
const SKILLS_PACKAGED_SOURCES=new Set(['bundled','office','runtime']);
/** The Host's write path can only reach these two roots (ADR-026): $DSH_HOME/skills and <project>/.dsh/skills.
 * A skill from ~/.agents/skills, <project>/.agents/skills or a custom root is someone else's file, so this page
 * must not offer an action the Host would refuse; those rows are read-only with their own reason. */
const WRITABLE_SKILL_SOURCES=new Set(['user-dsh','project-dsh']);
const skillWritable=skill=>{
  const path=typeof skill.path==='string'&&skill.path.length>0;
  const source=typeof skill.source==='string'?skill.source:'';
  return path&&WRITABLE_SKILL_SOURCES.has(source);
};
/** The source also names the root. removeSkill/readSkill without a scope search the user root only, so a project
 * row must pass 'project' or the Host answers skills/not-editable. Unwritable sources never reach these calls. */
const skillScopeOf=source=>source==='user-dsh'?'user':source==='project-dsh'?'project':undefined;

/**
 * The skills tab: the migrated 0.1.3 catalogue, now with create/edit/delete.
 *
 * Rows keep the read-only facts (provider, source, invocation, path, expansion) and add one action cluster. A
 * package/runtime skill or a row without a file path hides Edit and disables Delete with the reason inline: the
 * page must not offer a write the Host would refuse. Editing first calls readSkill for the body, because the list
 * entry deliberately carries no body; a failed read lands as a page-level sentence, never as a half-filled form.
 * Credentials are not a skill concept, so this form has no write-only field. Every sentence is dictionary copy.
 */
function SkillsTab(props){
  const t=props.t,skillsT=props.skillsT,slot=props.panel,start=props.start,mutate=props.mutate;
  const [filter,setFilter]=React.useState('');
  const [form,setForm]=React.useState(null);
  const [values,setValues]=React.useState(null);
  const [savePhase,setSavePhase]=React.useState('idle');
  const [saveIssue,setSaveIssue]=React.useState(null);
  const [actionIssue,setActionIssue]=React.useState(null);
  const [opening,setOpening]=React.useState(null);
  const [removing,setRemoving]=React.useState(null);
  const confirmRef=React.useRef(null);
  React.useEffect(()=>()=>{if(confirmRef.current!==null){confirmRef.current.close();confirmRef.current=null;}},[]);
  const busy=slot.phase==='loading';
  const catalog=slot.data;
  const skills=catalog!==null&&Array.isArray(catalog.skills)?catalog.skills:[];
  const roots=catalog!==null&&catalog.roots!==null&&typeof catalog.roots==='object'?catalog.roots:{};
  const userRoot=typeof roots.user==='string'&&roots.user.length>0?roots.user:null;
  const projectRoot=typeof roots.project==='string'&&roots.project.length>0?roots.project:null;
  const query=filter.trim().toLowerCase();
  const visible=query.length===0?skills:skills.filter(skill=>{
    const haystack=[skill.name,skill.description,skill.whenToUse].filter(value=>typeof value==='string').join('\n').toLowerCase();
    return haystack.includes(query);
  });
  const sentence=skillsSentence(skillsT,slot.issue);
  const sources=new Set(skills.filter(skill=>typeof skill.source==='string'&&skill.source.length>0).map(skill=>skill.source)).size;
  const providers=new Set(skills.filter(skill=>typeof skill.provider==='string'&&skill.provider.length>0).map(skill=>skill.provider)).size;
  const summary=catalog===null?t('summaryPending'):fill(t('skillsSummary'),{skills:skills.length,sources,providers});
  const receipt=slot.lastRead===null?null:h('span',{className:'omni-ui-hint','data-testid':'skills-checked'},fill(t('checkedAt'),{time:slot.lastRead}));
  const setValue=(key,value)=>setValues(current=>current===null?current:{...current,[key]:value});
  const closeForm=()=>{setForm(null);setValues(null);setSaveIssue(null);setSavePhase('idle');};
  const openAdd=()=>{
    setActionIssue(null);setSaveIssue(null);
    setValues({name:'',description:'',whenToUse:'',body:'',modelInvocable:true,userInvocable:true,scope:'user'});
    setForm({mode:'add',document:null});
  };
  const openEdit=async skill=>{
    setActionIssue(null);setSaveIssue(null);setOpening(String(skill.name));
    try{
      const scope=skillScopeOf(typeof skill.source==='string'?skill.source:'');
      const document=scope===undefined?await mutate('readSkill',String(skill.name)):await mutate('readSkill',String(skill.name),scope);
      setValues({
        name:typeof document.name==='string'?document.name:String(skill.name),
        description:typeof document.description==='string'?document.description:'',
        whenToUse:typeof document.whenToUse==='string'?document.whenToUse:'',
        body:typeof document.body==='string'?document.body:'',
        modelInvocable:document.modelInvocable===true,
        userInvocable:document.userInvocable===true,
        scope:document.scope==='project'?'project':'user',
      });
      setForm({mode:'edit',document});
    }catch(failed){
      setActionIssue({sentence:skillsMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setOpening(null);
    }
  };
  const buildDraft=()=>{
    const draft={
      name:String(values.name).trim(),
      description:String(values.description).trim(),
      body:String(values.body),
      modelInvocable:values.modelInvocable===true,
      userInvocable:values.userInvocable===true,
      scope:values.scope==='project'?'project':'user',
    };
    const when=String(values.whenToUse).trim();
    if(when.length>0)draft.whenToUse=when;
    return draft;
  };
  const submit=async()=>{
    if(savePhase==='saving'||form===null)return;
    setSavePhase('saving');setSaveIssue(null);
    try{
      const draft=buildDraft();
      const mutation=form.mode==='add'
        ?await mutate('createSkill',draft)
        :await mutate('updateSkill',String(form.document?.name??draft.name),draft);
      const name=mutation&&typeof mutation.name==='string'?mutation.name:draft.name;
      showToast({text:fill(t('mutationToast'),{action:t(form.mode==='add'?'skillsCreated':'skillsUpdated'),state:t('skillsWritten'),name}),kind:'skills-mutation',closeLabel:t('closeToast')});
      closeForm();
      start();
    }catch(failed){
      setSaveIssue({sentence:skillsMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setSavePhase('idle');
    }
  };
  const remove=async skill=>{
    setActionIssue(null);setRemoving(String(skill.name));
    try{
      const scope=skillScopeOf(typeof skill.source==='string'?skill.source:'');
      const mutation=scope===undefined?await mutate('removeSkill',String(skill.name)):await mutate('removeSkill',String(skill.name),scope);
      const name=mutation&&typeof mutation.name==='string'?mutation.name:String(skill.name);
      showToast({text:fill(t('skillsRemovedToast'),{action:t('skillsDeleted'),name}),kind:'skills-mutation',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      setActionIssue({sentence:skillsMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setRemoving(null);
    }
  };
  const askRemove=skill=>{
    if(confirmRef.current!==null)confirmRef.current.close();
    const path=typeof skill.path==='string'&&skill.path.length>0?skill.path:String(skill.name);
    const scope=skillScopeOf(typeof skill.source==='string'?skill.source:'');
    const text=scope==='project'?fill(skillsT('deleteTextProject'),{path}):scope==='user'?fill(skillsT('deleteTextUser'),{path}):fill(t('skillsDeleteText'),{path});
    confirmRef.current=showConfirm({
      title:t('skillsDeleteTitle'),
      text,
      cancelLabel:t('cancel'),
      confirmLabel:t('remove'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;void remove(skill);},
    });
  };
  const formSection=()=>{
    const add=form.mode==='add';
    const document=form.document;
    const scopeRoot=values.scope==='project'?projectRoot:userRoot;
    return h('section',{className:'omni-ui-stack','data-testid':'skills-form-section'},
      h(SheetHead,{title:add?t('skillsAddTitle'):t('skillsEditTitle'),dismissLabel:t('back'),onDismiss:closeForm}),
      h('div',{className:'omni-ui-stack','data-testid':'skills-form'},
        h(Field,{label:t('skillsName'),hint:t('skillsNameHint')},
          h(TextInput,{name:'skillName',autoComplete:'off',disabled:!add,value:values.name,onChange:event=>setValue('name',event.target.value),'data-testid':'skills-form-name'})),
        h(Field,{label:t('skillsDescription')},
          h(TextInput,{name:'description',autoComplete:'off',value:values.description,onChange:event=>setValue('description',event.target.value),'data-testid':'skills-form-description'})),
        h(Field,{label:t('whenToUse')},
          h(TextInput,{name:'whenToUse',autoComplete:'off',value:values.whenToUse,onChange:event=>setValue('whenToUse',event.target.value),'data-testid':'skills-form-when'})),
        h(Field,{label:t('skillsBody'),hint:t('skillsBodyHint')},
          h(TextArea,{name:'body',rows:12,variant:'notes',className:'omni-ui-mono',value:values.body,onChange:event=>setValue('body',event.target.value),'data-testid':'skills-form-body'})),
        h(Switch,{label:skillsT('invocationModel'),checked:values.modelInvocable,onChange:event=>setValue('modelInvocable',event.target.checked),'data-testid':'skills-form-model'}),
        h(Switch,{label:skillsT('invocationUser'),checked:values.userInvocable,onChange:event=>setValue('userInvocable',event.target.checked),'data-testid':'skills-form-user'}),
        h(Field,{label:t('skillsScope'),hint:values.scope==='project'?t('skillsScopeProjectHint'):t('skillsScopeUserHint')},
          h(Select,{name:'scope',disabled:!add,value:values.scope,onChange:event=>setValue('scope',event.target.value),'data-testid':'skills-form-scope'},
            h('option',{value:'user'},t('skillsScopeUser')),
            projectRoot!==null||values.scope==='project'?h('option',{value:'project'},t('skillsScopeProject')):null),
          scopeRoot===null?null:h('p',{className:'omni-ui-hint'},h('code',{className:'omni-ui-mono','data-testid':'skills-form-scope-path'},scopeRoot)),
          values.scope==='project'?h('p',{className:'omni-ui-hint','data-testid':'skills-form-scope-note'},skillsT('scopeProjectNote')):null,
          add&&projectRoot===null?h('p',{className:'omni-ui-hint','data-testid':'skills-form-scope-unavailable'},skillsT('scopeProjectUnavailable')):null),
        document!==null&&typeof document.path==='string'&&document.path.length>0?h(KeyValueList,{items:[{label:skillsT('path'),value:document.path,mono:true,copy:document.path,copyLabel:skillsT('copyPath'),copiedLabel:skillsT('copiedPath'),'data-value-testid':'skills-form-path'}]}):null,
        saveIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'skills-save-failure'},
          h(StatusLine,{tone:'warn',role:'alert','data-testid':'skills-save-error'},saveIssue.sentence),
          h(Disclosure,{'data-testid':'skills-save-raw',title:t('rawDetails')},h('pre',{className:'omni-ui-excerpt'},saveIssue.raw))),
        h(ActionGroup,null,
          h(Button,{variant:'primary',busy:savePhase==='saving',onClick:()=>{void submit();},'data-testid':'skills-form-save'},savePhase==='saving'?t('saving'):t('save')),
          h(Button,{variant:'ghost',onClick:closeForm,'data-testid':'skills-form-cancel'},t('cancel')))));
  };
  const skillsProviderWord=skill=>{
    const provider=typeof skill.provider==='string'&&skill.provider.length>0?skill.provider:null;
    if(provider===null)return null;
    return provider==='runtime'?skillsT('providerRuntime'):provider==='filesystem'?skillsT('providerFilesystem'):provider;
  };
  const sourceWord=skill=>{
    const source=typeof skill.source==='string'&&skill.source.length>0?skill.source:null;
    if(source===null)return null;
    const key=SOURCE_WORDS.get(source);
    return key===undefined?source:skillsT(key);
  };
  // One fact, one badge word: the scope when the skill has one, otherwise its provider (ADR-051).
  const skillsBadgeWord=skill=>{const scope=sourceWord(skill);return scope!==null?scope:skillsProviderWord(skill);};
  // ADR-051: every skill row carries exactly one badge in its title row. The scope wins (deleting a project
  // skill is not the same loss as a user skill); a runtime-provided skill has no scope, so its provider stands
  // in — a row must never read as "badgeless", because then the badge stops meaning anything.
  const skillsBadge=skill=>{
    const word=skillsBadgeWord(skill);
    if(word===null)return null;
    const scope=sourceWord(skill);
    return scope!==null
      ?h(Badge,{key:'source',tone:'muted','data-testid':'skills-source-'+skill.name},word)
      :h(Badge,{key:'provider',tone:'muted','data-testid':'skills-provider-'+skill.name},word);
  };
  // ADR-049 D1/D2: a badge carries the fact with consequences (scope: deleting a project skill is not the
  // same loss as a user skill); provider and invocation are background and read as one grey meta line.
  const skillsMeta=skill=>{
    const name=String(skill.name);
    const providerWord=skillsProviderWord(skill);
    const model=skill.modelInvocable===true,user=skill.userInvocable===true;
    const parts=[];
    // The provider is the badge when the skill has no scope; showing it twice would make the badge look like noise.
    if(providerWord!==null&&skillsBadgeWord(skill)!==providerWord)parts.push(h('span',{key:'provider','data-testid':'skills-provider-'+name},providerWord));
    if(!model&&!user)parts.push(h('span',{key:'none','data-testid':'skills-invocation-none-'+name},skillsT('invocationNone')));
    if(model)parts.push(h('span',{key:'model','data-testid':'skills-model-'+name},skillsT('invocationModel')));
    if(user)parts.push(h('span',{key:'user','data-testid':'skills-user-'+name},skillsT('invocationUser')));
    return h('span',{'data-testid':'skills-meta-'+name},parts.flatMap((part,index)=>index===0?[part]:[' · ',part]));
  };
  const row=skill=>{
    const name=String(skill.name);
    const path=typeof skill.path==='string'&&skill.path.length>0?skill.path:null;
    const when=typeof skill.whenToUse==='string'&&skill.whenToUse.length>0?skill.whenToUse:null;
    const writable=skillWritable(skill);
    const source=typeof skill.source==='string'?skill.source:'';
    const readOnlyReason=SKILLS_PACKAGED_SOURCES.has(source)?'skillsBundled':'skillsManagedElsewhere';
    const facts=[
      {label:t('providerLabel'),value:typeof skill.provider==='string'?skill.provider:'',mono:true},
      {label:t('sourceLabel'),value:typeof skill.source==='string'?skill.source:'',mono:true},
    ];
    return h(ListRow,{
      key:name,
      'data-testid':'skills-row-'+name,
      title:name,
      badge:skillsBadge(skill),
      meta:skillsMeta(skill),
      description:skill.description,
      actions:h(ActionGroup,null,
        writable?h(Button,{variant:'ghost',busy:opening===name,onClick:()=>{void openEdit(skill);},'data-testid':'skills-edit-'+name},t('edit')):null,
        h(Button,{variant:'danger-ghost',disabled:!writable,busy:removing===name,onClick:()=>askRemove(skill),'data-testid':'skills-delete-'+name},t('remove')),
        writable?null:h('span',{className:'omni-ui-hint','data-testid':'skills-readonly-'+name},t(readOnlyReason))),
    },
      h('div',{className:'omni-ui-listFacts','data-testid':'skills-facts-zone-'+name},
      when===null?null:h('p',{className:'omni-ui-hint','data-testid':'skills-when-'+name},t('whenToUse')+': '+when),
      path===null?null:h(KeyValueList,{items:[{
        label:skillsT('path'),
        value:path,
        mono:true,
        copy:path,
        copyLabel:skillsT('copyPath'),
        copiedLabel:skillsT('copiedPath'),
        'data-value-testid':'skills-path-'+name,
      }]}),
      h(Disclosure,{'data-testid':'skills-details-'+name,title:t('details')},
        h(KeyValueList,{'data-testid':'skills-facts-'+name,items:facts}))));
  };
  if(form!==null&&values!==null)return formSection();
  return h('section',{className:'omni-ui-stack','data-testid':'skills-section','aria-label':t('title')},
    h('ul',{className:'omni-ui-list','data-testid':'skills-summary'},
      h(ListRow,{'data-testid':'skills-status-row',title:summary,
        actions:h(ActionGroup,null,receipt,h(Button,{'data-testid':'skills-refresh',busy,onClick:()=>start()},busy?t('refreshing'):t('refresh')))})),
    h('div',{className:'omni-ui-toolbar','data-testid':'skills-toolbar'},
      h(SearchInput,{
        name:'skills-filter',
        'aria-label':skillsT('filterLabel'),
        placeholder:skillsT('filterPlaceholder'),
        value:filter,
        onChange:event=>setFilter(event.target.value),
        'data-testid':'skills-filter',
      }),
      h(Button,{onClick:openAdd,'data-testid':'skills-create'},t('skillsCreate'))),
    sentence===null?null:h('div',{className:'omni-ui-stack','data-testid':'skills-failure-block'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'skills-failure'},sentence),
      h(Disclosure,{'data-testid':'skills-failure-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},slot.issue.raw))),
    actionIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'skills-action-failure'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'skills-action-error'},actionIssue.sentence),
      h(Disclosure,{'data-testid':'skills-action-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},actionIssue.raw))),
    visible.length===0?null:h('ul',{className:'omni-ui-list','data-testid':'skills-list'},visible.map(row)),
    catalog!==null&&visible.length===0&&slot.complete===true&&sentence===null?h('div',{'data-testid':'skills-empty'},
      h(EmptyState,{title:skillsT('emptyTitle'),description:skillsT('emptyDescription')})):null,
    catalog!==null&&slot.complete===false&&sentence===null?h(StatusLine,{tone:'warn','data-testid':'skills-incomplete'},skillsT('incomplete')):null);
}
/**
 * The MCP tab: the MCP servers this profile configures, as one management list.
 *
 * The 0.1.4/0.1.5 flat tool wall is gone (ADR-025 D4): hundreds of model-facing tool names had no reading
 * value. A row carries the server facts only — name (mono), transport, state and the number of tools the
 * server currently contributes. Row identity is the Loader/patch rowId, never a name parsed back out of a
 * public tool name (ADR-024 correction 2).
 *
 * Add and edit replace the list with one in-page form (SheetHead returns, no second modal) because a modal
 * over a page whose only content is the list would hide the list it edits. Credential values are write-only:
 * the form starts from counts, never from plaintext, omits headers/env entirely unless the user resets them,
 * and a reset submits the complete list the user typed. Editing never shows or asks for the row's plugin
 * package — the Host derives that from the profile.
 */
function McpTab(props){
  const t=props.t,slot=props.panel,start=props.start;
  const mutate=props.mutate;
  const busy=slot.phase==='loading';
  const catalog=slot.data;
  const servers=catalog!==null&&catalog!==undefined&&Array.isArray(catalog.servers)?catalog.servers:[];
  // ADR-094 D4：官方 manager 在场时，托管行与套件自有客户端是两类事实，列表按来源分开；
  // 没有官方 manager（rc.1）时保持原来的单列表，页面不凭空多出两个分区。
  const authority=catalog!==null&&catalog!==undefined&&catalog.authority==='official'?'official':'rows';
  const officialRows=servers.filter(server=>server.managed===true);
  const ownRows=servers.filter(server=>server.managed!==true);
  const sentence=mcpSentence(t,slot.issue);
  const summary=catalog===null?t('summaryPending'):fill(t('mcpServersSummary'),{
    servers:servers.length,
    running:servers.filter(server=>server.state==='running').length,
    tools:servers.reduce((total,server)=>total+(Number.isFinite(server.toolCount)?server.toolCount:0),0),
  });
  const receipt=slot.lastRead===null?null:h('span',{className:'omni-ui-hint','data-testid':'mcp-checked'},fill(t('checkedAt'),{time:slot.lastRead}));
  const [form,setForm]=React.useState(null);
  const [values,setValues]=React.useState(null);
  const [savePhase,setSavePhase]=React.useState('idle');
  const [saveIssue,setSaveIssue]=React.useState(null);
  const [deleteIssue,setDeleteIssue]=React.useState(null);
  const [removing,setRemoving]=React.useState(null);
  const [probing,setProbing]=React.useState(null);
  const [probeIssue,setProbeIssue]=React.useState(null);
  const [runtimeOverrides,setRuntimeOverrides]=React.useState({});
  const [migrating,setMigrating]=React.useState(false);
  const [migrationIssue,setMigrationIssue]=React.useState(null);
  const [migratingClients,setMigratingClients]=React.useState(false);
  const [clientsIssue,setClientsIssue]=React.useState(null);
  const [clientsReceipt,setClientsReceipt]=React.useState(null);
  // One OAuth session at a time: the pasted code lives here only until the submit succeeds, and a catalog read
  // (the page's own refresh) drops it rather than keeping a credential-shaped value in long-lived state.
  const [oauthSession,setOauthSession]=React.useState(null);
  // ADR-032: the Host owns the purpose snapshot; this page keeps only the edit buffer, the busy row and the
  // last refusal. A write answer replaces the local snapshot facts directly — the page never re-reads the disk.
  const [purposeSnapshot,setPurposeSnapshot]=React.useState(null);
  const purposeSnapshotRef=React.useRef(null);
  const [purposeEditing,setPurposeEditing]=React.useState(null);
  const [purposeDraft,setPurposeDraft]=React.useState('');
  const [purposeBusy,setPurposeBusy]=React.useState(null);
  const [purposeIssue,setPurposeIssue]=React.useState(null);
  const purposeRowRefs=React.useRef(new Map());
  const purposeFocusReturn=React.useRef(null);
  const confirmRef=React.useRef(null);
  // A probe result is the row's newest connection fact until the next list read replaces the catalog: keep the
  // override in immutable state, never by mutating the row object the registration store handed us.
  const catalogRef=React.useRef(catalog);
  // ADR-052 D3: one bounded timer owns the OAuth wait. The generation token makes every late answer
  // (a poll that was already in flight when the wait stopped) a no-op, so a cancelled, completed or
  // unmounted wait can neither schedule another read nor land a stale sentence or toast.
  const oauthPollTimer=React.useRef(null);
  const oauthPollToken=React.useRef(0);
  const oauthSessionRef=React.useRef(null);
  React.useEffect(()=>{oauthSessionRef.current=oauthSession;},[oauthSession]);
  const stopOauthWait=()=>{
    oauthPollToken.current+=1;
    if(oauthPollTimer.current!==null){clearTimeout(oauthPollTimer.current);oauthPollTimer.current=null;}
  };
  // Leaving the tab/panel unmounts this component: a background poll must never outlive its page. Clearing the
  // timer is not enough — a read already in flight returns to a live closure whose session ref still points at
  // the old session, so it would schedule the next round for a page that no longer exists. Bumping the generation
  // is what turns that answer into a no-op (review B3).
  React.useEffect(()=>()=>{stopOauthWait();},[]);
  // ADR-046 task-72: when a purpose editor closes, return keyboard focus to the value button that opened it.
  // The trigger is re-rendered by this same state transition, so the effect reads the row after commit.
  React.useEffect(()=>{
    const id=purposeFocusReturn.current;
    if(id===null||purposeEditing!==null)return;
    purposeFocusReturn.current=null;
    const row=purposeRowRefs.current.get(id);
    const button=row===undefined?null:row.querySelector('[data-testid="mcp-purpose-edit-'+id+'"]');
    if(button!==null&&typeof button.focus==='function')button.focus();
  },[purposeEditing]);
  React.useEffect(()=>{
    if(catalogRef.current!==catalog){
      catalogRef.current=catalog;
      setRuntimeOverrides({});
      // The row set changed underneath the wait, so the session it belonged to is gone with it.
      stopOauthWait();
      setOauthSession(null);
    }
  },[catalog]);
  React.useEffect(()=>{
    const answered=slot.purposes===undefined?null:slot.purposes;
    if(answered!==purposeSnapshotRef.current){
      purposeSnapshotRef.current=answered;
      setPurposeSnapshot(answered);
    }
  },[slot.purposes]);
  const runtimeOf=server=>Object.prototype.hasOwnProperty.call(runtimeOverrides,String(server.rowId))?runtimeOverrides[String(server.rowId)]:server.runtime;
  // The local snapshot wins until the next Host read hands over a new object: a write answer is fresher than
  // the registration store's last read, and the sync effect above adopts every genuinely new read.
  const purposes=purposeSnapshot??slot.purposes;
  const purposesIssue=slot.purposesIssue??null;
  const purposesUnreadable=purposes!==null&&purposes.unreadable!==null&&purposes.unreadable!==undefined;
  const purposeTextOf=rowId=>purposes!==null&&purposes.purposes!==null&&typeof purposes.purposes[rowId]==='string'?purposes.purposes[rowId]:'';
  const upgradableCount=servers.filter(server=>server.upgradable===true).length;
  // ADR-033 D4: rows still loading a historical external package. The Host labels them (clientSource); this page
  // never keeps its own package-name list.
  const legacyRows=servers.filter(server=>server.clientSource==='external-legacy');
  const legacyCount=legacyRows.length;
  // A host confirm layer outlives this component; the owner closes it so a tab switch cannot leave it behind.
  React.useEffect(()=>()=>{if(confirmRef.current!==null){confirmRef.current.close();confirmRef.current=null;}},[]);
  const setValue=(key,value)=>setValues(current=>current===null?current:{...current,[key]:value});
  const updatePair=(kind,index,key,value)=>setValues(current=>current===null?current:{...current,[kind]:current[kind].map((pair,position)=>position===index?{...pair,[key]:value}:pair)});
  const addPair=kind=>setValues(current=>current===null?current:{...current,[kind]:[...current[kind],{key:'',value:''}]});
  const removePair=(kind,index)=>setValues(current=>current===null?current:{...current,[kind]:current[kind].filter((_,position)=>position!==index)});
  const closeForm=()=>{setForm(null);setValues(null);setSaveIssue(null);setSavePhase('idle');};
  const openAdd=()=>{
    setDeleteIssue(null);setSaveIssue(null);
    setValues({
      name:'',kind:'static',transport:'streamable-http',url:'',command:'',args:'',cwd:'',timeoutMs:'',
      staticClientId:'',authTimeoutMs:'',
      endpointOpen:true,
      // ADR-055: a fresh row starts with `failOnStartupError` on — a server that cannot start should say so on
      // the row instead of looking healthy with no tools.
      failOnStartupError:true,failDirty:false,
      // 新增的官方条目默认启用；编辑时才显示并只在改动后提交。
      enabled:true,enabledDirty:false,
      // ADR-055 tri-state: 'keep' sends nothing, 'clear' sends an empty list, 'replace' sends the typed rows.
      headersMode:'keep',envMode:'keep',headers:[{key:'',value:''}],env:[{key:'',value:''}],
    });
    setForm({mode:'add',server:null});
  };
  const openEdit=server=>{
    setDeleteIssue(null);setSaveIssue(null);
    setValues({
      name:typeof server.name==='string'?server.name:'',
      // The kind is the row's own client fact; an edit never sends it, but the form reads it to decide whether
      // the transport may still be changed at all.
      kind:server.kind==='oauth'?'oauth':'static',
      transport:server.transport==='stdio'?'stdio':'streamable-http',
      // An HTTP endpoint is never echoed (a URL may carry a credential): the section starts collapsed and an
      // empty buffer submits nothing. A stdio launch line is *not* a secret (ADR-055), so a stdio row echoes
      // its command, arguments and working directory — that is the only way the user can see what is configured.
      url:'',command:typeof server.command==='string'?server.command:'',
      args:Array.isArray(server.args)?server.args.join('\n'):'',
      cwd:typeof server.cwd==='string'?server.cwd:'',
      timeoutMs:'',
      staticClientId:typeof server.staticClientId==='string'?server.staticClientId:'',
      authTimeoutMs:typeof server.authorizationTimeoutMs==='number'?String(server.authorizationTimeoutMs):'',
      // A stdio row arrives with its launch line already filled in, so the section opens where the values are.
      endpointOpen:false,
      failOnStartupError:typeof server.failOnStartupError==='boolean'?server.failOnStartupError:false,failDirty:false,
      enabled:server.enabled!==false,enabledDirty:false,
      headersMode:'keep',envMode:'keep',headers:[{key:'',value:''}],env:[{key:'',value:''}],
    });
    setForm({mode:'edit',server});
  };
  const buildDraft=()=>{
    const draft={name:String(values.name).trim()};
    // ADR-033 D1: the kind picks which carried client the Host writes; an edit keeps the row's existing client
    // and its transport, so neither key is named by an edit — the row is the fact (0.2.0-5 key-set rule).
    if(form.mode==='add'){draft.kind=values.kind==='oauth'?'oauth':'static';draft.transport=values.transport;}
    // A collapsed endpoint sends no url/command/args/cwd, so the Host keeps the existing values untouched.
    if(form.mode==='add'||values.endpointOpen){
      // "Blank submits nothing": an opened-but-empty endpoint field keeps the existing endpoint instead of
      // overwriting it with an empty string (the same rule the credential blocks follow).
      if(values.transport==='streamable-http'){
        const url=String(values.url).trim();
        if(url.length>0)draft.url=url;
      }else{
        const command=String(values.command).trim();
        if(command.length>0)draft.command=command;
        const args=String(values.args).split('\n').map(line=>line.trim()).filter(line=>line.length>0);
        if(args.length>0)draft.args=args;
        const cwd=String(values.cwd).trim();
        if(cwd.length>0)draft.cwd=cwd;
      }
    }
    const timeoutText=String(values.timeoutMs).trim();
    if(timeoutText.length>0){
      const timeout=Number(timeoutText);
      if(Number.isFinite(timeout)&&timeout>0)draft.toolCallTimeoutMs=timeout;
    }
    // An untouched switch must not overwrite a value this page cannot see; only a known or user-set value is sent.
    // 官方目标（新增 static 落 config.servers，或编辑 managed 行）没有该字段，连草稿都不命名。
    const officialTarget=form.mode==='add'
      ?(authority==='official'&&values.kind!=='oauth')
      :form.server!==null&&form.server.managed===true;
    if(!officialTarget&&(form.mode==='add'||values.failDirty||typeof form.server?.failOnStartupError==='boolean'))draft.failOnStartupError=values.failOnStartupError;
    // 官方条目的 durable enabled：只在用户动过开关时命名，避免把未见的并发改动写回去。
    if(form.mode==='edit'&&form.server!==null&&form.server.managed===true&&values.enabledDirty)draft.enabled=values.enabled;
    // ADR-055 tri-state, one rule for both fields: 'keep' names nothing (the Host leaves the stored object
    // alone), 'clear' names an empty list (the Host writes `{}`), 'replace' names exactly the typed rows.
    // A named empty list means *clear*, so 'replace' with every row blank is the same request as 'clear'.
    for(const kind of ['headers','env']){
      if(values.kind==='oauth')continue;
      const mode=values[kind+'Mode'];
      if(mode==='clear')draft[kind]=[];
      else if(mode==='replace')draft[kind]=pairList(values[kind]);
    }
    // OAuth-only optional facts (0.2.0-5): a pre-registered client ID for services without dynamic registration,
    // and how long the client waits for the browser authorization. "Naming is changing": a blank field is not a
    // value, and in an edit an unchanged field is not named either — the Host keeps what it already stored.
    if(values.kind==='oauth'){
      const knownClientId=form.mode==='edit'&&form.server!==null&&typeof form.server.staticClientId==='string'?form.server.staticClientId:'';
      const clientId=String(values.staticClientId).trim();
      if(clientId.length>0&&clientId!==knownClientId)draft.staticClientId=clientId;
      const knownAuthTimeout=form.mode==='edit'&&form.server!==null&&typeof form.server.authorizationTimeoutMs==='number'?String(form.server.authorizationTimeoutMs):'';
      const authText=String(values.authTimeoutMs).trim();
      if(authText.length>0){
        // The page decides only "blank = unnamed". A non-blank value travels as the user typed it: numeric text as
        // a number (0/negative/out-of-range included), anything else verbatim, so the Host's own validation
        // answers with a readable mcp/draft-invalid instead of the page silently dropping the input.
        const authNumber=Number(authText);
        const authValue=Number.isFinite(authNumber)?authNumber:authText;
        if(knownAuthTimeout===''||String(authValue)!==knownAuthTimeout)draft.authorizationTimeoutMs=authValue;
      }
    }
    return draft;
  };
  const announce=(mutation,fallbackName,actionKey)=>{
    const action=t(actionKey);
    const state=mutation&&mutation.applied==='live'?t('mcpApplied'):t('mcpPending');
    const name=mutation&&typeof mutation.name==='string'?mutation.name:String(fallbackName);
    showToast({text:fill(t('mutationToast'),{action,state,name}),kind:'mcp-mutation',closeLabel:t('closeToast')});
  };
  const submit=async()=>{
    if(savePhase==='saving'||form===null)return;
    setSavePhase('saving');setSaveIssue(null);
    try{
      const draft=buildDraft();
      const mutation=form.mode==='add'
        ?await mutate('addMcpServer',draft)
        :await mutate('updateMcpServer',String(form.server.rowId),draft);
      announce(mutation,values.name,form.mode==='add'?'mcpAdded':'mcpUpdated');
      closeForm();
      start();
    }catch(failed){
      setSaveIssue({sentence:mcpDraftInvalidSentence(t,failed)??mcpMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setSavePhase('idle');
    }
  };
  const remove=async server=>{
    setDeleteIssue(null);setRemoving(String(server.rowId));
    try{
      const mutation=await mutate('removeMcpServer',String(server.rowId));
      announce(mutation,server.name,'mcpRemoved');
      start();
    }catch(failed){
      setDeleteIssue({sentence:mcpMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setRemoving(null);
    }
  };
  const probe=async server=>{
    const id=String(server.rowId);
    if(probing!==null)return;
    setProbeIssue(null);setProbing(id);
    try{
      const result=await mutate('probeMcpServer',id);
      const runtime=result!==null&&typeof result==='object'&&result.runtime!==null&&typeof result.runtime==='object'?result.runtime:null;
      setRuntimeOverrides(current=>({...current,[id]:runtime}));
      if(runtime===null){
        showToast({text:t('mcpProbeNoAnswer'),kind:'mcp-probe',closeLabel:t('closeToast')});
      }else{
        const key=MCP_RUNTIME_KEYS.get(runtime.state)??'mcpRuntimeNotConnected';
        showToast({text:fill(t('mcpProbeDone'),{state:t(key)}),kind:'mcp-probe',closeLabel:t('closeToast')});
      }
    }catch(failed){
      setProbeIssue({sentence:mcpActionSentence(t,failed,'mcpProbeFailed'),raw:mutationRaw(failed)});
    }finally{
      setProbing(null);
    }
  };
  const migrate=async()=>{
    if(migrating)return;
    setMigrationIssue(null);setMigrating(true);
    try{
      const result=await mutate('migrateMcpServers');
      const changed=result!==null&&typeof result==='object'&&result.changed===true;
      const count=changed&&Array.isArray(result.rows)?result.rows.length:upgradableCount;
      showToast({text:changed?fill(t('mcpMigrateDone'),{count}):t('mcpMigrateNoop'),kind:'mcp-migration',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      setMigrationIssue({sentence:mcpActionSentence(t,failed,'mcpMigrationFailed'),raw:mutationRaw(failed)});
    }finally{
      setMigrating(false);
    }
  };
  const askMigrate=()=>{
    if(confirmRef.current!==null)confirmRef.current.close();
    confirmRef.current=showConfirm({
      title:t('mcpMigrateTitle'),
      text:fill(t('mcpMigrateText'),{count:upgradableCount}),
      cancelLabel:t('cancel'),
      confirmLabel:t('mcpMigrateConfirm'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;void migrate();},
    });
  };
  const migrateClients=async()=>{
    if(migratingClients)return;
    setClientsIssue(null);setClientsReceipt(null);setMigratingClients(true);
    try{
      const result=await mutate('migrateMcpClients');
      const changed=result!==null&&typeof result==='object'&&result.changed===true;
      const count=changed&&Array.isArray(result.rows)?result.rows.length:legacyCount;
      if(changed){
        // The backup is a technical fact: it goes to the disclosure, never to the receipt sentence.
        setClientsReceipt({backupPath:typeof result.backupPath==='string'&&result.backupPath.length>0?result.backupPath:null});
        showToast({text:fill(t('mcpMigrateClientsDone'),{count}),kind:'mcp-clients-migration',closeLabel:t('closeToast')});
      }else{
        showToast({text:t('mcpMigrateClientsNoop'),kind:'mcp-clients-migration',closeLabel:t('closeToast')});
      }
      start();
    }catch(failed){
      setClientsIssue({sentence:mcpActionSentence(t,failed,'mcpClientsMigrationFailed'),raw:mutationRaw(failed)});
    }finally{
      setMigratingClients(false);
    }
  };
  const askMigrateClients=()=>{
    if(migratingClients)return;
    if(confirmRef.current!==null)confirmRef.current.close();
    confirmRef.current=showConfirm({
      title:t('mcpMigrateClientsTitle'),
      text:fill(t('mcpMigrateClientsText'),{count:legacyCount}),
      cancelLabel:t('cancel'),
      confirmLabel:t('mcpMigrateClientsConfirm'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;void migrateClients();},
    });
  };
  /** ADR-052 D3: the wait is observed by a bounded poll of the read-only status, never by holding the login
   * request open. Each scheduled read carries the generation token, so a cancelled or completed wait cannot land
   * a stale sentence, toast or extra read. */
  const startOauthWait=(rowId,serverName,authorizationTimeoutMs)=>{
    stopOauthWait();
    const token=oauthPollToken.current;
    // ADR-052 D3: the budget is the row's own authorization timeout, not a fixed number of ticks. A row may be
    // configured up to 600000 ms, and a page that gave up after a hard-coded 300 s would stop watching while the
    // Host was still waiting — leaving the row busy with no cancel button and no poll (review S1).
    const deadline=Date.now()+mcpOauthWaitBudgetMs({authorizationTimeoutMs});
    let attempts=0;
    const expired=()=>Date.now()>=deadline;
    const schedule=()=>{
      oauthPollTimer.current=setTimeout(()=>{
        oauthPollTimer.current=null;
        void (async()=>{
          if(oauthPollToken.current!==token)return;
          attempts+=1;
          let view=null;
          let unreadable=null;
          try{view=await mcpOauthStatus(serverName);}catch(failed){unreadable=mutationRaw(failed);}
          if(oauthPollToken.current!==token)return;
          const current=oauthSessionRef.current;
          if(current===null||current.rowId!==rowId)return;
          if(unreadable!==null){
            // A read that failed is not a finished wait: one unreadable answer is retried inside the same budget,
            // and only the budget running out turns it into the row's sentence.
            if(expired()){
              setOauthSession(value=>value===null?value:{...value,waiting:false,phase:null,issue:{sentence:t('mcpOauthWaitUnreadable'),raw:unreadable}});
              return;
            }
            schedule();
            return;
          }
          const authorization=mcpAuthorizationOf(view);
          const status=mcpOauthStatusOf(view);
          if(status==='connected'){
            stopOauthWait();
            setOauthSession(null);
            showToast({text:t('mcpOauthConnected'),kind:'mcp-oauth',closeLabel:t('closeToast')});
            start();
            return;
          }
          if(authorization.state==='waiting'&&!expired()){schedule();return;}
          stopOauthWait();
          setOauthSession(value=>value===null?value:{...value,waiting:false,phase:null,issue:{
            sentence:t(authorization.state==='waiting'?'mcpOauthWaitTimeout':'mcpOauthIncomplete'),
            raw:'OAUTH_CONTROL status='+status+' authorization='+authorization.state+' attempts='+attempts}});
        })();
      },MCP_OAUTH_POLL_MS);
    };
    schedule();
  };
  const startOauthLogin=async server=>{
    const id=String(server.rowId);
    const serverName=String(server.name);
    // One interaction at a time: while a session exists (starting, waiting, awaiting the code, submitting,
    // signing out) the page never starts a second control-plane interaction.
    if(oauthSession!==null)return;
    stopOauthWait();
    setOauthSession({rowId:id,serverName,authorizationUrl:null,prefer:null,waiting:false,code:'',phase:'starting',issue:null});
    try{
      // ADR-052 D1/D3: ask for the auto flow and defer the wait. The Host resolves auto to loopback on a GUI
      // platform (it opens the listener and the browser) and answers at once; only a no-GUI host resolves to
      // paste, and only then does this page offer the code box.
      const view=await mcpOauthPost(serverName,'login',{prefer:'auto',deferWait:true});
      const authorization=mcpAuthorizationOf(view);
      if(authorization.authorizationUrl===null)throw failure('answer','OAUTH_CONTROL login answered without an authorizationUrl');
      const waiting=authorization.state==='waiting';
      setOauthSession({rowId:id,serverName,authorizationUrl:authorization.authorizationUrl,prefer:authorization.prefer,waiting,code:'',phase:null,issue:null});
      if(waiting)startOauthWait(id,serverName,server.authorizationTimeoutMs);
    }catch(failed){
      setOauthSession({rowId:id,serverName,authorizationUrl:null,prefer:null,waiting:false,code:'',phase:null,issue:{sentence:t('mcpOauthLoginFailed'),raw:mutationRaw(failed)}});
    }
  };
  /** ADR-052 D2: cancel ends the Host's wait (it closes the loopback listener and writes the tombstone) and the
   * row returns to an actionable needs_login. The button never guesses: a refusal is shown with its raw reason. */
  const cancelOauthLogin=async()=>{
    const session=oauthSession;
    if(session===null||session.phase!==null)return;
    setOauthSession({...session,phase:'cancelling',issue:null});
    stopOauthWait();
    try{
      await mcpOauthPost(session.serverName,'cancel',{});
      setOauthSession(null);
      showToast({text:t('mcpOauthCancelled'),kind:'mcp-oauth',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      setOauthSession(current=>current===null?current:{...current,phase:null,waiting:false,issue:{sentence:t('mcpOauthCancelFailed'),raw:mutationRaw(failed)}});
    }
  };
  const submitOauthCode=async()=>{
    const session=oauthSession;
    if(session===null||session.phase!==null)return;
    const code=String(session.code).trim();
    if(code.length===0)return;
    setOauthSession({...session,phase:'submitting',issue:null});
    try{
      await mcpOauthPost(session.serverName,'submit',{code});
      // The code is dropped with the session: success is the only moment the page still held it.
      setOauthSession(null);
      showToast({text:t('mcpOauthSubmitted'),kind:'mcp-oauth',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      const raw=mcpRedactCode(mutationRaw(failed),code);
      setOauthSession(current=>current===null?current:{...current,phase:null,issue:{sentence:t('mcpOauthSubmitFailed'),raw}});
    }
  };
  const logoutOauth=async server=>{
    const id=String(server.rowId);
    if(oauthSession!==null)return;
    setOauthSession({rowId:id,serverName:String(server.name),authorizationUrl:null,code:'',phase:'logging-out',issue:null});
    try{
      await mcpOauthPost(String(server.name),'logout',{});
      setOauthSession(null);
      showToast({text:t('mcpOauthLoggedOut'),kind:'mcp-oauth',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      setOauthSession({rowId:id,serverName:String(server.name),authorizationUrl:null,code:'',phase:null,issue:{sentence:t('mcpOauthLogoutFailed'),raw:mutationRaw(failed)}});
    }
  };
  /** A write answer carries the new snapshot facts; apply them instead of guessing or re-reading. */
  const applyPurposeFacts=value=>{
    if(!value||typeof value!=='object')return;
    const next={
      routing:value.routing===true,
      revision:Number.isFinite(value.revision)?value.revision:(purposes!==null?purposes.revision:0),
      purposes:value.purposes&&typeof value.purposes==='object'?value.purposes:{},
      servers:purposes!==null&&Array.isArray(purposes.servers)?purposes.servers:[],
      unreadable:null,
    };
    purposeSnapshotRef.current=next;
    setPurposeSnapshot(next);
  };
  /** Conflict and unknown-key answers name a stale revision: ask the Host for the current snapshot (still the
   * in-memory one), never re-read the file. */
  const reloadPurposes=async()=>{
    try{
      const value=await mutate(MCP_PURPOSES_METHOD);
      if(!value||typeof value!=='object'||typeof value.routing!=='boolean')throw failure('answer','SUITE_RESULT_INVALID '+MCP_PURPOSES_METHOD+' answered without a purpose snapshot');
      purposeSnapshotRef.current=value;
      setPurposeSnapshot(value);
    }catch(failed){
      setPurposeIssue({sentence:t('mcpPurposeReadFailed'),raw:mutationRaw(failed)});
    }
  };
  const savePurpose=async(rowId,explicit)=>{
    if(purposes===null||purposesUnreadable||purposeBusy!==null)return;
    const purpose=(explicit===undefined?String(purposeDraft):String(explicit)).trim();
    setPurposeBusy(rowId);setPurposeIssue(null);
    try{
      const value=await mutate(MCP_PURPOSE_WRITE,{rowId,purpose,expectedRevision:purposes.revision});
      applyPurposeFacts(value);
      setPurposeEditing(null);setPurposeDraft('');
      showToast({text:purpose.length===0?t('mcpPurposeCleared'):t('mcpPurposeSaved'),kind:'mcp-purpose',closeLabel:t('closeToast')});
    }catch(failed){
      if(mcpPurposeRefreshable(failed))await reloadPurposes();
      setPurposeIssue({rowId,sentence:mcpPurposeSentence(t,failed),raw:mutationRaw(failed)});
    }finally{setPurposeBusy(null);}
  };
  const saveRouting=async next=>{
    if(purposes===null||purposesUnreadable||purposeBusy!==null)return;
    setPurposeBusy('routing');setPurposeIssue(null);
    try{
      // An explicit off is the routing:false fact; nothing else in the section changes.
      const value=await mutate(MCP_ROUTING_WRITE,{routing:next===true,expectedRevision:purposes.revision});
      applyPurposeFacts(value);
      showToast({text:t('mcpRoutingSaved'),kind:'mcp-routing',closeLabel:t('closeToast')});
    }catch(failed){
      if(mcpPurposeRefreshable(failed))await reloadPurposes();
      setPurposeIssue({sentence:mcpPurposeSentence(t,failed),raw:mutationRaw(failed)});
    }finally{setPurposeBusy(null);}
  };
  const askRemove=server=>{
    if(confirmRef.current!==null)confirmRef.current.close();
    const loaded=server.origin==='loaded';
    confirmRef.current=showConfirm({
      title:t('mcpDeleteTitle'),
      text:fill(loaded?t('mcpDeleteTextLoaded'):t('mcpDeleteTextProfile'),{name:String(server.name)}),
      cancelLabel:t('cancel'),
      confirmLabel:t('remove'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;void remove(server);},
    });
  };
  const row=server=>{
    const id=String(server.rowId);
    const runtime=runtimeOf(server);
    const transport=server.transport==='streamable-http'?t('mcpTransportHttp'):server.transport==='stdio'?t('mcpTransportStdio'):String(server.transport);
    const kindWord=server.kind==='oauth'?t('mcpKindOauth'):t('mcpKindStatic');
    // Connection state replaces the Loader word only while the row is actually running/failed and the client
    // published a status face; a disabled/pending row keeps the four Loader words and shows no connection state.
    const connected=(server.state==='running'||server.state==='failed')&&runtime!==null&&runtime!==undefined;
    const stateKey=MCP_STATE_KEYS.get(server.state);
    let stateWord;
    let stateTone;
    if(connected){
      if(server.state==='failed'){
        // ADR-034 D3: a failed row says it failed. A stale status face (e.g. still 'connected' from before the
        // failure) must not re-word the row as healthy — one fact, one word.
        stateTone='err';
        stateWord=t('mcpRuntimeFailed');
      }else{
        stateTone=MCP_RUNTIME_TONES.get(runtime.state)??'warn';
        // The connection word never carries a count: the row keeps exactly one tool count, the Loader badge below.
        stateWord=t(MCP_RUNTIME_KEYS.get(runtime.state)??'mcpRuntimeNotConnected');
      }
    }else{
      stateWord=stateKey===undefined?String(server.state):t(stateKey);
      stateTone=MCP_STATE_TONES.get(server.state)??'muted';
    }
    const protocol=mcpProtocolOf({...server,runtime});
    const count=Number.isFinite(server.toolCount)?server.toolCount:0;
    // Whether a row can run a user-triggered check is a Host fact (control face + HTTP row + loopback available).
    const probeable=server.probeAvailable===true;
    // One session belongs to one row: the paste panel and its busy states only render on the row that started it.
    const oauthRow=server.kind==='oauth';
    // The five OAuth controls are addressed by serverName (the G5 contract), not by the profile row id.
    const serverName=String(server.name);
    const session=oauthSession!==null&&oauthSession.rowId===id?oauthSession:null;
    const sessionBusy=session!==null&&session.phase!==null;
    const detail=[];
    // Only a running row can be missing its connection fact; a failed row already says 启动失败 and must not stack
    // a second failure-flavoured line on top (ADR-031 D4).
    if(connected&&runtime.state==='failed'&&typeof runtime.error==='string'&&runtime.error.length>0){
      detail.push(h(Disclosure,{key:'runtime-raw','data-testid':'mcp-runtime-raw-'+id,title:t('rawDetails')},h('pre',{className:'omni-ui-excerpt'},runtime.error)));
    }
    if(session!==null&&session.authorizationUrl!==null){
      const pasteOnly=session.prefer==='paste';
      detail.push(h('div',{key:'oauth-panel',className:'omni-ui-stack','data-testid':'mcp-login-panel-'+serverName},
        // ADR-052 D1/D3: the wait is the default. The sentence states what the page is doing (it checks by
        // itself) so the user is not told to paste a code that only the no-GUI downgrade ever asks for.
        session.waiting?h('p',{className:'omni-ui-hint','data-testid':'mcp-login-waiting-'+serverName},t('mcpOauthWaiting'))
          :pasteOnly?null
          :h('p',{className:'omni-ui-hint'},t('mcpOauthWaitingHint')),
        session.waiting?h('p',{className:'omni-ui-hint'},t('mcpOauthWaitingHint')):null,
        pasteOnly?h('p',{className:'omni-ui-hint'},t('mcpOauthPasteHint')):null,
        // The authorization URL is a real link (new window), never a copy-only affordance.
        h('p',{className:'omni-ui-hint'},h('a',{href:session.authorizationUrl,target:'_blank',rel:'noreferrer','data-testid':'mcp-login-url-'+serverName},session.authorizationUrl)),
        // The code box is the documented no-GUI downgrade only: with a live loopback wait there is nothing to paste.
        pasteOnly?h(Field,{label:t('mcpOauthCodeLabel'),hint:t('mcpOauthCodeHint')},
          h(TextInput,{name:'oauthCode',autoComplete:'off',value:session.code,disabled:sessionBusy,onChange:event=>setOauthSession(current=>current===null?current:{...current,code:event.target.value}),'data-testid':'mcp-login-code-'+serverName})):null,
        h(ActionGroup,null,
          session.waiting?h(Button,{variant:'ghost',busy:session.phase==='cancelling',disabled:sessionBusy&&session.phase!=='cancelling',onClick:()=>{void cancelOauthLogin();},'data-testid':'mcp-login-cancel-'+serverName},t('mcpOauthCancel')):null,
          pasteOnly?h(Button,{busy:session.phase==='submitting',disabled:sessionBusy||String(session.code).trim().length===0,onClick:()=>{void submitOauthCode();},'data-testid':'mcp-login-submit-'+serverName},t('mcpOauthSubmit')):null)));
    }
    if(session!==null&&session.issue!==null){
      detail.push(h('div',{key:'oauth-issue',className:'omni-ui-stack','data-testid':'mcp-login-failure-'+serverName},
        h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-login-error-'+serverName},session.issue.sentence),
        h(Disclosure,{'data-testid':'mcp-login-raw-'+serverName,title:t('rawDetails')},
          h('pre',{className:'omni-ui-excerpt'},session.issue.raw))));
    }
    // ADR-032: the purpose is one line per row. It renders once — either the stored value or the edit buffer —
    // and it renders at all only while the snapshot is readable. A broken or absent snapshot is not "no purpose":
    // the file cannot be trusted, so the row shows nothing here and the panel states the reason once, above.
    const purposeReadable=purposes!==null&&!purposesUnreadable;
    const purposeText=purposeTextOf(id);
    const startPurposeEdit=()=>{
      if(purposeBusy!==null)return;
      purposeFocusReturn.current=id;
      setPurposeEditing(id);setPurposeDraft(purposeText);
    };
    // ADR-046 / task-74: the design draft's "click anywhere on this row to start filling" is a pointer shortcut.
    // It is deliberately not a control: the row stays out of the tab order and the value button remains the only
    // keyboard path. Clicks inside an interactive child — row actions, an OAuth link/code box, a switch label or
    // a disclosure — keep their own behaviour and never open the purpose editor.
    const purposeRowClick=purposeReadable?event=>{
      if(purposeEditing!==null||purposeBusy!==null)return;
      const target=event.target;
      const control=target!==null&&typeof target.closest==='function'
        ?target.closest('button,a,input,select,textarea,label,summary,details,[role="button"],[role="tab"],[contenteditable="true"],.omni-ui-inlineEdit,.omni-ui-listActions,.omni-ui-disclosure')
        :null;
      if(control!==null)return;
      startPurposeEdit();
    }:undefined;
    if(purposeReadable){
      const purposeHere=purposeEditing===id;
      // 可见文案只算一次：可访问名必须**包含**可见标签（WCAG 2.5.3），所以两者由同一个串派生。
      const purposeShown=fill(t('mcpPurposeLine'),{text:purposeText.length>0?purposeText:t('mcpPurposeUnfilled')});
      detail.push(h('div',{key:'purpose',ref:node=>{if(node===null)purposeRowRefs.current.delete(id);else purposeRowRefs.current.set(id,node);},className:'omni-ui-stack','data-testid':'mcp-purpose-'+id},
        purposeHere
          ?h(React.Fragment,null,
            h(Field,{label:t('mcpPurpose'),hint:t('mcpPurposeHint')},
              h(TextInput,{name:'purpose',autoComplete:'off',maxLength:MCP_PURPOSE_MAX,value:purposeDraft,disabled:purposeBusy!==null,onChange:event=>setPurposeDraft(event.target.value),'data-testid':'mcp-purpose-input-'+id})),
            h(ActionGroup,null,
              h(Button,{variant:'primary',busy:purposeBusy===id,disabled:purposeBusy!==null,onClick:()=>{void savePurpose(id);},'data-testid':'mcp-purpose-save-'+id},t('save')),
              h(Button,{variant:'ghost',disabled:purposeBusy!==null,onClick:()=>{setPurposeEditing(null);setPurposeDraft('');},'data-testid':'mcp-purpose-cancel-'+id},t('cancel')),
              purposeText.length>0?h(Button,{variant:'ghost',disabled:purposeBusy!==null,onClick:()=>{void savePurpose(id,'');},'data-testid':'mcp-purpose-clear-'+id},t('mcpPurposeClear')):null))
          :h('div',{className:'omni-ui-valueLine','data-testid':'mcp-purpose-line-'+id},
            h(Button,{
              variant:'link',
              className:'omni-ui-valueText',
              'data-testid':'mcp-purpose-edit-'+id,
              'aria-label':fill(t('mcpPurposeEditValue'),{text:purposeShown}),
              onClick:startPurposeEdit,
            },h('span',{'data-testid':'mcp-purpose-text-'+id},purposeShown)),
            // 铅笔是**装饰**：22×22 的 span（不是 button），既没有第二套语义，也不会进 tab 顺序，
            // 更不会和 `.omni-ui-iconBtn` 抢同一组 width/height 声明（0.2.0-9 第 5 轮审查 B2）。鼠标点它等于点值。
            // 触屏没有 hover，所以由 `@media (hover:none)` 让它常显；键盘用值按钮。
            h('span',{className:'omni-ui-inlineEdit'},h('span',{
              className:'omni-ui-pencilBtn',
              'data-testid':'mcp-purpose-pencil-'+id,
              'aria-hidden':'true',
              onClick:startPurposeEdit,
            },PencilIcon())))));
    }
    if(purposeIssue!==null&&purposeIssue.rowId===id){
      detail.push(h('div',{key:'purpose-issue',className:'omni-ui-stack','data-testid':'mcp-purpose-failure-'+id},
        h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-purpose-error-'+id},purposeIssue.sentence),
        h(Disclosure,{'data-testid':'mcp-purpose-raw-'+id,title:t('rawDetails')},
          h('pre',{className:'omni-ui-excerpt'},purposeIssue.raw))));
    }
    // One grey line instead of five chips; each fact keeps its own testid so the gates can still read it.
    const mcpMeta=()=>{
      const parts=[
        h('span',{key:'transport','data-testid':'mcp-transport-'+id},transport),
        h('span',{key:'kind','data-testid':'mcp-kind-'+id},kindWord),
      ];
      if(protocol!==null)parts.push(h('span',{key:'protocol','data-testid':'mcp-protocol-'+id},t(protocol.key)));
      // ADR-046 task-71: no status face is one more meta fact, not a second line under the row.
      if(server.state==='running'&&(runtime===null||runtime===undefined))parts.push(h('span',{key:'runtime-none',className:'omni-ui-hint','data-testid':'mcp-runtime-none-'+id},t('mcpRuntimeNone')));
      // One count per row, always the Loader/tool-table fact; the connection word never repeats it.
      parts.push(h('span',{key:'tools','data-testid':'mcp-toolcount-'+id},fill(t('mcpToolCount'),{count})));
      return h('span',null,parts.flatMap((part,index)=>index===0?[part]:[' · ',part]));
    };
    return h(ListRow,{
      key:id,
      'data-testid':'mcp-server-'+id,
      onClick:purposeRowClick,
      title:h('span',{className:'omni-ui-mono','data-testid':'mcp-name-'+id},String(server.name)),
      // ADR-049 D1: one badge, and only for the fact with consequences (connection state). Transport, kind,
      // protocol and tool count are background: five equal-weight chips flattened "已连接" into the noise.
      badge:h(Badge,{key:'state',tone:stateTone,'data-testid':'mcp-state-'+id},stateWord),
      meta:mcpMeta(),
      children:detail.length>0?h('div',{className:'omni-ui-listFacts','data-testid':'mcp-facts-zone-'+id},detail):undefined,
      actions:h(ActionGroup,null,
        // ADR-034 D1: sign-in is offered whenever the client is not authorized (needs-login or a failed
        // attempt); an unknown runtime published no connection fact, so it offers no action at all.
        oauthRow&&runtime!==null&&runtime!==undefined&&(runtime.state==='needs-login'||runtime.state==='failed')?h(Button,{variant:'ghost',busy:session!==null,onClick:()=>{void startOauthLogin(server);},'data-testid':'mcp-login-'+serverName},t('mcpOauthLogin')):null,
        oauthRow&&runtime!==null&&runtime!==undefined&&runtime.state==='connected'?h(Button,{variant:'ghost',busy:sessionBusy&&session.phase==='logging-out',onClick:()=>{void logoutOauth(server);},'data-testid':'mcp-logout-'+serverName},t('mcpOauthLogout')):null,
        probeable?h(Button,{variant:'ghost',busy:probing===id,onClick:()=>{void probe(server);},'data-testid':'mcp-probe-'+id},t('mcpCheckConnection')):null,
        server.editable===true?h(Button,{variant:'ghost','data-testid':'mcp-edit-'+id,onClick:()=>openEdit(server)},t('mcpSettings')):null,
        h(Button,{variant:'danger-ghost',busy:removing===id,'data-testid':'mcp-delete-'+id,onClick:()=>askRemove(server)},t('remove'))),
    });
  };
  const pairEditor=(kind,rows)=>h('div',{className:'omni-ui-stack','data-testid':'mcp-'+kind+'-editor'},
    rows.map((pair,index)=>h(FormGrid,{key:index},
      h(TextInput,{name:kind+'-key-'+index,autoComplete:'off','aria-label':t('mcpKeyLabel'),placeholder:t('mcpKeyPlaceholder'),value:pair.key,onChange:event=>updatePair(kind,index,'key',event.target.value),'data-testid':'mcp-'+kind+'-key-'+index}),
      h(TextInput,{type:'password',name:kind+'-value-'+index,autoComplete:'new-password','aria-label':t('mcpValueLabel'),placeholder:t('mcpValuePlaceholder'),value:pair.value,onChange:event=>updatePair(kind,index,'value',event.target.value),'data-testid':'mcp-'+kind+'-value-'+index}),
      h(Button,{variant:'ghost',disabled:rows.length===1,onClick:()=>removePair(kind,index),'data-testid':'mcp-'+kind+'-remove-'+index},t('mcpRemoveRow')))),
    h(Button,{variant:'ghost',onClick:()=>addPair(kind),'data-testid':'mcp-'+kind+'-add-row'},t('mcpAddRow')));
  /** ADR-055: `env`/`headers` are written in one of three ways, and the page states which one before saving —
   * keeping the stored object, clearing it, or replacing it with exactly the rows below. "Untouched" is the
   * default, so merely opening an edit never destroys values this page cannot echo. */
  const pairBlock=(kind,label,count,isAdd)=>{
    const mode=values[kind+'Mode'];
    const replace=mode==='replace';
    const hint=replace?(isAdd?t('mcpPairsHint'):t('mcpPairsHintEdit')):mode==='clear'?t('mcpPairsClearHint'):fill(t('mcpConfiguredCount'),{count});
    const field={
      label,
      hint,
      // The switch is wrapped, not annotated: CapsuleSwitch does not forward extra props, and a testid that
      // silently disappears would make the gate address nothing.
      action:h('div',{'data-testid':'mcp-'+kind+'-mode'},
        h(CapsuleSwitch,{
          options:[{id:'keep',label:t('mcpPairsKeep')},{id:'clear',label:t('mcpPairsClear')},{id:'replace',label:t('mcpPairsReplace')}],
          value:mode,
          onChange:id=>setValue(kind+'Mode',id),
          'aria-label':label,
        })),
    };
    return h(Field,field,replace?pairEditor(kind,values[kind]):null);
  };
  const formSection=()=>{
    const add=form.mode==='add';
    const server=form.server;
    // A row loaded by an HTTP-only client (the Suite's own dual/OAuth subpaths, or an old external row that has not
    // been migrated yet) can never be a stdio row, and the Host refuses that switch: the page must not offer a path
    // that is guaranteed to be rejected. The hint is the readable reason.
    const httpOnlyClient=!add&&server!==null&&(server.clientSource==='suite'||server.clientSource==='external-legacy'||values.kind==='oauth');
    // ADR-094 D4：官方 manager 托管的条目与套件自有客户端共用一张表单，但官方 schema 没有的字段不出现。
    const managed=!add&&server!==null&&server.managed===true;
    const officialTarget=add?(authority==='official'&&values.kind!=='oauth'):managed;
    return h('section',{className:'omni-ui-stack','data-testid':'mcp-form-section'},
      h(SheetHead,{title:add?t('mcpAddTitle'):t('mcpEditTitle'),dismissLabel:t('back'),onDismiss:closeForm}),
      h('div',{className:'omni-ui-stack','data-testid':'mcp-form'},
        h(Field,{label:t('mcpServerName'),hint:t('mcpServerNameHint'),required:true},
          h(TextInput,{name:'serverName',autoComplete:'off',value:values.name,readOnly:managed,onChange:event=>setValue('name',event.target.value),'data-testid':'mcp-form-name'})),
        add?h('div',{'data-testid':'mcp-form-kind'},h(Field,{label:t('mcpKind')},
          // Both arms are real now (ADR-033 D1): CapsuleSwitch is this library's segmented control that lets the
          // page switch the carried client; OAuth rows are HTTP-only, so that arm fixes the transport.
          h(CapsuleSwitch,{options:[{id:'static',label:t('mcpKindStatic')},{id:'oauth',label:t('mcpKindOauth')}],value:values.kind,onChange:id=>setValues(current=>({...current,kind:id,...(id==='oauth'?{transport:'streamable-http',headersMode:'keep',envMode:'keep'}:{})})),'aria-label':t('mcpKind')}),
          values.kind==='oauth'?h('p',{className:'omni-ui-hint','data-testid':'mcp-form-kind-oauth-note'},t('mcpOauthFlowHint')):null)):null,
        httpOnlyClient
          ?h('div',{'data-testid':'mcp-form-transport-hint'},h(Field,{label:t('mcpTransport'),hint:t('mcpHttpOnlyClientHint')},null))
          :values.kind==='oauth'?null:h('div',{'data-testid':'mcp-form-transport'},h(Field,{label:t('mcpTransport')},
          h(CapsuleSwitch,{options:[{id:'streamable-http',label:t('mcpTransportHttp')},{id:'stdio',label:t('mcpTransportStdio')}],value:values.transport,onChange:id=>setValues(current=>({
            ...current,
            transport:id,
            // Changing transport changes what an endpoint even means, so the new endpoint must be typed here.
            ...(form!==null&&form.mode==='edit'&&form.server!==null&&id!==form.server.transport?{endpointOpen:true}:{}),
          })),'aria-label':t('mcpTransport')}))),
        // ADR-055 wording: a stdio row has a launch command, not an "endpoint"; the same section serves both, so
        // the label follows the transport instead of calling a command line an address.
        add?null:h(Field,{label:values.transport==='stdio'?t('mcpStartCommand'):t('mcpEndpoint'),hint:values.endpointOpen?(values.transport==='stdio'?t('mcpStartCommandReplaceHint'):t('mcpEndpointReplaceHint')):(values.transport==='stdio'?t('mcpStartCommandConfigured'):t('mcpEndpointConfigured'))},
          h(Switch,{label:values.transport==='stdio'?t('mcpStartCommandReplace'):t('mcpEndpointReplace'),checked:values.endpointOpen,onChange:event=>setValue('endpointOpen',event.target.checked),'data-testid':'mcp-endpoint-replace'})),
        values.kind==='oauth'?h(Field,{label:t('mcpStaticClientId'),hint:add?t('mcpStaticClientIdHint'):t('mcpStaticClientIdHintEdit')},
          h(TextInput,{name:'staticClientId',autoComplete:'off',value:values.staticClientId,onChange:event=>setValue('staticClientId',event.target.value),'data-testid':'mcp-form-static-client-id'})):null,
        values.kind==='oauth'?h(Field,{label:t('mcpAuthTimeout'),hint:add?t('mcpAuthTimeoutHint'):t('mcpAuthTimeoutHintEdit')},
          h(NumberInput,{name:'authorizationTimeoutMs',min:1000,step:1,value:values.authTimeoutMs,onChange:event=>setValue('authTimeoutMs',event.target.value),'data-testid':'mcp-form-auth-timeout'})):null,
        add||values.endpointOpen
          ?values.transport==='streamable-http'
            ?h(Field,{label:t('mcpUrl'),hint:t('mcpUrlHint'),required:true},
              h(TextInput,{name:'url',inputMode:'url',autoComplete:'off',value:values.url,onChange:event=>setValue('url',event.target.value),'data-testid':'mcp-form-url'}))
            :h(React.Fragment,null,
              h(Field,{label:t('mcpCommand'),hint:t('mcpCommandHint'),required:true},
                h(TextInput,{name:'command',autoComplete:'off',value:values.command,onChange:event=>setValue('command',event.target.value),'data-testid':'mcp-form-command'})),
              h(Field,{label:t('mcpArgs'),hint:t('mcpArgsHint')},
                h(TextArea,{name:'args',rows:4,value:values.args,onChange:event=>setValue('args',event.target.value),'data-testid':'mcp-form-args'})),
              h(Field,{label:t('mcpCwd'),hint:add?t('mcpCwdHint'):t('mcpCwdHintEdit')},
                h(TextInput,{name:'cwd',autoComplete:'off',value:values.cwd,onChange:event=>setValue('cwd',event.target.value),'data-testid':'mcp-form-cwd'})))
          :null,
        h(Field,{label:t('mcpTimeout'),hint:add?t('mcpTimeoutHint'):t('mcpTimeoutHintEdit')},
          h(NumberInput,{name:'toolCallTimeoutMs',min:1,step:1,value:values.timeoutMs,onChange:event=>setValue('timeoutMs',event.target.value),'data-testid':'mcp-form-timeout'})),
        managed?h(Switch,{label:t('mcpEnabled'),description:t('mcpEnabledHint'),checked:values.enabled,onChange:event=>setValues(current=>({...current,enabled:event.target.checked,enabledDirty:true})),'data-testid':'mcp-form-enabled'}):null,
        officialTarget?null:h(Switch,{label:t('mcpFailOnStartup'),description:add?t('mcpFailOnStartupHint'):t('mcpKeepUnlessChanged'),checked:values.failOnStartupError,onChange:event=>setValues(current=>({...current,failOnStartupError:event.target.checked,failDirty:true})),'data-testid':'mcp-form-fail-on-startup'}),
        values.transport==='streamable-http'&&values.kind!=='oauth'?pairBlock('headers',t('mcpHeaders'),server?server.headerCount:0,add):null,
        // ADR-034/0.2.0-5: the OAuth client's Config carries neither headers nor env; the Host refuses that
        // combination, so the page never offers it.
        values.kind!=='oauth'?pairBlock('env',t('mcpEnv'),server?server.envCount:0,add):null,
        saveIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'mcp-save-failure'},
          h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-save-error'},saveIssue.sentence),
          h(Disclosure,{'data-testid':'mcp-save-raw',title:t('rawDetails')},h('pre',{className:'omni-ui-excerpt'},saveIssue.raw))),
        h(ActionGroup,null,
          h(Button,{variant:'primary',busy:savePhase==='saving',onClick:()=>{void submit();},'data-testid':'mcp-form-save'},savePhase==='saving'?t('saving'):t('save')),
          h(Button,{variant:'ghost',onClick:closeForm,'data-testid':'mcp-form-cancel'},t('cancel')))));
  };
  if(form!==null&&values!==null)return formSection();
  return h('section',{className:'omni-ui-stack','data-testid':'mcp-section','aria-label':t('tabMcp')},
    h(StatusLine,{'data-testid':'mcp-summary'},summary),
    purposesIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'mcp-purpose-read-failure'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-purpose-read-error'},t('mcpPurposeReadFailed')),
      h(Disclosure,{'data-testid':'mcp-purpose-read-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},purposesIssue.raw))),
    purposes===null?null:purposesUnreadable
      ?h('div',{className:'omni-ui-stack','data-testid':'mcp-purpose-unreadable'},
        h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-purpose-unreadable-line'},t('mcpPurposeUnreadable')),
        h(Disclosure,{'data-testid':'mcp-purpose-unreadable-raw',title:t('rawDetails')},
          h('pre',{className:'omni-ui-excerpt'},String(purposes.unreadable.code??'')+'\n'+String(purposes.unreadable.raw??''))))
      :h('div',{'data-testid':'mcp-routing-row'},
        h(Switch,{label:t('mcpRouting'),description:t('mcpRoutingHint'),checked:purposes.routing===true,disabled:purposeBusy!==null,onChange:event=>{void saveRouting(event.target.checked);},'data-testid':'mcp-routing'})),
    h('div',{className:'omni-ui-toolbar','data-testid':'mcp-toolbar'},
      h(ActionGroup,null,
        h(Button,{onClick:openAdd,'data-testid':'mcp-add-server'},t('mcpAdd')),
        h(Button,{'data-testid':'mcp-refresh',busy,onClick:()=>start()},busy?t('refreshing'):t('refresh')),
        receipt)),
    sentence===null?null:h('div',{className:'omni-ui-stack','data-testid':'mcp-failure-block'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-failure'},sentence),
      h(Disclosure,{'data-testid':'mcp-failure-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},slot.issue.raw))),
    deleteIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'mcp-action-failure'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-action-error'},deleteIssue.sentence),
      h(Disclosure,{'data-testid':'mcp-action-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},deleteIssue.raw))),
    probeIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'mcp-probe-failure'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-probe-error'},probeIssue.sentence),
      h(Disclosure,{'data-testid':'mcp-probe-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},probeIssue.raw))),
    migrationIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'mcp-migration-failure'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-migration-error'},migrationIssue.sentence),
      h(Disclosure,{'data-testid':'mcp-migration-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},migrationIssue.raw))),
    upgradableCount>0?h('div',{className:'omni-ui-stack','data-testid':'mcp-migration'},
      h(StatusLine,{tone:'warn','data-testid':'mcp-upgradable'},fill(t('mcpUpgradableNotice'),{count:upgradableCount})),
      h(ActionGroup,null,h(Button,{busy:migrating,onClick:askMigrate,'data-testid':'mcp-migrate'},migrating?t('mcpMigrating'):t('mcpMigrate')))):null,
    clientsIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'mcp-clients-migration-failure'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'mcp-clients-migration-error'},clientsIssue.sentence),
      h(Disclosure,{'data-testid':'mcp-clients-migration-raw',title:t('rawDetails')},
        h('pre',{className:'omni-ui-excerpt'},clientsIssue.raw))),
    clientsReceipt===null?null:h(React.Fragment,null,
      h('div',{className:'omni-ui-stack','data-testid':'mcp-clients-restart'},
        h(StatusLine,{tone:'warn',role:'status'},t('mcpClientsRestart'))),
      clientsReceipt.backupPath===null?null:h(Disclosure,{'data-testid':'mcp-clients-backup',title:t('mcpClientsBackup')},
        h('pre',{className:'omni-ui-excerpt'},clientsReceipt.backupPath))),
    legacyCount>0&&catalog!==null?h('div',{className:'omni-ui-stack','data-testid':'mcp-legacy-notice'},
      h(StatusLine,{tone:'warn'},fill(t('mcpLegacyNotice'),{count:legacyCount,names:legacyRows.map(server=>String(server.name)).join(', ')})),
      h(ActionGroup,null,h(Button,{busy:migratingClients,onClick:askMigrateClients,'data-testid':'mcp-migrate-clients'},migratingClients?t('mcpMigratingClients'):t('mcpMigrateClients')))):null,
    servers.length===0?null:authority==='official'
      ?h(React.Fragment,null,
        officialRows.length===0?null:h('section',{className:'omni-ui-stack','data-testid':'mcp-group-official'},
          h('h3',{className:'omni-ui-itemCardTitle','data-testid':'mcp-group-official-title'},t('mcpGroupOfficial')),
          h('p',{className:'omni-ui-hint','data-testid':'mcp-group-official-hint'},t('mcpGroupOfficialHint')),
          h('ul',{className:'omni-ui-list','data-testid':'mcp-server-list-official'},officialRows.map(row))),
        ownRows.length===0?null:h('section',{className:'omni-ui-stack','data-testid':'mcp-group-suite'},
          h('h3',{className:'omni-ui-itemCardTitle','data-testid':'mcp-group-suite-title'},t('mcpGroupSuite')),
          h('p',{className:'omni-ui-hint','data-testid':'mcp-group-suite-hint'},t('mcpGroupSuiteHint')),
          h('ul',{className:'omni-ui-list','data-testid':'mcp-server-list-suite'},ownRows.map(row))))
      :h('ul',{className:'omni-ui-list','data-testid':'mcp-server-list'},servers.map(row)),
    catalog!==null&&servers.length===0&&sentence===null?h('div',{'data-testid':'mcp-empty'},
      h(EmptyState,{title:t('mcpEmptyTitle'),description:t('mcpEmptyDescription'),action:h(Button,{onClick:openAdd,'data-testid':'mcp-empty-add'},t('mcpAdd'))})):null);
}

/**
 * Owns the two dictionaries, the token sheet, the Remote handle, one state object with both read chains,
 * and the sidebar + main registrations.
 *
 * Expected call (the Suite Client entry owns the mounting decision):
 *   applyToolsPanel(ctx,{mountError:()=>mountFailureOrNull})
 * with a context that declares slots and locale.
 */
export function applyToolsPanel(ctx,options={}){
  const mountError=typeof options.mountError==='function'?options.mountError:()=>null;
  const mountFact=()=>{
    try{
      const value=mountError();
      if(typeof value!=='string'||value.length===0)return null;
      return value;
    }catch(issue){return String(issue&&issue.message?issue.message:issue);}
  };

  ctx.effect(()=>ctx.locale.register(TOOLS_LOCALE_NS,{en,zh}),'omnisurge: tools locale dictionaries');
  ctx.effect(()=>ctx.locale.register(SKILLS_LOCALE_NS,{en:skillsEn,zh:skillsZh}),'omnisurge: skills locale dictionaries');
  ctx.effect(()=>{injectStyles();},'omnisurge: skills-mcp ui token sheet');

  // One state object created at registration, handed to the page through inject: the tab, each tab's last
  // good result, receipt, busy phase and failure fact. Switching tabs reads nothing; returning to a tab
  // reuses what this object already holds, and an application restart is the only reset.
  let disposed=false,revision=0;
  const listeners=new Set();
  const controllers=new Set();
  const panel={
    tab:'skills',
    skills:{data:null,complete:null,lastRead:null,phase:'idle',started:false,issue:null},
    mcp:{data:null,purposes:null,purposesIssue:null,lastRead:null,phase:'idle',started:false,issue:null},
  };
  const subscribe=listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
  const getRevision=()=>revision;
  const notify=()=>{revision+=1;for(const listener of [...listeners])listener();};

  // The namespaced Remote is a service, not a field: it may be read only from a context that declares it.
  const wire={namespace:null};
  ctx.effect(()=>{
    const scoped=ctx.inject(NAMESPACE_INJECT,inner=>{
      wire.namespace=inner.remote.omnisurgeSuiteDev;
      return()=>{wire.namespace=null;};
    });
    return()=>{wire.namespace=null;void scoped.dispose();};
  },'omnisurge: hold the tools Remote namespace while the Host serves it');
  // Owner-level cancellation: a disabled or unloaded component stops its in-flight reads and keeps no timer.
  ctx.effect(()=>()=>{
    disposed=true;
    for(const controller of controllers)controller.abort();
    controllers.clear();
    listeners.clear();
  },'omnisurge: release the skills-mcp panel state');

  // One unary call: the documented RemoteResult envelope is the only answer shape. The three transport
  // facts stay distinct -- not mounted, carrier/owned-Remote failure, unreadable answer -- and a Host
  // refusal keeps its machine code for the raw disclosure instead of becoming prose.
  const call=async(method,...args)=>{
    const namespace=wire.namespace;
    if(!namespace||typeof namespace[method]!=='function'){
      const mount=mountFact();
      const message='SUITE_NAMESPACE_MISSING '+method+(mount!==null?' (owned Remote mount failed: '+mount+')':' (the Host namespace is not mounted in this window)');
      throw failure(mount===null?'namespace':'mount',message);
    }
    let result;
    try{result=await namespace[method](...args);}
    catch(issue){throw failure('refused','SUITE_CARRIER_FAILED '+method+' \u2192 '+reason(issue));}
    if(!result||typeof result!=='object'||typeof result.ok!=='boolean')throw failure('answer','SUITE_RESULT_INVALID '+method+' did not answer a RemoteResult envelope');
    if(result.ok!==true){
      const code=codeOf(result.error);
      const refused=failure(code===null?'refused':refusalKind(code),'SUITE_HOST_REFUSED '+method+' \u2192 '+reason(result.error),code===null?undefined:code);
      // Machine-readable refusal details (RemoteError.details) stay structured for the sentence layer; the raw
      // disclosure keeps the Host's own diagnostic string.
      if(result.error.details!==undefined&&result.error.details!==null)refused.details=result.error.details;
      throw refused;
    }
    return result.value;
  };
  const readSkills=async()=>{
    const value=await call(SKILLS_METHOD,{});
    if(!value||typeof value!=='object'||!Array.isArray(value.skills))throw failure('answer','SUITE_RESULT_INVALID '+SKILLS_METHOD+' answered without a skills array');
    const roots=value.roots!==null&&typeof value.roots==='object'?value.roots:{};
    return {skills:value.skills,complete:value.complete===true,roots:{
      ...(typeof roots.user==='string'&&roots.user.length>0?{user:roots.user}:{}),
      ...(typeof roots.project==='string'&&roots.project.length>0?{project:roots.project}:{}),
    }};
  };
  const readMcpServers=async()=>{
    const value=await call(MCP_METHOD);
    if(!value||typeof value!=='object'||!Array.isArray(value.servers))throw failure('answer','SUITE_RESULT_INVALID '+MCP_METHOD+' answered without a servers array');
    return {servers:value.servers,reload:value.reload==='live'?'live':'manual',authority:value.authority==='official'?'official':'rows'};
  };
  const readMcpPurposes=async()=>{
    const value=await call(MCP_PURPOSES_METHOD);
    if(!value||typeof value!=='object'||typeof value.routing!=='boolean'||!Number.isFinite(value.revision)||!value.purposes||typeof value.purposes!=='object')throw failure('answer','SUITE_RESULT_INVALID '+MCP_PURPOSES_METHOD+' answered without a purpose snapshot');
    return {
      routing:value.routing,
      revision:value.revision,
      purposes:value.purposes,
      servers:Array.isArray(value.servers)?value.servers:[],
      unreadable:value.unreadable&&typeof value.unreadable==='object'?value.unreadable:null,
    };
  };
  /** One user-triggered MCP read: the server list and the purpose snapshot are independent facts, so a purpose
   * read that is refused keeps the list (and vice versa) instead of blanking the whole tab. */
  const readMcpTab=async()=>{
    const servers=await readMcpServers();
    try{return {servers,purposes:await readMcpPurposes(),purposesIssue:null};}
    catch(failed){return {servers,purposes:null,purposesIssue:failed&&failed.failure?failed.failure:{kind:'refused',raw:String(failed&&failed.message?failed.message:failed)}};}
  };

  /** One user-visible read chain per tab: in place, no polling, failure keeps the last good result. */
  const read=tab=>{
    const slot=panel[tab];
    if(disposed||slot===undefined||slot.phase==='loading')return;
    slot.started=true;
    slot.phase='loading';
    notify();
    const controller=new AbortController();
    controllers.add(controller);
    const settle=()=>{controllers.delete(controller);};
    const pending=tab==='skills'?readSkills():readMcpTab();
    pending.then(value=>{
      settle();
      if(disposed||controller.signal.aborted)return;
      if(tab==='skills'){slot.data={skills:value.skills,roots:value.roots};slot.complete=value.complete;}
      else{
        slot.data={servers:value.servers.servers,reload:value.servers.reload,authority:value.servers.authority};
        slot.purposes=value.purposes;
        slot.purposesIssue=value.purposesIssue;
      }
      slot.issue=null;
      slot.lastRead=clock();
      slot.phase='idle';
      notify();
    },failed=>{
      settle();
      if(disposed||controller.signal.aborted)return;
      slot.issue=failed&&failed.failure?failed.failure:{kind:'refused',raw:String(failed&&failed.message?failed.message:failed)};
      slot.phase='idle';
      notify();
    });
  };

  const t=ctx.locale.bind(TOOLS_LOCALE_NS);
  const tSkills=ctx.locale.bind(SKILLS_LOCALE_NS);
  const face={panel,subscribe,getRevision,start:read,notify,tSkills,mutate:call};

  // One page entry and one sidebar cell under the same id; the shell owns the switch between them.
  ctx.effect(()=>ctx.slots.inject(MAIN_SLOT,()=>ctx.slots.register({
    name:MAIN_SLOT,
    key:TOOLS_PANEL_ID,
    locale:TOOLS_LOCALE_NS,
    inject:()=>face,
  },ToolsPanel)),'omnisurge: skills-mcp main panel');
  ctx.effect(()=>ctx.slots.inject(SIDEBAR_SLOT,()=>ctx.slots.register({
    name:SIDEBAR_SLOT,
    id:TOOLS_PANEL_ID,
    order:5,
    label:()=>t('nav'),
    locale:TOOLS_LOCALE_NS,
  },ToolsPanelIcon)),'omnisurge: skills-mcp sidebar entry');
}
