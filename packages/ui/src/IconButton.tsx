import type { ButtonHTMLAttributes } from "react";

export type IconButtonSize = "composer" | "rail";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly size?: IconButtonSize;
}

function sizeClass(size: IconButtonSize | undefined): string {
  return size === "rail" ? "omni-ui-railBtn" : "omni-ui-iconBtn";
}

/** Ghost square icon control for composer (28px) or sidebar rail (36px). */
export function IconButton(props: IconButtonProps) {
  const { size, className, type, children, ...rest } = props;
  const extra = className !== undefined && className !== "" ? ` ${className}` : "";
  return (
    <button type={type ?? "button"} className={sizeClass(size) + extra} {...rest}>
      {children}
    </button>
  );
}
