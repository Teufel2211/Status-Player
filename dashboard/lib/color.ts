export const MC_COLOR_HEX: Record<string, string> = {
  black: "#000000",
  dark_blue: "#0000AA",
  dark_green: "#00AA00",
  dark_aqua: "#00AAAA",
  dark_red: "#AA0000",
  dark_purple: "#AA00AA",
  gold: "#FFAA00",
  gray: "#AAAAAA",
  dark_gray: "#555555",
  blue: "#5555FF",
  green: "#55FF55",
  aqua: "#55FFFF",
  red: "#FF5555",
  light_purple: "#FF55FF",
  yellow: "#FFFF55",
  white: "#FFFFFF",
}

export function cssColor(color?: string | null): string {
  if (!color) return "var(--bg-hover)"
  const v = color.trim().toLowerCase()
  if (!v || v === "reset") return "var(--bg-hover)"
  if (v === "rainbow" || v === "animated") {
    return "linear-gradient(90deg,#FF5555,#FFAA00,#FFFF55,#55FF55,#55FFFF,#5555FF,#FF55FF)"
  }
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]
  }
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  return MC_COLOR_HEX[v] ?? "var(--bg-hover)"
}
