import { useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export interface FieldProps {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string;
  /** Marks the control as required: a marker on the label plus aria-required on the control. */
  readonly required?: boolean;
  readonly error?: string;
  /** Extra control on the label row (manual/catalog toggle, clear, …). */
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}

/** Label + control + hint. Pass children, or use TextInput / TextArea beside it. */
export function Field(props: FieldProps) {
  const generated = useId();
  const labelId = `${generated}-label`;
  const messageId = `${generated}-message`;
  const field = useRef<HTMLDivElement>(null);
  const hasError = props.error !== undefined && props.error !== "";
  const hasMessage = hasError || (props.hint !== undefined && props.hint !== "");
  // Associate composite children too; their controls may appear after an async load.
  useLayoutEffect(() => {
    const root = field.current;
    if (!root) return;
    const owned: (() => void)[] = [];
    const connect = () => {
      while (owned.length) owned.pop()!();
      const controls = [...root.querySelectorAll<HTMLElement>("input:not([type=hidden]),textarea,select")]
        .filter((control) => control.closest(".omni-ui-field") === root);
      const set = (el: HTMLElement, name: string, value: string) => {
        const before = el.getAttribute(name);
        el.setAttribute(name, value);
        owned.push(() => { if (el.getAttribute(name) === value) { if (before === null) el.removeAttribute(name); else el.setAttribute(name, before); } });
      };
      controls.forEach((control, i) => {
        if (!control.id) set(control, "id", controls.length === 1 && props.id ? props.id : `${generated}-control-${i}`);
        if (!control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) set(control, "aria-labelledby", labelId);
        if (props.required === true && !control.hasAttribute("aria-required")) set(control, "aria-required", "true");
        if (hasMessage) set(control, "aria-describedby", [control.getAttribute("aria-describedby"), messageId].filter(Boolean).join(" "));
        if (hasError && !control.hasAttribute("aria-invalid")) set(control, "aria-invalid", "true");
      });
      const label = root.querySelector<HTMLLabelElement>(`label[data-field-label]`);
      if (label && controls[0]) set(label, "for", controls[0].id);
    };
    connect();
    // 观察器只是"异步挂进来的控件也要被关联"的补强，不是正确性前提：没有它时首次 connect()
    // 仍然完成关联。非浏览器环境（jsdom 夹具、SSR 预渲染）没有裸的 MutationObserver 全局，
    // 不守卫会让整张卡的渲染直接抛错、连带 Host 条目激活失败。
    const observer = typeof MutationObserver === "function" ? new MutationObserver(connect) : null;
    observer?.observe(root, { childList: true, subtree: true });
    return () => { observer?.disconnect(); while (owned.length) owned.pop()!(); };
  }, [props.id, generated, labelId, messageId, hasMessage, hasError, props.required]);
  const label = <label id={labelId} data-field-label className="omni-ui-label" htmlFor={props.id}>{props.label}{props.required === true ? <span className="omni-ui-req" aria-hidden="true">*</span> : null}</label>;
  return (
    <div className="omni-ui-field" ref={field}>
      {props.action !== undefined
        ? <div className="omni-ui-fieldHead">{label}<span className="omni-ui-badgeRow">{props.action}</span></div>
        : label}
      {props.children}
      {props.error !== undefined && props.error !== "" ? (
        <p id={messageId} className="omni-ui-hint omni-ui-hintError" role="alert">{props.error}</p>
      ) : props.hint !== undefined && props.hint !== "" ? (
        <p id={messageId} className="omni-ui-hint">{props.hint}</p>
      ) : null}
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

/** Single-line field control. */
export function TextInput(props: TextInputProps) {
  const { className, ...rest } = props;
  const extra = className !== undefined && className !== "" ? ` ${className}` : "";
  return <input className={"omni-ui-input" + extra} {...rest} />;
}

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** `notes` = long pad (environment notes). Default is a form field. */
  readonly variant?: "field" | "notes";
};

/** Multi-line field control. Use `variant="notes"` for a long notes pad. */
export function TextArea(props: TextAreaProps) {
  const { className, variant = "field", ...rest } = props;
  const notes = variant === "notes" ? " omni-ui-textareaNotes" : "";
  const extra = className !== undefined && className !== "" ? ` ${className}` : "";
  return <textarea className={"omni-ui-textarea" + notes + extra} {...rest} />;
}
