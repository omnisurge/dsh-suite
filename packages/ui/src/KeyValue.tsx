import { useState, type HTMLAttributes, type ReactNode } from "react";
import { Button } from "./Button.js";

/**
 * Read-only technical rows (label | value | action) on the library's existing `omni-ui-kvRow` grid.
 *
 * This is the developer-facing counterpart of `Field`: the same alignment, no input. Two rules it enforces
 * instead of leaving them to each consumer:
 *
 * - **An empty row is not rendered.** A missing value produced a wall of `—` placeholders on the Suite page,
 *   which reads as a broken control rather than as missing information, so the row is dropped instead.
 * - **A long identity is shortened, never dumped.** `short` renders a middle-ellipsised value while the copy
 *   action takes the full string, so a 64-hex revision is usable without being unreadable.
 */
export interface KeyValueItem {
  /** Row label; the caller owns the wording (this library carries no locale). */
  readonly label: string;
  /** Missing/empty values drop the whole row. */
  readonly value?: ReactNode;
  /** Aligned technical text (revisions, ids, paths, versions). */
  readonly mono?: boolean;
  /**
   * Show only the head of the value. Opt in per row: a *path* is not an identity, and truncating it makes
   * the row useless, so shortening is never inferred from the font.
   */
  readonly shorten?: boolean;
  /** Shown under the value; use for the one short explanation a row may need. */
  readonly hint?: ReactNode;
  /** Exact text the copy action writes. Defaults to the rendered value when it is a string. */
  readonly copy?: string;
  readonly copyLabel?: string;
  readonly copiedLabel?: string;
  readonly action?: ReactNode;
  readonly "data-testid"?: string;
  readonly "data-value-testid"?: string;
}

export interface KeyValueListProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  readonly items: readonly KeyValueItem[];
  /** Rendered in place of the list when every row is empty; omit to render nothing at all. */
  readonly empty?: ReactNode;
}

/** `abcdef123456…` — enough to compare by eye, never the whole identity. */
export function shortenIdentity(value: string, keep = 12): string {
  return value.length <= keep + 3 ? value : value.slice(0, keep) + "\u2026";
}

export function KeyValueList({ items, empty = null, className = "", ...rest }: KeyValueListProps) {
  const shown = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  if (shown.length === 0) return empty === null ? null : <p className="omni-ui-hint">{empty}</p>;
  return (
    <ul {...rest} className={`omni-ui-kvList ${className}`.trim()}>
      {shown.map((item, position) => (
        <KeyValueRow key={`${item.label}-${String(position)}`} item={item} />
      ))}
    </ul>
  );
}

function KeyValueRow({ item }: { item: KeyValueItem }) {
  const [copied, setCopied] = useState(false);
  const text = typeof item.copy === "string" ? item.copy : typeof item.value === "string" ? item.value : null;
  const copy = text !== null && item.copyLabel !== undefined;
  const write = async (value: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(value);
      return;
    }
    // Embedded webviews without the async clipboard: a temporary selection is the only path left. It must
    // still report failure -- a dead copy action that claims success is worse than an absent one.
    const holder = document.createElement("textarea");
    holder.value = value;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.appendChild(holder);
    holder.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(holder);
    if (!ok) throw new Error("COPY_UNSUPPORTED");
  };
  const run = () => {
    // A failed write must not claim success: the label only flips once the copy answered.
    if (text === null) return;
    void write(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => undefined);
  };
  const shorten = item.shorten === true && typeof item.value === "string";
  const value = shorten ? shortenIdentity(item.value as string) : item.value;
  return (
    <li className="omni-ui-kvRow" data-testid={item["data-testid"]}>
      <span className="omni-ui-label">{item.label}</span>
      <span className={item.mono === true ? "omni-ui-kvValue omni-ui-mono" : "omni-ui-kvValue"} data-testid={item["data-value-testid"]} title={shorten ? String(item.value) : undefined}>
        {value}
        {item.hint !== undefined ? <span className="omni-ui-kvHint">{item.hint}</span> : null}
      </span>
      <span className="omni-ui-kvAction">
        {copy ? (
          <Button variant="ghost" data-testid={item["data-value-testid"] !== undefined ? item["data-value-testid"] + "-copy" : undefined} onClick={run}>
            {copied ? item.copiedLabel : item.copyLabel}
          </Button>
        ) : (
          item.action
        )}
      </span>
    </li>
  );
}
