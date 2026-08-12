#!/usr/bin/env python3
"""Integrity check for the Claude memory store.

Validates, for ~/.claude/projects/-home-ta/memory/:
  - frontmatter parses, and name == filename stem
  - description present; metadata: block carries a type
  - MEMORY.md index matches the files on disk, both directions
  - every [[wikilink]] resolves to an existing memory

Code spans are stripped before link scanning, so shell `[[ ]]` is not
mistaken for a wikilink.

Exit 0 = clean, 1 = problems found. Run from /housekeeping or monthly cleanup.
"""
import glob, os, re, sys

MEM = os.environ.get(
    "MEMORY_DIR", os.path.expanduser("~/.claude/projects/-home-ta/memory"))
VALID_TYPES = {"user", "feedback", "project", "reference"}


def strip_code(s):
    s = re.sub(r"```.*?```", "", s, flags=re.S)   # fenced blocks
    s = re.sub(r"`[^`\n]*`", "", s)                # inline spans
    return s


def main():
    os.chdir(MEM)
    files = sorted(f for f in glob.glob("*.md") if f != "MEMORY.md")
    stems = {f[:-3] for f in files}
    problems = []

    for f in files:
        raw = open(f).read()
        stem = f[:-3]
        if not raw.startswith("---"):
            problems.append(f"{f}: no frontmatter")
            continue
        try:
            fm = raw.split("---", 2)[1]
        except IndexError:
            problems.append(f"{f}: malformed frontmatter")
            continue

        m = re.search(r"^name:\s*(.*)$", fm, re.M)
        name = m.group(1).strip() if m else ""
        if name != stem:
            problems.append(f"{f}: name {name!r} != filename stem {stem!r}")

        d = re.search(r"^description:\s*(\S.*)$", fm, re.M)
        if not d:
            problems.append(f"{f}: missing/empty description")

        if not re.search(r"^metadata:", fm, re.M):
            problems.append(f"{f}: legacy schema — needs a metadata: block")
        t = re.search(r"^\s+type:\s*(\w+)", fm, re.M)
        if not t:
            problems.append(f"{f}: missing metadata.type")
        elif t.group(1) not in VALID_TYPES:
            problems.append(f"{f}: type {t.group(1)!r} not in {sorted(VALID_TYPES)}")

        for link in re.findall(r"\[\[([^\]]*)\]\]", strip_code(raw)):
            if link.strip() and link not in stems:
                problems.append(f"{f}: dangling link [[{link}]]")

    if not os.path.exists("MEMORY.md"):
        print(f"memcheck: {len(files)} memories, 1 problem(s)")
        print("  MEMORY.md missing — the index is what recall loads first")
        return 1
    idx = open("MEMORY.md").read()
    # only real entry lines: "- [Title](file.md) — hook"
    linked = {m.group(1) for m in
              re.finditer(r"^- \[[^\]]+\]\((\S+\.md)\)", idx, re.M)
              if m.group(1) != "MEMORY.md"}
    for missing in sorted(stems - {l[:-3] for l in linked}):
        problems.append(f"MEMORY.md: no index entry for {missing}.md")
    for dangling in sorted(linked - {f for f in files}):
        problems.append(f"MEMORY.md: index entry {dangling} has no file")

    body = [l for l in idx.splitlines()
            if l.strip() and not l.startswith(("#", "-", "*", ">"))]
    prose = [l for l in body if not l.startswith("**")]
    if len(prose) > 6:
        problems.append(
            f"MEMORY.md: {len(prose)} non-index prose lines — index should hold "
            "pointers only, move content into a memory file")

    print(f"memcheck: {len(files)} memories, {len(problems)} problem(s)")
    for p in problems:
        print(f"  {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
