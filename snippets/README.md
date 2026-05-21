# Snippet Index

These snippets are sanitized n8n Code-node patterns from the internal
reclamation case management dashboard. They are examples of the public
architecture, not raw workflow exports.

## Files

- `slack-payload-parser.js` - parses Slack interaction payloads, checks
  a closed-team allow-list, and normalizes action plus region context.
- `slack-modal-builder.js` - builds a Block Kit search modal and carries
  routing context through `private_metadata`.
- `slack-thread-context-extractor.js` - recovers structured case context
  from a Slack thread before passing it to an LLM assistant.
- `llm-agent-prompt-builder.js` - builds a constrained system prompt for
  German business email drafting.
- `date-range-summary-aggregator.js` - aggregates region worksheet rows
  into a date-range report.

All identifiers, region names, user IDs, workbook references, and
customer fields are generalized for public review.
