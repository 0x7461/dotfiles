---
name: summarize
description: Summarize a URL or local file using the summarize CLI. Inserts compact summary into context. Use when user says /summarize <url> or asks to summarize a link.
user-invocable: true
allowed-tools: Bash
---

Summarize the URL or file path provided by the user.

## Steps

1. Parse the user's argument. Expected forms:
   - `<input>` — URL or path, use the default model.
   - `<input> --model <shorthand>` — override the model (see table below).
   - `<input> --length <s|m|l|xl|xxl>` — override length (default: `long`).
2. Map the shorthand to the actual `--model` value:
   | Shorthand | Maps to | Notes |
   |---|---|---|
   | `flash` (default) | `google/gemini-2.5-flash` | fast, cheap, good-enough for routine summaries |
   | `sonnet` | `cli/claude/sonnet` | highest quality — richer narrative, more terminology, better for content you'll read carefully |
   | `haiku` | `cli/claude/haiku` | uses CC session; rarely the right pick (Sonnet is richer, Flash is cheaper) |
   | `gemma` | `openai/gemma4:e4b` (local Ollama) | free but quality is poor on long content |
3. Run: `summarize "<input>" --plain --length <length> --model <model> 2>&1`
   - For `gemma`, prepend env vars: `OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama summarize ...`
4. Insert the result directly into the conversation as context. One-line header: **Summary: <input>**
5. **Decide whether to upgrade to Sonnet.** Re-read the Flash output through the user's lens. Trigger a Sonnet retry — without asking — when any of these hold:
   - **Shallow:** summary stays at the surface, paraphrases generic claims, omits proper nouns/numbers/quotes that you'd expect from the source length.
   - **Richness matters:** the source is long-form (>20 min video / >5k words), technical, or argument-driven, and the user will likely consume the summary to *understand* (not just triage).
   - **User asked explicitly** (`--model sonnet`, "use sonnet", "give me the rich version").
   When retrying, say one line: *"Flash output felt thin — re-running with Sonnet."* Then run and present the Sonnet output instead.
6. Ask if the user wants a different length or has follow-up questions.

## If the summary is empty or fails

For YouTube specifically, try in order:
1. Force yt-dlp transcript path: add `--youtube yt-dlp`.
2. Bump model: try `--model sonnet` or `--model flash`.
3. As a last resort, fetch the transcript yourself: `yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt -o /tmp/yt <url>`, clean the .vtt to plain text, then summarize the local file.

## Notes

- Reference benchmark — 3-video bake-off, `--length long`, 2026-05-09:

  | Video | Sonnet $ | Haiku $ | Flash $ | Notes |
  |---|---:|---:|---:|---|
  | 40m, TV/film history | 0.103 | 0.091 | 0.009 | Sonnet uniquely added Hobbit + Spider-Verse anecdotes |
  | 13m, fitness rules | 0.070 | 0.026 | 0.006 | Sonnet preserved coach quotes; Flash adequate |
  | 25m, Bitcoin (familiar topic) | 0.082 | 0.034 | 0.011 | Sonnet richest narrative; **Flash uniquely named** SHA256/nonce/blockchain + 2-week difficulty + confirmations |

  Pattern: Sonnet always wins richness; Flash is consistently good-enough + 3-10× cheaper; Haiku never best on either axis. Hence Flash as default + Sonnet as upgrade path.

  Older note (2026-05): Gemini 2.5 Pro empty output, Gemini 2.0 Flash regressed.

- Skill default and global default both use `google/gemini-2.5-flash` (set via `SUMMARIZE_MODEL` in `~/.config/fish/conf.d/tools.fish`).
- API keys: `GEMINI_API_KEY` in `tools.fish`. Anthropic uses the existing Claude Code session via `--cli claude` (no separate `ANTHROPIC_API_KEY` needed).
- Cache: SQLite at `~/.summarize/cache/`. Use `--no-cache` to force re-fetch.
- `--markdown-mode llm` is for *extraction* (paired with `--extract --format md`), not summarization. Do not add it to the summary call.
- Works with URLs, YouTube links, local PDFs, local text files. For files, pass the absolute path.
- **HN 429 workaround:** HN throttles heavily. Fetch metadata + comments via Algolia API instead: `curl -s "https://hn.algolia.com/api/v1/items/<id>"`, then summarize the *linked article* URL separately.
