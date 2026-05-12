/**
 * Slack Interaction Payload Parser
 * ================================
 *
 * The first node of the interaction-handling workflow. Slack sends every
 * interaction (button click, modal submission, select-menu change) to a
 * single configured webhook URL with a URL-encoded `payload` field
 * containing JSON. This node:
 *
 *   1. Parses the JSON.
 *   2. Checks the requesting Slack user against an allow-list.
 *   3. Extracts the data needed to dispatch — action, city, view state,
 *      callback ID, trigger ID — into a flat object the rest of the
 *      workflow can branch on.
 *
 * Action-ID convention assumed by this parser: `<actionPrefix>_<cityKey>`
 *   examples:  new_berlin, search_mainz, report_all
 *
 * For modal submissions, the city and action are read from the modal's
 * `private_metadata` JSON string instead.
 *
 * Used in: n8n Code node, immediately after the Slack interactions
 * Webhook trigger.
 */

const body = $input.first().json.body;

// ── Allow-list ───────────────────────────────────────────────
// Hard-coded for a small closed team. For broader use, replace with
// a Slack User Group lookup or a config-sheet check.
const ALLOWED_USERS = [
  "U_AAAAAAAAAA",
  "U_BBBBBBBBBB",
  "U_CCCCCCCCCC",
];

const requestUserId = (() => {
  try {
    const p =
      typeof body.payload === "string"
        ? JSON.parse(body.payload)
        : body.payload || {};
    return p.user?.id || "";
  } catch (e) {
    return "";
  }
})();

if (!ALLOWED_USERS.includes(requestUserId)) {
  return [{ json: { blocked: true, userId: requestUserId } }];
}

// ── Parse the payload ────────────────────────────────────────
let payload;
try {
  payload =
    typeof body.payload === "string"
      ? JSON.parse(body.payload)
      : body.payload || {};
} catch (e) {
  return [{ json: { error: "parse_failed" } }];
}

const type = payload.type || ""; // 'block_actions' | 'view_submission'
const action = payload.actions?.[0] || {};
const view = payload.view || {};
const channelId = payload.channel?.id || "";

// ── City key → canonical name ────────────────────────────────
// Adjust this map to your operational regions.
const cityMap = {
  berlin: "Berlin",
  mainz: "Mainz",
  koeln: "Köln",
  muenchen: "München",
  stuttgart: "Stuttgart",
};

let city = "";
let actionPrefix = "";
const actionId = action.action_id || "";
const actionValue = action.value || "";

if (type === "block_actions") {
  // Special-case action_ids that don't follow the city-suffix convention
  if (actionId === "email_send_confirm") {
    actionPrefix = "emailsend";
  } else if (actionId === "email_draft_change") {
    actionPrefix = "emailchange";
  } else {
    const parts = actionId.split("_");
    actionPrefix = parts[0];
    const cityKey = parts.slice(1).join("_");
    city = cityMap[cityKey] || (cityKey === "all" ? "all" : cityKey);
  }
}

if (type === "view_submission") {
  try {
    const meta = JSON.parse(view.private_metadata || "{}");
    city = meta.city || "";
    actionPrefix = meta.action || "";
  } catch (e) {
    /* ignore — downstream will check for missing fields */
  }
}

// Re-parse private_metadata for downstream nodes that need it
let rawMeta = {};
try {
  rawMeta = JSON.parse(view.private_metadata || "{}");
} catch (e) {
  /* ignore */
}

return [
  {
    json: {
      type,
      rawMeta,
      actionPrefix,
      city,
      actionId,
      actionValue,
      channelId,
      triggerId: payload.trigger_id || "",
      userId: payload.user?.id || "",
      callbackId: view.callback_id || "",
      viewState: view.state?.values || {},
      rootViewId: view.root_view_id || "",
    },
  },
];
