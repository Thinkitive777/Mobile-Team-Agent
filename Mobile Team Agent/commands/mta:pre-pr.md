Call the `pre_pr_check` tool to check whether the current branch is ready to merge.

Arguments: $ARGUMENTS

- First word is the branch to merge INTO — pass as `merge_into`.
- Second word, if given, is the branch being merged — pass as `merge_from`. Omit it to use the branch currently checked out.
- If the user passed a pull request link instead, pass it as `pr_url` and leave the branch arguments empty.
- If no arguments were given at all, ask which branch they want to merge into. Do not guess `main`.

Present the tool's four sections in the order it returns them — mergeable, risk, features impacted, conflicts. Do not reorder, and do not invent risk drivers that are not in the tool's output.
