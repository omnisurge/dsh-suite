/** A runtime skill travels inside the Suite, so deployment knowledge upgrades with the package
 * instead of drifting in one machine's skill directory. */
export const SKILL_NAME='omnisurge-web-setup';

export const SKILL_DESCRIPTION='部署 SearXNG 并把它接进本套件的联网搜索组件：先检查可达性、再改设置页的四项配置、最后用 check 验证；含凭据引用红线与诊断码对照。用户说「联网搜索配一下 / searxng 装不上 / 搜索 401 / 搜索结果为空」时使用。';

export const SKILL_CONTENT=`# SearXNG 部署与接入（Omnisurge Suite）

联网搜索走**用户自建的 SearXNG**：插件只调用，服务自己部署。顺序是
**问清场景 → 可达性检查 → 部署/保护 → 在插件页配置 → check 验证**，不要跳步。

## 1. 先问清三件事

1. 部署在哪：本机（只自己用）/ 内网或 VPS / 已有实例（只接入）；
2. 要不要对外：对外**必须**加 basic auth，否则等于开放一个公开搜索代理，很快被刷；
3. 有没有域名：有域名且能开 80/443 才能自动签证书，否则走内网 IP 或隧道。

## 2. 可达性检查（先做，别先装）

\`\`\`sh
curl -s -o /dev/null -w '%{http_code}\\n' --max-time 5 http://<host>:<port>/
\`\`\`

- 连接被拒 → 服务没起，或端口没放行；
- 401 → 服务端开了 basic auth，凭据要在凭据服务里配；
- 200 → 服务可用，去插件页填端点。

## 3. 部署（Docker 最小可用）

\`\`\`sh
docker run -d --name searxng -p 8081:8080 \\
  -v ./searxng:/etc/searxng --restart unless-stopped searxng/searxng:latest
\`\`\`

- 留出 2 GB 内存余量；数据卷指向自己的 \`settings.yml\`；
- 引擎在 \`settings.yml\` 的 \`engines:\` 里启用；引擎全关会出现「结果永远为空」；
- 需要鉴权时在反向代理（Caddy/Nginx）加 basic auth，**不要**把口令写进插件配置。

## 4. 在插件页配置（四项）

插件页「联网搜索（SearXNG）」卡片对应 Host 配置：

| 字段 | 含义 | 注意 |
|---|---|---|
| 端点 \`baseUrl\` | SearXNG 根地址 | 只接受 http(s)、不含凭据/查询/片段；填 \`http://host:8081\` 这种根 |
| 引擎组 \`engineGroup\` | \`default\` / \`auto\` / \`en\` / \`zh\` / \`custom\` | \`auto\` 按查询语言选 en/zh；\`custom\` 配自定义引擎 |
| 自定义引擎 \`customEngines\` | 逗号分隔的引擎名 | 仅 \`custom\` 生效 |
| 超时 \`timeoutMs\` | 单次搜索超时 | 内网慢时调到 15000–20000 |

- **凭据只放凭据服务**：配置里只写**引用名**（默认 \`SEARXNG_BASIC_AUTH\`），永不写口令明文；
- 端点留空 = 组件不启用（不会假装可用）；
- 保存后**下一次搜索即生效**，无需重启、无需新会话。

## 5. 验证（用工具，不靠感觉）

- \`searxng_setup\` 的 \`inspect\`：**不访问 SearXNG**，只读配置、默认值与生效值；
- \`searxng_setup\` 的 \`check\`：按当前语言组打一次真实查询，返回命中数、耗时、不可用引擎统计。

搜索失败先看诊断码，再决定改哪一项：

| 现象 | 通常原因 | 处置 |
|---|---|---|
| 连接被拒 / 超时 | 服务没起、端口/防火墙 | 先 curl 根地址 |
| 401 / 403 | basic auth 没配上 | 在凭据服务写 \`SEARXNG_BASIC_AUTH\` |
| 结果恒为空 | \`settings.yml\` 引擎没启用，或组名拼错 | 检查 \`engines:\` 与 \`engineGroup\` |
| 分组查询 0 条但全量有 | 该组引擎对这条查询无命中 | 组件会静默重打一次全量，不必改配置 |
| 保存报错 | 端点带了凭据/查询/片段 | 改成裸根地址 |

## 6. 红线

- 不把口令、API key 写进配置文件或日志；凭据只走凭据服务；
- 不为「让它看起来可用」而填假端点或放宽校验；
- 对外暴露的实例必须加鉴权与限流；
- 用户没有明确要求时，不改生产 profile、不重启应用。
`;

/** Registrar of a runtime skill. The official skill service exposes \`register\` for borrowed
 * definitions, so the Suite never writes into the user's own skill directory. */
export interface SkillRegistrar {
 register?(skill:{name:string;description:string;content:string}):unknown;
}

export function registerWebSetupSkill(skills:SkillRegistrar):void{
 skills.register?.({name:SKILL_NAME,description:SKILL_DESCRIPTION,content:SKILL_CONTENT});
}
