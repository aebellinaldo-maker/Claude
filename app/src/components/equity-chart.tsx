import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { colors } from "../lib/theme";

const FONT = "Inter, -apple-system, system-ui, sans-serif";

const hhmm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * Equity of one run: green above the starting amount, red below, a dashed START line,
 * time labels and an optional log scale (so a 1 → 60x run doesn't flatten the start).
 */
export function EquityChart({
  points,
  startEur,
  width,
  height = 130,
  log = false,
}: {
  points: { ts: number; eur: number }[];
  startEur: number;
  width: number;
  height?: number;
  log?: boolean;
}) {
  if (width <= 0) return null;
  const pts = points.length >= 2 ? points : [{ ts: Date.now() - 60_000, eur: startEur }, { ts: Date.now(), eur: startEur }];
  const padT = 10,
    padB = 18,
    padR = 6;
  const tx = (v: number) => (log ? Math.log(Math.max(v, startEur * 0.01, 1e-6)) : v);
  const vals = pts.map((p) => tx(p.eur)).concat(tx(startEur));
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  if (hi - lo < 1e-9) {
    const d = Math.abs(hi) * 0.05 || 1;
    lo -= d;
    hi += d;
  }
  const t0 = pts[0].ts,
    t1 = pts[pts.length - 1].ts;
  const X = (ts: number) => ((ts - t0) / Math.max(1, t1 - t0)) * (width - padR);
  const Y = (v: number) => padT + (1 - (tx(v) - lo) / (hi - lo)) * (height - padT - padB);
  const startY = Y(startEur);

  // Split the line into green (above start) and red (below) segments.
  const segs: { d: string; up: boolean }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const up = (a.eur + b.eur) / 2 >= startEur;
    const d = `M${X(a.ts).toFixed(1)},${Y(a.eur).toFixed(1)} L${X(b.ts).toFixed(1)},${Y(b.eur).toFixed(1)}`;
    const last = segs[segs.length - 1];
    if (last && last.up === up) last.d += ` L${X(b.ts).toFixed(1)},${Y(b.eur).toFixed(1)}`;
    else segs.push({ d, up });
  }
  const end = pts[pts.length - 1];
  const endUp = end.eur >= startEur;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p.ts).toFixed(1)},${Y(p.eur).toFixed(1)}`).join(" ");
  const area = `${line} L${X(end.ts).toFixed(1)},${startY.toFixed(1)} L0,${startY.toFixed(1)} Z`;
  const mid = t0 + (t1 - t0) / 2;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={endUp ? colors.green : colors.red} stopOpacity={0.22} />
          <Stop offset="1" stopColor={endUp ? colors.green : colors.red} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#eqfill)" />
      <Line x1={0} x2={width} y1={startY} y2={startY} stroke={colors.textFaint} strokeWidth={1} strokeDasharray="4 4" />
      <SvgText x={2} y={startY - 4} fill={colors.textFaint} fontSize={9} fontWeight="600" fontFamily={FONT}>
        START
      </SvgText>
      {segs.map((sg, i) => (
        <Path key={i} d={sg.d} stroke={sg.up ? colors.green : colors.red} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <Circle cx={X(end.ts)} cy={Y(end.eur)} r={7} fill={endUp ? colors.green : colors.red} opacity={0.25} />
      <Circle cx={X(end.ts)} cy={Y(end.eur)} r={3.5} fill={endUp ? colors.green : colors.red} />
      {[t0, mid, t1].map((ts, i) => (
        <SvgText
          key={i}
          x={i === 0 ? 0 : i === 1 ? width / 2 : width - padR}
          y={height - 4}
          fill={colors.textFaint}
          fontSize={9}
          fontFamily={FONT}
          textAnchor={i === 0 ? "start" : i === 1 ? "middle" : "end"}
        >
          {hhmm(ts)}
        </SvgText>
      ))}
    </Svg>
  );
}
