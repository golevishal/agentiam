export function formatPendingResponse(decision, checkpointId) {
  const message =
    decision === "approval_required"
      ? "This action requires human approval before it can proceed."
      : "This action requires clarification before it can proceed.";

  return JSON.stringify({
    status: decision,
    checkpointId,
    message
  });
}

export function formatDeniedResponse() {
  return JSON.stringify({
    status: "denied",
    message: "This action was blocked by policy."
  });
}
