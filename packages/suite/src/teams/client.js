import * as React from 'react';
import {
  ActionGroup, Badge, Banner, Button, KeyValueList, NotesPad,
  StatusLine, Switch, injectStyles, registerSettingsPluginCard, showToast,
} from '@omnisurge/dsh-ui';
// 卡片用的常量只有一处声明（limits.json）：Client 侧就地校验与 Host 侧 schema/写入闸门读同一份数据。
import limits from '../limits.json' with { type: 'json' };
import { DiagnosticDisclosure } from '../shared/DiagnosticDisclosure.js';
import { fillTemplate as fill } from '../shared/client-copy.js';
import { createRemoteCaller } from '../shared/client-remote.js';

/**
 * Agent Teams 设置：三张独立设置卡（ADR-093 退役成员上限卡后；ADR-097 增加团队模式卡；ADR-121 Batch B1 UI 2.0）。
 * - TeamModeCard 团队模式：新会话默认开启的官方 defaultEnabled 开关，走官方 configEditor。
 * - ExtremeCard  极限模式：只一个开关（规则 deepseek+flash 与提示词内置），configForms 即时生效。
 * - NotesCard    环境笔记：profile 级、所有会话添加的一段系统提示。
 *
 * 纪律（ADR-054/058/060/061/062/065/121 + AGENTS §5/§11）：
 * - 卡片注册不以 Remote 命名空间可达为前置：命名空间在 apply 内单独持句柄。
 * - 宿主 plugins.item 已提供外层卡框与标题，三卡在 view==='page' 下直接扁平渲染 .omni-ui-tokens.omni-ui-stack，不再内嵌 SettingsCard 或重复 h3。
 * - 每张卡只读自己需要的那一条链，失败只报自己这块，不影响别的卡；技术诊断码统一收进默认折叠的 DiagnosticDisclosure。
 * - 用户可见措辞只在本词典；机器码不作主文案。
 */
const NS = 'omnisurge-agent-teams';
export const inject = ['slots', 'locale', 'remote', 'configForms'];

const h = React.createElement;
const REASON = (issue) => (issue && issue.message ? issue.message : String(issue));
const ROOT = 'omni-ui-tokens omni-ui-stack';
const READ_TIMEOUT_MS = 15000;

const EXTREME_MODELS = [...limits.defaultModels];
const EXTREME_TEXT = limits.extremePromptText;
const NOTES_MAX_BYTES = limits.maxNotesBytes;

const utf8Bytes = (text) => {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return decodeURIComponent(encodeURIComponent(text)).length;
};

const makeCall = (wire) => createRemoteCaller(wire, { timeoutMs: READ_TIMEOUT_MS });
// Reads are bounded; writes stay unbounded so a slow profile write is never misreported as a read timeout.
const makeWriteCall = (wire) => createRemoteCaller(wire, { timeoutMs: 0 });

const en = {
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  closeToast: 'Close',
  rawDetails: 'Raw technical diagnostics',
  unchanged: 'No change.',
  unsavedChanges: 'Unsaved changes',
  refused: 'Could not save changes. Please try again, or reopen plugin settings if it keeps failing.',
  extremeTitle: 'Extreme mode',
  extremeSummary: 'Extreme mode for DeepSeek Flash',
  extremeSummaryOn: 'Extreme mode for DeepSeek Flash (currently: on)',
  extremeSummaryOff: 'Extreme mode for DeepSeek Flash (currently: off)',
  extremeDesc: 'Applies only to models matching the built-in rule. When on, the model expands thinking and responses fully; takes effect from the next step after saving without restarting.',
  enableLabel: 'Enable extreme mode',
  teamTitle: 'Team mode',
  teamSummary: 'New sessions start with team mode',
  teamSummaryOn: 'New sessions start with team mode (currently: on)',
  teamSummaryOff: 'New sessions start with team mode (currently: off)',
  teamDesc: 'Default for new sessions only. Existing and resumed sessions keep their own choice and can turn team mode off per session.',
  teamEnableLabel: 'Start new sessions with team mode on',
  teamCurrentOn: 'Current default: on',
  teamCurrentOff: 'Current default: off',
  teamUnavailable: 'The official Agent Teams setting is unavailable; defaults cannot be changed.',
  teamSaveFailed: 'The default was not saved. Please try again.',
  teamSavedToast: 'Team mode default saved.',
  modelUnreadable: 'cannot read the current session',
  limitRuleLabel: 'Match rule',
  limitRuleBuiltin: 'Built-in rule (model name must contain {patterns})',
  limitRuleNone: 'none',
  sampleLabel: 'Current sample model',
  sampleModelHint: 'Sampled from the most recent active session; other sessions may use a different model.',
  matched: 'Current sample model matched; prompt is active.',
  notMatched: 'Current sample model does not match; prompt not added.',
  notDeterminable: 'Cannot tell yet; adding the prompt depends on each session’s model.',
  matchedButOff: 'Model matched, but the switch is off (or the prompt is empty); prompt not added.',
  limitUnavailable: 'System prompts are unavailable in this app; extreme mode cannot be used.',
  stale: 'These settings were updated elsewhere while you were editing. Nothing was saved to avoid overwriting; reload before saving again.',
  limitStaleFooter: 'Unsaved changes; reload before saving',
  limitCleanFooter: 'No unsaved changes',
  limitRefusedFooter: 'Changes were not saved',
  limitSavedToast: 'Extreme mode settings saved.',
  limitReloadedToast: 'Latest settings reloaded.',
  reloadLatest: 'Reload',
  notesTitle: 'Environment notes',
  notesSummary: 'Notes added to every session',
  notesSummaryUsed: 'Notes added to every session ({bytes} / {max} bytes used)',
  notesDesc: 'Write project conventions and environment facts to add to every session’s system prompt. Applies from the next step after saving without restarting; text is added verbatim.',
  notesBadge: 'all sessions',
  notesTooLarge: 'Content exceeds the {max} UTF-8 byte limit. Shorten it before saving.',
  notesUnavailable: 'Cannot read environment notes right now. Reload to try again.',
  notesSavedToast: 'Environment notes saved.',
  saved: 'Saved.',
  loadFailed: 'This section could not be read.',
  loadFailedNamespace: 'The page is not connected to the background. Reopen plugin settings and try again.',
  loadFailedCarrier: 'The background is unavailable; no settings were changed. Reopen plugin settings and try again.',
  loadFailedRefused: 'The background refused this read; no settings were changed. Reload and try again.',
  reload: 'Retry',
  loading: 'Loading…',
};

const zh = {
  save: '保存',
  saving: '保存中…',
  cancel: '取消',
  closeToast: '关闭',
  rawDetails: '原始技术诊断',
  unchanged: '没有变化。',
  unsavedChanges: '有未保存的更改',
  refused: '这次保存没有成功，请重试；如果仍然失败，请重新打开插件设置。',
  extremeTitle: '极限模式',
  extremeSummary: 'DeepSeek Flash 极限模式',
  extremeSummaryOn: 'DeepSeek Flash 极限模式（当前：开启）',
  extremeSummaryOff: 'DeepSeek Flash 极限模式（当前：关闭）',
  extremeDesc: '仅适用于匹配内置条件的模型。开启后允许模型充分展开思考与输出，保存后从下一步生效，无需重启。',
  enableLabel: '启用极限模式',
  teamTitle: '团队模式',
  teamSummary: '新会话默认开启团队模式',
  teamSummaryOn: '新会话默认开启团队模式（当前：开启）',
  teamSummaryOff: '新会话默认开启团队模式（当前：关闭）',
  teamDesc: '仅作为新建会话的默认选项；已有会话和恢复的会话保持原有选择，且可在单个会话中随时手动关闭。',
  teamEnableLabel: '新会话默认开启团队模式',
  teamCurrentOn: '当前默认：开启',
  teamCurrentOff: '当前默认：关闭',
  teamUnavailable: '官方团队功能暂不可用，当前无法修改默认值。',
  teamSaveFailed: '默认值未保存成功，请重试。',
  teamSavedToast: '团队模式默认设置已保存',
  modelUnreadable: '读不到当前会话',
  limitRuleLabel: '匹配条件',
  limitRuleBuiltin: '内置规则（模型名需含 {patterns}）',
  limitRuleNone: '无',
  sampleLabel: '当前取样模型',
  sampleModelHint: '取样来自最近活跃会话，不代表所有会话均使用同一模型。',
  matched: '当前取样模型已匹配，提示词生效中',
  notMatched: '当前取样模型不匹配，未添加提示',
  notDeterminable: '暂时无法判断；是否生效取决于各会话实际模型',
  matchedButOff: '模型已匹配，但开关已关闭（或提示为空），未添加提示',
  limitUnavailable: '当前应用不支持系统提示，极限模式暂不可用。',
  stale: '编辑期间该设置已在别处更新，本次未保存以避免覆盖；请先重新载入后再试。',
  limitStaleFooter: '有未保存的更改，请先重新载入',
  limitCleanFooter: '无未保存更改',
  limitRefusedFooter: '保存未生效',
  limitSavedToast: '极限模式设置已保存',
  limitReloadedToast: '已重新载入最新配置',
  reloadLatest: '重新载入',
  notesTitle: '环境笔记',
  notesSummary: '添加到所有会话的环境笔记',
  notesSummaryUsed: '添加到所有会话的环境笔记（已用 {bytes} / {max} 字节）',
  notesDesc: '写入项目约定与环境事实，添加到所有会话的系统提示中；保存后从下一步生效，无需重启，按原文添加，不改写。',
  notesBadge: '对所有会话生效',
  notesTooLarge: '内容超出 {max} 字节上限，请精简后再保存。',
  notesUnavailable: '暂时无法读取环境笔记，请重新载入重试。',
  notesSavedToast: '环境笔记已保存',
  saved: '已保存。',
  loadFailed: '此分区无法读取。',
  loadFailedNamespace: '页面没有连接到后台，未读取任何设置；请重新打开插件设置后再试。',
  loadFailedCarrier: '后台暂时不可用，未修改任何设置；请重新打开插件设置后再试。',
  loadFailedRefused: '后台拒绝了这次读取，未修改任何设置；请重新载入后再试。',
  reload: '重试',
  loading: '加载中…',
};

function loadState() {
  const [phase, setPhase] = React.useState('loading');
  const [issue, setIssue] = React.useState(null);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return { phase, setPhase, issue, setIssue, alive };
}

function Shell({ view, summary, children }) {
  if (view === 'summary') return h('p', { className: 'omni-ui-hint', 'data-testid': 'teams-summary' }, summary);
  return h('section', { className: ROOT, 'data-testid': 'teams-card' }, children);
}

function LoadFailed({ t, issue, onRetry }) {
  const sentence = typeof issue === 'string' && issue.startsWith('SUITE_NAMESPACE_MISSING') ? t('loadFailedNamespace')
    : typeof issue === 'string' && issue.startsWith('SUITE_CARRIER_FAILED') ? t('loadFailedCarrier')
    : typeof issue === 'string' && issue.startsWith('SUITE_HOST_REFUSED') ? t('loadFailedRefused')
    : t('loadFailed');
  return h(React.Fragment, null,
    h(Banner, { tone: 'err', role: 'alert', 'data-testid': 'teams-load-failed' },
      h('p', null, sentence),
      issue ? h(DiagnosticDisclosure, { testId: 'teams-load-failed-raw', title: t('rawDetails'), text: String(issue) }) : null),
    h(ActionGroup, { align: 'start' },
      h(Button, { variant: 'default', 'data-testid': 'teams-load-retry', onClick: onRetry }, t('reload'))));
}

function Loading({ t }) {
  return h('p', { className: 'omni-ui-hint', 'data-testid': 'teams-loading' }, t('loading'));
}

function ExtremeCard({ t, wire, limitForm, view }) {
  const call = React.useMemo(() => makeCall(wire), [wire]);
  const st = loadState();
  const [status, setStatus] = React.useState(null);
  const [persistedEnabled, setPersistedEnabled] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [baseRev, setBaseRev] = React.useState(null);
  const [save, setSave] = React.useState(null);
  const [reloading, setReloading] = React.useState(false);
  const snapshot = React.useCallback(() => (limitForm && typeof limitForm.getSnapshot === 'function' ? limitForm.getSnapshot() : null), [limitForm]);

  const applyLoaded = React.useCallback((value, s) => {
    setStatus(value);
    setBaseRev(s && typeof s.revision === 'number' ? s.revision : null);
    const stored = s && s.value && s.value.limitMode ? s.value.limitMode : null;
    const persisted = stored ? stored.enabled === true : !!(value && value.enabled === true);
    setPersistedEnabled(persisted);
    setEnabled(persisted);
    setSave(null);
  }, []);

  const load = React.useCallback(async () => {
    st.setPhase('loading');
    st.setIssue(null);
    try {
      const value = await call('limitModeStatus');
      if (!st.alive.current) return;
      applyLoaded(value, snapshot());
      st.setPhase('ready');
    } catch (failure) {
      if (!st.alive.current) return;
      st.setIssue(REASON(failure));
      st.setPhase('failed');
    }
  }, [applyLoaded, call, snapshot]);

  React.useEffect(() => { void load(); }, [load]);

  const reloadLatest = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      const value = await call('limitModeStatus');
      if (!st.alive.current) return;
      applyLoaded(value, snapshot());
      showToast({ kind: NS + '-limit', text: t('limitReloadedToast'), tone: 'ok', closeLabel: t('closeToast') });
    } catch (failure) {
      if (st.alive.current) setSave({ state: 'refused', code: REASON(failure) });
    } finally {
      if (st.alive.current) setReloading(false);
    }
  };

  const saveToggle = async () => {
    if (!limitForm || typeof limitForm.getSnapshot !== 'function') {
      setSave({ state: 'refused', code: 'LIMIT_MODE_CONFIG_UNAVAILABLE' });
      return;
    }
    const s = limitForm.getSnapshot();
    if (!s || s.status !== 'ready' || s.writable !== true) {
      setSave({ state: 'refused', code: 'LIMIT_MODE_CONFIG_UNAVAILABLE' });
      return;
    }
    if (typeof baseRev !== 'number' || baseRev !== s.revision) {
      setSave({
        state: 'stale',
        code: 'LIMIT_MODE_REVISION_CONFLICT',
        detail: `expectedRevision=${String(baseRev)}, currentRevision=${String(s.revision)}`,
      });
      return;
    }
    const stored = s.value && s.value.limitMode ? s.value.limitMode : {};
    const next = { enabled, models: [...EXTREME_MODELS], text: EXTREME_TEXT };
    const unchanged = (stored.enabled === true) === next.enabled
      && JSON.stringify(Array.isArray(stored.models) ? stored.models : []) === JSON.stringify(next.models)
      && (typeof stored.text === 'string' ? stored.text : '') === next.text;
    if (unchanged) {
      setSave({ state: 'unchanged' });
      return;
    }
    setSave({ state: 'saving' });
    try {
      const accepted = await limitForm.mutate([{ op: 'set', path: ['limitMode'], value: next }], baseRev);
      if (!st.alive.current) return;
      const s2 = snapshot();
      if (!accepted) {
        if (s2 !== null && s2 !== undefined && s2.revision !== undefined && s2.revision !== baseRev) {
          setSave({
            state: 'stale',
            code: 'LIMIT_MODE_REVISION_CONFLICT',
            detail: `expectedRevision=${String(baseRev)}, currentRevision=${String(s2.revision)}`,
          });
        } else {
          setSave({ state: 'refused', code: 'SETTINGS_NOT_CONFIRMED' });
        }
        return;
      }
      setBaseRev(s2 && typeof s2.revision === 'number' ? s2.revision : baseRev);
      setPersistedEnabled(next.enabled);
      setStatus((current) => (current ? { ...current, enabled: next.enabled, models: next.models, textLength: next.text.trim().length } : current));
      setSave({ state: 'saved' });
      showToast({ kind: NS + '-limit', text: t('limitSavedToast'), tone: 'ok', closeLabel: t('closeToast') });
    } catch (failure) {
      if (st.alive.current) setSave({ state: 'refused', code: REASON(failure) });
    }
  };

  const available = st.phase === 'ready' && status && status.available === true;
  const summaryText = available
    ? (persistedEnabled ? t('extremeSummaryOn') : t('extremeSummaryOff'))
    : t('extremeSummary');

  if (st.phase === 'loading') return h(Shell, { view, summary: summaryText }, h(Loading, { t }));
  if (st.phase === 'failed') return h(Shell, { view, summary: summaryText }, h(LoadFailed, { t, issue: st.issue, onRetry: () => void load() }));

  const sel = status && status.selection;
  // "unreadable" is not "does not match": when no agent can answer, the page says it cannot tell.
  const modelText = sel ? sel.provider + '/' + sel.model : t('modelUnreadable');
  const rulePatterns = status && Array.isArray(status.models) ? status.models : [];
  const ruleText = rulePatterns.length > 0 ? fill(t('limitRuleBuiltin'), { patterns: rulePatterns.join(' + ') }) : t('limitRuleNone');
  const hasPromptText = typeof status?.textLength === 'number'
    ? status.textLength > 0
    : (typeof status?.text === 'string' ? status.text.trim().length > 0 : EXTREME_TEXT.trim().length > 0);
  const injectActive = persistedEnabled && !!(status && status.matched) && hasPromptText;
  const statusTone = injectActive ? 'ok' : (!sel ? 'warn' : 'neutral');
  const statusText = injectActive
    ? t('matched')
    : (!sel ? t('notDeterminable') : (status && status.matched ? t('matchedButOff') : t('notMatched')));

  const saving = save !== null && save.state === 'saving';
  const isStale = save !== null && save.state === 'stale';
  const dirty = enabled !== persistedEnabled;

  const conflictOrErrorBanner = isStale
    ? h(Banner, { tone: 'warn', role: 'alert', 'data-testid': 'limit-mode-stale' },
        h('p', null, t('stale')),
        h(ActionGroup, { align: 'start' },
          h(Button, {
            variant: 'default',
            size: 'sm',
            busy: reloading,
            'data-testid': 'limit-mode-reload',
            onClick: () => void reloadLatest(),
          }, t('reloadLatest'))),
        h(DiagnosticDisclosure, {
          testId: 'limit-mode-stale-raw',
          title: t('rawDetails'),
          text: save.detail || save.code || 'LIMIT_MODE_REVISION_CONFLICT',
        }))
    : save !== null && save.state === 'refused'
      ? h(Banner, { tone: 'err', role: 'alert', 'data-testid': 'limit-mode-save-failed' },
          h('p', null, t('refused')),
          save.code ? h(DiagnosticDisclosure, {
            testId: 'limit-mode-save-raw',
            title: t('rawDetails'),
            text: String(save.code),
          }) : null)
      : null;

  const footerStatusNode = h('div', { className: 'omni-ui-hint', 'data-testid': 'limit-mode-footer-status' },
    isStale
      ? t('limitStaleFooter')
      : save !== null && save.state === 'saved'
        ? h(StatusLine, { tone: 'ok', 'data-testid': 'limit-mode-receipt' }, t('saved'))
        : save !== null && save.state === 'unchanged'
          ? t('unchanged')
          : saving
            ? t('saving')
            : save !== null && save.state === 'refused'
              ? t('limitRefusedFooter')
              : dirty
                ? t('unsavedChanges')
                : t('limitCleanFooter'));

  return h(Shell, { view, summary: summaryText },
    available
      ? h(React.Fragment, null,
          h(Switch, {
            align: 'between',
            label: t('enableLabel'),
            description: t('extremeDesc'),
            'data-testid': 'limit-mode-switch',
            checked: enabled,
            disabled: saving || reloading,
            onChange: (event) => {
              setEnabled(event.target.checked);
              setSave((current) => (current && current.state === 'stale' ? current : null));
            },
          }),
          h(StatusLine, { tone: statusTone, 'data-testid': 'limit-mode-status' }, statusText),
          h(KeyValueList, {
            'data-testid': 'limit-mode-kv',
            items: [
              { label: t('limitRuleLabel'), value: ruleText, 'data-value-testid': 'limit-mode-rule-value' },
              {
                label: t('sampleLabel'),
                value: modelText,
                mono: Boolean(sel),
                hint: t('sampleModelHint'),
                'data-value-testid': 'limit-mode-sample-value',
              },
            ],
          }),
          conflictOrErrorBanner,
          h('div', { className: 'omni-ui-actionGroup omni-ui-actionGroup--align-between' },
            footerStatusNode,
            h(ActionGroup, { align: 'end' },
              h(Button, {
                variant: 'ghost',
                'data-testid': 'limit-mode-cancel',
                disabled: !dirty || saving || reloading,
                onClick: () => {
                  setEnabled(persistedEnabled);
                  setSave((current) => (current && current.state === 'stale' ? current : null));
                },
              }, t('cancel')),
              h(Button, {
                variant: 'primary',
                'data-testid': 'limit-mode-save',
                busy: saving,
                disabled: !dirty || isStale || reloading,
                onClick: () => void saveToggle(),
              }, t('save')))))
      : h(StatusLine, { tone: 'warn', 'data-testid': 'limit-mode-unavailable' }, t('limitUnavailable')));
}

function TeamModeCard({ t, wire, view }) {
  const call = React.useMemo(() => makeCall(wire), [wire]);
  const writeCall = React.useMemo(() => makeWriteCall(wire), [wire]);
  const st = loadState();
  const [status, setStatus] = React.useState(null);
  const [enabled, setEnabled] = React.useState(false);
  const [save, setSave] = React.useState(null);

  const load = React.useCallback(async () => {
    st.setPhase('loading');
    st.setIssue(null);
    try {
      const value = await call('teamModeStatus');
      if (!st.alive.current) return;
      setStatus(value);
      setEnabled(!!(value && value.defaultEnabled === true));
      setSave(null);
      st.setPhase('ready');
    } catch (failure) {
      if (!st.alive.current) return;
      st.setIssue(REASON(failure));
      st.setPhase('failed');
    }
  }, [call]);

  React.useEffect(() => { void load(); }, [load]);

  const saveDefault = async () => {
    if (!status || status.available !== true) {
      setSave({ state: 'refused', code: 'TEAM_MODE_UNAVAILABLE' });
      return;
    }
    if (enabled === (status.defaultEnabled === true)) {
      setSave({ state: 'unchanged' });
      return;
    }
    setSave({ state: 'saving' });
    try {
      const written = await writeCall('saveTeamModeDefault', enabled);
      if (!st.alive.current) return;
      if (!written || written.available !== true) {
        setSave({ state: 'refused', code: written && written.code ? written.code : 'TEAM_MODE_WRITE_FAILED' });
        return;
      }
      setStatus(written);
      setEnabled(!!(written.defaultEnabled === true));
      if (written.code) {
        setSave({ state: 'refused', code: written.code });
        return;
      }
      setSave({ state: 'saved' });
      showToast({ kind: NS + '-team', text: t('teamSavedToast'), tone: 'ok', closeLabel: t('closeToast') });
    } catch (failure) {
      if (st.alive.current) setSave({ state: 'refused', code: REASON(failure) });
    }
  };

  const available = st.phase === 'ready' && status && status.available === true;
  const persisted = !!(status && status.defaultEnabled === true);
  const summaryText = available
    ? (persisted ? t('teamSummaryOn') : t('teamSummaryOff'))
    : t('teamSummary');

  if (st.phase === 'loading') return h(Shell, { view, summary: summaryText }, h(Loading, { t }));
  if (st.phase === 'failed') return h(Shell, { view, summary: summaryText }, h(LoadFailed, { t, issue: st.issue, onRetry: () => void load() }));

  const saving = save !== null && save.state === 'saving';
  const dirty = enabled !== persisted;
  const feedback = save === null ? null
    : save.state === 'saved' ? h(StatusLine, { tone: 'ok', 'data-testid': 'team-default-receipt' }, t('saved'))
    : save.state === 'unchanged' ? h('p', { className: 'omni-ui-hint' }, t('unchanged'))
    : save.state === 'refused' ? h(Banner, { tone: 'err', role: 'alert', 'data-testid': 'team-default-save-failed' },
        h('p', null, t('teamSaveFailed')),
        save.code ? h(DiagnosticDisclosure, { testId: 'team-default-save-raw', title: t('rawDetails'), text: String(save.code) }) : null)
    : null;

  return h(Shell, { view, summary: summaryText },
    available
      ? h(React.Fragment, null,
          h(Switch, {
            align: 'between',
            label: t('teamEnableLabel'),
            description: t('teamDesc'),
            'data-testid': 'team-default-switch',
            checked: enabled,
            disabled: saving,
            onChange: (event) => { setEnabled(event.target.checked); setSave(null); },
          }),
          h(StatusLine, { tone: persisted ? 'ok' : 'neutral', 'data-testid': 'team-default-status' }, persisted ? t('teamCurrentOn') : t('teamCurrentOff')),
          feedback,
          h(ActionGroup, { align: 'end' },
            h(Button, {
              variant: 'ghost',
              'data-testid': 'team-default-cancel',
              disabled: !dirty || saving,
              onClick: () => { setEnabled(persisted); setSave(null); },
            }, t('cancel')),
            h(Button, {
              variant: 'primary',
              'data-testid': 'team-default-save',
              busy: saving,
              disabled: !dirty,
              onClick: () => void saveDefault(),
            }, t('save'))))
      : h(StatusLine, { tone: 'warn', 'data-testid': 'team-default-unavailable' }, t('teamUnavailable')));
}

function NotesCard({ t, wire, view }) {
  const call = React.useMemo(() => makeCall(wire), [wire]);
  const writeCall = React.useMemo(() => makeWriteCall(wire), [wire]);
  const st = loadState();
  const [notes, setNotes] = React.useState(null);
  const [text, setText] = React.useState('');
  const [save, setSave] = React.useState(null);

  const load = React.useCallback(async () => {
    st.setPhase('loading');
    st.setIssue(null);
    try {
      const value = await call('environmentNotes');
      if (!st.alive.current) return;
      const initial = value && typeof value.text === 'string' ? value.text : '';
      setNotes(value);
      setText(initial);
      setSave(null);
      st.setPhase('ready');
    } catch (failure) {
      if (!st.alive.current) return;
      st.setIssue(REASON(failure));
      st.setPhase('failed');
    }
  }, [call]);

  React.useEffect(() => { void load(); }, [load]);

  const bytes = utf8Bytes(text);
  const overLimit = bytes > NOTES_MAX_BYTES;

  const saveNotes = async () => {
    if (overLimit) return;
    setSave({ state: 'saving' });
    try {
      const written = await writeCall('saveEnvironmentNotes', text);
      if (!st.alive.current) return;
      if (written && (written.code || written.available === false)) {
        setSave({ state: 'refused', code: written.code || 'ENVIRONMENT_NOTES_WRITE_FAILED' });
        return;
      }
      const nextText = written && typeof written.text === 'string' ? written.text : text;
      const nextBytes = written && typeof written.bytes === 'number' ? written.bytes : utf8Bytes(nextText);
      setNotes((current) => ({ ...(current || {}), available: true, code: null, text: nextText, bytes: nextBytes }));
      setText(nextText);
      setSave({ state: 'saved' });
      showToast({ kind: NS + '-notes', text: t('notesSavedToast'), tone: 'ok', closeLabel: t('closeToast') });
    } catch (failure) {
      if (st.alive.current) setSave({ state: 'refused', code: REASON(failure) });
    }
  };

  const available = st.phase === 'ready' && notes !== null && notes.available !== false;
  const summaryBytes = typeof notes?.text === 'string'
    ? utf8Bytes(notes.text)
    : (typeof notes?.bytes === 'number' ? notes.bytes : 0);
  const summaryText = available
    ? fill(t('notesSummaryUsed'), { bytes: summaryBytes, max: NOTES_MAX_BYTES })
    : t('notesSummary');

  if (st.phase === 'loading') return h(Shell, { view, summary: summaryText }, h(Loading, { t }));
  if (st.phase === 'failed') return h(Shell, { view, summary: summaryText }, h(LoadFailed, { t, issue: st.issue, onRetry: () => void load() }));

  const persistedText = notes && typeof notes.text === 'string' ? notes.text : '';
  const dirty = text !== persistedText;
  const saving = save !== null && save.state === 'saving';

  const feedback = save === null ? null
    : save.state === 'saved' ? h(StatusLine, { tone: 'ok', 'data-testid': 'notes-receipt' }, t('saved'))
    : save.state === 'refused' ? h(Banner, { tone: 'err', role: 'alert', 'data-testid': 'notes-save-failed' },
        h('p', null, save.code === 'ENVIRONMENT_NOTES_TOO_LARGE' ? fill(t('notesTooLarge'), { max: NOTES_MAX_BYTES }) : t('refused')),
        save.code ? h(DiagnosticDisclosure, { testId: 'notes-save-raw', title: t('rawDetails'), text: String(save.code) }) : null)
    : null;

  return h(Shell, { view, summary: summaryText },
    available
      ? h(React.Fragment, null,
          h('p', { className: 'omni-ui-hint' }, t('notesDesc')),
          h(NotesPad, {
            value: text,
            rows: 7,
            'aria-label': t('notesTitle'),
            'aria-invalid': overLimit ? 'true' : undefined,
            maxChars: NOTES_MAX_BYTES,
            usedChars: bytes,
            disabled: saving,
            status: h(Badge, { tone: 'muted' }, t('notesBadge')),
            'data-testid': 'environment-notes-pad',
            onChange: (event) => { setText(event.target.value); setSave(null); },
          }),
          overLimit ? h(StatusLine, { tone: 'err', role: 'alert', 'data-testid': 'environment-notes-overlimit' }, fill(t('notesTooLarge'), { max: NOTES_MAX_BYTES })) : null,
          feedback,
          h(ActionGroup, { align: 'end' },
            h(Button, {
              variant: 'ghost',
              'data-testid': 'environment-notes-cancel',
              disabled: !dirty || saving,
              onClick: () => { setText(persistedText); setSave(null); },
            }, t('cancel')),
            h(Button, {
              variant: 'primary',
              'data-testid': 'environment-notes-save',
              busy: saving,
              disabled: !dirty || overLimit,
              onClick: () => void saveNotes(),
            }, t('save'))))
      : h(React.Fragment, null,
          h(Banner, { tone: 'err', role: 'alert', 'data-testid': 'notes-unavailable' },
            h('p', null, t('notesUnavailable')),
            notes && notes.code ? h(DiagnosticDisclosure, { testId: 'notes-unavailable-raw', title: t('rawDetails'), text: String(notes.code) }) : null),
          h(ActionGroup, { align: 'start' },
            h(Button, { variant: 'default', 'data-testid': 'notes-retry', onClick: () => void load() }, t('reload')))));
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
      const a = registerSettingsPluginCard(inner, { id: NS + '-team', order: 30, label: () => t('teamTitle'), locale: NS, inject: () => ({ t, wire }) }, TeamModeCard);
      const b = registerSettingsPluginCard(inner, { id: NS + '-limit', order: 31, label: () => t('extremeTitle'), locale: NS, inject: () => ({ t, wire, limitForm }) }, ExtremeCard);
      const c = registerSettingsPluginCard(inner, { id: NS + '-notes', order: 32, label: () => t('notesTitle'), locale: NS, inject: () => ({ t, wire }) }, NotesCard);
      return () => { a(); b(); c(); };
    });
  }), 'omnisurge: three settings cards for team mode / extreme mode / notes (ADR-097, ADR-093 retired the members card)');
}
