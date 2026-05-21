/**
 * Slack Block Kit Modal Builder
 * =============================
 *
 * Builds a search-modal JSON object suitable for the Slack
 * `views.open` HTTP call. The same shape - with different fields -
 * is used to build New / Update / Report / Email modals in the
 * internal workflow.
 *
 * Key Block Kit conventions this snippet illustrates:
 *
 *   - `private_metadata` round-trips context that's needed when the
 *     modal submits but isn't visible to the user (here: region, action
 *     type, originating user ID). On submission, the parser reads this
 *     back to know which branch to dispatch into.
 *
 *   - `block_id` and `action_id` form the read-back path for the
 *     submitted values. After submission, the field's value is at
 *     `view.state.values[block_id][action_id].value` (for plain text)
 *     or `.selected_option.value` (for selects).
 *
 *   - `optional: true` on an input block lets the modal submit even
 *     when the field is empty. Without it, Slack rejects the submission
 *     with an inline error.
 *
 *   - The modal is built as a plain JS object and passed to the next
 *     node, which calls `views.open`. Keeping the build separate from
 *     the API call makes the modal trivially testable: log the object,
 *     paste it into Slack's Block Kit Builder, see what it looks like.
 *
 * Used in: n8n Code node, after the parser when actionPrefix === 'search'.
 *
 * Output: { modalBody } - pass to an HTTP Request node configured to
 *   POST to https://slack.com/api/views.open with this as the body.
 */

const region = $json.region;
const triggerId = $json.triggerId;
const userId = $json.userId;

const regionIcon = {
  "Region A": "A",
  "Region B": "B",
  "Region C": "C",
  "Region D": "D",
  "Region E": "E",
};

const body = {
  trigger_id: triggerId,
  view: {
    type: "modal",
    callback_id: "search_submit",

    // Round-trip context: parser will read this back on submission.
    private_metadata: JSON.stringify({ region, action: "search", userId }),

    title: {
      type: "plain_text",
      text: "Search cases",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "Search",
      emoji: true,
    },
    close: {
      type: "plain_text",
      text: "Cancel",
      emoji: true,
    },

    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `${regionIcon[region] || "Region"}  *${region}*\n` +
            "_Search by company, customer name, or address._",
        },
      },

      { type: "divider" },

      {
        type: "input",
        block_id: "search_term",
        optional: true,
        label: {
          type: "plain_text",
          text: "Company, customer or address",
          emoji: true,
        },
        hint: {
          type: "plain_text",
          text: "Leave empty to see all cases.",
          emoji: true,
        },
        element: {
          type: "plain_text_input",
          action_id: "v",
          placeholder: {
            type: "plain_text",
            text: "e.g. Acme GmbH, Mueller, Main Street...",
          },
        },
      },
    ],
  },
};

return [{ json: { modalBody: body } }];
