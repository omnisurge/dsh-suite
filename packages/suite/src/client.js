import * as React from 'react';
import {ActionGroup,Badge,Banner,Button,Checkbox,Disclosure,Field,FormGrid,KeyValueList,ListRow,Select,SettingsCard,StatusLine,TextInput,injectStyles,showConfirm,showToast} from '@omnisurge/dsh-ui';
import {TYPERT_REMOTE as REMOTE} from '../lib/typert.remote-client.js';
import {developmentReadiness} from './src/readiness.js';
import {apply as applySearchClient, inject as SEARCH_CLIENT_INJECT} from './src/search/client.js';
import {applyToolsPanel} from './src/tools/client.js';
import {apply as applyTeamsCard, inject as TEAMS_CARD_INJECT} from './src/teams/client.js';
import {applyCompactionBudgetCard, BUDGET_CARD_INJECT} from './src/compaction-budget/client.js';
import {apply as applyOcrCard, inject as OCR_CARD_INJECT} from './src/ocr/client.js';
import {apply as applyEffortSlider, inject as EFFORT_SLIDER_INJECT} from './src/effort-slider/client/index.tsx';
import * as SEARCH_FLOW from './src/search/client-flow.js';
import {renderTechnicalFailure} from './src/failure-view.js';
import {fillTemplate} from './src/shared/client-copy.js';
import {unwrapRemoteResult} from './src/shared/client-remote.js';
import {buildCapabilityOverview} from './src/suite/capability-overview.js';
import {createSuiteTransport} from './src/suite/upgrade-flow.js';
import {UpgradeAnnouncer} from './src/ambient.ts';
import {en,zh} from './src/suite/locale.js';
import {convergeUpgradeReceipt} from './src/upgrade-receipt.mjs';
import {VERIFIED_RUNTIMES,bootReleaseVersion,runtimeNoticeKey,runtimeVerdict} from './src/runtime-guard.ts';
// A namespaced Remote service is read through `inject`: reading `remote.<namespace>` anywhere else throws
// `cannot get property "remote.<namespace>" without inject` (Cordis Context trap). The page surface stays
// registered without it, so an unreachable Host names the reason instead of deleting the surface.
const NAMESPACE_INJECT=['remote','remote.omnisurgeSuiteDev'];
/** ADR-040: the running release is a fact only the page can observe (the official boot manifest). Every
 * upgrade question carries it, so the Host can refuse a candidate that was verified on a different release
 * instead of installing it and finding out at the next boot. */
const observedRuntime=()=>bootReleaseVersion(globalThis.__DSH_BOOT__)??undefined;
// Ambient discovery is a bounded cadence, not a poll loop: a release directory changes at human speed.
// The first read retries on a short budget (the owned Remote may not be mounted yet at apply time), and
// returning to the application checks again -- that is when the user can act on an announcement.
const AMBIENT_INTERVAL_MS=600000;
const AMBIENT_FIRST_DELAY_MS=5000;
const AMBIENT_FIRST_ATTEMPTS=12;
const MULTIMODAL_POLL_INTERVAL_MS=10000;
const h=React.createElement,NS='omnisurge.suite.development';
// ADR-068: the update source is the Host row's own configuration (Config.updateSource is .volatile()), so the
// official settings form is the one write path. A settings namespace is the profile entry id, which for this
// bundle is the row this repository inserts — never a second store and never a copy of the value.
const CONFIG_NS='omnisurge-suite-development';
const UPDATE_KINDS=['local','github'];
const UPDATE_CHANNELS=['stable','prerelease'];
/** ADR-068 (2026-10-29 修订): the fetcher's eight refusal codes are machine facts. Every one of them reaches
 * the user as "no update" plus this page's own sentence; the code itself only appears inside the one
 * technical disclosure. A code with no entry here is still named as a code (refusalOther), never hidden. */
const FETCH_KEYS={FETCH_NETWORK_UNREACHABLE:'fetchNetworkUnreachable',FETCH_ASSET_MISSING:'fetchAssetMissing',FETCH_CHECKSUM_MISMATCH:'fetchChecksumMismatch',FETCH_COMPONENT_MANIFEST_MISMATCH:'fetchComponentManifestMismatch',FETCH_VERSION_STALE:'fetchVersionStale',FETCH_TOKEN_MISSING:'fetchTokenMissing',FETCH_ABORTED:'fetchAborted',FETCH_REDIRECT_REFUSED:'fetchRedirectRefused'};
const isFetchCode=code=>typeof code==='string'&&Object.prototype.hasOwnProperty.call(FETCH_KEYS,code);

export default {
 inject:['slots','locale','remote'],
   apply(rootCtx){
    // Two independent contributions, each guarded: a failure in one surface must be reported, never
    // silently delete the other. That is exactly how the management switch used to disappear.
    const guard=(label,run)=>{try{return run();}catch(issue){console.error('[suite] '+label+' failed: '+String((issue&&issue.message)??issue));return undefined;}};
    // Independent ownership: the carried module's settings card is registered by its own effect, at the
    // top level of apply. Nothing about the token sheet, the remote mount or the Suite page below can
    // suppress it, and removing this line removes exactly one contribution.
    guard('searxng client contribution',()=>rootCtx.effect(()=>{const contribution=rootCtx.inject(SEARCH_CLIENT_INJECT,inner=>{applySearchClient(inner,{remote:REMOTE,flow:SEARCH_FLOW});});return()=>contribution.dispose();},'omnisurge: searxng client contribution'));
    // The library owns the token sheet (ADR-028); it is registered on the plugin's own context so the
    // styles follow this plugin's lifetime, independent of the Remote mount and of the management page.
    // Agent Teams / 极限模式 / 环境笔记：同一套独立 owner 规则——卡片在自己的 effect 里注册，本行删掉
    // 就只少这一张卡，不影响 token sheet、Remote 挂载或套件管理页。
    guard('teams settings card',()=>rootCtx.effect(()=>{const contribution=rootCtx.inject(TEAMS_CARD_INJECT,inner=>{applyTeamsCard(inner);});return()=>contribution.dispose();},'omnisurge: teams card contribution'));
    // ADR-104: optional parameter editing is independent of the Suite management surface.
    guard('budget settings card',()=>rootCtx.effect(()=>{const contribution=rootCtx.inject(BUDGET_CARD_INJECT,inner=>{applyCompactionBudgetCard(inner);});return()=>contribution.dispose();},'omnisurge: budget card contribution'));
    guard('ocr settings card',()=>rootCtx.effect(()=>{const contribution=rootCtx.inject(OCR_CARD_INJECT,inner=>{applyOcrCard(inner);});return()=>contribution.dispose();},'omnisurge: ocr card contribution'));
    // ADR-088: shadow the official conversation.input.model seat at priority -100. The official
    // ui-model-selection plugin stays loaded: it owns modelDirectories and /model; our component only
    // replaces the composer seat. The slot's priority ladder is the seat competition, so disabling this
    // contribution restores the official selector without touching official rows.
    guard('effort slider seat',()=>rootCtx.inject(EFFORT_SLIDER_INJECT,inner=>{applyEffortSlider(inner);}));
    guard('suite ui token sheet',()=>rootCtx.effect(()=>{injectStyles();},'omnisurge: suite ui token sheet'));
    // The owned Remote is one shared capability, not part of one page: both the management surface and the
    // skills · MCP panel read remote.omnisurgeSuiteDev, so it is mounted once, here, at the top level of apply.
    // Mounting twice is refused by validation while the first mount stays in force; the outcome is evidence
    // (not a swallowed log line) that each surface quotes in its own failure sentence.
    const remoteState={mountError:null};
    guard('owned remote mount',()=>rootCtx.effect(async()=>{
     try{await rootCtx.remote.$mount(REMOTE);remoteState.mountError=null;}
     catch(issue){remoteState.mountError=String((issue&&issue.message)??issue);console.error('[suite] owned Remote mount failed: '+remoteState.mountError);}
    },'omnisurge: mount the owned Remote'));
    // The skills · MCP panel is its own contribution with its own owner: the sidebar entry, the main page,
    // both locale pairs, the token sheet and the namespace handle all follow this inject scope, so removing
    // it removes exactly one entry and one page. It never depends on the Remote being mounted: an unreachable
    // Host leaves the page explaining itself, and the page is registered before the read is attempted.
    guard('skills-mcp panel',()=>rootCtx.inject(['slots','locale','remote'],ctx=>applyToolsPanel(ctx,{mountError:()=>remoteState.mountError})));
    // The management surface is registered synchronously at the top level of apply. The Remote handle only
    // adds capability; gating this registration on it is what once made the developer switch disappear.
    guard('suite management contribution',()=>rootCtx.effect(()=>{
     const contribution=rootCtx.inject(['remote','slots','locale'],ctx=>{
      // `remote.omnisurgeSuiteDev` is a Cordis service, not a field: reading it from a context that does not
      // declare it in `inject` throws `cannot get property "remote.omnisurgeSuiteDev" without inject`. The
      // handle therefore lives in its own scoped inject, while the page itself stays registered whether or
      // not the Host side is reachable -- gating the whole surface on the namespace is what once removed
      // the developer switch, and reading it undeclared is what the page reported as a connection failure.
      const wire={namespace:null,form:null,credentials:null};
      ctx.inject(NAMESPACE_INJECT,inner=>{
       wire.namespace=inner.remote.omnisurgeSuiteDev;
       return ()=>{wire.namespace=null;};
      });
      // ADR-068: the update source is this row's own configuration fact, so the official settings form is its
      // only write path. Both handles live in their own scoped injects: a profile without the settings or the
      // credentials service keeps the page and gets one readable sentence, instead of losing the surface.
      ctx.inject(['configForms'],inner=>{
       try{wire.form=inner.configForms.get(CONFIG_NS);}catch{wire.form=null;}
       return ()=>{wire.form=null;};
      });
      ctx.inject(['remote','remote.credentials'],inner=>{
       wire.credentials=inner.remote.credentials??null;
       return ()=>{wire.credentials=null;};
      });
      const {call,callRead,callWithRuntimeRead,upgradeOutcome,isStaleHost,markStaleHost}=createSuiteTransport({wire,remoteState,observedRuntime});
      // Ambient discovery: a new Suite version must not wait for the user to open this page. One
      // announcement per version per session -- the durable card above stays the record -- and nothing is
      // ever installed without an explicit confirmation, so this path can never mutate the profile by itself.
      const ambient=new UpgradeAnnouncer();
      const ambientLanguage=()=>{try{return String(ctx.locale?.getLocale?.().active??'en').toLowerCase().startsWith('zh')?'zh':'en';}catch{return 'en';}};
      const say=(key,values={})=>{
       const dict=ambientLanguage()==='zh'?zh:en;
       const text=typeof dict[key]==='string'?dict[key]:(typeof en[key]==='string'?en[key]:key);
       return fillTemplate(text,values);
      };
      // The announcement path lives outside the Manager component: it publishes the outcome through this
      // sink, which the component fills in on mount. Calling the component setter from here would be an
      // unresolved reference (round-2 review N1).
      const outcomeSink={current:null};
      const installAmbient=version=>{
       showConfirm({title:say('upgradeConfirmTitle',{version}),text:say('upgradeConfirmBody'),cancelLabel:say('upgradeCancel'),confirmLabel:say('upgradeConfirmRun'),tone:'danger',
        onConfirm:()=>{void(async()=>{
         const progress=showToast({text:say('upgradeInstalling',{version}),kind:'suite-upgrade-progress',tone:'info',durationMs:null,closeLabel:say('closeLabel')});
         const outcome=await upgradeOutcome(version);
         progress.close();
          // review B3: the announcement path writes the same receipt the card reads, so a success cannot
          // leave the card saying "no action needed" and a failure cannot vanish with its toast.
          if(outcomeSink.current)outcomeSink.current(outcome,version);
         if(outcome.state==='restart')showToast({text:say('upgradeInstalledRestart',{version:outcome.target}),kind:'suite-upgrade-progress',tone:'ok',durationMs:20000,closeLabel:say('closeLabel')});
         else if(outcome.state==='submitted')showToast({text:say('upgradeInstallSubmitted').replace('{code}',String(outcome.code??'SUITE_UPGRADE_SUBMITTED')),kind:'suite-upgrade-progress',tone:'warn',durationMs:30000,closeLabel:say('closeLabel')});
         else if(outcome.state==='unknown')showToast({text:say('upgradeInstallUnconfirmed').replace('{code}',String(outcome.code??'SUITE_UPGRADE_UNCONFIRMED')),kind:'suite-upgrade-progress',tone:'warn',durationMs:30000,closeLabel:say('closeLabel')});
         // 失败提示不再常驻：以前是 durationMs:null，一次早期失败会一直挂着，看起来像“这次也没装上”。
         else if(outcome.code==='UPGRADE_PROFILE_STORE_MISMATCH')showToast({text:say('upgradeDetailStoreMismatch'),kind:'suite-upgrade-progress',tone:'error',durationMs:30000,closeLabel:say('closeLabel')});
         else showToast({text:say('upgradeInstallFailed').replace('{code}',String(outcome.code??'UPGRADE_UNCONFIRMED')),kind:'suite-upgrade-progress',tone:'error',durationMs:30000,closeLabel:say('closeLabel')});
        })();}});
      };
      // Returns whether the Host answered at all; silence about a candidate is still a reached Host.
      // ADR-068 D5: a background check is still a check, so it asks the one Remote that is allowed to touch the
      // network. `upgradeStatus` only reads the directories that are already on disk -- asking it here would
      // mean the Suite never looks for a new release at all, which is a missing feature, not a cheap one.
      const checkAmbient=async()=>{
       try{
        const candidate=await callWithRuntimeRead('checkRelease'),latest=candidate&&candidate.latest?{version:String(candidate.latest.version??''),currentVersion:candidate.currentVersion??null}:null;
        const version=ambient.decide(latest);
        if(version!==null)showToast({text:say('upgradeAmbient',{version,current:String(candidate.currentVersion??'')}),kind:'suite-upgrade-available',tone:'warn',durationMs:20000,closeLabel:say('closeLabel'),
         action:{label:say('upgradeAmbientAction'),run:()=>installAmbient(version)}});
        return true;
       }catch{
        // Reachability and refusals are the page own topic; ambient discovery stays silent instead of
        // inventing a second, contradictory connection notice.
        return false;
       }
      };
      ctx.effect(()=>{
       let stopped=false,timer=null,attempts=0,inFlight=false;
       const tick=async()=>{
        if(stopped||inFlight)return;
        inFlight=true;
        let reached=false;
        try{reached=await checkAmbient();}finally{inFlight=false;}
        if(stopped)return;
        // A boot-time miss retries on a fixed budget (the Remote mounts after apply); afterwards the
        // cadence is the long one, so an unreachable Host cannot turn this into a retry loop.
        if(!reached&&attempts<AMBIENT_FIRST_ATTEMPTS)attempts+=1;else attempts=0;
        const delay=reached===false&&attempts>0?AMBIENT_FIRST_DELAY_MS:AMBIENT_INTERVAL_MS;
        timer=setTimeout(()=>void tick(),delay);
       };
       const onReturn=()=>{if(document.visibilityState==='hidden')return;attempts=0;if(timer!==null)clearTimeout(timer);void tick();};
       document.addEventListener('visibilitychange',onReturn);
       window.addEventListener('focus',onReturn);
       void tick();
       return ()=>{stopped=true;if(timer!==null)clearTimeout(timer);document.removeEventListener('visibilitychange',onReturn);window.removeEventListener('focus',onReturn);};
      },'suite ambient upgrade discovery');
      ctx.effect(()=>ctx.locale.register(NS,{en,zh}),'suite manager: locale');
      function Manager({t:translate}){
       const [state,setState]=React.useState(null),[components,setComponents]=React.useState(null),[upgrade,setUpgrade]=React.useState(null),[multimodal,setMultimodal]=React.useState(null),[error,setError]=React.useState(null),[confirmed,setConfirmed]=React.useState(false),[upgradeReceipt,setUpgradeReceipt]=React.useState(null),[upgradeError,setUpgradeError]=React.useState(null),[upgradeBusy,setUpgradeBusy]=React.useState(false);
       // ADR-068 (2026-10-29 修订): 勾选框与人话确认一起删除——确认就是那次绑定版本的主按钮点击。卡片只保留
       // “你会付出什么”的告知（当前版本 · 装完退出并重开），不再要第二次点击。
       // 检查回执与安装回执是两条事实：检查回答里带着抓取器的码（FETCH_*），而之后的读盘回答没有它，所以它必须
       // 自己活下来，直到下一次检查覆盖它；这也是“用户点过检查”的唯一可见回执（AGENTS 5.9）。
       const [checkReceipt,setCheckReceipt]=React.useState(null),[checkFailure,setCheckFailure]=React.useState(null);
       // 更新来源是这一行自己的配置（Config.updateSource 已 volatile），页面只做草稿 + 官方设置表单写入。
       const [sourceDraft,setSourceDraft]=React.useState(null),[sourceNotice,setSourceNotice]=React.useState(null),[configTick,setConfigTick]=React.useState(0),[credentialState,setCredentialState]=React.useState('unknown');
      // A release install is the normal case and is already stated once, in the developer panel; the other
      // three notices are developer facts. The Host sends codes; the wording above is this page's own.
      const noticeText=(()=>{const code=state?.notice?.code;
       if(code==='HMR_ENABLED')return translate('noticeHmrEnabled');
       if(code==='HMR_UNCONFIRMED')return translate('noticeHmrUnconfirmed');
       if(code==='HOST_PROTOCOL_OLD')return translate('noticeHostProtocolOld');
       return null;})();
       React.useEffect(()=>{outcomeSink.current=(outcome,version)=>{setUpgradeReceipt(outcome.state==='restart'?{code:'SUITE_UPGRADE_RESTART_REQUIRED',target:version,operations:outcome.operations,diagnostic:outcome.diagnostic,onDisk:outcome.onDisk??version,activationUnconfirmed:true}:{code:outcome.code,target:version,operations:outcome.operations,diagnostic:outcome.diagnostic,onDisk:outcome.onDisk??null});};},[]);
        const [developer,setDeveloper]=React.useState(()=>{try{return window.localStorage.getItem('omnisurge.suite.developer')==='1';}catch{return false;}});
        const toggleDeveloper=value=>{setDeveloper(value);try{window.localStorage.setItem('omnisurge.suite.developer',value?'1':'0');}catch{}};
       // A click that changes nothing visible looks like a dead button: a user-initiated read announces
       // itself while it runs and records when it last answered. The background poll stays silent.
        // ADR-047 D3 + review B1: one convergence point for the install receipt. A receipt survives only
        // while it still describes the current attempt: bytes at the target turn it into "installed, restart
        // required"; a candidate no longer offered (or a profile that never reached the target) drops it. This
        // runs on every read -- including the silent poll -- so a stale failure can never outlive the fact.
        // A written durable record is its own verdict even when the current Client generation has no receipt
        // (the upgrade reloaded the Client before its old instance could receive the reply). Adopt it once per
        // generation: after the app restarts, running===target and the record stops producing a banner.
        // The decision lives in one pure module (ADR-047 D3 / ADR-079). In particular, a durable record
        // from an earlier attempt must not outlive the profile's actual on-disk identity; otherwise an
        // official CLI update from 0.3.6-4 to 0.3.6-5 leaves an orange "installed 0.3.6-4 / restart" card.
        const convergeReceipt=convergeUpgradeReceipt;
        const receiptRef=React.useRef(null);
        React.useEffect(()=>{receiptRef.current=upgradeReceipt;});
       const read=async announce=>{
        if(announce)setCheckBusy(true);
        try{
         const next=await callRead('status'),set=await callRead('componentsStatus'),candidates=await callWithRuntimeRead('upgradeStatus');
         setState(next);setComponents(set);setUpgrade(candidates);setError(null);
          {const converged=convergeReceipt(receiptRef.current,candidates);if(converged!==receiptRef.current){receiptRef.current=converged;setUpgradeReceipt(converged);if(converged===null)setUpgradeError(null);}}
         if(announce)setCheckedAt(new Date().toLocaleTimeString());
        }catch(issue){setError(String(issue&&issue.message?issue.message:issue));}
        finally{if(announce)setCheckBusy(false);}
       };
       // ADR-068 D5: “检查更新” is the one user action that may touch the network, so it asks the one Remote that
       // is allowed to: checkRelease(). upgradeStatus reads the disk only, so using it here would mean the button
       // never checks anything. The disk read afterwards is what fills the identity/component/heal facts.
       const runCheck=async()=>{
        if(checkBusy)return;
        setCheckBusy(true);setCheckFailure(null);
        let answered=false;
        try{
         const answer=await callWithRuntimeRead('checkRelease');
         answered=true;
         setUpgrade(answer);setError(null);
         const refusals=Array.isArray(answer&&answer.refusals)?answer.refusals:[];
         const fetch=refusals.find(item=>isFetchCode(item&&item.code))??null;
         // The code is kept for the technical disclosure only; the row renders this page's own sentence.
         setCheckReceipt(fetch===null?null:{code:String(fetch.code),directory:typeof fetch.directory==='string'?fetch.directory:null,
          reasonKey:FETCH_KEYS[String(fetch.code)]});
        }catch(issue){
         const raw=String((issue&&issue.message)||issue);
         // 装完未重启的窗口：旧 Host 没有 checkRelease。这不是通道坏了，而是这个进程还没有新 Host——
         // 页面说“重启后再检查”，并且退回读盘（读盘仍是旧 Host 能给的全部答案）。
         if(/^SUITE_NAMESPACE_MISSING checkRelease/.test(raw)&&wire.namespace){markStaleHost();}
         else setCheckFailure({code:typeof issue?.code==='string'&&issue.code.length>0?issue.code:raw,at:new Date().toLocaleTimeString()});
        }finally{
         await read();
         if(answered)setCheckedAt(new Date().toLocaleTimeString());
         setCheckBusy(false);
        }
       };
       const dismissHeal=async entryId=>{
        setHealBusy(entryId);
        try{await call('healAcknowledge',entryId);await read(true);}
        catch(issue){setError(String(issue&&issue.message?issue.message:issue));}
        finally{setHealBusy(null);}
       };
       const rescanHeal=async()=>{setCheckBusy(true);try{await call('healScan');await read(true);}catch(issue){setError(String(issue&&issue.message?issue.message:issue));}finally{setCheckBusy(false);}};
       React.useEffect(()=>{void read();const timer=setInterval(()=>{void read();},750);return ()=>clearInterval(timer);},[]);
        // Optional capability reads may time out independently of the Suite state and user actions.
        React.useEffect(()=>{
         let stopped=false,inFlight=false;
         const readOptional=method=>callRead(method).catch(()=>null);
         const readMultimodal=async()=>{
          if(stopped||inFlight)return;
          inFlight=true;
          try{
           const [ocr,docParse]=await Promise.all([readOptional('ocrCapabilities'),readOptional('documentParseCapabilities')]);
           if(!stopped)setMultimodal({ocr,docParse});
          }finally{inFlight=false;}
         };
         void readMultimodal();
         const timer=setInterval(()=>void readMultimodal(),MULTIMODAL_POLL_INTERVAL_MS);
         return ()=>{stopped=true;clearInterval(timer);};
        },[]);
       // One toast per new containment, once per page session: the durable line below is the record, the
       // toast is the interruption. A dismissed notice never interrupts again.
       const toasted=React.useRef(new Set());
       React.useEffect(()=>{
        for(const record of components?.heal??[]){
         if(record.acknowledged===true||toasted.current.has(record.entryId))continue;
         toasted.current.add(record.entryId);
         if(record.outcome==='disabled')showToast({text:translate('healToast').replace('{module}',String(record.moduleName??'')),kind:'suite-heal',tone:'warn',durationMs:12000,closeLabel:translate('closeLabel')});
        }
       },[components]);
        // The host owns the authoritative operation epoch and phase; this only records the request this
        // window made, so a failed build reports its own reason instead of looking idle.
        const [checkBusy,setCheckBusy]=React.useState(false),[checkedAt,setCheckedAt]=React.useState(null);
        // The containment notice is a user action: dismissing it must leave a visible receipt, so the same
        // announcing read carries it.
        const [healBusy,setHealBusy]=React.useState(null);
        const [op,setOp]=React.useState(null);
        const busy=op?.phase==='building';
        // The Host owns the operation phase; this page owns the sentence and the tone.
        const operationText=(()=>{const phase=op?.phase;
         if(phase==='building')return translate('building');
         if(phase==='failed')return translate('failed');
         if(phase==='published')return translate(state?.hostHmr?'applied':'restart');
         return null;})();
        const build=async()=>{
         if(!state)return;
         setOp({phase:'building',error:null});
         try{const next=await call('build',state.operation.epoch);setState(next);setOp({phase:next?.operation?.phase??'idle',error:next?.operation?.error??null});}
         catch(issue){setOp({phase:'failed',error:String((issue&&issue.message)||issue)});}
        };
        const runUpgrade=async()=>{
         setUpgradeBusy(true);setUpgradeError(null);setUpgradeReceipt(null);
         const outcome=await upgradeOutcome(upgrade?.latest?.version);
         // ADR-047 D3/D4: the receipt is the record for every outcome -- the row reads 'installed, restart pending'
         // from it, and a failure keeps its machine reason in the one technical area.
         setUpgradeReceipt({code:outcome.code,target:outcome.target,operations:outcome.operations,diagnostic:outcome.diagnostic,readback:outcome.readback,onDisk:outcome.onDisk,activationUnconfirmed:outcome.activationUnconfirmed});
         if(outcome.state!=='restart'&&outcome.state!=='submitted')setUpgradeError(outcome.code+(outcome.diagnostic?' · '+outcome.diagnostic:''));
         await read();
         setUpgradeBusy(false);
        };
        // Readiness is the loaded generation's own proof: stamped and remote dispatch at the protocol this
        // manager speaks. Anything else is a stale builder and is reported instead of assumed ready.
        const readiness=state?{ready:Boolean(state.hostCapabilities&&state.hostCapabilities.hostStamped&&state.hostCapabilities.hostRemote&&state.hostProtocol===state.managerProtocol)}:null;
        // The collapsed badge and notice share the same capability projection as the expanded list.
        const list=components?.components??[];
        const capabilityRows=buildCapabilityOverview(list,translate,multimodal);
        const attentionRows=capabilityRows.filter(row=>row.needsAction);
        const attention=attentionRows.length;
        const effectWords={covered:['stateCovered','effectCovered','ok'],waiting:['stateWaiting','effectWaiting','muted'],partial:['statePartial','effectPartial','warn'],rejected:['stateRejected','effectRejected','warn'],unconfirmed:['stateEffectUnknown','effectUnconfirmed','warn'],'policy-disabled':['statePolicyDisabled','effectPolicyDisabled','muted'],retired:['stateRetired','effectRetired','muted']};
        const effectWordsFor=component=>component.effect?effectWords[component.state]:undefined;
        const nextStepFor=component=>effectWordsFor(component)?.[1]??nextStepKey(component.nextAction);
        const recovery=components?.recovery;
        const nextStepKey=action=>action==='restart'?'next_restart':action==='enable-row'?'next_enable-row':action==='check-runtime'?'next_check-runtime':action==='check-owner'?'next_check-owner':'next_none';
        const stateBadge=component=>{
         const effect=effectWordsFor(component);
         if(effect)return {tone:effect[2],text:translate(effect[0])};
         return component.state==='ready'?{tone:'ok',text:translate('stateReady')}:component.state==='disabled'?{tone:'muted',text:translate('rowDisabledLabel')}:component.state==='config-only'?{tone:'muted',text:translate('stateConfigOnly')}:component.state==='retired'?{tone:'muted',text:translate('stateRetired')}:component.state==='restart-required'?{tone:'warn',text:translate('stateRestart')}:{tone:'warn',text:translate('stateUnconfirmed')};
        };
        // The developer view keeps the per-component carried/loaded pair inside a collapsed disclosure:
        // it is where a developer reads the one fact that explains a restart-required row without
        // crowding the run-information card. The daily collapsed view never renders it.
        const identity=list.length===0?null:h(Disclosure,{'data-testid':'suite-identity-disclosure',title:translate('devComponentDetails').replace('{count}',String(list.length))},
         h('ul',{'data-testid':'suite-identity','className':'omni-ui-list'},list.map(component=>h(ListRow,{key:component.id,'data-testid':'suite-identity-'+component.id,
         title:component.id,badge:h(Badge,{tone:stateBadge(component).tone},stateBadge(component).text),
         description:h('span',null,
          h('span',{'data-testid':'suite-component-version-'+component.id},translate('componentCarried')+' '+String(component.carriedVersion)),
          ' \u00b7 ',h('span',{'data-testid':'suite-component-loaded-'+component.id},translate('componentLoaded')+' '+(component.loadedVersion===null?translate('loadedUnknown'):String(component.loadedVersion))),
          ' \u00b7 ',h('span',{'data-testid':'suite-component-row-'+component.id},translate(component.rowEnabled?'rowEnabled':'rowDisabledLabel')+(effectWordsFor(component)?' \u00b7 '+translate(nextStepFor(component)):'')))}))));
        // The update card answers three different questions and used to answer all three with the same
        // string: what is installed, what is running, and what can be installed. Only a *differing* running
        // version earns a row -- it is the one fact that explains a restart.
        const modeWord=mode=>mode==='release'?translate('modeRelease'):mode==='source'?translate('modeSource'):null;
        const runningVersions=[...new Set(list.map(component=>component.loadedVersion).filter(version=>version!==null))];
        const runningDiffers=Boolean(upgrade)&&runningVersions.length>0&&runningVersions.some(version=>version!==upgrade.currentVersion);
        const upgradeDetails=upgrade?[
         {label:translate('upgradeDirectory'),value:upgrade.releaseDirectory??null,mono:true,copy:upgrade.releaseDirectory??undefined,copyLabel:translate('copyValue'),copiedLabel:translate('copiedValue'),'data-value-testid':'suite-upgrade-directory'},
         {label:translate('upgradeModeLabel'),value:modeWord(upgrade.mode),'data-value-testid':'suite-upgrade-mode'},
         {label:translate('upgradeInstalledLabel'),value:upgrade.currentVersion??null,'data-value-testid':'suite-upgrade-installed'},
         runningDiffers?{label:translate('upgradeRunning'),value:runningVersions.join(' / '),hint:translate('upgradeRunningHint'),'data-value-testid':'suite-upgrade-running'}:null,
         upgrade.latest?{label:translate('upgradeLatest'),value:String(upgrade.latest.version),hint:translate('upgradeComponents')+'\u00b7'+upgrade.latest.components.map(component=>component.module).join('\u3001'),'data-value-testid':'suite-upgrade-latest'}:null
        ].filter(Boolean):[];
        // ── 更新来源（ADR-068）───────────────────────────────────────────────────────────────────────
        // 唯一事实源是这一行的配置（Config.updateSource，volatile → 官方 settings.describe 会服务它）。页面只
        // 持有草稿；写入走 configForms.mutate（revision CAS，官方保存链路），所以不存在第二份存储或第二个写入口。
        const sourceSnapshot=(()=>{try{return wire.form?wire.form.getSnapshot():null;}catch{return null;}})();
        const sourceStored=(sourceSnapshot&&sourceSnapshot.value&&typeof sourceSnapshot.value==='object'?sourceSnapshot.value.updateSource:null)??{};
        const sourceKind=sourceStored.kind==='github'?'github':'local';
        const sourceChannel=sourceStored.channel==='prerelease'?'prerelease':'stable';
        const sourceOwner=typeof sourceStored.owner==='string'?sourceStored.owner:'';
        const sourceRepoName=typeof sourceStored.repo==='string'?sourceStored.repo:'';
        const sourceRef=typeof sourceStored.credentialRef==='string'?sourceStored.credentialRef:'';
        const sourceStoredText=(sourceOwner&&sourceRepoName?sourceOwner+'/'+sourceRepoName:(sourceOwner||sourceRepoName))||'';
        const sourceReady=Boolean(sourceSnapshot)&&sourceSnapshot.status==='ready'&&sourceSnapshot.writable===true;
        const sourceEdit=sourceDraft??{repo:sourceStoredText,channel:sourceChannel,credentialRef:sourceRef};
        // 存进配置的仓库被改动后草稿要跟着重置：否则页面会一直显示一个已经不存在的草稿（或相反）。
        const sourceSignature=sourceStoredText+'|'+sourceChannel+'|'+sourceRef+'|'+sourceKind;
        React.useEffect(()=>{setSourceDraft(null);},[sourceSignature]);
        // 凭据“存在性”是官方凭据服务的事实，只按引用问一次（引用名上屏，秘值不上屏）。没有该服务时如实说
        // “状态不可确认”，不把“读不到”说成“没配置”。
        React.useEffect(()=>{
         if(sourceKind!=='github'||sourceRef===''){setCredentialState('unknown');return undefined;}
         const credentials=wire.credentials;
         if(!credentials||typeof credentials.describe!=='function'){setCredentialState('unknown');return undefined;}
         let active=true;
         Promise.resolve(credentials.describe([sourceRef])).then(answer=>{
          if(!active)return;
          const row=unwrapRemoteResult(answer)?.[sourceRef];
          setCredentialState(row&&row.configured===true?'configured':row?'missing':'unknown');
         }).catch(()=>{if(active)setCredentialState('unknown');});
         return ()=>{active=false;};
        },[sourceKind,sourceRef,configTick]);
        const sourceRepoParts=()=>{const raw=String(sourceEdit.repo??'').trim(),cut=raw.indexOf('/');
         return cut<0?{owner:raw,repo:''}:{owner:raw.slice(0,cut).trim(),repo:raw.slice(cut+1).trim()};};
        // 一个写入函数：整对象 set（不依赖嵌套 path 语义），带快照 revision 做 CAS。任何人先写过就拒绝，不覆盖。
        const writeSource=async patch=>{
         const form=wire.form;
         if(!form){setSourceNotice('unavailable');return false;}
         const snapshot=form.getSnapshot();
         if(snapshot.status!=='ready'||snapshot.writable!==true){setSourceNotice('unavailable');return false;}
         const current=snapshot.value&&typeof snapshot.value==='object'?snapshot.value.updateSource:null;
         const stored=current&&typeof current==='object'?current:{};
         const next={kind:stored.kind==='github'?'github':'local',owner:String(stored.owner??''),repo:String(stored.repo??''),
          channel:stored.channel==='prerelease'?'prerelease':'stable',credentialRef:String(stored.credentialRef??''),...patch};
         let accepted=false;
         try{accepted=await form.mutate([{op:'set',path:['updateSource'],value:next}],snapshot.revision);}
         catch{accepted=false;}
         setSourceNotice(accepted?'saved':'refused');
         setConfigTick(tick=>tick+1);
         return accepted;
        };
        // 选回本地目录只改 kind：owner/repo/channel/凭据引用原样留在配置里，再切回来就是刚才那三项。
        const chooseSource=async kind=>{if(kind===sourceKind)return;await writeSource({kind});};
        const saveSource=async()=>{
         const {owner,repo}=sourceRepoParts();
         if(sourceKind==='github'&&(owner===''||repo==='')){setSourceNotice('refused');return;}
         await writeSource({kind:'github',owner,repo,channel:String(sourceEdit.channel==='prerelease'?'prerelease':'stable'),
          credentialRef:String(sourceEdit.credentialRef??'').trim()});
        };
        const sourceCanSave=sourceReady&&(sourceKind!=='github'||sourceRepoParts().owner!==''&&sourceRepoParts().repo!=='');
        // 凭据引用只显示“引用名 + 已配置/缺失”：秘值永远不出现在页面上，也不经过这条读法。
        const sourceCredentialSentence=(()=>{
         if(sourceRef==='')return translate('updateSourceCredentialUnset');
         if(credentialState==='configured')return translate('updateSourceCredentialConfigured');
         if(credentialState==='missing')return translate('updateSourceCredentialMissing');
         return translate('updateSourceCredentialUnknown');
        })();
        // Keep the existing component steps, and use the settings entry for a bundled capability.
        // One aggregate sentence, distinct steps only, never a per-plugin row again.
        const attentionNotice=attention===0?null:h(StatusLine,{tone:'warn','data-testid':'suite-attention-next-step'},
         translate('attentionNextStep').replace('{count}',String(attention)).replace('{steps}',[...new Set(attentionRows.map(row=>row.component?translate(nextStepFor(row.component)):row.entry))].join(' ')));
        // A closed channel used to look exactly like "up to date": no candidate, no sentence. The reason is
        // a machine fact from the Host; the words are the Client's. A linked source checkout is the
        // documented development layout, so only a real blocker or the installed-release contradiction is
        // worth the one line -- that contradiction is the state that hid every candidate from a user.
        const refusals=upgrade?.refusals??[];
        const channelReason=!upgrade||upgrade.latest?null:refusals.some(item=>item.code==='UPGRADE_DIRECTORY_INVALID')?translate('upgradeDisabled'):refusals.some(item=>item.code==='UPGRADE_DIRECTORY_UNREADABLE')?translate('channelUnreadable'):state?.linked!==true&&upgrade.mode!=='release'?translate('upgradeSourceMode'):null;
        // Loadability-first: the runtime verdict is computed from the official boot manifest, so it is
        // available even when this plugin's Host never activated. It never claims compatibility, it says
        // which fact it could read and points at the upgrade control that is already on this page.
        const runtime=runtimeVerdict(bootReleaseVersion(globalThis.__DSH_BOOT__),VERIFIED_RUNTIMES);
        const runtimeKey=runtimeNoticeKey(runtime.state);
        const runtimeNotice=runtimeKey===null?null:h(Banner,{'data-testid':'suite-runtime-unverified',tone:'warn'},say(runtimeKey,{version:runtime.version??''}));
        const channelNotice=channelReason===null?null:h(StatusLine,{tone:'warn','data-testid':'suite-upgrade-channel'},translate('channelUnavailable')+' \u00b7 '+channelReason);
        // The release directory is shared with history, so the refusal list is long by nature and a raw dump
        // tells a user nothing. One line per reason instead: the collapsed title carries the categories, the
        // body carries one human sentence per reason with the directories behind it. An unmapped code is
        // still named rather than hidden.
        const refusalWords=code=>isFetchCode(code)?translate(FETCH_KEYS[code]):code==='UPGRADE_NOT_NEWER'?translate('refusalNotNewer'):code==='UPGRADE_NOT_A_CANDIDATE'?translate('refusalNotCandidate'):code==='UPGRADE_SUMS_MISSING'?translate('refusalSumsMissing'):code==='UPGRADE_CANDIDATE_INVALID'?translate('refusalInvalid'):code==='UPGRADE_RUNTIME_UNVERIFIED'?translate('refusalRuntimeUnverified'):code==='UPGRADE_RUNTIME_UNDECLARED'?translate('refusalRuntimeUndeclared'):code==='UPGRADE_RUNTIME_UNKNOWN'?translate('refusalRuntimeUnknown'):code==='UPGRADE_CURRENT_UNREADABLE'?translate('refusalCurrentUnreadable'):translate('refusalOther').replace('{code}',String(code));
        const refusalGroups=(()=>{const groups=new Map();for(const item of upgrade?.refusals??[]){const code=String(item.code??'UPGRADE_CANDIDATE_INVALID');const group=groups.get(code)??{code,items:[]};group.items.push(item);groups.set(code,group);}return [...groups.values()];})();
        // An expected skip is not news: an older candidate and an unrelated directory are refused by design
        // on every read. What a user needs is the *actionable* refusal -- the directory that looks like a
        // release and still cannot be installed -- and that stays visible below.
        const expectedRefusal=code=>code==='UPGRADE_NOT_NEWER'||code==='UPGRADE_NOT_A_CANDIDATE'||code==='UPGRADE_SOURCE_MODE';
        // 抓取器的码不是“某个目录拒绝安装”，它讲的是“这次联网检查没拿到东西”。把它混进 actionable 会让页面
        // 说“有 N 个目录无法安装”，而事实是根本没有目录；码本身只进技术诊断（ADR-068 2026-10-29 追加 3）。
        const actionableRefusals=refusalGroups.filter(group=>!expectedRefusal(group.code)&&!isFetchCode(group.code));
        const actionableCount=actionableRefusals.reduce((total,group)=>total+group.items.length,0);
        // The page shows what the user has to decide and nothing else: an attention row, the boot-recovery
        // notice, a failed read and a pending Suite upgrade. Every technical surface lives behind the one
        // developer switch below, so a healthy Suite page carries exactly one control.
        // The Suite page owns Suite-level facts. Per-plugin status, enablement and configuration belong to the
        // official plugin page: its Components list owns the switch and each plugin's own settings card owns
        // configuration. The capability overview below is strictly read-only and collapsed by default.
        const recoveryNotice=!recovery?null:h('div',{'data-testid':'suite-recovery-notice','className':'omni-ui-stack'},
         h(StatusLine,{tone:'warn','data-testid':'suite-recovery-line'},translate('recoveryTitle')+' \u00b7 '+(recovery.action==='rows-disabled'?recovery.rows.map(row=>row.rowId).join(', '):translate('recoveryNone'))));
        // `recovered` is not a notice: the entry came back and there is nothing for the user to do.
        // Leaving it in the list fell through to the pending sentence ("failed; the automatic switch-off
        // has not taken effect") for a plugin that is running — the exact false statement this batch
        // exists to remove (0.2.2-3 review P1-1). Filtering needs no new copy.
        const healRecords=Array.isArray(components?.heal)?components.heal.filter(record=>record.acknowledged!==true&&record.outcome!=='recovered'):[];
        const healSentence=record=>{
         const module=String(record.moduleName??'');
         // Only a confirmed disable may claim the entry was switched off. `not-disabled` is the opposite
         // fact -- the official switch was accepted but the inventory still reports it enabled -- and
         // telling the user "switched off" there would be a false success they could never detect.
         if(record.outcome==='disabled')return translate('healDisabled').replace('{module}',module);
         if(record.outcome==='protected')return translate('healProtected').replace('{module}',module);
         if(record.outcome==='refused-readonly')return translate('healRefused').replace('{module}',module);
         return translate('healPending').replace('{module}',module);
        };
        const healNotice=healRecords.length===0?null:h('div',{'data-testid':'suite-heal-notice','className':'omni-ui-stack'},
         healRecords.map(record=>h('div',{key:record.entryId,'data-testid':'suite-heal-'+record.outcome,'className':'omni-ui-stack'},
          h(StatusLine,{tone:record.outcome==='disabled'?'warn':'error'},translate('healTitle')+' \u00b7 '+healSentence(record)),
          h(ActionGroup,null,
           h(Button,{'data-testid':'suite-heal-dismiss','data-entry':record.entryId,busy:healBusy===record.entryId,onClick:()=>void dismissHeal(record.entryId)},translate('healDismiss')),
           h(Button,{'data-testid':'suite-heal-rescan',busy:checkBusy,onClick:()=>void rescanHeal()},translate('healRescan'))))));
        // A pending upgrade is the one technical action a normal user must be able to take: the Suite installs
        // itself, without the plugin install page. It appears only while a newer version exists.
         // ADR-047: the row is a fixed two-line state row -- status and version, then one fact the user can
         // check. The verdict comes from the Host (the profile's bytes are the authority); this page picks wording.
         const upgradeRow=(()=>{
          if(!upgrade)return {tone:'idle',title:translate('upgradeRowTitle'),version:null,detail:translate('upgradeCheckedNever')};
          const latest=upgrade.latest?String(upgrade.latest.version):null;
          const installed=typeof upgrade.currentVersion==='string'?upgrade.currentVersion:null;
          if(upgradeBusy&&latest!==null)return {tone:'warn',title:translate('upgradeRowInstalling').replace('{version}',latest),version:null,detail:translate('upgradeDetailInstalling')};
          if(checkBusy)return {tone:'idle',title:translate('upgradeChecking'),version:null,detail:translate('upgradeDetailChecking')};
          if(upgradeReceipt){
           const receiptCode=String(upgradeReceipt.code??'');
           if(receiptCode==='SUITE_UPGRADE_RESTART_REQUIRED')return {tone:'warn',title:translate('upgradeRowInstalled').replace('{version}',String(upgradeReceipt.target??installed??'')),version:null,detail:translate('upgradeDetailInstalled')};
          // 未确认不是失败：既没有宿主的码、也读不到盘上版本时，页面只能说“重启后确认”，不许断言没装上（ADR-059）。
          // The old Client generation handed the install to the Host but was reloaded before it could read a
          // verdict. This is not "unconfirmed by the disk": it is "submitted, confirm after restart".
          if(receiptCode==='SUITE_UPGRADE_SUBMITTED')return {tone:'warn',title:translate('upgradeRowSubmitted'),version:upgradeReceipt.target?String(upgradeReceipt.target):null,retry:false,detail:translate('upgradeDetailSubmitted')};
          if(receiptCode==='SUITE_UPGRADE_UNCONFIRMED')return {tone:'warn',title:translate('upgradeRowUnconfirmed'),version:upgradeReceipt.target?String(upgradeReceipt.target):null,retry:true,detail:translate('upgradeDetailUnconfirmed')};
          // ADR-089: the official installer refused this profile because its node_modules was linked from
          // another pnpm store major. The bytes never changed; the one useful next step is a manual rebuild.
          if(receiptCode==='UPGRADE_PROFILE_STORE_MISMATCH')return {tone:'error',title:translate('upgradeRowFailed'),version:upgradeReceipt.target?String(upgradeReceipt.target):null,retry:Boolean(upgrade?.latest),
           detail:translate('upgradeDetailStoreMismatch')+' \u00b7 '+translate('upgradeDiagnosticCode').replace('{code}',receiptCode)+(upgrade?.latest?'':' \u00b7 '+translate('upgradeDetailFailedGone'))};
           const written=(upgradeReceipt.operations??[]).some(step=>step.changed===true);
           return {tone:'error',title:translate('upgradeRowFailed'),version:upgradeReceipt.target?String(upgradeReceipt.target):null,retry:true,
            detail:upgrade?.latest?((written?translate('upgradeDetailFailedWritten'):translate('upgradeDetailFailed'))+translate('upgradeDiagnosticCode').replace('{code}',receiptCode)):translate('upgradeDetailFailedGone')};
          }
          if(latest!==null)return {tone:'warn',title:translate('upgradeRowAvailableTitle'),version:latest,detail:translate('upgradeDetailAvailable').replace('{current}',String(installed??'\u2014'))};
          // ADR-068: 抓取失败一律是“无可用更新”+ 一句人话；八类码共用这一个形状，码只进技术诊断。
          // 候选已经拿到了（latest!==null）就说明抓取成功，旧失败记录不能继续挂在同一行上。
          if(checkReceipt)return {tone:'warn',title:translate('upgradeRowNoInstallable'),version:null,detail:translate(checkReceipt.reasonKey)};
          if(upgrade.mode!=='release')return {tone:'idle',title:translate('upgradeRowSource'),version:null,detail:translate('upgradeDetailSource')};
          if(actionableCount>0){
           const refused=String((actionableRefusals[0]?.items?.[0]?.directory??'').split('/').pop()??'\u2014');
           return {tone:'warn',title:translate('upgradeRowNoInstallable'),version:null,detail:translate('upgradeDetailNoInstallable').replace('{version}',refused).replace('{count}',(actionableCount===1?translate('upgradeCountDirectoryOne'):translate('upgradeCountDirectoryMany')).replace('{count}',String(actionableCount)))};
          }
          // ADR-080 D4: a readable channel with no candidate is not "up to date". "Up to date" needs evidence
          // of a published Suite release that is not newer; a channel with nothing installable gets its own
          // reason instead of an ok verdict.
          if(!refusals.some(item=>item.code==='UPGRADE_NOT_NEWER'))return {tone:'idle',title:translate('upgradeRowNoInstallable'),version:null,detail:translate('upgradeDetailEmptyChannel')};
          return {tone:'ok',title:translate('upgradeUpToDate'),version:installed,detail:checkedAt?translate('upgradeDetailRelease'):translate('upgradeDetailUnchecked')};
         })();
         // ADR-047: the update card is part of the daily surface; the developer switch below adds the
         // technical facts, never a second copy of the same status row.
         // One state row, rendered by the collapsed summary and by the developer card: two surfaces, one shape
         // (ADR-047 D1). The dot only carries a tone token; the version is part of the title line.
         const upgradeStatusRowEl=()=>h(ListRow,{'data-testid':'suite-upgrade-status-row',
          title:h('span',{'data-testid':'suite-upgrade-status-title'},
           h('span',{'className':'omni-ui-stateDot','data-tone':upgradeRow.tone,'aria-hidden':'true'}),
           h('span',null,upgradeRow.title),
           upgradeRow.version?h('span',{'data-testid':'suite-upgrade-status-version','className':'omni-ui-stateVersion'},upgradeRow.version):null),
          description:h('span',{'data-testid':'suite-upgrade-status-detail'},upgradeRow.detail),
          actions:h(ActionGroup,null,
           // 检查更新 = checkRelease()（唯一联网入口），不是读盘的 upgradeStatus——后者在这里等于永不检查。
           h(Button,{'data-testid':'suite-upgrade-check',busy:checkBusy,onClick:()=>void runCheck()},checkBusy?translate('upgradeChecking'):translate('upgradeCheck')),
           // ADR-068 2026-10-29 修订：勾选框删掉，确认就是这一次点击；按钮文案绑定被检查出的那个版本，
           // 版本变了按钮就跟着变——不存在“拿旧候选装”的路径。没有确认即不安装：这里只有一个动作。
           upgrade?.latest&&h(Button,{'data-testid':'suite-upgrade-run',variant:'primary',busy:upgradeBusy,disabled:upgradeBusy,onClick:()=>void runUpgrade()},
            upgradeBusy?translate('upgradeWorking'):((upgradeRow.retry?translate('upgradeRunRetryWithVersion'):translate('upgradeRunWithVersion')).replace('{version}',String(upgrade.latest.version)))))});
         // ── 更新来源控件（ADR-068 / ADR-080 D1）────────────────────────────────────────────────────────
         // ADR-080 D1：来源是部署事实，不是使用决策。控件整块只在「开发者选项」展开后渲染，日常面只保留
         // 状态行与「检查更新」；选 GitHub 时展开三项，选回本地目录时收起且不清空。
         const updateSourceBlock=()=>h(React.Fragment,null,
          h('ul',{'data-testid':'suite-upgrade-source-list','className':'omni-ui-list omni-ui-list--flush'},
           h(ListRow,{'data-testid':'suite-upgrade-source-row',title:translate('updateSource'),
            description:sourceReady?null:translate('updateSourceUnavailable'),
            actions:h(Select,{variant:'inline','data-testid':'suite-upgrade-source',name:'updateSource',
             'aria-label':translate('updateSource'),value:sourceKind,disabled:!sourceReady,
             onChange:event=>void chooseSource(event.target.value)},
             UPDATE_KINDS.map(kind=>h('option',{key:kind,value:kind},translate(kind==='github'?'updateSourceGithub':'updateSourceLocal'))))})),
          // 选回本地目录时这一块整块收起，但配置里的 owner/repo/channel/凭据引用一个都不清空：再切回来就是刚才的值。
          sourceKind==='github'&&h('div',{'data-testid':'suite-upgrade-source-github','className':'omni-ui-stack'},
           h(FormGrid,null,
            h(Field,{label:translate('updateSourceRepo')},
             h(TextInput,{'data-testid':'suite-upgrade-source-repo',name:'updateSourceRepo',value:sourceEdit.repo,disabled:!sourceReady,autoComplete:'off',spellCheck:false,
              placeholder:'owner/repo',onChange:event=>{const value=event.target.value;setSourceNotice(null);setSourceDraft({...sourceEdit,repo:value});}})),
            h(Field,{label:translate('updateSourceChannel')},
             h(Select,{'data-testid':'suite-upgrade-source-channel',name:'updateSourceChannel',value:sourceEdit.channel,disabled:!sourceReady,
              onChange:event=>{const value=event.target.value;setSourceNotice(null);setSourceDraft({...sourceEdit,channel:value});}},
              UPDATE_CHANNELS.map(channel=>h('option',{key:channel,value:channel},translate(channel==='prerelease'?'updateSourcePrerelease':'updateSourceStable'))))),
            h(Field,{label:translate('updateSourceCredential'),hint:sourceCredentialSentence},
             h(TextInput,{'data-testid':'suite-upgrade-source-credential',name:'updateSourceCredential',value:sourceEdit.credentialRef,disabled:!sourceReady,autoComplete:'off',spellCheck:false,
              onChange:event=>{const value=event.target.value;setSourceNotice(null);setSourceDraft({...sourceEdit,credentialRef:value});}}))),
           h('p',{'data-testid':'suite-upgrade-source-hint','className':'omni-ui-hint'},translate('updateSourceHint')),
           h(ActionGroup,null,
            h(Button,{'data-testid':'suite-upgrade-source-save',disabled:!sourceCanSave,onClick:()=>void saveSource()},translate('updateSourceSave'))),
           sourceNotice==='saved'&&h(StatusLine,{tone:'ok','data-testid':'suite-upgrade-source-result'},translate('updateSourceSaved')),
           sourceNotice==='refused'&&h(StatusLine,{tone:'warn',role:'alert','data-testid':'suite-upgrade-source-result'},translate('updateSourceRefused')),
           sourceNotice==='unavailable'&&h(StatusLine,{tone:'warn','data-testid':'suite-upgrade-source-result'},translate('updateSourceUnavailable'))));
         // ADR-048: an information block exists only when it has something to state -- no empty shell
         const upgradeCard=!upgrade?null:(
         h(SettingsCard,{'data-testid':'suite-upgrade-card',title:h('span',{className:'omni-ui-cardTitleRow'},
          h('span',null,translate('upgradeRowTitle')),
          upgrade?(checkedAt?h('span',{'data-testid':'suite-upgrade-checked','className':'omni-ui-cardMeta'},translate('upgradeCheckedAt').replace('{time}',checkedAt)):h('span',{className:'omni-ui-cardMeta'},translate('upgradeCheckedNever'))):null)},
          upgrade?h('ul',{'data-testid':'suite-upgrade-status','className':'omni-ui-list omni-ui-list--flush'},upgradeStatusRowEl()):h('p',{'data-testid':'suite-upgrade-unavailable','className':'omni-ui-hint'},translate('waitingHost')),
          // 一次检查没有回答（通道/宿主拒绝）时，回执留在卡片上：点了按钮却什么都没发生，看起来像死按钮。
          checkFailure&&h('div',{'data-testid':'suite-upgrade-check-failure'},h(StatusLine,{tone:'warn',role:'alert'},translate('checkFailed').replace('{code}',String(checkFailure.code)))),
          state&&!state.linked&&upgrade&&upgrade.mode!=='release'&&h('div',{'data-testid':'suite-upgrade-mode-mismatch'},h(StatusLine,{tone:'warn'},translate('upgradeModeMismatch').replace('{mode}',String(modeWord(upgrade.mode)??upgrade.mode)))),
          actionableCount>0&&h('div',{'data-testid':'suite-upgrade-refusal-actionable','className':'omni-ui-stack'},
           h(StatusLine,{tone:'warn'},translate('refusalActionable').replace('{count}',(actionableCount===1?translate('upgradeCountDirectoryOne'):translate('upgradeCountDirectoryMany')).replace('{count}',String(actionableCount))).replace('{reasons}',actionableRefusals.map(group=>refusalWords(group.code)).join(' \u00b7 '))),
           h(Disclosure,{'data-testid':'suite-upgrade-refusals',title:translate('upgradeRefusals')+' ('+actionableCount+')'},
            h('div',null,actionableRefusals.map(group=>h('div',{key:group.code,'data-testid':'suite-upgrade-refusal-'+group.code},
             h('p',null,refusalWords(group.code)+' \u00d7 '+group.items.length),
             h('ul',null,group.items.map(item=>h('li',{key:item.directory},item.directory))))))))));
        const developerPanel=!developer?null:h('div',{'data-testid':'suite-developer-options','className':'omni-ui-stack'},
         // ADR-080 D1: the source is a deployment fact, not a usage decision; the whole control lives here.
         updateSourceBlock(),
         h(SettingsCard,{'data-testid':'suite-identity-card',title:translate('devIdentity')},
          state?h(KeyValueList,{'data-testid':'suite-identity-kv',items:[
           {label:translate('upgradeModeLabel'),value:state.linked?translate('modeSource'):translate('modeRelease'),hint:state.linked?translate('modeSourceHint'):translate('modeReleaseHint'),'data-value-testid':'suite-identity-mode'},
           {label:translate('source'),value:state.sourceRoot??null,mono:true},
           {label:translate('host'),value:state.hostRevision??null,mono:true,shorten:true,copy:state.hostRevision??undefined,copyLabel:translate('copyValue'),copiedLabel:translate('copiedValue'),'data-value-testid':'suite-identity-host'},
           {label:translate('client'),value:state.operation?.target?.clientRevision??null,mono:true,shorten:true,copy:state.operation?.target?.clientRevision??undefined,copyLabel:translate('copyValue'),copiedLabel:translate('copiedValue'),'data-value-testid':'suite-identity-client'},
           {label:translate('target'),value:state.operation?.target?.hostRevision??null,mono:true,shorten:true,copy:state.operation?.target?.hostRevision??undefined,copyLabel:translate('copyValue'),copiedLabel:translate('copiedValue'),'data-value-testid':'suite-identity-target'},
           {label:translate('entry'),value:state.operation?.target?.entryFingerprint??null,mono:true,shorten:true,copy:state.operation?.target?.entryFingerprint??undefined,copyLabel:translate('copyValue'),copiedLabel:translate('copiedValue'),'data-value-testid':'suite-entry-fingerprint'},
           {label:translate('protocol'),value:state.managerProtocol??null,mono:true}
          ]}):h(StatusLine,{tone:'warn','data-testid':'suite-identity-state'},translate('waitingHost')),
          identity,
          // 构建相关的事实只在源码态有意义：发行包里没有可构建的源码，把"请先绑定源码"摆给普通用户，
          // 只会制造"我是不是漏了一步"的错觉——发行版安装本来就是这个套件的正常形态。
          state&&state.linked&&readiness&&!readiness.ready&&h(StatusLine,{tone:'warn','data-testid':'suite-readiness'},translate('builderStale')),
          state&&state.linked&&!state.hostHmr&&h(StatusLine,{tone:'warn'},translate('noHmr')),
          noticeText&&h(StatusLine,{tone:'ok','data-testid':'suite-host-notice'},noticeText),
          op&&op.error&&renderTechnicalFailure(h,translate,'operationError',op.error)),
         state?.linked&&h(SettingsCard,{'data-testid':'suite-dev-actions',title:translate('devActions')},
          h(Checkbox,{'data-testid':'suite-build-confirm',checked:confirmed,label:translate('confirm'),onChange:event=>setConfirmed(event.target.checked)}),
          h(ActionGroup,null,
           h(Button,{'data-testid':'suite-dev-build',disabled:!confirmed||Boolean(busy)||upgradeBusy||op?.phase==='building'||Boolean(error),onClick:()=>void build()},translate(busy||op?.phase==='building'?'building':state?.hostHmr?'build':'restartBuild')))),
         // ADR-047 D4: the profile's bytes, the transaction receipt and the page's own view live in exactly
         // one place -- after the developer switch. Nothing in the daily surface points at it.
         h(Disclosure,{'data-testid':'suite-technical-details',title:translate('technicalDetails'),defaultOpen:Boolean(upgradeReceipt&&String(upgradeReceipt.code??'')!=='SUITE_UPGRADE_RESTART_REQUIRED')},
          upgradeDetails.length>0&&h(KeyValueList,{'data-testid':'suite-upgrade-kv',items:upgradeDetails}),
          upgradeReceipt&&h('div',{'data-testid':'suite-upgrade-receipt','className':'omni-ui-stack'},
           h('p',null,upgradeReceipt.code+' \u2192 '+String(upgradeReceipt.target??'\u2014')),
           h('p',null,translate('technicalOnDisk').replace('{version}',String(upgradeReceipt.onDisk??'\u2014'))),
           upgradeReceipt.operations.length>0&&h('ul',null,upgradeReceipt.operations.map((step,position)=>h('li',{key:position},step.stage+': '+step.target+' \u2192 '+step.application+(step.code?' ('+step.code+')':'')))),
           upgradeReceipt.diagnostic&&h('p',null,upgradeReceipt.diagnostic)),
          // ADR-068: 抓取器的码只在这里出现（原始技术诊断）。用户句子里没有它，但它不能丢——它才是
          // “为什么没有更新”的唯一事实，也是报障时要贴的那一行。
          checkReceipt&&h('p',{'data-testid':'suite-upgrade-fetch'},checkReceipt.code+(checkReceipt.directory?' → '+checkReceipt.directory:'')),
          checkFailure&&h('p',{'data-testid':'suite-upgrade-check-code'},'SUITE_CHECK_REFUSED → '+String(checkFailure.code)),
          upgradeError&&h('div',{'data-testid':'suite-upgrade-error'},h(StatusLine,{tone:'error'},upgradeError)),
          h('pre',{'data-testid':'suite-raw-state'},JSON.stringify({state,components,upgrade,recovery,multimodal,check:{receipt:checkReceipt,failure:checkFailure}},null,2))));
        const componentsCard=list.length===0?null:h(SettingsCard,{
         collapsible:true,
         defaultOpen:false,
         'data-testid':'suite-components-card',
         title:h('span',{'data-testid':'suite-components-summary'},
          translate('componentsCardTitle')+' \u00b7 '+translate('componentsSummary').replace('{total}',String(capabilityRows.length))),
         description:translate('componentsWhere'),
         badge:attention===0
          ?h(Badge,{tone:'ok','data-testid':'suite-components-summary-state'},translate('componentsRunning'))
          :h(Badge,{tone:'warn','data-testid':'suite-components-summary-state'},translate('componentsAttention').replace('{count}',String(attention)))
        },
         capabilityRows.length>0&&h('ul',{'data-testid':'suite-capability-overview','className':'omni-ui-list omni-ui-list--flush'},
          capabilityRows.map(item=>h(ListRow,{key:item.id,'data-capability':item.id,title:item.title,badge:h(Badge,{tone:item.tone},item.badge),description:item.description,meta:item.entry}))));
        const notices=[runtimeNotice,attentionNotice,channelNotice,recoveryNotice,healNotice].filter(Boolean);
        const noticesCard=notices.length===0?null:h(SettingsCard,{'data-testid':'suite-notices-card',title:translate('noticesCardTitle')},
         h('div',{'className':'omni-ui-stack'},notices));
        // The library token root must wrap the whole contribution: the bare developer switch is not a
        // control root of its own, so outside a card it would render without resolved tokens.
        return h('div',{'data-testid':'suite-development-manager','className':'omni-ui-tokens omni-ui-pageContent'},
         error&&h('div',{'data-testid':'suite-read-failure'},h(StatusLine,{tone:'warn'},translate('readFailed').replace('{reason}',String(error))),h('p',{'data-testid':'suite-read-retry','className':'omni-ui-hint'},translate('retryNote'))),
         !error&&!state&&!components&&!upgrade&&h('div',{'data-testid':'suite-read-pending'},h(StatusLine,{tone:'ok'},translate('waitingHost'))),
         // The Host owns the operation phase; this page owns the sentence and the tone. The raw reason is not
         // a user-facing message -- it stays in the technical disclosure below.
         !error&&operationText&&h('div',{'data-testid':'suite-operation-status'},h(StatusLine,{tone:op?.phase==='failed'?'warn':'ok'},operationText)),
         // ADR-048 D1: no information block sits bare on the page root. The component summary is one titled
         // card, the transient notices are one titled card, and the update block stays its own titled card.
         upgradeCard,componentsCard,noticesCard,
         // ADR-043: between installing an update and restarting, the running Host still answers with the
         // previous descriptor. The read below falls back to the older arity, and this is the one sentence
         // that tells the user what to do about it — plain words, no control-plane vocabulary.
         isStaleHost()&&h('p',{className:'omni-ui-hint','data-testid':'suite-needs-restart'},translate('needsRestartAfterUpdate')),
         h(Checkbox,{'data-testid':'suite-developer-toggle',checked:developer,label:translate('developerOptions'),description:translate('developerHint'),onChange:event=>toggleDeveloper(event.target.checked)}),
         developerPanel);
      }
      ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:'@omnisurge/dsh-suite',locale:NS},Manager));
     });
     return ()=>contribution?.dispose?.();
    },'omnisurge: suite management contribution'));
   }};
