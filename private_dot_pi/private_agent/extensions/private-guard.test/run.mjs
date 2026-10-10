#!/usr/bin/env node
// Regression suite for private-guard.ts. Runs each case through the extension's real tool_call
// handler and compares the verdict to the case's `want`.
//
//   node run.mjs                                   # all of cases.json
//   node run.mjs <guard.ts> <cases.json>           # explicit paths
//
// The guard path defaults to the sibling ../private-guard.ts, so the suite works both in the
// chezmoi source tree and in the deployed extensions directory. Exits non-zero on any mismatch.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const guardPath = process.argv[2] ?? join(here, "..", "private-guard.ts");
const casesPath = process.argv[3] ?? join(here, "cases.json");

const mod = await import(pathToFileURL(guardPath).href);
let handler;
mod.default({ on: (_event, fn) => (handler = fn) });
if (typeof handler !== "function") throw new Error(`no tool_call handler registered by ${guardPath}`);

const HOME = process.env.HOME;
const MODELS = {
	deepseek: { provider: "deepseek", id: "deepseek-flash" },
	ollama: { provider: "ollama", id: "gemma4" },
};

const cases = JSON.parse(readFileSync(casesPath, "utf8"));
let failed = 0;
for (const c of cases) {
	const cwd = c.cwd.replace(/^~/, HOME);
	const input = c.tool === "bash" ? { command: c.cmd } : { path: c.path };
	const model = MODELS[c.model ?? "deepseek"];
	const result = await handler({ toolName: c.tool, input }, { cwd, model });
	const got = result?.block ? "BLOCK" : "allow";
	const ok = got === c.want;
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "MISS"} want=${c.want} got=${got}  [${c.cwd}] ${c.cmd ?? `${c.tool} ${c.path}`}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
