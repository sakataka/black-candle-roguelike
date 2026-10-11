import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== "--"), options: { base: { type: "string", default: "./" }, outDir: { type: "string", default: "dist" } } });
if (values.base !== "./") throw new Error("This app uses a relative asset base (./).");
const outDir = resolve(values.outDir!);
const staging = `${outDir}.build-${process.pid}`;
const backup = `${outDir}.previous-${process.pid}`;
try {
  const result = await Bun.build({ entrypoints: ["index.html"], outdir: staging, target: "browser", minify: true, splitting: true, publicPath: "./", define: { "process.env.NODE_ENV": '"production"' } });
  if (!result.success) throw new AggregateError(result.logs, "Frontend build failed");
  if (existsSync("public")) cpSync("public", staging, { recursive: true });
  mkdirSync(resolve(outDir, ".."), { recursive: true });
  if (existsSync(outDir)) renameSync(outDir, backup);
  try { renameSync(staging, outDir); } catch (error) { if (existsSync(backup)) renameSync(backup, outDir); throw error; }
  rmSync(backup, { recursive: true, force: true });
  console.log(`Built ${result.outputs.length} assets in ${values.outDir}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
