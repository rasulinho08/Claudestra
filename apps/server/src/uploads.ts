// Attachments (docs/19): files a person adds to a task. They are uploaded first, kept in a holding folder, and
// copied into the run's workspace (inputs/) when the run starts, where the agents read them like any other file.
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const KEEP_MS = 24 * 60 * 60 * 1000;

export class UploadError extends Error {}

// A safe file name: no folders, no control or shell-special characters, never hidden, never empty.
export function safeName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = base.normalize("NFC").replace(/[^\p{L}\p{N}._ ()-]/gu, "_").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "file";
}

export type UploadInfo = { id: string; files: { name: string; bytes: number }[] };

export class Uploads {
  constructor(private dir: string) {}

  private folder(id: string): string | null {
    return /^[0-9a-f-]{36}$/.test(id) ? path.join(this.dir, id) : null;
  }

  // Stores a batch of files and returns its id. Names are made safe and unique within the batch.
  save(files: { name: string; data: Uint8Array }[], owner: string | null): UploadInfo {
    if (files.length === 0) throw new UploadError("no files");
    if (files.length > MAX_FILES) throw new UploadError(`at most ${MAX_FILES} files per task`);
    let total = 0;
    for (const f of files) {
      if (f.data.byteLength > MAX_FILE_BYTES) throw new UploadError(`${safeName(f.name)} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      total += f.data.byteLength;
    }
    if (total > MAX_TOTAL_BYTES) throw new UploadError(`files are larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB together`);
    this.sweep();
    const id = randomUUID();
    const folder = path.join(this.dir, id);
    mkdirSync(path.join(folder, "files"), { recursive: true });
    const used = new Set<string>();
    const out: UploadInfo["files"] = [];
    for (const f of files) {
      let name = safeName(f.name);
      for (let n = 2; used.has(name.toLowerCase()); n++) {
        const ext = path.extname(safeName(f.name));
        name = `${path.basename(safeName(f.name), ext)} (${n})${ext}`;
      }
      used.add(name.toLowerCase());
      writeFileSync(path.join(folder, "files", name), f.data);
      out.push({ name, bytes: f.data.byteLength });
    }
    writeFileSync(path.join(folder, "meta.json"), JSON.stringify({ owner, createdAt: new Date().toISOString() }));
    return { id, files: out };
  }

  // Moves an upload's files into <workspace>/<sub>/ and returns their names. Only the person who uploaded may use it.
  attach(id: string, workspace: string, sub: string, owner: string | null): string[] {
    const folder = this.folder(id);
    if (!folder || !existsSync(path.join(folder, "meta.json"))) throw new UploadError("the attached files were not found (they are kept for one day); attach them again");
    const meta = JSON.parse(readFileSync(path.join(folder, "meta.json"), "utf8")) as { owner: string | null };
    if (meta.owner !== owner) throw new UploadError("the attached files were not found (they are kept for one day); attach them again");
    const target = path.join(workspace, sub);
    mkdirSync(target, { recursive: true });
    const names = readdirSync(path.join(folder, "files")).sort();
    for (const n of names) cpSync(path.join(folder, "files", n), path.join(target, n));
    rmSync(folder, { recursive: true, force: true });
    return names;
  }

  // Uploads that never became a run are dropped after a day.
  sweep(now = Date.now()) {
    if (!existsSync(this.dir)) return;
    for (const entry of readdirSync(this.dir)) {
      const folder = this.folder(entry);
      if (!folder) continue;
      try {
        if (now - statSync(folder).mtimeMs > KEEP_MS) rmSync(folder, { recursive: true, force: true });
      } catch {
        // already gone
      }
    }
  }
}

// What the agents are told about the attached files.
export function attachmentNote(sub: string, names: string[]): string {
  if (names.length === 0) return "";
  return [
    "# Files attached by the user",
    `The user attached these files to the task. They are in the workspace folder ${sub}/:`,
    ...names.map((n) => `- ${sub}/${n}`),
    "Read the ones the task needs before you start. If you cannot read a file's format (for example a PDF, an image or an Office file on an engine without that ability), say so plainly instead of guessing its contents.",
  ].join("\n");
}
