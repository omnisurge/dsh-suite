# 联网搜索（SearXNG）

面向官方 DSH **0.2.2-rc.2** 的独立扩展。当前版本随套件 0.2.5 提供，内置无需 Agent 的原生自助配置/诊断；地址留空禁用搜索，不连接预设服务器。

## 配置与校准

在官方插件页填写已有SearXNG地址，保存并测试：

- 匿名选择“无需认证”。Basic填写用户名与密码；仅适用服务/反向代理HTTP Basic，不适用网页表单、Cookie或CAPTCHA。URL不得嵌凭据。
- 公网建议HTTPS；在非标准本地HTTP地址发送凭据需明确确认风险。
- 秘值仅经官方credentials.set存储，配置只存引用。更换创建独立引用，不覆盖旧值或环境只读凭据；秘值不回读，输入框留空不清除既有凭据。
- 高级设置：引擎组、自定义names、100–60000ms总预算、现有凭据引用。**default为统一默认**，不传engines，使用服务器默认。旧all在原生schema/运行/保存期望中规范为default语义，不改成auto或自动重写原存储。
- auto按查询语言选en/zh（含已说明的纯汉字日语歧义）；明确en、zh、custom不被query语言覆盖。
- 校准明确en/zh只跑对应语言；default、auto、custom双语。预期域未命中是QUALITY_SUSPECT/degraded，不误当协议或配置阻断；认证、格式、无结果、超时/取消有明确码。probe原因去重聚合到顶层，不藏在blocked标签下。
- 校准仅针对已保存实例，不能证明全局web_search已选本provider，也不是通用相关性保证。UI保留脱敏DTO和实际schema。

## 显式引擎准入

名称语法合法≠当前部署存在；SearXNG可能忽略未知名字并用默认引擎返回HTTP200和结果，故它们不能作name准入证明。

每次显式组操作先在同endpoint请求 `/config`，依据公开 `engines[].name/enabled` 确认：内置en/zh是候选intent，只派发实例声明且enabled的交集；custom要求精确membership，用户显式选择的已声明disabled名字允许覆盖默认停用意图。正确新闻/微信名字含空格（例如google news、bing news、sogou wechat），不是下划线别名。

未知name、没有可用候选或catalog不可达/不合法都明确失败，**不发静默默认搜索**。请核对部署清单、代理权限、启用标志，或明确选择default；插件不改服务器、不固化某NAS特有列表。default不要求catalog，也不额外发此请求。catalog只在本次操作有效，不跨调用缓存成另一份“可用”事实。

catalog与search共凭据、取消与总预算、2MiB JSON限制；不把catalog响应证据当search响应。只有已准入组实际返回empty才允许一次受控fallback：auto到另一语言、明确组到default；同预算且可观察，HTTP/格式/准入错误不以fallback掩盖。

## 保存、并发与生命周期

原生ConfigForms revision/CAS固定编辑起点，包括仅改认证草稿；外部变更拒绝旧稿，丢弃后载入当前值。凭据和设置是两个事务：前者可成功而后者失败/未确认，必须先重载核对，不自动重试、删除、回滚或覆盖旧凭据。匿名仅清引用，不删除秘值。

保存并测试在Client/Host都比较已保存期望；all/default等价，其他真实变化拒绝且不探测caller传入的新endpoint。关闭页面取消诊断；已发送的官方写入不能承诺撤销，取消后不启动后续写入。UI凭据/设置等待最多10秒，超时是未确认而非未写入/成功。

URL保存/调用共原生校验，拒绝非法authority/协议/端口、query/fragment、凭据与重定向。停用/卸载释放provider、工具/Remote/Client贡献并取消 owned 请求，重启用不重复。

## 分发与构建边界

独立业务bundle与Suite二选一，不能同时选中或手工再insert。两者共相同business/provider身份；独立安装在业务页配置，Suite安全起手后明确安装内附固定archive为profile直接依赖、启用所属业务行，没有第二内嵌运行实例。源模式须官方正确link两包与完整Suite构建链。来源错误/双bundle须显式官方纠正，准备不重置配置或凭据。

固定build-target入口/协议与实际Host、浏览器revision及hostStamped/hostRemote/clientRemote/clientFlow都须匹配，不能用包version或编译成功替代就绪。结构性Remote/工具/peers变化需正常Suite/bootstrap加载；旧业务HMR不升级管理器自身。

rc.15是本地候选，不含生产激活、重启、部署、发布或清理档案授权。macOS隔离完整Web测试不替代Desktop/Windows/个人认证后端；适用门槛以原候选SHA和验收记录为准。Agent searxng_setup只inspect/check，无配置写入或服务器部署。

## 设置入口的唯一性

- 设置表单只注册**一次**：slot key = `<拥有该行的 bundle>#omnisurge-web-search-searxng`。拥有者由 Host 读官方 `pluginManager.listBundles()` 的 `BundleInfo.rows[].rowId` 决定，因此「套件布局」与「独立安装」各自都只有一个入口，不会因为两种可能拥有者而出现两个。
- 台账不可用（缺 `pluginManager` 或没有 bundle 声明该行）时回退到本包名 `@omnisurge/dsh-web-search-searxng`，并把原因作为 `diagnostic` 回报（客户端 `console.warn`），不静默、不产生第二个入口。
- 包名与行标识只在 `src/identity.ts` 声明一次，并断言与发布 patch 的行 id、套件组件集的 `rowId` 一致。
