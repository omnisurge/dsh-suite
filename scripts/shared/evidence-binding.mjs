/**
 * The batch record a freeze must carry, parsed in one place.
 *
 * 2026-10-20 用户要求把开发流程变成约束：`adr → spec → 分批实现 → review → 发布`。冻结是这条链的最后一环，
 * 所以在这一环要求批次记录**自己说明**"机制决定的落点"和"独立 review 的结论"。只写在 AGENTS.md 里的流程
 * 没有执行者；被 pack 拒绝过一次的流程才有。
 *
 * 三条必填：
 *   candidate-sha256: <64 hex>   —— 这份记录绑定的是哪一份字节
 *   adr: ADR-0NN | none — <原因>  —— 机制/契约/用户可见语义的决定落在哪
 *   review: <日期> <谁> <结论>     —— 发布前谁看过，结论是什么（未执行也要如实写）
 */
const SHA=/candidate-sha256:\s*([0-9a-f]{64})/u;
const ADR=/^adr:\s*(.+)$/mu;
const REVIEW=/^review:\s*(.+)$/mu;

export function parseEvidenceBinding(text,{sha}={}){
  const declared=(SHA.exec(text)??[])[1];
  if(declared===undefined)throw Error('RELEASE_EVIDENCE_UNBOUND: the batch record must contain a "candidate-sha256: <64 hex>" line');
  if(sha!==undefined&&declared!==sha)throw Error('RELEASE_EVIDENCE_SHA_MISMATCH: evidence names '+declared.slice(0,16)+' but this candidate is '+sha.slice(0,16));
  const decision=(ADR.exec(text)??[])[1]?.trim();
  if(decision===undefined)throw Error('RELEASE_EVIDENCE_NO_DECISION: the batch record must contain "adr: ADR-0NN" or "adr: none — <reason>" (ADR → spec → 分批 → review → 发布)');
  const named=/^ADR-\d+/u.test(decision);
  // `adr: none` 不是"跳过"：它必须说出为什么这批没有机制性决定，否则又是一句没人验的空话。
  const reasoned=/^none\b[\s—–:-]+\S.{7,}/iu.test(decision);
  if(!named&&!reasoned)throw Error('RELEASE_EVIDENCE_DECISION_INVALID: "adr:" names neither an ADR nor a reasoned "none": '+decision);
  const review=(REVIEW.exec(text)??[])[1]?.trim();
  if(review===undefined)throw Error('RELEASE_EVIDENCE_NO_REVIEW: the batch record must contain "review: <date> <reviewer> <verdict>" (write "review: not run — <reason>" when it was not run)');
  if(review.length<8)throw Error('RELEASE_EVIDENCE_REVIEW_THIN: "review:" must state who looked and what they concluded: '+review);
  return {sha:declared,decision,review};
}
