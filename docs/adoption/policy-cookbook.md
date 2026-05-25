# Policy Cookbook

Agent IAM policies are evaluated top-down. The first rule whose `when` condition perfectly matches the execution request wins. If no rule matches, the policy defaults to `deny` for safety.

Here are some common patterns for writing policies.

## 1. Environment-Based Restrictions

Allow safe actions in staging, but require approval in production.

```javascript
const policy = definePolicy({
  id: "env-policy",
  rules: [
    {
      id: "allow-staging",
      when: { context: { env: "staging" } },
      decision: "allow"
    },
    {
      id: "require-prod-approval",
      when: { action: "delete_record", context: { env: "prod" } },
      decision: "approval_required",
      requirements: ["manager_approval"]
    }
  ]
});
```

## 2. Numeric and Logical Operators

You can use operators (`gt`, `lt`, `in`, `eq`) to evaluate numbers and arrays.

```javascript
const policy = definePolicy({
  id: "finance-policy",
  rules: [
    {
      id: "auto-approve-small-transfers",
      when: { 
        action: "transfer_funds",
        input: { amount: { lt: 500 } }
      },
      decision: "allow"
    },
    {
      id: "require-approval-large-transfers",
      when: { 
        action: "transfer_funds",
        input: { amount: { gte: 500 } }
      },
      decision: "approval_required",
      requirements: ["finance_team_approval"]
    }
  ]
});
```

## 3. Evidence-Based Verification

If an agent needs to perform a highly sensitive action, you can configure your policy to demand that the request includes specific `evidence` (e.g., an external ticket ID).

```javascript
const policy = definePolicy({
  id: "support-policy",
  rules: [
    {
      id: "require-jira-ticket",
      when: { 
        action: "refund_customer",
        evidence: { type: "jira_ticket" }
      },
      decision: "approval_required"
    },
    {
      id: "clarify-missing-ticket",
      when: { action: "refund_customer" },
      // If the rule above failed because of missing evidence,
      // it falls through to this rule!
      decision: "clarification_required",
      requirements: ["Please provide a valid Jira ticket ID to proceed with the refund."]
    }
  ]
});
```

## 4. Total Deny Lists

Sometimes you just want to completely ban certain tools from being executed under any circumstance.

```javascript
const policy = definePolicy({
  id: "ban-policy",
  rules: [
    {
      id: "ban-shell",
      when: { action: "run_shell_command" },
      decision: "deny"
    },
    {
      id: "ban-drop",
      when: { action: "drop_database" },
      decision: "deny"
    }
  ]
});
```
