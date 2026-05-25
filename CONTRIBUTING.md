# Contributing to Agent IAM

Thank you for your interest in contributing to Agent IAM!

## Development Setup

1. Fork the repository and clone it locally.
2. Ensure you have Node.js 18+ installed.
3. Run `npm install` in the root directory. This uses npm workspaces.
4. Run `npm test` to verify all tests pass.

## Submitting Pull Requests

1. **Branching**: Create a new branch for your feature or bugfix (e.g. `feat/new-database-adapter`).
2. **Testing**: All new features must include comprehensive tests utilizing `node:test`. Run the full monorepo suite with `npm test`.
3. **Commit Messages**: We follow conventional commits (e.g., `feat: ...`, `fix: ...`).
4. **Pull Request**: Open a pull request against the `main` branch. Describe the problem your PR solves and how you solved it.

## Adding a New Persistence Adapter

We encourage new persistence adapters! If you build an adapter (e.g., MongoDB, Redis, etc.), place it in a new package under `packages/` following the existing `@agentiam/pg` pattern. Ensure it strictly implements `CheckpointStore` and `AuditSink` and includes a concurrency test.
