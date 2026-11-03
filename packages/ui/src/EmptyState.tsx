import type { ReactNode } from "react";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

/** Empty block — lives in the lib so plugins do not draw a second one. */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div className="omni-ui-empty">
      <p className="omni-ui-emptyTitle">{props.title}</p>
      {props.description !== undefined && props.description !== "" ? (
        <p className="omni-ui-emptyDesc">{props.description}</p>
      ) : null}
      {props.action !== undefined ? <div className="omni-ui-actions">{props.action}</div> : null}
    </div>
  );
}
