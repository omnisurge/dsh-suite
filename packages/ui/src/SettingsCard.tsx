import { useState, type ReactNode } from "react";

export interface SettingsCardProps {
  readonly title: ReactNode;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  /** Shown in the collapsible header (e.g. connection badge). */
  readonly badge?: ReactNode;
  /** Match suite plugin cards: header toggles body. Default false. */
  readonly collapsible?: boolean;
  /** Only used when collapsible. Default true. */
  readonly defaultOpen?: boolean;
  /** Official `settings.plugin.item` list is a `<ul>`; use `li` there. */
  readonly as?: "section" | "li";
  /** Fires after the header toggles. Use to refresh catalogs on expand. */
  readonly onToggle?: (open: boolean) => void;
  /** Test hook: the official slot fixtures and the client gates locate a card by this attribute. */
  readonly "data-testid"?: string;
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

/** Settings block — optional fold, host tokens. */
export function SettingsCard(props: SettingsCardProps) {
  const collapsible = props.collapsible === true;
  const [open, setOpen] = useState(props.defaultOpen !== false);
  const shown = !collapsible || open;
  const Root = props.as === "li" ? "li" : "section";
  const testId = props["data-testid"];

  if (!collapsible) {
    return (
      <Root className="omni-ui-card omni-ui-cardStatic" data-testid={testId}>
        <h3 className="omni-ui-cardTitle">{props.title}</h3>
        {props.description !== undefined && props.description !== "" ? (
          <p className="omni-ui-cardDesc">{props.description}</p>
        ) : null}
        {props.children !== undefined ? <div className="omni-ui-cardBody">{props.children}</div> : null}
        {props.footer !== undefined ? <div className="omni-ui-cardFooter">{props.footer}</div> : null}
      </Root>
    );
  }

  return (
    <Root className={shown ? "omni-ui-card omni-ui-cardOpen" : "omni-ui-card"} data-testid={testId}>
      <button
        type="button"
        className="omni-ui-cardHeader"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          props.onToggle?.(next);
        }}
      >
        <span className="omni-ui-cardHeadText">
          <span className="omni-ui-cardTitle">{props.title}</span>
          <span className="omni-ui-cardDesc">
            {props.description !== undefined && props.description !== "" ? props.description : "\u00a0"}
          </span>
        </span>
        {props.badge !== undefined ? <span className="omni-ui-cardBadge">{props.badge}</span> : null}
        <Chevron open={open} />
      </button>
      {shown ? (
        <>
          {props.children !== undefined ? <div className="omni-ui-cardBody">{props.children}</div> : null}
          {props.footer !== undefined ? <div className="omni-ui-cardFooter">{props.footer}</div> : null}
        </>
      ) : null}
    </Root>
  );
}
