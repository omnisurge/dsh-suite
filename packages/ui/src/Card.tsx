import type { ReactNode } from "react";
import { Skeleton } from "./Progress.js";

export type CardVariant = "default" | "subtle" | "elevated" | "interactive";
export type CardTone = "neutral" | "ok" | "warn" | "err";

export interface CardProps {
  readonly as?: "section" | "div" | "li" | "article";
  readonly variant?: CardVariant;
  readonly tone?: CardTone;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  /** Header right-side receipt metadata (e.g. "最近检查 23:04"), aligned to title baseline (ADR-048). */
  readonly meta?: ReactNode;
  readonly badge?: ReactNode;
  /** Header right-side actions (recommended: ActionGroup). */
  readonly headerActions?: ReactNode;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly selected?: boolean;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly "data-testid"?: string;
}

function hasRenderable(value: ReactNode | undefined): boolean {
  return value !== undefined && value !== null && value !== false && value !== "";
}

/** Foundational container card primitive (ADR-121 / ADR-048 / ADR-050). */
export function Card(props: CardProps) {
  const Root = props.as ?? "section";
  const variant = props.variant ?? "default";
  const tone = props.tone ?? "neutral";
  const loading = props.loading === true;
  const disabled = props.disabled === true;
  const selected = props.selected === true;

  const hasTitle = hasRenderable(props.title);
  const hasDesc = hasRenderable(props.description);
  const hasBadge = hasRenderable(props.badge);
  const hasMeta = hasRenderable(props.meta);
  const hasActions = hasRenderable(props.headerActions);
  const hasHeader = hasTitle || hasDesc || hasBadge || hasMeta || hasActions;
  const hasBody = loading || (props.children !== undefined && props.children !== null && props.children !== false);
  const hasFooter = props.footer !== undefined && props.footer !== null && props.footer !== false;

  const classes = ["omni-ui-card", `omni-ui-card--${variant}`];
  if (tone !== "neutral") classes.push(`omni-ui-card--tone-${tone}`);
  if (!hasHeader) classes.push("omni-ui-card--noHeader");
  if (props.className !== undefined && props.className !== "") classes.push(props.className);

  return (
    <Root
      className={classes.join(" ")}
      data-selected={selected ? "true" : undefined}
      data-loading={loading ? "true" : undefined}
      aria-disabled={disabled ? "true" : undefined}
      data-testid={props["data-testid"]}
    >
      {hasHeader ? (
        <div className="omni-ui-cardTop">
          {hasTitle || hasBadge || hasDesc ? (
            <div className="omni-ui-cardHeadText">
              {hasTitle || hasBadge ? (
                <div className="omni-ui-cardTitleRow">
                  {hasTitle ? <h3 className="omni-ui-cardTitle">{props.title}</h3> : null}
                  {hasBadge ? props.badge : null}
                </div>
              ) : null}
              {hasDesc ? <p className="omni-ui-cardDesc">{props.description}</p> : null}
            </div>
          ) : null}
          {hasMeta ? <span className="omni-ui-cardMeta">{props.meta}</span> : null}
          {hasActions ? <div className="omni-ui-cardHeadActions">{props.headerActions}</div> : null}
        </div>
      ) : null}
      {hasBody ? (
        <div className="omni-ui-cardBody" aria-busy={loading ? "true" : undefined}>
          {loading ? <Skeleton lines={3} /> : props.children}
        </div>
      ) : null}
      {hasFooter ? <div className="omni-ui-cardFooter">{props.footer}</div> : null}
    </Root>
  );
}
