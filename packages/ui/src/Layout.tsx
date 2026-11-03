import { Children, useEffect, useId, useState, type HTMLAttributes, type ReactNode, type DetailsHTMLAttributes } from "react";

export interface ActionGroupProps extends HTMLAttributes<HTMLDivElement> {
  danger?: ReactNode;
}

/** Separate destructive commands without giving ordinary text actions danger semantics. */
export function ActionGroup({ children, danger, className = "", ...rest }: ActionGroupProps) {
  return <div {...rest} className={`omni-ui-actionGroup ${className}`}>
    {Children.toArray(children).length > 0 && <div className="omni-ui-actionCluster">{children}</div>}
    {Children.toArray(danger).length > 0 && <div className="omni-ui-actionCluster">{danger}</div>}
  </div>;
}

export function FormGrid({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`omni-ui-formGrid ${className}`} />;
}

export interface ListRowProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  /** Background facts (transport, protocol, tool count): one grey line, never more badges (ADR-049). */
  meta?: ReactNode;
  actions?: ReactNode;
}

export function ListRow({ title, description, badge, meta, actions, children, className = "", ...rest }: ListRowProps) {
  // ADR-052 / gaps §5.2: a row that carries actions opts into the first-line baseline rule (`--actions`), because
  // that rule only makes sense where there is a right-hand control column to align the title with.
  return <li {...rest} className={`omni-ui-listRow ${actions != null ? "omni-ui-listRow--actions " : ""}${className}`}>
    <div className="omni-ui-listMain"><div className="omni-ui-badgeRow"><span className="omni-ui-listTitle">{title}</span>{badge}</div>
      {description != null && <span className="omni-ui-hint">{description}</span>}
      {meta != null && <span className="omni-ui-metaLine">{meta}</span>}{children}</div>
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
