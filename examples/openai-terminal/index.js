import { OpenAI } from "openai";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createAgentIAM, definePolicy } from "@agentiam/core";
import { runGuardedTools, resumeGuardedTool } from "@agentiam/openai";
import dotenv from "dotenv";

dotenv.config();

// Make sure you have OPENAI_API_KEY set in your environment
const openai = new OpenAI();

// Define our simple tools
const tools = {
  get_weather: async ({ location }) => {
    return `The weather in ${location} is 72 degrees and sunny.`;
  },
  send_email: async ({ to, subject, body }) => {
    return `Email sent to ${to} with subject "${subject}"`;
  }
};

// Define OpenAI tool definitions
const openaiTools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather in a given location",
      parameters: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email to a recipient",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" }
        },
        required: ["to", "subject", "body"]
      }
    }
  }
];

// Setup AgentIAM
const policy = definePolicy({
  id: "openai-example",
  name: "OpenAI Example Policy",
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

async function runChat() {
  const rl = readline.createInterface({ input, output });
  const messages = [
    { role: "system", content: "You are a helpful assistant with access to tools." }
  ];

  console.log("Chat started! Try asking for the weather, or to send an email.");
  console.log("Type 'exit' to quit.");

  while (true) {
    const userMessage = await rl.question("> ");
    if (userMessage.toLowerCase() === "exit") break;

    messages.push({ role: "user", content: "user_input", content: userMessage });

    let response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: openaiTools
    });

    let message = response.choices[0].message;
    messages.push(message);

    while (message.tool_calls && message.tool_calls.length > 0) {
      console.log(`\nAgent is calling tools...`);
      
      const results = await runGuardedTools({
        iam,
        toolCalls: message.tool_calls,
        tools
      });

      for (const result of results) {
        if (result.status === "executed") {
          console.log(`✅ Tool ${result.toolCallId} executed successfully.`);
          messages.push({
            role: "tool",
            tool_call_id: result.toolCallId,
            content: result.output
          });
        } else if (result.status === "denied") {
          console.log(`❌ Tool ${result.toolCallId} blocked by policy.`);
          messages.push({
            role: "tool",
            tool_call_id: result.toolCallId,
            content: "Action was blocked by policy."
          });
        } else if (result.status === "pending") {
          console.log(`\n⚠️ Tool execution requires your approval!`);
          console.log(`Checkpoint ID: ${result.checkpointId}`);
          
          const answer = await rl.question("Approve? (y/N) ");
          if (answer.toLowerCase() === "y") {
            await iam.checkpoints.approve(result.checkpointId);
            const output = await resumeGuardedTool({
              iam,
              checkpointId: result.checkpointId,
              tools
            });
            console.log(`✅ Tool executed after approval.`);
            messages.push({
              role: "tool",
              tool_call_id: result.toolCallId,
              content: output
            });
          } else {
            await iam.checkpoints.reject(result.checkpointId);
            console.log(`❌ Tool rejected by user.`);
            messages.push({
              role: "tool",
              tool_call_id: result.toolCallId,
              content: "User rejected the action."
            });
          }
        }
      }

      // Continue the conversation with the tool results
      response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools: openaiTools
      });
      message = response.choices[0].message;
      messages.push(message);
    }

    if (message.content) {
      console.log(`\nAgent: ${message.content}\n`);
    }
  }

  rl.close();
}

runChat().catch(console.error);
