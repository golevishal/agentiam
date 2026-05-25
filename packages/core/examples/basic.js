import { createAgentIAM } from "../src/index.js";

const iam = createAgentIAM();

const decision = await iam.evaluate({
  actor: {
    type: "agent",
    id: "support-agent",
    userId: "user_123"
  },
  action: {
    name: "send_email",
    description: "Send renewal follow-up to customer",
    input: {
      to: "alex@acme.com",
      subject: "Renewal terms",
      body: "Following up on the renewal terms we discussed."
    }
  },
  context: {
    environment: "production",
    surface: "support_dashboard",
    customerTier: "enterprise",
    dataClasses: ["customer_data", "commercial_terms"]
  },
  model: {
    provider: "openai",
    model: "gpt-5.2",
    confidence: 0.74
  },
  evidence: [
    {
      type: "user_instruction",
      text: "Follow up with Acme about renewal terms."
    }
  ]
});

console.log(JSON.stringify(decision, null, 2));
console.log(JSON.stringify(iam.getAuditLog(), null, 2));
