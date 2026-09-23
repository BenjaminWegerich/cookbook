"""Tests for the budget guardrail.

The guardrail can switch a project's billing off, so its decision logic is the most
consequential small function in the repository. Every case below is about the same question:
*when is it allowed to act?* The module is loaded by path because the directory name contains
a dash (the same trick the feasibility spike uses for its scripts), which also proves the
module imports without the Cloud Functions runtime.
"""

from __future__ import annotations

import base64
import importlib.util
import json
import unittest
from pathlib import Path
from unittest import mock

GUARDRAIL_PATH = (
    Path(__file__).resolve().parents[1] / "deploy" / "cloud-run" / "budget-guardrail" / "guardrail.py"
)


def load_guardrail():
    """Import guardrail.py by path, bypassing the dashed directory name."""
    spec = importlib.util.spec_from_file_location("budget_guardrail", GUARDRAIL_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guardrail = load_guardrail()


def notification(**overrides: object) -> dict:
    """A spent-budget notification, with fields overridable per test."""
    base = {
        "budgetDisplayName": "Keep gateway guardrail",
        "costAmount": 1.05,
        "budgetAmount": 1.0,
        "currencyCode": "EUR",
        "alertThresholdExceeded": 1.0,
    }
    base.update(overrides)
    return base


class DecodeTests(unittest.TestCase):
    """The Pub/Sub envelope must never raise inside the function."""

    def test_decodes_a_base64_json_body(self) -> None:
        payload = {"costAmount": 2, "budgetAmount": 1}
        message = {"data": base64.b64encode(json.dumps(payload).encode()).decode()}
        self.assertEqual(guardrail.decode_budget_notification(message), payload)

    def test_missing_or_broken_data_is_empty_not_an_exception(self) -> None:
        self.assertEqual(guardrail.decode_budget_notification({}), {})
        self.assertEqual(guardrail.decode_budget_notification({"data": ""}), {})
        self.assertEqual(guardrail.decode_budget_notification({"data": "not base64 json"}), {})


class EvaluateTests(unittest.TestCase):
    """Only actual money counts - a forecast must never switch the project off."""

    def test_acts_once_the_actual_cost_reaches_the_budget(self) -> None:
        should, reason = guardrail.evaluate(notification(costAmount=1.0, budgetAmount=1.0))
        self.assertTrue(should)
        self.assertIn("reached the budget", reason)

    def test_acts_when_the_actual_cost_exceeds_the_budget(self) -> None:
        should, _reason = guardrail.evaluate(notification(costAmount=1.4, budgetAmount=1.0))
        self.assertTrue(should)

    def test_ignores_a_forecast_that_crosses_the_budget(self) -> None:
        """The realistic false positive: 30 cents spent, a projection of €5."""
        should, reason = guardrail.evaluate(
            notification(costAmount=0.3, budgetAmount=1.0, forecastAmount=5.0)
        )
        self.assertFalse(should)
        self.assertIn("below the budget", reason)

    def test_ignores_a_notification_without_actual_cost(self) -> None:
        should, reason = guardrail.evaluate({"budgetAmount": 1.0, "alertThresholdExceeded": 1.0})
        self.assertFalse(should)
        self.assertIn("no actual cost", reason)

    def test_ignores_a_missing_or_zero_budget(self) -> None:
        for payload in ({"costAmount": 5.0}, {"costAmount": 5.0, "budgetAmount": 0}):
            with self.subTest(payload=payload):
                should, reason = guardrail.evaluate(payload)
                self.assertFalse(should)
                self.assertIn("no usable budget", reason)

    def test_accepts_numbers_sent_as_strings(self) -> None:
        should, _reason = guardrail.evaluate(notification(costAmount="1.10", budgetAmount="1.00"))
        self.assertTrue(should)


class HandleTests(unittest.TestCase):
    """The action path: dry-run first, idempotent, and never called without a project."""

    def test_no_action_below_the_budget_and_no_api_call(self) -> None:
        with mock.patch.object(guardrail, "billing_enabled") as enabled:
            result = guardrail.handle(
                "cookbook-keep", notification(costAmount=0.2), token="t", dry_run=False
            )
        self.assertIn("no action", result)
        enabled.assert_not_called()

    def test_dry_run_reports_without_touching_billing(self) -> None:
        with mock.patch.object(guardrail, "billing_enabled") as enabled:
            with mock.patch.object(guardrail, "disable_billing") as disable:
                result = guardrail.handle(
                    "cookbook-keep", notification(), token="t", dry_run=True
                )
        self.assertIn("DRY RUN", result)
        self.assertIn("cookbook-keep", result)
        enabled.assert_not_called()
        disable.assert_not_called()

    def test_an_empty_project_is_refused_rather_than_guessed(self) -> None:
        result = guardrail.handle("", notification(), token="t", dry_run=False)
        self.assertIn("misconfigured", result)

    def test_already_disabled_billing_is_a_no_op(self) -> None:
        with mock.patch.object(guardrail, "billing_enabled", return_value=False):
            with mock.patch.object(guardrail, "disable_billing") as disable:
                result = guardrail.handle("cookbook-keep", notification(), token="t", dry_run=False)
        self.assertIn("already disabled", result)
        disable.assert_not_called()

    def test_disables_billing_when_the_budget_is_spent(self) -> None:
        with mock.patch.object(guardrail, "billing_enabled", return_value=True):
            with mock.patch.object(guardrail, "disable_billing") as disable:
                result = guardrail.handle("cookbook-keep", notification(), token="t", dry_run=False)
        disable.assert_called_once_with("cookbook-keep", "t")
        self.assertIn("DISABLED billing on cookbook-keep", result)
        # The message has to say how to undo it: the operator reads this line in an alert.
        self.assertIn("Re-attach the billing account", result)

    def test_acts_even_when_the_current_state_cannot_be_read(self) -> None:
        """Least privilege: Project Billing Manager may not read the association, only change it."""
        with mock.patch.object(
            guardrail, "billing_enabled", side_effect=RuntimeError("GET ... -> 403: denied")
        ):
            with mock.patch.object(guardrail, "disable_billing") as disable:
                result = guardrail.handle("cookbook-keep", notification(), token="t", dry_run=False)
        disable.assert_called_once_with("cookbook-keep", "t")
        self.assertIn("DISABLED billing", result)
        self.assertIn("state unreadable", result)


if __name__ == "__main__":
    unittest.main()
