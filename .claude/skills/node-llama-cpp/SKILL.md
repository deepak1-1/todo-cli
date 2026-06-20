---
name: node-llama-cpp
description: Local GGUF inference via node-llama-cpp. Use when editing src/chat/model.ts, model-finder.ts, prompt.ts, intent.ts. Triggers - LLM call, GBNF/JSON grammar, model download, fallback chain.
---

# Local LLM patterns

## Backend chain
The chat backend tries (in order):
1. The user's installed `claude` CLI (`execFile`) — preferred, low latency, no local weights.
2. Local GGUF via `node-llama-cpp` — only if `claude` is absent or fails.

Do not flip this order. Cloud-first respects user setup; local is the fallback.

## Model storage
- Cached under `~/.todo-cli/models/`.
- Constant `MODEL_URI = 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M'` lives in `src/chat/model.ts`. Bump only when validated end-to-end.
- Download is lazy and only on first local invocation. Never download at CLI start.

## Inference constraints
- `MAX_TOKENS = 2048`. Inputs that risk exceeding context must be truncated server-side in the prompt builder.
- `INFERENCE_TIMEOUT_MS = 30_000`. Wrap in a timeout race; cancel and fall back to a `clarify` intent on timeout.
- Always JSON-schema-constrain output using `intentSchema` from `src/chat/intent.ts`. Free-text generation is a bug — the executor expects an `Intent`.

## Imports
`node-llama-cpp` is `external` in `tsup.config.ts`. Import with `await import('node-llama-cpp')` inside the call site — never top-level. Cold-start cost is real.

## Prompt budget
`buildSystemPrompt()` in `src/chat/prompt.ts` is the single place that assembles context (schema + recent tasks summary). Keep it short. Do not paste full task descriptions; summarize.

## Error surface
- A failed local inference must surface as `{ action: 'clarify', message: '...' }`, never throw out of `executor.ts`.
- Log via `src/utils/logger.ts` at `debug` level; do not write model errors to the user-facing chat unless they're actionable.

## SQL via LLM
The `query` intent may produce a SQL string. **Validate against an allowlist of read-only patterns** before executing. Never `EXEC` arbitrary LLM-generated SQL against the user DB.
