import type { ReactNode } from "react";
import { TextArea, type TextAreaProps } from "./Field.js";

export interface NotesPadProps extends Omit<TextAreaProps, "variant"> {
  /** Left of the pad: live / empty badge or a short status phrase. */
  readonly status?: ReactNode;
  /** Override counted length; defaults to `value.length` when value is a string. */
  readonly usedChars?: number;
  readonly maxChars?: number;
}

function countTone(used: number, max: number | undefined): string {
  if (max === undefined) return "";
  if (used > max) return " omni-ui-notesCountOver";
  if (used >= Math.floor(max * 0.9)) return " omni-ui-notesCountWarn";
  return "";
}

/**
 * Long-form notes pad for settings (environment cheat sheet, free remarks).
 * Not a stack of labeled fields and not a code editor.
 */
export function NotesPad(props: NotesPadProps) {
  const { status, usedChars, maxChars, className, value, ...rest } = props;
  const used = usedChars ?? (typeof value === "string" ? value.length : 0);
  const count = maxChars === undefined ? String(used) : `${used} / ${maxChars}`;
  const showMeta = status !== undefined || maxChars !== undefined;
  return (
    <div className="omni-ui-notesPad">
      {showMeta ? (
        <div className="omni-ui-notesMeta">
          <span className="omni-ui-notesStatus">{status}</span>
          <span className={"omni-ui-notesCount" + countTone(used, maxChars)}>{count}</span>
        </div>
      ) : null}
      <TextArea variant="notes" className={className} value={value} {...rest} />
    </div>
  );
}
