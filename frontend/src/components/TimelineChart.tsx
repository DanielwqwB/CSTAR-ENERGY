import series from "../data/series.json";

export function TimelineChart({ mode, quarterly }: { mode: "radiance" | "no2"; quarterly: boolean }) {
  const points = quarterly ? series.filter((_, index) => index % 3 === 2) : series;
  const max = mode === "radiance" ? 80 : 40;
  const color = mode === "radiance" ? "#0787e8" : "#9a6500";
  const id = `timeline-${mode}`;
  const x = (index: number) => 52 + index * 608 / (points.length - 1);
  const y = (value: number) => 174 - value / max * 142;
  const values = points.map(point => mode === "radiance" ? point.radiance : point.no2);
  const polyline = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const area = `52,174 ${polyline} 660,174`;
  return <div className="timeline-chart" aria-label={`Illustrative ${mode === "radiance" ? "nighttime radiance" : "atmospheric NO₂"} trend chart; synthetic values, not measured results`}>
    <svg viewBox="0 0 712 235" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity=".03" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(index => <g key={index}><line x1="52" x2="660" y1={174 - index * 35.5} y2={174 - index * 35.5} stroke="#d9e7f8" strokeDasharray="4 4" /><text x="40" y={178 - index * 35.5} textAnchor="end" fontSize="11" fill="#425b80">{index * max / 4}</text></g>)}
      <line x1={x(quarterly ? 1.33 : 6)} x2={x(quarterly ? 1.33 : 6)} y1="29" y2="174" stroke="#eca400" strokeDasharray="6 5" />
      <rect x={Math.min(400, x(quarterly ? 1.33 : 6) + 5)} y="7" width="245" height="25" rx="12" fill="#fff0d4" /><text x={Math.min(400, x(quarterly ? 1.33 : 6) + 128)} y="24" textAnchor="middle" fontSize="10" fill="#946000" fontWeight="700">ILLUSTRATIVE TRANSITION WINDOW</text>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
      {points.map((point, index) => <g key={point.month}><circle cx={x(index)} cy={y(values[index])} r="4" fill={color} /><text x={x(index)} y="204" textAnchor="middle" fontSize="11" fill="#101f50">{point.month}</text></g>)}
    </svg>
    <div className="timeline-chart-legend"><span><i style={{ background: color }} />Observed synthetic signal</span><span><i style={{ background: mode === "radiance" ? "#a5daf9" : "#f3dbac" }} />{mode === "radiance" ? "Jan–Dec 2024" : "Simulated atmospheric enhancement"}</span></div>
  </div>;
}
