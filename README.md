# GiuseCoder

GiuseCoder is a premium AI copilot VS Code extension with multi-agent orchestration.

## Features

- **Multi-Agent Orchestration** — Haiku triage → Opus plan → Sonnet design + Codex code → Opus review
- **Neuro dark-first design system** with pipeline progress visualization
- **Streaming chat sidebar** with real-time token updates
- **Inline tab completion** powered by Claude Haiku
- **Slash commands** and **@context mentions**
- **Syntax-highlighted code blocks** with diff/apply workflow
- **Built-in settings panel** — configure API keys and orchestrator directly from the UI

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Press `F5` to run the extension in a development host.
3. Click the ⚙️ gear icon in the sidebar header to open Settings.
4. Enter your API keys:
   - **Anthropic API Key** (required) — for Haiku, Sonnet, Opus
   - **OpenAI API Key** (optional) — for Codex agent

Alternatively, use the command palette:
- `GiuseCoder: Set Anthropic API Key`
- `GiuseCoder: Set OpenAI API Key`

## Architecture

```
User prompt
  → Haiku (triage/classify)
  → Opus (CTO plan in XML)
  → Sonnet (design) ‖ Codex (code)   ← parallel when enabled
  → Opus (review)
  → Codex (auto-fix if issues found)
```

11 task types are auto-detected: `new_feature`, `bug_fix`, `refactor`, `explain`, `test_generation`, `code_review`, `documentation`, `optimization`, `commit_message`, `quick_question`, `unknown`.

## Configuration

Open the ⚙️ Settings panel or go to `Settings > Extensions > GiuseCoder`:

| Setting | Default | Description |
|---------|---------|-------------|
| `giuseCoder.orchestrator.enabled` | `true` | Enable multi-agent orchestration |
| `giuseCoder.orchestrator.autoReview` | `true` | Opus auto-reviews output |
| `giuseCoder.orchestrator.autoFix` | `true` | Codex auto-fixes review issues |
| `giuseCoder.orchestrator.parallelExecution` | `true` | Design + Code run in parallel |
| `giuseCoder.orchestrator.maxFixRounds` | `1` | Max auto-fix attempts |

## Tech Stack

- **TypeScript** + VS Code Extension API
- **Anthropic SDK** — Claude Haiku 4.5, Sonnet 4, Opus 4.6
- **OpenAI API** — Codex (via native fetch SSE streaming)
- **Webview UI** — Vanilla JS, Codicons, Marked, PrismJS
