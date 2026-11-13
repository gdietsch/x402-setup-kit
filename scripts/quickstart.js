#!/usr/bin/env node
/**
 * One-command start: copy .env.example to .env if needed, then boot the server.
 * On first run, PAYTO_ADDRESS is still a placeholder — set a real address
 * before taking mainnet payments. Testnet 402s work with the placeholder.
 */
import { copyFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const example = join(root, ".env.example");

if (!existsSync(envPath)) {
  copyFileSync(example, envPath);
  console.log("Created .env from .env.example.");
  console.log("Edit PAYTO_ADDRESS (and optional SOLANA_PAY_TO) before taking real payments.\n");
}

if (!existsSync(join(root, "node_modules"))) {
  console.log("Installing dependencies…");
  const inst = spawn("npm", ["install"], { cwd: root, stdio: "inherit" });
  inst.on("exit", (code) => {
    if (code !== 0) process.exit(code || 1);
    start();
  });
} else {
  start();
}

function start() {
  const child = spawn(process.execPath, ["src/server.js"], { cwd: root, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code || 0));
}
