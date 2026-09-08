export { CONNECTOR_VERSION } from "./types.js";
export { createApp } from "./server.js";

import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await import("./server.js").then(({ createApp: buildApp }) => buildApp({ config }));
  await app.listen({ host: config.host, port: config.port });
}

if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href) await main();
