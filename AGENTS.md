# evil-read-arxiv Agent Notes

This repository is intended to work with both Claude Code and Codex.

- The reusable paper-reading workflows live in `start-my-day/`, `paper-analyze/`, `extract-paper-images/`, `paper-search/`, and `conf-papers/`. Each directory is a skill with a `SKILL.md` manifest.
- Install skills with `python scripts/install_skills.py --target both`, or choose `--target claude` / `--target codex`.
- When following a skill command block, set `OBSIDIAN_VAULT_PATH` to the target Obsidian vault. If the agent runtime has not set `SKILL_DIR`, set it to the current skill directory before running commands that reference it.
- The Web app AI provider is configured in `data/api_settings.json` or `/settings`. `provider: "claude"` uses Anthropic Claude, `provider: "codex"` uses the OpenAI-compatible API path, and `provider: "codex-cli"` shells out to the locally logged-in Codex CLI.
