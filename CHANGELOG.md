# Changelog

All notable changes to Agent IAM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-25
### Added
- **`@agentiam/core`**: Initial release of the core policy and execution engine.
- Declarative policy matching with logical operators (`and`, `or`, numeric comparisons).
- Support for asynchronous `CheckpointStore` and `AuditSink` interfaces.
- Atomic concurrency safeguards inside the core `guard` block.
- **`@agentiam/langgraph`**: `createGuardedToolNode` adapter mapping IAM checkpoints to LangGraph JS `interrupt()` / `Command` lifecycles.
- **`@agentiam/pg`**: High-concurrency Postgres implementations for checkpoints and audits.
