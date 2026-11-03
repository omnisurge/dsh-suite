// View-only localization: preserve raw diagnostics, never reinterpret receipts or retry.
import {Disclosure} from '@omnisurge/dsh-ui';
export function renderTechnicalFailure(h,t,summary,diagnostic){
 // 折叠处用共享库的 Disclosure：同一页面的其它折叠区（高级设置、原始诊断）都是它，
 // 手搓 <details>/<summary> 会让这一块与宿主外观脱节。
 return h('section',{role:'alert'},
  h('p',null,t(summary)),
  h(Disclosure,{title:t('technicalDetails')},
   h('pre',{className:'omni-ui-excerpt'},String(diagnostic))));
}
