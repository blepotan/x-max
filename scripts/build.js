import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
const distDirectory = join(projectRoot, "dist");
const stageDirectory = join(distDirectory, "extension");
const archiveName = `x-max-v${manifest.version}.zip`;
const archivePath = join(distDirectory, archiveName);

await rm(distDirectory, { recursive: true, force: true });
await mkdir(stageDirectory, { recursive: true });
await cp(join(projectRoot, "manifest.json"), join(stageDirectory, "manifest.json"));
await cp(join(projectRoot, "src"), join(stageDirectory, "src"), { recursive: true });

const archive = Bun.spawnSync(["zip", "-q", "-r", archivePath, "."], {
  cwd: stageDirectory,
  stderr: "pipe",
  stdout: "pipe"
});

if (!archive.success) {
  const message = archive.stderr.toString().trim() || "zip failed";
  throw new Error(message);
}

await rm(stageDirectory, { recursive: true, force: true });
console.log(`Built ${basename(archivePath)}`);
