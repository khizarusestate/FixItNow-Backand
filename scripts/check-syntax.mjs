import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT_FILES = [
  "index.js",
  "adminSchema.js",
  "customerSchema.js",
  "workerSchema.js",
  "reviewSchema.js",
  "notificationSchema.js",
];

const DIRS = ["middleware", "routes", "utils"];

const listJsFiles = (dir) => {
  const entries = readdirSync(dir);
  return entries
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile() && path.endsWith(".js"));
};

const filesToCheck = [
  ...ROOT_FILES,
  ...DIRS.flatMap((dir) => listJsFiles(dir)),
];

for (const file of filesToCheck) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Syntax check passed for ${filesToCheck.length} files.`);
