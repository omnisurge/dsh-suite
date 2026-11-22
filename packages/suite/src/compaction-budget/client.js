import * as React from 'react';
import { ActionGroup, Button, Disclosure, Field, NumberInput, ConfigPage, injectStyles, registerSettingsPluginCard, showToast } from '@omnisurge/dsh-ui';
import { withTimeout } from '../remote-timeout.js';
import { assertRemoteEnvelope } from '../shared/client-remote.js';

const NS = 'omnisurge-compaction-budget';
const FIELDS = ['checkpointTokens', 'safetyTokens', 'timeoutMs'];
export const BUDGET_CARD_INJECT = ['slots', 'locale', 'configForms', 'settingsSchema'];
const h = React.createElement;
const en = {
  title: 'Summary compaction', summary: 'Defaults are usually sufficient. Use the switch on the official Plugins page to enable or disable.',
  description: 'Adjust summary parameters only; the model and output allowance are unchanged.',
  disabled: 'Disabled in advanced configuration. Saving parameters will not enable it.', advanced: 'Advanced settings (optional)',
  checkpointTokens: 'Summary size limit (estimated tokens)', checkpointTokensHint: 'Includes summary framing; not the model output allowance. Default: 2048.',
  safetyTokens: 'Capacity margin (estimated tokens)', safetyTokensHint: 'Extra input capacity reserved for a summary request. Default: 1024.',
  timeoutMs: 'Generation timeout (seconds)', timeoutMsHint: 'Default: 60 seconds (60000 milliseconds). Range: 0.001–300 seconds.',
  cancel: 'Cancel', save: 'Save', saved: 'Parameters saved.',
  checkpointTokensInvalid: 'Not saved: the summary size limit must be an integer from 160 to 32768. Correct it and try again.',
  safetyTokensInvalid: 'Not saved: the capacity margin must be an integer from 0 to 65536. Correct it and try again.',
  timeoutMsInvalid: 'Not saved: generation timeout must be 0.001–300 seconds, in whole milliseconds. Correct it and try again.',
  stale: 'Settings changed elsewhere; this edit was not saved. Reload before editing again.', reload: 'Reload',
  unavailable: 'Summary settings could not be read. Reopen plugin settings and try again.',
  refused: 'Parameters were not saved. Reopen plugin settings and try again.',
  unknown: 'The save result could not be confirmed. Reload and check the values.',
};
const zh = {
  title: '摘要压缩', summary: '一般保持默认即可；启停请用官方插件页开关。',
  description: '仅调整摘要参数，不修改模型或输出额度。', disabled: '已在高级配置中关闭；保存参数不会开启。', advanced: '高级设置（可选）',
  checkpointTokens: '摘要长度上限（估算 token）', checkpointTokensHint: '包含摘要外层说明；不是模型输出额度。默认 2048。',
  safetyTokens: '容量余量（估算 token）', safetyTokensHint: '为摘要请求额外预留输入空间。默认 1024。',
  timeoutMs: '生成超时（秒）', timeoutMsHint: '默认 60 秒（60000 毫秒）；范围 0.001–300 秒。',
  cancel: '取消', save: '保存', saved: '参数已保存。',
  checkpointTokensInvalid: '未保存：摘要长度上限须为 160–32768 的整数。请修改后重试。',
  safetyTokensInvalid: '未保存：容量余量须为 0–65536 的整数。请修改后重试。',
  timeoutMsInvalid: '未保存：生成超时须为 0.001–300 秒，精确到毫秒。请修改后重试。',
  stale: '设置已在别处修改，本次未保存。请重新载入后再修改。', reload: '重新载入',
  unavailable: '暂时读不到摘要设置。请重新打开插件设置后重试。', refused: '参数未保存。请重新打开插件设置后重试。',
  unknown: '暂时无法确认是否保存。请重新载入后检查数值。',
};

// Unit conversion only, not a second policy parser. Business ranges/defaults come from the Host schema.
export function decimalUnits(text, places) {
  if (typeof text !== 'string' || !/^\d+(?:\.\d+)?$/.test(text)) return undefined;
  const [whole, fraction = ''] = text.split('.');
  if (/[^0]/.test(fraction.slice(places))) return undefined;
  const value = BigInt(whole) * (10n ** BigInt(places)) + BigInt((fraction.slice(0, places).padEnd(places, '0')) || '0');
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}
export function millisecondsToSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  const digits = String(value).padStart(4, '0');
  const whole = digits.slice(0, -3), fraction = digits.slice(-3).replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}
const draftOf = value => Object.fromEntries(FIELDS.map(field => [field, field === 'timeoutMs' ? millisecondsToSeconds(value[field]) : String(value[field])]));
const sameDraft = (a, b) => FIELDS.every(field => a?.[field] === b?.[field]);

/** G1-testable domain editor; official ConfigForms remains the sole write queue and accepted-value owner. */
export function createBudgetEditor({ form, mirror, schema, refresh, notify }) {
  let disposed = false, lock = false, base = null, off = [], generation = 0;
  const pending = new Set();
  const bounded = promise => {
    const controller = new AbortController();
    pending.add(controller);
    return withTimeout(promise, 15000, { signal: controller.signal, code: 'SETTINGS_UNCONFIRMED', message: 'SETTINGS_UNCONFIRMED' })
      .finally(() => pending.delete(controller));
  };
  let state = { draft: null, ready: false, writable: false, busy: false, blocked: false, enabled: undefined, hints: {} };
  const listeners = new Set();
  const publish = patch => { if (disposed) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const describe = () => mirror.getSnapshot().view?.namespaces.find(row => row.ns === NS);
  function read() {
    try { return readAccepted(); } catch { return null; }
  }
  function readAccepted() {
    const live = form.getSnapshot(), descriptor = describe();
    if (live.status !== 'ready' || !descriptor || !Number.isSafeInteger(live.revision) || descriptor.revision !== live.revision) return null;
    const root = schema.rehydrate(descriptor.schema), value = { ...live.value }, hints = {};
    for (const field of FIELDS) {
      const node = schema.nodeAtPath(root, [field]);
      if (!node) return null;
      if (value[field] === undefined) value[field] = node.meta?.default;
      if (!Number.isSafeInteger(value[field]) || schema.validate(node, value[field]) !== undefined) return null;
      const unit = field === 'timeoutMs' ? 1000 : 1;
      hints[field] = { min: node.meta?.min === undefined ? undefined : node.meta.min / unit, max: node.meta?.max === undefined ? undefined : node.meta.max / unit, step: node.meta?.step === undefined ? undefined : node.meta.step / unit };
    }
    if (schema.validate(root, value) !== undefined) return null;
    return { value, revision: live.revision, root, hints, writable: live.writable === true };
  }
  function accept(next) {
    base = next;
    publish({ draft: draftOf(next.value), savedDraft: draftOf(next.value), ready: true, writable: next.writable, enabled: next.value.enabled, hints: next.hints, blocked: false });
  }
  function sync() {
    const next = read();
    if (!next) { publish({ ready: false, writable: false }); return; }
    const dirty = base && !sameDraft(state.draft, draftOf(base.value));
    if (!base || (!dirty && !lock && !state.blocked)) accept(next);
    else publish({ ready: true, writable: state.blocked ? state.writable && next.writable : next.writable, enabled: next.value.enabled });
  }
  const announce = (key, reload = false) => { if (!disposed) notify(key, reload ? () => { void editor.reload(); } : undefined); };
  const editor = {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start() { if (off.length) return; disposed = false; lock = false; state = { ...state, busy: false }; off = [form.subscribe(sync), mirror.subscribe(sync)]; sync(); },
    change(field, text) { if (!FIELDS.includes(field) || lock || !state.ready || !state.writable || state.blocked) return; publish({ draft: { ...state.draft, [field]: text } }); },
    cancel() { if (!lock && base) publish({ draft: draftOf(base.value) }); },
    async reload() {
      if (lock || disposed) return;
      lock = true; publish({ busy: true }); const current = ++generation;
      try {
        // Only an explicit Reload abandons the draft and requests a fresh official read.
        const result = await bounded(refresh());
        if (disposed || current !== generation) return;
        // A refused/invalid reply blocks stale writes; a thrown carrier error follows the outer catch.
        let view;
        try { view = assertRemoteEnvelope(result, 'describe'); } catch { view = null; }
        if (!Array.isArray(view?.namespaces)) { publish({ blocked: true }); announce('unavailable'); return; }
        // acceptView folds one namespace, not document permissions. Compare the current official cut;
        // neither a fresh reply nor local state may become a second writable authority (ADR-106).
        const documentWritable = mirror.getSnapshot().view?.writable;
        if (typeof view.writable !== 'boolean' || typeof documentWritable !== 'boolean' || view.writable !== documentWritable) {
          publish({ blocked: true }); announce('unavailable'); return;
        }
        if (!documentWritable) { publish({ blocked: true }); announce('refused'); return; }
        const row = view.namespaces.find(item => item.ns === NS);
        if (!row) { publish({ ready: false, writable: false }); announce('unavailable'); return; }
        const latest = form.getSnapshot();
        if (Number.isSafeInteger(latest.revision) && latest.revision > row.revision) { publish({ blocked: true }); announce('unavailable'); return; }
        mirror.acceptView(row);
        const next = read();
        if (!next) { publish({ ready: false, writable: false }); announce('unavailable'); return; }
        accept(next);
      } catch { if (!disposed && current === generation) announce('unavailable'); }
      finally { if (!disposed && current === generation) { lock = false; publish({ busy: false }); } }
    },
    async save() {
      if (disposed || lock || !base || !state.ready || !state.writable || state.blocked || sameDraft(state.draft, draftOf(base.value))) return;
      const currentView = form.getSnapshot();
      if (currentView.status !== 'ready' || currentView.writable !== true) { announce('refused'); return; }
      if (currentView.revision !== base.revision) { publish({ blocked: true }); announce('stale', true); return; }
      const next = { ...base.value }, ops = [];
      for (const field of FIELDS) {
        const value = decimalUnits(state.draft[field], field === 'timeoutMs' ? 3 : 0);
        const node = schema.nodeAtPath(base.root, [field]);
        if (value === undefined || !node || schema.validate(node, value) !== undefined) { announce(field + 'Invalid'); return; }
        next[field] = value;
        if (value !== base.value[field]) ops.push({ op: 'set', path: [field], value });
      }
      if (schema.validate(base.root, next) !== undefined) { announce('refused'); return; }
      if (!ops.length) { publish({ draft: draftOf(base.value) }); return; }
      lock = true; publish({ busy: true }); const current = ++generation;
      try {
        const accepted = await bounded(form.mutate(ops, base.revision));
        if (disposed || current !== generation) return;
        const after = read();
        if (accepted !== true) {
          publish({ blocked: true });
          announce(after && after.revision !== base.revision ? 'stale' : 'refused', true);
          return;
        }
        // A true acceptance is not enough: require the same official form's confirmed values.
        if (!after || after.revision <= base.revision || !FIELDS.every(field => after.value[field] === next[field]) || after.value.enabled !== base.value.enabled) {
          publish({ blocked: true }); announce('unknown', true); return;
        }
        accept(after); announce('saved');
      } catch { if (!disposed && current === generation) { publish({ blocked: true }); announce('unknown', true); } }
      finally { if (!disposed && current === generation) { lock = false; publish({ busy: false }); } }
    },
    dispose() { disposed = true; generation++; for (const controller of pending) controller.abort(); pending.clear(); for (const dispose of off) dispose(); off = []; listeners.clear(); },
  };
  return editor;
}

// The official detail renders summary and page together; dispatch before any editor hooks.
function BudgetEntry({ view, ...props }) {
  if (view === 'summary') return props.t('summary');
  if (view === 'page') return h(BudgetPage, props);
  return null;
}

function BudgetPage({ t, budgetForm: form, mirror, schema, refresh, owner }) {
  const toast = React.useRef(null);
  const editor = React.useMemo(() => createBudgetEditor({ form, mirror, schema, refresh, notify: (key, reload) => {
    toast.current?.close();
    toast.current = showToast({ kind: NS, text: t(key), tone: key === 'saved' ? 'neutral' : 'warn', showClose: false,
      ...(reload ? { action: { label: t('reload'), run: reload } } : {}) });
  } }), [form, mirror, schema, refresh, t]);
  React.useEffect(() => {
    if (!owner.active) return;
    const dispose = () => { editor.dispose(); toast.current?.close(); };
    owner.editors.add(dispose); editor.start();
    return () => { owner.editors.delete(dispose); dispose(); };
  }, [editor, owner]);
  const state = React.useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const disabled = !state.ready || !state.writable || state.busy || state.blocked;
  const dirty = state.draft && FIELDS.some(field => state.draft[field] !== state.savedDraft?.[field]);
  return h('div', { 'data-testid': 'compaction-budget-card' },
    h(ConfigPage, { available: state.ready, writable: state.writable,
    labels: { unavailable: t('unavailable'), readOnly: t('refused'), saveFailed: t('refused'), saving: t('save'), save: t('save') } },
    h('p', { className: 'omni-ui-hint', 'data-testid': 'compaction-budget-description' }, t('description')),
    h(Disclosure, { title: t('advanced'), defaultOpen: false },
      ...FIELDS.map(field => h(Field, { key: field, label: t(field), hint: t(field + 'Hint') }, h(NumberInput, {
        name: field, value: state.draft?.[field] ?? '', ...state.hints[field], disabled,
        'data-testid': 'compaction-budget-' + field, onChange: event => editor.change(field, event.target.value),
      }))),
      h(ActionGroup, null,
        h(Button, { disabled: state.busy || !state.draft, onClick: () => editor.cancel(), 'data-testid': 'compaction-budget-cancel' }, t('cancel')),
        h(Button, { variant: 'primary', busy: state.busy, disabled: disabled || !dirty, onClick: () => { void editor.save(); }, 'data-testid': 'compaction-budget-save' }, t('save'))))));
}

export function applyCompactionBudgetCard(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'summary settings locale');
  ctx.effect(() => { injectStyles(); }, 'summary settings controls');
  const owner = { active: true, editors: new Set() };
  const form = ctx.configForms.get(NS), mirror = ctx.configForms.describe(), schema = ctx.settingsSchema;
  let readRemote = null;
  // Namespace reads are scoped separately; losing connectivity must not remove the card.
  ctx.effect(() => {
    const scope = ctx.inject(['remote', 'remote.settings'], inner => {
      const handle = inner.remote.settings;
      readRemote = () => handle.describe();
      return () => { readRemote = null; };
    });
    return () => { readRemote = null; void scope.dispose(); };
  }, 'summary settings explicit reload');
  const refresh = () => { if (!readRemote) return Promise.reject(new Error('SETTINGS_UNAVAILABLE')); return readRemote(); };
  const t = ctx.locale.bind(NS);
  ctx.effect(() => () => { owner.active = false; for (const dispose of owner.editors) dispose(); owner.editors.clear(); }, 'summary settings editor lifetime');
  ctx.effect(() => registerSettingsPluginCard(ctx, { id: NS, order: 33, label: () => t('title'), locale: NS,
    inject: () => ({ t, budgetForm: form, mirror, schema, refresh, owner }) }, BudgetEntry), 'summary settings card');
}
