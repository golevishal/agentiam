import { randomUUID } from "node:crypto";

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
  const checkpointLog = [];
  const auditSink = options.auditSink;

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

    recordAudit({
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

    const decision = await evaluate(request);
    const createCheckpoint = options.createCheckpoint ?? true;

    if (decision.decision !== "allow") {
      const checkpoint = decision.decision === "approval_required" && createCheckpoint
        ? createCheckpointRecord({ request, decision })
        : null;

      return {
        executed: false,
        decision,
        checkpoint,
        reason: `Execution skipped because policy returned '${decision.decision}'.`
      };
    }

    const value = await execute();
    markExecuted(decision.audit.recordId);

    return {
      executed: true,
      decision,
      value
    };
  }

  function recordAudit(record) {
    auditLog.push(record);
    if (auditSink) {
      auditSink(record);
    }
  }

  function markExecuted(recordId) {
    const record = auditLog.find((item) => item.id === recordId);
    if (record) {
      record.executedAt = new Date().toISOString();
      record.outcome = "executed";
    }
  }

  function createCheckpointRecord({ request, decision }) {
    const checkpoint = {
      id: `chk_${randomUUID()}`,
      decisionId: decision.id,
      auditRecordId: decision.audit.recordId,
      request,
      decision,
      status: "pending",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      approver: null,
      resolutionReason: null
    };

    checkpointLog.push(checkpoint);
    return checkpoint;
  }

  function getCheckpoint(id) {
    return checkpointLog.find((checkpoint) => checkpoint.id === id) ?? null;
  }

  function resolveCheckpoint(id, status, resolution) {
    const checkpoint = getCheckpoint(id);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`);
    }
    if (checkpoint.status !== "pending") {
      throw new Error(`Checkpoint '${id}' is already ${checkpoint.status}.`);
    }

    checkpoint.status = status;
    checkpoint.resolvedAt = new Date().toISOString();
    checkpoint.approver = resolution.approver ?? null;
    checkpoint.resolutionReason = resolution.reason ?? resolution.note ?? null;

    const record = auditLog.find((item) => item.id === checkpoint.auditRecordId);
    if (record) {
      record.approvedBy = status === "approved" ? checkpoint.approver?.id ?? null : null;
      record.outcome = status;
    }

    return checkpoint;
  }

  return {
    evaluate,
    guard,
    getAuditLog: () => auditLog.slice(),
    checkpoints: {
      create: createCheckpointRecord,
      get: getCheckpoint,
      list: () => checkpointLog.slice(),
      approve: (id, resolution = {}) => resolveCheckpoint(id, "approved", resolution),
      reject: (id, resolution = {}) => resolveCheckpoint(id, "rejected", resolution)
    },
    policy
  };
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
