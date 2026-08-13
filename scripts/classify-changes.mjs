// @ts-check
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "out", "change-split");
const tracked = execFileSync("git", ["diff", "--name-only"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}).split(/\r?\n/).filter(Boolean);
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}).split(/\r?\n/).filter(Boolean);
const changed = [...new Set([...tracked, ...untracked])];
const formatting = [];
const functional = [];
for (const file of changed) {
  if (untracked.includes(file)) {
    functional.push(file);
    continue;
  }
  const result = spawnSync("git", ["diff", "--ignore-all-space", "--quiet", "--", file], {
    cwd: root,
    stdio: "ignore",
  });
  (result.status === 0 ? formatting : functional).push(file);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "formatting-files.txt"), `${formatting.join("\n")}\n`);
writeFileSync(join(out, "functional-files.txt"), `${functional.join("\n")}\n`);
const formattingPatch = formatting.length
  ? execFileSync("git", ["diff", "--binary", "--", ...formatting], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
  : Buffer.alloc(0);
writeFileSync(join(out, "formatting.patch"), formattingPatch);
writeFileSync(
  join(out, "change-groups.json"),
  `${JSON.stringify({ formattingOnly: formatting, functional }, null, 2)}\n`,
);
console.log(`${formatting.length} formatting-only; ${functional.length} functional.`);
