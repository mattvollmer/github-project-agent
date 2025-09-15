Prompt Customization

The agent's system prompt now includes:

- Schema overview of field_changes and current_field_values
- Column semantics and example value shapes
- Disambiguation guidance (e.g., status vs state, labels/tags, iteration/sprint)
- Query patterns and safety rules

Runtime Customization Options:

- **PROMPT_USER_LANGUAGE_GUIDE** (env var): Free-form Markdown/text appended to the system prompt. Use this to add org-specific phrasing/synonyms (e.g., "stage" means project Status, "sprint" means Iteration).
- **PROMPT_ADDITIONS_FILE** (env var): Path to a file (Markdown/text) to append to the system prompt at runtime. Useful for larger guides, glossaries, or examples.

Examples:

- Simple inline additions via environment:

```
  export PROMPT_USER_LANGUAGE_GUIDE="""
  Synonyms and org-specific phrasing
  - "stage" → project Status field (SingleSelect)
  - "bucketing" → Labels
  - "ship date" → project Date field named "Target ship"
  """
```

- External file additions:

```
  echo "- 'sprint' → Iteration
  - 'triage' → project field 'Intake state'" > prompts/user-language-guide.md
  export PROMPT_ADDITIONS_FILE=$(pwd)/prompts/user-language-guide.md
```

Notes:

- The prompt is static at startup; **db_schema** can be called during a conversation if the agent needs to refresh details.
- Default lookback for "what's new/changed" is 7 days; LIMIT defaults to 200 and is capped at 2000.
