import { css } from "../styles";
import React from "react";
import series from "../data/series.json";
import { colors, ui } from "../theme";
import type { TransitionEvent } from "../types";
export function TrendChart({
  mode = "radiance",
  quarterly = false,
  variant = 1,
}: {
  mode?: "radiance" | "no2" | "comparison";
  quarterly?: boolean;
  variant?: number;
}) {
  const data = quarterly ? series.filter((_, i) => i % 3 === 2) : series;
  const max = mode === "no2" ? 40 : 80;
  const value = (n: number) =>
    variant === 0
      ? 90 - n
      : variant === 2
        ? n * 0.85
        : variant === 3
          ? n * 0.7
          : n;
  const x = (i: number) => 42 + (i * 600) / (data.length - 1);
  const y = (n: number) => 198 - (n / max) * 160;
  const points = data
    .map(
      (point, i) =>
        `${x(i)},${y(mode === "no2" ? point.no2 : value(point.radiance))}`,
    )
    .join(" ");
  return (
    <div
      className="stack"
      aria-label={`Illustrative ${mode} trend chart. Synthetic monthly data, not measured results.`}
    >
      <svg width="100%" height={235} viewBox="0 0 680 235">
        {[0, 1, 2, 3, 4].map((i) => (
          <React.Fragment key={i}>
            <line
              x1={42}
              y1={198 - i * 40}
              x2={645}
              y2={198 - i * 40}
              stroke={colors.border}
              strokeDasharray="3 5"
            />
            <text
              x={28}
              y={202 - i * 40}
              fill={colors.dim}
              fontSize={10}
              textAnchor="end"
            >
              {(i * max) / 4}
            </text>
          </React.Fragment>
        ))}
        <rect
          x={365}
          y={22}
          width={280}
          height={176}
          fill={colors.cyan}
          opacity={0.035}
        />
        <line
          x1={365}
          x2={365}
          y1={22}
          y2={198}
          stroke={colors.amber}
          opacity={0.6}
          strokeDasharray="4 5"
        />
        <text x={373} y={18} fill={colors.amber} fontSize={9}>
          ILLUSTRATIVE TRANSITION WINDOW
        </text>
        {mode === "comparison" && (
          <polyline
            points={data
              .map((p, i) => `${x(i)},${y(value(p.counter))}`)
              .join(" ")}
            fill="none"
            stroke={colors.muted}
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        )}
        <polyline
          points={points}
          fill="none"
          stroke={mode === "no2" ? colors.amber : colors.cyan}
          strokeWidth={3}
          strokeLinejoin="round"
        />
        {data.map((p, i) => (
          <React.Fragment key={p.month}>
            <circle
              cx={x(i)}
              cy={y(mode === "no2" ? p.no2 : value(p.radiance))}
              r={3}
              fill={mode === "no2" ? colors.amber : colors.cyan}
            />
            <text
              x={x(i)}
              y={222}
              fill={colors.dim}
              textAnchor="middle"
              fontSize={10}
            >
              {p.month}
            </text>
          </React.Fragment>
        ))}
      </svg>
      <div className="stack" style={css(ui.wrap)}>
        <span style={css(ui.small)}>
          ●{" "}
          <span style={css({ color: colors.cyan })}>
            Observed synthetic signal
          </span>
        </span>
        {mode === "comparison" && (
          <span style={css(ui.small)}>— Matched descriptive comparison</span>
        )}
        <span style={css(ui.small)}>Jan – Dec 2024</span>
      </div>
    </div>
  );
}
export function Distribution({ events }: { events: TransitionEvent[] }) {
  const types = ["Lighting", "Industrial", "Mixed", "Unresolved"];
  const palette = [colors.cyan, "#22d3ee", colors.amber, colors.rose];
  let offset = 0;
  return (
    <div
      className="stack"
      style={css([ui.row, { flexWrap: "wrap", justifyContent: "center" }])}
    >
      <svg width={146} height={146} viewBox="0 0 146 146">
        <circle
          cx={73}
          cy={73}
          r={51}
          stroke={colors.border}
          strokeWidth={18}
          fill="none"
        />
        {types.map((type, index) => {
          const count = events.filter((e) => e.shortType === type).length;
          const length = (count / Math.max(events.length, 1)) * 320;
          const previous = offset;
          offset += length;
          return (
            <circle
              key={type}
              cx={73}
              cy={73}
              r={51}
              fill="none"
              stroke={palette[index]}
              strokeWidth={18}
              strokeDasharray={`${Math.max(0, length - 5)} ${320 - Math.max(0, length - 5)}`}
              strokeDashoffset={-previous}
              transform="rotate(-90 73 73)"
            />
          );
        })}
        <text
          x={73}
          y={74}
          textAnchor="middle"
          fontSize={28}
          fontWeight="bold"
          fill={colors.text}
        >
          {events.length}
        </text>
        <text x={73} y={92} textAnchor="middle" fontSize={8} fill={colors.dim}>
          CANDIDATES
        </text>
      </svg>
      <div className="stack" style={css({ gap: 12, flex: 1, minWidth: 100 })}>
        {types.map((type, index) => (
          <div className="stack" key={type} style={css(ui.row)}>
            <div
              className="stack"
              style={css({
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: palette[index],
              })}
            />
            <span style={css([ui.muted, { flex: 1, fontSize: 11 }])}>
              {type}
            </span>
            <span style={css(ui.text)}>
              {events.filter((e) => e.shortType === type).length}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
