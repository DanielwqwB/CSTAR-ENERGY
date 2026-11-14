import type { CSSProperties } from "react";

export const colors = {
  bg: "#eef1ed",
  panel: "#f8f9f5",
  raised: "#e5ebe5",
  border: "#ccd6d0",
  text: "#263b39",
  muted: "#506761",
  dim: "#60736d",
  cyan: "#176c7a",
  green: "#286b4c",
  amber: "#865d14",
  rose: "#a44356",
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
