# Veshannastro — Free, Always-Awake Astrology Widget

An embeddable chat widget for veshannastro.co.in. Visitors get a free Vedic
reading, ask **3 free questions**, then pay a small fee (default ₹19) per
question via Razorpay. Built to run **completely free** and **always awake**.

The stack, all on free tiers:
- **GitHub** — holds your code
- **Render** (free) — runs the backend, gives you a public HTTPS link
- **Google Gemini** (free) — the AI brain, no GPU, no per-message cost
- **Neon** (free) — Postgres database where all user data lives, survives restarts
- **UptimeRobot** (free) — pings the backend so it never sleeps
- **Razorpay** — payments (card/UPI data never touches your server)

---

## WHERE USER DATA LIVES (the short answer)
- **Visitor's browser:** only a random `session_id`. No personal data.
- **Neon Postgres (your cloud database):** name, birth details, computed chart,
  full conversation, free/paid question counts, lead flag, total paid. This is
  where all user data is settled once deployed.
- **Razorpay:** all payment data. Your server only gets a payment id + signature
  to verify.

---

## Deploy it (one-time, ~45 min). Five phases.

### Phase 1 — Get your free keys (do these first)
1. **Gemini key:** go to https://aistudio.google.com/apikey, sign in with
   Google, click *Create API key*. Copy it. (No credit card.)
2. **Neon database:** sign up at https://neon.tech, create a project, and copy
   the *connection string* (starts with `postgresql://`).
3. **Razorpay keys:** in your Razorpay dashboard > Settings > API Keys, generate
   keys. Use **test** keys (`rzp_test_`) first; switch to **live** when ready.

### Phase 2 — Put the code on GitHub
1. Create a new **private** repo on GitHub (e.g. `veshannastro-bot`).
2. Upload all these files to it (drag-and-drop in the GitHub web UI works, or
   use git). The included `.gitignore` keeps your secrets out of the repo.

### Phase 3 — Deploy on Render (free)
1. Sign up at https://render.com with your GitHub account (no card needed).
2. Click **New +** > **Blueprint**, pick your repo. Render reads `render.yaml`
   and sets everything up.
3. In the service's **Environment** tab, fill in the secret values:
   - `GEMINI_API_KEY` — from Phase 1
   - `DATABASE_URL` — your Neon connection string from Phase 1
   - `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` — from Phase 1
   - `ADMIN_KEY` — make up a long random string (protects your leads list)
4. Deploy. After a few minutes you'll get a public URL like
   `https://veshannastro-bot.onrender.com`. Open it to test the widget.

### Phase 4 — Keep it always awake (free)
Render's free service sleeps after 15 min idle. To prevent that:
1. Sign up at https://uptimerobot.com (free).
2. Add a new monitor of type **HTTP(s)**, URL =
   `https://YOUR-RENDER-URL/healthz`, checking interval **every 5 minutes**.
That ping keeps the backend awake (and warms the Neon database too). Staying
awake all month uses ~730 hours, under Render's free 750-hour allowance.

### Phase 5 — Embed in your website
On veshannastro.co.in, just before the closing `</body>` tag, add:

    <script src="https://YOUR-RENDER-URL/widget.js"></script>

Save and upload. The "Free Consultation" button now appears on your site.

---

## Test locally first (optional but smart)
    python3 -m venv venv && source venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env        # fill in GEMINI_API_KEY + Razorpay test keys
    # leave DATABASE_URL blank -> uses a local SQLite file
    uvicorn server:app --reload --port 8000
Open http://localhost:8000.

## Settings (.env / Render env vars)
- `FREE_QUESTIONS` (default 3), `PRICE_PER_QUESTION_INR` (default 19)
- `ALLOWED_ORIGINS` — your site domain(s)
- `GEMINI_MODEL` — if Google retires the default, set the current free Flash
  model from https://ai.google.dev/gemini-api/docs/models
- `DATABASE_URL` — blank = SQLite (local); Neon URL = cloud (production)
- `ADMIN_KEY` — protects `/api/leads`

## See your leads
    curl -H "X-Admin-Key: YOUR_ADMIN_KEY" https://YOUR-RENDER-URL/api/leads

## Files
| File | Role |
|------|------|
| `server.py` | Backend: chat, wizard, paywall, Razorpay, leads, /healthz |
| `widget.js` | The embeddable widget (celestial theme) |
| `astrology.py` | Real Vedic chart math (Swiss Ephemeris) |
| `ai.py` | The astrologer brain (Gemini free tier) |
| `database.py` | Storage (SQLite locally, Neon Postgres in production) |
| `render.yaml` | Render deploy blueprint |
| `demo.html` | Preview page (served at `/`) |

## Notes
- One free caveat: after a quiet spell the very first visitor may wait ~30–60s
  while Render wakes (the UptimeRobot ping makes this rare). Later you can pay
  $7/month to remove sleep entirely.
- The chart math is genuine; the wording is AI-generated. Tune Vesha's voice in
  `ai.py` (`SYSTEM_PROMPT`) before charging clients.
