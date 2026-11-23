import {mkdtemp,mkdir,readFile,readdir,rm,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const rawArgs=process.argv.slice(2);
const arg=rawArgs[0]==='--'?rawArgs[1]:rawArgs[0];
const packRoot=arg?resolve(arg):process.env.SUITE_PACK_DIR?resolve(process.env.SUITE_PACK_DIR):null;
const dsh=process.env.DSH_BIN??(process.platform==='win32'?join(root,'node_modules','.bin','dsh.cmd'):join(root,'node_modules','.bin','dsh'));
const profile='g6a-cli-web-host';
const timeouts={command:180000,start:120000,ui:60000};
const output=[];
function log(value){output.push(value);process.stdout.write(value+'\n');}
function run(command,args,env,timeout=timeouts.command){
 return new Promise((resolvePromise,reject)=>{
  const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],shell:process.platform==='win32'});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('COMMAND_TIMEOUT '+command+' '+args.join(' ')));},timeout);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0)reject(new Error('COMMAND_FAILED '+code+' '+signal+' '+command+' '+args.join(' ')+'\n'+stderr.slice(-4000)));else resolvePromise({stdout,stderr});});
 });
}
async function waitForServer(child){
 let buffer='';
 const started=Date.now();
 return new Promise((resolvePromise,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(new Error('WEB_HOST_START_TIMEOUT\n'+buffer.slice(-4000)));},timeouts.start);
  const cleanup=()=>{clearTimeout(timer);child.stdout.off('data',onData);child.stderr.off('data',onData);};
  const onData=chunk=>{buffer+=chunk;const match=buffer.match(/dsh web: (https?:\/\/[^\s]+)/);if(match){cleanup();resolvePromise(match[1]);}};
  child.stdout.on('data',onData);child.stderr.on('data',onData);
  child.on('error',error=>{cleanup();reject(error);});
  child.on('close',(code,signal)=>{if(Date.now()-started>=timeouts.start)return;cleanup();reject(new Error('WEB_HOST_EXITED '+code+' '+signal+'\n'+buffer.slice(-4000)));});
 });
}
async function waitHttp(url){
 const deadline=Date.now()+timeouts.start;
 while(Date.now()<deadline){
  try{const response=await fetch(url,{redirect:'manual'});if([200,303,307,308].includes(response.status))return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw new Error('WEB_HOST_HTTP_TIMEOUT');
}
async function closeBrowser(browser){try{await browser.close();}catch{}}
async function stopChild(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,1500));if(child.exitCode===null)child.kill('SIGKILL');}

const workspace=await mkdtemp(join(tmpdir(),'dsh-g6a-cli-web-host-'));
const home=join(workspace,'home'),dshHome=join(workspace,'dsh-home'),config=join(workspace,'config'),data=join(workspace,'data'),cache=join(workspace,'cache');
await Promise.all([home,dshHome,config,data,cache].map(dir=>mkdir(dir,{recursive:true})));
const env={...process.env,HOME:home,DSH_HOME:dshHome,XDG_CONFIG_HOME:config,XDG_DATA_HOME:data,XDG_CACHE_HOME:cache,NO_COLOR:'1',CI:'1'};
let child=null,browser=null;
try{
 if(!existsSync(dsh))throw new Error('DSH_BIN_NOT_FOUND '+dsh);
 if(!packRoot)throw new Error('SUITE_TARBALL_REQUIRED: pass a directory or tgz path');
 const info=await stat(packRoot);
 const tarball=info.isDirectory()?join(packRoot,(await readdir(packRoot)).filter(name=>name.endsWith('.tgz')).sort().at(-1)??''):packRoot;
 if(!tarball||!existsSync(tarball))throw new Error('SUITE_TARBALL_NOT_FOUND '+tarball);
 log('suite-tarball '+tarball);
 await run(dsh,['--profile',profile,'--from-default-profile','web','--dump-config'],env);
 await run(dsh,['plugin','--profile',profile,'add','file:'+tarball,'--ignore-scripts'],env);
 child=spawn(dsh,['--profile',profile,'--host','127.0.0.1','--no-open','--port','0'],{cwd:root,env,stdio:['ignore','pipe','pipe'],shell:process.platform==='win32'});
 const url=await waitForServer(child);
 await waitHttp(url);
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error.message??error).slice(0,300)));
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:timeouts.ui});
 await page.waitForTimeout(1000);
 for(const name of [/^(继续|Continue)$/]){
  const button=page.getByRole('button',{name});if(await button.count()){await button.first().click();await page.waitForTimeout(700);}
 }
 for(const name of [/^(关闭|Close)$/]){
  const button=page.getByRole('button',{name});if(await button.count()){await button.last().click();await page.waitForTimeout(500);}
 }
 await page.getByRole('button',{name:/^(插件|Plugins)$/}).first().click({timeout:timeouts.ui});
 const suiteCard=page.getByText(/万物生腾套件组|Omnisurge Suite/).first();
 await suiteCard.waitFor({state:'visible',timeout:timeouts.ui});
 const settingsCard=page.getByText(/多模态能力|Multimodal input/).first();
 await settingsCard.waitFor({state:'visible',timeout:timeouts.ui});
 const settingsText=await settingsCard.innerText();
 await page.getByRole('button',{name:/万物生腾套件组|Omnisurge Suite/}).first().click({timeout:timeouts.ui});
 await page.getByTestId('suite-development-manager').waitFor({state:'visible',timeout:timeouts.ui});
 log(JSON.stringify({ok:true,pluginPage:true,settingsCard:settingsText,suiteManager:true,pageErrors}));
}finally{
 await closeBrowser(browser);await stopChild(child);
 await rm(workspace,{recursive:true,force:true});
}
