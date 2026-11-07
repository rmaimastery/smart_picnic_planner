import json
import os
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.accounts import database, digest, COOKIE

PLAN = {
    'id': 'picnic-one', 'status': 'pending_approval',
    'request': {'date': '2027-06-12', 'guests': 12, 'location': 'San Ramon', 'budget': 600,
                'notes': 'Private owner notes', 'participants': ['Private person'], 'request': 'Private prompt'},
    'venues': [{'id': 'park', 'name': 'Park', 'features': 'Picnic tables'}], 'selected_venue': 'park',
    'budget': {'Food & drinks': 360}, 'total': 360, 'remaining': 240, 'menu': ['Wraps'],
    'food_choices': ['Brunch'], 'food_source': 'Grocery / self catered', 'dietary_preferences': [],
    'schedule': [], 'shopping_list': [], 'guest_assignments': [], 'backup_plan': 'Reschedule.', 'warnings': [],
}
THREAD = 'p' * 32


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        env = patch.dict(os.environ, {'PICNIC_DB_PATH': self.temp.name+'/accounts.db', 'PICNIC_GRAPH_DB_PATH': self.temp.name+'/graph.db', 'AUTH_EMAIL_MODE': 'local', 'APP_BASE_URL': ''})
        env.start(); self.addCleanup(env.stop)
        self.clients = []
        self.owner = self.client()
        self.run_patcher = patch('backend.workflow.run', return_value={'plan': PLAN, 'thread_id': THREAD, 'stage': 'approval'})
        self.run = self.run_patcher.start()
        self.addCleanup(patch.stopall)

    def client(self, **kwargs):
        client = TestClient(app, base_url='http://127.0.0.1:8002', client=('127.0.0.1', 50000),
                            headers={'X-BB-Request': '1', 'Origin': 'http://127.0.0.1:8002'}, **kwargs)
        self.addCleanup(client.close)
        return client

    def link(self, email='owner@example.test', client=None):
        response = (client or self.owner).post('/api/auth/link', json={'email': email})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['preview']['preview_url'].split('#')[1]

    def login(self, email='owner@example.test', client=None):
        client = client or self.owner
        token = self.link(email, client)
        response = client.post('/api/auth/verify', json={'token': token})
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def save(self):
        self.login()
        response = self.owner.post('/api/account/plans', json={'thread_id': THREAD, 'plan': {'total': 0}})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['id']

    def test_single_use_link_inspection_and_hashed_session(self):
        token = self.link(' OWNER@Example.test ')
        self.assertIsNone(self.owner.get('/api/auth/me').json()['email'])
        self.assertEqual(self.owner.post('/api/auth/inspect', json={'token': token}).json()['email'], 'owner@example.test')
        with database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM bb_accounts').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT hash FROM bb_links').fetchone()[0], digest(token))
        verified = self.owner.post('/api/auth/verify', json={'token': token})
        self.assertEqual(verified.status_code, 200)
        self.assertIn('HttpOnly', verified.headers['set-cookie'])
        self.assertIn('SameSite=lax', verified.headers['set-cookie'])
        self.assertEqual(self.owner.get('/api/auth/me').json()['email'], 'owner@example.test')
        with database() as db:
            self.assertEqual(db.execute('SELECT hash FROM bb_sessions').fetchone()[0], digest(self.owner.cookies.get(COOKIE)))
        self.assertEqual(self.owner.post('/api/auth/verify', json={'token': token}).status_code, 400)
        self.assertIn(self.owner.get('/api/auth/verify').status_code, (404, 405))

    def test_expired_link_and_session_and_logout(self):
        token = self.link()
        with database() as db, db:
            db.execute('UPDATE bb_links SET expires=0')
        self.assertEqual(self.owner.post('/api/auth/verify', json={'token': token}).status_code, 400)
        self.login()
        with database() as db, db:
            db.execute('UPDATE bb_sessions SET expires=0')
        self.assertEqual(self.owner.get('/api/account/plans').status_code, 401)
        self.login()
        old_cookie = self.owner.cookies.get(COOKIE)
        self.assertEqual(self.owner.post('/api/auth/logout').status_code, 200)
        replay = self.client(); replay.cookies.set(COOKIE, old_cookie)
        self.assertIsNone(replay.get('/api/auth/me').json()['email'])
        self.assertIsNone(self.owner.get('/api/auth/me').json()['email'])
        self.assertEqual(self.owner.get('/api/account/plans').status_code, 401)

    def test_csrf_rate_limits_and_invalid_email(self):
        self.assertEqual(self.owner.post('/api/auth/link', json={'email': 'a@example.test'}, headers={'X-BB-Request': ''}).status_code, 403)
        self.assertEqual(self.owner.post('/api/auth/link', json={'email': 'a@example.test'}, headers={'Origin': 'https://evil.test'}).status_code, 403)
        self.assertEqual(self.owner.post('/api/auth/link', json={'email': 'a@example.test'}, headers={'Sec-Fetch-Site': 'same-site'}).status_code, 403)
        for invalid in ['bad', 'a@b', 'a\r\nBcc:x@b.test', 'a..b@example.test', 'a@-bad.test']:
            self.assertEqual(self.owner.post('/api/auth/link', json={'email': invalid}).status_code, 422)
        with patch('backend.accounts.local_preview', return_value=False), patch('backend.accounts.deliver_link', return_value=None):
            for _ in range(3):
                self.assertEqual(self.owner.post('/api/auth/link', json={'email': 'owner@example.test'}).status_code, 200)
            response = self.owner.post('/api/auth/link', json={'email': 'owner@example.test'})
            self.assertEqual(response.status_code, 429)
            self.assertIn('Retry-After', response.headers)

    def test_preview_never_exposed_to_remote_clients_or_public_hosts(self):
        for base, client_address in [('https://picnic.example', ('127.0.0.1', 50000)), ('http://127.0.0.1:8002', ('203.0.113.10', 50000))]:
            with TestClient(app, base_url=base, client=client_address, headers={'X-BB-Request': '1'}) as client:
                self.assertFalse(client.get('/api/auth/config').json()['local_preview'])
                response = client.post('/api/auth/link', json={'email': 'a@example.test'})
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('preview', response.json())
        with patch.dict(os.environ, {'AUTH_EMAIL_MODE': ''}):
            self.assertEqual(self.owner.post('/api/auth/link', json={'email': 'b@example.test'}).status_code, 503)

    def test_email_failure_removes_token_and_smtp_never_returns_link(self):
        with patch.dict(os.environ, {'AUTH_EMAIL_MODE': 'smtp', 'APP_BASE_URL': 'https://picnic.example',
                                     'SMTP_HOST': 'smtp.example', 'SMTP_FROM': 'hello@example.test'}):
            with TestClient(app, base_url='https://picnic.example', headers={'X-BB-Request': '1'}) as client:
                with patch('backend.accounts.smtplib.SMTP', side_effect=OSError('offline')):
                    self.assertEqual(client.post('/api/auth/link', json={'email': 'a@example.test'}).status_code, 503)
                with database() as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM bb_links').fetchone()[0], 0)
                with patch('backend.accounts.smtplib.SMTP') as smtp:
                    response = client.post('/api/auth/link', json={'email': 'a@example.test'})
                    self.assertEqual(response.status_code, 200)
                    self.assertNotIn('preview', response.json())
                    message = smtp.return_value.send_message.call_args.args[0]
                    token = message.get_content().split('/login.html#')[1].split()[0]
                    verified = client.post('/api/auth/verify', json={'token': token})
                    self.assertIn('Secure', verified.headers['set-cookie'])

    def test_canonical_saves_private_workflows_and_owner_access(self):
        plan_id = self.save()
        detail = self.owner.get('/api/account/plans/'+plan_id).json()
        self.assertEqual(detail['plan']['total'], 360)
        self.assertEqual(detail['thread_id'], THREAD)
        self.assertEqual(self.owner.get('/api/auth/me').json()['nav_role'], 'organizer')
        self.assertEqual(self.owner.get('/api/account/plans').json()['plans'][0]['id'], plan_id)
        another_device = self.client(); self.login(client=another_device)
        self.assertEqual(another_device.get('/api/account/plans/'+plan_id).status_code, 200)
        intruder = self.client(); self.login('other@example.test', intruder)
        self.assertEqual(intruder.get('/api/account/plans/'+plan_id).status_code, 404)
        self.assertEqual(intruder.get('/api/workflows/'+THREAD).status_code, 403)
        self.assertEqual(intruder.post('/api/account/plans', json={'thread_id': THREAD}).status_code, 403)
        self.assertEqual(intruder.post('/api/chat', json={'thread_id': THREAD, 'today': '2027-01-01', 'message': 'change'}).status_code, 403)
        self.assertEqual(self.owner.get('/api/account/plans/'+plan_id).headers['cache-control'], 'no-store')
        again = self.owner.post('/api/account/plans', json={'thread_id': THREAD}).json()
        self.assertEqual(again['id'], plan_id)
        self.assertEqual(len(self.owner.get('/api/account/plans').json()['plans']), 1)

    def test_multiple_owned_plans_keep_distinct_workflows_and_saved_snapshots(self):
        first = self.save()
        first_snapshot = self.owner.get('/api/account/plans/'+first).json()
        second_plan = json.loads(json.dumps(PLAN))
        second_plan['venues'][0]['name'] = 'Another Park'
        second_plan['request']['guests'] = 22
        second_thread = 's' * 32
        self.run.return_value = {'plan': second_plan, 'thread_id': second_thread, 'stage': 'approval'}
        second = self.owner.post('/api/account/plans', json={'thread_id': second_thread}).json()['id']
        self.assertNotEqual(first, second)  # Legacy plan IDs and picnic dates may match.
        listed = {item['id']: item for item in self.owner.get('/api/account/plans').json()['plans']}
        self.assertEqual(listed[first]['thread_id'], THREAD)
        self.assertEqual(listed[second]['thread_id'], second_thread)
        self.assertEqual(listed[second]['venue'], 'Another Park')
        self.assertEqual(self.owner.get('/api/account/plans/'+first).json(), first_snapshot)
        self.assertEqual(self.owner.get('/api/account/plans/'+second).json()['plan']['request']['guests'], 22)

    def test_invitations_require_verification_and_guests_can_only_view_and_comment(self):
        plan_id = self.save()
        guest = self.client(); self.login('guest@example.test', guest)
        result = self.owner.post(f'/api/account/plans/{plan_id}/invitations', json={'emails': ['Guest@example.test', 'guest@example.test']}).json()
        self.assertEqual(len(result['delivered']), 1)
        self.assertEqual(guest.get('/api/account/plans/'+plan_id).status_code, 404)
        token = result['previews'][0]['preview_url'].split('#')[1]
        self.assertEqual(guest.post('/api/auth/verify', json={'token': token}).json()['path'], '/account.html?plan='+plan_id)
        detail = guest.get('/api/account/plans/'+plan_id).json()
        self.assertEqual(detail['role'], 'guest')
        self.assertEqual(guest.get('/api/auth/me').json()['nav_role'], 'guest')
        self.assertNotIn('thread_id', detail); self.assertNotIn('members', detail)
        self.assertNotIn('thread_id', guest.get('/api/account/plans').json()['plans'][0])
        self.assertNotIn('notes', detail['plan']['request']); self.assertNotIn('participants', detail['plan']['request'])
        self.assertNotIn('Private prompt', json.dumps(detail))
        self.assertEqual(guest.get('/api/workflows/'+THREAD).status_code, 403)
        self.assertEqual(guest.post('/api/workflows/'+THREAD+'/food-copy').status_code, 403)
        self.assertEqual(guest.post('/api/workflows/'+THREAD+'/food-options', json={'mode': 'shop'}).status_code, 403)
        self.assertEqual(guest.post(f'/api/account/plans/{plan_id}/invitations', json={'emails': ['x@example.test']}).status_code, 404)
        self.assertEqual(guest.post(f'/api/account/plans/{plan_id}/feedback', json={'response': 'Looks good', 'comment': 'Excited!'}).status_code, 201)
        self.assertEqual(self.owner.get('/api/account/plans/'+plan_id).json()['feedback'][0]['email'], 'guest@example.test')
        route='/api/account/workflows/'+THREAD+'/feedback'
        self.assertEqual(self.owner.get(route).json()['feedback'][0]['comment'], 'Excited!')
        self.assertEqual(self.owner.get(route).json()['id'], plan_id)
        self.assertEqual(self.owner.get(route).headers['cache-control'], 'no-store')
        self.assertEqual(guest.get(route).status_code, 404)
        self.assertEqual(self.client().get(route).status_code, 401)
        self.assertEqual(self.owner.post(f'/api/account/plans/{plan_id}/feedback', json={'response': 'Looks good'}).status_code, 403)
        self.owner.delete(f'/api/account/plans/{plan_id}/members/guest@example.test')
        self.assertEqual(guest.get('/api/account/plans/'+plan_id).status_code, 404)
        self.assertEqual(guest.post(f'/api/account/plans/{plan_id}/feedback', json={'response': 'Looks good'}).status_code, 404)

    def test_revoked_unaccepted_invitation_cannot_sign_in(self):
        plan_id = self.save()
        result = self.owner.post(f'/api/account/plans/{plan_id}/invitations', json={'emails': ['guest@example.test']}).json()
        token = result['previews'][0]['preview_url'].split('#')[1]
        self.owner.delete(f'/api/account/plans/{plan_id}/members/guest@example.test')
        self.assertEqual(self.client().post('/api/auth/verify', json={'token': token}).status_code, 400)

    def test_simultaneous_verification_consumes_a_link_only_once(self):
        from concurrent.futures import ThreadPoolExecutor
        token = self.link()
        clients = [self.client(), self.client()]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda client: client.post('/api/auth/verify', json={'token': token}).status_code, clients))
        self.assertEqual(sorted(results), [200, 400])

    def test_account_save_and_approval_use_the_actual_compiled_workflow(self):
        self.run_patcher.stop()
        self.login()
        details = {'date': '2027-06-12', 'guests': 12, 'location': 'San Ramon', 'budget': 600,
                   'distance_miles': 20, 'food_category': 'Vegetarian', 'notes': 'Private owner notes'}
        places = [{'id': 'park', 'name': 'Park', 'features': 'Tables', 'source_url': 'https://example.org/park',
                   'distance_miles': None, 'capacity': None, 'fee': None}]
        narrative = {'menu': ['Wraps'], 'schedule': ['Lunch'], 'shopping_list': ['Wraps'],
                     'guest_assignments': [], 'backup_plan': 'Reschedule.'}
        payload = {'thread_id': THREAD, 'today': '2026-11-06', 'message': 'Picnic', 'action': 'message'}
        with patch('backend.providers.extract', return_value={'details': details}), patch('backend.providers.search', return_value=places), patch('backend.providers.generate', return_value=narrative):
            self.assertEqual(self.owner.post('/api/chat', json=payload).json()['stage'], 'places')
            payload.update(action='select', venue_id='park')
            self.assertEqual(self.owner.post('/api/chat', json=payload).json()['stage'], 'food')
            plan_id = self.owner.post('/api/account/plans', json={'thread_id': THREAD}).json()['id']
            payload.update(action='food', food_mode='shop')
            self.assertEqual(self.owner.post('/api/chat', json=payload, headers={'X-BB-Request': ''}).status_code, 403)
            self.assertEqual(self.owner.post('/api/chat', json=payload).json()['stage'], 'approval')
            payload.update(action='approve')
            self.assertEqual(self.owner.post('/api/chat', json=payload).json()['stage'], 'share')
            self.assertEqual(self.owner.post('/api/account/plans', json={'thread_id': THREAD}).json()['id'], plan_id)
            self.assertEqual(self.owner.get('/api/account/plans/'+plan_id).json()['plan']['status'], 'approved')
            other = self.client()
            self.assertEqual(other.get('/api/workflows/'+THREAD).status_code, 403)

    def test_local_preview_ignores_old_mail_buckets_but_remains_bounded(self):
        import time
        now = time.time()
        with database() as db, db:
            for scope, key, count in [('login-email', 'owner@example.test', 3), ('login-ip', '127.0.0.1', 15), ('mail-global', 'all', 200)]:
                db.executemany('INSERT INTO bb_limits VALUES (?,?,?)', [(scope, digest(key), now)]*count)
        for _ in range(30):
            result = self.owner.post('/api/auth/link', json={'email': 'owner@example.test'})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertIn('preview', result.json())
        limited = self.owner.post('/api/auth/link', json={'email': 'owner@example.test'})
        self.assertEqual(limited.status_code, 429)
        self.assertLessEqual(int(limited.headers['retry-after']), 60)
        with patch('backend.accounts.local_preview', return_value=False), patch('backend.accounts.deliver_link') as delivery:
            self.assertEqual(self.owner.post('/api/auth/link', json={'email': 'owner@example.test'}).status_code, 429)
            delivery.assert_not_called()

    def test_retry_after_reports_actual_remaining_time(self):
        with database() as db, db:
            db.executemany('INSERT INTO bb_limits VALUES (?,?,?)', [('login-email', digest('owner@example.test'), 9150)]*3)
        with patch('backend.accounts.local_preview', return_value=False), patch('backend.accounts.deliver_link', return_value=None):
            with patch('backend.accounts.time.time', return_value=10000):
                response = self.owner.post('/api/auth/link', json={'email': 'owner@example.test'})
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.headers['retry-after'], '50')
            with patch('backend.accounts.time.time', return_value=10051):
                self.assertEqual(self.owner.post('/api/auth/link', json={'email': 'owner@example.test'}).status_code, 200)
