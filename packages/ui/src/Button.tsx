import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost" | "danger-ghost" | "link";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
  readonly busy?: boolean;
}

function variantClass(variant: ButtonVariant | undefined): string {
  if (variant === "primary") return "omni-ui-btn omni-ui-btnPrimary";
  if (variant === "danger") return "omni-ui-btn omni-ui-btnDanger";
  if (variant === "ghost") return "omni-ui-btn omni-ui-btnGhost";
  if (variant === "danger-ghost") return "omni-ui-btn omni-ui-btnGhost omni-ui-btnDangerGhost";
  if (variant === "link") return "omni-ui-btn omni-ui-btnLink";
  return "omni-ui-btn";
}

/** Host-token button. */
export function Button(props: ButtonProps) {
  const { variant, className, type, children, busy = false, disabled, ...rest } = props;
  const extra = className !== undefined && className !== "" ? ` ${className}` : "";
  return (
    <button {...rest} type={type ?? "button"} disabled={disabled || busy} aria-busy={busy || undefined} className={variantClass(variant) + extra}>
      {children}
    </button>
  );
}
