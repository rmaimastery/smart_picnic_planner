# Team-9 Project — Smart Picnic Planner

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

Fonts load from Google Fonts when available, with system font fallbacks. The picnic artwork is CSS and needs no image downloads.
