/**
 * SMS notification module using SMS API PH.
 *
 * Sends ticket-acknowledgement SMS to customers when their support
 * ticket is created and assigned to an agent.
 *
 * API docs: https://smsapiph.netlify.app/documentation
 */

const SMS_API_URL = "https://smsapiph.onrender.com/api/v1/send/sms";

export type SmsResult = { sent: true } | { sent: false; reason: string };

/** SMS character limit enforced by SMS API PH. */
const SMS_MAX_LENGTH = 160;

/**
 * Build a concise acknowledgement message that fits within 160 characters.
 */
export function buildAcknowledgementMessage(opts: {
  customerName: string;
  ticketCategory: string;
  agentName: string | null;
  priority: string;
}): string {
  const category = opts.ticketCategory.replace(/_/g, " ");
  const agent = opts.agentName ?? "our team";

  // Primary: short and informative
  const msg = `Hi ${opts.customerName}, your ${category} ticket (${opts.priority}) is assigned to ${agent}. We'll reach out soon. -NeoSolve`;

  if (msg.length <= SMS_MAX_LENGTH) {
    return msg;
  }

  // Fallback: drop the agent name to save space
  const short = `Hi ${opts.customerName}, your ${category} ticket (${opts.priority}) has been received. We'll reach out soon. -NeoSolve`;

  return short.slice(0, SMS_MAX_LENGTH);
}

/**
 * Send an SMS via SMS API PH.
 *
 * Returns a result object instead of throwing so callers can handle
 * failures gracefully without breaking the main ticket-creation flow.
 */
export async function sendSms(
  recipient: string,
  message: string,
  apiKey: string,
): Promise<SmsResult> {
  try {
    const response = await fetch(SMS_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient, message }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      return { sent: false, reason: `HTTP ${response.status}: ${text}` };
    }

    return { sent: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { sent: false, reason: msg };
  }
}

/**
 * High-level helper: send a ticket-acknowledgement SMS.
 *
 * Silently skips if the API key is not configured or no phone number
 * was provided, so callers don't need to guard these cases.
 */
export async function sendTicketAcknowledgement(opts: {
  customerPhone: string | undefined;
  customerName: string;
  ticketCategory: string;
  agentName: string | null;
  priority: string;
  apiKey: string | undefined;
}): Promise<SmsResult> {
  if (!opts.apiKey) {
    return { sent: false, reason: "SMSAPI_KEY not configured" };
  }
  if (!opts.customerPhone) {
    return { sent: false, reason: "No customer phone number provided" };
  }

  const message = buildAcknowledgementMessage({
    customerName: opts.customerName,
    ticketCategory: opts.ticketCategory,
    agentName: opts.agentName,
    priority: opts.priority,
  });

  return sendSms(opts.customerPhone, message, opts.apiKey);
}
