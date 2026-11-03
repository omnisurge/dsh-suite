import { mkdir, lstat, open, link, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getContract, repositoryRoot } from './contract.mjs';
import { scanClientSource } from '../../../scripts/gates/client-ui-vocabulary.mjs';

const string = (maxLength = 2000) => ({type:'string',minLength:1,maxLength});
const schema = (properties, required = []) => ({type:'object',properties,required,additionalProperties:false});
export const toolDefinitions = [
  {name:'ui_get_context',description:'Read a README page/pattern context: settings, main, bundle, card, list. Unknown contexts are rejected.',inputSchema:schema({page:string(100),pattern:string(100)})},
  {name:'ui_list_components',description:'List public UI components and source-owned stability.',inputSchema:schema({})},
  {name:'ui_get_component',description:'Read component props declarations, DOM source, README examples/limitations and allowed imports.',inputSchema:schema({name:string(100)},['name'])},
  {name:'ui_get_tokens',description:'Read live semantic tokens, spacing, typography, control heights and Badge semantics.',inputSchema:schema({})},
  {name:'ui_validate',description:'Static shared-gate validation only; no execution, rendering or automatic repair.',inputSchema:schema({source:string(200000)},['source'])},
  {name:'ui_request_gap',description:'Record a development gap; does not generate code or approve a new component.',inputSchema:schema({name:string(100),page:string(200),need:string(4000),whyExistingCannotCompose:string(4000)},['name','page','need','whyExistingCannotCompose'])},
].map(tool=>({...tool,annotations:{readOnlyHint:tool.name!=='ui_request_gap',destructiveHint:false,openWorldHint:false}}));

export class InvalidArguments extends Error {}
export function validateArguments(definition, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new InvalidArguments('arguments must be an object');
  for (const key of Object.keys(args)) if (!Object.hasOwn(definition.inputSchema.properties,key)) throw new InvalidArguments('unexpected argument: '+key);
  for (const key of definition.inputSchema.required) if (!Object.hasOwn(args,key)) throw new InvalidArguments('missing argument: '+key);
  for (const [key,value] of Object.entries(args)) {
    const rule=definition.inputSchema.properties[key];
    if (typeof value !== 'string'||!value.trim()||value.length>rule.maxLength) throw new InvalidArguments('invalid string: '+key);
  }
}

/** Fixed repository-owned directory; tool input never controls filesystem paths. */
export async function recordGap(args, root = repositoryRoot) {
  for (const dir of [join(root,'.scratch'),join(root,'.scratch','ui-mcp-gaps')]) {
    try { await mkdir(dir,{mode:0o700}); } catch(error) { if(error.code!=='EEXIST')throw error; }
    const info=await lstat(dir);
    if (!info.isDirectory()||info.isSymbolicLink()) throw Error('GAP_DIRECTORY_NOT_OWNED');
  }
  const id=randomUUID();
  const path=join(root,'.scratch','ui-mcp-gaps',id+'.json');
  const record={id,createdAt:new Date().toISOString(),status:'requested',...args};
  const temporary=path+'.pending';
  const handle=await open(temporary,'wx',0o600);
  try {
    try { await handle.writeFile(JSON.stringify(record,null,2)+'\n'); await handle.sync(); } finally { await handle.close(); }
    // Publish completed bytes without overwriting any existing record; readers only use *.json.
    await link(temporary,path);
  } finally { await unlink(temporary); }
  return {id,status:'requested',path:relative(root,path),generatedCode:false};
}

export async function callTool(name,args={},options={}) {
  const definition=toolDefinitions.find(tool=>tool.name===name);
  if (!definition) throw new InvalidArguments('unknown tool: '+name);
  validateArguments(definition,args);
  if(name==='ui_request_gap') return recordGap(args,options.gapRoot);
  if(name==='ui_validate') {
    const violations=scanClientSource('input.tsx',args.source,{strictImports:true});
    return {valid:violations.length===0,violations:violations.map(message=>({message,suggestion:message.split('——')[1]?.trim()??'Use the documented UI primitive or record a gap before implementation.'})),
      limitations:['Static lexical checks, not a JavaScript/TypeScript parser; computed props, aliases and runtime composition require review.','Action meaning, one status per logical row, accessibility and measured layout require manual/G5 verification.']};
  }
  const contract=await getContract();
  if(name==='ui_list_components')return {sourceDigest:contract.sourceDigest,components:contract.components.map(({name,status,sourcePath})=>({name,status,sourcePath}))};
  if(name==='ui_get_tokens')return {sourceDigest:contract.sourceDigest,...contract.tokens};
  if(name==='ui_get_component') {
    const component=contract.components.find(c=>c.name===args.name);
    if(!component)throw new InvalidArguments('unknown component: '+args.name);
    return {sourceDigest:contract.sourceDigest,...component};
  }
  const key=args.pattern??args.page;
  if(!key||!Object.hasOwn(contract.contexts,key))throw new InvalidArguments('choose page/pattern: '+Object.keys(contract.contexts).join(', '));
  if(args.page&&args.pattern&&args.page!==args.pattern)throw new InvalidArguments('page and pattern must identify the same context');
  return {sourceDigest:contract.sourceDigest,context:key,...contract.contexts[key],tokens:contract.tokens,layoutRules:contract.layoutRules,do:contract.do,dont:contract.dont,gapPolicy:contract.gapPolicy};
}
