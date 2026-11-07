"""Source-backed food searches and canonical selections for a workflow."""
import hashlib
import json
import secrets
import time
from contextlib import closing
from backend import providers
from backend.sharing import connect


MAX_AGE = 3600


def context_key(plan):
    request = plan['request']
    context = {
        'search_version': 2,
        'venue': next(v for v in plan['venues'] if v['id'] == plan['selected_venue']),
        'details': {key: request.get(key) for key in ('location', 'date', 'guests', 'budget', 'distance_miles', 'food_category', 'dietary_preferences')},
        'allowance': plan['budget']['Food & drinks'],
    }
    return hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest()


def database():
    db = connect()
    db.execute('''CREATE TABLE IF NOT EXISTS food_searches (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, context_key TEXT NOT NULL,
        mode TEXT NOT NULL, near_location TEXT NOT NULL, options TEXT NOT NULL, created_at REAL NOT NULL)''')
    db.commit()
    return db


def find_options(thread_id, plan, mode, near):
    key = context_key(plan)
    with closing(database()) as db:
        row = db.execute('''SELECT id, options FROM food_searches
            WHERE thread_id=? AND context_key=? AND mode=? AND near_location=? AND created_at>?
            ORDER BY created_at DESC LIMIT 1''', (thread_id, key, mode, near, time.time()-MAX_AGE)).fetchone()
    if row:
        return {'search_id': row[0], 'options': json.loads(row[1]), 'cached': True}
    venue = next(v for v in plan['venues'] if v['id'] == plan['selected_venue'])
    options = providers.search_food(plan['request'], venue, mode, near)
    search_id = secrets.token_urlsafe(24)
    with closing(database()) as db, db:
        db.execute('INSERT INTO food_searches VALUES (?, ?, ?, ?, ?, ?, ?)',
                   (search_id, thread_id, key, mode, near, json.dumps(options), time.time()))
    return {'search_id': search_id, 'options': options, 'cached': False}


def resolve_choice(thread_id, plan, payload):
    mode, near = payload.get('food_mode'), payload.get('food_near', 'venue')
    if mode not in ('shop', 'order') or near not in ('venue', 'start'):
        raise ValueError('Choose shopping or ordering and a search location.')
    search_id, option_id = payload.get('food_search_id'), payload.get('food_option_id')
    if bool(search_id) != bool(option_id):
        raise ValueError('Choose a food option from the current search results.')
    business = None
    if search_id:
        with closing(database()) as db:
            row = db.execute('''SELECT options, created_at FROM food_searches
                WHERE id=? AND thread_id=? AND context_key=? AND mode=? AND near_location=?''',
                (search_id, thread_id, context_key(plan), mode, near)).fetchone()
        if not row or row[1] <= time.time()-MAX_AGE:
            raise ValueError('These food options have expired or the picnic details changed. Search again.')
        business = next((item for item in json.loads(row[0]) if item['id'] == option_id), None)
        if not business:
            raise ValueError('Choose a food option from the current search results.')
    return {'mode': mode, 'near': near, 'business': business}


def apply_choice(plan, choice):
    import copy
    updated = copy.deepcopy(plan)
    updated.setdefault('ingredient_list', list(updated['shopping_list']))
    selections = dict(updated.get('food_selections', {}))
    previous = updated.get('food_selection')
    if previous and previous.get('mode') in ('shop', 'order'):
        selections.setdefault(previous['mode'], previous)
    selections[choice['mode']] = choice
    updated['food_selections'] = selections
    # Keep the most recently edited choice for older clients and checkpoints.
    updated['food_selection'] = choice
    updated['food_source'] = 'Grocery + Restaurant / catering' if len(selections) == 2 else 'Grocery / self catered' if 'shop' in selections else 'Restaurant / catering'
    ordering_tasks = [
        'Confirm the restaurant menu, quantities and dietary requirements for all guests.',
        'Arrange and pay for pickup or delivery directly with the restaurant.',
        'Pack plates, cutlery, napkins, drinking water and suitable food carriers.',
    ]
    updated['shopping_list'] = list(updated['ingredient_list']) if 'shop' in selections else []
    if 'order' in selections:
        updated['shopping_list'] = list(dict.fromkeys([*updated['shopping_list'], *ordering_tasks]))
    updated['status'] = 'pending_approval' if all(updated['checks'].values()) else 'needs_revision'
    return updated
