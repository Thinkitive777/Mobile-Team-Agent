Call the `list_tickets` tool to show the user's open tickets.

If the user provided arguments: $ARGUMENTS — parse them as filters:
- If it looks like a project key (e.g. "CMDN"), pass as `project`
- If it contains "bugs" or "bug", pass `type=Bug`
- If it contains "high priority", pass `priority=High,Highest`
- If it contains "in progress", pass `status=In Progress`
- If it contains "due this week", pass `due_this_week=true`
- Otherwise pass the arguments as a raw query context

If no arguments, call `list_tickets` with no parameters (defaults to current user's open tickets).
