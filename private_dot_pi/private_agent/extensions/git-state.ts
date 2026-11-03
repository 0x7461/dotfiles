import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Which git branch each part of a session happened on.
//
// CC stamps `gitBranch` on every transcript row it writes. pi does not, and an extension cannot
// rewrite rows pi has already written — so this appends a marker **in stream** instead: whenever the
// branch or HEAD differs from the last one recorded, one `ithaca-git` entry goes into the session
// file, and a reader attributes every row to the newest marker above it. The result is the same thing
// CC gives, one level cheaper: only changes are stored, and a session that never leaves master pays
// one entry for the whole session.
//
// Why it lives in an extension rather than in the reader: the state is only knowable while the
// session runs. A checkout after the fact is unrecoverable from the transcript, which is why the
// reader can only guess from the work journal's checkpoints — those are written when the agent
// chooses, not when the branch moves.
//
// Sampling is after every finalized tool call: a `git switch` inside one is followed immediately by a
// marker, so the rows after it carry the new branch and the rows before it keep the old one. Sampling
// per assistant message instead would smear one whole turn segment onto whichever branch it ended on.
//
// Two costs, both bounded: one `git rev-parse` pair per tool call (a few milliseconds, asynchronous,
// and skipped while one is already in flight), and nothing at all outside a work tree.

export const ENTRY_TYPE = "ithaca-git";

export type GitState = { branch: string; head: string; cwd: string };

const exec = promisify(execFile);
const TIMEOUT_MS = 1500;

/**
 * Turn `rev-parse --abbrev-ref HEAD` plus `rev-parse --short HEAD` into state, or null.
 *
 * A detached HEAD reports the literal `HEAD`, which would make every checkout to a commit look like
 * the same "branch" and quietly merge two histories into one row label — so it is named for what it
 * is instead.
 */
export function parseState(cwd: string, stdout: string): GitState | null {
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length < 2) return null;
	const [branch, head] = lines;
	return { branch: branch === "HEAD" ? "detached" : branch, head, cwd };
}

/** Whether `next` says something `previous` did not: a different branch, a different commit, a new root. */
export function changed(previous: GitState | null, next: GitState | null): boolean {
	if (!next) return false;
	if (!previous) return true;
	return previous.branch !== next.branch || previous.head !== next.head || previous.cwd !== next.cwd;
}

/** The branch/commit of a work tree, or null when the directory is not one. */
export async function sample(cwd: string): Promise<GitState | null> {
	if (!cwd) return null;
	const run = (args: string[]) =>
		exec("git", ["-C", cwd, ...args], { timeout: TIMEOUT_MS, windowsHide: true });
	try {
		// Two calls, not one: `rev-parse --abbrev-ref HEAD --short HEAD` applies the later abbreviation
		// flag to both revisions, so the commit came back as the branch name a second time.
		const [branch, head] = await Promise.all([
			run(["rev-parse", "--abbrev-ref", "HEAD"]),
			run(["rev-parse", "--short", "HEAD"]),
		]);
		return parseState(cwd, `${branch.stdout}\n${head.stdout}`);
	} catch {
		// Not a work tree, no git, or a repo with no commits yet: all mean "nothing to record".
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	let last: GitState | null = null;
	let inFlight = false;

	async function record(cwd: string): Promise<void> {
		if (inFlight) return; // a burst of parallel tool calls must not stack up subprocesses
		inFlight = true;
		try {
			const next = await sample(cwd);
			if (changed(last, next)) {
				pi.appendEntry(ENTRY_TYPE, next);
				last = next;
			}
		} catch {
			// A meter must never break a call, and neither may this.
		} finally {
			inFlight = false;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		last = null; // a resumed session starts its own sequence
		await record(ctx?.cwd ?? process.cwd());
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		await record(ctx?.cwd ?? process.cwd());
	});
}
