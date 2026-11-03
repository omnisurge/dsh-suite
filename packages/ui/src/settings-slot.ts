/**
 * 设置页插件卡的槽位注册。
 *
 * 槽位名 `plugins.item` —— dsh **0.1.6-alpha.2** 起用这个名字（0.1.5 及更早叫
 * `settings.plugin.item`）。**元字段同时也变了**，这是 2026-09-18 踩到的第二个坑：
 *
 *   0.1.5：宿主渲染用 `entryKey`（= 设置命名空间），注册传 `{ name, key, locale, inject }`
 *   0.1.6：宿主渲染读 **`id` 与 `label`**，官方四张卡一律传
 *          `{ name, id, order, label: () => t("..."), locale, inject }`
 *
 * 只改槽位名、不改元字段的后果：**设置页里插件配置卡整片消失**
 * （`entryKey` 在 0.1.6 渲染侧出现 0 次，`label` 出现 9 次）。
 * 当时 verify-local-shell 只问「内核认不认识这个槽位名字面量」，问不出字段对不对——
 * 那条检查后来补上了（现在会查 label）。
 *
 * **为什么单走一条路、不做双名兼容**：本仓是一壳一内核（ADR-051），内核随壳分发。
 */
export const SETTINGS_PLUGIN_CARD_SLOT = "plugins.item";

export interface SettingsPluginCardSpec {
  /** 卡片身份。沿用原 `key` 的值（设置命名空间），它唯一且稳定。 */
  id: string;
  /** 列表内排序，照官方用 10 / 20 / 30 … 留间隔。 */
  order?: number;
  /**
   * 列表里显示的卡片名。**0.1.6 必需**，缺了卡片不渲染。
   *
   * 之所以是函数不是字符串：宿主渲染晚于词典注册，取值要晚绑定。
   * 调用点用 `ctx.locale.bind(LOCALE_NS)` 造（helper 拿不到 ctx.locale）。
   */
  label: () => string;
  /** 词典命名空间（可选）。 */
  locale?: string;
  /**
   * 提供卡片 props 的注入函数。
   *
   * 返回类型是 `unknown` 而非 `Record<string, unknown>`：各个插件的 `controller.inject()`
   * 返回的是**自己的** CardFace 接口（EmailCardFace / SearxngCardFace …），带具名属性的接口
   * 不能赋给带索引签名的 Record。放宽到 unknown 与 dsh 槽位本身的松散契约一致。
   */
  inject: () => unknown;
}

export interface SettingsPluginSlotsLike {
  inject(name: string, factory: () => unknown): () => void;
  register(meta: Record<string, unknown>, component: unknown): unknown;
}

/** 把一张设置卡注册进设置页插件槽；返回官方 disposer，供 whileServed 绑定命名空间生命周期。 */
export function registerSettingsPluginCard(
  ctx: { slots: SettingsPluginSlotsLike },
  spec: SettingsPluginCardSpec,
  component: unknown,
): () => void {
  return ctx.slots.inject(SETTINGS_PLUGIN_CARD_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_PLUGIN_CARD_SLOT,
        id: spec.id,
        ...(spec.order === undefined ? {} : { order: spec.order }),
        label: spec.label,
        ...(spec.locale === undefined ? {} : { locale: spec.locale }),
        inject: spec.inject,
      },
      component,
    ));
}
