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
   | `haiku` (default) | `cli/claude/haiku` | best quality/cost balance — uses CC session |
   | `sonnet` | `cli/claude/sonnet` | highest quality, ~2× Haiku cost |
   | `flash` | `google/gemini-2.5-flash` | cheapest paid option, decent quality |
   | `gemma` | `openai/gemma4:e4b` (local Ollama) | free but quality is poor on long content |
3. Run: `summarize "<input>" --plain --length <length> --model <model> 2>&1`
   - For `gemma`, prepend env vars: `OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama summarize ...`
4. Insert the result directly into the conversation as context. One-line header: **Summary: <input>**
5. Ask if the user wants a different length, a different model, or has follow-up questions.

## If the summary is empty or fails

For YouTube specifically, try in order:
1. Force yt-dlp transcript path: add `--youtube yt-dlp`.
2. Bump model: try `--model sonnet` or `--model flash`.
3. As a last resort, fetch the transcript yourself: `yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt -o /tmp/yt <url>`, clean the .vtt to plain text, then summarize the local file.

## Notes

- Reference benchmark (Squary 40-min YT video, `--length long`, May 2026):
  - Sonnet: 27s, $0.095, best quality.
  - Haiku: 17s, $0.041, near-Sonnet quality.
  - Gemini 2.5 Flash: 12s, $0.009, decent.
  - gemma4:e4b: 19s, free, too generic to be useful.
  - Gemini 2.5 Pro: empty output (broken).
  - Gemini 2.0 Flash: empty output (regressed since ~2026-04).
- Global default for direct CLI use is set via `SUMMARIZE_MODEL` in `~/.config/fish/conf.d/tools.fish` (currently `google/gemini-2.5-flash` for cheap unattended runs). The skill overrides to Haiku for interactive use.
- API keys: `GEMINI_API_KEY` in `tools.fish`. Anthropic uses the existing Claude Code session via `--cli claude` (no separate `ANTHROPIC_API_KEY` needed).
- Cache: SQLite at `~/.summarize/cache/`. Use `--no-cache` to force re-fetch.
- `--markdown-mode llm` is for *extraction* (paired with `--extract --format md`), not summarization. Do not add it to the summary call.
- Works with URLs, YouTube links, local PDFs, local text files. For files, pass the absolute path.
