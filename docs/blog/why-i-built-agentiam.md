# Why I Built Agent IAM

*A story about 1000 services, zero safety guarantees, and a question I couldn't shake.*

At my day job, we're doing something that sounds straightforward: taking internal services and making them available to AI agents through MCP. Hundreds of them. Eventually thousands.

It sounds like plumbing work. Connect service A to agent B. Done.

Except it isn't.

The moment you start doing this at scale, a quiet question starts getting louder: **which of these services is actually safe to hand to an agent?**

Some services are read-only. Some trigger real workflows. Some send emails. Some modify customer data. Some touch production systems. Most of them have sparse documentation, written for humans who already know the context — not for an AI agent that doesn't.

And here's the thing nobody talks about: when an agent calls a tool, there is no moment of pause. No "are you sure?" No policy check. No audit trail. The action just happens.

That bothered me.

## The gap nobody is filling

We've spent decades building authorization systems for humans. OAuth, RBAC, IAM policies — all of it assumes a human is eventually in the loop, making a choice.

Agents don't work that way. An agent will call 40 tools in 3 seconds while you're reading its first response. By the time you see the output, things have already happened.

What we need isn't more powerful agents. We need a control plane that sits between an agent's intention and the execution of that intention. Something that asks: **should this action happen, based on what we know right now?**

That's the idea behind Agent IAM.

## What it actually does

Agent IAM is a small, framework-agnostic library that intercepts tool calls and evaluates them against a policy before anything executes.

```javascript
const iam = createAgentIAM({ policy });

const result = await iam.guard(
  { action: { name: "send_email", input: { to: "customer@example.com" } } },
  () => sendEmail(...)
);
```

The guard looks at the action, the context, and any evidence the agent provides, then returns one of four decisions: **allow**, **approval required**, **clarification required**, or **deny**.

No execution happens until the guard says so.

It's not trying to be smarter than your agent. It's the moment of pause that agents currently don't have.

## Why now

MCP is becoming the standard wiring layer between agents and services. That's a good thing — interoperability matters. But it also means agents are about to have access to far more tools, from far more services, with far less oversight.

The ecosystem needs an authorization layer before that becomes a problem at scale.

Agent IAM is my attempt to build that layer in the open — generic enough to sit on top of any agentic framework, simple enough to adopt in an afternoon.

## This is day one

I'm building this in 1 hour a day. It's my first serious open source contribution. The core evaluator works. The adapters are next. Policy packs after that.

If you're building with agents and this problem sounds familiar — I'd genuinely love your input. Open an issue. Tell me what your "1000 services" looks like.

→ [github.com/golevishal/agentiam](https://github.com/golevishal/agentiam)
