import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,isAbsolute,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
/** Deliberately never spread the parent environment into a validation subprocess. */
export async function isolatedEnvironment(root,parent=process.env){
  root=resolve(root);
  const home=join(root,'home'),dsh=join(root,'dsh'),config=join(root,'config'),cache=join(root,'cache'),temp=join(root,'tmp'),data=join(root,'data');
  for(const path of [home,dsh,config,cache,temp,data,join(data,'roaming'),join(data,'local')])await mkdir(path,{recursive:true,mode:0o700});
  const userconfig=join(config,'npmrc'),globalconfig=join(config,'npmrc-global');
  await writeFile(userconfig,'registry=https://registry.npmjs.org/\nignore-scripts=true\n',{mode:0o600});await writeFile(globalconfig,'',{mode:0o600});
  const env={PATH:parent.PATH??parent.Path??dirname(process.execPath),HOME:home,USERPROFILE:home,DSH_HOME:dsh,
    XDG_CONFIG_HOME:config,XDG_CACHE_HOME:cache,XDG_DATA_HOME:data,XDG_STATE_HOME:join(data,'state'),
    APPDATA:join(data,'roaming'),LOCALAPPDATA:join(data,'local'),TMPDIR:temp,TMP:temp,TEMP:temp,
    npm_config_userconfig:userconfig,npm_config_globalconfig:globalconfig,npm_config_cache:join(cache,'npm'),npm_config_store_dir:join(cache,'pnpm'),
    npm_config_ignore_scripts:'true',npm_config_registry:'https://registry.npmjs.org/',COREPACK_HOME:join(cache,'corepack'),
    PNPM_HOME:join(data,'pnpm'),GIT_CONFIG_GLOBAL:join(config,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1',CI:'true',LANG:'C.UTF-8'};
  if(process.platform==='win32'){for(const key of ['SystemRoot','SystemDrive','ComSpec','PATHEXT'])if(parent[key])env[key]=parent[key];}
  const paths={HOME:home,DSH_HOME:dsh,XDG_CONFIG_HOME:config,XDG_CACHE_HOME:cache,XDG_DATA_HOME:data,XDG_STATE_HOME:env.XDG_STATE_HOME,
    APPDATA:env.APPDATA,LOCALAPPDATA:env.LOCALAPPDATA,TMPDIR:temp,npm_config_userconfig:userconfig,npm_config_globalconfig:globalconfig,
    npm_config_cache:env.npm_config_cache,npm_config_store_dir:env.npm_config_store_dir,COREPACK_HOME:env.COREPACK_HOME,PNPM_HOME:env.PNPM_HOME,GIT_CONFIG_GLOBAL:env.GIT_CONFIG_GLOBAL};
  for(const path of Object.values(paths)){const rel=relative(root,path);if(!isAbsolute(path)||rel.startsWith('..')||isAbsolute(rel))throw Error('Isolation path escapes validation root');}
  await writeFile(env.GIT_CONFIG_GLOBAL,'',{mode:0o600});
  const probe=spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.env))'],{env,cwd:root,encoding:'utf8',timeout:10000});
  if(probe.status!==0)throw Error('Child environment probe failed: '+probe.stderr);
  const actual=JSON.parse(probe.stdout);
  for(const [key,value] of Object.entries(env))if(actual[key]!==value)throw Error('Child environment mismatch: '+key);
  // CoreFoundation initializes this key itself on macOS even with a clean exec environment.
  const generated=process.platform==='darwin'&&/^0x[0-9a-f]+:0x[0-9a-f]+:0x[0-9a-f]+$/i.test(actual.__CF_USER_TEXT_ENCODING??'')?['__CF_USER_TEXT_ENCODING']:[];
  const unexpected=Object.keys(actual).filter(key=>!Object.hasOwn(env,key)&&!generated.includes(key));
  if(unexpected.length)throw Error('Unexpected child environment keys: '+unexpected.join(','));
  return {env,home:dsh,paths,boundaries:{isolatedHome:true,isolatedDshHome:true,isolatedUserData:true,isolatedPackageConfiguration:true,isolatedCaches:true,isolatedTemp:true,childEnvironmentVerified:true,parentInheritance:'PATH and Windows process-launch keys only',systemGeneratedEnvironmentKeys:generated}};
}
