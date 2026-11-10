# 21. Google: Gmail, Calendar and Drive

One Google account, connected by the owner, gives agents tools for mail, calendar and documents. Reading is free;
everything that writes or sends waits for a person.

`apps/server/src/google-auth.ts` (OAuth), `apps/server/mcp/google.mjs` (tools), integration `google`, Apps page card,
agent `assistant`, skill `inbox-triage`, automation *Inbox digest* (docs/20).

## Tools
| Tool | Does | Approval |
|---|---|---|
| `gmail_search`, `gmail_read` | search the inbox, read one mail | no |
| `create_email_draft` | save a draft (also as a reply in a conversation); nothing is sent | always |
| `send_email_draft` | send an existing draft | always, every time |
| `calendar_list_events` | events between two moments | no |
| `create_calendar_event` | new event, optional guests (they get an invitation) and Meet link | always |
| `drive_search`, `drive_read` | find files; read Docs/Slides as text, Sheets as CSV, text files | no |
| `create_google_doc` | new Google Doc from Markdown | always |

Nothing can delete, move, label or edit existing mail, events or files. `create_*` and `send_*` are on the
never-auto list (`DEFAULT_NEVER_AUTO`), so they ask even in auto mode and "approve for this run" does not cover them.

## Setup (once, about 10 minutes)
1. Open <https://console.cloud.google.com>, create a project.
2. **APIs & Services → Library**: enable **Gmail API**, **Google Calendar API**, **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: user type **External** (or **Internal** if the account is in your own
   Google Workspace), app name of your choice, your email as contact. Under **Test users** add the Google address
   that the agents will work in.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Web application**. Under
   **Authorised redirect URIs** add the address shown on the Apps page, by default
   `http://127.0.0.1:8787/api/google/callback` (with `PUBLIC_URL`: `<PUBLIC_URL>/api/google/callback`).
5. Copy the client ID and secret into `.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```
6. Restart Claudestra, open **Apps**, press **Connect Google**, choose the account and allow the listed access.
   Google shows a "Google hasn't verified this app" page for your own unverified app: **Advanced → Go to …**.

Open the app at the same address as the redirect URI (`http://127.0.0.1:8787`), so the browser comes back to it.

### Access expires after 7 days while the app is in "Testing"
Google gives External apps in **Testing** status a refresh token that lasts 7 days; after that the tools answer
"Google sign-in has expired" and the owner presses **Connect again**. To avoid the weekly reconnect either choose
user type **Internal** (Workspace accounts) or set the consent screen's publishing status to **In production**
(for your own use Google still shows the "unverified app" page, but the token no longer expires weekly). A changed
Google password also ends access when Gmail is included.

## What is requested and stored
Scopes: `gmail.readonly`, `gmail.compose`, `calendar.events`, `drive.readonly`, `drive.file`, `userinfo.email`.
The refresh token is kept in `data/google-token.json` (git-ignored, readable only by the server's user). The server
uses it only to hand short-lived access tokens to the google tools; `GOOGLE_CLIENT_SECRET` and the token are never
passed to agents' shells. **Disconnect** deletes the file and revokes the token at Google.

The connected account is shared by every agent that lists `google` (or part of it, such as
`"google:calendar_list_events"`) in its `integrations`. Give it only to agents that need it:
- `assistant`: everything (mail triage, meeting prep, documents).
- `project-manager`: `google:calendar_list_events` only.
- a researcher or strategist: `"google:drive_search", "google:drive_read", "google:create_google_doc"`.

## Safety notes
- Mail and document text come from outside. The `assistant` agent and the `inbox-triage` skill treat them as data
  and report instructions found inside them as suspicious instead of following them. Keep approvals on `smart` or
  `manual` for runs that read mail, and read what a draft says before approving a send.
- Only the owner may connect or disconnect the account (`/api/google/connect`, `/api/google/callback`,
  `DELETE /api/google`). The sign-in uses a one-time `state` value that expires after 10 minutes.
- On a shared server everyone who can give tasks to an agent with `google` can make it read the connected inbox.
  Connect a shared team mailbox rather than a personal one, or keep those agents for the owner.
