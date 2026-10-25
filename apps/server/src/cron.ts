// Minimal 5-field cron (minute hour day-of-month month day-of-week) for workflow schedules.
// Supports *, numbers, a-b ranges, lists and /step. Day-of-week 0 and 7 are Sunday.
export type CronMatcher = (d: Date) => boolean;

const RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function field(spec: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${spec}"`);
    let lo: number, hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range!.includes("-")) [lo, hi] = range!.split("-").map(Number) as [number, number];
    else [lo, hi] = [Number(range), stepRaw === undefined ? Number(range) : max];
    if (![lo, hi].every((n) => Number.isInteger(n) && n >= min && n <= max) || lo > hi) throw new Error(`"${spec}" is out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronMatcher {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron needs 5 fields: minute hour day month weekday");
  const [mi, ho, dom, mo, dow] = parts.map((p, i) => field(p, RANGES[i]!));
  if (dow!.has(7)) dow!.add(0);
  const domAny = parts[2] === "*";
  const dowAny = parts[4] === "*";
  return (d) => {
    if (!mi!.has(d.getMinutes()) || !ho!.has(d.getHours()) || !mo!.has(d.getMonth() + 1)) return false;
    // Classic cron: when both day fields are restricted, either may match.
    const domOk = dom!.has(d.getDate());
    const dowOk = dow!.has(d.getDay());
    return domAny && dowAny ? true : domAny ? dowOk : dowAny ? domOk : domOk || dowOk;
  };
}

export function nextRun(expr: string, from = new Date(), limitMinutes = 366 * 24 * 60): Date | null {
  const match = parseCron(expr);
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < limitMinutes; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (match(d)) return new Date(d);
  }
  return null;
}
