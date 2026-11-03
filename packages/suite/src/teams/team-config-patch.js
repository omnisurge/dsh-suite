/** 团队配置的保存补丁：只把「与加载基线不同」的字段放进 patch（ADR-064）。
 * 为什么必须是纯函数且可测：只改 freshProvider 时若把未改的 maxMembers 一并发送，Host 会去校验它那一行；
 * profile 里现值 > 32 时就会被整体拒绝（0.2.1-3 的死锁）。抽出来才有单测，不靠「读代码相信」。
 */
export function teamConfigPatch(draft, baseline) {
  const patch = {};
  if (draft.maxMembers !== '' && draft.maxMembers !== baseline.maxMembers) patch.maxMembers = draft.maxMembers;
  if (draft.freshProvider !== '' && draft.freshProvider !== baseline.freshProvider) patch.freshProvider = draft.freshProvider;
  return patch;
}

/** 就地校验只针对「改过的」maxMembers：没改的越界历史值不该连带拦住只改 freshProvider 的保存。 */
export function maxMembersChanged(draft, baseline) {
  return draft.maxMembers !== '' && draft.maxMembers !== baseline.maxMembers;
}
