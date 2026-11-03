# `@omnisurge/dsh-ui`

套件插件的 OEM 控件库（omnidsh ADR-028）。**不是种子插件**：无 `dsh.bundle`、禁入 `SEED_SET` / stage / deploy。消费方放 `devDependencies`，client 构建 `alwaysBundle` 打进产物（见 omnidsh ADR-028 修订 3）。

本文件是**套件前端视觉与交互语言的事实源**。做设置页 / 商店 / 管理列表等 UI 时先读这里；对话或实现里沉淀出可复用的设计精华，也**追加写回本文件**（不要另开仓级设计百科，避免与组件分叉）。

### 选中态与层级（ADR-044）

- **颜色编码状态**：任何互斥单选控件的选中态都是 background: var(--omni-label-primary) + color: var(--omni-bg)。不要写字面色值（#000 / white）：暗色主题下这两个 token 互换。
- **形状编码层级**：chrome 级切换用 SegmentBar（铺满容器、高 36、pill、轨道 --omni-bg-muted、滑块内缩）；内容区选项用 CapsuleSwitch（贴内容宽、高度由 `padding:6px 14px` 与行高决定（约 38，不是 token）、描边轨道）。表单里用分段条、chrome 里用胶囊都算错。
- **只有滑块填色**，整条轨道不填色：全宽轨道全黑会成为页面最重的元素。
- 新增控件必须先声明自己属于哪一级；check:client-ui 只允许 SegmentBar 出现在 chrome 白名单里（当前为空，等 (Work | Chat) 迁入）。

### 动作分两级（ADR-045）

- **行级动作**（整行：检查连接 / 编辑 / 删除）＝按钮，放 `ActionGroup`；动作列**贴标题行**（`.omni-ui-listActions{align-self:flex-start}`），不悬在第二行中间。
- **值级动作不常驻**（只改某个内联值，如用途）：值本身就是控件（`Button variant="link"` + `.omni-ui-valueText`，可访问名要**包含**可见标签：「用途：…（点击编辑）」）；铅笔是 `.omni-ui-inlineEdit` 槽里 **22×22 的 `span`**（`.omni-ui-pencilBtn`、`aria-hidden`、不是 button、无 `tabIndex`——写成 `IconButton` 会被 `.omni-ui-iconBtn` 的 28px 盖掉），静息 `opacity:0`，整行 `:hover`/`:focus-within` 才显示**并带 `background:var(--omni-fill)` 灰底**（`.omni-ui-listRow:hover .omni-ui-pencilBtn`），`@media (hover:none)` 下常显**并同样带灰底与 `--omni-label-secondary` 标签色**。值行所在行的空白处是进入编辑的**指针快捷方式**：行本身不进 tab 顺序，键盘仍只有值按钮；行内按钮、链接、输入与披露控件保留自己的行为。行里**不要**放常驻的「编辑用途」文字，值行只允许一个键盘可达控件。
- 别用 `ghost` 顶替值级动作（它是无描边填充块，进动作组还会被抬到 34px），也别用常驻链接——两种都会变成一行里多出来的东西。
- 执行者：check:client-ui（控件规格条目由描述符表导出：link 变体、值行几何、隐藏/悬停/聚焦/触屏兜底与触屏灰底、铅笔、贴标题行）+ client-composition（用途行的结构与语义断言，含整行空白快捷方式与交互子元素不误触，条数以该文件里的 `ADR-046:` 为准）。

## 设置面用语（2026-09-04）

对人、对 ADR、对实现只用这套。同一层不要混用 tab / 大 tab / 子页面 / 分页。

| 叫法 | 是什么 | 例子 | 槽 / 控件 |
|---|---|---|---|
| **侧栏分区** | 设置左侧一行，点开一整屏 | 通用、模型、多模态、插件、Chat助理、omnidsh | `settings.section` |
| **子页** | 一个侧栏分区里互斥的一屏 | 多模态的输入 / 输出；Chat助理的运行 / 角色 / 你 / 环境；omnidsh 的更新中心 / 关于 | 那一屏的正文 |
| **页签** | 子页顶上的下划线切换 | 输入 \| 输出 | `SectionTabs` |
| **卡片** | 子页（或没有子页的分区）里的一块配置 | 生图 pin、模型池 | `SettingsCard` |

对照，不要混进上面四层：

- **插件子 tab** = `settings.plugins.tab`（管理 / 商店 / 更新 / 安全）。在「插件」这一个侧栏分区里面，不是新的侧栏分区，也别叫子页。
- 会话里 Work \| Chat = **分段**（`SegmentBar`），不是设置侧栏分区。
- **分页**只当动词（「这个分区要不要分页」）。那一屏仍叫子页。
- 只有一屏的分区（技能、MCP、渠道）没有页签，正文直接上卡片。

## 开发工具与缺口协议

仓内 agent 可运行 `node packages/ui-mcp/src/server.mjs`（仓根，Node 24），通过 MCP 查询本库；协议见 [前端开发套件](../../docs/specs/frontend-development-kit.md)。它不安装到 DSH，也不随 Suite 分发。

- 先组合本库原语；不够用时调用 `ui_request_gap`，写明 name/page/need/whyExistingCannotCompose，等待库 owner 评审。
- 禁止在业务插件里手写控件、HTML/CSS 皮肤或临时造组件；普通无皮肤的结构容器仍按现有门禁允许。
- 缺口登记不代表批准或实现，不生成业务代码；库变更仍走 ADR/spec/测试与原有确认流程。
- 导出的首字母大写组件默认 stable；源声明前的 `@experimental` / `@deprecated` 标记覆盖默认值。stable 表示本仓可复用，不承诺已完成全平台可访问性验收。

下面是开发工具读取的场景索引，仅把已有库原语串成骨架；视觉规则仍由本 README 上下文与源码拥有。

<!-- ui-mcp-contexts -->
```json
{
  "settings": {"surface":"omni-ui", "components":["PageHead","SettingsCard","Field","TextInput","ActionGroup","Button"], "skeleton":"<div className=\"omni-ui omni-ui-stack\"><PageHead title=\"设置\"/><SettingsCard title=\"配置\"><Field label=\"名称\"><TextInput /></Field></SettingsCard></div>"},
  "main": {"surface":"omni-ui-tokens omni-ui-page", "components":["PageHead","ListRow","ActionGroup","Button","EmptyState"], "skeleton":"<div className=\"omni-ui-tokens omni-ui-page\"><PageHead title=\"管理\"/><ul className=\"omni-ui-list\"><ListRow title=\"条目\" /></ul></div>"},
  "bundle": {"surface":"omni-ui-tokens omni-ui-pageContent", "components":["SettingsCard","Badge","Button"], "skeleton":"<div className=\"omni-ui-tokens omni-ui-pageContent\"><SettingsCard title=\"套件\" /></div>"},
  "card": {"surface":"omni-ui-card", "components":["SettingsCard","Field","TextInput","ActionGroup","Button","Badge"], "skeleton":"<SettingsCard title=\"配置\"><Field label=\"名称\"><TextInput /></Field></SettingsCard>"},
  "list": {"surface":"omni-ui-list", "components":["ListRow","ActionGroup","Button","Badge"], "skeleton":"<ul className=\"omni-ui-list\"><ListRow title=\"条目\" actions={<ActionGroup><Button>编辑</Button></ActionGroup>} /></ul>"}
}
```
<!-- /ui-mcp-contexts -->

## 组件调用示例

下列是 API 形状示例，不是完整业务代码；变量与 handler 由消费者提供，控件须按前文的命名、表面与生命周期约定组合。SegmentBar 示例仅说明 API，当前业务页无 chrome 白名单，不能直接使用。

### Badge 示例

```tsx
<Badge tone="muted">能力标签</Badge>
```

### Banner 示例

```tsx
<Banner role="note">请先完成配置。</Banner>
```

### StatusLine 示例

```tsx
<StatusLine tone="ok">连接正常</StatusLine>
```

### FormGrid 示例

```tsx
<FormGrid><Field label="名称"><TextInput /></Field></FormGrid>
```

### Disclosure 示例

```tsx
<Disclosure title="详细信息"><p>说明</p></Disclosure>
```

### KeyValueList 示例

```tsx
<KeyValueList items={[{label:"版本",value:"1.0"}]} />
```

### Checkbox 示例

```tsx
<Checkbox label="启用" defaultChecked />
```

### Switch 示例

```tsx
<Switch label="启用" defaultChecked />
```

### RadioGroup 示例

```tsx
<RadioGroup label="模式" value={mode} options={[{value:"a",label:"自动"}]} onChange={setMode} />
```

### NumberInput 示例

```tsx
<Field label="数量"><NumberInput min={1} defaultValue={1} /></Field>
```

### SearchInput 示例

```tsx
<SearchInput aria-label="搜索" value={query} onChange={onQueryChange} />
```

### Slider 示例

```tsx
<Slider label="强度" value={level} onChange={onLevelChange} />
```

### Progress 示例

```tsx
<Progress label="加载中" />
```

### Skeleton 示例

```tsx
<div aria-busy="true" aria-label="加载中"><Skeleton lines={3} /></div>
```

### CapsuleSwitch 示例

```tsx
<CapsuleSwitch aria-label="模式" value={mode} options={[{id:"a",label:"自动"}]} onChange={setMode} />
```

### IconButton 示例

```tsx
<IconButton aria-label="添加" onClick={onAdd}>+</IconButton>
```

### SegmentBar 示例

```tsx
<SegmentBar aria-label="视图" value={view} options={[{id:"a",label:"视图 A"}]} onChange={setView} />
```

### DialPicker 示例

```tsx
<DialPicker aria-label="分类" value={category} options={categories} onChange={setCategory} />
```

### EmptyState 示例

```tsx
<EmptyState title="暂无条目" description="添加第一条配置。" />
```

### TextArea 示例

```tsx
<Field label="说明"><TextArea value={text} onChange={onTextChange} /></Field>
```

### NotesPad 示例

```tsx
<NotesPad aria-label="笔记" value={notes} onChange={onNotesChange} />
```

### OrderedGrip 示例

```tsx
<OrderedGrip index={index} count={items.length} label="调整顺序" onMove={onMove} />
```

### Select 示例

```tsx
<Field label="模式"><Select value={mode} onChange={onModeChange}><option value="a">自动</option></Select></Field>
```

### ConfigPage 示例

```tsx
<ConfigPage available writable labels={{unavailable:"无法读取",readOnly:"只读",saveFailed:"保存失败",saving:"保存中",save:"保存"}} onSave={onSave}><Field label="名称"><TextInput /></Field></ConfigPage>
```

### SheetHead 示例

```tsx
<SheetHead title="编辑" dismissLabel="返回" onDismiss={onDismiss} />
```

### SectionTabs 示例

```tsx
<SectionTabs ariaLabel="子页" value={tab} options={[{id:"a",label:"配置"}]} onChange={setTab} />
```

## 工程约定

- `@omnisurge/dsh-ui/intercept-method` 是独立的纯客户端适配工具（ADR-034 修订 2），仅 Chat/多模态发送与 Chat 新会话包装使用。按属性描述符恢复、支持跨 bundle 乱序卸载、原方法保留当前调用方的 `this`；禁止再用代理方法的函数相等判断清理。`wrap(next, active)` 每次调用建立，异步准备后须检查 `active()`，不得在卸载后访问旧上下文或提交消息。业务错误分类和导航策略留在消费插件。
- 确认框与 Toast 的互斥、ID 和堆栈由文档级 owner 管理，禁止退回模块局部的多副本状态。验收必须同时加载两份独立构建的库；单包测试不能证明跨插件互斥。
- `Field` 自动关联内部实际 input/select/textarea 的标签、提示和错误，包括异步出现的控件；复合字段的每个子输入应提供自己的 `aria-label`（例如“Header name / Header value”）。显式 aria 命名优先，既有描述保留。
- 新增界面只 `import` 本包与 React；禁止直引官方 `dsh-client-ui-primitives`。
- 视觉值在 `src/tokens.ts`（`--omni-*` → 宿主 `--dsw-alias-*`）。控件只吃 `--omni-*`。
- 令牌挂在 `.omni-ui` **与**独立控件根（如 `.omni-ui-card` / `.omni-ui-dial` / `.omni-ui-tokens`）上——控件若落在无 `.omni-ui` 包裹的页面，仍须能解析颜色。官方插件列表没有 `.omni-ui` 包裹；会话里的产品皮（如 effort-slider）只加 `.omni-ui-tokens`，不要套 `.omni-ui`（那层有设置页栏宽）。
- 改外观改库；禁止消费方用选择器长期穿透覆写库内部 class。
- 库 bump version；消费插件跟 bump 并 rebuild client。
- `injectStyles()` 写的是**整页一条**共享样式（`@omnisurge/dsh-ui/controls.css`）。每个插件 alwaysBundle 一份库，切 Chat助理子页会再灌一次。只允许同版本刷新或更新的包覆盖，禁止旧包把 `PageHead` 等新规则冲掉（否则 `h2` 回浏览器默认字号，整页看起来忽大忽小）。消费方若在同一侧栏分区里挂子页，分区壳应在切子页后再 `injectStyles()` 一次（子 effect 先跑、父 effect 后跑）。

## 组件何时用

### 组件体系 v1（2026-09-07，omnidsh ADR-028 修订 20）

目录同步补充（0.1.41，omnidsh ADR-028 修订 21）：`latestRefresh(read, accept, fail)` 合并请求，变更期间旧响应不提交，dispose 后不提交；`watchCatalog(remote, refresh)` 绑定 llm/adapters-updated、focus、online、visibilitychange 及 select focus，返回清理函数。刷新仅更新目录，不重新加载业务表单。消费者须在 effect 清理订阅并 dispose 请求队列；失败由消费者显示不可用状态，不回显错误详情中的凭证。当前无轮询，不替代官方会话目录服务。

目标是覆盖 omnidsh 当前插件配置、管理列表、账号表单和运行反馈；不是取代 dsh 官方前端。基础组件新增于 0.1.40，邮箱示范消费为 0.1.3。本节是设计/API 事实源，批量迁移不得另抄一套视觉规范。

| 层 | 覆盖组件 | 状态与边界 |
|---|---|---|
| 基础视觉 | tokens、34px 控件高、8/12/16px 间距、宿主明暗颜色 | 沿用；正文 13px、辅助 12px，焦点可见，不按视口缩字 |
| 操作 | Button、IconButton、ActionGroup | Button 新增 ghost / danger-ghost / link / busy；ActionGroup 新增分组 |
| 文本表单 | Field、TextInput、TextArea、NotesPad、SearchInput、NumberInput | 后两项为 native input 薄封装，保留清空草稿、min/max/step 和原生 validity |
| 选择表单 | Select、CapsuleSwitch、DialPicker、Checkbox、Switch、RadioGroup、Slider | 后四项新增；布尔用开关/复选框，互斥项按密度选单选组/分段/下拉 |
| 结构与导航 | SettingsCard、PageHead、SheetHead、SectionTabs、SegmentBar、FormGrid、ListRow、Disclosure | 后三项新增；FormGrid 容器自适应，ListRow 只渲 li，Disclosure 原生 details |
| 状态反馈 | Badge、StatusLine、Banner、EmptyState、Progress、Skeleton | 后两项新增；未知进度不伪造百分比，Skeleton 仅装饰 |
| 系统交互 | showToast、showConfirm、showBusyOverlay | 复用；业务成功/失败不放灰字底栏，最终危险确认保持 danger |
| 专属控件 | OrderedGrip、附件轨、成果 gallery、chip | 继续复用，媒体/模型/权限语义不并入基础库 |
| 有需求再立项 | 数据表格、树、虚拟列表、日期区间、富文本、异步多选、复杂菜单/通用弹窗 | 当前不新增；不能用不完整的手写键盘/焦点系统冒充完整组件。优先宿主或成熟无样式实现 |

#### 操作层级和危险分组

- `Button variant="primary"` 用于当前提交；`default` 用于编辑等普通命令；`ghost` 为低强调普通命令。
- `danger-ghost` 用于列表中的移除/删除/卸载：默认 secondary 灰色、透明底和透明边框；hover/focus-visible 时危险文字与浅危险背景。实际按钮保留 34px 高、左右 8px padding，不使用零 padding 文字链接。文字本身说明动作，不能仅依赖红色。
- 现有 `danger` 不改含义，最终不可逆确认按钮继续使用。取消、关闭、返回、读取、刷新不是危险操作；重置是否破坏数据须逐项判断。
- `ActionGroup` 的 children 是普通操作，`danger` 是危险操作；组内 8px、组间 16px（均为实际点击框之间的间隔），没有普通组时不留空槽。换行后组间仍 16px，不靠 margin-left 补偿。仅布局 div，不自称 keyboard toolbar，不新增方向键拦截。
- `busy` 强制 disabled + aria-busy，保持按钮文案和尺寸稳定；调用方管理异步生命周期和成功/失败 Toast。它不能代替业务请求去重、并发守卫或权限校验。

```tsx
<ActionGroup danger={<Button variant="danger-ghost" disabled={busy} onClick={confirmRemove}>移除</Button>}>
  <Button onClick={edit} disabled={busy}>编辑</Button>
</ActionGroup>
```

#### 表单与布局约定

- Checkbox/Switch 自带 label，可带 description；原生 disabled/checked/onChange 透传。Checkbox 的 indeterminate 只控制混合态，父级负责后续选中集合。
- RadioGroup 以 fieldset/legend 命名，原生 radio 键盘行为；value/onChange 受控。Slider 以 label 命名，value 为 number，允许 valueText，min/max/step 走原生 range；精确输入选 NumberInput。
- SearchInput、NumberInput 放入 Field 或显式 aria-label；不要将每次输入的空字符串立即强制转换为 0。服务端继续验证所有输入。
- FormGrid 最小列宽 220px，窄容器降为单列。ListRow 的 actions 内放 ActionGroup；title/description 不放嵌套按钮，长文本可换行。列表父级必须 ul/ol。
- Disclosure 原生 summary 支持 Enter/Space。open/onToggle 是原生属性与事件；需要强制打开时由调用方决定，不承诺内部业务状态管理。
- Progress 的 value 缺省或非有限数表示不定进度，有限值限制到 0..max；label 必填。Skeleton 不播报假内容，外部加载区域提供 aria-busy 与可访问名称，失败换 EmptyState/重试，不永久停在骨架。
- 新组件继承现有 `.omni-ui` / `.omni-ui-tokens` 宿主令牌环境；独立使用需要该根容器并调用 injectStyles。无独立主题、无插件自绘第二套皮肤。

#### 批量迁移和验收

1. 先列消费清单：文件、操作语义、旧组件/类、新组件、保留的业务 handler 与确认链。检索 textAction 只能找候选，不能机械替换全部。
2. 只改公共控件与消费者展示层。保留权限门、取消行为、超时、请求参数、回执、秘密字段策略、已有确认，不新增发信或重启。
3. 修改代码的包须 bump。公共库 alwaysBundle，库升级不会自动刷新已部署插件；消费产物重构建后须逐包 bump 并在后续授权交付中部署，禁同版本覆盖发布。
4. 交付需有实际界面 1050/375px 明暗截图、无横向溢出、32px 以上按钮目标、8/16px 分组测量、键盘/禁用/忙碌/取消验证。危险确认必须证明取消不调用业务 handler，确认只调用一次；不可使用生产删除来取证。
5. `pnpm build`、UI 测试、受影响包测试、`pnpm gov:suite` 通过；检索旧样式残留并逐项解释。不能把构建通过等同于全库无障碍验收。
6. 迁移 Agent 交付 Ready for Review（返修 Ready for Rereview），主持核对最终 diff、反例及截图后裁决；未经授权不 commit/push/deploy/restart，也不卸载旧邮箱。

预览：`node scripts/ui-preview.mjs`（仓库根目录，独立测试数据）。浏览器回归：`node scripts/ui-browser.mjs`，支持 `OMNI_UI_PREVIEW_URL`、`OMNI_PLAYWRIGHT_MODULE`、`OMNI_BROWSER_EXECUTABLE`。截图写入 output/playwright/ui-*.png。

| 场景 | 选用 | 不要 |
|---|---|---|
| 少量互斥档位（闲置 3/6/12h、日界） | `CapsuleSwitch` | native `<select>`、拨盘 |
| 长列表 / 可循环分类（商店分类） | `DialPicker` | 塞一排胶囊、矮下拉冒充拨盘 |
| 模型目录、稀疏选项 | `Select` / 原生对齐样式的下拉 | 拨盘（过重） |
| 对话输入栏工具行 | `Select variant="inline"`（宽随内容、28px、不顶满） | 设置页默认 `Select`（`width:100%` 会挤爆官方工具行） |
| 工具行图标钮 / 侧栏 rail 36px | `IconButton`（composer 28 / rail 36） | 插件再抄一份 ghost 方钮 |
| 会话侧栏分段（Work \| Chat） | `SegmentBar`（满宽轨道、选中滑块实底：主文字色填充 + 反色文字） | `CapsuleSwitch`（设置页胶囊）；再抄 `omniwc-segment`；不要和管理设置「侧栏分区」混称 |
| 附件条 / 气泡缩略图 | `.omni-ui-chip` / `.omni-ui-gallery` | 插件再画一套 `--dsw-*` chip |
| pin / 健康一行 | `StatusLine` | `Badge` 冒充状态行；再抄圆点 + `<p>` |
| 长文笔记（环境对照） | `NotesPad` + `TextArea variant="notes"` | 一叠 `Field`+矮框；行号/等宽代码皮；左右分栏预览 |
| 自有 `settings.section` 页头 | `PageHead`（大标题 + 描述；`mark` / `actions` 留槽默认空） | `SettingsCard` 冒充页头；再抄 `omnisi-heading`；官方「插件」子 tab 里再画一层 |
| 设置分区卡 | `SettingsCard` | 每插件再抄一套卡壳 |
| 官方插件列表（`settings.plugin.item`） | `SettingsCard as="li"`（宿主是 `<ul class="cards">`） | 默认 `<section>`（非法列表子节点）；再抄一份 `omni*-card`；给卡加 `PageHead` |
| 侧栏分区里的子页（运行/角色、输入/输出、更新中心/关于） | `SectionTabs`（页签） | 第三张卡片冒充子页；档位用胶囊；不要叫 tab |
| 未安装 / 空列表 | `EmptyState` | 仅一行灰字无结构 |
| 引导/抽屉离场（以后再说） | `SheetHead` + `.omni-ui-dismiss` | 红钮、带边框次要钮、标题下再开一行动作 |

## 设计精华（2026-08-27 起，商店 / 管理迭代）

### 拨盘 `DialPicker`

横向细长条，**不要外卡片框**（无边框、无底、无圆角盒）。

- **结构**：顶倒三角 → 上内缩线 → 文字行 → 下内缩线。三角在**上分割线上方**。
- **分割线**：非贯穿（左右留白），标出选中带；**不要**给选中项加灰底 / 阴影块。
- **选中**：字重 + 三角指向即可。
- **宽度**：与上方工具行同宽顶满；列数按容器宽度弹性（奇数、居中），列宽摊平，**禁止写死只显示 3 个**。
- **高度**：细（约一行控件高），不要竖向滚轮占高。
- **滚轮**：在拨盘上滚动只转分类，**不得带动页面**（非 passive `wheel` + `preventDefault` / `overscroll-behavior: contain`）。鼠标一格一档，带短缓动。触摸板跟手滑（单事件封顶），停住再吸到档位，不要切一档锁死。拖拽与方向键保留。

### Token 宿主（2026-09-19，事故后补的硬规则）

\`--omni-*\` 变量**只定义在 \`tokens.ts\` 的 TOKEN_SHEET 那一串宿主类上**，靠 CSS 继承往下传。

- **新增页面级根容器**（会被直接当 \`<div className="omni-ui-X">\` 渲染的那种）时，
  **必须**把 \`X\` 加进 TOKEN_SHEET 的宿主列表，否则里面所有 \`var(--omni-*)\` 全部未定义 ——
  症状是「按钮变灰字、没有背景、没有边框」，**不报错、控制台干净**。
- 内层元素不用管（从根继承）。
- 组件自保可以在根元素上再带一个 \`omni-ui-tokens\`（它本身是宿主）。
- \`test/tokens-host.test.ts\` 是这道闸门：\`PAGE_ROOTS\` 里每个类都必须在宿主列表里。

**实证事故**：平铺容器 \`.omni-ui-configPage\` 漏加 → 子代理模型页「保存」变灰字、
角色页「添加角色」变纯文字。**同一道闸门还查出既存的 \`.omni-ui-notesPad\` 也漏了。**
两者都是用户先看到、代码里无声。

### 主页面根 vs 设置页栏宽（2026-10-21，0.1.4 事故后补）

两个根容器职责不同，**不能互换**：

| 类 | 用途 | 形态 |
|---|---|---|
| `.omni-ui` | **设置页**里的一栏（0.1.3 的技能分区用它是对的） | `max-width:760px`，无内边距、不居中 |
| `.omni-ui-page` | **侧栏 main 面板的整页**（技能 · MCP 页） | `width:100%`、`max-width:1120px` 居中、`padding:24px 32px 32px`，自己拥有滚动 |
| `.omni-ui-pageContent` | **嵌入官方 bundle 页的内容**（`plugins.bundle.config`） | `width:100%`、`max-width:1120px` 居中、`padding:24px 32px 32px`，**不拥有滚动**；官方页仍是滚动容器 |

规范与页面登记表在 [docs/specs/ui-page-surfaces.md](../../docs/specs/ui-page-surfaces.md)（执行者：`check:client-ui`）；这里的表只讲形态与设计取舍。

**实证事故（0.1.4）**：技能页从设置分区搬到侧栏面板时，整页根仍用 `.omni-ui`，于是内容被压到 760px、
左贴侧栏、顶贴窗口——**用户截图发现**，当时门禁只断言了 class 与文案，没有任何几何断言。
现在两边都有闸门：组合门禁断言页面根必须是 `omni-ui-page`（子树不得出现裸 `omni-ui`），
mutant `page-root-back-to-the-settings-column` 改回旧容器必红；G5 量 computed padding 与页面宽度。

### 卡片解剖与徽标（2026-11-02）

- **标题行**：左标题，右动作；动作使用 `ActionGroup`，行级按钮靠右，不落到内容区左下。
- **不贯穿横线**：标题和正文之间用内缩 `border-top`（左右各 16px，等价于 `omni-ui-cardBody` 的 inset 分隔），不要画贯穿整张卡的 `hr`。
- **徽标类型**：`Badge` 的 `tone` 是状态语义（`ok` / `warn` / `err` / `muted`）；能力/组合标签用 `muted`，状态用带圆点的 `ok`/`warn`/`err`。同一行只放一个状态徽标（ADR-049），不要把能力标签伪装成状态。
- **间距与字号**：控件高度 34px；正文 13px；辅助文字 12px；间距使用 `--omni-gap-tight` / `--omni-gap` / `--omni-gap-section`（8/12/16），不在页面写 inline style。
- **卡片套卡片**：内层能力/供应商卡是允许的；内层卡同样要有标题行、内缩分隔线、内容区和右侧动作，不要压成无标题的列表块。

### 专用件别挪作他用（2026-09-19，第二次事故后补的硬规则）

这两个类**不是通用布局件**，照名字猜用途会出事：

| 类 | 它是什么 | 误用的后果 |
|---|---|---|
| \`.omni-ui-tierRow\` | **四列档位网格**（provider 1fr / model 1.25fr / effort .75fr / 操作 auto），给「一行三档」用 | 塞六个字段进去 → 操作区落进最后的 \`auto\` 列 → **按钮被挤成竖条、文字竖排** |
| \`.omni-ui-btnIcon\` | **28px 宽的图标位**（\`width:28px; padding:0\`） | 放文字 → **单字方块 + 奇怪描边** |

**要通用表单布局**：单列 \`.omni-ui-stack\` + \`Field\` 竖排。
**要行内操作按钮**：正常 \`Button\`，放进 \`.omni-ui-listActions\`（\`min-width:7.5rem\`，容得下整词）
或直接用 \`ListRow\` 的 \`actions\` 槽。
**要行内展开**：用 \`ListRow\` 的 \`children\` 槽（内容渲染在 \`.omni-ui-listMain\` 里）。

\`subagent-router\` 的 \`test/host-face.test.ts\` 有对应的布局锁（只查 \`className=\` 的用法）。

### 列表 / 商店卡片

- **行高归属 CSS**：`min-height` + 固定操作槽；核心 / 已安装行用占位对齐，**不要**靠有无主按钮撑开行高。
- **内容与操作分区**：介绍区与按钮之间用**内缩分隔线**（inset / partial rule）——不贯通到卡片左右边，两侧留白。成熟做法，用来划清「读」与「点」。
- 描述区可设最小行高，避免长短文案把卡片扯得忽高忽矮。
- **落点（2026-08-31）**：管理 / 安全 / 更新清单用 `.omni-ui-list` + `.omni-ui-listRow`（固定操作槽）；商店 / 技能目录用 `.omni-ui-itemCard`（`min-height:112px` + `.omni-ui-itemCardActions` 内缩线）。审计摘录用 `.omni-ui-excerpt`，不要再抄 `omnipm-report`。分组折叠走 `SettingsCard`，不要自绘第二套 chevron 卡头。更新页工具条左侧状态用 `.omni-ui-hint`（库会把它顶满，按钮靠右）。
- **折叠卡头行高（2026-08-31）**：`SettingsCard` 折叠头固定占标题 + 说明两行（`.omni-ui-cardHeadText` `min-height`，说明槽始终渲染，无文案用空行）。一叠折叠卡不要因有无 `description` 忽高忽矮。
- **角色库（2026-08-31，ADR-025 修订 24）**：Chat助理「角色」是库存清单，不是商店。有卡走 `listRow`：左标题 + 默认只留 `Badge`，和标题同一排 `.omni-ui-badgeRow`（不要把徽标单独丢进 `listMain` 列里被拉满）。右固定槽放「设为默认」（非默认才出）、「编辑」和文字「删除」。卡名不是 `Button`；不要 `✕`、不要禁用「设为默认」和徽标并排。点「编辑」或「新建」把列表藏掉，同一页换成表单；「返回」走 `SheetHead`。导入 / 新建 / 采访是集合动作，放工具条或卡脚，不进行。不要用 `itemCard` 再抄一遍。
- **徽标不拉满（2026-09-01）**：`.omni-ui-badge` 是胶囊，`width:max-content` + `flex:none`。列 flex 父级（`listMain`）默认 stretch 会把它扯成一条横条，看起来不像图 2 那种正常徽标。

### 筛选工具条

- **搜索顶满一行**；分类拨盘**单独一行**（勿与搜索、刷新挤在同一行互相抢宽）。管理页「全局」同一套：搜索一行、来源拨盘一行（官方 / omnidsh / 第三方），不要再把一百多条摊成一张无分类清单。
- 「刷新」= 重拉目录索引，**不是**搜索提交。搜索边输入边过滤，不必再放「搜索」按钮。失败重试与日常刷新可用同一动作，文案用「刷新」而非含糊的「重试」。

### 开关行（2026-08-28，开发者实验室）

布尔选项用 `Field`（标题 + 一句 hint）包 `CapsuleSwitch` 的「开 / 关」两档，不要自绘 checkbox / 再抄一行开关皮。发现类与安装类分两张 `SettingsCard`，避免「看见」和「真装」混在同一组。

### 更新 / 管理（同迭代，备忘）

- 第三方升级入口收在「更新」页；管理列表用角标提示，避免顶栏「检查更新」抢戏。
- 管理行与核心行视觉高度对齐（固定 action slot）。
- MCP 列表：行下说明只写**下一步**。没配才出提示（HTTP 缺凭证、OAuth 未登录、stdio 可加环境变量）；徽标已经说明「已配 / 已连接 / 已设」时不要再跟一句「配置完成」。stdio 说明必须通用，禁止写死某个变量名。
- OAuth paste：有授权 URL 时，行里只给链接 + 贴码框（`Field` + 提交）。Toast 只说「已登录 / 失败」，**不要**把 code 回显到会话、Toast 或 hint。
- OAuth 无 DCR：添加行给可选「静态客户端 ID」+ 一句何时才填（Ardot 不用填）。登录因此失败用 Toast 说人话，不要把英文 JSON 贴在行上。
- MCP 徽标：连接/凭证是一枚，工具数量另起一枚「N 工具」（有数才出）。不要把「已连接（25 工具）」揉进 OAuth 状态徽标——官方行没有 OAuth 徽标，数量也读不到。
- **MCP 种类与协议分两枚（2026-09-05）**：人对着选的是进门方式。添加面 HTTP 只留「静态凭证 | OAuth」；协商不是第三档。行上种类 muted：「静态凭证 / OAuth」（dual 行也标静态凭证）。协议另起一枚：官方 / OAuth / stdio 标「仅 v1」；会谈版本的静态行未连通标「协商中」；谈成标 **v1**（muted）或 **v2**（ok）；失败不出协议徽标。不要把规范日期（`2025-11-25` / `2026-07-28`）写上界面，也不要标「对端双栈」或「自动协商」当种类。旧官方静态 HTTP 启动时自动改走 dual，人不用删了重加；写盘后须再重启一次才换客户端。
- MCP 死活：已启用且工具数为 0 时用警告徽标 + 下一步说明（OAuth 待登录、静态行「协商中」除外；谈版本失败走这条死活）；stdio 清单 detail 要显示 command + args，不能只露一个光杆 command。
- **生图默认尺寸（2026-09-05）**：两排胶囊——比例（不指定 / 常用比 / 自定义）+ 长边（1024 / 1536 / 2048 / 自定义）。两档都钉死时合成 `WIDTHxHEIGHT` 写入现有 `size`；任一自定义再出手填。空 = 上游默认。`WxH` 不要走 `CapsuleSwitch` 的 `customOptionId`（那格是 `inputMode=numeric`）。
- **渠道徽标看活口（2026-09-05）**：QQ「已连接」只认本进程套接字还在（OPEN，或刚 ready）。套接字没了却仍报已连接，就是用 `dsh.log` 里过期的 `Bot ready!`。说明写「现在连没连上」，不写日志/启发式。

### 系统提示双轨：Toast + 确认幕（2026-08-27 产品定稿）

面向桌面壳与**未来移动壳**同一套手感（对齐 Android Toast/Snackbar + Dialog），禁止再在各插件里自绘底栏 pill / 内联「细线框确认块」当永久形态。

| 轨 | 形态 | 何时用 | 不要 |
|---|---|---|---|
| **Toast** | 视口 **中下** 浮动条（约底边上方一掌宽），弱遮挡、可自动消失或带 ×；可选一个次要动作（Snackbar 感） | 自愈已禁插件、坐席崩溃已接管、插件集变更请刷新、普通成功/失败 | 杀伤操作的唯一确认；贴顶通告条当默认（移动端顶栏已被系统占用） |
| **确认幕** | 半透明遮罩 + **居中**卡片；必须「取消」+ 主危险/主操作 | 活跃会话冲突后仍要重启/更新/回滚；其它不可逆确认 | 纯信息提示；设置页正文里嵌一块细线框冒充确认 |

实现落点（已落地 0.1.15，2026-08-27；首个消费方 shell-integration 0.1.8）：

- **API 是命令式 DOM，不是 React 组件**：`showToast(spec): ToastHandle` / `showConfirm(spec): ConfirmHandle`（`src/toast.ts` / `src/confirm.ts`，栈策略在 `src/notify-core.ts` 可单测）。原因：client 运行时模块表只有 `react` / `react/jsx-runtime`，没有 `react-dom` → 不能 `createRoot` / portal 到 body。React 消费方在 `useEffect` 里 show / cleanup `handle.close()`（示例：shell-integration `ConflictConfirm`，用 ref 兜住回调身份，effect 只随数据引用开合）。
- 宿主由 show 调用**懒建**在 `document.body`（`.omni-ui-toastHost` / `.omni-ui-confirmScrim` / `.omni-ui-busyScrim`），空栈即拆；都挂令牌（可脱离 `.omni-ui`）。新令牌：`--omni-warn` / `--omni-shadow` / `--omni-scrim`。z-index：忙遮罩 8900，确认幕 9000，Toast 9010（Android 语义，Toast 压遮罩；忙遮罩在确认幕下面，不能取消确认）。
- 栈语义收窄：**同 kind 替换**（合并同类文案的落地形态）；跨 kind 超上限（`TOAST_STACK_LIMIT = 3`）**逐最旧**，不做跨条拼接文案。sticky（`durationMs: null`）强制保留 ×；次要动作点击后即关。`onClose(reason)` 区分 `close`（用户 ×，可当已读回执）/ `timeout` / `action` / `replaced` / `evicted` / `code`（代码拆除，勿当表态）。
- 确认幕：`role="alertdialog"` + `aria-modal`；Esc / 点遮罩 = 取消；Tab 焦点陷阱（`trapNextIndex`），关幕还焦点；`items`（primary/secondary/meta 行）承载会话清单类列表。**一次只一张**：新开顶掉旧的（旧的按取消收场）；`handle.close()` 静默拆除不回调（给 React cleanup 用）。确认幕「取消」留在**脚**（必须成对：取消 + 主操作），不要改成标题旁离场。

### 离场 dismiss（2026-08-29，角色卡引导「以后再说」）

「以后再说」一类**可逆离场**（不是不可逆确认）走标题行，不要再占一行按钮。

- **位置**：标题行右侧（`SheetHead` / `.omni-ui-sheetHead`）。标题左、离场右。
- **样子**：三级灰字（`--omni-label-tertiary`），hover 变 primary。无边框、无底、不是 `Button`。
- **不要**：红（红只留给 `btnDanger`：删除 / 仍要重启）；带边框次要钮；标题下再开第二行动作专门放离场。
- **和确认幕的分界**：确认幕脚的「取消」是合同要求的成对动作；引导卡的「以后再说」是离场，放标题旁。
- 存量已清：shell-integration 0.1.8 删 `.omnisi-crashpill` / `.omnisi-healpill` / `.omnisi-bootpill` / `.omnisi-conflict*` 私有皮；其余插件禁止再新增同类自绘。
- 消费方：shell-integration（自愈 / 崩溃 / 插件集变更 / 更新中心确认幕 + 成败 Toast）；plugin-manager 管理/商店/更新/技能/安全/渠道/Chat 助理/MCP（动作成败 Toast、卸载/直装/409 确认幕；审计报告正文仍可留页上）；三张旧设置卡 `saveFailed`（media / searxng / router）；effort-slider 换模/换档。**新增**套件运行时提示必须走本双轨（见仓根 `AGENTS.md`），禁止再自绘 pill / 把 JSON 贴设置页当主报错。
- TODO（后续修订再议）：跨插件统一 toast 总线；确认幕 busy/pending 态按钮禁用。T-债-通知动作面已接（omnidsh ADR-028 修订 9）；T-债-UI 设置面已迁（修订 10–12），plugin-manager `styles.ts` 已删。

### 忙遮罩（2026-08-31，过程态，不是第三轨报错）

长操作挡整页用 `showBusyOverlay` / `closeBusyOverlay`（`src/busy.ts`）。**不是**系统提示双轨扩成三轨：成败仍走 Toast，不可逆仍走确认幕。忙遮罩只报「正在做」，做完拆掉。

- **形态**：半透明遮罩 + 居中小卡 + CSS 转圈 + 一句人话。命令式挂 `document.body`（同 toast/confirm：client 没有 react-dom）。
- **合同**：无取消、无 Esc、无点遮罩关闭。一次只一张，新开静默顶掉旧的。`document` 不在则关着的空 handle。卸载走 `closeBusyOverlay()`。
- **无障碍**：`role="status"` `aria-live="polite"` `aria-busy="true"`。`prefers-reduced-motion` 停转圈。
- **z-index 8900**：低于确认幕，高于普通页。不要用确认幕冒充忙（确认幕必须成对取消）。
- **已挂**：shell-integration **0.1.29** 包 `sessions.fork`（侧栏分叉 / 消息分支 / 条幅「在新会话继续」同一张「正在分支会话…」）。

### 会话补丁条幅（2026-08-31，失踪预设）

会话头上的「这份会话带伤」不是 Toast，也不能换掉官方 `conversation.session.header`（single 坐席）。加在输入框上方的 `conversation.input.dock`（list）。

- **结构**：`.omni-ui-tokens` 根 + `Badge tone="warn"` + 一句人话 + 主按钮「在新会话继续」。
- **令牌**：跟 `--omni-*`（含 `--omni-warn` 描边）。不要再抄 pill / 细线框确认块。
- **成败**：条幅留下；点按钮的成功/失败走 Toast。分支过程走忙遮罩（上一节），不是 Toast 进度条。
- **不要**：用 Toast 替代这条；替换 header；把 `/export` ZIP 画进会话当继承。
- **交接（0.1.29）**：只走官方 `sessions.fork`（完整已完成回合）。create + 草稿 / 翻页读压缩摘要已退役。fork 失败只 Toast，不再新开空会话。

### 对话工具行里的下拉（2026-08-29，角色切卡）

官方 `conversation.input.left` 是一行预算：`+` / Full access / 计划 / 模型 已经占满。往这里挂设置页默认 `Select`（`width:100%`、34px 带边框）会把整行当自己的格子——「计划」被挤成竖排、「Full access」图标叠在一起。

- **工具行**：`Select variant="inline"`。宽随文案、高 28px、无边框、`flex: none`，对齐官方 Permission / 模型下拉。
- **设置页表单**：继续默认 `variant="field"`（顶满格子）。
- 不要在插件里再抄一套 composer 下拉皮。

### 会话里我们挂上去的皮（2026-09-01，omnidsh ADR-028 ④）

对象是**我们自己注册的控件**，不是官方输入框 / 侧栏树 / 会话列表。不要套 `.omni-ui`（760px 栏宽会挤官方 chrome）。令牌挂在控件根上。

- **🖼️ 工具行钮**：`IconButton`。28px、无边框、hover 走 `--omni-fill`。隐藏 file input 用 `.omni-ui-fileInput`。
- **附件 dock**：`.omni-ui-dock` + `.omni-ui-chip`（缩略图 / 扩展名徽标 / 状态 / 22px 圆叉）。设置页 / 旧条仍可用。
- **输入框内附件轨（2026-09-03，ADR-019 修订 16）**：跟官方 64px 图轨同一排。`.omni-ui-attachRail` 内距 `4px 12px 0`、gap 10px（官方 rail 同款）；嵌套的官方轨去内距、可收缩，文档方块跟图排一排。`.omni-ui-attachTile` 64×64、16px 圆角、0.5px 边、hover 出叉。文档画扩展名，不要再用框上 dock 卡跟图拆成两层。
- **气泡画廊**：`.omni-ui-galleryWrap` + `.omni-ui-gallery` + `.omni-ui-galleryThumb`。委托失败才用 `.omni-ui-galleryFallback`。
- **工具卡画廊（2026-09-05，ADR-040 修订 6）**：生图 / SVG 占 `tool.call.toolview`，皮仍走这组类。光栅是 `<img class="omni-ui-galleryThumb">`；SVG 外框再加 `.omni-ui-galleryThumbSvg`，内部 `svg` 用 `max-width`/`max-height` + 消毒后的 `viewBox` 等比完整显示（横图 240×160，竖图 135×240；展开 420）。不要再给 SVG 写死外框裁切。点开放大留在卡内，不要 Cordis 浮层。
- **分区条**：`SegmentBar`。满宽轨道、**只有滑块**填主文字色（反色文字），轨道不填色（ADR-044）。**不是** `CapsuleSwitch`。rail 模式用 `IconButton size="rail"`（36px）。
- **hero 只读 chip**：`.omni-ui-heroChip`（28px 胶囊底）。不要用带边框的 `Badge`。
- **滑块**：canvas / chibi / 轨道仍是 effort-slider 产品皮，**不**抽通用 Slider。模型钮和菜单色走 `--omni-*`。
- **不要**：坐 `conversation.composer.bar` 重画官方输入栏；把设置页胶囊搬到侧栏；在官方 chrome 上铺第二套主色。

### 笔记垫 `NotesPad`（2026-08-29，Chat助理环境笔记）

环境对照、自由备注是**一块垫**，不是角色卡那种「标签 + 3 行框」。

- **一页一块垫**：`SettingsCard` 已经是卡，垫面不要再套第二层卡片，也不要拆成一叠 `Field`。
- **垫面**：`TextArea variant="notes"`。min-height 240px、行高 1.65、内边 12×14。跟宿主字，**不要**行号、不要等宽代码皮、不要左右 Markdown 预览——这是对照清单，不是 IDE。
- **垫顶条**：左状态（空 / 将注入），右字数 `tabular-nums`。状态行与垫之间只用 `gap-tight`，不要再划一条贯通分割线压在 textarea 上。
- **字数**：三级灰；≥90% 上限改 `--omni-warn`；超限才红。超限拒绝保存。
- **占位**：两行示例对照。说明写在卡描述，不要写进 textarea。
- **保存**：卡脚主按钮，脏才可点。⌘/Ctrl+S 同保存。成功/失败走 Toast。

### 状态汇总行（2026-09-14，MCP 分区运行时状态）

分区顶部的「N 项 · M 个失败」这类**状态汇总 + 刷新动作**，用 `ListRow`（父级必须是 `ul.omni-ui-list`），
**不要**用裸 `.omni-ui-badgeRow` 拼「徽标 + 按钮」：

- `.omni-ui-listRow` 自带边框 / 底色 / 圆角——它是这一行的**底座**；裸 badgeRow 会让整行浮在页面上、没有归属；
- `.omni-ui-listActions` 是 `align-items:center` + `min-width:7.5rem`——裸拼会出现**文字与按钮顶对齐、挤在一起**；
- 刷新按钮放 `actions` 里的 `ActionGroup`（见「表单与布局约定」：actions 内放 ActionGroup，title/description 不放嵌套按钮）。

**判据**：一行里**既有文字又有按钮**时，先问它是不是 `ListRow`。

### 插件列表里的设置卡（2026-08-31，T-债-UI）

官方「侧栏「插件」→ 插件配置」是 `<ul class="cards">` 里一排折叠卡，**不是** omnidsh 分区那种外包一层 `.omni-ui` 的栏。

- **根节点**：`SettingsCard as="li"`。默认 `section` 会破坏列表语义，官方卡也是 `<li>`。
- **令牌**：卡自己带 `.omni-ui-card` 即可解析 `--omni-*`。不要为了吃令牌再包一层 `.omni-ui`（760px 栏宽会把官方列表挤窄）。
- **折叠**：`collapsible` + `defaultOpen={false}`，对齐官方默认收起。展开时若要刷目录，走 `onToggle`。
- **标签行旁路**：手动/目录切换、清除、探活放 `Field action`，不要在 label 旁再抄一套 link 按钮皮。
- **卡脚**：discard + 主保存并排。库只在脚里**只有一颗**主钮时才拉满（Chat 助理那种单保存）；两颗钮不要互相抢宽。
- **已迁**：media-understanding / web-search-searxng / subagent-router。searxng / router / media 的 `styles.ts` 已删（media 会话钮 / dock / 气泡 / pin 点走库，修订 18）。
- **plugin-manager（修订 11 / 12）**：管理 / 商店 / 安全 / 技能 / 更新 / 审计报告都走库。目录与技能行走 `.omni-ui-itemCard`；清单走 `.omni-ui-listRow`；审计摘录走 `.omni-ui-excerpt`。包内 `styles.ts` 已删。
- **自有分区页头（修订 13）**：Chat助理 / 技能 / MCP / 渠道走 `PageHead`。技能不再用外包 `SettingsCard` 冒充分区名。管理 / 商店 / 更新 / 安全仍不加页头（官方「插件」已有）。

### 短档案（2026-08-30，Chat助理「你」）

称呼 / 时区 / 语言 / 爱好 / 硬雷区 / 补充是**几条 Field**，不是环境笔记那种一块垫。

- **选用**：字段少、每条有自己的 hint → `Field` + `TextInput` / 矮 `TextArea`。
- **不要**：`NotesPad` 冒充档案；把 USER 塞进「环境」页。
- **保存**：卡脚主按钮，脏才可点。成功/失败走 Toast。另给一条「让助理了解你」次要钮，不要做成第三张卡。

### 自有设置分区页头 `PageHead`（2026-08-31）

官方只给自己的分区画页头（「插件」= 18px/600 标题 + 13px tertiary 描述）。插件挂上的 `settings.section` 只有侧栏名，正文必须自己画，否则上来就是一叠框。

- **结构**：标题行（左标题，可选 mark / 右动作）→ 描述 → 可选 `SectionTabs` → 正文。
- **字号**：对齐官方 `dsh-client-ui-settings-plugins` 与既有 omnidsh 页，不要另做 hero。
- **槽**：`mark` / `actions` 默认不渲染、不占位。图标以后单独设计；保存 / 刷新 / 安装仍在卡脚或工具条。只有「整页就这一件事」才用动作槽。
- **不要**：用 `SettingsCard` 把分区名包成外包卡；复用 `SheetHead`（那是抽屉离场）；在官方「插件」子 tab（管理 / 商店 / 更新 / 安全）再画一层页头；给 `settings.plugin.item` 加页头。
- **正文三种**：配置页 = `SettingsCard` 一叠（卡标题是「模型池」不是分区名）；清单页 = 工具条 + list/itemCard；状态行页（omnidsh 更新中心）保持左右行，不必改成卡。
- **已挂**：Chat助理 / 技能 / MCP / 渠道 / omnidsh。

### 子页页签 `SectionTabs`（2026-08-29，Chat助理运行/角色）

同一侧栏分区里切子页（运行 / 角色 / 你 / 环境，或输入 / 输出），**不要**再堆一张卡片冒充子页。

- **形态**：下划线页签（对齐 omnidsh「更新中心 / 关于」），无外框、无胶囊底。
- **选用**：子页互斥、内容量差一截。少量档位仍用 `CapsuleSwitch`。
- **令牌**：只吃 `--omni-*`。禁止再抄一份 `.omnisi-tabs`。

### 有序档位行编辑器（2026-08-27，Chat助理模型池首用）

「主档 + 有序 fallback 列表」类配置（模型池、路由链等）的行编辑范式。**域逻辑（目录、选项、校验）留在消费插件**；库只出布局工具类与通用 `OrderedGrip` 手势件，避免领域数据进入组件库：

- **布局**：`.omni-ui-tierRow` 四列网格（provider 1fr / model 1.25fr / effort .75fr / 操作 auto）；有拖柄的 fallback 行再加 `.omni-ui-tierRowGrip`，最左插入 28px grip 列。model 名最长给最大权重；窄屏（≤520px）折单列。
- **操作簇**：`.omni-ui-tierActions` 右对齐，只放删除等即时行操作；`.omni-ui-btnIcon` 是 28px 窄按钮。排序不再混进右侧操作簇。
- **顺序表达（修订 6 / omnidsh ADR-028 修订 15）**：fallback ≥2 行才在左缘显示 `OrderedGrip`；只允许从 grip 长按后跟随 pointer，释放只改本地顺序，仍须点本卡「保存」才写盘。短按、下拉与 `✕` 不启动拖排；禁用 HTML5 `draggable`。grip 聚焦时方向键移动一档；主档与单 fallback 均无 grip；不要给行编号。
- **拖态要看得见（2026-09-01，omnidsh ADR-028 修订 17）**：长按激活后源行 `.omni-ui-tierRowGhost`（`position:fixed` + 虚化）跟手走，原位抽掉让其余行紧贴；目标行上沿仍画 `.omni-ui-tierRowDrop`。不要拖过程中重排数组（下拉会丢焦点）。`OrderedGrip` 用 `onPreview` 把指针坐标和 `target` 交给行。跟手不走路过渡；插入线透明度可短过渡，尊重 `prefers-reduced-motion`。不要 FLIP 库、不要 HTML5 DnD、不要动画 MCP。键盘换位无拖态。
- **主档与池的关系**：主档行用同一 TierRow 复用视觉，但无删除/排序；fallback 未设主档时整段禁用（池以主档为锚，无锚不成池）。
- **effort 下拉**：选项来自目录（`llm.models` 的 reasoning efforts），首项恒为「默认」（空值 = 供应方默认行为）；模型无档位时隐藏该列而非禁用（无意义的控件不出现）。
- **每卡独立保存页脚**：页面拆多卡后不要全局单保存钮——各卡底部自带「保存」+ 就地结果行，POST 只带本卡字段（端点合并语义）。

### 设置卡的服务生命周期（2026-10-07，0.1.48）

`registerSettingsPluginCard` 返回官方 `slots.inject` 的同步、幂等 disposer。调用方若用
`configForms.whileServed([namespace], register)`，**必须从 register 回调返回该 disposer**，再用
`ctx.effect` 持有 whileServed 的取消函数。已注册/待注册/已释放由官方 whileServed 和 slot owner
统一管理；不要另加插件生命周期的一次性布尔守卫。丢失 disposer 会同时导致通知重复注册及
Host 禁用后卡片残留，布尔守卫只掩盖前者，并会阻止重新启用时恢复贡献。

本仓全量 `build` 先构建此库再构建消费者；库仍是构建期依赖，不进入 profile 或组件集。
回归：helper 返回值身份检查 + 实际 rc.2 SDK/tarball 组合的禁用、重新启用、卸载/重挂检查；
这些自动化证据不替代用户安装后的 G4/G5 亲验。

## 本地开发

### 多账号与凭证表单（2026-09-07，邮箱配置）

- 插件配置只占一张 `SettingsCard as="li"`；账号使用 listRow，编辑时在同卡内替换列表，用 SheetHead 返回，不嵌套卡片或另开侧栏分区。
- 凭证只写不读：列表显示“已配置”，编辑框始终空白；空白保留由 host 合并，不能用脱敏占位符覆盖真实凭证。列表/表单不直接展示含凭证的 YAML。
- 服务商预设拥有完整的主机、端口和加密组合；高级连接信息可以折叠，但实际目标必须可查看。更换账号或服务器时不能静默复用旧目标的凭证。
- 发送策略和低频状态用无卡壳的折叠内容收纳，动作反馈走 Toast。域校验与凭证合并留在插件，公共库不接管邮箱配置语义。

```sh
pnpm --filter @omnisurge/dsh-ui test
pnpm --filter @omnisurge/dsh-ui build
```

消费插件改完 UI 后按仓规 `node scripts/deploy-plugin.mjs <dir>`，并重启 dsh（ESM 缓存）。

### 原件保存反馈（2026-09-07，ADR-040 修订 9）

桌面保存使用系统另存为，窗口停留期间按钮保持 `busy`，文案不变且禁止重复提交。取消是正常结果，不弹错误；只有实际写入成功回执才显示“已保存”，普通浏览器触发下载不能冒充已落盘。失败或旧壳不支持必须走 Toast。此处复用 Button/showToast，没有新增公共视觉组件；通道与字节处理由成果插件和壳负责。

### 运行诊断行（2026-09-15，SearXNG 上次搜索）

宿主透出的**瞬时运行诊断**（如「上次搜索为什么是空的」）在设置卡里的落法，沿用「状态汇总行」：
`ul.omni-ui-list` + `ListRow`，`description` 放细节（把不可达的引擎名列出来，用户才好自己核对）。

- **分色按要不要打扰**，不是按严重度：`notify=true` → `<Badge tone="warn">`；
  常态（有结果、少数引擎不可达）→ **不传 tone**（默认弱色），别把正常状态涂成告警。
- **`BadgeTone` 只有 `ok` / `warn` / `err` / `muted`**——**没有** `warning`（写了不报错，但样式静默失效）；能力/组合用 `muted`，状态用带圆点的 `ok`/`warn`/`err`。
- 只有「本次请求的引擎全挂」才够格用告警措辞；少数引擎不可达是常态，**不得**写成「服务故障」。
### 页面分层：决策优先（2026-10-07，套件页 rc.32）

插件/套件详情页的配置区**只放用户必须做决定的东西**，技术内容一律进唯一的“开发者选项”开关后面。
套件页是第一个按这条落地的页面，可作为同类页面的模板：

- **默认态可以只有一个控件。** 健康状态下配置区只渲染那一个开关；官方页面已经拥有的
  事实（版本徽标、组件数量与每行开关）**不重复渲染**——重复即第二事实源，也是视觉噪音。
- **按需出现的动作行。** 需要用户拍板的动作（如“有新版本可装”）用
  `ul.omni-ui-list` + `ListRow`：`badge` 放候选版本，`description` 放“当前 → 候选”，
  `actions` 放 `ActionGroup`（授权勾选 + 主按钮）。没有候选时**整行不渲染**，不留空槽。
- **异常才打扰。** 读取失败、上次启动自愈、组件需处理，用 `StatusLine`/`Banner` 一行说明；
  技术细节放进该行内的 `Disclosure`。正常状态**不写**“一切正常”占位文案。
- **开关前后不重复同一个动作。** 开发者面板打开时，折叠态的动作行要撤掉（同一动作同一时刻
  只出现一处），两边读同一份宿主事实、共用同一份状态。
- **锚点必须真的进 DOM。** 库组件要转发 `data-testid`（`SettingsCard`/`Badge`/
  `StatusLine`/`Banner` 已支持，其余控件透传 `...rest`），否则页面断言会静默失效。
- **命名锚点**：`suite-developer-toggle`（唯一开关）、`suite-developer-options`（展开的面板）、
  `suite-upgrade-available`（候选动作行）、`suite-upgrade-card`（面板内完整升级卡）、
  `suite-dev-actions`（维护与构建）、`suite-raw-state`（原始状态）。

#### 键值行的三条现场教训（rc.47 之后，未占号）

- **`ul` 必须复位。** `.omni-ui-kvList` 是 `<ul>`，缺少 `padding:0/list-style:none` 时用户代理给的 40px
  起始内边距会把 `1fr 1fr auto` 网格的**动作列整体推出卡片**（现场截图：复制按钮落在卡片边界外）。
  库内同类容器（`.omni-ui-list`）早有复位，新容器抄样式时必须连复位一起抄。
- **缩短是逐行选择，不是字体属性。** 用 `mono` 兼职"这是身份、要截断"曾把路径渲染成 `~`。
  现在 `shorten` 显式逐行声明：只有哈希/ID 缩短，路径、协议串、版本号完整显示（值列 `overflow-wrap:anywhere`
  负责换行）。规则一句话：**字体决定对齐，`shorten` 决定截断。**
- **标签列要定宽。** `minmax(0,1fr)` 的标签列会把 2 字标签撑到卡片一半宽，值看起来像居中。
  用 token `--omni-kv-label`（9rem）让值紧贴标签。

### 拒绝清单属于"为什么没认出来"，不属于历史日志

一组技术拒绝（候选目录被拒的原因）曾在页面上铺开 28 行，用户问"这个东西存在的意义是什么"——问得对。

- **可行动拒绝**：看着像候选却装不上（缺校验记录、字节漂移、运行时不符、目录不可读、未知码）→ 必须占页面：
  一行 warn 说明"有 N 个目录无法安装：<原因>"，下挂按原因分组的明细（每个原因一行，可展开）。
- **预期跳过**：不是更新版本、不是候选目录 → 每次读取都会发生，不是新闻 → **不占页面**，保留在"原始技术诊断"里
  可查（验收同时断言"页面上没有"和"原始诊断里有"，即"不喧哗"不等于"藏起来"）。
- 判据可复用：**这条拒绝会不会改变用户下一步动作？** 会 → 上页面；不会 → 进诊断。

### 开发者视图也要可读：键值行 + 动作行（2026-10-16，套件页 rc.47）

"技术内容进开发者开关后面"不等于"开发者视图可以是原始 state 转储"。用户在套件页看到的墙——
`dt/dd` 定义列表 + 四个 `—` 占位 + 64 位哈希 + 右下角孤立按钮——正是把内部状态当界面的结果。规则：

- **空值不渲染行，不渲染占位符。** `—` 在页面上读起来像坏掉的控件，而不是"没有这个信息"。
  `KeyValueList` 把这条写进组件：值为 `null`/`undefined`/`""` 的行整行丢弃；全空时渲染 `empty`，不给一张空卡。
- **长身份缩短上屏，完整值走复制。** `mono` 行的值用 `shortenIdentity`（首 12 位 + `…`），`title` 带完整值，
  `copy` 动作写剪贴板（`copyLabel`/`copiedLabel` 由调用方给，库不带 locale）。复制**只在真正写入后**才翻成
  "已复制"；无异步剪贴板时退化为临时选区 + `execCommand("copy")`，失败仍不谎报成功。
- **一行里既有文字又有按钮 → 先问是不是 `ListRow`。** 读动作属于它所报告的那一行：把"检查更新"塞进卡片
  footer 会让它和它所报告的状态分家（见「状态汇总行」的同一判据）。
- **同一事实只在一处渲染。** 候选版本曾同时出现在卡片徽标、定义列表和状态句里；现在一个状态行
  （徽标 + `当前 → 候选`）+ 一组键值行，别处不再复述。运行中版本与已安装版本**只在两者不同**时才各占一行
  ——相等时那行是噪音，而把"已安装"标成"运行中"则是错误陈述。
- **控制面取值不进文案。** `release`/`source` 这类枚举由 Client 词典翻成人话（`modeRelease`/`modeSource`），
  协议串、row id、绝对路径留在技术行里，不散落在状态句中间。
- **命名锚点**：`suite-identity-kv`、`suite-upgrade-kv`、`suite-upgrade-status-row`、`suite-upgrade-running`、
  `suite-identity-host-copy`（复制动作）、`suite-upgrade-checked`（用户动作的回执，仍在原来那个锚点上）。
- **React 属性**：宿主是 React，写 `className`，不是 `class`——`class` 会被丢弃并告警，样式因此静默不生效。

### 入口收敛：一行聚合 + 单一开关（2026-10-15，套件页 rc.44）

同一份能力**只允许一个用户入口**。searxng 曾经有两个：套件页的逐插件行（指向"去它的插件行配置"）
与官方插件页的设置卡。收敛规则与做法，可用于任何"套件页 vs 插件页"的取舍：

## 信息块与行的关系（ADR-048，2026-10-26）

- **块有标题，行在块内。** 页面上的信息块一律用 `SettingsCard`（标题 `.omni-ui-cardTitle`）；`ListRow` 不是一个块，它是块里的一个条目。把一块信息直接摊成一条裸行，读者无法判断它和邻居是什么关系。
- **标题右侧放元信息。** 回执类事实（「最近检查 23:04」/「尚未检查」）用 `.omni-ui-cardMeta`（12px、tertiary、400）放在标题行右端，与标题 baseline 对齐——它不该挤进行的副行。
- **卡内的行去框。** `ul.omni-ui-list.omni-ui-list--flush` 里的 `.omni-ui-listRow` 去掉描边/白底/内边距，靠卡的内边距分隔；直接嵌套会得到「卡一层框 + 行一层框」的双层边框。
- **空数据不出块。** 没有内容可说的块整块不渲染，避免「标题 + 一句读不到」的哑块。

对照图：`docs/design/upgrade-row-vs-card.svg`（一行 vs 一张卡）。

## 行内信息分级（ADR-049，2026-10-26）

页面上最贵的视觉单元是徽标（色块 + 边框 + 圆角）。每个徽标都在和别的东西抢注意力，所以：

- **徽标只表示"有后果的事实"**：连接状态（已连接 / 连接失败 / 需要登录）与作用域（用户 / 项目）。传输方式、凭证种类、协议版本、工具数量、provider、调用策略都是背景——写成一行 12px 灰色元信息（`ListRow` 的 `meta` 槽位 → `.omni-ui-metaLine`，`--omni-label-tertiary`），多个事实用 `·` 分隔。MCP 行原来五个等权徽标，把"已连接"这个唯一要一眼看到的淹没了。
- **一行只有一个徽标、一个动作一个入口**：就地铅笔（只改用途）与"打开整表单"的按钮不能都叫「编辑」，后者叫「设置」。危险动作放操作列最后，静止中性、悬停/聚焦变 danger、点击后实心红确认框——常驻红色会把最危险的动作变成视觉焦点。
- **行内分两区，行内不画分隔线**：身份区（标题 → 描述，`gap:3px`）与事实区（`.omni-ui-listFacts`，`margin-top:5px`）。行本身已有 1px 边框，行内再加线就是"框里切一刀"；而且行右侧有操作列，那条线必然左右不等宽。

## 行头基线：动作组贴第一行（ADR-052 / gaps §5.2，2026-10-26）

行是两列：身份区（`.omni-ui-listMain`）与动作组（`.omni-ui-listActions`）。行本身 `align-items:flex-start`，两块顶端对齐——**动作组内部也必须从顶端开始排**。

- `.omni-ui-listActions` 用 `align-items:flex-start`，**不要**再给它 `min-height:32px` + `align-items:center`：单行标题行高约 20px 时，按钮会在 32px 的盒子里居中，基线下移约 6px。技能页状态行与套件更新卡的行头偏移就是这一个机制（两处共用 `ListRow`，全仓只有 `Layout.tsx` 一个渲染点）。
- 修一次就够：**只改这条类**，不在页面里写内联 style 或补偿值（`check:client-ui` 会判红）。
- `.omni-ui-cardTitleRow`（卡片标题行）是 `align-items:baseline`，**没有这个问题**，别顺手改它——更新卡的偏差来自卡内那个 `ListRow`。
- 窄窗（`max-width:520px`）下动作组改为满宽换行左对齐，此时不存在左右两列，基线规则不适用，但**不要**在那里补固定高度。

执行者：`门禁：client-composition`（声明串：含 `align-items:flex-start`，不含 `align-items:center` / `min-height:32px`）＋ `门禁：client-mutations`（改回居中必须变红）＋ `人工：G5`（真 rect，y 差 ≤1px）。

## 卡片标题下的内缩分隔线（ADR-050，2026-10-26）

- 标题属于卡、内容跟在标题之后：`.omni-ui-cardStatic .omni-ui-cardBody` 带 `border-top:1px solid var(--omni-border)`，与折叠卡一致（静态卡过去把这条线关掉了）。
- **线内缩、左右对称**：`margin:0`，只在卡片自己的内边距内延伸（左右各 16px）。满宽会把它读成"两张卡的分界"，卡就散了。
- **间距由线分配**：卡 `gap:0`、标题 `padding-bottom:10px`、内容区 `padding-top:10px`，避免 `gap` 与 `padding` 叠加成断口。
- **没有 body 的卡不画线**，否则是"线下面空无一物"。
