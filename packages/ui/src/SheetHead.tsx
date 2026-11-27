import type { ReactNode } from "react";

/** Title row with a tertiary dismiss on the right (「以后再说」). */

export interface SheetHeadProps {
  readonly title: string;
  readonly titleId?: string;
  readonly dismissLabel: string;
  readonly onDismiss: () => void;
  readonly dismissDisabled?: boolean;
  readonly badge?: ReactNode;
  readonly "data-testid"?: string;
}

/** Title left, dismiss right. Not for confirm-dialog 取消 — that stays in the footer. */
export function SheetHead(props: SheetHeadProps) {
  return (
    <div className="omni-ui-sheetHead" data-testid={props["data-testid"]}>
      <div className="omni-ui-sheetTitleRow">
        <h2 id={props.titleId} className="omni-ui-confirmTitle">{props.title}</h2>
        {props.badge}
      </div>
      <button
        type="button"
        className="omni-ui-dismiss"
        disabled={props.dismissDisabled}
        onClick={props.onDismiss}
      >
        {props.dismissLabel}
      </button>
    </div>
  );
}
