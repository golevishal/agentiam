# MCP Gives AI Agents 1000 Tools. Who Decides Which Ones They Can Use?

*Why I built AgentIAM — and why this problem is only going to get bigger.*

---

At my day job, we are building something that sounds straightforward on paper: taking internal services and making them available to AI agents through MCP. Hundreds of them. Eventually thousands.

It sounds like plumbing work. Connect service A to agent B. Repeat.

Except the moment you start doing this at scale, a quiet question starts getting louder.

*Which of these services is actually safe to hand an agent?*

Some services are read-only lookups. Some trigger real workflows. Some send external emails. Some modify customer data. Some reach into production systems. Most of them have documentation written for humans who already have the context — not for an AI agent operating autonomously at 3am.

And here is the uncomfortable part: when an agent calls a tool, there is no moment of pause. No "are you sure?" No policy check. No audit trail. The action just happens.

That bothered me enough that I couldn't stop thinking about it.

---

## The Gap Nobody Is Filling

We have spent decades building authorization systems for humans. OAuth, RBAC, IAM policies — all of it assumes a human is eventually in the loop, making a deliberate choice.

Agents do not work that way.

An agent will call 40 tools in 3 seconds while you are still reading its first response. By the time you see the output, things have already happened. Files written. Emails sent. Records updated.

What we need is not smarter agents. We need a control plane that sits between an agent's *intention* and the *execution* of that intention. Something that asks — before anything runs — *should this action happen, based on what we know right now?*

If you have worked with AWS, GCP, or Azure, you already know what this looks like for humans. IAM. Roles, policies, least privilege, audit trails. It is one of the most important primitives in cloud infrastructure.

Nobody has built the equivalent for agents.

That is the idea behind **AgentIAM**.

---

## What It Actually Does

AgentIAM is a small, framework-agnostic library that intercepts tool calls and evaluates them against a policy before anything executes.

```javascript
import { definePolicy, createAgentIAM } from "@agentiam/core";

const iam = createAgentIAM({
  policy: definePolicy({
    rules: [
      { id: "safe", when: { action: "read_logs" }, decision: "allow" },
      { id: "transfer", when: { action: "transfer_money" }, decision: "approval_required" },
      { id: "nuke", when: { action: "delete_database", context: { env: "prod" } }, decision: "deny" }
    ]
  })
});

const result = await iam.guard(
  { actor: { type: "agent", id: "bot1" }, action: { name: "transfer_money", input: { amount: 5000 } } },
  async () => myBankAPI.transfer(5000)
);

console.log(result.executed);       // false — paused for approval
console.log(result.checkpoint.id);  // "chk_abc123..." — resumable when approved
```

The gate evaluates every tool call and returns one of four decisions:

- **allow** — execute immediately
- **approval_required** — pause, create a checkpoint, wait for a human
- **clarification_required** — the agent needs to provide more context first
- **deny** — hard block, never executes

No execution happens until the policy says so. The agent proposes. The policy decides.

---

## Why MCP Makes This Urgent

MCP is quickly becoming the standard wiring layer between AI agents and external services. That is genuinely a good thing — interoperability matters, and a common protocol means agents can compose tools from many providers.

But it also means agents are about to have access to far more tools, from far more services, with far less oversight than before.

Every new MCP server is a new surface area. Every tool call is an action with real-world consequences. And right now, nothing governs which of those actions an agent is actually authorized to take.

AgentIAM is my attempt to build that authorization layer in the open — generic enough to sit on top of any agentic framework, simple enough to adopt in an afternoon.

---

## LangGraph Integration

If you use LangGraph, the integration is a single drop-in replacement for your `ToolNode`:

```javascript
import { createGuardedToolNode } from "@agentiam/langgraph";

const guardedTools = createGuardedToolNode({
  tools: myTools,
  iam,
  mapToolCall: (toolCall, state) => ({
    actor: { type: "agent", id: state.agentId },
    action: { name: toolCall.name, input: toolCall.args }
  })
});
```

When a tool call requires approval, AgentIAM automatically converts the checkpoint into a LangGraph `interrupt()`. The graph pauses. A human approves. The graph resumes. Exactly the human-in-the-loop pattern LangGraph was designed for — now policy-governed.

---

## This Is Day One

I am building this in one hour a day, after dinner. It is my first serious open source contribution.

The core is working. The LangGraph adapter is live. Postgres persistence is available for production deployments. But there is a lot more to build — SQLite for lightweight local use, adapters for the OpenAI Agents SDK and Vercel AI SDK, better policy validation errors, and eventually a small approval UI.

If you are building with agents and this problem sounds familiar — I would genuinely love your input.

- ⭐ Star the repo: [github.com/golevishal/agentiam](https://github.com/golevishal/agentiam)
- 🐛 Pick up a good first issue and contribute
- 💬 Open a discussion — tell me what your "thousand services" looks like

The ecosystem is moving fast. Let's make sure authorization keeps up.

---

*AgentIAM is MIT licensed and available now on npm as `@agentiam/core`.*
