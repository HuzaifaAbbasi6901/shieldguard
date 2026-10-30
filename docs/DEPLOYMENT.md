# Deploying / running ShieldGuard — the beginner-friendly guide

Every command below is copy-paste. **Nothing here requires you to paste passwords or
API keys into any chat.** When a step needs a login (GitHub, Vercel), you type the
command yourself in your own terminal and the provider's login flow opens.

---

## 0. What runs where (60-second explainer)

| Part | Where it runs | Why |
|---|---|---|
| **Local agent** (Python) | Always on YOUR computer | It must watch your folders, processes, and network — a website physically cannot do that. It is **not** deployed to Vercel. |
| **Dashboard** (Next.js) | Your browser — either from the live demo on Vercel or locally | Shows alerts and graphs. In Demo Mode it shows simulated data; in Live Mode it talks to the agent on `127.0.0.1:8787`. |

---

## 1. Run everything locally (recommended)

### Prerequisites
- Python **3.10+** → https://www.python.org/downloads/ (tick "Add python.exe to PATH" on Windows)
- Node.js **18.17+** (20 LTS recommended) → https://nodejs.org
- Git (optional, for updates) → https://git-scm.com

### The one command

```bash
# from the shieldguard folder
python run.py
```

First run: it creates a Python virtualenv, installs agent + dashboard dependencies
(a few minutes), starts the agent on `http://127.0.0.1:8787`, starts the dashboard on
`http://localhost:3000`, and opens your browser.

Partial starts: `python run.py --agent` (agent only) · `python run.py --web` (dashboard
only) · `python run.py --check` (install/verify dependencies only). Stop everything
with `Ctrl+C` in the terminal.

### Manual start (if you prefer separate terminals)

```bash
# Terminal 1 — agent
cd agent
python -m venv .venv
# Windows:
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
# macOS/Linux:
# source .venv/bin/activate && pip install -r requirements.txt
# uvicorn app.main:app --host 127.0.0.1 --port 8787

# Terminal 2 — dashboard
cd web
npm install
npm run dev          # open http://localhost:3000
```

The dashboard auto-detects the agent and flips to **Live Mode** (green dot in the top
bar). Click "Connect to my local agent" if it does not happen automatically.

---

## 2. Docker option (optional)

```bash
docker compose up --build
# dashboard: http://localhost:3000   agent: http://127.0.0.1:8787
```

**Important:** a containerized agent can only watch folders you explicitly mount into
the container (edit `docker-compose.yml`), and it cannot see host processes or USB
drives the way a native install can. For real protection prefer `python run.py`.

---

## 3. Publish to GitHub (your own copy)

Log in once — run this yourself in your terminal and follow the prompts (browser opens):

```bash
gh auth login
```

Then:

```bash
cd shieldguard
git init
git add .
git commit -m "Initial commit: ShieldGuard"
git branch -M main

# create the repo and push (rename if "shieldguard" is taken on your account)
gh repo create shieldguard --public --source=. --remote=origin --push \
  --description "Ransomware and data-theft early-warning system with a friendly dashboard"

# add topics
gh repo edit --add-topic cybersecurity --add-topic ransomware-detection \
  --add-topic python --add-topic fastapi --add-topic nextjs --add-topic defensive-security
```

CI (`.github/workflows/ci.yml`) runs automatically: agent `pytest` + dashboard
`lint`/`build`. Check it under the repo's **Actions** tab, or:

```bash
gh run list --limit 3
gh run watch      # watch the latest run live
```

---

## 4. Deploy the dashboard to Vercel

> Only `/web` goes to Vercel. The Python agent cannot run there — serverless functions
> cannot watch files on your computer. The deployed site runs in Demo Mode and can
> still connect to your local agent from your browser.

Log in once (your own terminal):

```bash
vercel login
```

Then deploy:

```bash
cd web
vercel link --project shieldguard --yes     # first time only
vercel --prod
```

Vercel prints the production URL (e.g. `https://shieldguard-<you>.vercel.app`).
Alternative (no CLI): github.com → **Import Project** → pick your fork → set
**Root Directory** to `web` → Deploy. Connecting the Git integration makes every push
to `main` auto-deploy.

Optional environment variable (Project → Settings → Environment Variables):

```
NEXT_PUBLIC_AGENT_URL = http://127.0.0.1:8787
```

---

## 5. Verify after deploying

1. Open the production URL → you should see the Dashboard in **Demo Mode** (amber badge).
2. **Safe Simulator** → "Simulate ransomware behavior" → within seconds a red
   full-screen alert appears; the Live Monitor graph spikes. Press Stop. Nothing outside
   the sandbox folder was touched.
3. Start your local agent (`python run.py --agent`) → on the deployed site click
   **"Connect to my local agent"** → badge turns green **Live**.
4. Run the simulator again in Live Mode — events now come from your machine.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 8787 is already in use` | Another ShieldGuard instance is running. Stop it, or set `SHIELDGUARD_PORT` in `agent/.env` (and `NEXT_PUBLIC_AGENT_URL` for the dashboard) to e.g. 8788. |
| Dashboard says "agent not detected" | Is it running? Test: open `http://127.0.0.1:8787/api/health` in your browser — you should see `{"ok": true, ...}`. Then press "Connect to my local agent" in the dashboard. |
| Chrome/Edge blocks the local agent from the Vercel site | This is Chrome's **Private Network Access** protection (https site → localhost). Use Chrome/Edge ≥ 104 (preflight supported; the agent answers it), or run the dashboard locally (`python run.py --web`) where no cross-network request is involved. Safari is stricter — Safari users should run the dashboard locally. |
| `npm run build` fails on old Node | Upgrade to Node 20 LTS. |
| Agent can't suspend a process (Panic) | Windows/macOS may require running the terminal **as administrator**. Suspension is best-effort; the snapshot backup still runs. |
| Disabling the network did nothing (Panic) | The toggle is off by design (Settings → Panic). It needs admin rights: Windows (`netsh`), Linux (`nmcli`), macOS (`networksetup`). Undo instructions are shown in the Panic result panel. |
| Desktop notifications don't appear | Windows: allow notifications for Python/terminal in system settings. Or keep in-app + sound alerts. |
| Too many false positives | Settings → add the noisy app to the **Allowlist**, or switch preset to Relaxed. |
| I want to delete everything | Dashboard → Settings → "Clear all data" (wipes the event DB); delete the `agent/data` folder for a full reset. |

---

## 7. Updating

```bash
cd shieldguard
git pull
python run.py --check     # refresh dependencies
python run.py
```
