import type { SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** `field` fills a settings row; `inline` is a tool-row chip (composer). */
  variant?: "field" | "inline";
};

/** Native select with the existing product control chrome (height/radius/chevron). */
export function Select(props: SelectProps) {
  const { className, children, variant = "field", ...rest } = props;
  const extra = className !== undefined && className !== "" ? ` ${className}` : "";
  const kind = variant === "inline" ? " omni-ui-selectInline" : "";
  return (
    <select className={"omni-ui-select" + kind + extra} {...rest}>
      {children}
    </select>
  );
}
