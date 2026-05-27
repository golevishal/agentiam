import 'dotenv/config';
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import Anthropic from '@anthropic-ai/sdk';
import { createAgentIAM, definePolicy } from "@agentiam/core";
import { runGuardedTools, resumeGuardedTool } from "@agentiam/anthropic";

// 1. Setup Anthropic
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Please set ANTHROPIC_API_KEY in your environment to run this example.");
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 2. Define our actual tool implementations
const implementations = {
  get_weather: async ({ location }) => {
    return { location, temperature: "72°F", condition: "Sunny" };
  },
  deploy_database: async ({ dbName, environment }) => {
    return { success: true, message: `Database ${dbName} deployed to ${environment}` };
  }
};

// 3. Define the Anthropic tool schemas
const tools = [
  {
    name: "get_weather",
    description: "Get the current weather for a location",
    input_schema: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"]
    }
  },
  {
    name: "deploy_database",
    description: "Deploy a new database instance",
    input_schema: {
      type: "object",
      properties: { 
        dbName: { type: "string" },
        environment: { type: "string", enum: ["dev", "production"] }
      },
      required: ["dbName", "environment"]
    }
  }
];

// 4. Setup AgentIAM with our Policy
const policy = definePolicy({
  rules: [
    {
      id: "allow-weather",
      when: { action: "get_weather" },
      decision: "allow"
    },
    {
      id: "approve-prod-deploy",
      when: { action: "deploy_database", input: { environment: "production" } },
      decision: "approval_required"
    }
  ],
  defaultDecision: "deny"
});

const iam = createAgentIAM({ policy });

async function chat() {
  const rl = readline.createInterface({ input, output });

  console.log("Turn 1: User asks question");
  console.log("User: Please get the weather in NYC and deploy the customer_db to production.\n");
  
  const conversationHistory = [
    { role: 'user', content: 'Please get the weather in NYC and deploy the customer_db to production.' }
  ];

  console.log("Turn 2: Requesting Claude's response...");
  const response1 = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    tools,
    messages: conversationHistory,
  });

  conversationHistory.push({ role: 'assistant', content: response1.content });

  if (response1.stop_reason === 'tool_use') {
    const toolCalls = response1.content.filter(block => block.type === 'tool_use');
    console.log(`\nClaude requested ${toolCalls.length} tools. Evaluating with AgentIAM...\n`);

    // Turn 3: Guard the tool execution
    const results = await runGuardedTools({
      iam,
      toolCalls,
      tools: implementations,
      actor: { id: "anthropic-bot" }
    });

    const toolResultBlocks = [];

    for (const result of results) {
      if (result.status === "executed") {
        console.log(`✅ Tool '${toolCalls.find(t => t.id === result.tool_use_id).name}' executed automatically.`);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: result.tool_use_id,
          content: JSON.stringify(result.output)
        });
      } else if (result.status === "pending") {
        // Turn 4: Checkpoint paused execution!
        const toolName = toolCalls.find(t => t.id === result.tool_use_id).name;
        console.log(`\n⚠️ Tool '${toolName}' requires human approval!`);
        console.log(`Checkpoint ID: ${result.checkpointId}`);

        // Turn 5: Ask for approval
        const answer = await rl.question("\nTurn 4: Approve this deployment? (y/N) ");
        
        if (answer.toLowerCase() === "y") {
          console.log("\nTurn 5: User approved! Resuming checkpoint...");
          await iam.checkpoints.approve(result.checkpointId, { id: "human" });
          
          const resumedOutput = await resumeGuardedTool({
            iam,
            checkpointId: result.checkpointId,
            tools: implementations
          });
          
          console.log(`✅ Resumed Tool '${toolName}' successfully.`);
          
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: JSON.stringify(resumedOutput)
          });
        } else {
          console.log("\n❌ User denied! Rejecting checkpoint...");
          await iam.checkpoints.reject(result.checkpointId, { id: "human" }, "Rejected by user");
          
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: "Execution was denied by a human."
          });
        }
      } else {
        console.log(`❌ Tool '${toolCalls.find(t => t.id === result.tool_use_id).name}' was denied by policy.`);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: result.tool_use_id,
          content: "Execution denied by policy."
        });
      }
    }

    // Turn 6: Return all tool_result blocks to Claude
    console.log("\nTurn 6: Sending tool results back to Claude...");
    conversationHistory.push({ role: 'user', content: toolResultBlocks });

    const finalResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      tools,
      messages: conversationHistory,
    });

    console.log("\nClaude's Final Answer:");
    console.log(finalResponse.content[0].text);
  }

  rl.close();
}

chat().catch(console.error);
