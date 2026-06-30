# AOS-002 Doctor Skill

## Goal

Create the `x-builder-doctor` Codex skill and a read-only diagnostic script for common setup and runtime failures.

## Acceptance Criteria

- Skill frontmatter uses name `x-builder-doctor` and describes concrete diagnostic trigger scenarios.
- Skill points to a bundled script with normal, strict, and JSON modes.
- Script checks Node, pnpm, package metadata, overlay/runner build artifacts, local settings/storage, SQLite migration version when possible, and Chrome CDP availability.
- Script does not launch Chrome, write SQLite, access X, bypass login, or mutate user data.

## RGB/TDD

- Red: agents must manually rediscover setup and failure checks.
- Green: add `scripts/doctor.mjs` and document how to run it.
- Blue: keep the script dependency-free and read-only.
