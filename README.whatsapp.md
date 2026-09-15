# WhatsApp on Agents44 (Meta Cloud API)

Agents44 sends and receives WhatsApp through the **official Meta Graph API / WhatsApp Cloud API**. A department is provisioned with a Meta-verified business number, the Cloud API **phone number ID**, and a Graph API **access token**. Agents then use MCP tools. Incoming customer replies hit a webhook and immediately start the agent that owns that thread.

This is the native Meta path: Facebook Business + WhatsApp Business Platform. It is not a third-party inbox BSP.

## What you need before Agents44

1. A **Meta Business** account and a **Meta Developer app**.
2. **WhatsApp** product added on that app (WhatsApp → API Setup).
3. A **WhatsApp Business Account** with a **phone number** that Meta has verified (display name / business verification as Meta requires). A physical SIM can be used to complete Meta’s number verification; after Cloud API is live, WhatsApp on the phone for that number is typically disconnected.
4. From **App Dashboard → WhatsApp → API Setup**, copy:
   - **Phone number ID** (numeric, e.g. `106540352242922`) — not the human-readable `+9725…` number
   - **Access token** — a Graph API user or system-user token with WhatsApp permissions (`whatsapp_business_messaging`, `whatsapp_business_management`)
5. Prefer a **long-lived / system-user** token so sending does not stop when a short-lived explorer token expires.

The Israeli `05…` / `+9725…` number is stored on the department as the public “from” number. The **phone number ID** is what Graph API uses to send.

## Provision the department in Agents44

1. Create a department (**Departments**, name only), e.g. `tamir`.
2. Click **Provision WhatsApp**.
3. Enter:
   - **Israeli mobile number** — the verified Cloud API number (`050…` or `+9725…`)
   - **Phone number ID** — from Meta API Setup
   - **Meta Graph API access token**
4. After success, copy **Callback URL** and **Verify token**. They are shown only at provision time. To rotate them, unprovision and provision again.

API equivalent:

```http
POST /api/departments/{id}/whatsapp
{
  "from_number": "0501234567",
  "phone_number_id": "106540352242922",
  "access_token": "EAAB..."
}
```

Unprovision: `DELETE /api/departments/{id}/whatsapp` (history is kept; the webhook URL dies).

## Connect the Meta webhook

1. Meta Developer app → **WhatsApp** → **Configuration** (webhook).
2. **Callback URL** = the URL Agents44 showed (`https://agents.catch44.co.il/api/webhooks/whatsapp/<secret>`).
3. **Verify token** = the token Agents44 showed.
4. Verify. Meta sends `GET` with `hub.mode`, `hub.verify_token`, `hub.challenge`; Agents44 returns the challenge.
5. Subscribe the WhatsApp Business Account to the webhook and enable the **`messages`** field. Do not rely on status-only events for agent replies.
6. The app and token must be allowed to use that WABA / phone number.

Local Docker cannot receive Meta webhooks unless the callback URL is a public HTTPS host (production `FRONTEND_URL`).

## Create an agent that sends

1. Create an enabled agent in that department.
2. Put standing instructions in `{department}/{agent}/input/` if needed (who to message, tone, when to include links).
3. Every run for a provisioned department gets a **WhatsApp** prompt section: from-number, `send_whatsapp`, `list_whatsapp_conversations`.
4. **Manual trigger** the agent so it can send the first message (MCP `send_whatsapp`).
5. Cloud API **session messages** only work inside the **24-hour customer-service window** (the person messaged your business number, or you already have an open session). Template messages are not implemented. If send fails with a window/policy error, the customer must write first, then trigger the agent again.

Website links: put a full `https://…` URL on its own line in `message_text`. Agents44 sets Graph `preview_url: true`.

## Inbound replies → agent run

After the agent has sent at least once, Agents44 has a conversation row (`from` business, `to` customer, `agent_id`).

When the customer replies:

1. Meta POSTs to `/api/webhooks/whatsapp/<secret>`.
2. Agents44 stores the inbound text (or `[image]` / `[audio]` / …).
3. It starts that agent immediately (`trigger_source=whatsapp`) with a payload containing `conversation_id`, numbers, and text.
4. The agent should `list_whatsapp_conversations` and `send_whatsapp` to reply.

If there is no conversation yet (customer wrote first, agent never sent), the webhook is acknowledged and **no agent is started**. Send from the agent after the window is open, then later replies will trigger automatically.

## Operator UI

**WhatsApp** tab: read-only threads, filter by department, agent, from number, to number. Operators do not send from this tab.

**Agents Runs**: inbound-driven runs show trigger `whatsapp`.

## What Agents44 stores

| Place | Contents |
|-------|----------|
| `system_departments` | From-number, phone number ID, access token, webhook secret, verify token |
| `system_whatsapp_conversations` | Thread: from, to, owning agent |
| `system_whatsapp_messages` | Inbound/outbound body + Meta `wamid` |

Agents cannot SQL these tables. Use MCP only. The access token is never written into `prompt.txt`.

## MCP tools

- `send_whatsapp(to_number, message_text)` — Graph `POST /{phone-number-id}/messages` (text, `preview_url` on). Fails if the department is not provisioned.
- `list_whatsapp_conversations()` — this agent’s threads and messages only.

## Checklist for a first live test (e.g. Tamir)

1. Meta: verified number, phone number ID, Graph token with WhatsApp permissions.
2. Agents44: department provisioned; callback URL + verify token saved in the app webhook; **messages** subscribed.
3. Agent created in that department, enabled.
4. Test customer (or Tamir’s second phone) sends any text to the business number to open the 24h window.
5. Trigger the agent once so it `send_whatsapp`s to that customer.
6. Confirm the text on the customer phone and in the **WhatsApp** tab.
7. Customer replies → a `whatsapp` run should appear and the agent should answer.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Provision 400 on the number | Not an Israeli mobile, or already used on another department |
| Provision 400 on phone number ID | Not numeric, or already used |
| Meta webhook verification fails | Wrong callback URL or verify token; URL must be public HTTPS |
| Send fails / session error | No open 24h window; customer must message the business number first |
| Send fails / OAuth | Token expired or missing WhatsApp permissions |
| Inbound does not start an agent | Agent never sent first (no conversation), agent disabled, or webhook not subscribed to `messages` |
| Token stops working after a day | Temporary Graph token; switch to a system-user token |
