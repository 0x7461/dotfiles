---
name: summarize
description: Summarize a URL or local file using local Ollama model (qwen2.5). Inserts compact summary into context. Use when user says /summarize <url> or asks to summarize a link.
user-invocable: true
allowed-tools: Bash
---

Summarize the URL or file path provided by the user.

## Steps

1. Extract the URL or file path from the user'''s message (the argument after /summarize).
2. Run: ```sh
   summarize "<input>" --plain --length medium 2>&1
   ```
3. Insert the result directly into the conversation as context. Do not editorialize — just present the summary with a one-line header: **Summary: <url>**
4. Ask if the user wants a shorter/longer version or has follow-up questions.

## Notes
- Backend: local qwen2.5 via Ollama (no API cost)
- Cache: SQLite at ~/.summarize/cache/ — same URL twice is instant
- For shorter output: --length short (~900 chars)
- For longer output: --length long (~4200 chars)
- Works with URLs, YouTube links, local PDFs, local text files
