# @agentiam/cli

A command-line interface for managing Agent IAM checkpoints and viewing audit logs.

## Installation

```bash
npm install -g @agentiam/cli
```

## Usage

The CLI currently requires a Postgres connection to your Agent IAM database. Set the `DATABASE_URL` environment variable before running commands.

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/agentiam
```

### Commands

**List Pending Checkpoints**
```bash
agentiam checkpoints list
```

**Approve a Checkpoint**
```bash
agentiam checkpoints approve <checkpoint-id> -n "Approval note"
```

**Tail Audit Logs**
```bash
agentiam audit tail -l 20
```

## License
MIT
