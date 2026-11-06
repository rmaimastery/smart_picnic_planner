import os
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from langgraph.types import interrupt
from backend import providers
from backend.main import app
from backend.workflow import run
from backend.food import find_options, apply_choice
from backend.sharing import read_share


DETAILS = dict(date='2027-11-07', guests=30, location='San Ramon', budget=1000, distance_miles=20, food_category='Vegetarian', dietary_preferences=['Vegetarian'])
PLACES = [dict(id='place-1', name='Research Park', features='Picnic tables', source_url='https://example.org/park', distance_miles=None, capacity=None, fee=None)]
NARRATIVE = dict(menu=['Vegetable wraps'], schedule=['Noon — lunch'], shopping_list=['30 wraps'], guest_assignments=['Host — setup'], backup_plan='Reschedule if needed.')
BUSINESSES = [dict(id='food-1', name='Local Grocery', description='Fresh produce.', source_url='https://example.org/store')]


class FoodWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {'PICNIC_GRAPH_DB_PATH': self.tmp.name+'/graph.db', 'PICNIC_DB_PATH': self.tmp.name+'/shares.db'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.extract = patch.object(providers, 'extract', return_value={'details': DETAILS}).start()
        patch.object(providers, 'search', return_value=PLACES).start()
        patch.object(providers, 'generate', return_value=NARRATIVE).start()
        self.food_search = patch.object(providers, 'search_food', return_value=BUSINESSES).start()
        self.addCleanup(patch.stopall)
        self.thread = 'f'*32
        self.client = TestClient(app)

    def step(self, **updates):
        return run(self.thread, {'action': 'message', 'message': 'picnic', 'today': '2026-11-05', **updates})

    def create_plan(self):
        self.step()
        return self.step(action='select', venue_id='place-1')

    def choose(self, mode='shop', **updates):
        return self.step(action='food', food_mode=mode, **updates)

    def test_food_is_required_before_approval_and_survives_restore(self):
        self.assertEqual(self.create_plan()['stage'], 'food')
        with self.assertRaises(ValueError):
            self.step(action='approve')
        out = self.choose()
        self.assertEqual(out['stage'], 'approval')
        self.assertEqual(run(self.thread, read_only=True)['plan']['food_selection']['mode'], 'shop')
        self.assertEqual(self.step(action='approve')['stage'], 'share')

    def test_business_is_canonical_and_included_in_shared_snapshot(self):
        plan = self.create_plan()['plan']
        found = find_options(self.thread, plan, 'shop', 'venue')
        out = self.choose(food_search_id=found['search_id'], food_option_id='food-1', food_selection={'business': {'name': 'Forged'}})
        self.assertEqual(out['plan']['food_selection']['business'], BUSINESSES[0])
        self.step(action='approve')
        out = self.step(action='share')
        snapshot = read_share(out['shared']['token'])['plan']
        self.assertEqual(snapshot['food_selection']['business']['name'], 'Local Grocery')
        with self.assertRaises(ValueError):
            self.choose('order')

    def test_adding_restaurant_preserves_grocery_and_invalidates_approval(self):
        self.create_plan(); self.choose(); self.step(action='approve')
        out = self.choose('order')
        self.assertEqual(out['stage'], 'approval')
        self.assertEqual(out['plan']['status'], 'pending_approval')
        self.assertEqual(out['plan']['food_source'], 'Grocery + Restaurant / catering')
        self.assertIn('30 wraps', out['plan']['shopping_list'])
        self.assertEqual(set(out['plan']['food_selections']), {'shop', 'order'})
        with self.assertRaises(ValueError):
            self.step(action='share')
        changed = self.choose()['plan']
        self.assertIn('30 wraps', changed['shopping_list'])
        self.assertTrue(any('restaurant' in task for task in changed['shopping_list']))

    def test_search_endpoint_caches_each_mode_and_location(self):
        self.create_plan()
        url = f'/api/workflows/{self.thread}/food-options'
        first = self.client.post(url, json={'mode':'shop'}).json()
        second = self.client.post(url, json={'mode':'shop'}).json()
        self.assertFalse(first['cached']); self.assertTrue(second['cached'])
        self.assertEqual(first['search_id'], second['search_id'])
        self.client.post(url, json={'mode':'order'})
        self.client.post(url, json={'mode':'shop', 'near':'start'})
        self.assertEqual(self.food_search.call_count, 3)

    def test_both_canonical_businesses_survive_reload_share_and_updates(self):
        plan = self.create_plan()['plan']
        shop = find_options(self.thread, plan, 'shop', 'venue')
        self.choose(food_search_id=shop['search_id'], food_option_id='food-1')
        restaurant = [{**BUSINESSES[0], 'name':'Local Restaurant', 'source_url':'https://example.org/menu'}]
        self.food_search.return_value = restaurant
        order = find_options(self.thread, plan, 'order', 'venue')
        self.choose('order', food_search_id=order['search_id'], food_option_id='food-1')
        restored = run(self.thread, read_only=True)['plan']
        self.assertEqual(restored['food_selections']['shop']['business'], BUSINESSES[0])
        self.assertEqual(restored['food_selections']['order']['business'], restaurant[0])
        self.choose(food_search_id=shop['search_id'], food_option_id='food-1')
        self.assertEqual(run(self.thread, read_only=True)['plan']['food_selections']['order']['business'], restaurant[0])
        self.step(action='approve')
        shared = self.step(action='share')
        snapshot = read_share(shared['shared']['token'])['plan']
        self.assertEqual(set(snapshot['food_selections']), {'shop','order'})
        self.assertEqual(snapshot['budget'], plan['budget'])

    def test_cannot_select_another_threads_results_or_a_forged_business(self):
        plan = self.create_plan()['plan']
        found = find_options(self.thread, plan, 'shop', 'venue')
        with self.assertRaises(ValueError):
            self.choose(food_search_id=found['search_id'], food_option_id='made-up')
        original = self.thread
        self.thread = 'g'*32
        self.create_plan()
        with self.assertRaises(ValueError):
            self.choose(food_search_id=found['search_id'], food_option_id='food-1')
        self.thread = original
        with self.assertRaises(ValueError):
            self.choose('order', food_search_id=found['search_id'], food_option_id='food-1')

    def test_results_expire_and_details_changes_invalidate_them(self):
        plan = self.create_plan()['plan']
        with patch('backend.food.time.time', return_value=100):
            found = find_options(self.thread, plan, 'shop', 'venue')
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.choose(food_search_id=found['search_id'], food_option_id='food-1')
        found = find_options(self.thread, plan, 'shop', 'venue')
        self.extract.return_value = {'details': {**DETAILS, 'guests':40}}
        self.step(message='40 guests instead'); self.step(action='select', venue_id='place-1')
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.choose(food_search_id=found['search_id'], food_option_id='food-1')

    def test_food_search_errors_do_not_erase_the_plan(self):
        self.create_plan()
        self.food_search.side_effect = providers.ProviderError('Search unavailable')
        response = self.client.post(f'/api/workflows/{self.thread}/food-options', json={'mode':'shop'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(run(self.thread, read_only=True)['stage'], 'food')
        self.assertEqual(self.choose()['stage'], 'approval')

    def test_copy_shared_picnic_keeps_details_and_original_snapshot(self):
        self.create_plan(); self.choose(); self.step(action='approve')
        original = self.step(action='share')
        snapshot = read_share(original['shared']['token'])
        provider_calls = (self.extract.call_count, self.food_search.call_count)
        response = self.client.post(f'/api/workflows/{self.thread}/food-copy')
        self.assertEqual(response.status_code, 201)
        draft = response.json()
        self.assertNotEqual(draft['thread_id'], self.thread)
        self.assertEqual(draft['state'], original['state'])
        self.assertEqual(draft['plan']['venues'], original['plan']['venues'])
        self.assertEqual(draft['plan']['menu'], original['plan']['menu'])
        self.assertEqual(draft['plan']['status'], 'pending_approval')
        self.assertIsNone(draft['shared'])
        changed = run(draft['thread_id'], {'action':'food', 'food_mode':'order'})
        self.assertEqual(changed['plan']['food_source'], 'Grocery + Restaurant / catering')
        self.assertEqual(read_share(original['shared']['token']), snapshot)
        self.assertEqual(run(self.thread, read_only=True)['stage'], 'shared')
        self.assertEqual((self.extract.call_count, self.food_search.call_count), provider_calls)

    def test_copy_legacy_shared_picnic_without_food_choice_opens_food_step(self):
        from backend.workflow import copy_for_food
        # Simulate a completed checkpoint created before food selection existed.
        self.create_plan(); self.choose(); self.step(action='approve'); self.step(action='share')
        import sqlite3
        from langgraph.checkpoint.sqlite import SqliteSaver
        from backend.workflow import build_graph
        with sqlite3.connect(self.tmp.name+'/graph.db') as db:
            graph = build_graph(SqliteSaver(db))
            config = {'configurable':{'thread_id':self.thread}}
            state = graph.get_state(config)
            plan = dict(state.values['plan']); plan.pop('food_selection')
            graph.update_state(config, {'plan':plan}, as_node='publish')
        draft = copy_for_food(self.thread)
        self.assertEqual(draft['stage'], 'food')
        self.assertNotEqual(draft['plan']['status'], 'approved')
        self.assertEqual(run(draft['thread_id'], {'action':'food','food_mode':'order'})['stage'], 'approval')

    def test_copy_rejects_unknown_or_unshared_picnics(self):
        self.create_plan()
        self.assertEqual(self.client.post(f'/api/workflows/{self.thread}/food-copy').status_code, 409)
        self.assertEqual(self.client.post('/api/workflows/'+('z'*32)+'/food-copy').status_code, 404)
        self.assertEqual(self.client.post('/api/workflows/bad/food-copy').status_code, 404)

    def test_http_validation_and_early_or_shared_searches(self):
        self.step()
        url = f'/api/workflows/{self.thread}/food-options'
        self.assertEqual(self.client.post(url, json={'mode':'shop'}).status_code, 409)
        self.assertEqual(self.client.post(url, json={'mode':'invalid'}).status_code, 422)
        self.assertEqual(self.client.post('/api/workflows/bad/food-options', json={'mode':'shop'}).status_code, 404)
        self.step(action='select', venue_id='place-1'); self.choose(); self.step(action='approve'); self.step(action='share')
        self.assertEqual(self.client.post(url, json={'mode':'shop'}).status_code, 409)

    def test_legacy_approval_checkpoint_requires_food_before_approval(self):
        def legacy_review(state):
            interrupt({'stage':'approval', 'reply':'Review the plan.', 'plan':state['plan']})
        with patch('backend.workflow.review', legacy_review):
            self.assertEqual(self.create_plan()['stage'], 'approval')
        out = self.step(action='approve')
        self.assertEqual(out['stage'], 'food')
        self.assertNotEqual(out['plan']['status'], 'approved')
        self.assertEqual(self.choose()['stage'], 'approval')

    def test_legacy_approved_plan_cannot_skip_food_before_sharing(self):
        import copy
        def legacy_review(state):
            answer = interrupt({'stage':'approval', 'plan':state['plan']})
            plan = copy.deepcopy(state['plan']); plan['status'] = 'approved'
            return {'plan':plan, 'action':'approved', 'share_token':'s'*32}
        def legacy_share(state):
            interrupt({'stage':'share', 'plan':state['plan']})
        with patch('backend.workflow.review', legacy_review), patch('backend.workflow.share_gate', legacy_share):
            self.create_plan()
            self.assertEqual(self.step(action='approve')['stage'], 'share')
        out = self.step(action='share')
        self.assertEqual(out['stage'], 'food')
        self.assertNotEqual(out['plan']['status'], 'approved')
        self.assertIsNone(out['shared'])


class FoodProviderTests(unittest.TestCase):
    def test_food_results_use_only_sources_and_correct_search_area(self):
        sources = {'results':[{'url':'https://example.org/store', 'title':'Shop', 'content':'Produce'}, {'url':'javascript:bad'}]}
        parsed = {'businesses':[
            {'name':'Shop', 'source_url':'https://example.org/store'},
            {'name':'SHOP', 'source_url':'https://example.org/store'},
            {'name':'Invented', 'source_url':'https://invented.example'},
            {'name':'Bad shape', 'source_url':['https://example.org/store']},
        ]}
        with patch.object(providers, 'post', return_value=sources) as post, patch.object(providers, 'llm', return_value=parsed):
            self.assertEqual(len(providers.search_food(DETAILS, PLACES[0], 'shop', 'venue')), 1)
            self.assertIn('Research Park', post.call_args.args[2]['query'])
            self.assertNotIn('dietary_preferences', post.call_args.args[2])
            providers.search_food(DETAILS, PLACES[0], 'order', 'start')
            self.assertNotIn('Research Park', post.call_args.args[2]['query'])
            self.assertIn('restaurants', post.call_args.args[2]['query'])
            providers.search_food({**DETAILS, 'food_category':'Mixed'}, PLACES[0], 'order', 'venue')
            self.assertNotIn('Mixed', post.call_args.args[2]['query'])
            self.assertNotIn('official website', post.call_args.args[2]['query'])

    def test_empty_food_results_do_not_invent_businesses(self):
        with patch.object(providers, 'post', return_value={'results':[]}), patch.object(providers, 'llm') as llm:
            self.assertEqual(providers.search_food(DETAILS, PLACES[0], 'shop', 'venue'), [])
            llm.assert_not_called()

    def test_low_budget_still_blocks_approval_after_food_selection(self):
        from backend.planner import build_plan
        plan = build_plan({**DETAILS, 'budget':100, 'travel_minutes':30})
        changed = apply_choice(plan, {'mode':'order', 'near':'venue', 'business':None})
        self.assertEqual(changed['status'], 'needs_revision')
