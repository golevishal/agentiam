import assert from "node:assert";
import test from "node:test";
import { createAgentIAM } from "../src/index.js";

test("guard resumes execution with provided payload if checkpoint is approved", async () => {
  const iam = createAgentIAM();
  const request = {
    actor: { type: "agent", id: "test" },
    action: { name: "send_email", input: { to: { externalEmail: true } } }
  };

  const initial = await iam.guard(request, () => "should not run");
  assert.equal(initial.executed, false);
  const cpId = initial.checkpoint.id;

  await iam.checkpoints.approve(cpId, {
    resumePayload: "overridden-response"
  });

  const resumed = await iam.guard(request, () => "should not run", {
    resumeCheckpointId: cpId
  });

  assert.equal(resumed.executed, false);
  assert.equal(resumed.resumedFromPayload, true);
  assert.equal(resumed.value, "overridden-response");
});

test("guard runs execute() if approved checkpoint has no resumePayload", async () => {
  const iam = createAgentIAM();
  const request = {
    actor: { type: "agent", id: "test" },
    action: { name: "send_email", input: { to: { externalEmail: true } } }
  };

  const initial = await iam.guard(request, () => "should not run");
  const cpId = initial.checkpoint.id;

  await iam.checkpoints.approve(cpId, {
    note: "looks good"
  });

  const resumed = await iam.guard(request, () => "real-execution-happened", {
    resumeCheckpointId: cpId
  });

  assert.equal(resumed.executed, true);
  assert.equal(resumed.value, "real-execution-happened");
});

test("guard skips execution and returns pending if checkpoint is still pending", async () => {
  const iam = createAgentIAM();
  const request = {
    actor: { type: "agent", id: "test" },
    action: { name: "send_email", input: { to: { externalEmail: true } } }
  };

  const initial = await iam.guard(request, () => "should not run");
  const cpId = initial.checkpoint.id;

  const resumed = await iam.guard(request, () => "should not run", {
    resumeCheckpointId: cpId
  });

  assert.equal(resumed.executed, false);
  assert.equal(resumed.checkpoint.status, "pending");
});

test("guard skips execution if checkpoint is rejected", async () => {
  const iam = createAgentIAM();
  const request = {
    actor: { type: "agent", id: "test" },
    action: { name: "send_email", input: { to: { externalEmail: true } } }
  };

  const initial = await iam.guard(request, () => "should not run");
  const cpId = initial.checkpoint.id;

  await iam.checkpoints.reject(cpId);

  const resumed = await iam.guard(request, () => "should not run", {
    resumeCheckpointId: cpId
  });

  assert.equal(resumed.executed, false);
  assert.equal(resumed.checkpoint.status, "rejected");
});

test("guard fails closed if resume request does not match checkpoint request", async () => {
  const iam = createAgentIAM();
  const request = {
    actor: { type: "agent", id: "test" },
    action: { name: "send_email", input: { to: { externalEmail: true } } }
  };

  const initial = await iam.guard(request, () => "should not run");
  const cpId = initial.checkpoint.id;
  await iam.checkpoints.approve(cpId);

  const mismatchedRequest = {
    ...request,
    action: { name: "delete_customer_record" }
  };

  const resumed = await iam.guard(mismatchedRequest, () => "should not run", {
    resumeCheckpointId: cpId
  });

  assert.equal(resumed.executed, false);
  assert.equal(resumed.reason, "Resume request does not match the original checkpoint request.");
});

test("guard fails closed on replay of consumed checkpoints", async () => {
  const iam = createAgentIAM();
  const request = {
    actor: { type: "agent", id: "test" },
    action: { name: "send_email", input: { to: { externalEmail: true } } }
  };

  const initial = await iam.guard(request, () => "should not run");
  const cpId = initial.checkpoint.id;
  await iam.checkpoints.approve(cpId);

  // First resume works
  const resumed1 = await iam.guard(request, () => "executed once", {
    resumeCheckpointId: cpId
  });
  assert.equal(resumed1.executed, true);

  // Checkpoint is now consumed
  const cp = await iam.checkpoints.get(cpId);
  assert.equal(cp.status, "consumed");

  // Second resume fails
  const resumed2 = await iam.guard(request, () => "executed twice", {
    resumeCheckpointId: cpId
  });
  assert.equal(resumed2.executed, false);
  assert.equal(resumed2.reason, `Execution skipped because checkpoint '${cpId}' is 'consumed'.`);
});
