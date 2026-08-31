Call the `pre_pr_check` tool with `pr_url` set to the pull request link in: $ARGUMENTS

The tool verifies the PR belongs to the repository the user is currently in. If it does not, it returns a message saying so — relay that and stop; do not attempt to review a PR from another project.

If no link was given, ask for one.

Present the tool's four sections in the order it returns them — mergeable, risk, features impacted, conflicts. Do not invent risk drivers that are not in the tool's output.
