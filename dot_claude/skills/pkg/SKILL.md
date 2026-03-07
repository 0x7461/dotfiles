---
name: pkg
description: Create or update a void-packages template for a GitHub-hosted package. Fetches latest release, computes checksum, writes template, and prompts to build with vpm.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - WebFetch
---

Create or update a void-packages template. The user will provide a package name and GitHub repo (e.g. `/pkg weathr Veirt/weathr`).

## Steps

### 1. Parse input

Extract `pkgname` and `owner/repo` from the args. If only a repo is given, derive pkgname from the repo name.

### 2. Check if template exists

```sh
ls ~/void-packages/srcpkgs/<pkgname>/template 2>/dev/null
```

If it exists, read it — we're updating, not creating from scratch.

### 3. Fetch latest release

```sh
curl -s https://api.github.com/repos/<owner>/<repo>/releases/latest \
  | jq -r '.tag_name, .published_at'
```

Strip leading `v` from tag to get the version number.

### 4. Compute checksum

```sh
curl -sL "https://github.com/<owner>/<repo>/archive/<tag>.tar.gz" | sha256sum
```

### 5. Detect build style

- `Cargo.toml` in repo → `cargo`
- `go.mod` in repo → `go`
- `setup.py` or `pyproject.toml` → `python3`
- `Makefile` → `gnu-makefile`
- Check existing similar templates in `~/void-packages/srcpkgs/` for reference

```sh
curl -s "https://api.github.com/repos/<owner>/<repo>/contents" \
  | jq -r '.[].name' | grep -E "Cargo.toml|go.mod|setup.py|pyproject.toml|Makefile"
```

### 6. Find license

```sh
curl -s "https://api.github.com/repos/<owner>/<repo>" | jq -r '.license.spdx_id'
```

### 7. Write or update the template

**If creating new:**

```
mkdir -p ~/void-packages/srcpkgs/<pkgname>
```

Write `~/void-packages/srcpkgs/<pkgname>/template` with:
- `pkgname`, `version`, `revision=1`
- `build_style` from step 5
- `short_desc` from GitHub repo description (keep under 72 chars)
- `maintainer="ta <ta@localhost>"`
- `license` from step 6
- `homepage` and `changelog` (raw CHANGELOG.md if exists, else blank)
- `distfiles` using `${version}` variable
- `checksum` from step 4
- `post_install` with `vlicense LICENSE` if license file exists

**If updating existing:**
- Update `version` to new value
- Update `checksum` to new value
- Reset `revision=1`
- Keep all other fields intact

### 8. Show result

Print the final template content and confirm what was written.

### 9. Next step prompt

Tell the user:
- If new package: open vpm and search for `<pkgname>` to build, or run `cd ~/void-packages && ./xbps-src pkg <pkgname>`
- If update: same, plus mention committing after successful build

## Notes

- Always use `${version}` in distfiles URL, never hardcode the version
- For Rust packages: `hostmakedepends="cargo"` is handled by build_style automatically, add `pkg-config` if needed
- For Go packages: add `hostmakedepends="go"` explicitly
- If the repo has no releases (only tags), use the tags API instead: `https://api.github.com/repos/<owner>/<repo>/tags`
- Revision resets to 1 on version bump
