import unittest
from datetime import date
from backend.conversation import interpret


class ConversationTests(unittest.TestCase):
    today = date(2026, 11, 4)

    def parse(self, text, state=None):
        return interpret(text, state or {}, self.today)

    def test_complete_request(self):
        r = self.parse('Plan a picnic for 30 people near San Ramon next Saturday with a $1,000 budget, vegetarian food and games.')
        self.assertTrue(r['ready'])
        self.assertEqual(r['state']['location'], 'San Ramon')
        self.assertEqual(r['state']['date'], '2026-11-07')
        self.assertEqual(r['state']['budget'], 1000)
        self.assertEqual(r['state']['food_category'], 'Vegetarian')

    def test_missing_details_and_followup(self):
        first = self.parse('A picnic for 12 people near Fremont')
        self.assertFalse(first['ready'])
        self.assertNotIn('budget', first['state'])
        second = self.parse('Tomorrow, budget $300, mixed food', first['state'])
        self.assertTrue(second['ready'])
        self.assertEqual(second['state']['guests'], 12)
        self.assertEqual(second['state']['date'], '2026-11-05')

    def test_revisions_preserve_details(self):
        state = self.parse('30 people near San Ramon next Saturday $1000 mixed')['state']
        r = self.parse('Make it cheaper and choose covered seating', state)
        self.assertTrue(r['ready'])
        self.assertEqual(r['state']['budget'], 800)
        self.assertEqual(r['state']['selected_venue'], 'covered')
        self.assertEqual(r['state']['guests'], 30)

    def test_unsupported_message_does_not_claim_success(self):
        state = self.parse('30 people near San Ramon tomorrow $1000 mixed')['state']
        r = self.parse('Book a DJ and send invitations', state)
        self.assertFalse(r['ready'])
        self.assertEqual(r['state'], state)

    def test_invalid_dates_and_limits(self):
        for text in ['Tomorrow for 900 people', '2026-02-30', '2020-01-01', 'Budget $200000']:
            with self.subTest(text=text):
                self.assertFalse(self.parse(text)['ready'])


    def test_guided_short_answers(self):
        result = self.parse('I want to plan a team picnic')
        self.assertEqual(result['state']['awaiting_field'], 'budget')
        for answer, next_field in [('1000', 'guests'), ('30', 'food_category'), ('Vegetarian', 'location'), ('San Ramon, CA', 'date')]:
            result = self.parse(answer, result['state'])
            self.assertFalse(result['ready'])
            self.assertEqual(result['state']['awaiting_field'], next_field)
        result = self.parse('next Saturday', result['state'])
        self.assertTrue(result['ready'])
        self.assertEqual(result['state']['location'], 'San Ramon, CA')
        self.assertEqual(result['state']['budget'], 1000)
        self.assertEqual(result['state']['guests'], 30)

    def test_food_is_required_without_default(self):
        result = self.parse('30 people near Fremont tomorrow $500')
        self.assertFalse(result['ready'])
        self.assertEqual(result['state']['awaiting_field'], 'food_category')
        result = self.parse('non-vegetarian', result['state'])
        self.assertTrue(result['ready'])
        self.assertEqual(result['state']['food_category'], 'Mixed')
        self.assertNotIn('Vegetarian', result['state']['dietary_preferences'])

    def test_invalid_short_answer_keeps_question(self):
        result = self.parse('Plan a picnic')
        result = self.parse('200000', result['state'])
        self.assertFalse(result['ready'])
        self.assertEqual(result['state']['awaiting_field'], 'budget')
        result = self.parse('500', result['state'])
        self.assertEqual(result['state']['budget'], 500)
