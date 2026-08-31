Call the `narrow_code_scope` tool to find the smallest relevant set of files before reading or editing code.

Pass $ARGUMENTS as the `feature` parameter (a feature, module, screen, symbol, or keyword).
- If the arguments contain a path-like extension list (e.g. ".ts,.tsx"), pass it as `extensions`.
- If they contain a number, pass it as `max_files`.

Read only the files the tool returns, starting with the highest-ranked. Stop as soon as the answer is found.
