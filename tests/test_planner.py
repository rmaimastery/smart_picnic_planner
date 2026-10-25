import unittest

from backend.planner import build_plan


class PlannerTests(unittest.TestCase):
    def request(self, **overrides):
        return dict(request='Team picnic', date='2026-11-07', guests=30,
                    location='San Ramon', budget=1000, travel_minutes=30,
                    dietary_preferences=['Vegetarian'], **overrides)

    def test_plan_stays_within_constraints(self):
        plan = build_plan(self.request())
        self.assertEqual(plan['status'], 'pending_approval')
        self.assertAlmostEqual(sum(plan['budget'].values()), plan['total'])
        self.assertLessEqual(plan['total'], 1000)
        self.assertTrue(all(v['travel_minutes'] <= 30 and v['capacity'] >= 30 for v in plan['venues']))

    def test_insufficient_food_budget_requires_revision(self):
        request = self.request()
        request['budget'] = 100
        plan = build_plan(request)
        self.assertEqual(plan['status'], 'needs_revision')
        self.assertFalse(plan['checks']['food_allowance'])

    def test_large_group_and_short_travel(self):
        request = self.request()
        request.update(guests=500, budget=10000, travel_minutes=10)
        plan = build_plan(request)
        self.assertTrue(all(v['capacity'] >= 500 and v['travel_minutes'] <= 10 for v in plan['venues']))


if __name__ == '__main__':
    unittest.main()
