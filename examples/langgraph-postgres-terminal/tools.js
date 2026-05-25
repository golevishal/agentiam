import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const readLogsTool = tool(
  async ({ limit }) => {
    console.log(`\n[TOOL EXECUTION: read_logs] -> Reading last ${limit} logs...`);
    return `Log 1: System nominal.\nLog 2: CPU at 40%.\nLog 3: Memory at 60%.`;
  },
  {
    name: "read_logs",
    description: "Read recent system logs to diagnose issues.",
    schema: z.object({
      limit: z.number().describe("Number of logs to read.")
    })
  }
);

export const sendEmailTool = tool(
  async ({ to, body }) => {
    // This is a fake tool for the example. It doesn't actually send email.
    console.log(`\n[TOOL EXECUTION: send_email] -> (Fake) Sending email to ${to}: "${body}"`);
    return `Successfully sent email to ${to}.`;
  },
  {
    name: "send_email",
    description: "Send an email to a user. Requires explicit human approval.",
    schema: z.object({
      to: z.string().describe("The email address to send to."),
      body: z.string().describe("The content of the email.")
    })
  }
);

export const dropTablesTool = tool(
  async ({ confirm }) => {
    console.log(`\n[TOOL EXECUTION: drop_tables] -> Dropping tables... (If you see this, the policy failed!)`);
    return `Dropped all tables.`;
  },
  {
    name: "drop_tables",
    description: "Drop all database tables to clear space.",
    schema: z.object({
      confirm: z.boolean().describe("Must be true to confirm dropping tables.")
    })
  }
);

export const allTools = [readLogsTool, sendEmailTool, dropTablesTool];
