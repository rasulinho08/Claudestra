// Reads the team's mission/board.md (docs/17) into kanban columns. The agents write plain Markdown, in English or
// Azerbaijani, so headings are matched loosely; anything unrecognised stays visible in the text view.
export type Column = "todo" | "doing" | "done" | "blocked";
export type Board = Record<Column, string[]>;

const HEADINGS: [Column, RegExp][] = [
  ["blocked", /block|needs owner|waiting|gözləy|bloklan|sahib/i],
  ["doing", /doing|in progress|progress|gedir|icrada|davam/i],
  ["done", /done|finished|complete|bitib|bitdi|hazır|tamam/i],
  ["todo", /to.?do|backlog|next|plan|ediləcək|görüləcək|növbəti/i],
];

export function parseBoard(markdown: string): Board {
  const board: Board = { todo: [], doing: [], done: [], blocked: [] };
  let col: Column | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line) ?? /^\*\*(.+?)\*\*:?$/.exec(line);
    if (heading) {
      const title = heading[2] ?? heading[1]!;
      col = HEADINGS.find(([, re]) => re.test(title))?.[0] ?? null;
      continue;
    }
    const item = /^(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s*)?(.+)$/.exec(line);
    if (!item || !col) continue;
    const text = item[2]!.replace(/\*\*|__|`/g, "").trim();
    if (!text || /^(none|yoxdur|—|-)\.?$/i.test(text)) continue;
    board[item[1] && item[1] !== " " ? "done" : col].push(text.slice(0, 300));
  }
  return board;
}

export const boardSize = (b: Board) => b.todo.length + b.doing.length + b.done.length + b.blocked.length;
