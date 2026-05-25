import { randomUUID } from "node:crypto";
import { InMemoryCheckpointStore, isExpired } from "./checkpoints.js";

const DECISION_PRIORITY = {
  allow: 0,
  approval_required: 1,
  clarification_required: 2,
  deny: 3
};

const RISK_PRIORITY = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

const DEFAULT_POLICY = {
  id: "default-conservative",
  version: "0.1.0",
  defaultDecision: "approval_required",
  defaultRisk: "medium",
  defaultRequirements: ["human_approval"],
  rules: [
    {
      id: "allow-read-only-actions",
      description: "Read-only actions can run without approval.",
      when: { action: ["read_*", "search_*", "list_*"] },
      decision: "allow",
      risk: "low"
    },
    {
      id: "review-external-email",
      description: "External email requires human review.",
      when: {
        action: "send_email",
        input: { to: { externalEmail: true } }
      },
      decision: "approval_required",
      risk: "medium",
      requirements: ["preview", "human_approval"]
    },
    {
      id: "review-low-confidence",
      description: "Low-confidence actions require clarification or approval.",
      when: { model: { confidence: { lt: 0.8 } } },
      decision: "clarification_required",
      risk: "medium",
      requirements: ["explain_uncertainty"]
    },
    {
      id: "block-production-delete",
      description: "Production deletes are blocked by default.",
      when: {
        action: "delete_*",
        context: { environment: "production" }
      },
      decision: "deny",
      risk: "critical",
      requirements: ["policy_exception"]
    }
  ]
};

export function createAgentIAM(options = {}) {
  const policy = normalizePolicy(options.policy ?? DEFAULT_POLICY);
  const auditLog = [];
  const checkpointStore = options.checkpointStore ?? new InMemoryCheckpointStore();
  const defaultExpirationMs = options.checkpointExpirationMs ?? 24 * 60 * 60 * 1000;
  const auditSink = options.auditSink;

  async function emitAudit(record) {
    if (auditSink) {
      await auditSink(structuredClone(record));
    }
  }

  async function evaluate(request) {
    assertRequest(request);

    const matchedRules = policy.rules.filter((rule) => matchesWhen(rule.when, request));
    const decision = resolveDecision(policy, matchedRules);
    const risk = resolveRisk(policy, matchedRules);
    const requirements = matchedRules.length > 0
      ? unique(matchedRules.flatMap((rule) => rule.requirements ?? []))
      : policy.defaultRequirements;
    const reasons = matchedRules.map((rule) => ({
      code: rule.id,
      message: rule.description ?? `Matched policy rule: ${rule.id}`
    }));

    if (reasons.length === 0) {
      reasons.push({
        code: "default_policy",
        message: `No rules matched; using default decision '${policy.defaultDecision}'.`
      });
    }

    const now = new Date().toISOString();
    const result = {
      id: `dec_${randomUUID()}`,
      timestamp: now,
      policyId: policy.id,
      policyVersion: policy.version,
      decision,
      risk,
      reasons,
      requirements,
      matchedRules: matchedRules.map((rule) => rule.id),
      audit: {
        required: decision !== "allow" || risk !== "low",
        recordId: `aud_${randomUUID()}`
      }
    };

    await recordAudit({
      id: result.audit.recordId,
      decisionId: result.id,
      timestamp: now,
      policyId: policy.id,
      policyVersion: policy.version,
      actor: request.actor,
      action: request.action,
      resource: request.resource,
      context: request.context,
      decision,
      risk,
      matchedRules: result.matchedRules,
      requirements,
      approvedBy: null,
      executedAt: null,
      outcome: "evaluated"
    });

    return result;
  }

  async function guard(request, execute, options = {}) {
    if (typeof execute !== "function") {
      throw new TypeError("guard(request, execute) requires an execute function.");
    }

    if (options.resumeCheckpointId) {
      const cp = await getCheckpoint(options.resumeCheckpointId);
      if (cp) {
        if (!deepEqual(request, cp.request)) {
          return {
            executed: false,
            decision: cp.decision,
            checkpoint: cp,
            reason: "Resume request does not match the original checkpoint request."
          };
        }

        if (cp.status === "approved") {
          if (cp.decision.decision === "clarification_required" && cp.resumePayload === undefined) {
            return {
              executed: false,
              decision: cp.decision,
              checkpoint: cp,
              reason: "Clarification checkpoints cannot be executed directly; they must be resumed with a payload."
            };
          }

          if (cp.resumePayload !== undefined) {
            try {
              await checkpointStore.update(cp.id, { status: "consumed" });
            } catch (e) {
              return {
                executed: false,
                decision: cp.decision,
                checkpoint: cp,
                reason: `Failed to claim checkpoint '${cp.id}' for resumption.`
              };
            }
            await markOutcome(cp.auditRecordId, "resumed");
            return {
              executed: false,
              resumedFromPayload: true,
              decision: cp.decision,
              value: cp.resumePayload
            };
          } else {
            try {
              await checkpointStore.update(cp.id, { status: "consumed" });
            } catch (e) {
              return {
                executed: false,
                decision: cp.decision,
                checkpoint: cp,
                reason: `Failed to claim checkpoint '${cp.id}' for execution.`
              };
            }
            const value = await execute();
            await markOutcome(cp.auditRecordId, "executed");
            return {
              executed: true,
              decision: cp.decision,
              value
            };
          }
        }
        return {
          executed: false,
          decision: cp.decision,
          checkpoint: cp,
          reason: `Execution skipped because checkpoint '${options.resumeCheckpointId}' is '${cp.status}'.`
        };
      }
    }

    const decision = await evaluate(request);
    const createCheckpoint = options.createCheckpoint ?? true;

    if (decision.decision !== "allow") {
      const checkpoint = (decision.decision === "approval_required" || decision.decision === "clarification_required") && createCheckpoint
        ? await createCheckpointRecord({ request, decision })
        : null;

      return {
        executed: false,
        decision,
        checkpoint,
        reason: `Execution skipped because policy returned '${decision.decision}'.`
      };
    }

    const value = await execute();
    await markOutcome(decision.audit.recordId, "executed");

    return {
      executed: true,
      decision,
      value
    };
  }

  async function recordAudit(record) {
    auditLog.push(record);
    await emitAudit(record);
  }

  async function markOutcome(recordId, outcome) {
    const record = auditLog.find((item) => item.id === recordId);
    if (record) {
      if (outcome === "executed") {
        record.executedAt = new Date().toISOString();
      }
      record.outcome = outcome;
      await emitAudit(record);
    }
  }

  async function createCheckpointRecord({ request, decision }) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + defaultExpirationMs).toISOString();
    
    const checkpoint = {
      id: `chk_${randomUUID()}`,
      decisionId: decision.id,
      auditRecordId: decision.audit.recordId,
      request,
      decision,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt,
      resolvedAt: null,
      approver: null,
      resolutionReason: null
    };

    await checkpointStore.save(checkpoint);
    return checkpoint;
  }

  async function getCheckpoint(id) {
    const checkpoint = await checkpointStore.get(id);
    if (!checkpoint) return null;

    if (checkpoint.status === "pending" && isExpired(checkpoint)) {
      checkpoint.status = "expired";
      checkpoint.resolvedAt = new Date().toISOString();
      await checkpointStore.update(id, { 
        status: "expired", 
        resolvedAt: checkpoint.resolvedAt 
      });

      const record = auditLog.find((item) => item.id === checkpoint.auditRecordId);
      if (record) {
        record.outcome = "expired";
        await emitAudit(record);
      }
    }

    return checkpoint;
  }

  async function resolveCheckpoint(id, status, resolution) {
    const checkpoint = await getCheckpoint(id);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`);
    }
    if (checkpoint.status !== "pending") {
      throw new Error(`Checkpoint '${id}' is already ${checkpoint.status}.`);
    }

    const updates = {
      status,
      resolvedAt: new Date().toISOString(),
      approver: resolution.approver ?? null,
      resolutionReason: resolution.reason ?? resolution.note ?? null,
      resumePayload: resolution.resumePayload
    };

    const updated = await checkpointStore.update(id, updates);
    if (!updated) {
      throw new Error(`Failed to resolve checkpoint ${id}: update returned null.`);
    }

    const record = auditLog.find((item) => item.id === updated.auditRecordId);
    if (record) {
      record.approvedBy = status === "approved" ? updated.approver?.id ?? null : null;
      record.outcome = status;
      await emitAudit(record);
    }

    return updated;
  }

  return {
    evaluate,
    guard,
    getAuditLog: () => auditLog.slice(),
    checkpoints: {
      create: createCheckpointRecord,
      get: getCheckpoint,
      list: async (filters = {}) => {
        return await checkpointStore.list(filters);
      },
      approve: (id, resolution = {}) => resolveCheckpoint(id, "approved", resolution),
      reject: (id, resolution = {}) => resolveCheckpoint(id, "rejected", resolution)
    },
    policy
  };
}


function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

export function definePolicy(policy) {
  return normalizePolicy(policy);
}

export const conservativePolicy = DEFAULT_POLICY;

function normalizePolicy(policy) {
  if (!policy || typeof policy !== "object") {
    throw new TypeError("Policy must be an object.");
  }

  return {
    id: policy.id ?? "custom-policy",
    version: policy.version ?? "1",
    defaultDecision: policy.defaultDecision ?? "approval_required",
    defaultRisk: policy.defaultRisk ?? "medium",
    defaultRequirements: policy.defaultRequirements ?? ["human_approval"],
    rules: policy.rules ?? []
  };
}

function assertRequest(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("Evaluation request must be an object.");
  }
  if (!request.actor || typeof request.actor !== "object") {
    throw new TypeError("Evaluation request requires actor.");
  }
  if (!request.action || typeof request.action !== "object" || !request.action.name) {
    throw new TypeError("Evaluation request requires action.name.");
  }
}

function resolveDecision(policy, rules) {
  const decisions = rules.map((rule) => rule.decision ?? policy.defaultDecision);
  if (decisions.length === 0) {
    return policy.defaultDecision;
  }

  return decisions.reduce((highest, current) => {
    return DECISION_PRIORITY[current] > DECISION_PRIORITY[highest] ? current : highest;
  }, "allow");
}

function resolveRisk(policy, rules) {
  const risks = rules.map((rule) => rule.risk ?? policy.defaultRisk);
  if (risks.length === 0) {
    return policy.defaultRisk;
  }

  return risks.reduce((highest, current) => {
    return RISK_PRIORITY[current] > RISK_PRIORITY[highest] ? current : highest;
  }, "low");
}

function matchesWhen(when, request) {
  if (!when) {
    return true;
  }

  const checks = [];

  if ("action" in when) {
    checks.push(matchesAction(when.action, request.action.name));
  }
  if ("actor" in when) {
    checks.push(matchesObject(when.actor, request.actor));
  }
  if ("context" in when) {
    checks.push(matchesObject(when.context, request.context ?? {}));
  }
  if ("input" in when) {
    checks.push(matchesObject(when.input, request.action.input ?? {}));
  }
  if ("model" in when) {
    checks.push(matchesObject(when.model, request.model ?? {}));
  }
  if ("resource" in when) {
    checks.push(matchesObject(when.resource, request.resource ?? {}));
  }
  if ("evidence" in when) {
    checks.push(matchesEvidence(when.evidence, request.evidence ?? []));
  }

  return checks.every(Boolean);
}

function matchesAction(patterns, actionName) {
  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  return patternList.some((pattern) => wildcardMatch(String(pattern), actionName));
}

function matchesObject(pattern, value) {
  return Object.entries(pattern).every(([key, expected]) => {
    return matchesValue(expected, value?.[key]);
  });
}

function matchesValue(expected, actual) {
  if (isOperatorObject(expected)) {
    return matchesOperators(expected, actual);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      return false;
    }

    return expected.every((item, index) => matchesValue(item, actual[index]));
  }

  if (expected && typeof expected === "object") {
    return matchesObject(expected, actual ?? {});
  }

  if (typeof expected === "string" && expected.includes("*")) {
    return wildcardMatch(expected, String(actual));
  }

  return Object.is(expected, actual);
}

function matchesEvidence(pattern, evidenceItems) {
  if (!pattern || typeof pattern !== "object") {
    return false;
  }

  const checks = [];

  if ("count" in pattern) {
    checks.push(matchesValue(pattern.count, evidenceItems.length));
  }

  if ("any" in pattern) {
    checks.push(evidenceItems.some((item) => matchesObject(pattern.any, item)));
  }

  if ("all" in pattern) {
    checks.push(Array.isArray(pattern.all) && pattern.all.every((matcher) => {
      return evidenceItems.some((item) => matchesObject(matcher, item));
    }));
  }

  if (checks.length === 0) {
    checks.push(evidenceItems.some((item) => matchesObject(pattern, item)));
  }

  return checks.every(Boolean);
}

function isOperatorObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).some((key) => {
    return ["eq", "neq", "in", "exists", "lt", "lte", "gt", "gte", "contains", "externalEmail"].includes(key);
  });
}

function matchesOperators(operators, actual) {
  return Object.entries(operators).every(([operator, expected]) => {
    if (operator === "eq") return Object.is(actual, expected);
    if (operator === "neq") return !Object.is(actual, expected);
    if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
    if (operator === "exists") return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null;
    if (operator === "lt") return Number(actual) < expected;
    if (operator === "lte") return Number(actual) <= expected;
    if (operator === "gt") return Number(actual) > expected;
    if (operator === "gte") return Number(actual) >= expected;
    if (operator === "contains") return Array.isArray(actual) ? actual.includes(expected) : String(actual).includes(String(expected));
    if (operator === "externalEmail") return expected ? isExternalEmail(actual) : !isExternalEmail(actual);
    return false;
  });
}

function wildcardMatch(pattern, value) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function isExternalEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) {
    return false;
  }

  const domain = value.split("@").at(-1).toLowerCase();
  return !["localhost", "example.com", "internal.local", "company.com"].includes(domain);
}

function unique(items) {
  return [...new Set(items)];
}
