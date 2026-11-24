export const colors = {
  bg: "#0B0B12",
  card: "#16161F",
  cardAlt: "#1E1E2A",
  border: "#2A2A38",
  text: "#F4F4F8",
  textDim: "#9A9AB0",
  textFaint: "#6B6B80",
  accent: "#9B7BFF",
  accentDim: "#3A2F66",
  green: "#3DDC97",
  greenDim: "#123B2C",
  red: "#FF5C7A",
  redDim: "#3D1520",
  yellow: "#FFC857",
  yellowDim: "#3D3115",
};

export const radius = { sm: 8, md: 14, lg: 20 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export function pnlColor(v: number | null | undefined) {
  if (v === null || v === undefined || Math.abs(v) < 0.005) return colors.textDim;
  return v > 0 ? colors.green : colors.red;
}
