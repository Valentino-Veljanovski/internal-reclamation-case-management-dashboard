/**
 * LLM Agent Prompt Builder (per-thread context)
 * =============================================
 *
 * Builds a system prompt for an LLM agent that drafts outbound emails
 * about a specific case. Pulls together:
 *
 *   - structured case fields (company, customer, status, etc.),
 *   - prior conversation history from the same Slack thread,
 *   - explicit output rules (tone, language, signing block),
 *   - a workflow-state instruction (ask for recipient if unknown,
 *     send via Outlook tool only when user types the trigger word).
 *
 * The pattern: rebuild the system prompt fresh on every invocation.
 * No persistent agent memory, no per-conversation state stored on the
 * agent's side. Everything the agent needs is in this one prompt.
 *
 * Used in: n8n Code node, after the thread context extractor and
 * before the LangChain agent / Azure OpenAI Chat node.
 *
 * Output: { systemPrompt, chatInput, ...passthrough } — the agent
 * node consumes systemPrompt as its system message and chatInput as
 * the user message.
 */

const { contextData, history, currentText, userId, channelId, threadTs } =
  $json;
const c = contextData;

// ── Helpers ──────────────────────────────────────────────────

/**
 * Render a value for the prompt. Empty / null / placeholder values
 * become an em-dash so the agent sees "Phone: —" (clearly missing)
 * rather than "Phone: null" (which it would treat as a real value).
 */
function s(val) {
  if (val === null || val === undefined || val === "" || val === "-") {
    return "—";
  }
  return String(val).trim();
}

// ── Has a recipient email surfaced anywhere in the thread? ──
// If the user pasted "send to a@b.com" earlier, we won't ask again.
const emailRegex = /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const hasEmail =
  history.some((m) => m.role === "user" && emailRegex.test(m.content)) ||
  emailRegex.test(currentText);

// ── Conversation history as plain text ───────────────────────
const historyText =
  history.length > 0
    ? "\n\nConversation so far:\n" +
      history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n")
    : "";

// ── Trigger word — adjust per language. ──────────────────────
// Keep this distinct from anything the user might type in normal
// conversation; otherwise the agent sends prematurely.
const SEND_TRIGGER = "SEND";
const isSendTrigger = currentText.trim().toUpperCase() === SEND_TRIGGER;

// ── System prompt ─────────────────────────────────────────────
const systemPrompt =
  "You are an email-drafting assistant for an operations team.\n" +
  "You help the user write professional German business emails about " +
  "a customer case.\n\n" +
  "Case data:\n" +
  `- Company: ${s(c.company)}\n` +
  `- Customer name: ${s(c.customerName)}\n` +
  `- Address: ${s(c.address)}\n` +
  `- Phone: ${s(c.phone)}\n` +
  `- Status: ${s(c.status)}\n` +
  `- Priority: ${s(c.priority)}\n` +
  `- Reported on: ${s(c.reportedOn)}\n` +
  `- Assigned to: ${s(c.assignedTo)}\n` +
  `- Notes: ${s(c.notes)}\n\n` +
  "OUTPUT RULES (always follow):\n" +
  "1. Reply in German.\n" +
  "2. Formal tone — Sie / Ihr.\n" +
  '3. Every email needs: "Betreff:" line, salutation, body, sign-off.\n' +
  "4. Sender block: [Company Name] | ops@example.com\n\n" +
  "WORKFLOW RULES:\n" +
  "5. If the recipient email address is NOT known, ASK FIRST. Do not " +
  "draft an email without a recipient.\n" +
  "6. Once the address is known, immediately produce the full draft.\n" +
  "7. If the user asks for changes, revise and re-show the draft.\n" +
  `8. When the user types ${SEND_TRIGGER}, dispatch the email via the ` +
  "Outlook tool without further confirmation.\n" +
  "9. After a successful send, confirm: '✅ Email sent to <recipient>'.\n" +
  "10. If sending fails, surface the error: '❌ Send failed: <reason>'.\n\n" +
  "CURRENT STATE:\n" +
  (isSendTrigger
    ? `⚡ User typed ${SEND_TRIGGER}. Dispatch via Outlook tool now.`
    : hasEmail
    ? "📧 Recipient address known. Draft or revise."
    : "❓ Recipient address not yet known. Ask for it first.") +
  historyText;

return [
  {
    json: {
      systemPrompt,
      chatInput: currentText,
      userId,
      channelId,
      threadTs,
      isSendTrigger,
    },
  },
];
