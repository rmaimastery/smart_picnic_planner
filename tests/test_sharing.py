import os
import tempfile
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from backend.main import PicnicRequest, ShareRequest, ReviewRequest, share_plan, get_shared_plan, submit_review
from fastapi import HTTPException


class SharingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'PICNIC_DB_PATH': self.directory.name + '/reviews.sqlite3'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.directory.cleanup()

    def request(self):
        return ShareRequest(request=PicnicRequest(request='Private prompt', date='2026-11-07', guests=30,
            location='San Ramon', budget=1000, travel_minutes=30, participants=['Private guest']),
            selected_venue='oak', food_choices=['Brunch'], food_source='Grocery / self catered',
            activities=[{'name': 'Games', 'owner': 'Alex'}])

    def test_snapshot_persists_with_feedback_and_omits_private_input(self):
        shared = share_plan(self.request())
        submit_review(shared['token'], ReviewRequest(name=' Sam ', response='Suggest a change', comment=' More shade please '))
        snapshot = get_shared_plan(shared['token'])
        self.assertEqual(snapshot['plan']['venues'][0]['id'], 'oak')
        self.assertEqual(len(snapshot['plan']['venues']), 1)
        self.assertNotIn('participants', snapshot['plan']['request'])
        self.assertNotIn('request', snapshot['plan']['request'])
        self.assertEqual(snapshot['reviews'][0]['name'], 'Sam')
        self.assertEqual(snapshot['reviews'][0]['comment'], 'More shade please')

    def test_each_link_has_independent_snapshot_and_reviews(self):
        first = share_plan(self.request())
        request = self.request()
        request.selected_venue = 'covered'
        second = share_plan(request)
        self.assertNotEqual(first['token'], second['token'])
        submit_review(first['token'], ReviewRequest(name='Alex', response='Looks good'))
        self.assertEqual(get_shared_plan(first['token'])['plan']['selected_venue'], 'oak')
        self.assertEqual(get_shared_plan(second['token'])['reviews'], [])

    def test_missing_share_returns_404(self):
        for action in [lambda: get_shared_plan('missing'), lambda: submit_review('missing', ReviewRequest(name='A', response='Looks good'))]:
            with self.assertRaises(HTTPException) as ctx:
                action()
            self.assertEqual(ctx.exception.status_code, 404)

    def test_blank_names_and_invalid_responses_rejected(self):
        for payload in [dict(name='   ', response='Looks good'), dict(name='A', response='unknown'), dict(name='A', response='Looks good', comment='x'*2001)]:
            with self.assertRaises(ValidationError):
                ReviewRequest(**payload)
