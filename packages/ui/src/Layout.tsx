import { Children, useEffect, useId, useState, type HTMLAttributes, type ReactNode, type DetailsHTMLAttributes } from "react";
import { Skeleton } from "./Progress.js";

export type ActionGroupAlign = "end" | "start" | "between";

export interface ActionGroupProps extends HTMLAttributes<HTMLDivElement> {
  danger?: ReactNode;
  readonly align?: ActionGroupAlign;
  readonly stackOnMobile?: boolean;
}

/** Separate destructive commands without giving ordinary text actions danger semantics. */
export function ActionGroup({
  children,
  danger,
  align = "end",
  stackOnMobile = false,
  className = "",
  ...rest
}: ActionGroupProps) {
  const classes = ["omni-ui-actionGroup"];
  if (align !== "end") classes.push(`omni-ui-actionGroup--align-${align}`);
  if (stackOnMobile) classes.push("omni-ui-actionGroup--stackMobile");
  if (className !== "") classes.push(className);
  return <div {...rest} className={classes.join(" ")}>
    {Children.toArray(children).length > 0 && <div className="omni-ui-actionCluster">{children}</div>}
    {Children.toArray(danger).length > 0 && <div className="omni-ui-actionCluster">{danger}</div>}
  </div>;
}

export interface FormGridProps extends HTMLAttributes<HTMLDivElement> {
  readonly columns?: "auto" | "2";
}

export function FormGrid({ columns = "auto", className = "", ...props }: FormGridProps) {
  const classes = ["omni-ui-formGrid"];
  if (columns === "2") classes.push("omni-ui-formGrid--2");
  if (className !== "") classes.push(className);
  return <div {...props} className={classes.join(" ")} />;
}

export interface ListRowProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  /** Background facts (transport, protocol, tool count): one grey line, never more badges (ADR-049). */
  meta?: ReactNode;
  actions?: ReactNode;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly selected?: boolean;
}

export function ListRow({
  title,
  description,
  badge,
  meta,
  actions,
  loading = false,
  disabled = false,
  selected = false,
  children,
  className = "",
  ...rest
}: ListRowProps) {
  // ADR-052 / gaps §5.2: a row that carries actions opts into the first-line baseline rule (`--actions`), because
  // that rule only makes sense where there is a right-hand control column to align the title with.
  const classes = ["omni-ui-listRow"];
  if (actions != null) classes.push("omni-ui-listRow--actions");
  if (className !== "") classes.push(className);
  return <li
    {...rest}
    className={classes.join(" ")}
    aria-busy={loading ? "true" : rest["aria-busy"]}
    aria-disabled={disabled ? "true" : rest["aria-disabled"]}
    data-loading={loading ? "true" : undefined}
    data-selected={selected ? "true" : undefined}
  >
    <div className="omni-ui-listMain">
      {loading ? (
        <Skeleton lines={2} />
      ) : (
        <>
          <div className="omni-ui-badgeRow"><span className="omni-ui-listTitle">{title}</span>{badge}</div>
          {description != null && <span className="omni-ui-hint">{description}</span>}
          {meta != null && <span className="omni-ui-metaLine">{meta}</span>}
          {children}
        </>
      )}
    </div>
    {actions != null && <div className="omni-ui-listActions">{actions}</div>}
  </li>;
}

export interface DisclosureProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> {
  title: ReactNode;
  /** Open once on mount (a failure the user has to see) without taking the control away. */
  defaultOpen?: boolean;
}

export function Disclosure({ title, children, className = "", defaultOpen = false, ...rest }: DisclosureProps) {
  const id = useId();
  // `open` on <details> is a controlled attribute: passing it on every render would fight the user own
  // toggling, so a one-shot default keeps a failure visible on mount and leaves the control to the user.
  const [open, setOpen] = useState(defaultOpen);
  // The failure that mounts the disclosure earlier can arrive after it: open when asked, once.
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  return <details {...rest} open={open} onToggle={event => setOpen(event.currentTarget.open)} className={`omni-ui-disclosure ${className}`}>
    <summary aria-controls={id}>{title}</summary><div id={id} className="omni-ui-stack">{children}</div>
  </details>;
}
