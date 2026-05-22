# System Architecture

The system is split into two n8n workflows and one shared spreadsheet:

1. **Home Tab workflow**, Slack `app_home_opened` event handler.
   Reads case rows from each region's worksheet, computes status counts,
   renders the App Home blocks, publishes via `views.publish`.
2. **Interaction workflow**, Slack interactions endpoint. Receives
   button clicks and modal submissions. Parses, validates, dispatches
   to the matching branch (new / search / update / report / email /
   AI-drafting), reads or writes the spreadsheet, sends a confirmation
   DM.
3. **Excel workbook**, single workbook with one worksheet per region.
   Source of truth.

## Why two workflows instead of one

The Home Tab handler runs every time any user opens the bot's home
tab. The interaction handler runs only when a user clicks a button
or submits a modal. They're triggered by completely different Slack
events and have different latency requirements (Home Tab should feel
instant; interaction handlers can take a beat to write to Excel).
Splitting them keeps the Home Tab workflow small and fast, and lets
the interaction workflow grow without slowing down dashboard rendering.

## Why one big interaction workflow instead of many

The interaction workflow covers several action types
(new, search, update, view-search, report, email, AI-draft). Each
action shares a common front-end (parse Slack payload, check user
whitelist, detect region, route by `action_id`) before branching. If
each action type were its own workflow, the parsing-and-routing
prefix would have to be duplicated five times, and the team would
have to maintain five places where the user whitelist lives.

The trade-off: the workflow is large enough that a single n8n canvas
view can become visually dense. This is mitigated by clear node naming
(every node has a descriptive name like "Parse Slack Payload",
"Build Edit Modal", "Prepare New Excel Row") and a strict left-to-right
data flow with explicit IF nodes labeled by callback.

A future split would put each action behind an `executeWorkflow` call,
with the router workflow keeping only the parse-and-dispatch front-end.

---

## Layer 1, Slack UI

### App Home tab

Rendered server-side per request. The Home Tab workflow:

1. Receives the `app_home_opened` event.
2. Reads each region's worksheet via Microsoft Graph (one HTTP request
   per region; these run in parallel).
3. For each region, counts rows by status: `In Progress`, `Completed`,
   `On Hold`, `Storniert`.
4. Builds Block Kit JSON: a header section per region, a
   one-line stats summary, a row of action buttons for that region.
5. Calls `views.publish` to update the home tab.

Each action button has an `action_id` like `new_region_a`,
`search_region_b`, `report_all`. The prefix encodes the action; the
suffix encodes the region. This keeps the parsing logic in the
interaction workflow simple: split on `_`, the first part is the
action, the rest is the region key.

### Modals

Modals are built as Block Kit JSON in n8n Code nodes, then opened
via `views.open` with a `trigger_id`. Common building blocks:

- `static_select` for status, priority, region
- `datepicker` for report date / payment date
- `users_select` for assigning a responsible team member
- `plain_text_input` for free-text fields
- A `private_metadata` JSON string carrying the region, action type,
  and originating user ID, read back when the modal submits

`private_metadata` is the trick that makes one router workflow handle
modals from any branch without keeping any in-memory session state.
The submission carries enough context to know what to do next.

### DMs

After every successful write, the workflow posts a structured DM to
the originating user echoing the saved values. This is the user's
confirmation that their action persisted; absence of the DM is a
reliable signal that something went wrong.

---

## Layer 2, n8n Router

### Webhook entry

A single Webhook node receives all Slack interactions (buttons,
modal submissions, slash commands if present). The Slack interaction
URL points here.

### Parsing and whitelist

The first Code node parses the Slack payload (which arrives URL-encoded
with the JSON in a `payload` field), checks the requesting user's ID
against a hard-coded `ALLOWED_USERS` array, and short-circuits with
a `blocked: true` flag if not allowed. Downstream IF nodes route
blocked requests to a polite "you don't have access" response.

See [`snippets/slack-payload-parser.js`](../snippets/slack-payload-parser.js)
for the full parser.

### Action dispatch

Once parsed, the workflow uses an IF node per action type. Each branch:

1. Validates required fields from the modal `viewState` (or button
   `value`).
2. Reads or writes the spreadsheet via Microsoft Graph.
3. Builds a follow-up Slack response, either a new modal (e.g.
   search results), a confirmation DM, or a report message.
4. Calls `respondToWebhook` with a 200 to keep Slack happy.

### Region routing

Region is detected at parse time from either the `action_id` suffix
(button click) or `private_metadata.region` (modal submission). It's
then used to choose:

- The correct worksheet name in Microsoft Graph
- The correct emoji prefix in Slack messages
- The correct list of "all regions" rows when the action is `_all`

---

## Layer 3, Excel state

### Sheet structure

Each region is a separate worksheet. Columns are fixed; rows are cases.
Adding a new case is an append; updating a case is a `PATCH` on a
specific row range.

The append flow needs a small dance because Microsoft Graph's append
endpoint returns the inserted row's address, but not in the form
needed to set values on it. The workflow:

1. `GET ../usedRange` to find the current last row.
2. `POST ../range/insert` to append a blank row.
3. `PATCH ../range(address='Sheet!A17:S17')` with the row values.

### Search

Search is implemented client-side: read all rows for the region, filter
in JavaScript by partial match on company / customer / address. For
the team's data volume (hundreds of rows per region) this is cheaper
than asking Microsoft Graph to do the filtering.

### Reports

Reports aggregate across one region or all regions for a given date
range. The aggregation is done in a single Code node after reading
all relevant rows; output is a structured object that the next node
formats into a Slack DM. See
[`snippets/date-range-summary-aggregator.js`](../snippets/date-range-summary-aggregator.js).

---

## Optional layer, LLM email assistant

A separate branch of the interaction workflow handles `app_mention`
events inside a case's thread. When a user `@`s the bot in a thread
that started with a confirmation DM, the workflow:

1. Reads the thread history via `conversations.replies`.
2. Extracts the case JSON from the first message's context blocks
   (it was embedded as a structured JSON object when the case was
   confirmed). See
   [`snippets/slack-thread-context-extractor.js`](../snippets/slack-thread-context-extractor.js).
3. Builds a system prompt that includes the case fields plus the
   conversation history. See
   [`snippets/llm-agent-prompt-builder.js`](../snippets/llm-agent-prompt-builder.js).
4. Calls Azure OpenAI with the prompt and the user's latest mention
   text as the chat input.
5. Posts the LLM's response back into the thread.

The LLM is instructed (in its system prompt) to draft outbound German
business emails, ask for the recipient address if unknown, and only
send via the Outlook tool when the user types `ABSENDEN` (the German
"send"). The workflow gives the LLM access to a single Outlook tool
binding so it can actually dispatch the email when authorized.

---

## Where to look next

- **App Home rendering details** → [`slack-app-home-pattern.md`](./slack-app-home-pattern.md)
- **Interaction routing details** → [`interaction-router-pattern.md`](./interaction-router-pattern.md)
- **AI agent details** → [`ai-agent-pattern.md`](./ai-agent-pattern.md)
- **Code snippets** → [`../snippets/README.md`](../snippets/README.md)
