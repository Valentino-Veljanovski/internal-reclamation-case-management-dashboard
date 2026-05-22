# Slack App Home Pattern

The App Home tab is the bot's "home page" inside Slack, a dedicated
view that the bot can render with arbitrary Block Kit content. For
this case-management system, the App Home is used as a per-region
dashboard plus action-button launcher.

## What App Home is good for

- A persistent dashboard that any team member opens via the bot's
  profile in Slack.
- Per-user views: each user opening the home tab triggers the workflow
  fresh, so you can render different content per user.
- Action-launcher pattern: instead of slash commands the user has to
  remember, present buttons that open the right modal.

## What App Home is not

- Real-time. The home tab re-renders only when the user opens it (or
  you explicitly call `views.publish` for that user). If another user
  changes a case, the dashboard isn't pushed.
- A replacement for a real BI dashboard. Block Kit's vocabulary is
  text + buttons + simple selects, no charts, no tables in the
  spreadsheet sense.
- Stateful. Every render starts from scratch, pull fresh data each
  time.

---

## Trigger

Slack fires `app_home_opened` whenever a user opens the bot's home
tab. The event payload contains:

- `user`, the Slack user ID. Use this to scope reads if your data
  is per-user.
- `view.hash`, Slack's view ID. Pass it on `views.publish` to avoid
  overwriting a newer render (rare race condition).

In n8n, an Outlook-style trigger node listens on the events URL and
emits one item per fired event.

---

## Reading source data

For a per-region dashboard, the workflow reads each region's worksheet
from Microsoft Graph. A few details that bite if you skip them:

- **Parallel HTTP requests.** Multiple regions times one Graph request each
  is five sequential round-trips if you let n8n run them serially.
  Use n8n's per-node parallel execution by branching the input into
one branch per region and merging back.
- **`usedRange` over `range`.** `usedRange` returns only the populated
  cells; `range` requires you to know the row count. With manually
  edited spreadsheets, row count is unstable.
- **Empty rows in the middle of the sheet.** Filter rows by checking
  whether the first column (company name) is non-empty and isn't a
  category divider (e.g. starts with a marker character your team
  uses for headers).

---

## Building the blocks

App Home content is a JSON array of Block Kit blocks. The pattern for
this dashboard:

```js
const blocks = [];

for (const region of REGIONS) {
  const regionRows = readRegionRows(region); // from Microsoft Graph
  const counts = countByStatus(regionRows);

  blocks.push(
    {
      type: "header",
      text: { type: "plain_text", text: `${regionIcon[region]} ${region}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Active:* ${counts.active}   *Done:* ${counts.done}   ` +
          `*On hold:* ${counts.onHold}   *Cancelled:* ${counts.cancelled}`,
      },
    },
    {
      type: "actions",
      elements: [
        button("New", `new_${regionKey(region)}`),
        button("Search", `search_${regionKey(region)}`),
        button("Update", `update_${regionKey(region)}`),
      ],
    },
    { type: "divider" },
  );
}

blocks.push(
  {
    type: "actions",
    elements: [
      button("Report", "report_all"),
      button("Email assistant", "email_all"),
    ],
  },
);
```

Two patterns in here worth highlighting:

**Action-ID encoding.** Button `action_id` values follow
`<action>_<regionKey>` so the interaction handler can split on `_` to
recover both pieces. Single source of structure, no separate routing
table to maintain.

**Section ordering.** Header → stats → action buttons → divider, per region. The divider visually scopes each region's actions to that region's
data, which prevents the user from clicking "New" thinking it'll
create for whichever region they were last looking at.

---

## Publishing

Once `blocks` is assembled, send it via `views.publish`:

```http
POST https://slack.com/api/views.publish
Authorization: Bearer xoxb-...

{
  "user_id": "U..." ,                 // user from the event payload
  "view": {
    "type": "home",
    "blocks": [ ... ]
  }
}
```

`views.publish` is idempotent, calling it again with the same
content is a no-op. So you can re-render aggressively without worrying
about Slack thinking you're spamming.

---

## Failure modes

| Failure | What you'll see | Mitigation |
|---|---|---|
| Microsoft Graph returns 401 | Empty Home tab | Refresh the OAuth connection; n8n's built-in OAuth handling covers this if configured |
| One region read fails, others succeed | Partial dashboard with the failed region missing | Catch per-branch in n8n; render an error placeholder block for the failed region instead of failing the whole render |
| Rate limit (429) from Slack | `views.publish` returns `ratelimited` | Slack rate-limits per-user; this matters only if you're calling `views.publish` outside the `app_home_opened` trigger. Inside the trigger, you're fine, Slack fires the event when the user is actually looking. |
| Block Kit JSON exceeds 100 blocks | `views.publish` returns `invalid_blocks` | Split the dashboard, paginate, or aggregate regions under collapsible sections. The hard limit is 100 blocks per view. |
| User not in the workspace | `views.publish` returns `user_not_found` | Ignore, it's transient if the user just left the workspace |
