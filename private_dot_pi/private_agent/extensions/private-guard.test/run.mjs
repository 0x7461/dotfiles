#!/usr/bin/env node
// Regression suite for private-guard.ts. Runs each case through the extension's real tool_call
// handler and compares the verdict to the case's `want`.
//
//   node run.mjs                                   # all of cases.json
//   node run.mjs <guard.ts> <cases.json>           # explicit paths
//
// The guard path defaults to the sibling ../private-guard.ts, so the suite works both in the
// chezmoi source tree and in the deployed extensions directory. Exits non-zero on any mismatch.
import { existsSync, readFileSync } from "node:fs";
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
	anthropic: { provider: "anthropic", id: "claude-sonnet-5" },
	openai: { provider: "openai", id: "gpt-6-luna" },
	google: { provider: "google", id: "gemini-3.8-flash" },
	// The one provider with a per-id allowlist, and pi's default lane. Both directions matter: an
	// allowlisted id is private, an id that is not listed is not.
	go: { provider: "opencode-go", id: "deepseek-v4.1-flash" },
	goUnlisted: { provider: "opencode-go", id: "some-model-nobody-allowlisted" },
};

const cases = JSON.parse(readFileSync(casesPath, "utf8"));
let failed = 0;

// Roots must exist, or be absent on purpose. A root that has moved (Firefox did, to ~/.config/mozilla)
// otherwise guards nothing, and no case notices: that is how this list fell behind the machine.
const { ROOT_LISTS } = mod;
for (const label of ["SECRET_ROOTS", "PRIVATE_ROOTS"]) {
	for (const root of ROOT_LISTS[label]) {
		if (ROOT_LISTS.ABSENT_ON_PURPOSE.has(root)) continue;
		if (existsSync(root)) continue;
		failed++;
		console.log(`MISS ${label} root does not exist: ${root.replace(HOME, "~")}`);
	}
}
for (const [root, why] of ROOT_LISTS.ABSENT_ON_PURPOSE) {
	if (!existsSync(root)) continue;
	failed++;
	console.log(`MISS ${root.replace(HOME, "~")} is listed absent on purpose but exists (${why})`);
}
for (const c of cases) {
	const cwd = c.cwd.replace(/^~/, HOME);
	const input = c.tool === "bash" ? { command: c.cmd } : { path: c.path };
	const model = MODELS[c.model ?? "deepseek"];
	const result = await handler({ toolName: c.tool, input }, { cwd, model });
	const got = result?.block ? "BLOCK" : "allow";
	const ok = got === c.want;
	if (!ok) failed++;
	const why = ok ? "" : `\n       ${(result?.reason ?? "").split("\n")[0]}`;
	console.log(`${ok ? "ok  " : "MISS"} want=${c.want} got=${got}  [${c.cwd}] ${c.cmd ?? `${c.tool} ${c.path}`}${why}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed, ${failed} failed`);process.exit(failed === 0 ? 0 : 1);
