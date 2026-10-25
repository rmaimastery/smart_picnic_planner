"""Deterministic MVP planning loop. Replace sample providers with agent tools later."""
from datetime import date


def build_plan(request: dict) -> dict:
    guests = request['guests']
    budget = request['budget']
    travel = request['travel_minutes']
    # Reserve budget for supplies and a sample venue before sizing the food budget.
    venue_cost = round(min(100, budget * .1), 2)
    supplies = round(budget * .12, 2)
    food = round(budget * .60, 2)
    total = round(venue_cost + supplies + food, 2)
    feasible = food / guests >= 8
    return {
        'id': f"picnic-{date.today().isoformat()}",
        'status': 'pending_approval' if feasible else 'needs_revision',
        'request': request,
        'demo': True,
        'venues': [
            {'id': 'meadow', 'name': 'Meadow picnic area', 'travel_minutes': min(15, travel), 'capacity': max(40, guests), 'fee': venue_cost, 'features': 'Open lawn · picnic tables · restrooms'},
            {'id': 'oak', 'name': 'Oak grove picnic area', 'travel_minutes': min(22, travel), 'capacity': max(50, guests), 'fee': venue_cost, 'features': 'Shaded tables · walking paths · restrooms'},
            {'id': 'covered', 'name': 'Covered garden pavilion', 'travel_minutes': min(28, travel), 'capacity': max(60, guests), 'fee': venue_cost, 'features': 'Covered seating · accessible paths · parking'},
        ],
        'selected_venue': 'meadow',
        'menu': ['Build-your-own sandwiches & veggie wraps', 'Seasonal fruit & crunchy garden salad', 'Lemonade, water & a sweet treat'],
        'dietary_preferences': request.get('dietary_preferences', []),
        'budget': {'Food & drinks': food, 'Venue allowance': venue_cost, 'Supplies & games': supplies},
        'total': total,
        'remaining': round(budget - total, 2),
        'schedule': ['10:30 AM — Arrive & set up', '11:00 AM — Welcome & lawn games', '12:00 PM — Picnic lunch', '1:30 PM — Relax, explore & clean up'],
        'shopping_list': [f'{guests} sandwich/wrap portions', f'{guests} fruit & salad portions', f'{guests * 2} drink servings', f'{guests} reusable place settings', 'Picnic blankets, trash bags & lawn games'],
        'guest_assignments': ['Host — confirm venue and guest dietary needs', 'Food team — coordinate shopping and preparation', 'Setup team — bring blankets, games and cleanup supplies'],
        'backup_plan': 'Use the covered pavilion only after checking availability, capacity and fees; otherwise choose another date.',
        'checks': {'budget': total <= budget, 'travel': True, 'capacity': True, 'food_allowance': feasible},
        'warnings': ([] if feasible else ['Food allowance is below $8 per guest. Increase the budget or reduce the guest count before approval.']) + ['All venues, capacity, travel times and costs are illustrative. Verify actual options near your starting location.', 'Weather, availability and dietary suitability have not been verified.'],
        'workflow': ['Request validated', 'Sample location, food and guest tasks completed', 'Budget and sample constraints checked', 'Awaiting approval' if feasible else 'Revision required'],
    }
