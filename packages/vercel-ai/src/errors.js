export class ApprovalRequiredError extends Error {
  constructor(checkpointId, actionName) {
    super(
      `Tool execution blocked. Approval required for action: ${actionName}. Checkpoint ID: ${checkpointId}`
    );
    this.name = "ApprovalRequiredError";
    this.checkpointId = checkpointId;
    this.actionName = actionName;
  }
}

export class ClarificationRequiredError extends Error {
  constructor(checkpointId, actionName) {
    super(
      `Tool execution blocked. Clarification required for action: ${actionName}. Checkpoint ID: ${checkpointId}`
    );
    this.name = "ClarificationRequiredError";
    this.checkpointId = checkpointId;
    this.actionName = actionName;
  }
}
