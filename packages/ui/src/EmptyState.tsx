import type { ReactNode } from "react";

export type EmptyStateSurface = "card" | "inline";
export type EmptyStateAlign = "start" | "center";
export type EmptyStateTone = "neutral" | "error";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly surface?: EmptyStateSurface;
  readonly align?: EmptyStateAlign;
  readonly tone?: EmptyStateTone;
  readonly className?: string;
  readonly "data-testid"?: string;
}

/** Empty block — lives in the lib so plugins do not draw a second one. */
export function EmptyState(props: EmptyStateProps) {
  const surface = props.surface ?? "card";
  const align = props.align ?? (surface === "inline" ? "start" : "center");
  const tone = props.tone ?? "neutral";
  const classes = [
    "omni-ui-empty",
    `omni-ui-empty--${surface}`,
    `omni-ui-empty--align-${align}`,
  ];
  if (tone === "error") classes.push("omni-ui-empty--tone-error");
  if (props.className !== undefined && props.className !== "") classes.push(props.className);
  return (
    <div
      className={classes.join(" ")}
      role={tone === "error" ? "alert" : undefined}
      data-testid={props["data-testid"]}
    >
      <p className="omni-ui-emptyTitle">{props.title}</p>
      {props.description !== undefined && props.description !== "" ? (
        <p className="omni-ui-emptyDesc">{props.description}</p>
      ) : null}
      {props.action !== undefined ? <div className="omni-ui-actions">{props.action}</div> : null}
    </div>
  );
}
