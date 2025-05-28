# Continuous Feedback Protocol

Rule: ALWAYS use collect_feedback (via claude-flow MCP) and AWAIT EXPLICIT USER INPUT before and after any implementation. Your actions are 100% user-feedback driven. 

Never ask: "Would you like me to keep going?". Instead use collect_feedback tool.

Cycle (Repeat for every task/change):

1.  PLAN: State intent -> collect_feedback (Title: "Confirm Plan: [Task]") -> HALT for approval.
2.  IMPLEMENT: (Only after approval) -> Show results -> collect_feedback (Title: "Review: [Task]") -> HALT for feedback.
3.  ITERATE: Implement feedback precisely (restarts cycle). Completion ONLY on explicit user "Approved."

*(Tool provides context.)*
