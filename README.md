# BLANKET & BITES !! — Smart Picnic Planner

A responsive HTML/CSS/JavaScript UI served by a Python FastAPI backend. No Node.js or frontend build step is required.

## Run locally

From this project directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. API documentation is at http://127.0.0.1:8000/docs.

## Host on Render

The repository includes a `render.yaml` Blueprint for one free Python web service.
FastAPI serves both the frontend and API, so no separate frontend hosting or
database is needed for this demo. `.python-version` selects Python 3.13.

1. Commit and push the deployment files to a GitHub repository you control.
2. Sign in to [Render](https://dashboard.render.com/) and choose **New > Blueprint**.
3. Connect that repository and review the `blanket-and-bites` service on the **Free** plan.
4. Deploy the Blueprint. Render installs `requirements.txt`, starts Uvicorn on its
   assigned `$PORT`, and checks `/api/health`.
5. Open the HTTPS URL shown in the service dashboard. Verify that `/api/health`
   returns `{"status":"ok","mode":"demo"}` and create a sample plan from the homepage.

Free services sleep after 15 minutes without traffic and can take about a minute
to wake up. See [Render's free-service limits](https://render.com/docs/free).
Saved plans stay in each visitor's browser; plans saved on localhost will not
appear at the hosted URL. Deployment does not add live venue or weather data.

## Current functionality

- Responsive planning form: date, guests, starting location, budget, travel limit and dietary preferences.
- FastAPI request validation and a deterministic sample planning workflow.
- Three illustrative venue choices, menu, budget calculation, schedule, shopping list, assignments and backup plan.
- A low food allowance blocks approval and asks for revised inputs.
- Approve locally, save one plan in browser storage, and export a JSON plan.

This version uses **sample data**, without live agents, location lookup, weather, reservations, email, calendar integrations or a database. Venue names, capacity and travel estimates are illustrative, not real recommendations. Approval does not execute external actions. Natural-language notes are retained as context; structured form fields control the sample planner. Dietary selections are recorded but ingredients are not verified. Browser saves are local to the current browser/origin and saving replaces the previous plan.

## Next integration points

`backend/planner.py` owns the planning boundary. Replace its sample providers with LangGraph location/weather, food/budget and guest coordination agents, returning the same response shape. Add persistent plan IDs and storage, server-side approval/versioning, tool-backed constraint checks and a bounded re-planning loop before enabling real actions. The current frontend progress indicator describes the sample workflow; it is not a streamed agent trace.

## Verification

```sh
python3 -m unittest discover -s tests -v
```

Fonts load from Google Fonts when available, with system font fallbacks. Picnic photographs are AI-generated and served locally from `frontend/images/`.



## To Run Project

source .venv/bin/activate
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

http://127.0.0.1:8000
