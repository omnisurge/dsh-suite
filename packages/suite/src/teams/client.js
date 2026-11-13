import * as React from 'react';
import {
  ActionGroup, Badge, Button, NotesPad,
  SettingsCard, StatusLine, Switch, injectStyles, registerSettingsPluginCard,
} from '@omnisurge/dsh-ui';
// 卡片用的常量只有一处声明（limits.json）：Client 侧就地校验与 Host 侧 schema/写入闸门读同一份数据。
import limits from '../limits.json' with { type: 'json' };

/**
 * Agent Teams 设置：两张独立设置卡（ADR-093 退役成员上限卡后）。
 * - ExtremeCard  极限模式：只一个开关（规则 deepseek+flash 与提示词内置），configForms 即时生效。
 * - NotesCard    环境笔记：profile 级、所有会话注入的一段系统提示。
 *
 * 纪律（ADR-054/058/060/061/062/065 + AGENTS §5/§11）：
 * - 卡片注册不以 Remote 命名空间可达为前置：命名空间在 apply 内单独持句柄。
 * - 每张卡只读自己需要的那一条链，失败只报自己这块，不影响别的卡。
 * - 用户可见措辞只在本词典；机器码不作主文案。
 * - 根节点是 token 宿主（顶层 .omni-ui）。
 * - 保存按钮与内容同块、右对齐（与现有卡片一致，不用独立 footer）。
 */
const NS = 'omnisurge-agent-teams';
export const inject = ['slots', 'locale', 'remote', 'configForms'];

const h = React.createElement;
const REASON = (issue) => (issue && issue.message ? issue.message : String(issue));
const codeOf = (result) => (result && result.error && typeof result.error.code === 'string' ? result.error.code : null);
const ROOT = 'omni-ui omni-ui-stack';
const READ_TIMEOUT_MS = 15000;

const EXTREME_MODELS = [...limits.defaultModels];
const EXTREME_TEXT = limits.extremePromptText;
const NOTES_MAX_BYTES = limits.maxNotesBytes;

const utf8Bytes = (text) => {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return decodeURIComponent(encodeURIComponent(text)).length;
};
const fill = (template, values) => {
  let text = template;
  for (const [key, value] of Object.entries(values)) text = text.split('{' + key + '}').join(String(value));
  return text;
};

function makeCall(wire) {
  return async (method, ...args) => {
    const namespace = wire.namespace;
    if (!namespace || typeof namespace[method] !== 'function') throw new Error('SUITE_NAMESPACE_MISSING ' + method);
    let result;
    try { result = await namespace[method](...args); }
    catch (issue) { throw new Error('SUITE_CARRIER_FAILED ' + method + ' → ' + REASON(issue)); }
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new Error('SUITE_RESULT_INVALID ' + method);
    if (result.ok !== true) {
      const code = codeOf(result);
      throw new Error('SUITE_HOST_REFUSED ' + method + (code ? ' [' + code + ']' : ''));
    }
    return result.value;
  };
}

// 单条读链预算：Remote 不收 signal，超时如实报“这块不可达”，不无限 Loading。
const budget = (promise, method) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('SUITE_READ_TIMEOUT ' + method)), READ_TIMEOUT_MS);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (failure) => { clearTimeout(timer); reject(failure); });
});

const en = {
  save: 'Save',
  unchanged: 'No change.', refused: 'The save was refused',
  extremeTitle: 'Extreme mode',
  extremeSummary: 'Extreme mode for DeepSeek Flash',
  extremeDesc: "Only for DeepSeek Flash. When on, a fixed prompt is added so the model works as if its token budget were unlimited.",
  enableLabel: 'Enable extreme mode',
  extremeHint: 'The matching rule (deepseek + flash) and the prompt text are built in and not shown.',
  currentModel: 'Model', modelUnknown: 'model unknown', modelUnreadable: 'cannot read the current session',
  limitRuleLabel: 'Match rule (name contains)', limitRuleNone: 'none', sampleLabel: 'Sample model',
  matched: "matched — prompt used", notMatched: "not matched — prompt not added",
  notDeterminable: "cannot tell yet; adding the prompt depends on each session’s model",
  matchedButOff: "matched, but the switch is off (or the prompt is empty) — nothing added",
  limitUnavailable: "No system prompt support; extreme mode unavailable.",
  stale: 'These settings changed elsewhere while you were editing. Nothing was overwritten — reload and retry.',
  notesTitle: 'Environment notes',
  notesSummary: "Notes added to every session",
  notesDesc: 'These notes are added to every session’s system prompt so the model remembers your project conventions and environment.',
  notesBadge: 'all sessions',
  notesHint: "Applies from the next step without a restart; your text is added verbatim.",
  notesTooLarge: "Too large: use at most {max} UTF-8 bytes.",
  notesUnavailable: "Notes unreadable; reload to retry.",
  saved: 'Saved.', loadFailed: "This section could not be read", loadFailedNamespace: "The page is not connected to the background service. Reopen the plugin settings and try again.", loadFailedCarrier: "The background service is unavailable; no settings were changed. Reopen the plugin settings and try again.", loadFailedRefused: "The background service refused this read; no settings were changed. Reload and try again.", reload: 'Retry', loading: 'Loading…',
};

const zh = {
  save: '保存',
  unchanged: '没有变化。', refused: '保存被拒绝',
  extremeTitle: '极限模式',
  extremeSummary: 'DeepSeek Flash 的极限模式开关',
  extremeDesc: "仅对 DeepSeek Flash 生效。开启后会添加固定提示，让模型按“token 预算不受限、无需节省”的方式工作。",
  enableLabel: '启用极限模式',
  extremeHint: '匹配规则（deepseek + flash）与提示词内容内置，不在界面暴露。',
  currentModel: '模型', modelUnknown: '模型未知', modelUnreadable: '读不到当前会话',
  limitRuleLabel: '匹配规则（模型名需含）', limitRuleNone: '无', sampleLabel: '取样模型',
  matched: "已匹配，提示已添加", notMatched: "当前模型不匹配，不添加提示",
  notDeterminable: "暂时无法判断；是否添加提示取决于各会话的模型",
  matchedButOff: "模型已匹配，但开关已关（或提示为空），未添加提示",
  limitUnavailable: "当前应用不支持系统提示，极限模式无法使用。",
  stale: '编辑期间配置已在别处改变。没有覆盖任何内容——请重新载入后再改一次。',
  notesTitle: '环境笔记',
  notesSummary: "添加到所有会话的环境笔记",
  notesDesc: "这段笔记会添加到所有会话的系统提示中，让模型记住项目约定与环境信息。",
  notesBadge: '对所有会话生效',
  notesHint: "保存后从下一步生效，无需重启；你的原文会原样添加，不改写。",
  notesTooLarge: '太长了：请控制在 {max} 字节（UTF-8）以内。',
  notesUnavailable: "无法读取笔记，请重新载入。",
  saved: '已保存。', loadFailed: "此分区无法读取", loadFailedNamespace: "页面没有连接到后台，未读取任何设置；请重新打开插件设置后再试。", loadFailedCarrier: "后台暂时不可用，未修改任何设置；请重新打开插件设置后再试。", loadFailedRefused: "后台拒绝了这次读取，未修改任何设置；请重新载入后再试。", reload: '重试', loading: '加载中…',
};

function loadState(){
  const [phase,setPhase]=React.useState('loading');
  const [issue,setIssue]=React.useState(null);
  const alive=React.useRef(true);
  React.useEffect(()=>{alive.current=true;return()=>{alive.current=false};},[]);
  return {phase,setPhase,issue,setIssue,alive};
}
function Shell({t, view, summary, children}){
  if (view === 'summary') return h('p', { className: 'omni-ui-hint', 'data-testid': 'teams-summary' }, summary);
  return h('section', { className: ROOT, 'data-testid': 'teams-card' }, children);
}
function LoadFailed({t, label, issue, onRetry}){
  const sentence=typeof issue==='string'&&issue.startsWith('SUITE_NAMESPACE_MISSING')?t('loadFailedNamespace'):typeof issue==='string'&&issue.startsWith('SUITE_CARRIER_FAILED')?t('loadFailedCarrier'):typeof issue==='string'&&issue.startsWith('SUITE_HOST_REFUSED')?t('loadFailedRefused'):t('loadFailed');
  return h(React.Fragment, null,
    h(StatusLine, { tone: 'warn', role: 'alert', 'data-testid': 'teams-load-failed' }, sentence),
    h(ActionGroup, null, h(Button, { variant: 'ghost', onClick: onRetry }, t('reload'))));
}
function Loading({t}){ return h('p', { className: 'omni-ui-hint', 'data-testid': 'teams-loading' }, t('loading')); }

function ExtremeCard({ t, wire, limitForm, view }){
  const call = React.useMemo(() => makeCall(wire), [wire]);
  const st = loadState();
  const [status,setStatus]=React.useState(null);
  const [enabled,setEnabled]=React.useState(false);
  const [baseRev,setBaseRev]=React.useState(null);
  const [save,setSave]=React.useState(null);
  const snapshot = React.useCallback(() => (limitForm && typeof limitForm.getSnapshot === 'function' ? limitForm.getSnapshot() : null), [limitForm]);
  const load = React.useCallback(async () => {
    st.setPhase('loading');
    try {
      const value = await budget(call('limitModeStatus'), 'limitModeStatus');
      if (!st.alive.current) return;
      setStatus(value); st.setPhase('ready');
      const s = snapshot();
      setBaseRev(s && typeof s.revision === 'number' ? s.revision : null);
      const stored = s && s.value && s.value.limitMode ? s.value.limitMode : null;
      setEnabled(stored ? stored.enabled === true : !!(value && value.enabled === true));
    } catch (failure) { if (!st.alive.current) return; st.setIssue(REASON(failure)); st.setPhase('failed'); }
  }, [call, snapshot]);
  React.useEffect(() => { void load(); }, [load]);
  const saveToggle = async () => {
    if (!limitForm || typeof limitForm.getSnapshot !== 'function') { setSave({ state: 'refused', code: 'LIMIT_MODE_CONFIG_UNAVAILABLE' }); return; }
    const s = limitForm.getSnapshot();
    if (!s || s.status !== 'ready' || s.writable !== true) { setSave({ state: 'refused', code: 'LIMIT_MODE_CONFIG_UNAVAILABLE' }); return; }
    if (typeof baseRev !== 'number' || baseRev !== s.revision) { setSave({ state: 'stale' }); return; }
    const stored = s.value && s.value.limitMode ? s.value.limitMode : {};
    const next = { enabled, models: [...EXTREME_MODELS], text: EXTREME_TEXT };
    const unchanged = (stored.enabled === true) === next.enabled
      && JSON.stringify(Array.isArray(stored.models) ? stored.models : []) === JSON.stringify(next.models)
      && (typeof stored.text === 'string' ? stored.text : '') === next.text;
    if (unchanged) { setSave({ state: 'unchanged' }); return; }
    setSave({ state: 'saving' });
    try {
      const accepted = await limitForm.mutate([{ op: 'set', path: ['limitMode'], value: next }], baseRev);
      if (!st.alive.current) return;
      if (!accepted) { setSave({ state: 'refused', code: 'SETTINGS_NOT_CONFIRMED' }); return; }
      const s2 = snapshot();
      setBaseRev(s2 && typeof s2.revision === 'number' ? s2.revision : null);
      setSave({ state: 'saved' });
    } catch (failure) { if (st.alive.current) setSave({ state: 'refused', code: REASON(failure) }); }
  };
  if (st.phase === 'loading') return h(Shell, { t, view, summary: t('extremeSummary') }, h(Loading, { t }));
  if (st.phase === 'failed') return h(Shell, { t, view, summary: t('extremeSummary') }, h(LoadFailed, { t, issue: st.issue, onRetry: () => void load() }));
  const available = status && status.available === true;
  const sel = status && status.selection;
  // "unreadable" is not "does not match": when no agent can answer, the page says it cannot tell.
  const modelText = sel ? sel.provider + '/' + sel.model : t('modelUnreadable');
  const injectActive = !!(status && status.enabled === true) && !!(status && status.matched) && typeof status.textLength === 'number' && status.textLength > 0;
  const rulePatterns = status && Array.isArray(status.models) ? status.models : [];
  const ruleText = rulePatterns.length > 0 ? rulePatterns.join(' + ') : t('limitRuleNone');
  const receipt = save === null ? null
    : save.state === 'saved' ? h(StatusLine, { tone: 'ok', 'data-testid': 'limit-mode-receipt' }, t('saved'))
    : save.state === 'unchanged' ? h('p', { className: 'omni-ui-hint' }, t('unchanged'))
    : save.state === 'stale' ? h(StatusLine, { tone: 'warn', role: 'alert', 'data-testid': 'limit-mode-stale' }, t('stale'))
    : save.state === 'refused' ? h(StatusLine, { tone: 'warn', role: 'alert' }, t('refused') + ' (' + save.code + ')') : null;
  return h(Shell, { t, view, summary: t('extremeSummary') },
    h(SettingsCard, { title: t('extremeTitle'), description: t('extremeDesc') },
      available
        ? h(React.Fragment, null,
            h(Switch, { label: t('enableLabel'), 'data-testid': 'limit-mode-switch', checked: enabled, onChange: (event) => setEnabled(event.target.checked) }),
            h(StatusLine, { tone: injectActive ? 'ok' : 'warn', 'data-testid': 'limit-mode-status' },
              t('limitRuleLabel') + ': ' + ruleText + ' · ' + t('sampleLabel') + ': ' + modelText + ' · ' + (injectActive ? t('matched') : (!sel ? t('notDeterminable') : (status && status.matched ? t('matchedButOff') : t('notMatched'))))),
            h('p', { className: 'omni-ui-hint' }, t('extremeHint')),
            h(ActionGroup, null,
              h(Button, { variant: 'primary', 'data-testid': 'limit-mode-save', busy: save !== null && save.state === 'saving', onClick: () => void saveToggle() }, t('save'))))
        : h(StatusLine, { tone: 'warn', 'data-testid': 'limit-mode-unavailable' }, t('limitUnavailable')),
      receipt));
}

function NotesCard({ t, wire, view }){
  const call = React.useMemo(() => makeCall(wire), [wire]);
  const st = loadState();
  const [notes,setNotes]=React.useState(null);
  const [text,setText]=React.useState('');
  const [save,setSave]=React.useState(null);
  const load = React.useCallback(async () => {
    st.setPhase('loading');
    try {
      const value = await budget(call('environmentNotes'), 'environmentNotes');
      if (!st.alive.current) return;
      setNotes(value); setText(typeof value.text === 'string' ? value.text : ''); st.setPhase('ready');
    } catch (failure) { if (!st.alive.current) return; st.setIssue(REASON(failure)); st.setPhase('failed'); }
  }, [call]);
  React.useEffect(() => { void load(); }, [load]);
  const saveNotes = async () => {
    setSave({ state: 'saving' });
    try {
      const written = await call('saveEnvironmentNotes', text);
      if (!st.alive.current) return;
      if (written && written.code) { setSave({ state: 'refused', code: written.code }); return; }
      setSave({ state: 'saved' });
    } catch (failure) { if (st.alive.current) setSave({ state: 'refused', code: REASON(failure) }); }
  };
  if (st.phase === 'loading') return h(Shell, { t, view, summary: t('notesSummary') }, h(Loading, { t }));
  if (st.phase === 'failed') return h(Shell, { t, view, summary: t('notesSummary') }, h(LoadFailed, { t, issue: st.issue, onRetry: () => void load() }));
  const available = notes && notes.available !== false;
  const receipt = save === null ? null
    : save.state === 'saved' ? h(StatusLine, { tone: 'ok', 'data-testid': 'notes-receipt' }, t('saved'))
    : save.state === 'refused' ? h(StatusLine, { tone: 'warn', role: 'alert' }, save.code === 'ENVIRONMENT_NOTES_TOO_LARGE' ? fill(t('notesTooLarge'), { max: NOTES_MAX_BYTES }) : t('refused') + ' (' + save.code + ')') : null;
  return h(Shell, { t, view, summary: t('notesSummary') },
    h(SettingsCard, { title: t('notesTitle'), description: t('notesDesc') },
      available
        ? h(React.Fragment, null,
            h(NotesPad, { value: text, rows: 7, maxChars: NOTES_MAX_BYTES, usedChars: utf8Bytes(text), status: h(Badge, { tone: 'muted' }, t('notesBadge')), 'data-testid': 'environment-notes-pad', onChange: (event) => setText(event.target.value) }),
            h('p', { className: 'omni-ui-hint' }, t('notesHint')),
            h(ActionGroup, null,
              h(Button, { variant: 'primary', 'data-testid': 'environment-notes-save', busy: save !== null && save.state === 'saving', onClick: () => void saveNotes() }, t('save'))))
        : h(StatusLine, { tone: 'warn', 'data-testid': 'notes-unavailable' }, t('notesUnavailable')),
      receipt));
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'omnisurge: teams cards locale');
  ctx.effect(() => { injectStyles(); }, 'omnisurge: teams cards token sheet');
  const wire = { namespace: null };
  ctx.effect(() => {
    const scoped = ctx.inject(['remote', 'remote.omnisurgeSuiteDev'], (inner) => {
      wire.namespace = inner.remote.omnisurgeSuiteDev;
      return () => { wire.namespace = null; };
    });
    return () => { wire.namespace = null; void scoped.dispose(); };
  }, 'omnisurge: hold the teams Remote namespace while the Host serves it');
  ctx.effect(() => ctx.inject(['configForms'], (inner) => {
    const t = inner.locale.bind(NS);
    const limitForm = inner.configForms.get(NS);
    return inner.configForms.whileServed([NS], () => {
      const b = registerSettingsPluginCard(inner, { id: NS + '-limit', order: 31, label: () => t('extremeTitle'), locale: NS, inject: () => ({ t, wire, limitForm }) }, ExtremeCard);
      const c = registerSettingsPluginCard(inner, { id: NS + '-notes', order: 32, label: () => t('notesTitle'), locale: NS, inject: () => ({ t, wire }) }, NotesCard);
      return () => { b(); c(); };
    });
  }), 'omnisurge: two settings cards for extreme mode / notes (ADR-093 retired the members card)');
}
