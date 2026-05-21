# Interaction Router Pattern

A single n8n webhook receives every Slack interaction — button clicks,
modal submissions, select-menu changes — and dispatches it to the
matching action branch. This page describes how the router works,
why it's structured this way, and the trade-offs.

## Why one router instead of one workflow per action

The interaction-handling workflows for `new`, `search`, `update`,
`report`, `email`, and `AI-draft` all share the same prefix:

1. Receive the Slack interaction webhook
2. Parse the URL-encoded `payload` field into JSON
3. Check the requesting user's ID against an allow-list
4. Detect the region from `action_id` or `private_metadata`

If each action lived in its own workflow, that prefix would have to
be duplicated in five places, and changes to (e.g.) the user
allow-list would need to be applied five times. The shared prefix is
dictated by Slack — every interaction has the same envelope — so
sharing a single entry point is the natural shape.

The downside is a workflow that grows large. As the workflow grows, it becomes harder to navigate visually. The
escape hatch is `executeWorkflow`: keep the parser + dispatcher in the
router, move each action's logic into its own called workflow. The
reason this system stayed as one workflow is documented in
[`architecture.md`](./architecture.md#why-one-big-interaction-workflow-instead-of-many).

---

## Slack interaction payload shape

Slack sends all interactions to a single configured URL with this
shape:

```
POST /webhook/<id>
Content-Type: application/x-www-form-urlencoded

payload={"type":"block_actions","user":{"id":"U..."},"actions":[...],...}
```

The `payload` form-field value is URL-encoded JSON. n8n's webhook node
gives you `body.payload` as a string; you have to JSON-parse it
manually. The parser snippet handles this.

The two payload `type` values that matter:

- **`block_actions`** — the user clicked a button or changed a select.
  Look at `payload.actions[0]` for which one.
- **`view_submission`** — the user submitted a modal. Look at
  `payload.view.state.values` for the field values, and
  `payload.view.callback_id` for which modal it was.

(There are others — `view_closed`, `shortcut`, `message_action` — that
this system doesn't use.)

---

## Action-ID convention

Button `action_id` values follow `<actionPrefix>_<regionKey>`:

```
new_region_a
search_region_b
update_region_c
report_all
email_region_a
```

The parser splits on `_`, takes the first segment as the action
prefix, joins the rest as the region key, and looks the region key up
in a small map (`region_a -> Region A`, `region_b -> Region B`, etc.)
to recover the canonical region name.

For modal submissions, action and region come from the modal's
`private_metadata` — a JSON string the workflow embedded when it
opened the modal:

```js
view: {
  type: "modal",
  callback_id: "new_case_submit",
  private_metadata: JSON.stringify({
    region: "Region A",
    action: "new",
    userId: requestUserId,
  }),
  ...
}
```

When the modal submits, the parser reads `view.private_metadata`,
JSON-parses it, and uses `region` and `action` to dispatch.

The point of `private_metadata` is to round-trip context that's needed
on submission but isn't visible to the user. Slack passes it back
verbatim. It's bounded to 3000 characters, which is enough for
structured small objects but not for arbitrary blobs.

---

## Dispatch topology

After parsing, the workflow has these fields available:

```js
{
  type: 'block_actions' | 'view_submission',
  actionPrefix: 'new' | 'search' | 'update' | 'report' | 'email' | 'select' | 'emailsend',
  region: 'Region A' | 'Region B' | ... | 'all',
  userId: 'U...',
  triggerId: '...',          // for opening modals
  callbackId: '...',          // for view_submission, identifies which modal
  viewState: {...},           // for view_submission, the field values
  rawMeta: {...},             // parsed private_metadata
}
```

A chain of IF nodes branches on `actionPrefix` + `callbackId`. For
example:

```
[Parse Slack Payload]
    │
    ▼
[Is blocked?] ── true ──► [Send "no access" DM]
    │ false
    ▼
[Is type=block_actions AND actionPrefix=new?] ── true ──► [Open New modal]
    │ false
    ▼
[Is type=view_submission AND callbackId=new_case_submit?] ── true ──►
    [Build Excel row → Append to sheet → Send confirmation DM]
    │ false
    ▼
[Is type=block_actions AND actionPrefix=search?] ── true ──► [Open Search modal]
    │ false
    ▼
... etc, several branches total
```

This is more verbose than a Switch node, but it makes each branch's
trigger condition explicit and grep-friendly. When something breaks,
you can look at the n8n execution log, find which IF node went `true`,
and read its full condition without clicking around.

---

## Responding to Slack

Slack expects an HTTP 200 within 3 seconds of the interaction. If you
take longer, Slack retries the interaction (with a `retry_num`
header), and the user sees an error in their client.

For interactions that finish quickly (open a modal, send a confirmation
DM), the workflow returns 200 directly via `respondToWebhook`.

For interactions that need to do real work (read several region sheets,
aggregate, build a report), the pattern is:

1. Return an immediate 200 to Slack.
2. Continue the workflow asynchronously. n8n keeps executing nodes
   after the response was sent.
3. Post the actual result via a follow-up `chat.postMessage` or
   `views.update` call.

This is the same pattern Slack documents for slash commands and
interactions. Don't try to do the work synchronously and then respond;
you'll hit the timeout.

---

## User whitelist

The whitelist is a hard-coded array in the parser:

```js
const ALLOWED_USERS = ["U_AAAAAAAAA", "U_BBBBBBBBB", "U_CCCCCCCCC"];
```

If the requesting user isn't in the list, the parser returns
`{ blocked: true, userId: requestUserId }` and downstream IF nodes
route to a "you don't have access" response.

This is appropriate for a closed team but is the wrong shape for
anything broader. To replace:

- Pull the allow-list from a config sheet or environment variable
- Replace the array check with a Slack User Group lookup (so adding
  someone to the team's user group automatically grants access)
- Replace the binary blocked/allowed with role-based checks (some
  users can read but not write, etc.)

The current implementation is honest about its limits: it's the
right shape for the team it serves, and it's documented as a
single-line change away from being insufficient.
