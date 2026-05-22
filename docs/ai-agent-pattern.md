# LLM Agent Pattern, Slack Mention with Thread Context

A focused use of an LLM agent inside an existing operational workflow:
when a team member needs to email a customer about a case, they
`@mention` the bot inside that case's Slack thread. The bot reads the
thread's history, pulls the case data the thread was opened with,
assembles a system prompt, and replies in-thread with an email draft.
The user iterates by replying ("make it shorter", "add a deadline of
next Friday"), and finally types `SEND` (or the localized equivalent)
to dispatch the email via the Outlook tool the agent has access to.

This is **not** an "AI everywhere" pattern. The system has exactly
one agent, used in exactly one situation, with a tight task scope.
Most of the workflow has no LLM.

## Why this scope works

- **Thread context is real context.** The thread is opened by a
  confirmation DM that contains the case's structured data (company,
  customer, address, status, value, etc.). Every subsequent message
  in the thread is about *this case*. The agent doesn't have to ask
  "which customer?", the case data is right there in the first
  message of the thread.
- **The agent has one tool.** It can call the Outlook send-email
  endpoint. It cannot do anything else. This dramatically narrows
  what can go wrong. No "the agent went off and queried the database
  six times", there's no database tool to query.
- **The user is the gate.** The agent drafts; the user reviews; the
  user types `SEND`. No autonomous email sending. The agent's
  `tools` permission to call Outlook is conditional in the system
  prompt: "only send when the user types `SEND`".
- **The output goes back to the same thread.** No new channels, no
  DMs to confused users. The conversation stays where it started.

---

## The flow

```
1. User opens a case via "New" → confirmation DM lands in #ops
   (the bot's confirmation includes the case data as a structured
   JSON object embedded in a context block at the bottom of the DM)

2. User replies in-thread:
       @bot draft an email to ask if they have insurance docs

3. Workflow trigger: Slack app_mention event in a thread

4. Workflow:
   a. Reads thread history via conversations.replies
   b. Extracts the case JSON from the first message's context block
      (see snippets/slack-thread-context-extractor.js)
   c. Builds a system prompt with:
        - the case fields,
        - the thread's prior messages as conversation history,
        - explicit rules ("draft in German", "ask for recipient if
          unknown", "send only when user types SEND")
   d. Calls Azure OpenAI with the prompt + the user's mention text
   e. Posts the LLM's reply back into the thread

5. User iterates ("make it more formal" / "add Tuesday deadline")
  , the loop runs again, with the new message in the history.

6. User finally types SEND.
   The agent receives "SEND", reads the system prompt's instruction
   that this is the trigger to send, calls the Outlook tool with the
   most recent draft, and confirms in-thread.
```

---

## System-prompt construction

The system prompt is rebuilt fresh on every invocation. There's no
persistent agent memory; everything the agent needs is in the prompt.
Construction:

```js
const systemPrompt =
  "You are an email-drafting assistant for a German operations team.\n" +
  "You help the user write professional German business emails about a case.\n\n" +
  "Case data:\n" +
  `- Company: ${case.company}\n` +
  `- Customer name: ${case.customerName}\n` +
  `- Address: ${case.address}\n` +
  `- Phone: ${case.phone}\n` +
  `- Status: ${case.status}\n` +
  `- Priority: ${case.priority}\n` +
  `- Reported on: ${case.reportedOn}\n` +
  `- Notes: ${case.notes}\n\n` +
  "Rules:\n" +
  "1. Reply in German.\n" +
  "2. Formal tone.\n" +
  "3. Every email needs: subject, salutation, body, sign-off.\n" +
  "4. Sender is always: [Company Name] | ops@example.com\n" +
  "5. If the recipient email address isn't known, ASK FIRST.\n" +
  "   Don't draft without knowing where it's going.\n" +
  "6. When the user types SEND, dispatch via the Outlook tool.\n" +
  "7. After sending, confirm: '✅ Email sent to <recipient>'.\n" +
  "8. If sending fails, report it: '❌ Send failed: <reason>'.\n\n" +
  "Conversation history follows.\n" +
  historyText;
```

See [`snippets/llm-agent-prompt-builder.js`](../snippets/llm-agent-prompt-builder.js)
for the full implementation including field sanitization.

A few things worth noting:

**Customer fields go through a `sanitize()` helper.** Empty, `null`,
or placeholder values (`-`) become `` in the prompt rather than
literal `null`. The agent reads "Phone:" and understands that's a
missing value; it would have read "Phone: null" as a real value
otherwise.

**The conversation history is in the system prompt, not as separate
chat-history messages.** This is a deliberate choice for this
particular use of the Azure OpenAI Chat completion shape: it lets the
agent see the *entire* prior conversation as fixed context, with the
user's latest mention as the only `user` message. It simplifies the
chat shape (always: one system message, one user message) at the
small cost of slightly larger prompts.

**The tool binding is inside the n8n agent node.** The agent node has
one tool: a Microsoft Outlook send-mail tool. The agent decides when
to call it; n8n executes the call. The system prompt's `SEND` rule
is the only thing telling the agent when to use the tool, there's
no explicit conditional in the workflow forcing the call.

---

## Failure modes

| Failure | Cause | Mitigation |
|---|---|---|
| Agent drafts an email without an address | The case has no recipient address and the thread hasn't surfaced one | Rule 5 in the system prompt, "ASK FIRST". The agent should ask. If it skips this, treat it as a prompt-engineering bug and tighten rule 5. |
| Agent sends prematurely | User typed something the agent interpreted as `SEND` | Make the trigger word case-sensitive and specific (e.g. `ABSENDEN` or `/SEND` rather than the English word `send`, which will appear in normal conversation) |
| Agent hallucinates a customer field | A case field was missing from the system prompt | Verify the prompt-builder includes every field the agent might need. Use a sanitize default of `` rather than empty string so the agent visibly sees what's missing. |
| Agent goes silent | API timeout or rate limit | Surface the error to the thread directly: "❌ Drafting failed: <error>". Don't fail silently. |
| User leaves the thread mid-draft | Thread becomes stale | This is fine, the case data persists in Excel. When the user comes back, they can `@mention` again and the agent rebuilds context from scratch. No per-thread state to clean up. |

---

## What this pattern is NOT

- Not a "case-management AI", the agent doesn't decide case status,
  priority, or routing.
- Not a search interface, the agent has no read access to the
  spreadsheet. It only knows about the case the thread is about.
- Not free-form chat, the system prompt narrows it to email
  drafting; off-task input gets a polite redirect.
