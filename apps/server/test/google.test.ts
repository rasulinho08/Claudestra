// Google connection (docs/21): OAuth flow, token storage, and the Gmail / Calendar / Drive tools.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GOOGLE_SCOPES, GoogleAuth } from "../src/google-auth.ts";
import { IntegrationRegistry } from "../src/integrations.ts";
import { openMcpBridge } from "../src/mcp-bridge.ts";
import { DEFAULT_NEVER_AUTO } from "../src/config.ts";
import { evaluate } from "../src/approvals.ts";
import { SERVER_ONLY_SECRETS } from "../src/secret-env.ts";

const example = fileURLToPath(new URL("../../../integrations.example.json", import.meta.url));

test("sign-in: a one-use state, a refresh token on disk, and disconnect", async () => {
  const tokenFile = path.join(mkdtempSync(path.join(tmpdir(), "g-")), "token.json");
  const calls: string[] = [];
  const fakeFetch = (async (url: string, init?: { body?: URLSearchParams }) => {
    calls.push(`${url} ${init?.body?.toString() ?? ""}`);
    if (String(url).includes("/token")) return { ok: true, json: async () => ({ access_token: "at", refresh_token: "rt-1", scope: "x" }) };
    if (String(url).includes("userinfo")) return { ok: true, json: async () => ({ email: "owner@example.com" }) };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
  const auth = new GoogleAuth({ clientId: "cid", clientSecret: "sec", tokenFile, redirectUri: "http://127.0.0.1:8787/api/google/callback", fetch: fakeFetch });
  assert.deepEqual(auth.status(), { configured: true, connected: false, email: null, connectedAt: null, redirectUri: "http://127.0.0.1:8787/api/google/callback" });

  const url = new URL(auth.connectUrl());
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("scope"), GOOGLE_SCOPES.join(" "));
  const state = url.searchParams.get("state")!;
  await assert.rejects(() => auth.finish("code", "forged-state"), /expired/);
  const status = await auth.finish("code-1", state);
  assert.equal(status.connected, true);
  assert.equal(status.email, "owner@example.com");
  assert.equal(JSON.parse(readFileSync(tokenFile, "utf8")).refresh_token, "rt-1");
  assert.match(calls[0]!, /grant_type=authorization_code/);
  await assert.rejects(() => auth.finish("code-1", state), /expired/, "a state works once");

  await auth.disconnect();
  assert.ok(!existsSync(tokenFile));
  assert.ok(calls.some((c) => c.includes("revoke") && c.includes("rt-1")));
  assert.throws(() => new GoogleAuth({ clientId: null, clientSecret: null, tokenFile, redirectUri: "x" }).connectUrl(), /GOOGLE_CLIENT_ID/);
});

test("the google app needs its client, hides its secrets, and never auto-approves writing or sending", () => {
  const reg = new IntegrationRegistry(example, {});
  const cfg = reg.config("google");
  assert.deepEqual((cfg && "missing" in cfg ? cfg.missing : []).sort(), ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  assert.ok(SERVER_ONLY_SECRETS.includes("GOOGLE_CLIENT_SECRET"));
  for (const tool of ["mcp__google__create_email_draft", "mcp__google__send_email_draft", "mcp__google__create_calendar_event", "mcp__google__create_google_doc"]) {
    const gate = evaluate({ mode: "auto", workspace: "/tmp", agentName: "a", agentTools: [], mcpAllowed: () => true, requiresApproval: [], neverAuto: DEFAULT_NEVER_AUTO, approvedForRun: new Set([tool]) }, tool, {});
    assert.equal(gate.kind, "ask", tool);
  }
  for (const tool of ["mcp__google__gmail_search", "mcp__google__gmail_read", "mcp__google__calendar_list_events", "mcp__google__drive_read"]) {
    const gate = evaluate({ mode: "smart", workspace: "/tmp", agentName: "a", agentTools: [], mcpAllowed: () => true, requiresApproval: [], neverAuto: DEFAULT_NEVER_AUTO, approvedForRun: new Set() }, tool, {});
    assert.equal(gate.kind, "allow", tool);
  }
});

test("gmail, calendar and drive tools talk to Google with a refreshed token", async () => {
  const seen: { method: string; url: string; auth: string; body: string }[] = [];
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const fake = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = req.url!;
      seen.push({ method: req.method!, url, auth: String(req.headers.authorization ?? ""), body });
      const json = (o: unknown) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
      if (url === "/token") return json({ access_token: "access-1", expires_in: 3600 });
      if (url.startsWith("/gmail/v1/users/me/messages?")) return json({ messages: [{ id: "msg001" }] });
      if (url.startsWith("/gmail/v1/users/me/messages/msg001")) {
        return json({ id: "msg001", threadId: "thr01", snippet: "Hello there", payload: { headers: [{ name: "From", value: "Client <c@example.com>" }, { name: "Subject", value: "Demo sorğusu" }, { name: "Date", value: "Mon, 9 Nov 2026" }, { name: "Message-ID", value: "<m1@example.com>" }], parts: [{ mimeType: "text/plain", body: { data: b64("Salam, demo istəyirik.") } }] } });
      }
      if (url === "/gmail/v1/users/me/drafts" && req.method === "POST") return json({ id: "draft9" });
      if (url === "/gmail/v1/users/me/drafts/send") return json({ id: "sent1" });
      if (url.startsWith("/calendar/v3/calendars/primary/events") && req.method === "GET") return json({ items: [{ id: "ev1", summary: "Sprint planning", start: { dateTime: "2026-11-12T10:00:00+04:00" }, end: { dateTime: "2026-11-12T11:00:00+04:00" }, attendees: [{ email: "a@example.com" }] }] });
      if (url.startsWith("/calendar/v3/calendars/primary/events") && req.method === "POST") return json({ id: "ev2", summary: JSON.parse(body).summary, start: JSON.parse(body).start, htmlLink: "https://cal.example/ev2", hangoutLink: "https://meet.example/abc" });
      if (url.startsWith("/drive/v3/files?")) return json({ files: [{ id: "doc12345", name: "GRC plan", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-11-01T00:00:00Z", webViewLink: "https://docs.example/doc12345" }] });
      if (url.startsWith("/drive/v3/files/doc12345/export")) return (res.setHeader("content-type", "text/plain"), res.end("Plan mətni"));
      if (url.startsWith("/drive/v3/files/doc12345")) return json({ id: "doc12345", name: "GRC plan", mimeType: "application/vnd.google-apps.document" });
      if (url.startsWith("/upload/drive/v3/files")) return json({ id: "new777", name: "Hesabat", webViewLink: "https://docs.example/new777" });
      res.statusCode = 404;
      json({ error: { message: "not found" } });
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const port = (fake.address() as { port: number }).port;
  const tokenFile = path.join(mkdtempSync(path.join(tmpdir(), "g2-")), "token.json");
  const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_TOKEN_FILE: tokenFile, GOOGLE_TEST_BASE: `http://127.0.0.1:${port}` };
  const reg = new IntegrationRegistry(example, env);
  const { servers, allows } = reg.forAgent(["google"], { CLAUDESTRA_WORKSPACE: "/tmp" });
  const bridge = await openMcpBridge(servers, allows);
  const signal = new AbortController().signal;
  const call = (tool: string, input: Record<string, unknown>) => bridge.call(`mcp__google__${tool}`, input, signal);
  try {
    assert.deepEqual(bridge.errors, []);
    const notYet = await call("gmail_search", { query: "is:unread" });
    assert.equal(notYet.ok, false);
    assert.match(notYet.output, /not connected yet/);
    writeFileSync(tokenFile, JSON.stringify({ refresh_token: "rt-1" }));

    const found = await call("gmail_search", { query: "is:unread" });
    assert.match(found.output, /id msg001[\s\S]*Client <c@example\.com>[\s\S]*Demo sorğusu/);
    const mail = await call("gmail_read", { message_id: "msg001" });
    assert.match(mail.output, /Subject: Demo sorğusu[\s\S]*Salam, demo istəyirik\./);

    const draft = await call("create_email_draft", { to: "c@example.com\r\nBcc: evil@example.com", subject: "Re: Demo sorğusu", body: "Salam! Sabah uyğundur?", reply_to_message_id: "msg001" });
    assert.match(draft.output, /Draft saved \(id draft9\)[\s\S]*NOT been sent/);
    const posted = JSON.parse(seen.find((s) => s.url.endsWith("/drafts") && s.method === "POST")!.body);
    const raw = Buffer.from(posted.message.raw, "base64url").toString("utf8");
    assert.equal(posted.message.threadId, "thr01");
    assert.match(raw, /^To: c@example\.com Bcc: evil@example\.com\r\n/, "line breaks cannot add headers");
    assert.match(raw, /Subject: =\?UTF-8\?B\?/);
    assert.match(raw, /In-Reply-To: <m1@example\.com>/);
    assert.equal(Buffer.from(raw.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString("utf8"), "Salam! Sabah uyğundur?");
    assert.match((await call("send_email_draft", { draft_id: "draft9" })).output, /Sent/);

    assert.match((await call("calendar_list_events", {})).output, /Sprint planning · with a@example\.com · id ev1/);
    const ev = await call("create_calendar_event", { title: "Demo", start: "2026-11-20T15:00:00+04:00", end: "2026-11-20T15:30:00+04:00", attendees: ["c@example.com"], meet: true });
    assert.match(ev.output, /Event created: Demo[\s\S]*Meet: https:\/\/meet\.example\/abc/);
    assert.match(seen.find((s) => s.method === "POST" && s.url.startsWith("/calendar"))!.url, /sendUpdates=all[\s\S]*conferenceDataVersion=1/);
    assert.equal((await call("create_calendar_event", { title: "Bad", start: "2026-11-20T15:00:00+04:00", end: "2026-11-20T14:00:00+04:00" })).ok, false);

    assert.match((await call("drive_search", { query: "GRC's plan" })).output, /GRC plan · google document[\s\S]*id doc12345/);
    assert.match(decodeURIComponent(seen.find((s) => s.url.startsWith("/drive/v3/files?"))!.url), /GRC\\'s\+plan/, "quotes are escaped in the Drive query");
    assert.match((await call("drive_read", { file_id: "doc12345" })).output, /# GRC plan[\s\S]*Plan mətni/);
    const doc = await call("create_google_doc", { title: "Hesabat", markdown: "# Başlıq\n\n- bir\n- iki\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n**Qalın** <script>x</script>" });
    assert.match(doc.output, /Google Doc created: Hesabat[\s\S]*new777/);
    const upload = seen.find((s) => s.url.startsWith("/upload"))!.body;
    assert.match(upload, /<h1>Başlıq<\/h1>[\s\S]*<ul>\s*<li>bir<\/li>[\s\S]*<td>1<\/td>[\s\S]*<b>Qalın<\/b> &lt;script&gt;/);

    assert.equal(seen.filter((s) => s.url === "/token").length, 1, "the access token is reused");
    assert.ok(seen.filter((s) => s.url !== "/token").every((s) => s.auth === "Bearer access-1"));
  } finally {
    await bridge.close();
    fake.close();
  }
});
