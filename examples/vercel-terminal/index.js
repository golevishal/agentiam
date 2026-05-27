import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createAgentIAM, definePolicy } from "@agentiam/core";
import { wrapGuardedTools, resumeGuardedTool } from "@agentiam/vercel-ai";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// Define our simple tools using Vercel AI SDK
const tools = {
  get_weather: tool({
    description: "Get the current weather in a given location",
    parameters: z.object({ location: z.string() }),
    execute: async ({ location }) => {
      return `The weather in ${location} is 72 degrees and sunny.`;
    }
  }),
  send_email: tool({
    description: "Send an email to a recipient",
    parameters: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string()
    }),
    execute: async ({ to, subject, body }) => {
      return `Email sent to ${to} with subject "${subject}"`;
    }
  })
};

// Setup AgentIAM
const policy = definePolicy({
  id: "vercel-example",
  name: "Vercel AI Example Policy",
  defaultDecision: "deny",
  rules: [
    {
      id: "allow-weather",
      decision: "allow",
      when: { action: "get_weather" }
    },
    {
      id: "require-approval-email",
      decision: "approval_required",
      when: { action: "send_email" }
    }
  ]
});

const iam = createAgentIAM({ policy });

// Wrap tools with AgentIAM
const guardedTools = wrapGuardedTools({
  tools,
  iam,
  actor: { type: "agent", id: "vercel-cli-bot" }
});

async function runChat() {
  const rl = readline.createInterface({ input, output });
  const messages = [
    { role: "system", content: "You are a helpful assistant with access to tools. If a tool requires approval, ask the user to approve it." }
  ];

  console.log("Chat started! Try asking for the weather, or to send an email.");
  console.log("Type 'exit' to quit.");

  while (true) {
    const userMessage = await rl.question("> ");
    if (userMessage.toLowerCase() === "exit") break;

    messages.push({ role: "user", content: userMessage });

    let response = await generateText({
      model: openai("gpt-4o"),
      messages,
      tools: guardedTools
    });

    messages.push(...response.response.messages);

    // If there were tool calls that require approval, check the results
    if (response.toolResults && response.toolResults.length > 0) {
      for (const result of response.toolResults) {
        if (typeof result.result === "string" && result.result.includes("approval_required")) {
          try {
            const parsed = JSON.parse(result.result);
            if (parsed.status === "approval_required") {
              console.log(`\n⚠️ Tool execution requires your approval!`);
              console.log(`Checkpoint ID: ${parsed.checkpointId}`);
              
              const answer = await rl.question("Approve? (y/N) ");
              if (answer.toLowerCase() === "y") {
                await iam.checkpoints.approve(parsed.checkpointId);
                const output = await resumeGuardedTool({
                  iam,
                  checkpointId: parsed.checkpointId,
                  tools
                });
                console.log(`✅ Tool executed after approval: ${output}`);
                
                // Add the resumed result back into the history for the LLM
                messages.push({
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: result.toolCallId,
                      toolName: result.toolName,
                      result: output
                    }
                  ]
                });
                
                // Fetch the follow-up response
                const followup = await generateText({
                  model: openai("gpt-4o"),
                  messages,
                  tools: guardedTools
                });
                
                messages.push(...followup.response.messages);
                if (followup.text) console.log(`\nAgent: ${followup.text}\n`);
                
              } else {
                await iam.checkpoints.reject(parsed.checkpointId);
                console.log(`❌ Tool rejected by user.`);
                messages.push({
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: result.toolCallId,
                      toolName: result.toolName,
                      result: "User rejected the action."
                    }
                  ]
                });
              }
            }
          } catch (e) {
            // Not JSON or parsing error, ignore
          }
        }
      }
    }

    if (response.text) {
      console.log(`\nAgent: ${response.text}\n`);
    }
  }

  rl.close();
}

runChat().catch(console.error);
