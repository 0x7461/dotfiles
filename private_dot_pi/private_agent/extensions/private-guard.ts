// private-guard's source of truth is ~/.agents/scripts/private-guard.ts, in the ithaca store, so
// that pi's extension and Claude Code's PreToolUse hook call one policy instead of two copies. Edit
// and commit it there; this file only re-exports it. The suite lives beside it at
// ~/.agents/scripts/private-guard.test/run.mjs and takes this path as its guard argument when you
// want to prove the shim still loads.
export * from "/home/ta/.agents/scripts/private-guard.ts";
export { default } from "/home/ta/.agents/scripts/private-guard.ts";
