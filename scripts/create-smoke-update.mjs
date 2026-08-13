// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const readArg = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`${name} is required`);
  return resolve(args[index + 1]);
};
const source = readArg("--snapshot");
const output = readArg("--out");
const snapshot = JSON.parse(readFileSync(source, "utf8"));
snapshot.revision += 1;
snapshot.generatedAt = new Date().toISOString();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(snapshot)}\n`);
console.log(snapshot.revision);
