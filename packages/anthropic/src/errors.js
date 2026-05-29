export class ApprovalRequiredError extends Error {
  constructor(checkpointId, toolName) {
    super(
      `Execution of tool '${toolName}' paused. Approval required. Checkpoint ID: ${checkpointId}`
    );
    this.name = "ApprovalRequiredError";
    this.checkpointId = checkpointId;
    this.toolName = toolName;
  }
}

export class ClarificationRequiredError extends Error {
  constructor(checkpointId, toolName) {
    super(
      `Execution of tool '${toolName}' paused. Clarification required. Checkpoint ID: ${checkpointId}`
    );
    this.name = "ClarificationRequiredError";
    this.checkpointId = checkpointId;
    this.toolName = toolName;
  }
}
