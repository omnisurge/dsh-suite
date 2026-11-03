import type {Context} from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

// 同一份 JSON 声明（与 limit-mode.ts 共用），不再有两处常量。
import limits from '../../limits.json' with {type:'json'};

/** 卡片自己的行（ADR-060 D1 / ADR-062）：这张设置卡编辑的事实（极限模式）就住在这行的配置里，
 * 所以它有自己的设置命名空间可被官方 configForms 服务，用户也能单独关掉这张卡而不关整个套件。 */
export const name='omnisurge-agent-teams';
export const inject:string[]=[];
/** 默认值与运行期权威（limit-mode.ts 的 normalizeLimitMode）必须一致；两侧一致性由 test/agent-teams-row.test.mjs 断言，不靠注释。 */
export const LimitMode=z.object({
 enabled:z.boolean().default(false).description('Inject the user-authored prompt section when the current model matches.'),
 models:z.array(z.string()).default([...limits.defaultModels]).max(limits.maxModels).description('Model id patterns (case-insensitive substring); an empty list never matches.'),
 text:z.string().default(limits.extremePromptText).max(limits.maxText).description('Built-in prompt text for extreme mode (not user-editable in the card; shipped constant).'),
});
export const Config=z.object({
 // volatile() 不是装饰：官方 settings.describe() 对每个 entry 调 volatileForm(schema)，返回 undefined 的命名空间
 // 整条不进 describe 镜像——不标 volatile，这张卡的命名空间永远不会被服务，configForms.mutate 也会抛
 // "has no volatile fields"，卡在真机上根本不存在。它同时是「改完不用重启」的机制：loader 的 _commitVolatile
 // 只在 volatile 字段变化时把新值提交进运行中的引用（cordis-plugin-loader），普通字段变化才重启 fiber。
 limitMode:LimitMode.description('Extreme mode: one user-authored system-prompt section, only for matching models (off by default).').volatile(),
});
/** 这一行不带运行时能力：它提供的是设置命名空间与卡片的生命周期归属，业务读取仍在套件 Host 上。 */
export function apply(_ctx:Context):void{}
