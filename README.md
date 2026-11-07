# BLANKET & BITES !! — Smart Picnic Planner

A conversational picnic planner using **FastAPI, LangGraph, Groq, Tavily, and Human-in-the-Loop (HITL)**. The chat page collects your details, and the separate Your picnic page displays researched places, the complete plan, finalization controls, and a group review link. No frontend build step is needed.

## Run locally

```sh
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Add your private API keys to `.env` (already ignored by Git):

```dotenv
GROQ_API_KEY=your_private_groq_key
TAVILY_API_KEY=your_private_tavily_key
GROQ_MODEL=openai/gpt-oss-20b
```

The model is configurable; choose a currently supported Groq model with JSON object output if your account does not support the default. `.env.example` contains an empty configuration template. Keys load on server startup and stay on the backend. Restart after changing them.

```sh
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. API documentation: http://127.0.0.1:8000/docs.

## Host on Render

The repository includes a `render.yaml` Blueprint for one free Python web service.
FastAPI serves both the frontend and API. `.python-version` selects Python 3.13;
use Python 3.13 for local development too.

1. Push this branch to a GitHub repository you control.
2. Sign in to [Render](https://dashboard.render.com/), choose **New > Blueprint**,
   connect the repository, and select this branch.
3. Review the `blanket-and-bites` service and add `GROQ_API_KEY` and
   `TAVILY_API_KEY` as private environment variables. Optionally set `GROQ_MODEL`.
4. Deploy. Render installs `requirements.txt`, starts one Uvicorn worker on its
   assigned `$PORT`, and checks `/api/health`.
5. Open the HTTPS URL and verify `/api/health` reports `status: ok` and
   `mode: langgraph`. Then create a plan from the homepage.

The free Blueprint uses ephemeral storage. Workflow checkpoints, shared snapshots
and group feedback can be lost on restart or redeploy; browser saves cannot restore
lost server workflows. For durable hosting, configure persistent storage and set
`PICNIC_GRAPH_DB_PATH` and `PICNIC_DB_PATH` to files on that storage. See
[Render's free-service limits](https://render.com/docs/free).

## User flow

Describe your picnic, for example:

> Plan a team picnic for 30 people near San Ramon next Saturday with a $1,000 budget, vegetarian food and lawn games, within 20 miles.

1. **Groq understands the request.** It extracts details, resolves dates using the browser's local date, and preserves occasion and activity notes.
2. **HITL — missing details.** LangGraph pauses for missing budget, guest count, food option, location, date or travel distance. Answer in the chat. Python validates ranges and dates before research.
3. **Tavily researches places.** Search results are summarized into up to five distinct places with source URLs. The app may show fewer than five; no supported results prompts a revised location or distance.
4. **HITL — place selection.** Follow the chat handoff to **Your picnic** (`/picnic.html`) and choose a place from the cards. Return to **Picnic planner** to revise the search in chat.
5. **Groq generates the plan.** It suggests menu, schedule, shopping, coordination tasks and backup options using the selected venue and requirements.
6. **Python validates estimates.** It checks allowance totals and a minimum food allowance of $8 per guest. An insufficient food allowance blocks approval.
7. **HITL — food selection.** The **Plan your picnic food** page offers **Shop for ingredients** and **Order prepared food** tabs. Guest count, food allowance, dietary needs and venue stay visible. Select **Find** to research nearby groceries or restaurants using Tavily and Groq, near the venue or starting location. Save a grocery store and a restaurant independently using **Save grocery store** and **Save restaurant**, or mark either business for later. Both choices remain visible in the food lineup; selecting one does not replace the other. **Review picnic plan** opens **Your picnic** for final review after saving your choices. Purchases happen on the linked business website; the app does not place orders. The food allowance remains an estimate, not a quote. A plan with both sources keeps the ingredient shopping list and adds ordering and transport tasks. The two sources share the existing food allowance; it is not counted twice.
8. **HITL — final approval.** Food selection returns you to review. Review the plan, ask for revisions, or select **Save & finalize**. This finalizes the canonical server plan, saves it in this browser, and highlights **Share for review**. **Save draft** keeps an unfinished copy without finalizing it. Repeated finalized saves keep sharing enabled. Changing the food choice invalidates approval and requires another review. General revisions return through collection and place selection.
9. **HITL — sharing decision.** Only after approval does **Share for review** create an immutable server-side snapshot. Both food choices appear in saved and shared plan summaries. Already shared plans stay read only. **Edit food in a new version** makes an editable copy with the same picnic details, venue and menu, without rerunning providers or changing the original review link. Copy the link and send it through your own chat or email. After sharing, **View saved plan** opens **Saved plan**; guest review remains available through the shared link. Organizers manage crew feedback in **My Picnic**, with a feedback summary in **Your picnic**; there is no separate Group feedback item in the left navigation.

The left navigation separates **Picnic planner** (chat and detail collection), **Your picnic** (place selection, full plan, finalization and sharing), **Choose food options**, and **Saved plan**. A separate bright **My Picnic — As Organizer** card opens account plans; members who only have invited plans see **As Guest** instead. **Contact B&B** lives in the bottom yellow services card, apart from the main navigation. The chat offers a handoff instead of showing the full plan beside the conversation. Conversation messages stay in this tab’s session storage by workflow so they survive navigation; the server remains the source of truth for picnic state.

The six-step guide shows which required details the server has collected: budget, guests, food, location, date, and distance. Choose a step to enter or update that detail, then select **Save and continue**. You can also supply several details together in chat. A step is marked complete only after the server confirms it.

**Edit details** sends structured corrections through the same graph. **Save & finalize** finalizes and stores one plan and its workflow reference in this browser. **Save draft** stores a copy without approval. **Saved plan** opens that saved copy in separate sections for overview, place, food, budget, schedule, shopping, assignments, and backup. **Open Your picnic** loads the server's current workflow, which may be newer than the saved copy; older sample plans remain viewable and can be used to create an invite. Switching between the planner and saved copy preserves the active conversation. **Create a Picnic Invite** opens the image editor described below. **New picnic** starts a new thread. After sharing, start a new picnic for another plan; the completed snapshot stays unchanged.

## Email sign-in and your picnic crew

Open `/login.html`, enter your email, and open its sign-in link. Confirm the displayed email to finish signing in. No password is collected. `/account.html` lists your own saved plans and plans whose invitations you have accepted; invitation links open their plan directly. If you have only one plan, signing in opens it automatically.

**Local preview:** set `AUTH_EMAIL_MODE=local` in `.env`, then restart the server. The app displays clearly labeled preview links instead of sending email. Preview requires both a loopback client address and a `localhost`, `127.0.0.1`, or `::1` URL; it is refused on public hosts and for remote clients. Use test addresses such as `organizer@example.test`. Local preview has separate limits (30 links per email and 60 per client IP per minute), so earlier real-mail quota counters do not block local testing. Real sign-in email stays limited to 3 links per email and 15 per client IP per 15 minutes, plus the global mail limit. When throttled, the page displays the remaining wait and re-enables sending when it ends. Preview links simulate access to a mailbox, so use this mode only for local development. For guest testing, use another browser profile; verifying an invitation in the same profile switches that profile to the guest account.

**Real email:** set `AUTH_EMAIL_MODE=smtp`, a fixed `APP_BASE_URL=https://your-domain`, `SMTP_HOST`, `SMTP_FROM` (an email address), and your provider’s `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD`. `SMTP_TLS=starttls` defaults to port 587; `SMTP_TLS=ssl` defaults to port 465. TLS certificate verification stays enabled. Missing or invalid settings produce a visible delivery error; production responses never return an email link. No email is sent unless the user requests a sign-in link or the organizer submits invitations.

While signed in, **Save draft** and **Save & finalize** also save the canonical server plan to **My picnics**. That first account save makes the workflow private to its organizer. The saved account snapshot changes on an explicit save, so guests review the saved version rather than an in-progress conversation. A previous browser-only workflow can be brought into the account with **Save browser plan to My picnics**; older static sample plans can still be viewed locally and used for invitation images. Guests can continue planning and saving a browser copy without signing in. After a successful guest save, an inline **Keep this good day with you** prompt offers email sign-in for access across devices and invitations. **Keep planning as guest** dismisses it for that picnic in the current tab. The Saved plan page also retains a sign-in link; chat and place research are not interrupted by mandatory login. Private account plans and invitations require verified sign-in; existing public review links still work without it. Account saves that fail keep a browser copy where possible and show the failure.

Organizers can use **Which picnic are we planning? 🧺** on My Picnic, the planner, Your picnic, Choose food options, Saved plan and the invite editor. Options show the venue, picnic date, guest count and saved timestamp. Selection travels in page URLs so editing, food, feedback and saved snapshots stay scoped to that plan. Saved plan reads the selected account snapshot without updating its saved timestamp or overwriting another browser copy. Unsent messages, open detail editors, invitation drafts and selected-but-unsaved food choices must be completed or cleared before switching. Refresh plans retrieves newly saved account plans. Invited guests retain their view/comment account page without organizer dropdown controls.

On an account plan, **Bring your picnic crew** accepts up to 25 guest emails per batch; additional batches can be sent. Guests must verify their invitation before access is granted. They can view the saved plan and post feedback; only the organizer can edit, finalize, invite others, or remove access. The guest view retains **What does the crew think?** and its response form. Organizers see **Your crew’s feedback** with each guest’s latest response, comment, timestamp and response counts in **My Picnic**. **Your picnic** shows a compact response summary with a link to the full feedback. Both views have a refresh button and no organizer response form. Guests do not receive the workflow control token, original prompt, participant list, or private notes. Removing a member immediately blocks plan access and invalidates outstanding invitation links. Existing public **Share for review** links remain possession-based public snapshots and are separate from private group access.

Sign-in links expire in 15 minutes; invitation links expire in 48 hours. Each link is single-use and stored as a SHA-256 digest. Session tokens are also random and stored as digests, last seven days, rotate on sign-in, and are sent in HttpOnly/SameSite cookies (Secure on the public HTTPS origin). Sign-out revokes the current session and clears this browser’s plan copies and conversation references; server plans remain saved. Account switches and expired sessions also clear copies belonging to a different account. Email identity is normalized to lowercase ASCII email addresses; internationalized mailbox addresses are not currently supported.

The APIs apply persistent request limits, require a custom same-origin request header on state-changing account actions, check organizer/member access on every private operation, and disable caching for private responses. These choices use the [OWASP token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), and [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Keep one Uvicorn worker for graph serialization and persistent storage for both SQLite files. Account functionality does not add payment processing or subscription billing.

## Picnic invites for WhatsApp

**Create a Picnic Invite 🧺** replaces the JSON export buttons in Your picnic and Saved plan; it is also available in the organizer’s account plan view. The editor at `/invite.html` creates a 1080 × 1350 PNG with the same artwork shown in its live preview. The heading, message, date, start time, venue and two food highlights can be edited without changing the picnic plan. The time starts blank and appears as **Time to be confirmed** until entered. Draft edits remain in this tab’s session storage. Open it from a picnic or select an account plan in its dropdown. Invite wording is kept separately for each workflow in this tab; switching plans restores that plan’s wording when its source date, venue and food highlights still match.

Use **Download invite image** to save the PNG and attach it in WhatsApp. **Copy WhatsApp caption** copies the visible details as text. Where the browser supports file sharing, **Share invite** opens the device’s own share chooser; the app never chooses a recipient or sends a WhatsApp message automatically.

Only selected public display fields feed the artwork and caption. Original notes, participant emails, starting addresses, costs and workflow control tokens are omitted. An optional QR code is available only for an existing, same-origin **public review** link whose snapshot matches the selected plan. Creating an invite does not publish a plan, send email, or create a public link. Login/invitation tokens and private workflow URLs are never QR targets. The QR is off by default and disabled for localhost links, unavailable snapshots, a different saved version, or changed invite date/venue/food details. Host the app at a guest-reachable address and explicitly use **Share for review** to make a matching QR available.

The canvas uses locally served picnic artwork and a vendored MIT-licensed [qrcode-generator 2.0.4](https://github.com/kazuhikoarase/qrcode-generator). Encoder provenance, integrity hash and license are recorded in `frontend/vendor/`; no external QR service or runtime CDN receives plan links. There are no new Python dependencies or provider calls for invitation artwork.

## Additional picnic services

**Contact B&B** (`/services.html`) presents Just Fun, Go with Saved Plan, and Pick & Choose packages. Just Fun describes a 10% service fee based on each guest’s estimated picnic cost, with final charges confirmed in a quote. The page is informational; it does not book services, bill a subscription, or change picnic budget allowances. The phone number and `.example` email shown are explicitly marked demo contact details; replace them in `frontend/services.html` before launch.

## LangGraph implementation

```mermaid
flowchart TD
    A[User input] --> B[Groq: collect details]
    B --> C{Required details valid?}
    C -- No --> D[HITL: missing details]
    D --> B
    C -- Yes --> E[Tavily: search and source places]
    E -- No supported places --> D
    E -- Places found --> F[HITL: select place]
    F -- Revise --> B
    F -- Select --> G[Groq: generate plan]
    G --> H[Python: validate estimates]
    H --> FOOD[HITL: shop or order food]
    FOOD -- Choose food option --> I[HITL: review and approve]
    FOOD -- Revise picnic --> B
    I -- Revise --> B
    I -- Approved --> J[HITL: share decision]
    J -- Revise --> B
    J -- Change food --> FOOD
    J -- Share --> K[Persist immutable review snapshot]
```

`backend/workflow.py` defines a real `StateGraph`, conditional edges, `interrupt()` calls and `Command(resume=...)`. Each checkpoint persists to SQLite. The browser retains a random thread token and restores the current pause or result after refresh. A failed provider node can be retried without repeating completed graph nodes. Same-thread operations are serialized within this single-process app; use one Uvicorn worker for this local implementation.

Graph state includes validated picnic details, the pending question, researched venues, selected venue, generated plan and sharing status. Search results are reused when location, distance, guest count and notes are unchanged. Groq extracts supported places only from Tavily excerpts; source URLs must exactly match retrieved results. Unknown distance, capacity and fees stay unknown.

`backend/providers.py` handles bounded, timed server-side API calls, JSON validation, safe source links and readable errors for missing keys, rate limits and provider failures. There is no automatic fallback to invented venues or the old local parser when providers fail.

`POST /api/chat` starts or resumes a thread with `message`, `today`, `thread_id`, and an action (`message`, `select`, `food`, `approve`, `share`). `GET /api/workflows/{thread_id}` restores it. `POST /api/workflows/{thread_id}/food-options` searches food businesses with `mode` (`shop` or `order`) and `near` (`venue` or `start`). Food search results are cached for one hour per workflow, picnic context, mode and search area. The `food` action accepts the mode, area, search ID and option ID; business details are resolved from server results, not client-supplied business objects. Changed picnic details or expired searches require a fresh search. Approval and sharing use the server's checkpointed plan; the frontend cannot submit an edited plan to bypass approval.

`backend/conversation.py`, `POST /api/plans` and the original sample sharing endpoint remain for legacy sample compatibility and regression tests. The current chat interface uses the LangGraph endpoints instead.

## Estimates and research limits

Tavily performs web search, not map routing or reservation lookup. Suggested places are candidates near the requested area; exact travel distance, capacity, fees, hours and date-specific availability require direct verification. Official park sources are preferred but not guaranteed. LLM extraction and summaries can be mistaken, so review linked sources.

Budgets are transparent planning allowances calculated in Python: food 60%, supplies 12%, and venue allowance up to 10% capped at $100. They are not real quotes or known venue fees. Groq uses dietary and activity requirements when generating suggestions, but dietary safety and ingredient suitability are not verified. Weather and reservations are not integrated. No email, invitation or calendar event is sent automatically. Provider use is subject to your accounts' quotas and pricing.

## Sharing and persistence

Anyone with a review link can view its snapshot and feedback and respond without an account. Links are possession-based; responses are self-reported and unauthenticated. Snapshots exclude raw prompt, full guest-name list and private notes fields; generated plan content and coordination roles remain visible. Treat generated content as public once shared.

The backend stores:

- `data/workflow.sqlite3`: graph checkpoints, including private picnic details and notes. Override with `PICNIC_GRAPH_DB_PATH`.
- `data/picnics.sqlite3`: shared snapshots, group feedback, food-search results, accounts, token digests, sessions, private saved plans, invitations and private group feedback. Override with `PICNIC_DB_PATH`.

Keep these files on persistent storage. New picnic clears the browser's active reference but does not delete stored checkpoints. Guest workflow tokens permit access to and control of an unsaved guest workflow; keep them private. Account-owned workflows also require the organizer’s verified session. Group review tokens give read/feedback access to their immutable public snapshot. Checkpoints and saved plans do not expire automatically; email links and account sessions do.

A `127.0.0.1` link works only on your device. To share on Wi-Fi, bind the server to `0.0.0.0`, open it with your computer's LAN IP and create the link there. For remote groups, host behind HTTPS at a reachable address. This change does not deploy the app.

## Verification

```sh
python3 -m unittest discover -s tests -v
```

With Node.js installed, run the frontend display regression tests:

```sh
node --test tests/test_plan_ui.cjs tests/test_food_ui.cjs tests/test_planner_actions.cjs tests/test_account_ui.cjs tests/test_invite.cjs tests/test_plan_picker.cjs
```

Tests exercise the actual compiled graph with mocked providers: missing-detail interrupts, checkpoint restoration, selection, generation, approval gates, low-budget blocking, revisions, cached searches, provider retry, session isolation, canonical sharing, source validation and feedback privacy, plus email-link replay/expiry, session revocation, SMTP failure, local-preview restrictions, CSRF protection, private plan ownership, canonical account saves, guest permissions, invitations and access removal. Frontend cases exercise email confirmation, previews, account switches, asynchronous account saves and the guest feedback view, invite field privacy, public QR matching, stale-link rejection, text wrapping and QR rendering. Browser checks cover place cards, reload/resume, approval gating, share review and mobile layouts. Mocked checks use no provider credits; live testing requires configured keys.

`preview/index.html` contains captured UI screens. LangGraph fixture screenshots are explicitly labeled as using mocked provider data. Fonts use Google Fonts with system fallbacks.


# Flow and Detail
Component	Responsibility
Frontend	Chat, place choices, plan preview, approval, sharing and feedback
FastAPI	Receives requests, validates input and serves the app
LangGraph	Coordinates steps, pauses for human input and resumes workflows
Groq LLM	Extracts details, summarizes search results and generates the plan
Tavily	Searches the web for picnic places and source links
Python validation	Checks required details, date, limits and budget allowances
SQLite	Stores workflow checkpoints, shared plans and feedback

The required details are budget, guest count, food preference, starting location, date, and travel distance.

The BLANKET & BITES branding and locally served picnic photographs are retained from the feature branch. Photographs are AI-generated; see `frontend/images/ARTWORK.md`.
