# WhatsApp on Agents44 (Meta Cloud API)

Agents44 sends and receives WhatsApp through the **official Meta Graph API / WhatsApp Cloud API**. A department is provisioned with a Meta-verified business number, the Cloud API **phone number ID**, and a Graph API **access token**. Agents then use MCP tools. Incoming customer replies hit a webhook and immediately start the agent that owns that thread.

This is the native Meta path: Facebook Business + WhatsApp Business Platform. It is not a third-party inbox BSP.

## Create the Meta (Facebook) app

Agents44 talks to **your** WhatsApp Business Account. You do not need App Review or Advanced Access if the number and WABA belong to this same business. Partners who onboard *other* businesses need App Review; that is out of scope here.

Official start: [WhatsApp Cloud API Get Started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/).

### 1. Business portfolio

1. Sign in at [Meta for Developers](https://developers.facebook.com/) with a Facebook account that can administer the company.
2. Create or join a **Meta Business** / business portfolio (required for the WhatsApp use case). The person creating the app must be an **Admin** on that portfolio.

### 2. Create the app

1. Open [Create App](https://developers.facebook.com/apps/creation/) (App Dashboard → **Create app**).
2. App name (e.g. `Agents44 WhatsApp`) and a contact email.
3. Use case: **Connect with customers through WhatsApp**. That use case is what adds Cloud API. Do not pick a consumer Login-only app.
4. Attach the business portfolio from step 1.
5. Confirm and **Create app**.

If an app already exists without WhatsApp: App Dashboard → **Add use case** / **Add product** → **WhatsApp**. Same permissions as below.

### 3. Roles the app and token need

Three different “roles” matter. Mix them up and send/webhook calls return Graph error `200` (permission / asset access), not HTTP 200.

**A. Graph API permissions on the access token** (required for Agents44 send + inbound `messages` webhooks):

| Permission | Why |
|------------|-----|
| `whatsapp_business_messaging` | Send session messages; receive incoming message webhooks |
| `whatsapp_business_management` | WABA / phone-number metadata; subscribe the WABA to the app webhook |

Also add `business_management` when Meta’s token wizard lists it (portfolio / asset assignment). Do **not** need `whatsapp_business_manage_events` or ads permissions; Agents44 does not send templates or ads.

The WhatsApp use case pre-selects `whatsapp_business_messaging` and `whatsapp_business_management`. Confirm they stay on **Permissions and features**.

**B. System user in Business settings** (the identity behind a long-lived token):

1. [Business settings](https://business.facebook.com/settings) → **Users** → **System users** → **Add**.
2. Role: **Admin** (simplest: access to all WABAs in the portfolio). **Employee** also works if you then grant that user Full control on this app and this WhatsApp account.
3. **Assign assets**:
   - The Meta **app** → **Manage app** (Full control)
   - The **WhatsApp account** (WABA) → **Manage WhatsApp Business accounts** (Full control)
4. **Generate token** for that app, never-expire if offered, with `whatsapp_business_messaging`, `whatsapp_business_management`, and `business_management`. Copy the token once.

**C. People on the Meta app** (App Dashboard → **App roles**): whoever creates the app and generates tokens must be an **Admin**. Developer/Tester is not enough to assign WABA assets or create a system-user token.

If you only send from **WhatsApp → API Setup**, that panel issues a **User** token that expires in hours. Use it to smoke-test; provision Agents44 with the **system user** token from B.

### 4. WhatsApp Business Account and phone number

1. App Dashboard → **WhatsApp** → **API Setup**.
2. Connect or create a **WhatsApp Business Account** (WABA) on the same business portfolio.
3. Add a **phone number**. Meta must verify it (SMS/voice; a physical SIM is fine for that step). After Cloud API owns the number, WhatsApp on the handset for that number is typically disconnected.
4. Complete display-name / business verification if Meta asks.
5. Copy from API Setup:
   - **Phone number ID** (numeric, e.g. `106540352242922`) — not the human-readable `+9725…` number
   - The **system user access token** from step 3B (not the rotating API Setup user token)

The Israeli `05…` / `+9725…` number is stored on the department as the public “from” number. The **phone number ID** is what Graph API uses to send.

App mode can stay **Development** while only admins/testers message the number. For real customers, switch the app to **Live** and finish any Meta publishing checks shown on the dashboard.

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
6. The app and token must be allowed to use that WABA / phone number (roles in step 3 above).

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

1. Meta app created (WhatsApp use case); system-user **Admin** token with `whatsapp_business_messaging` + `whatsapp_business_management`; verified number + phone number ID.
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
| Graph error `200` / “does not have permission” | System user is not Admin (or not assigned Full control on the app and WABA); token missing `whatsapp_business_messaging` |
| Inbound does not start an agent | Agent never sent first (no conversation), agent disabled, or webhook not subscribed to `messages` |
| Token stops working after a day | Temporary Graph token; switch to a system-user token |
