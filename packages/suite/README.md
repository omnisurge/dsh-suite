# 万物生腾套件组（Omnisurge Suite）

面向官方 DSH **0.2.0-rc.2** 的独立扩展套件。rc.16 在 rc.15 的安全起手与来源身份之上，把**组件生命周期收敛到套件一页**：一次授权准备同时完成安装/升级、消除重复的独立 bundle 选择，并只启用套件所属业务行；另提供只读可见、带版本同意的 Agent 工具。预发布版本、安装成功或局部步骤完成都不等于完整兼容性验收。

## 安装与接入

1. 经官方插件管理安装本地 Suite tgz。首次只启用管理器，业务行默认停用。
2. 打开 **Plugins → Omnisurge Suite → SearXNG组件接入**，核对版本与诊断，勾选授权后点击“安装／升级SearXNG组件”。
3. 唯一核心校验内附业务tgz的SHA256，经官方PluginManager安装/替换为当前profile直接依赖，固定输入保留在profile所属 `.omnisurge-suite/component-artifacts/<sha256>.tgz`。**同一次已授权操作内**还会用官方 `setBundleEnabled(业务,false)` 消除被官方 reconcile 自动选中的独立 bundle，然后只启用所属业务行；回执以 `deselect` 阶段与 `selectionResolved` 呈现。
4. 已装组件若是本profile受管归档中的**旧版本或其他固定身份**，准备会替换为套件内固定版本；替换正在运行的组件回报 `COMPONENT_RESTART_REQUIRED`（重启一次才加载新字节）。registry、link 或其他来源的包永不替换。
5. Host组件与严格协议实际dispatch就绪后，在下方“联网搜索（SearXNG）”业务行配置后端、保存并测试。组件准备不代表后端或全局 `web_search` 已选择本provider。

安装身份 `@omnisurge/dsh-suite`，业务身份 `@omnisurge/dsh-web-search-searxng`。Suite与独立业务bundle **不得同时选中**；内附的是固定分发归档，不是第二个运行实例。SDK/React由宿主提供，不含内核或用户档案/凭据。

## 两处开关的归属边界

| 位置 | 管什么 |
| --- | --- |
| 套件页「SearXNG组件接入」 | **组件生命周期**：安装、升级、启用、双选收敛 |
| 插件页「联网搜索（SearXNG）」条目 | **业务功能与配置**：端点、引擎组、凭据引用以及业务行自身启停 |
| 插件页「万物生腾套件组」 | 套件作为业务行唯一 owner 的选择状态 |

组件安装必须经官方 `installBundle`，而它只接受声明了 `dsh.bundle` 的包，因此官方插件页必然为该业务包渲染一个选中开关——这是平台契约造成的界面事实，不是可以删除的第二入口。套件侧保证它的**期望状态恒为关闭**，并在授权准备与显式纠正中收敛。

## 明确纠正双bundle

若两者都选中：套件页给出冲突诊断，且**授权准备即可收敛**（保留 Suite，取消独立 bundle，保留直接dependency、配置与显式 enabled 覆盖）。也可以只做纠正：勾选“只取消独立bundle选择”后执行，它只调用官方 `setBundleEnabled(业务,false)`，不安装、不卸载、不自动启用，并报告选择阶段与当前状态。

status 自身绝不写入、不轮询、不在启动时自动改选择；选择纠正成功不等于组件 ready。不同版本来源、重复 owner、只读 row 或错误来源仍各自诊断拒绝。

安装、启用、验证、取消bundle选择是不同阶段，UI保留官方回执与原始诊断。取消/断连不承诺撤销已发送的写入；必须刷新核对，不自动回滚、删除、盲目重试或重启。停用整个Suite释放两个Host owner及UI，重启用不重复。

## Agent 工具 `suite_component`

- `status`：只读，返回模式、期望/已装版本、单一 owner 与选择冲突、所属行状态、`canPrepare`；标记为并发安全。
- `prepare` / `resolve-selection`：变更动作，必须携带与 status 完全一致的 `expectedVersion`，否则拒绝且不产生任何写入；只接受这两个参数。

两个动作都调用与页面**同一个** canonical 核心（同一单飞、取消与版本同意语义），不卸载包、不写配置、不选中独立bundle、不重启应用；准备替换了运行中组件时同样回报 `COMPONENT_RESTART_REQUIRED`。

## 源码开发

经官方引导同时将Suite和业务作为profile直接link，仅选择Suite。source身份须manifest link目标与实际profile node_modules解析目录都等于当前Suite真实sourceRoot所属业务目录，且版本一致；同版本registry/归档/另一source不能冒开发组件ready。源码模式只启用正确绑定，不安装源码快照或重置配置。

固定构建入口核对实际Host/浏览器revision、协议与四项运行能力，全部匹配才报热更新生效。按钮不会重启或升级加载中的管理器自身；结构更新需正常构建和另获授权的重载。禁止未经授权在正式源码监听仓库原位build/install/check；验证使用独立副本。

## 边界

这是本地 rc.16 候选说明，不含生产安装/重启/发布授权。macOS隔离SDK/浏览器验证不替代Desktop、Windows或个人认证后端验收；实际通过项以候选SHA与验收记录为准。只存官方凭据引用，不迁移生产profile、不强改全局provider，不自动prune保留归档。

## rc.20：贡献的默认视图

- 正常视图只有**一行摘要**（组件启用数、就绪/待处理、套件版本与是否可升级）和一个**开发者选项**开关（默认关闭，只写浏览器本地 `localStorage`，不写 profile 或任何 Settings）。
- 只有官方启用开关做不到的工作才出现组件操作行：未安装、可升级、`COMPONENT_BUNDLE_ALREADY_SELECTED` 双选冲突、已安装待重启。官方列表已显示的包名/模块/运行状态/启用开关不在此重复。
- 开发者选项开启后才显示身份三方、组件码、revision、发行目录与候选、被拒候选、原始 JSON 与源码开发按钮；页面不再渲染自己的 `h2` 标题。
- 本插件自己的设置表单**不属于**套件页：它由业务插件注册在官方行配置 slot，key 为 `<拥有该行的 bundle>#omnisurge-web-search-searxng`，两种分发布局下都只有一个入口。
