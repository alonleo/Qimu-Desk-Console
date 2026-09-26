/** Shared workbench colors and surface tokens. */
export const T = {
  primary: "#345d88",
  primaryDeep: "#284d75",
  primaryBg: "#eaf0f6",
  primarySoft: "#dce7f1",

  ink: "#0f172a",
  ink2: "#475569",
  ink3: "#788696",
  inkMid: "#64748b",

  line: "#e5e7eb",
  lineSoft: "#eef2f5",

  bgPage: "#f4f6f8",
  bgSoft: "#f1f5f9",

  red: "#dc2626",
  redBg: "#fef2f2",
  redLight: "#ef4444",
  orange: "#f59e0b",
  orangeDeep: "#b45309",

  cardRadius: 8,
  cardShadow: "none",
} as const;

export function brandGradient(color: string = T.primary): string {
  return color;
}
