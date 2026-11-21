import type {ComponentEffectSnapshot} from './types.js';
export type TargetCoverage = {state:'covered'|'waiting'|'rejected'|'unconfirmed';reason:string};
/** One read only aggregation. Failure to enumerate has unknown cardinality, never zero. */
export function coverageSnapshot(total:number|null,targets:readonly TargetCoverage[]):ComponentEffectSnapshot {
 const count=(state:TargetCoverage['state'])=>targets.filter(target=>target.state===state).length;
 const covered=count('covered'),waiting=count('waiting'),rejected=count('rejected');
 const unknown=total===null?null:count('unconfirmed');
 const complete=total!==null&&unknown===0;
 const reasons=[...new Set(targets.map(target=>target.reason))].sort();
 let state:ComponentEffectSnapshot['state'];
 if(!complete)state='unconfirmed';
 else if(covered>0)state=covered===total?'covered':'partial';
 else if(total===0){state='waiting';reasons.push('no-live-agent');}
 else if(waiting===total)state='waiting';
 else if(rejected===total)state='rejected';
 else state='unconfirmed';
 return {protocol:1,scope:'live-agent-bindings',state,complete,total,covered,waiting,rejected,unknown,reasons};
}
