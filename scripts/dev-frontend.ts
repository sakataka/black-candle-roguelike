import { parseArgs } from "node:util";
import page from "../index.html";

const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== "--"), options: { host: { type: "string", default: "127.0.0.1" }, port: { type: "string" }, preview: { type: "boolean", default: false } } });
if (values.host !== "127.0.0.1" && values.host !== "localhost") throw new Error("Frontend must listen on loopback.");
const port = Number(values.port ?? process.env.LOCALWEB_DEV_PORT ?? "0");
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid frontend port");
const server = Bun.serve({
  hostname: values.host,
  port,
  development: values.preview ? false : { hmr: true, console: true },
  routes: values.preview ? { "/assets/*": { dir: "./dist/assets" }, "/config/*": { dir: "./dist/config" }, "/*": { dir: "./dist" } } : { "/assets/*": { dir: "./public/assets" }, "/config/*": { dir: "./public/config" }, "/*": page },
});
console.log(`Frontend listening on ${server.url}`);
