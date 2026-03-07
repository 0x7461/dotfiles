---
name: tts-test
description: Test a TTS engine by synthesizing sample text and playing it. Supports pocket-tts, piper, kokoro, and espeak-ng. Use when comparing voices or testing TTS setup.
user-invocable: true
allowed-tools:
  - Bash
---

Test a TTS engine by synthesizing sample text and playing it via PipeWire.

Usage:
- `/tts-test` — test pocket-tts (default) with a standard phrase
- `/tts-test pocket` — pocket-tts (alba voice)
- `/tts-test piper` — piper with ryan voice
- `/tts-test kokoro` — kokoro-82M with af_sky voice
- `/tts-test espeak` — espeak-ng (baseline comparison)
- `/tts-test pocket "custom text here"` — custom text

Default test phrase: "The quick brown fox jumps over the lazy dog. This is a test of the text to speech system."

## Engines

### pocket-tts (default)

Requires daemon running at `http://localhost:8000`.

```sh
# Check daemon
curl -s http://localhost:8000/health 2>/dev/null || echo "daemon not running"

# Synthesize and play
curl -s -X POST http://localhost:8000/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "<text>"}' \
  -o /tmp/tts-test.wav && \
pw-play --volume 2.0 /tmp/tts-test.wav
```

If daemon is not running, start it:
```sh
cd ~/projects/tts-tools && uv run python -m pocket_tts.server &
sleep 3
```

### piper

```sh
# ryan male voice
echo "<text>" | \
  piper --model ~/.local/share/piper/en_US-ryan-high.onnx --output-raw | \
  pw-play --rate=22050 --channels=1 --format=s16 -
```

### kokoro

```sh
cd ~/projects/tts-tools
echo "<text>" | uv run python -c "
import sys, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro('kokoro-v0_19.onnx', 'voices.bin')
audio, sr = k.create(sys.stdin.read().strip(), voice='af_sky', speed=1.0, lang='en-us')
sf.write('/tmp/tts-test.wav', audio, sr)
"
pw-play /tmp/tts-test.wav
```

### espeak-ng (baseline)

```sh
espeak-ng -s 150 "<text>" --stdout | pw-play --rate=22050 --channels=1 --format=s16 -
```

## After playing

Report:
- Which engine was used
- Approximate synthesis time
- Any errors encountered
- Remind user of quality ranking: espeak-ng << Piper (ryan) < Kokoro-82M < pocket-tts (alba)
