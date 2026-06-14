import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  label: string;
  tooltip: string;
  icon: ReactNode;
  variant?: Extract<ButtonVariant, "ghost" | "secondary" | "danger">;
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?:
    | "neutral"
    | "accent"
    | "success"
    | "warning"
    | "danger"
    | "info"
    | "uncertain"
    | "usage-unused"
    | "usage-voice"
    | "usage-signal"
    | "usage-generation"
    | "usage-excluded";
  children: ReactNode;
};

export type TooltipProps = {
  label: string;
  children: ReactNode;
};

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant: "warning" | "danger";
  title: string;
  children: ReactNode;
  recovery?: ReactNode;
};

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  children: ReactNode;
  action?: ReactNode;
};

export type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  width: number;
  height: number;
};

export type PageHeaderProps = HTMLAttributes<HTMLElement> & {
  title: string;
  description?: string;
  backAction?: ReactNode;
  actions?: ReactNode;
};

export type ScoreBarProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: number;
  max?: number;
  bandLabel?: string;
  helpText?: string;
  loading?: boolean;
  disabled?: boolean;
};

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id: string;
  label: string;
  helperText?: string;
  error?: string;
  loading?: boolean;
};

export type DrawerProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

export type KeyValueListProps = HTMLAttributes<HTMLDListElement> & {
  items: Array<{
    label: string;
    value: ReactNode;
  }>;
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
};

export type SwitchProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Spinner(): ReactElement {
  return <span aria-hidden="true" className="xb-spinner" />;
}

export function Button({
  children,
  className,
  disabled,
  leadingIcon,
  loading = false,
  size = "md",
  trailingIcon,
  type = "button",
  variant = "secondary",
  ...buttonProps
}: ButtonProps): ReactElement {
  const ariaBusy = loading ? true : buttonProps["aria-busy"];

  return (
    <button
      className={cx(
        "xb-button",
        `xb-button--${variant}`,
        `xb-button--${size}`,
        loading && "xb-button--loading",
        className,
      )}
      disabled={disabled}
      type={type}
      {...buttonProps}
      aria-busy={ariaBusy}
    >
      {loading ? <Spinner /> : leadingIcon}
      <span className="xb-button__label">{children}</span>
      {trailingIcon}
    </button>
  );
}

export function IconButton({
  className,
  icon,
  label,
  tooltip,
  type = "button",
  variant = "ghost",
  ...buttonProps
}: IconButtonProps): ReactElement {
  return (
    <Tooltip label={tooltip}>
      <button
        aria-label={label}
        className={cx("xb-icon-button", `xb-icon-button--${variant}`, className)}
        type={type}
        {...buttonProps}
      >
        <span aria-hidden="true" className="xb-icon-button__icon">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
}

export function Badge({
  children,
  className,
  variant = "neutral",
  ...badgeProps
}: BadgeProps): ReactElement {
  return (
    <span
      className={cx("xb-badge", `xb-badge--${variant}`, className)}
      {...badgeProps}
    >
      {children}
    </span>
  );
}

export function Tooltip({ children, label }: TooltipProps): ReactElement {
  return (
    <span className="xb-tooltip">
      {children}
      <span className="xb-tooltip__content" role="tooltip">
        {label}
      </span>
    </span>
  );
}

export function Alert({
  children,
  className,
  recovery,
  title,
  variant,
  ...alertProps
}: AlertProps): ReactElement {
  return (
    <div
      className={cx("xb-alert", `xb-alert--${variant}`, className)}
      role={variant === "danger" ? "alert" : "status"}
      {...alertProps}
    >
      <div className="xb-alert__content">
        <div className="xb-alert__title">{title}</div>
        <div className="xb-alert__message">{children}</div>
      </div>
      {recovery ? <div className="xb-alert__recovery">{recovery}</div> : null}
    </div>
  );
}

export function EmptyState({
  action,
  children,
  className,
  title,
  ...emptyStateProps
}: EmptyStateProps): ReactElement {
  return (
    <section className={cx("xb-empty-state", className)} {...emptyStateProps}>
      <h2 className="xb-empty-state__title">{title}</h2>
      <div className="xb-empty-state__body">{children}</div>
      {action ? <div className="xb-empty-state__action">{action}</div> : null}
    </section>
  );
}

export function Skeleton({
  className,
  height,
  label,
  style,
  width,
  ...skeletonProps
}: SkeletonProps): ReactElement {
  const skeletonStyle: CSSProperties = {
    width,
    height,
    ...style,
  };

  return (
    <div
      aria-label={label}
      className={cx("xb-skeleton", className)}
      role="status"
      style={skeletonStyle}
      {...skeletonProps}
    />
  );
}

export function ScoreBar({
  bandLabel,
  className,
  disabled = false,
  helpText,
  label,
  loading = false,
  max = 100,
  value,
  ...scoreBarProps
}: ScoreBarProps): ReactElement {
  const boundedMax = max > 0 ? max : 100;
  const boundedValue = Math.min(Math.max(value, 0), boundedMax);
  const fillPercent = (boundedValue / boundedMax) * 100;
  const style = {
    "--xb-score-bar-fill": `${fillPercent}%`,
  } as CSSProperties;

  return (
    <div
      aria-busy={loading ? true : undefined}
      className={cx(
        "xb-score-bar",
        disabled && "xb-score-bar--disabled",
        loading && "xb-score-bar--loading",
        className,
      )}
      {...scoreBarProps}
    >
      <div className="xb-score-bar__header">
        <span className="xb-score-bar__label">{label}</span>
        <span className="xb-score-bar__value">{boundedValue}</span>
      </div>
      <div
        aria-disabled={disabled ? true : undefined}
        aria-label={label}
        aria-valuemax={boundedMax}
        aria-valuemin={0}
        aria-valuenow={boundedValue}
        className="xb-score-bar__track"
        role="progressbar"
        style={style}
      >
        <span className="xb-score-bar__fill" />
      </div>
      <div className="xb-score-bar__meta">
        {bandLabel ? <span>{bandLabel}</span> : null}
        {helpText ? <span>{helpText}</span> : null}
        {loading ? <span role="status">Loading</span> : null}
      </div>
    </div>
  );
}

export function Input({
  className,
  disabled,
  error,
  helperText,
  id,
  label,
  loading = false,
  type = "text",
  ...inputProps
}: InputProps): ReactElement {
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId, inputProps["aria-describedby"]]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cx("xb-input", className)}>
      <label className="xb-input__label" htmlFor={id}>
        {label}
      </label>
      <input
        aria-busy={loading ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={error ? true : undefined}
        className="xb-input__control"
        disabled={disabled}
        id={id}
        type={type}
        {...inputProps}
      />
      {helperText ? (
        <p className="xb-input__helper" id={helperId}>
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p className="xb-input__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Drawer({
  children,
  className,
  closeLabel,
  onClose,
  open,
  title,
  ...drawerProps
}: DrawerProps): ReactElement | null {
  if (!open) {
    return null;
  }

  return (
    <div className="xb-drawer">
      <div
        aria-modal="true"
        aria-labelledby="xb-drawer-title"
        className={cx("xb-drawer__panel", className)}
        role="dialog"
        {...drawerProps}
      >
        <div className="xb-drawer__header">
          <h2 className="xb-drawer__title" id="xb-drawer-title">
            {title}
          </h2>
          <button
            aria-label={closeLabel}
            className="xb-drawer__close"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">x</span>
          </button>
        </div>
        <div className="xb-drawer__body">{children}</div>
      </div>
    </div>
  );
}

export function KeyValueList({
  className,
  disabled = false,
  emptyMessage = "No items.",
  items,
  loading = false,
  ...listProps
}: KeyValueListProps): ReactElement {
  if (loading) {
    return (
      <div
        aria-busy="true"
        className={cx("xb-key-value-list", "xb-key-value-list--loading", className)}
        role="status"
      >
        Loading
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={cx("xb-key-value-list", className)}>{emptyMessage}</div>
    );
  }

  return (
    <dl
      aria-disabled={disabled ? true : undefined}
      className={cx(
        "xb-key-value-list",
        disabled && "xb-key-value-list--disabled",
        className,
      )}
      {...listProps}
    >
      {items.map((item) => (
        <div className="xb-key-value-list__row" key={item.label}>
          <dt className="xb-key-value-list__label">{item.label}</dt>
          <dd className="xb-key-value-list__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Switch({
  checked,
  className = "xb-settings-route__switch",
  disabled,
  id,
  label,
  labelClassName = "xb-settings-route__switch-label",
  name,
  onChange,
}: SwitchProps): ReactElement {
  return (
    <label className={className} htmlFor={id}>
      <span className={labelClassName}>{label}</span>
      <input
        checked={checked}
        disabled={disabled}
        id={id}
        name={name}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.checked);
        }}
        type="checkbox"
      />
    </label>
  );
}

export function ToastRegion(): ReactElement {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="xb-toast-region"
      role="status"
    />
  );
}

export function PageHeader({
  actions,
  backAction,
  className,
  description,
  title,
  ...headerProps
}: PageHeaderProps): ReactElement {
  return (
    <header className={cx("xb-page-header", className)} {...headerProps}>
      <div className="xb-page-header__main">
        {backAction ? (
          <div className="xb-page-header__back">{backAction}</div>
        ) : null}
        <div className="xb-page-header__copy">
          <h1 className="xb-page-header__title">{title}</h1>
          {description ? (
            <p className="xb-page-header__description">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="xb-page-header__actions">{actions}</div> : null}
    </header>
  );
}
