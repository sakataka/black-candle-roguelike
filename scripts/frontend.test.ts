import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const direct: RequestInit & { proxy: false } = { proxy: false };

async function startFrontend(env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "scripts/dev-frontend.ts", "--port", "0"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const reader = child.stdout.getReader();
  let output = "";
  while (!output.includes("Frontend listening on")) {
    const next = await reader.read();
    if (next.done) throw new Error(await new Response(child.stderr).text());
    output += new TextDecoder().decode(next.value);
  }
  const url = output.match(/http:\/\/[^\s]+/)![0];
  return { url, stop: async () => { child.kill(); await child.exited; } };
}

test("Bun HTML bundles keep public files and relative asset URLs for subpath delivery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "frontend-build-"));
  try {
    const child = Bun.spawn([process.execPath, "scripts/build-frontend.ts", "--base", "./", "--outDir", join(dir, "dist")], { stdout: "pipe", stderr: "pipe" });
    const error = await new Response(child.stderr).text();
    expect(await child.exited, error).toBe(0);
    const html = await Bun.file(join(dir, "dist/index.html")).text();
    expect(html).not.toContain("/src/");
    const assets = [...html.matchAll(/(?:src|href)="(\.\/[^"?]+\.(?:js|css|svg))"/g)].map(match => match[1]);
    expect(assets.some(path => path.endsWith(".js"))).toBe(true);
    expect(assets.some(path => path.endsWith(".css"))).toBe(true);
    for (const asset of assets) expect(await Bun.file(join(dir, "dist", asset)).exists()).toBe(true);
    if (existsSync("public")) for (const file of new Bun.Glob("**/*").scanSync({ cwd: existsSync("public") ? "public" : join(dir, "dist"), onlyFiles: true })) expect(await Bun.file(join(dir, "dist", file)).bytes()).toEqual(await Bun.file(join("public", file)).bytes());
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20000);

test("development bundles are served without exposing source files", async () => {
  const frontend = await startFrontend();
  try {
    const html = await (await fetch(frontend.url, direct)).text();
    expect(html).toContain("/_bun/client/");
    const script = html.match(/src="([^"]+\.js)"/)![1];
    expect((await fetch(new URL(script, frontend.url), direct)).status).toBe(200);
    const hidden = await (await fetch(new URL("/scripts/build-frontend.ts", frontend.url), direct)).text();
    expect(hidden).not.toContain("Bun.build(");
  } finally { await frontend.stop(); }
}, 20000);

test("failed compilation keeps the last published build", async () => {
  const dir = mkdtempSync(join(tmpdir(), "frontend-failure-"));
  try {
    await Bun.write(join(dir, "dist/index.html"), "last-successful-build");
    const child = Bun.spawn([process.execPath, join(process.cwd(), "scripts/build-frontend.ts"), "--outDir", join(dir, "dist")], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(await Bun.file(join(dir, "dist/index.html")).text()).toBe("last-successful-build");
    expect([...new Bun.Glob("dist.build-*").scanSync({ cwd: dir, onlyFiles: false })]).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20000);
