/**
 * Slack Thread Context Extractor
 * ==============================
 *
 * When a workflow opens a thread by posting an initial message that
 * embeds structured data (e.g. a confirmation DM that includes the
 * full case as a JSON object inside a context block at the bottom),
 * we can later recover that data by reading the thread back and
 * parsing it out, without keeping any side-channel state.
 *
 * This pattern is useful for:
 *   - LLM agents that need per-thread context (the case the user is
 *     asking the agent to draft an email about),
 *   - workflows that respond to thread replies and need to know what
 *     the thread is "about",
 *   - any continuation-of-context pattern where the thread is the
 *     source of truth.
 *
 * The extractor is defensive: it tries several locations for the JSON
 * (context block, top-level message text, fallback search across the
 * whole thread) before giving up. This handles three cases:
 *   1. The bot posted with a context block (preferred shape).
 *   2. The bot posted with the JSON inline in `text`.
 *   3. The bot posted years ago with a different format and we want
 *      to keep working anyway.
 *
 * Used in: n8n Code node, after a Slack `conversations.replies` HTTP
 * call has fetched the thread's message history.
 *
 * Output:
 *   {
 *     contextData,    // the recovered JSON object (empty if not found)
 *     history,        // [{role: 'user'|'assistant', content: string}, ...]
 *     currentText,    // the user's latest message in the thread
 *     userId,         // who sent it
 *     channelId,
 *     threadTs,
 *   }
 */

const messages = $("Get Thread History").first().json.messages || [];
const currentMsg = $("Current Message").first().json;

const firstMsg = messages[0] || {};
const blocks = firstMsg.blocks || [];

let contextData = {};

// ── Method 1: context block in the first message ───────────────
// The preferred shape: bot posted with a context block whose text
// contains a marker (e.g. "case data:") followed by a JSON object.
for (const block of blocks) {
  if (block.type === "context" && block.elements) {
    for (const el of block.elements) {
      const txt = (el.text || "").toString();
      if (txt.includes("case data")) {
        try {
          const start = txt.indexOf("{");
          const end = txt.lastIndexOf("}");
          if (start !== -1 && end !== -1) {
            contextData = JSON.parse(txt.substring(start, end + 1));
          }
        } catch (e) {
          /* fall through to next method */
        }
      }
    }
  }
}

// ── Method 2: top-level text ───────────────────────────────────
// Fallback when blocks weren't preserved (older messages, edits).
if (!contextData.id && firstMsg.text) {
  try {
    const txt = firstMsg.text;
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      contextData = JSON.parse(txt.substring(start, end + 1));
    }
  } catch (e) {
    /* fall through */
  }
}

// ── Method 3: scan every message ───────────────────────────────
// Last-resort: someone replied to the thread with the JSON pasted
// in. Look for a recognizable shape ("id" + "region" both present).
if (!contextData.id) {
  for (const msg of messages) {
    const txt = (msg.text || "").toString();
    if (txt.includes('"id"') && txt.includes('"region"')) {
      try {
        const start = txt.indexOf("{");
        const end = txt.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          contextData = JSON.parse(txt.substring(start, end + 1));
          break;
        }
      } catch (e) {
        /* keep going */
      }
    }
  }
}

// ── Conversation history ──────────────────────────────────────
// Everything after the first message, in role/content shape suitable
// for an LLM chat completion call.
const history = messages
  .filter((m) => m.ts !== firstMsg.ts)
  .map((m) => ({
    role: m.bot_id ? "assistant" : "user",
    content: (m.text || "").replace(/<[^>]+>/g, "").trim(),
  }))
  .filter((m) => m.content);

return [
  {
    json: {
      contextData,
      history,
      currentText: currentMsg.text,
      userId: currentMsg.userId,
      channelId: currentMsg.channelId,
      threadTs: currentMsg.threadTs,
    },
  },
];
