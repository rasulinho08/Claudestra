export const usd = (v: number | null | undefined) => (v === null || v === undefined ? "" : `$${v.toFixed(v < 0.01 ? 4 : 3)}`);
export const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
