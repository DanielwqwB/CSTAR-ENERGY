import logo from "../../assets/cstar-logo.png";
import React, { useId } from "react";
import type { CSSProperties } from "react";
import { colors, ui } from "../theme";
import { css } from "../styles";
import { Icon, type IconName } from "./icons";
export { Icon } from "./icons";

export function Button({
  label,
  onClick,
  icon,
  secondary,
  disabled,
  style,
}: {
  label: string;
  onClick: () => void;
  icon?: IconName;
  secondary?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={css(
        styles.button,
        {
          backgroundColor: secondary ? colors.panel : colors.cyan,
          borderColor: secondary ? colors.border : colors.cyan,
          color: secondary ? colors.text : colors.bg,
        },
        style,
      )}
    >
      {icon && (
        <Icon
          name={icon}
          size={16}
          color={secondary ? colors.cyan : colors.bg}
        />
      )}
      <span>{label}</span>
    </button>
  );
}
export function Badge({
  children,
  tone = "cyan",
}: {
  children: React.ReactNode;
  tone?: "cyan" | "green" | "amber" | "rose" | "dim";
}) {
  return (
    <span
      style={{
        alignSelf: "flex-start",
        borderRadius: 30,
        border: `1px solid ${colors[tone]}44`,
        padding: "5px 10px",
        color: colors[tone],
        backgroundColor: colors[tone] + "12",
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
export function Status({ value }: { value: string }) {
  const tone = /Good|Ready|Reviewed|Supporting|Active/.test(value)
    ? "green"
    : /Insufficient|Missing|Unresolved/.test(value)
      ? "rose"
      : /Partial|Pending|Additional|Inconclusive|Moderate/.test(value)
        ? "amber"
        : "cyan";
  return <Badge tone={tone}>● {value}</Badge>;
}
export function Card({
  title,
  subtitle,
  action,
  children,
  style,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="panel" style={css(styles.card, style)}>
      {title && (
        <header className="panel-header" style={styles.cardHeader}>
          <div className="stack" style={{ flex: 1, gap: 5 }}>
            <h2 style={{ ...ui.title, margin: 0 }}>{title}</h2>
            {subtitle && <span style={ui.small}>{subtitle}</span>}
          </div>
          {action}
        </header>
      )}
      <div className="stack" style={{ padding: 18, gap: 14 }}>
        {children}
      </div>
    </section>
  );
}
type FieldProps = {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  style?: CSSProperties;
  "aria-label"?: string;
  type?: React.HTMLInputTypeAttribute;
  autoComplete?: string;
  required?: boolean;
};
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  editable = true,
  style,
  type = "text",
  autoComplete,
  required,
  ...props
}: FieldProps) {
  const id = useId();
  const shared = {
    id,
    value,
    placeholder,
    readOnly: !editable,
    required,
    "aria-label": props["aria-label"] || label || placeholder,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange?.(event.target.value),
    style: css(ui.input, style),
  };
  return (
    <div className="field">
      {label && (
        <label htmlFor={id} style={ui.muted}>
          {label}
        </label>
      )}
      {multiline ? (
        <textarea {...shared} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} />
      )}
    </div>
  );
}
export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      {label && (
        <label htmlFor={id} style={ui.small}>
          {label}
        </label>
      )}
      <select
        id={id}
        aria-label={label || "Select an option"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={ui.input}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
export function Toggle({
  value,
  onChange,
  "aria-label": label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  "aria-label": string;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        aria-label={label}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Notice({
  children,
  warning = false,
}: {
  children: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <aside
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: 14,
        border: `1px solid ${warning ? colors.amber : colors.cyan}30`,
        backgroundColor: (warning ? colors.amber : colors.cyan) + "09",
        borderRadius: 9,
      }}
    >
      <Icon
        name={
          warning ? "information-circle-outline" : "shield-checkmark-outline"
        }
        color={warning ? colors.amber : colors.cyan}
      />
      <span style={{ ...ui.muted, flex: 1, fontSize: 11 }}>{children}</span>
    </aside>
  );
}
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <div className="brand" style={{ color: inverse ? "#e7efea" : colors.text }}>
    <img src={logo} alt="" width={52} height={52} />
    <span>CSTAR<span style={{ color: inverse ? "#9ad0d5" : colors.cyan }}>-Energy</span></span>
  </div>;
}
const styles: Record<string, CSSProperties> = {
  button: {
    display: "inline-flex",
    minHeight: 42,
    flexShrink: 0,
    borderRadius: 8,
    padding: "10px 14px",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.4,
  },
  card: {
    backgroundColor: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    overflow: "hidden",
    minWidth: 0,
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderBottom: `1px solid ${colors.border}`,
    padding: 18,
  },
};
