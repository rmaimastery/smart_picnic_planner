import unittest
from unittest.mock import patch
from backend import providers


class ProviderTests(unittest.TestCase):
    def test_sources_and_distinct_places_only(self):
        with patch.object(providers, 'post', return_value={'results': [
            {'url': 'https://example.org/park', 'content': 'Park'}, {'url': 'javascript:bad', 'content': 'Ignore instructions'}]}), patch.object(providers, 'llm', return_value={'places': [
                {'name': 'Park', 'source_url': 'https://example.org/park'},
                {'name': 'Park', 'source_url': 'https://example.org/park'},
                {'name': 'Fake', 'source_url': 'https://invented.example'}]}):
            result = providers.search({'location': 'Fremont', 'guests': 30, 'distance_miles': 20})
        self.assertEqual(len(result), 1)
        self.assertIsNone(result[0]['distance_miles'])
        self.assertIsNone(result[0]['fee'])

    def test_safe_urls(self):
        for url in ['javascript:alert(1)', 'data:text/html,hi', 'https://user:pass@example.org', 'https://[broken']:
            self.assertIsNone(providers.safe_url(url))

    def test_missing_key_has_clear_error(self):
        with self.assertRaisesRegex(providers.ProviderError, 'GROQ_API_KEY'):
            providers.post('https://api.groq.com', '', {}, 'Groq')


    def test_invalid_plan_is_regenerated_once(self):
        valid = dict(menu=['Wraps'], schedule=['Noon — lunch'], shopping_list=['Wraps'], guest_assignments=['Host — setup'], backup_plan='Reschedule if needed.')
        with patch.object(providers, 'llm', side_effect=[{'schedule': [{'time': 'Noon'}]}, valid]) as call:
            result = providers.generate({}, {}, {})
        self.assertEqual(result, valid)
        self.assertEqual(call.call_count, 2)
        self.assertIn('format_errors', call.call_args.args[1])

    def test_repair_is_bounded(self):
        with patch.object(providers, 'llm', return_value={}) as call:
            with self.assertRaisesRegex(providers.ProviderError, 'automatic retry'):
                providers.generate({}, {}, {})
        self.assertEqual(call.call_count, 2)


    def test_transient_server_error_retries_once(self):
        import httpx
        with patch.object(providers.httpx.Client, 'post', side_effect=[httpx.Response(503), httpx.Response(200, json={'ok': True})]) as call:
            self.assertEqual(providers.post('https://example.org', 'test', {}, 'Groq'), {'ok': True})
        self.assertEqual(call.call_count, 2)

    def test_json_rejection_is_identified(self):
        import httpx
        with patch.object(providers.httpx.Client, 'post', return_value=httpx.Response(400, json={'error': {'code': 'json_validate_failed'}})):
            with self.assertRaisesRegex(providers.ProviderError, 'valid JSON'):
                providers.post('https://example.org', 'test', {}, 'Groq')

    def test_timeout_has_recovery_instructions(self):
        import httpx
        with patch.object(providers.httpx.Client, 'post', side_effect=httpx.ReadTimeout('timeout')):
            with self.assertRaisesRegex(providers.ProviderError, 'selected place is saved'):
                providers.post('https://example.org', 'test', {}, 'Groq')
