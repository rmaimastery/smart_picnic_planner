import os
import tempfile
import unittest
from unittest.mock import patch
from backend.workflow import run
from backend.providers import ProviderError
from backend.sharing import read_share


DETAILS = dict(date='2027-11-07', guests=30, location='San Ramon', budget=1000, distance_miles=20, food_category='Vegetarian', dietary_preferences=['Vegetarian'], notes='Private picnic notes')
PLACES = [dict(id='place-1', name='Research Park', features='Picnic tables', source_url='https://example.org/park', distance_miles=None, capacity=None, fee=None)]
NARRATIVE = dict(menu=['Vegetable wraps'], schedule=['11 AM — games'], shopping_list=['30 wraps'], guest_assignments=['Host — setup'], backup_plan='Check covered seating availability.')


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {'PICNIC_GRAPH_DB_PATH': self.tmp.name+'/graph.db', 'PICNIC_DB_PATH': self.tmp.name+'/shares.db'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.extract = patch('backend.providers.extract', return_value={'details': DETAILS}).start()
        self.search = patch('backend.providers.search', return_value=PLACES).start()
        self.generate = patch('backend.providers.generate', return_value=NARRATIVE).start()
        self.addCleanup(patch.stopall)
        self.thread = 'a'*32

    def step(self, **kw):
        return run(self.thread, {'action': 'message', 'message': 'picnic', 'today': '2026-11-04', **kw})

    def test_full_human_loop_and_canonical_share(self):
        out = self.step()
        self.assertEqual(out['stage'], 'places')
        self.generate.assert_not_called()
        self.assertEqual(run(self.thread, read_only=True)['places'], PLACES)
        out = self.step(action='select', venue_id='place-1')
        self.assertEqual(out['stage'], 'food')
        self.assertIsNone(out['shared'])
        self.assertEqual(out['plan']['menu'], NARRATIVE['menu'])
        self.step(action='food', food_mode='shop')
        out = self.step(action='approve')
        self.assertEqual(out['stage'], 'share')
        self.assertEqual(out['plan']['status'], 'approved')
        self.assertIsNone(out['shared'])
        out = self.step(action='share')
        self.assertEqual(out['stage'], 'shared')
        snapshot = read_share(out['shared']['token'])['plan']
        self.assertEqual(snapshot['venues'][0]['source_url'], PLACES[0]['source_url'])
        for field in ('request', 'participants', 'notes'):
            self.assertNotIn(field, snapshot['request'])
        self.assertEqual(run(self.thread, read_only=True)['shared'], out['shared'])

    def test_missing_details_interrupt_before_search(self):
        self.extract.return_value = {'details': {'budget': 1000}, 'question': 'How many guests?'}
        out = self.step()
        self.assertEqual(out['stage'], 'details')
        self.search.assert_not_called()
        self.extract.return_value = {'details': DETAILS}
        self.assertEqual(self.step(message='30 people')['stage'], 'places')

    def test_low_budget_cannot_approve_or_share(self):
        self.extract.return_value = {'details': {**DETAILS, 'budget': 100}}
        self.step(); self.step(action='select', venue_id='place-1'); self.step(action='food', food_mode='shop')
        out = self.step(action='approve')
        self.assertEqual(out['stage'], 'approval')
        self.assertEqual(out['plan']['status'], 'needs_revision')
        self.assertIsNone(out['shared'])

    def test_revision_resets_approval_and_reuses_search(self):
        self.step(); self.step(action='select', venue_id='place-1'); self.step(action='food', food_mode='shop'); self.step(action='approve')
        out = self.step(message='change budget to $1500')
        self.assertEqual(out['stage'], 'places')
        self.assertIsNone(out['plan'])
        self.assertEqual(self.search.call_count, 1)

    def test_provider_failure_retry_at_failed_node(self):
        self.search.side_effect = ProviderError('Search unavailable')
        with self.assertRaises(ProviderError):
            self.step()
        self.search.side_effect = None
        self.assertEqual(self.step()['stage'], 'places')
        self.assertEqual(self.extract.call_count, 1)

    def test_no_results_and_fabricated_selection(self):
        self.search.return_value = []
        self.assertEqual(self.step()['stage'], 'details')
        self.search.return_value = PLACES
        self.step(message='near Fremont')
        with self.assertRaises(ValueError):
            self.step(action='select', venue_id='fabricated')
        self.generate.assert_not_called()

    def test_session_isolation(self):
        self.step()
        with self.assertRaises(KeyError):
            run('b'*32, read_only=True)

    def test_http_contract_and_client_cannot_supply_plan(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        with TestClient(app) as client:
            payload = dict(thread_id=self.thread, today='2026-11-04', message='picnic')
            first = client.post('/api/chat', json=payload)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()['stage'], 'places')
            self.assertEqual(client.get('/api/workflows/'+self.thread).json()['stage'], 'places')
            payload.update(action='select', venue_id='place-1')
            self.assertEqual(client.post('/api/chat', json=payload).json()['stage'], 'food')
            payload.update(action='share', plan={'status': 'approved'})
            # A forged client plan cannot create a share without the approval checkpoint.
            self.assertEqual(client.post('/api/chat', json=payload).status_code, 409)

    def test_picnic_page_serves_the_workspace_shell(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        with TestClient(app) as client:
            response=client.get('/picnic.html')
            self.assertEqual(response.status_code,200)
            self.assertIn('text/html',response.headers['content-type'])
            self.assertIn('id="picnic-page-heading"',response.text)
            self.assertIn('id="picnic-nav"',response.text)


    def test_bare_guest_count_overrides_stale_llm_question(self):
        self.extract.return_value = {'details': {'budget': 1000}, 'question': 'How many guests will be attending?'}
        self.assertEqual(self.step()['stage'], 'details')
        out = self.step(message='55')
        self.assertEqual(out['state']['guests'], 55)
        self.assertIn('food', out['reply'].lower())
        self.assertNotIn('guests', out['reply'].lower())

    def test_singular_guest_answer_and_legacy_checkpoint(self):
        from backend.workflow import collect
        self.extract.return_value = {'details': {}, 'question': 'How many guests will be attending?'}
        for answer in ('55', '55 guest', '55 guests'):
            out = collect({'message': answer, 'details': {'budget': 1000}, 'question': 'How many guests will be attending?', 'today': '2026-11-04'})
            self.assertEqual(out['details']['guests'], 55)
            self.assertEqual(out['pending_field'], 'food_category')

    def test_short_budget_and_distance_answers(self):
        from backend.workflow import collect
        self.extract.return_value = {'details': {}}
        for field, answer, expected in [('budget', '1,000', 1000), ('distance_miles', '25', 25)]:
            out = collect({'message': answer, 'details': {}, 'pending_field': field, 'today': '2026-11-04'})
            self.assertEqual(out['details'][field], expected)


    def test_validation_keeps_valid_fields_and_asks_specific_question(self):
        self.extract.return_value = {'details': {'budget': '$1,000', 'guests': 55, 'food_category': 'vegetarian', 'distance_miles': 200}}
        out = self.step()
        self.assertEqual(out['state']['guests'], 55)
        self.assertEqual(out['state']['budget'], 1000)
        self.assertEqual(out['state']['food_category'], 'Vegetarian')
        self.assertIn('5 to 100 miles', out['reply'])
        self.extract.return_value = {'details': {}}
        out = self.step(message='25')
        self.assertEqual(out['state']['distance_miles'], 25)
        self.assertEqual(out['state']['guests'], 55)

    def test_bad_date_preserves_other_answers(self):
        self.extract.return_value = {'details': {**DETAILS, 'date': '2020-01-01'}}
        out = self.step()
        self.assertEqual(out['stage'], 'details')
        self.assertIn('future date', out['reply'])
        self.assertEqual(out['state']['guests'], 30)
        self.extract.return_value = {'details': {}}
        out = self.step(message='2027-11-08')
        self.assertEqual(out['stage'], 'places')
        self.assertEqual(out['state']['date'], '2027-11-08')
