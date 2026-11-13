import type { ReactNode } from "react";

export interface PageHeadProps {
  readonly title: string;
  readonly description?: string;
  readonly titleId?: string;
  /** Optional product mark. Default empty — do not reserve space. */
  readonly mark?: ReactNode;
  /** Optional page-level actions. Default empty — keep save/refresh in card footers and toolbars. */
  readonly actions?: ReactNode;
}

/**
 * Owned `settings.section` chrome. Match the official 插件 page / existing product skin:
 * 18px semibold title + 13px tertiary description. Not for plugin tabs or plugin.item cards.
 */
export function PageHead(props: PageHeadProps) {
  const mark = props.mark ?? null;
  const actions = props.actions ?? null;
  const description = props.description !== undefined && props.description !== ""
    ? props.description
    : null;
  return (
    <header className="omni-ui-pageHead">
      <div className="omni-ui-pageHeadRow">
        <div className="omni-ui-pageHeadLead">
          {mark !== null ? <span className="omni-ui-pageMark">{mark}</span> : null}
          <h2 id={props.titleId} className="omni-ui-pageTitle">{props.title}</h2>
        </div>
        {actions !== null ? <div className="omni-ui-pageHeadActions">{actions}</div> : null}
      </div>
      {description !== null ? <p className="omni-ui-pageDesc">{description}</p> : null}
    </header>
  );
}
