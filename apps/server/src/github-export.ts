// "Push to GitHub" for a run's workspace (docs/07 "Results"). Uses the GitHub REST API with GITHUB_TOKEN, so it
// needs no git install and works with every engine. A new repo is created (private by default); an existing repo
// gets one new commit on its default branch that adds or updates the files (nothing is deleted).

export type GitHubFile = { path: string; data: Uint8Array };
export type ExportResult = { url: string; repo: string; branch: string; commit: string; created: boolean; files: number };

type Fetch = typeof fetch;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function parseRepo(input: string): { owner: string | null; name: string } {
  const parts = input.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").split("/");
  if (parts.length > 2) throw new GitHubError("repository must be NAME or OWNER/NAME", 400);
  const [owner, name] = parts.length === 2 ? parts : [null, parts[0]!];
  if (!name || !NAME.test(name) || name === "." || name === ".." || (owner !== null && !/^[A-Za-z0-9-]{1,39}$/.test(owner))) throw new GitHubError("repository names use letters, digits, . _ -", 400);
  return { owner, name };
}

// "Kiçik xərc izləyici!" -> "kicik-xerc-izleyici"
export function repoSlug(text: string): string {
  const map: Record<string, string> = { ə: "e", ı: "i", ö: "o", ü: "u", ş: "s", ç: "c", ğ: "g", İ: "i" };
  const slug = text
    .toLocaleLowerCase("az")
    .replace(/[əıöüşçğİ]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "claudestra-project";
}

export async function exportToGitHub(opts: {
  token: string;
  repo: string;
  files: GitHubFile[];
  message: string;
  description?: string;
  private?: boolean;
  apiUrl?: string;
  fetchImpl?: Fetch;
  retryDelayMs?: number;
}): Promise<ExportResult> {
  if (opts.files.length === 0) throw new GitHubError("the run's workspace has no files to push", 400);
  const f = opts.fetchImpl ?? fetch;
  const base = (opts.apiUrl || "https://api.github.com").replace(/\/+$/, "");
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const call = async <T>(method: string, path: string, body?: unknown, okMissing = false, attempt = 0): Promise<T | null> => {
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${opts.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "Claudestra",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (okMissing && (res.status === 404 || res.status === 409)) return null;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // Secondary rate limits (many writes in a row) answer 403/429 with Retry-After: wait and try again a few times.
    const limited = res.status === 429 || (res.status === 403 && (res.headers.get("retry-after") || /rate limit/i.test(String(json.message ?? ""))));
    if (limited && attempt < 3) {
      const after = Number(res.headers.get("retry-after"));
      await pause(opts.retryDelayMs ?? Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 5000 * (attempt + 1), 60_000));
      return call<T>(method, path, body, okMissing, attempt + 1);
    }
    if (!res.ok) throw new GitHubError(explain(res.status, String(json.message ?? `HTTP ${res.status}`), method, path), res.status);
    return json as T;
  };

  const { owner: wanted, name } = parseRepo(opts.repo);
  const me = (await call<{ login: string }>("GET", "/user"))!;
  const owner = wanted ?? me.login;

  let repo = await call<{ html_url: string; default_branch: string; full_name: string }>("GET", `/repos/${owner}/${name}`, undefined, true);
  const created = !repo;
  if (!repo) {
    const body = { name, private: opts.private ?? true, auto_init: true, description: (opts.description ?? "").slice(0, 300) };
    repo = await call("POST", owner.toLowerCase() === me.login.toLowerCase() ? "/user/repos" : `/orgs/${owner}/repos`, body);
  }
  const full = repo!.full_name;
  const branch = repo!.default_branch || "main";

  // A freshly created repo can take a moment before its first commit is visible.
  let ref: { object: { sha: string } } | null = null;
  for (let i = 0; i < 6 && !ref; i++) {
    ref = await call("GET", `/repos/${full}/git/ref/heads/${encodeURIComponent(branch)}`, undefined, true);
    if (!ref) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 1000));
  }
  if (!ref) throw new GitHubError(`${full} has no ${branch} branch yet; open it on GitHub, add a README, then push again`, 409);
  const parent = ref.object.sha;
  const parentCommit = (await call<{ tree: { sha: string } }>("GET", `/repos/${full}/git/commits/${parent}`))!;

  // Text files go inline in the tree request (one call for all of them); only binary files need a blob each, sent
  // one at a time to stay under GitHub's content-creation limits.
  const tree: ({ path: string; mode: string; type: "blob"; sha: string } | { path: string; mode: string; type: "blob"; content: string })[] = [];
  for (const file of opts.files) {
    const text = asText(file.data);
    if (text !== null) tree.push({ path: file.path, mode: "100644", type: "blob", content: text });
    else {
      const blob = (await call<{ sha: string }>("POST", `/repos/${full}/git/blobs`, { content: Buffer.from(file.data).toString("base64"), encoding: "base64" }))!;
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
  }
  tree.sort((a, b) => a.path.localeCompare(b.path));

  // New repo: the tree replaces the generated README. Existing repo: files are added on top of what is there.
  const newTree = (await call<{ sha: string }>("POST", `/repos/${full}/git/trees`, created ? { tree } : { base_tree: parentCommit.tree.sha, tree }))!;
  const commit = (await call<{ sha: string }>("POST", `/repos/${full}/git/commits`, { message: opts.message, tree: newTree.sha, parents: [parent] }))!;
  await call("PATCH", `/repos/${full}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
  return { url: repo!.html_url, repo: full, branch, commit: commit.sha, created, files: opts.files.length };
}

// UTF-8 text without NUL bytes, small enough to send inline; null means "send as a blob".
function asText(data: Uint8Array): string | null {
  if (data.length > 1024 * 1024 || data.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

function explain(status: number, message: string, method: string, path: string): string {
  if (status === 401) return `GitHub rejected GITHUB_TOKEN (${message}). Create a new token and put it in .env.`;
  if (status === 429 || /rate limit/i.test(message)) return `GitHub rate limit: ${message}. Wait a few minutes and push again.`;
  if (status === 403 || (status === 404 && method === "POST"))
    return `GitHub refused ${method} ${path}: ${message}. The token needs repository "Contents: write" and, to create repos, "Administration: write" (fine-grained) or the "repo" scope (classic).`;
  if (status === 422 && path.endsWith("/repos")) return `GitHub could not create the repository: ${message}`;
  return `GitHub ${method} ${path} failed: ${message}`;
}
