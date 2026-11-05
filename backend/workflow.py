"""Persistent LangGraph orchestration with explicit human-in-the-loop checkpoints."""
import copy
import os
import re
import secrets
import sqlite3
import threading
from datetime import date
from pathlib import Path
from typing import TypedDict, Literal
from pydantic import BaseModel, Field, ValidationError, ConfigDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.sqlite import SqliteSaver
from backend import providers
from backend.planner import build_plan
from backend.sharing import create_share


class Details(BaseModel):
    model_config = ConfigDict(extra='ignore')
    date: str | None = None
    guests: int | None = Field(default=None, ge=1, le=500)
    location: str | None = Field(default=None, min_length=1, max_length=200)
    budget: float | None = Field(default=None, ge=1, le=100000, allow_inf_nan=False)
    distance_miles: int | None = Field(default=None, ge=5, le=100)
    food_category: Literal['Vegetarian', 'Vegan', 'Mixed'] | None = None
    dietary_preferences: list[str] = Field(default_factory=list, max_length=20)
    notes: str = Field(default='', max_length=4000)


class State(TypedDict, total=False):
    message: str
    today: str
    details: dict
    question: str
    pending_field: str
    places: list
    selected: str
    plan: dict
    reply: str
    stage: str
    action: str
    search_key: str
    shared: dict
    share_token: str


def collect(s):
    raw = providers.extract(s['message'], {'details': s.get('details', {}), 'pending_question': s.get('question', '')}, s['today'])
    updates = raw.get('details', {})
    if not isinstance(updates, dict):
        updates = {}
    updates = {k: v for k, v in updates.items() if v is not None}
    # Simple numeric answers must not depend on probabilistic model extraction.
    pending = s.get('pending_field', '')
    question = s.get('question', '').lower()
    if not pending:  # Also support workflows checkpointed before this field existed.
        if re.search(r'guest|people|attend', question):
            pending = 'guests'
        elif 'budget' in question:
            pending = 'budget'
        elif re.search(r'mile|distance', question):
            pending = 'distance_miles'
    text = s['message'].strip().lower()
    explicit_guests = re.fullmatch(r'(\d+)\s*(?:guests?|people|persons?|attendees?)\.?', text)
    number = re.fullmatch(r'\$?\s*([\d,]+(?:\.\d+)?)', text)
    if explicit_guests:
        updates['guests'] = int(explicit_guests.group(1))
    elif number and pending in ('guests', 'budget', 'distance_miles'):
        updates[pending] = float(number.group(1).replace(',', ''))
    # Normalize common model formatting without silently changing invalid values.
    for key in ('guests', 'budget', 'distance_miles'):
        value = updates.get(key)
        if isinstance(value, str):
            value = value.strip().replace(',', '')
            if key == 'budget':
                value = value.removeprefix('$').strip()
            if re.fullmatch(r'\d+(?:\.\d+)?', value):
                updates[key] = float(value)
    if isinstance(updates.get('food_category'), str):
        food = updates['food_category'].strip().lower()
        updates['food_category'] = {'vegetarian': 'Vegetarian', 'vegan': 'Vegan', 'mixed': 'Mixed', 'non-vegetarian': 'Mixed'}.get(food, updates['food_category'])
    explicit_date = re.fullmatch(r'\d{4}-\d{2}-\d{2}', s['message'].strip())
    if explicit_date and pending == 'date':
        updates['date'] = s['message'].strip()
    candidate = {**s.get('details', {}), **updates}
    errors = []
    try:
        Details.model_validate(candidate)
    except ValidationError as exc:
        errors = list(dict.fromkeys(str(e['loc'][0]) for e in exc.errors()))
    for field in errors:
        candidate.pop(field, None)
    details = Details.model_validate(candidate).model_dump(exclude_none=True)
    if details.get('date'):
        try:
            if date.fromisoformat(details['date']) < date.fromisoformat(s['today']):
                raise ValueError('past date')
        except (ValueError, TypeError):
            details.pop('date', None)
            errors.append('date')
    if errors:
        field = errors[0]
        hints = {
            'guests': 'How many guests are coming? Enter a whole number from 1 to 500, for example 55.',
            'budget': 'What is your total budget? Enter an amount from $1 to $100,000, for example $1,000.',
            'distance_miles': 'How far are you willing to travel? Enter a whole number from 5 to 100 miles.',
            'date': 'What date would you like the picnic? Choose today or a future date, for example YYYY-MM-DD.',
            'food_category': 'Please choose Vegetarian, Vegan, or Mixed food.',
            'location': 'Please enter a starting city or area, up to 200 characters.',
            'dietary_preferences': 'Please list up to 20 dietary preferences as text.',
            'notes': 'Please shorten the picnic notes to 4,000 characters or fewer.',
        }
        return {'details': details, 'pending_field': field, 'question': hints.get(field, 'Please clarify your picnic details.'),
                'stage': 'details', 'plan': None, 'shared': None}
    labels = {'budget': 'What is your total picnic budget?', 'guests': 'How many people are coming?',
              'food_category': 'Would you like Vegetarian, Vegan, or Mixed food? Any dietary requirements?',
              'location': 'What city or area are you starting from?', 'date': 'What date would you like the picnic?',
              'distance_miles': 'How many miles are you willing to travel?'}
    missing = next((k for k in labels if not details.get(k)), None)
    # Ask only about a field that is actually missing, never a stale model question.
    question = labels[missing] if missing else ''
    return {'details': details, 'question': question, 'pending_field': missing or '', 'stage': 'details' if missing else 'search', 'plan': None, 'shared': None}


def ask(s):
    answer = interrupt({'stage': 'details', 'reply': s['question']})
    return {'message': answer.get('message', ''), 'today': answer.get('today', s['today'])}


def research(s):
    d = s['details']
    key = '|'.join(str(d.get(k, '')) for k in ('location', 'distance_miles', 'guests', 'notes'))
    places = s.get('places', []) if s.get('search_key') == key and s.get('places') else providers.search(d)
    return {'places': places, 'search_key': key, 'selected': '', 'stage': 'places' if places else 'details',
            'pending_field': '', 'question': '' if places else 'No supported picnic places were found. Try a different starting location or travel distance.'}


def choose(s):
    answer = interrupt({'stage': 'places', 'reply': f"I found {len(s['places'])} picnic places. Choose one to build your plan. Distances, fees and availability need verification.", 'places': s['places']})
    selected = answer.get('venue_id')
    if answer.get('action') == 'select' and any(v['id'] == selected for v in s['places']):
        return {'selected': selected, 'action': 'generate'}
    return {'message': answer.get('message', 'Please revise the search.'), 'today': answer.get('today', s['today']), 'action': 'revise'}


def generate(s):
    details = s['details']
    request = {**details, 'request': details.get('notes', ''), 'travel_minutes': 30, 'participants': []}
    plan = build_plan(request)
    venue = next(v for v in s['places'] if v['id'] == s['selected'])
    plan.update(providers.generate(details, venue, plan['budget']))
    plan.update(venues=[venue], selected_venue=venue['id'], demo=False, food_choices=['Brunch', 'Drinks'], food_source='Grocery / self catered', activities=[])
    plan['checks'] = {'budget': sum(plan['budget'].values()) <= details['budget'], 'food_allowance': plan['budget']['Food & drinks'] / details['guests'] >= 8}
    plan['status'] = 'pending_approval' if all(plan['checks'].values()) else 'needs_revision'
    plan['warnings'] = ([] if plan['checks']['food_allowance'] else ['Food allowance is below $8 per guest. Increase the budget or reduce guests before approval.']) + [
        'Venue descriptions come from web search excerpts. Confirm distance, capacity, availability, fees and opening hours with the park.',
        'Costs are planning allowances, not quotes. Weather and dietary suitability have not been verified.']
    plan['workflow'] = ['Groq details collected', 'Tavily places researched', 'Human selected venue', 'Groq plan generated', 'Python budget validated', 'Awaiting human approval']
    return {'plan': plan, 'stage': 'approval'}


def review(s):
    answer = interrupt({'stage': 'approval', 'reply': 'Your plan is ready. Review it, request changes, or approve it before sharing.', 'plan': s['plan']})
    if answer.get('action') == 'approve' and s['plan']['status'] != 'needs_revision':
        plan = copy.deepcopy(s['plan'])
        plan['status'] = 'approved'
        return {'plan': plan, 'action': 'approved', 'share_token': secrets.token_urlsafe(24)}
    if answer.get('action') == 'approve':
        return {'action': 'blocked'}
    return {'message': answer.get('message', ''), 'today': answer.get('today', s['today']), 'action': 'revise'}


def share_gate(s):
    answer = interrupt({'stage': 'share', 'reply': 'Plan approved. Select Share for review to create a group review link, or ask for changes.', 'plan': s['plan']})
    if answer.get('action') == 'share':
        return {'action': 'share'}
    return {'action': 'revise', 'message': answer.get('message', ''), 'today': answer.get('today', s['today'])}


def publish(s):
    snapshot = copy.deepcopy(s['plan'])
    snapshot['request'].pop('request', None)
    snapshot['request'].pop('participants', None)
    snapshot['request'].pop('notes', None)
    token = create_share(snapshot, token=s['share_token'])
    return {'shared': {'token': token, 'path': f'/review.html#{token}'}, 'stage': 'shared', 'reply': 'Your review link is ready. Copy it and send it to your group.'}


def build_graph(checkpointer):
    g = StateGraph(State)
    for name, fn in [('collect', collect), ('ask', ask), ('research', research), ('choose', choose), ('generate', generate), ('review', review), ('share_gate', share_gate), ('publish', publish)]:
        g.add_node(name, fn)
    g.add_edge(START, 'collect')
    g.add_conditional_edges('collect', lambda s: 'ask' if s['question'] else 'research')
    g.add_edge('ask', 'collect')
    g.add_conditional_edges('research', lambda s: 'choose' if s['places'] else 'ask')
    g.add_conditional_edges('choose', lambda s: 'generate' if s['action'] == 'generate' else 'collect')
    g.add_edge('generate', 'review')
    g.add_conditional_edges('review', lambda s: 'share_gate' if s['action'] == 'approved' else 'review' if s['action'] == 'blocked' else 'collect')
    g.add_conditional_edges('share_gate', lambda s: 'publish' if s['action'] == 'share' else 'collect')
    g.add_edge('publish', END)
    return g.compile(checkpointer=checkpointer)


_lock = threading.Lock()

def run(thread_id, payload=None, read_only=False):
    path = Path(os.getenv('PICNIC_GRAPH_DB_PATH', Path(__file__).resolve().parents[1] / 'data' / 'workflow.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock, sqlite3.connect(path, check_same_thread=False) as db:
        graph = build_graph(SqliteSaver(db))
        config = {'configurable': {'thread_id': thread_id}}
        before = graph.get_state(config)
        if not read_only:
            if before.values:
                if not before.next:
                    raise ValueError('This workflow is complete. Start a new picnic to make another plan.')
                # Resume only pending interrupts. Failed provider nodes are retried without consuming a new response.
                pending = any(task.interrupts for task in before.tasks)
                if pending:
                    pause = next(i.value for task in before.tasks for i in task.interrupts)
                    allowed = {'details': {'message'}, 'places': {'message', 'select'}, 'approval': {'message', 'approve'}, 'share': {'message', 'share'}}
                    if payload.get('action') not in allowed.get(pause['stage'], set()):
                        raise ValueError('Complete the current human review step before continuing.')
                    if payload.get('action') == 'select' and not any(v['id'] == payload.get('venue_id') for v in before.values.get('places', [])):
                        raise ValueError('Choose one of the researched places.')
                graph.invoke(Command(resume=payload) if pending else None, config)
            else:
                if payload.get('action') != 'message':
                    raise ValueError('Start by describing your picnic.')
                graph.invoke({'message': payload['message'], 'today': payload['today'], 'details': {}}, config)
        saved = graph.get_state(config)
        if not saved.values:
            raise KeyError('Unknown workflow.')
        out = {k: saved.values.get(k) for k in ('stage', 'reply', 'plan', 'shared')}
        for task in saved.tasks:
            for pause in task.interrupts:
                out.update(pause.value)
        out.update(thread_id=thread_id, state=saved.values.get('details', {}))
        return out
