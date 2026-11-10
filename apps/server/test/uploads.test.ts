// Attachments (docs/19): safe names, limits, ownership, and files landing in the run's workspace.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MAX_FILE_BYTES, UploadError, Uploads, attachmentNote, safeName } from "../src/uploads.ts";
import { RunStore } from "../src/store.ts";
import { RunLauncher, HttpError } from "../src/runs.ts";
import { WorkflowStore } from "../src/workflows.ts";
import { requiredRole } from "../src/access.ts";
import { testAgents, testConfig } from "./helpers.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

test("file names are made safe", () => {
  assert.equal(safeName("../../etc/passwd"), "passwd");
  assert.equal(safeName("C:\\Users\\me\\Hesabat 2026 (son).xlsx"), "Hesabat 2026 (son).xlsx");
  assert.equal(safeName(".env"), "env");
  assert.equal(safeName("a;rm -rf $HOME`x`.txt"), "a_rm -rf _HOME_x_.txt");
  assert.equal(safeName("şəkil.png"), "şəkil.png");
  assert.equal(safeName("///"), "file");
});

test("uploads are stored, renamed on clashes, limited, and only usable by their owner", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uploads-"));
  const ws = mkdtempSync(path.join(tmpdir(), "ws-"));
  const uploads = new Uploads(dir);
  const up = uploads.save([{ name: "data.csv", data: bytes("a,b\n1,2\n") }, { name: "x/DATA.csv", data: bytes("c\n") }], "aysel");
  assert.deepEqual(up.files.map((f) => f.name), ["data.csv", "DATA (2).csv"]);
  assert.throws(() => uploads.attach(up.id, ws, "inputs", "elvin"), UploadError, "someone else's upload");
  assert.throws(() => uploads.attach("../../etc", ws, "inputs", "aysel"), UploadError);
  const names = uploads.attach(up.id, ws, "inputs", "aysel");
  assert.deepEqual(names, ["DATA (2).csv", "data.csv"]);
  assert.equal(readFileSync(path.join(ws, "inputs", "data.csv"), "utf8"), "a,b\n1,2\n");
  assert.ok(!existsSync(path.join(dir, up.id)), "holding folder is removed");
  assert.throws(() => uploads.attach(up.id, ws, "inputs", "aysel"), UploadError, "used once");
  assert.throws(() => uploads.save([{ name: "big.bin", data: new Uint8Array(MAX_FILE_BYTES + 1) }], null), /larger than/);
  assert.throws(() => uploads.save(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.txt`, data: bytes("x") })), null), /at most 10/);
  assert.match(attachmentNote("inputs", names), /inputs\/data\.csv/);
});

test("a run with attachments gets the files and a note; a bad upload id is refused", () => {
  const cfg = testConfig({ authMode: "demo", workspacesDir: mkdtempSync(path.join(tmpdir(), "runs-")), uploadsDir: mkdtempSync(path.join(tmpdir(), "up-")) });
  const store = new RunStore();
  const notes: string[] = [];
  const runner = { start: async (_id: string, opts: { projectNote?: string }) => void notes.push(opts.projectNote ?? "") };
  const uploads = new Uploads(cfg.uploadsDir);
  const launcher = new RunLauncher(cfg, store, testAgents(), new WorkflowStore(store), runner, undefined, uploads);
  const up = uploads.save([{ name: "brief.md", data: bytes("# Brief\n") }], "aysel");
  const { runId } = launcher.start({ prompt: "Read the brief", uploadId: up.id, createdBy: "aysel" });
  assert.equal(readFileSync(path.join(cfg.workspacesDir, runId, "inputs", "brief.md"), "utf8"), "# Brief\n");
  assert.match(notes[0]!, /Files attached by the user[\s\S]*inputs\/brief\.md/);
  assert.throws(() => launcher.start({ prompt: "x", uploadId: "11111111-1111-4111-8111-111111111111", createdBy: "aysel" }), HttpError);
  assert.equal(requiredRole("POST", "/api/uploads"), "operator");
});
