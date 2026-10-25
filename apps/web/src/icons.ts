// Agent icon names (agents/*.md `icon`) → glyphs. Kept tiny on purpose; swap for an icon set later.
const ICONS: Record<string, string> = {
  crown: "♛",
  search: "⌕",
  code: "</>",
  eye: "◉",
  clipboard: "▤",
  blocks: "▦",
  "flask-conical": "⚗",
  "shield-check": "⛨",
  "file-text": "¶",
  "bar-chart-3": "▮",
  kanban: "☰",
  bot: "◆",
};

export const iconFor = (name: string) => ICONS[name] ?? ICONS.bot!;
