---
name: pkg
description: Create or update a void-packages template for a GitHub-hosted package. Fetches latest release, computes checksum, writes the template, prompts to build with vxpm. Use when the user says /pkg <name> <owner/repo> or asks to add/update a void package.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - WebFetch
---

Create or update a void-packages template. Args: `<pkgname> <owner/repo>` (e.g. `/pkg weathr Veirt/weathr`). If only a repo is given, derive `pkgname` from the repo name.

## Steps

### 1. Generated Knowledge dump (read before writing)

Before generating any template, ground yourself in actual local conventions:

```sh
ls ~/void-packages/srcpkgs/<pkgname>/template 2>/dev/null    # updating an existing one?
```

If updating, read the existing template — preserve all fields except `version`, `checksum`, `revision`.

If creating, after detecting build_style (step 4), find 2 reference templates in `~/void-packages/srcpkgs/` that use the same `build_style=` and skim them for: typical `hostmakedepends`, `makedepends`, `depends`, `post_install` patterns. The template you write should match the local style, not generic xbps documentation.

### 2. Fetch release + license metadata

```sh
curl -s https://api.github.com/repos/<owner>/<repo>/releases/latest | jq -r '.tag_name, .published_at'
curl -s https://api.github.com/repos/<owner>/<repo>                 | jq -r '.license.spdx_id, .description'
```

Strip leading `v` from tag → `version`. If no releases exist, fall back to `/tags`.

### 3. Compute checksum

```sh
curl -sL "https://github.com/<owner>/<repo>/archive/<tag>.tar.gz" | sha256sum
```

### 4. Detect build_style

```sh
curl -s "https://api.github.com/repos/<owner>/<repo>/contents" \
  | jq -r '.[].name' | grep -E "Cargo.toml|go.mod|setup.py|pyproject.toml|Makefile|CMakeLists.txt"
```

Map: `Cargo.toml` → `cargo`, `go.mod` → `go`, `setup.py`/`pyproject.toml` → `python3-module` or `python3-pep517`, `Makefile` → `gnu-makefile`, `CMakeLists.txt` → `cmake`.

### 5. Write the template

`~/void-packages/srcpkgs/<pkgname>/template` with:

```
# Template file for '<pkgname>'
pkgname=<pkgname>
version=<from step 2>
revision=1
build_style=<from step 4>
hostmakedepends=<from step 1 references>
makedepends=<from step 1 references>
short_desc="<from step 2 description, ≤72 chars>"
maintainer="ta <ta@localhost>"
license="<spdx_id from step 2>"
homepage="https://github.com/<owner>/<repo>"
distfiles="https://github.com/<owner>/<repo>/archive/v${version}.tar.gz"
checksum=<from step 3>

post_install() {
    vlicense LICENSE
}
```

Always use `${version}` in `distfiles`, never hardcode. On version-bump updates: reset `revision=1`.

### 6. Show + next step

Print the final template. Then tell the user: build with `cd ~/void-packages && ./xbps-src pkg <pkgname>` (or via vxpm). For updates, mention committing after a successful build.

## Notes

- For Rust: `cargo` build_style handles `hostmakedepends="cargo"` automatically; add `pkg-config` if linking against C libs.
- For Go: add `hostmakedepends="go"` explicitly — not handled by build_style.
- For Python: prefer `python3-pep517` over `python3-module` for modern projects (pyproject.toml with `[build-system]`).
- No `LICENSE` file in repo: skip `post_install`, set `license="custom"` if SPDX is missing.
