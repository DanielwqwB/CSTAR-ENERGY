import type { CSSProperties } from "react";

export const colors = {
  bg: "#07111f",
  panel: "#0b1728",
  raised: "#101f32",
  border: "#24364d",
  text: "#f1f5f9",
  muted: "#94a3b8",
  dim: "#64748b",
  cyan: "#38bdf8",
  green: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
};
export const ui = {
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stack: { gap: 18 },
  text: { color: colors.text, fontSize: 13, lineHeight: "21px" },
  muted: { color: colors.muted, fontSize: 12, lineHeight: "20px" },
  small: { color: colors.dim, fontSize: 10, lineHeight: "17px" },
  label: {
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "600",
  },
  heading: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  title: { color: colors.text, fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingInline: 14,
    paddingBlock: 12,
    color: colors.text,
    backgroundColor: colors.bg,
    fontSize: 13,
    minHeight: 46,
  },
  divider: { height: 1, backgroundColor: colors.border },
} satisfies Record<string, CSSProperties>;
