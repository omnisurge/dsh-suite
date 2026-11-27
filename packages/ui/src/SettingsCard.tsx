import { useId, useState, type ReactNode } from "react";
import { Card } from "./Card.js";
import { Skeleton } from "./Progress.js";

export interface SettingsCardProps {
  readonly title: ReactNode;
  readonly description?: string;
  /** Header right-side receipt metadata (e.g. "最近检查 23:04"). */
  readonly meta?: ReactNode;
  /** Header right-side actions (e.g. ActionGroup). */
  readonly headerActions?: ReactNode;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  /** Shown in the header (e.g. connection badge). */
  readonly badge?: ReactNode;
  /** Match suite plugin cards: header toggles body. Default false. */
  readonly collapsible?: boolean;
  /** Only used when collapsible. Default true. */
  readonly defaultOpen?: boolean;
  /** Controlled open state when collapsible. */
  readonly open?: boolean;
  /** Official `settings.plugin.item` list is a `<ul>`; use `li` there. */
  readonly as?: "section" | "li";
  /** Show skeleton placeholder while body content is loading. */
  readonly loading?: boolean;
  /** Fires after the header toggles. Use to refresh catalogs on expand. */
  readonly onToggle?: (open: boolean) => void;
  /** Test hook: the official slot fixtures and the client gates locate a card by this attribute. */
  readonly "data-testid"?: string;
  /** Optional test hook placed on the collapsible toggle button itself. */
  readonly toggleTestId?: string;
}

function Chevron(props: { open: boolean }) {
  return (
    <svg
      className={props.open ? "omni-ui-chevron omni-ui-chevronOpen" : "omni-ui-chevron"}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <path
        d="M3.5 5.25 7 8.75l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Settings block — optional fold, built on Card structure & host tokens. */
export function SettingsCard(props: SettingsCardProps) {
  const collapsible = props.collapsible === true;
  const [open, setOpen] = useState(props.defaultOpen !== false);
  const bodyId = useId();
  const isOpen = props.open ?? open;
  const shown = !collapsible || isOpen;
  const loading = props.loading === true;
  const Root = props.as === "li" ? "li" : "section";
  const testId = props["data-testid"];
  const hasDesc = props.description !== undefined && props.description !== "";
  const hasMeta = props.meta !== undefined && props.meta !== null && props.meta !== "";
  const hasBadge = props.badge !== undefined && props.badge !== null && props.badge !== false;
  const hasActions = props.headerActions !== undefined && props.headerActions !== null && props.headerActions !== false;

  if (!collapsible) {
    // When new Card header slots are passed, compose directly via Card while preserving static card class.
    if (hasMeta || hasBadge || hasActions) {
      return (
        <Card
          as={props.as}
          className="omni-ui-cardStatic"
          title={props.title}
          description={props.description}
          meta={props.meta}
          badge={props.badge}
          headerActions={props.headerActions}
          loading={props.loading}
          footer={props.footer}
          data-testid={testId}
        >
          {props.children}
        </Card>
      );
    }
    const hasBody = loading || props.children !== undefined;
    return (
      <Root
        className="omni-ui-card omni-ui-cardStatic"
        data-loading={loading ? "true" : undefined}
        data-testid={testId}
      >
        <h3 className="omni-ui-cardTitle">{props.title}</h3>
        {hasDesc ? <p className="omni-ui-cardDesc">{props.description}</p> : null}
        {hasBody ? (
          <div className="omni-ui-cardBody" aria-busy={loading ? "true" : undefined}>
            {loading ? <Skeleton lines={3} /> : props.children}
          </div>
        ) : null}
        {props.footer !== undefined ? <div className="omni-ui-cardFooter">{props.footer}</div> : null}
      </Root>
    );
  }

  const hasBody = loading || props.children !== undefined;
  const hasFooter = props.footer !== undefined;
  const headerButton = (
    <button
      type="button"
      className="omni-ui-cardHeader"
      data-testid={props.toggleTestId}
      aria-expanded={isOpen}
      aria-controls={hasBody || hasFooter ? bodyId : undefined}
      onClick={() => {
        const next = !isOpen;
        if (props.open === undefined) {
          setOpen(next);
        }
        props.onToggle?.(next);
      }}
    >
      <span className="omni-ui-cardHeadText">
        <span className="omni-ui-cardTitle">{props.title}</span>
        <span className="omni-ui-cardDesc">{hasDesc ? props.description : "\u00a0"}</span>
      </span>
      {hasMeta ? <span className="omni-ui-cardMeta">{props.meta}</span> : null}
      {hasBadge ? <span className="omni-ui-cardBadge">{props.badge}</span> : null}
      <Chevron open={isOpen} />
    </button>
  );

  return (
    <Root
      className={shown ? "omni-ui-card omni-ui-cardCollapsible omni-ui-cardOpen" : "omni-ui-card omni-ui-cardCollapsible"}
      data-loading={loading ? "true" : undefined}
      data-testid={testId}
    >
      {hasActions ? (
        <div className="omni-ui-cardCollapsibleRow">
          {headerButton}
          <div className="omni-ui-cardHeadActions">{props.headerActions}</div>
        </div>
      ) : (
        headerButton
      )}
      {shown ? (
        <>
          {hasBody ? (
            <div id={bodyId} className="omni-ui-cardBody" aria-busy={loading ? "true" : undefined}>
              {loading ? <Skeleton lines={3} /> : props.children}
            </div>
          ) : null}
          {hasFooter ? (
            <div id={!hasBody ? bodyId : undefined} className="omni-ui-cardFooter">
              {props.footer}
            </div>
          ) : null}
        </>
      ) : null}
    </Root>
  );
}
