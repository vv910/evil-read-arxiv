#!/usr/bin/env python3
"""Install evil-read-arxiv skills for Claude Code and/or Codex."""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path


SKILLS = (
    "start-my-day",
    "paper-analyze",
    "extract-paper-images",
    "paper-search",
    "conf-papers",
)


def default_skills_dir(target: str) -> Path:
    if target == "claude":
        return Path(os.environ.get("CLAUDE_HOME", Path.home() / ".claude")) / "skills"
    if target == "codex":
        return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "skills"
    raise ValueError(f"Unsupported target: {target}")


def install_skill(source_root: Path, destination_root: Path, skill: str, dry_run: bool) -> None:
    source = source_root / skill
    destination = destination_root / skill
    if not (source / "SKILL.md").exists():
        raise FileNotFoundError(f"Missing skill manifest: {source / 'SKILL.md'}")

    print(f"{source} -> {destination}")
    if dry_run:
        return

    destination_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        source,
        destination,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install evil-read-arxiv skills for Claude Code and/or Codex."
    )
    parser.add_argument(
        "--target",
        choices=("claude", "codex", "both"),
        default="both",
        help="Agent runtime to install for.",
    )
    parser.add_argument(
        "--skills",
        nargs="+",
        default=list(SKILLS),
        help="Skill directory names to install. Defaults to all skills.",
    )
    parser.add_argument(
        "--source-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repository root containing skill directories.",
    )
    parser.add_argument(
        "--claude-dir",
        type=Path,
        default=None,
        help="Override Claude Code skills directory.",
    )
    parser.add_argument(
        "--codex-dir",
        type=Path,
        default=None,
        help="Override Codex skills directory.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print copy operations without writing files.",
    )
    args = parser.parse_args()

    unknown = sorted(set(args.skills) - set(SKILLS))
    if unknown:
        raise SystemExit(f"Unknown skills: {', '.join(unknown)}")

    targets = ("claude", "codex") if args.target == "both" else (args.target,)
    destination_roots = {
        "claude": args.claude_dir or default_skills_dir("claude"),
        "codex": args.codex_dir or default_skills_dir("codex"),
    }

    for target in targets:
        print(f"\nInstalling for {target}: {destination_roots[target]}")
        for skill in args.skills:
            install_skill(args.source_root, destination_roots[target], skill, args.dry_run)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
