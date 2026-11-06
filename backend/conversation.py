"""Local conversation parsing for the sample planner; no model or live tools."""
import re
from datetime import date, timedelta


def interpret(message: str, previous: dict, today: date | None = None) -> dict:
    today = today or date.today()
    state = {k: v for k, v in previous.items() if k in {
        'date', 'guests', 'location', 'budget', 'distance_miles',
        'food_category', 'dietary_preferences', 'selected_venue', 'awaiting_field'}}
    text = message.strip()
    # Interpret short answers in the context of the last question.
    awaiting = state.pop('awaiting_field', None)
    if re.fullmatch(r'[\d,]+(?:\.\d+)?', text):
        if awaiting == 'budget':
            text = 'budget ' + text
        elif awaiting == 'guests':
            text += ' people'
    elif awaiting == 'location' and not re.search(r'\b(?:near|in|from|budget|people|guests|tomorrow|today)\b|\$|\d{4}-', text, re.I):
        text = 'near ' + text
    lower = text.lower()
    recognized = False
    patterns = {
        'guests': r'(\d+)\s*(?:people|guests|persons|attendees)',
        'budget': r'\$\s*([\d,]+(?:\.\d+)?)|(?:budget(?:\s+of|\s+is|\s+to)?\s*[:=]?\s*)([\d,]+(?:\.\d+)?)',
        'distance_miles': r'(\d+)\s*miles?',
    }
    limits = {'guests': (1, 500), 'budget': (1, 100000), 'distance_miles': (5, 100)}
    for key, pattern in patterns.items():
        match = re.search(pattern, lower)
        if match:
            value = float(next(g for g in match.groups() if g is not None).replace(',', ''))
            lo, hi = limits[key]
            if not lo <= value <= hi:
                return {'state': {**state, **({'awaiting_field': awaiting} if awaiting else {})}, 'reply': f'Please use a {key.replace("_", " ")} between {lo} and {hi}.', 'ready': False}
            state[key] = value if key == 'budget' else int(value)
            recognized = True
    location = re.search(r'\b(?:near|in|from|location\s*(?:is|:))\s+(.+?)(?=\s+(?:on|next|this|tomorrow|today|for|with|within|under|budget|and|at)\b|[.!?;\n]|$)', text, re.I)
    if location:
        state['location'] = location.group(1).strip(' ,')[:200]
        recognized = True
    chosen_date = None
    iso = re.search(r'\b(\d{4}-\d{2}-\d{2})\b', text)
    if iso:
        try:
            chosen_date = date.fromisoformat(iso.group(1))
        except ValueError:
            return {'state': {**state, 'awaiting_field': 'date'}, 'reply': 'Please enter a valid date as YYYY-MM-DD.', 'ready': False}
    elif 'tomorrow' in lower:
        chosen_date = today + timedelta(days=1)
    elif re.search(r'\btoday\b', lower):
        chosen_date = today
    else:
        for i, day in enumerate(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']):
            if day in lower:
                chosen_date = today + timedelta(days=(i - today.weekday()) % 7 or 7)
                break
    if chosen_date:
        if chosen_date < today:
            return {'state': {**state, 'awaiting_field': 'date'}, 'reply': 'Please choose today or a future picnic date.', 'ready': False}
        state['date'] = chosen_date.isoformat()
        recognized = True
    diets = [name for name in ['Vegetarian', 'Vegan', 'Gluten-free', 'Nut-free'] if re.search(r'\b' + re.escape(name.lower()) + r'\b', lower)]
    if re.search(r'\bnon[- ]?(?:vegetarian|veg)\b', lower):
        diets = [d for d in diets if d != 'Vegetarian']
    if diets:
        state['dietary_preferences'] = diets
        if 'Vegan' in diets or 'Vegetarian' in diets:
            state['food_category'] = 'Vegan' if 'Vegan' in diets else 'Vegetarian'
        recognized = True
    if re.search(r'\b(?:mixed|no dietary restrictions|non[- ]?(?:vegetarian|veg)|both|anything)\b', lower):
        state.update(food_category='Mixed', dietary_preferences=[])
        recognized = True
    if 'cheaper' in lower or 'reduce the budget' in lower:
        if state.get('budget') and not re.search(patterns['budget'], lower):
            state['budget'] = max(1, round(state['budget'] * .8, 2))
            recognized = True
    for terms, venue in [(('covered', 'pavilion'), 'covered'), (('shade', 'shaded', 'oak'), 'oak'), (('meadow', 'open lawn'), 'meadow')]:
        if any(term in lower for term in terms):
            state['selected_venue'] = venue
            recognized = True
    questions = [
        ('budget', 'What is your total picnic budget? For example, $1,000.'),
        ('guests', 'How many people will be joining the picnic?'),
        ('food_category', 'What food option would you like: Vegetarian, Vegan, or Mixed (vegetarian and non-vegetarian)? You can also mention allergies or dietary preferences.'),
        ('location', 'Where will you be starting from? Enter a city or area, for example San Ramon, CA.'),
        ('date', 'When would you like the picnic? For example, next Saturday or a date as YYYY-MM-DD.'),
    ]
    for key, question in questions:
        if not state.get(key):
            state['awaiting_field'] = key
            return {'state': state, 'reply': question, 'ready': False}
    if not recognized:
        return {'state': state, 'reply': 'I can update the guest count, location, date, budget, distance, dietary preferences, or venue style. Try “make it cheaper” or “choose covered seating”. Use Edit details for precise changes. Other requests are not applied by this local demo.', 'ready': False}
    state.setdefault('distance_miles', 30)
    state.setdefault('food_category', 'Mixed')
    state.setdefault('dietary_preferences', [])
    return {'state': state, 'reply': f"Your draft is ready, with a {state['distance_miles']}-mile travel limit. Review the details and sample estimates, then share the plan with your group. You can also ask me to revise it.", 'ready': True}
