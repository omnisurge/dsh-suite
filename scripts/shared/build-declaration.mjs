/**
 * 冻结前的"构建产物 ↔ 声明同源"校验。
 *
 * 候选是**构建出来的字节**，不是 manifest 一个文件。0.2.2-2 实测过这条缝的代价：只改 `package.json` 而不重建，
 * 打出来的 tarball 里 `lib/searxng.js` 仍带上一版 `version`（组件行判 loaded≠carried，永久"需重启"），
 * `lib/client.js` 仍内联上一版已验证运行时清单（rc.5 上页面自己挂"未验证"横幅）。前者能一路绿到发布，
 * 因为组合门禁用桩答案、G5 不查组件行；后者只有 client-composition 的一条字节断言会红。
 *
 * 因此把判断收成一个纯函数：交给它三份文本，它要么静默通过，要么按码抛错。纯函数是为了能单元测试，
 * 不必为了验证一个断言而真跑一次构建。
 */

/** 构建时写进 `lib/searxng.js` 的 host build stamp：version 必须等于被打包 manifest 的 version。 */
const STAMP=/omnisurgeSearxngHostBuild"\s*,\s*\{\s*version\s*:\s*"([^"]+)"/u;

export function readBuildStamp(stampSource){
 const match=STAMP.exec(String(stampSource??''));
 if(!match)throw Error('SUITE_BUILD_STAMP_MISSING: packages/suite/lib/searxng.js carries no omnisurgeSearxngHostBuild version; run pnpm build');
 return match[1];
}

/**
 * @param {{suiteJson:{version?:string,omnisurge?:{verifiedRuntimes?:unknown[]}}, stampSource:string, clientSource:string}} input
 * @returns {{version:string, runtimes:string[]}} 通过时的构建事实，便于调用方落日志
 */
export function assertBuildMatchesDeclaration({suiteJson,stampSource,clientSource}){
 const declared=String(suiteJson?.version??'');
 const built=readBuildStamp(stampSource);
 if(built!==declared)throw Error('SUITE_BUILD_STALE: the built bundle carries version '+built+' but package.json declares '+declared+'; run pnpm build before packing');
 const entries=suiteJson?.omnisurge?.verifiedRuntimes;
 if(!Array.isArray(entries))throw Error('SUITE_BUILD_STALE: omnisurge.verifiedRuntimes is not an array; run pnpm build before packing');
 const runtimes=entries.map(entry=>entry?.version).filter(version=>typeof version==='string'&&version.trim()!=='');
 if(runtimes.length===0)throw Error('SUITE_BUILD_STALE: omnisurge.verifiedRuntimes declares no readable version; run pnpm build before packing');
 const missing=runtimes.filter(version=>!String(clientSource??'').includes(version));
 if(missing.length>0)throw Error('SUITE_BUILD_STALE: the Client bundle does not carry '+missing.join(', ')+'; run pnpm build before packing');
 return {version:built,runtimes};
}
