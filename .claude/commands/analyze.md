Call the `analyze_request` tool to validate a development request before implementing it.

Pass $ARGUMENTS as the `request` parameter. If the request is empty, use the user's most recent development request from this conversation.

Also pass `known_context` — a short summary of what is already known from this conversation, the open ticket, or files already read — so the tool does not flag information you already have.

The tool returns missing information classified as CRITICAL / IMPORTANT / OPTIONAL and a READY / PARTIALLY READY / NEED CLARIFICATION verdict. Act on the verdict: implement when READY, state assumptions when PARTIALLY READY, ask one grouped question set when NEED CLARIFICATION.
