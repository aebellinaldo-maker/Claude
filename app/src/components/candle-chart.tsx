import Svg, { Line, Rect } from "react-native-svg";
import { colors } from "../lib/theme";

export interface CandlePoint {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Candlestick chart with volume bars underneath (15-minute candles). */
export function CandleChart({ candles, width, height = 180 }: { candles: CandlePoint[]; width: number; height?: number }) {
  if (candles.length < 2 || width <= 0) return null;
  const volH = Math.round(height * 0.22);
  const priceH = height - volH - 6;
  const hi = Math.max(...candles.map((k) => k.h));
  const lo = Math.min(...candles.map((k) => k.l));
  const span = hi - lo || hi * 0.01 || 1;
  const maxV = Math.max(1, ...candles.map((k) => k.v));
  const step = width / candles.length;
  const bodyW = Math.max(1, step * 0.65);
  const y = (p: number) => 2 + (1 - (p - lo) / span) * (priceH - 4);

  return (
    <Svg width={width} height={height}>
      {candles.map((k, i) => {
        const x = i * step + step / 2;
        const up = k.c >= k.o;
        const color = up ? colors.green : colors.red;
        const top = y(Math.max(k.o, k.c));
        const bodyH = Math.max(1, Math.abs(y(k.o) - y(k.c)));
        const vh = (k.v / maxV) * volH;
        return [
          <Line key={`w${i}`} x1={x} x2={x} y1={y(k.h)} y2={y(k.l)} stroke={color} strokeWidth={1} />,
          <Rect key={`b${i}`} x={x - bodyW / 2} y={top} width={bodyW} height={bodyH} fill={color} />,
          <Rect key={`v${i}`} x={x - bodyW / 2} y={height - vh} width={bodyW} height={vh} fill={color} opacity={0.35} />,
        ];
      })}
    </Svg>
  );
}
