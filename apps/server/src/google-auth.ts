// Google sign-in for the built-in "google" app (docs/21). The owner connects one Google account in the browser
// (OAuth 2.0 authorization code flow); the refresh token is stored in data/google-token.json, which only this server
// and the google MCP server read. Agents never see it: they only get the tools, and writing tools need approval.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Least privilege for the tools in apps/server/mcp/google.mjs.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly", // search and read mail
  "https://www.googleapis.com/auth/gmail.compose", // drafts, and sending them (approval-gated)
  "https://www.googleapis.com/auth/calendar.events", // read and create events
  "https://www.googleapis.com/auth/drive.readonly", // find and read files
  "https://www.googleapis.com/auth/drive.file", // create new files (only files this app made can be changed)
  "https://www.googleapis.com/auth/userinfo.email", // show which account is connected
];

export type GoogleStatus = { configured: boolean; connected: boolean; email: string | null; connectedAt: string | null; redirectUri: string };
type Saved = { refresh_token: string; email: string | null; scope: string; connectedAt: string };
type Fetch = typeof fetch;

const STATE_TTL_MS = 10 * 60 * 1000;

export class GoogleAuth {
  // state value -> when it was issued; one use, short-lived (protects the callback against forged requests).
  private states = new Map<string, number>();

  constructor(
    private opts: { clientId: string | null; clientSecret: string | null; tokenFile: string; redirectUri: string; fetch?: Fetch; authBase?: string; tokenUrl?: string; userinfoUrl?: string; revokeUrl?: string },
  ) {}

  private get fetch(): Fetch {
    return this.opts.fetch ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.opts.clientId && this.opts.clientSecret);
  }

  private saved(): Saved | null {
    try {
      return existsSync(this.opts.tokenFile) ? (JSON.parse(readFileSync(this.opts.tokenFile, "utf8")) as Saved) : null;
    } catch {
      return null;
    }
  }

  status(): GoogleStatus {
    const s = this.saved();
    return { configured: this.configured, connected: Boolean(s?.refresh_token), email: s?.email ?? null, connectedAt: s?.connectedAt ?? null, redirectUri: this.opts.redirectUri };
  }

  // The Google page to send the owner to.
  connectUrl(now = Date.now()): string {
    if (!this.configured) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in .env");
    for (const [k, t] of this.states) if (now - t > STATE_TTL_MS) this.states.delete(k);
    const state = randomBytes(24).toString("base64url");
    this.states.set(state, now);
    const q = new URLSearchParams({
      client_id: this.opts.clientId!,
      redirect_uri: this.opts.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline", // ask for a refresh token
      prompt: "consent", // always return one, also when reconnecting
      include_granted_scopes: "true",
      state,
    });
    return `${this.opts.authBase ?? "https://accounts.google.com/o/oauth2/v2/auth"}?${q}`;
  }

  // Google sent the owner back with a code: swap it for tokens and remember the refresh token.
  async finish(code: string, state: string, now = Date.now()): Promise<GoogleStatus> {
    const issued = this.states.get(state);
    this.states.delete(state);
    if (!issued || now - issued > STATE_TTL_MS) throw new Error("this sign-in link has expired; press Connect Google again");
    const res = await this.fetch(this.opts.tokenUrl ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: this.opts.clientId!, client_secret: this.opts.clientSecret!, redirect_uri: this.opts.redirectUri, grant_type: "authorization_code" }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) throw new Error(`Google refused the sign-in: ${body.error_description ?? body.error ?? res.status}`);
    if (!body.refresh_token) throw new Error("Google did not return a refresh token. Remove Claudestra under myaccount.google.com → Security → Third-party access, then connect again.");
    let email: string | null = null;
    try {
      const info = await this.fetch(this.opts.userinfoUrl ?? "https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${body.access_token}` } });
      email = ((await info.json()) as { email?: string }).email ?? null;
    } catch {
      // the connection works without the address; it is only shown in the app
    }
    mkdirSync(path.dirname(this.opts.tokenFile), { recursive: true });
    const saved: Saved = { refresh_token: body.refresh_token, email, scope: body.scope ?? "", connectedAt: new Date(now).toISOString() };
    writeFileSync(this.opts.tokenFile, JSON.stringify(saved), { mode: 0o600 });
    return this.status();
  }

  // Forgets the account here and asks Google to revoke the token (best effort).
  async disconnect(): Promise<void> {
    const s = this.saved();
    rmSync(this.opts.tokenFile, { force: true });
    if (s?.refresh_token) {
      await this.fetch(this.opts.revokeUrl ?? "https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: s.refresh_token }) }).catch(() => {});
    }
  }
}
