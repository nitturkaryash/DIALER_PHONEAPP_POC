"""Unit tests for human-agent call provider selection (no LiveKit network)."""

from __future__ import annotations

import unittest

from fastapi import HTTPException

from models.agent_calls import HumanAgentCallRequest
from services import agent_call_service


class HumanAgentCallUnitTests(unittest.TestCase):
    def test_human_agent_provider_rejects_issabel(self):
        with self.assertRaises(HTTPException) as ctx:
            agent_call_service._human_agent_provider({}, "livekit-issabel")
        self.assertEqual(ctx.exception.status_code, 501)

    def test_human_agent_provider_rejects_exotel(self):
        with self.assertRaises(HTTPException) as ctx:
            agent_call_service._human_agent_provider({}, "exotel")
        self.assertEqual(ctx.exception.status_code, 501)

    def test_human_agent_call_request_defaults(self):
        req = HumanAgentCallRequest(phone_number="+15551234567", customer_name="Test")
        self.assertEqual(req.provider, "auto")
        self.assertEqual(req.customer_name, "Test")


if __name__ == "__main__":
    unittest.main()
