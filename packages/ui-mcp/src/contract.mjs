import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = path => readFile(join(repositoryRoot, path), 'utf8');

/** Live projection, never an independently writable design specification. */
export async function getContract() {
  const paths = ['packages/ui/README.md', 'packages/ui/src/index.ts', 'packages/ui/src/tokens.ts', 'packages/ui/src/styles.ts'];
  const [readme, index, tokensSource, styles] = await Promise.all(paths.map(read));
  const contextBlock = /<!-- ui-mcp-contexts -->\s*```json\s*([\s\S]*?)```\s*<!-- \/ui-mcp-contexts -->/u.exec(readme);
  if (!contextBlock) throw Error('UI_CONTRACT_CONTEXT_MISSING');
  const contexts = JSON.parse(contextBlock[1]);
  const sections = readme.split(/(?=^#{2,4} )/mu).filter(part => part.trim());
  const rules = sections.filter(part => !part.includes('<!-- ui-mcp-contexts -->'));
  const tokens = Object.fromEntries([...tokensSource.matchAll(/(--omni-[\w-]+):\s*([^;\n]+);/gu)].map(m => [m[1], m[2].trim()]));
  if (!tokens['--omni-control-height']) throw Error('UI_CONTRACT_TOKENS_MISSING');
  const components = [];
  const sources = new Map();
  for (const match of index.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*["']\.\/([^"']+)\.js["']/gu)) {
    const names = match[1].split(',').map(s => s.trim()).filter(s => /^[A-Z][a-zA-Z]+$/u.test(s));
    if (!names.length) continue;
    const path = 'packages/ui/src/' + match[2] + '.tsx';
    const source = await read(path);
    sources.set(path, source);
    for (const name of names) {
      const definition = new RegExp('export function ' + name + '\\b');
      if (!definition.test(source)) throw Error('UI_CONTRACT_COMPONENT_SHAPE_CHANGED: ' + name);
      const before = source.slice(0, source.search(definition));
      const comment = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*$/u.exec(before)?.[1] ?? '';
      const status = comment.includes('@deprecated') ? 'deprecated' : comment.includes('@experimental') ? 'experimental' : 'stable';
      const documentation = rules.filter(section => section.includes(name));
      const examples = [...documentation.join('\n').matchAll(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/gu)].map(m => m[1]).filter(s => s.includes(name));
      const skeletons = Object.values(contexts).filter(c => c.skeleton.includes('<' + name)).map(c => c.skeleton);
      components.push({name, status, allowedImports:['@omnisurge/dsh-ui'], import: 'import { ' + name + ' } from "@omnisurge/dsh-ui";', sourcePath:path,
        // Full module preserves inherited React attributes, aliases and generic types instead of guessing a lossy props schema.
        props: source, propsFormat:'typescript-module (includes inherited types and all sibling declarations)', dom: source, documentation, examples: [...new Set([...examples, ...skeletons])],
        exampleNote: examples.length || skeletons.length ? 'Examples are extracted from the UI README; placeholders need business handlers.' : 'No dedicated README example; consult the exported signature and source, do not invent props.'});
    }
  }
  for (const context of Object.values(contexts)) for (const name of context.components) if (!components.some(c => c.name === name)) throw Error('UI_CONTRACT_UNKNOWN_COMPONENT: ' + name);
  const hash = createHash('sha256');
  for (const text of [readme,index,tokensSource,styles,...sources.values()]) hash.update(text);
  return {sourceDigest:hash.digest('hex'), sources:[...paths,...sources.keys()], contexts, components,
    tokens:{semantic:tokens, spacing:Object.fromEntries(Object.entries(tokens).filter(([name])=>name.startsWith('--omni-gap'))), controlHeight:tokens['--omni-control-height'],
      fontSizes:[...new Set([...styles.matchAll(/font-size:\s*([^;}]+)/gu)].map(m=>m[1]))],
      typography: rules.filter(s=>s.includes('正文 13px')||s.includes('辅助文字 12px')),
      badge: rules.filter(s=>s.includes('徽标类型'))},
    layoutRules: rules.filter(s=>s.includes('### 主页面根 vs 设置页栏宽')||s.includes('### Token 宿主')||s.includes('### 卡片解剖与徽标')),
    do: rules.filter(s=>s.includes('工程约定')||s.includes('表单与布局约定')),
    dont: rules.filter(s=>s.includes('动作分两级')||s.includes('卡片解剖与徽标')||s.includes('操作层级和危险分组')),
    gapPolicy: sections.find(s=>s.startsWith('## 开发工具与缺口协议'))?.split('下面是开发工具')[0]};
}
