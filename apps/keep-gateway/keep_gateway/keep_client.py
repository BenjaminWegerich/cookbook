"""The Keep access layer: authentication, list lookup and reading the two lists.

This is the gateway's own copy of the technique the feasibility spike proved in
`spike/keep-feasibility/keep-spike.py`. The spike stays as the historical record of *how*
the approach was validated; the product owns its own code so the deployed image never
depends on a directory that exists to answer questions that are already answered. The
authentication call, its failure diagnosis and the list lookup are intentionally
line-for-line the same logic as the spike, so the two cannot drift in how they read a
failure - and the write technique the spike validated (marker prefix, sort ids above every
existing item, verify-then-cleanup) is the recipe the later actions must follow.

Two spike findings are encoded here and must not be "optimised" away:

  * **No state cache.** Resuming `gkeepapi` from a cached snapshot saved ~0.14 s over a
    cold sync, so a cache is not worth its storage problem - every request authenticates
    cold (`state=None`).
  * **Failures are translated, not propagated.** "Google rejected the token" and "this
    network is blocked" are different findings with different consequences, so each maps
    onto its own `GatewayError` subclass instead of a shared traceback.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any, Iterable, Mapping, NoReturn, Sequence

import gkeepapi
import requests
from gkeepapi import node

from .config import GatewayConfig
from .errors import (
    GatewayNotConfigured,
    KeepApiError,
    KeepAuthRejected,
    KeepListMissing,
    KeepUnreachable,
)

logger = logging.getLogger(__name__)

# Offset added above the highest remaining sort id when a new meal-plan entry is
# placed, so it sits at the very top of the list and never interleaves with the
# other entries. Keep's sort ids are large integers and a higher value renders
# closer to the top; the spike proved this offset on the real list, so the value
# is reused rather than re-derived (gkeepapi's own "top" policy uses +10000).
SORT_OFFSET_ABOVE_EXISTING = 1000


# --------------------------------------------------------------------------------------
# List access helpers (pure functions over a synced gkeepapi client)
# --------------------------------------------------------------------------------------


def all_lists(keep: gkeepapi.Keep) -> list[node.List]:
    """Return every (non-trashed) checklist note visible to this account."""
    return list(keep.find(func=lambda candidate: isinstance(candidate, node.List)))


def find_list_by_title(keep: gkeepapi.Keep, title: str) -> node.List:
    """Resolve a checklist by its exact title (case-insensitively).

    A missing list is a real misconfiguration - the note was unshared or renamed - so it
    raises a typed error instead of returning None; the visible titles go into the log
    line, never into the HTTP response.
    """
    wanted = title.strip().casefold()
    lists = all_lists(keep)
    for candidate in lists:
        if (candidate.title or "").strip().casefold() == wanted:
            return candidate

    visible = sorted((candidate.title or "<untitled>") for candidate in lists)
    raise KeepListMissing(
        "One of the configured Keep lists is not available.",
        detail=f"no checklist titled {title!r}; visible: {visible}",
    )


def describe_list(target: node.List) -> dict[str, Any]:
    """Render one checklist as the boundary's list shape.

    Only user-visible facts cross the boundary: the title and, in display order, each
    item's text, checked state and indentation. `id` and `sort` stay inside the gateway -
    they are Keep's implementation detail, and the roadmap is explicit that the frontend
    must not learn Keep's shape.

    `target.items` is already in display order as gkeepapi returns it (highest sort id
    first), which is exactly the order the Keep app renders, so no re-sorting happens here.
    """
    items = [
        {
            "text": item.text,
            "checked": bool(item.checked),
            "indented": bool(item.indented),
        }
        for item in target.items
    ]
    return {"title": target.title or "", "items": items}


def verify_meal_plan_checked_state(
    mealplan: dict[str, Any], checked: Iterable[str], unchecked: Iterable[str]
) -> None:
    """Refuse a check/uncheck whose result is not exactly what was asked.

    The app's "Vom Plan entfernen" ticks a meal-plan line off and its undo ticks
    it back on; both must be verified before the app reports success, exactly
    like the add/replace write (`verify_meal_plan_state`). For every text:

      * it must still be present in the list. A line the user deleted in Keep in
        the meantime cannot be ticked, and a silent no-op must not look like a
        success - the app would remove a card that is no longer there;
      * every item carrying that text must be in the requested state. A dish can
        have more than one line (the app's own duplicate rule recognizes every
        instance of one recipe), and "removed from the plan" means all of them.

    A text asked for in both directions is a caller bug, not a Keep problem, and
    is refused before any request (see `KeepClient.set_meal_plan_checked`).
    """
    # Compare on the content: Keep may keep surrounding whitespace that the
    # app's parsed texts do not carry.
    wanted_checked = [text.strip() for text in checked]
    wanted_unchecked = [text.strip() for text in unchecked]
    items = [
        {"text": item["text"].strip(), "checked": bool(item["checked"])}
        for item in mealplan["items"]
    ]
    present = {item["text"] for item in items}

    for text in wanted_checked:
        if text not in present:
            raise KeepApiError(
                "The meal plan no longer carries an entry the action named.",
                detail=f"cannot check a missing entry: {text!r}",
            )
        if any(item["text"] == text and not item["checked"] for item in items):
            raise KeepApiError(
                "A meal-plan entry the action named was not checked.",
                detail=f"still unchecked: {text!r}",
            )

    for text in wanted_unchecked:
        if text not in present:
            raise KeepApiError(
                "The meal plan no longer carries an entry the action named.",
                detail=f"cannot uncheck a missing entry: {text!r}",
            )
        if any(item["text"] == text and item["checked"] for item in items):
            raise KeepApiError(
                "A meal-plan entry the action named was still checked.",
                detail=f"still checked: {text!r}",
            )


def verify_meal_plan_state(
    mealplan: dict[str, Any], added: Iterable[str], replaced: Iterable[str]
) -> None:
    """Refuse a write whose result is not "the added lines are there, the replaced ones gone".

    Called with the state read back after the sync. Four things must hold for the
    app to render success honestly:

      * every added line is present exactly as often as it was handed over. The
        ordinary write adds one line; an undo restores what a previous write
        replaced, which may be several lines (and could in principle repeat);
      * the added lines sit at the top of the list, in the order they were given.
        The write places them above every remaining item, so a restored block
        reappears in its original reading order;
      * no replaced entry is left behind (an entry equal to an added line is that
        added line, which matters when a dish is re-planned at the size it already
        had, and when an undo restores the very text it removes);
      * nothing else was touched - the caller can only check what it asked for, so
        that part rests on the client deleting exactly the texts it was given.

    A mismatch is a `KeepApiError`: the write reached Keep but did not land as
    asked, and the app must not show a badge for it.
    """
    # A single entry may arrive as a plain string (the shape the first version of
    # this helper took); iterating it would silently compare single characters.
    ordered = [added] if isinstance(added, str) else list(added)
    expected_order = [text.strip() for text in ordered]
    # Compare on the content: Keep may keep surrounding whitespace that the
    # app's parsed texts do not carry.
    texts = [item["text"].strip() for item in mealplan["items"]]

    for text, expected in Counter(expected_order).items():
        count = texts.count(text)
        if count != expected:
            raise KeepApiError(
                "The meal plan did not end up with the expected entries.",
                detail=f"expected {expected} x {text!r}, found {count}",
            )

    if texts[: len(expected_order)] != expected_order:
        raise KeepApiError(
            "The meal plan did not place the new entries at the top.",
            detail=f"expected top {expected_order!r}, found {texts[: len(expected_order)]!r}",
        )

    added_texts = set(expected_order)
    replaced_texts = {text.strip() for text in replaced}
    stale = sorted(text for text in replaced_texts if text not in added_texts and text in texts)
    if stale:
        raise KeepApiError(
            "The meal plan still carries entries the write should have replaced.",
            detail=f"still present: {stale}",
        )


def verify_shopping_write(
    shopping: dict[str, Any],
    before: Mapping[str, int],
    added: Iterable[str],
    removed: Iterable[str],
) -> None:
    """Refuse a shopping write whose result is not the exact arithmetic it asked for.

    The mirror image of `verify_meal_plan_state`, with the one difference the
    shopping list forces: because the same line may legitimately stand on it
    twice, "correct" is not a set of texts but a *count* per text. The caller
    records how often each text was on the list before it wrote (`before`), so
    the state read back after the sync must satisfy the whole equation

        after = before - removed + added        (per text)

    That one check covers everything the app needs before it may report success:
    every added line is there as often as it was handed over, each removed line
    went down by exactly the number of times it was named - one instance per
    named text, not every instance (see `add_shopping_lines`) - the added lines
    sit at the top in the order they were given, and nothing else on the list
    moved or disappeared. `verify_meal_plan_state` cannot state it that way: there
    a line means "this dish is planned", which is why it compares a set.

    A mismatch is a `KeepApiError`: the write reached Keep but did not land as
    asked, and the app must not show the ingredients as on the list.
    """
    # A single line may arrive as a plain string (the shape `verify_meal_plan_state`
    # tolerates); iterating it would silently compare single characters.
    added_list = [added] if isinstance(added, str) else list(added)
    removed_list = [removed] if isinstance(removed, str) else list(removed)
    # Compare on the content: Keep may keep surrounding whitespace that the
    # app's parsed texts do not carry.
    texts = [item["text"].strip() for item in shopping["items"]]

    expected: Counter[str] = Counter({text.strip(): count for text, count in before.items()})
    expected.subtract(text.strip() for text in removed_list)
    expected.update(text.strip() for text in added_list)
    # `add_shopping_lines` refuses a removal the list cannot satisfy, so no count
    # can drop below zero here; `+expected` only drops the texts that went to zero.
    if Counter(texts) != +expected:
        raise KeepApiError(
            "The shopping list did not end up as the write asked.",
            detail=f"expected {dict(+expected)}, found {dict(Counter(texts))}",
        )

    expected_order = [text.strip() for text in added_list]
    if texts[: len(expected_order)] != expected_order:
        raise KeepApiError(
            "The shopping list did not place the new lines at the top.",
            detail=f"expected top {expected_order!r}, found {texts[: len(expected_order)]!r}",
        )


# --------------------------------------------------------------------------------------
# Authentication and sync
# --------------------------------------------------------------------------------------


def _translate_keep_failure(exc: Exception) -> NoReturn:
    """Map a gkeepapi / requests failure onto the matching typed gateway error.

    One place for the whole mapping, so the initial authentication and the later
    `sync()` of the write path cannot diagnose the same failure differently:

        LoginException       -> KeepAuthRejected      (the token died: re-mint it)
        non-JSON / network   -> KeepUnreachable       (this host or network is refused)
        any other Keep error -> KeepApiError
        anything else        -> re-raised unchanged

    The order matters: `JSONDecodeError` is a `RequestException`, and
    `LoginException` is a `KeepException`, so the specific cases come first.
    """
    if isinstance(exc, gkeepapi.exception.LoginException):
        # The credential is dead. This is the one Keep failure an operator must act on,
        # and the re-auth runbook (a browser cookie plus a cloud-side exchange) is why.
        raise KeepAuthRejected(
            "Google rejected the Keep credential.",
            detail="LoginException from the account-auth endpoint; the master token is invalid, "
            "expired or belongs to another account - re-mint it from the cloud.",
        ) from exc
    if isinstance(exc, requests.exceptions.JSONDecodeError):
        # Documented failure mode of the private API - how a blocked network shows up.
        raise KeepUnreachable(
            "The Keep service did not answer in a usable way.",
            detail="the private notes/v1 API returned a non-JSON response (blocked host or "
            "network, per spike/keep-feasibility/findings.md)",
        ) from exc
    if isinstance(exc, requests.exceptions.RequestException):
        raise KeepUnreachable(
            "The Keep service could not be reached.",
            detail=f"network error talking to Google: {exc}",
        ) from exc
    if isinstance(exc, gkeepapi.exception.KeepException):
        raise KeepApiError(
            "The Keep service reported an error.",
            detail=f"gkeepapi {type(exc).__name__}: {exc}",
        ) from exc
    raise exc


def authenticate(config: GatewayConfig) -> gkeepapi.Keep:
    """Authenticate and fully sync a Keep session, or raise a typed gateway error.

    Every failure mode the spike documented is mapped onto its own error (see
    `_translate_keep_failure`) so the frontend and the operator log can tell them
    apart.
    """
    missing = config.missing_keep_secrets()
    if missing:
        raise GatewayNotConfigured(
            "The Keep gateway is not configured.",
            detail=f"missing environment variables: {', '.join(missing)}",
        )

    keep = gkeepapi.Keep()
    try:
        # state=None: never resume from a cache (see the module docstring). sync=True
        # makes this call do the full download, so a request owns exactly one cold sync.
        keep.authenticate(
            config.keep_email,
            config.keep_master_token,
            state=None,
            sync=True,
            device_id=config.keep_device_id,
        )
    except Exception as exc:  # The translator re-raises anything it does not recognise.
        _translate_keep_failure(exc)

    return keep


def sync(keep: gkeepapi.Keep) -> None:
    """Push local changes to Keep, translating failures exactly like `authenticate`.

    The write path edits the local tree and then syncs; that call can fail in the
    same ways authentication can (a credential that died in between, a blocked
    network, a consistency exception), so it must not surface as a generic 500.
    """
    try:
        keep.sync()
    except Exception as exc:  # The translator re-raises anything it does not recognise.
        _translate_keep_failure(exc)


# --------------------------------------------------------------------------------------
# Per-request client
# --------------------------------------------------------------------------------------


class KeepClient:
    """One short-lived Keep connection, created per request and thrown away.

    Deliberately not a module-level singleton: the gateway keeps no session between
    requests (no state cache, no background refresh), so the cheapest correct model is to
    connect inside the request that needs data. A cold sync measured well under a second
    in the spike, which is what makes this affordable.

    The class is also the seam the HTTP layer tests replace: `app.create_app()` accepts a
    factory returning something with the same `read_state()` shape, so the boundary can be
    tested without a Keep account or network.
    """

    def __init__(self, config: GatewayConfig) -> None:
        self._config = config

    def read_state(self) -> dict[str, Any]:
        """Return the meal plan and the shopping list, in display order.

        Read-only, which is why it is the first endpoint the skeleton implements: it can
        never damage the real lists while the safer write techniques are still being built.
        """
        keep = authenticate(self._config)
        mealplan = find_list_by_title(keep, self._config.mealplan_title)
        shopping = find_list_by_title(keep, self._config.shopping_title)
        return {
            "mealplan": describe_list(mealplan),
            "shopping": describe_list(shopping),
        }

    def add_meal_plan_entries(
        self, entries: Sequence[str], replace: Iterable[str]
    ) -> dict[str, Any]:
        """Put `entries` at the top of the meal plan, replacing the given entries.

        `entries` are the complete lines the app wants to see, in the order they
        should read from the top: one line for the ordinary write
        ("Kürbissuppe: https://…/view#portionen=6" — the app's line shape, which
        the gateway treats as opaque text), several for an undo that restores the
        lines a previous write replaced, none for an undo that only takes the
        added line back off (the dish had not been planned before). `replace` are
        the exact texts of every line that names the same recipe — checked or not,
        and whatever size it states; they are removed so the dish appears exactly
        once after the write. Which lines those are is the app's rule
        (`mealPlanEntriesForTitle` in `packages/core/src/mealPlan.ts`, next to the
        parser) — re-implementing it here would let the two drift, so the gateway
        only executes the action it is handed.

        Non-destructive, following the spike's rule for the part that applies to a
        real action: the new items get sort ids above every remaining item, so they
        sit at the very top in the given order and never interleave with the rest,
        and the whole change is one sync. The list read back from that sync is
        verified (`verify_meal_plan_state`) before it is returned, so the app never
        shows the dish as planned on the strength of an unverified write.

        The answer carries only the meal plan: it is the list this action changed,
        and reading the shopping list as well would let an unrelated, missing note
        turn a successful write into an error.
        """
        added = [text.strip() for text in entries]
        if any(text == "" for text in added):
            raise ValueError("Added entry texts must be non-empty.")
        # Compare on the content: Keep may keep surrounding whitespace that the
        # app's parsed texts do not carry.
        replaced = {text.strip() for text in replace}
        # A write that neither adds nor removes would sync an untouched list and
        # (worse) could look like a successful one; the HTTP boundary already
        # refuses it, and this guard keeps a direct caller from the same mistake.
        if not added and not replaced:
            raise ValueError("A meal-plan write must add or remove at least one entry.")

        keep = authenticate(self._config)
        mealplan = find_list_by_title(keep, self._config.mealplan_title)

        for item in list(mealplan.items):
            if item.text.strip() in replaced:
                item.delete()

        # `List.items` already hides deleted items, so the maximum is taken over
        # what remains: every new entry ends up above all of them. A higher sort id
        # renders closer to the top, so the first listed line gets the highest id —
        # the reading order of the restored block survives the round trip.
        highest = max((int(item.sort) for item in mealplan.items), default=0)
        for index, text in enumerate(added):
            mealplan.add(
                text,
                False,
                highest + (len(added) - index) * SORT_OFFSET_ABOVE_EXISTING,
            )
        sync(keep)

        mealplan_state = describe_list(mealplan)
        verify_meal_plan_state(mealplan_state, added, replaced)
        return {"mealplan": mealplan_state}

    def set_meal_plan_checked(
        self, check: Iterable[str], uncheck: Iterable[str]
    ) -> dict[str, Any]:
        """Tick ("check") or untick meal-plan lines, changing nothing else.

        This is the app's "Vom Plan entfernen" and its undo. Removing a dish from
        the meal plan deliberately does **not** delete the Keep line: it is
        ticked off, so the user can still see in Keep what was cooked. `check`
        are the exact texts to tick, `uncheck` the exact texts to tick back on;
        the app owns the rule that decides which lines belong to a recipe
        (`mealPlanEntriesForTitle` in `packages/core/src/mealPlan.ts`), so this
        method only executes the action it is handed.

        Only the `checked` flag is written - the text, the sort ids and every
        unrelated item stay exactly as they are, and the whole change is one
        sync. The list read back from that sync is verified
        (`verify_meal_plan_checked_state`) before it is returned, so the app
        never removes a card on the strength of an unverified write. The answer
        carries only the meal plan, the one list this action changed.
        """
        checked = [text.strip() for text in check]
        unchecked = [text.strip() for text in uncheck]
        if any(text == "" for text in [*checked, *unchecked]):
            raise ValueError("Checked entry texts must be non-empty.")
        # A write that changes nothing would sync an untouched list and (worse)
        # could look like a successful one; the HTTP boundary already refuses
        # it, and this guard keeps a direct caller from the same mistake.
        if not checked and not unchecked:
            raise ValueError("A check write must check or uncheck at least one entry.")
        overlap = set(checked) & set(unchecked)
        if overlap:
            raise ValueError(
                f"An entry cannot be checked and unchecked at once: {sorted(overlap)}"
            )

        keep = authenticate(self._config)
        mealplan = find_list_by_title(keep, self._config.mealplan_title)

        # One lookup for both directions, so a text can only ever land in one
        # state. `wanted.get` returns None for an entry the action does not name,
        # which is what leaves every other line untouched.
        wanted: dict[str, bool] = {text: True for text in checked}
        wanted.update({text: False for text in unchecked})
        for item in mealplan.items:
            state = wanted.get(item.text.strip())
            if state is not None:
                item.checked = state
        sync(keep)

        mealplan_state = describe_list(mealplan)
        verify_meal_plan_checked_state(mealplan_state, checked, unchecked)
        return {"mealplan": mealplan_state}

    def add_shopping_lines(self, add: Sequence[str], remove: Iterable[str]) -> dict[str, Any]:
        """Put `add` at the top of the shopping list, taking the named lines back off.

        The mirror image of `add_meal_plan_entries`, with **one deliberate
        difference in what `remove` means**, because the shopping list is a list of
        things to buy and the same line may legitimately stand on it more than once:

          * `add` are the complete lines the app wants to see in "Einkaufsliste", in
            the order they should read from the top: one line per ingredient, in the
            app's display form and already rounded up to whole shopping units. That
            form and that arithmetic live in the app (`packages/core/src/shoppingList.ts`
            and the pantry sheet); the gateway treats a line as opaque text.
          * `remove` is a **multiset subtraction**: each named text takes exactly
            *one* matching item off the list, never every item carrying it. The app's
            undo hands back the lines a previous write added, so if "1 Packung Milch"
            was already on the list (typed by hand, or left by an earlier run), the
            add makes it two and the undo makes it one again - a sweep of every match
            would delete both and silently lose the user's own entry. The instances
            this gateway placed sit above everything that was there before, and
            `shopping.items` is display order (top first), so a text that exists twice
            loses *our* instance first.

        A text named in `remove` that the list does not carry (that many times) is a
        `KeepApiError` before anything is written, not a silent no-op: the app must
        not report "back to before" for an undo that did not take the line off.

        Non-destructive in the same way as the meal-plan write: the removals happen
        first, the new items get sort ids above every remaining item, and the whole
        change is one sync. The list read back from that sync is verified
        (`verify_shopping_write`) against the counts this method saw before it wrote,
        so the app never reports ingredients as on the list on the strength of an
        unverified write.

        The answer carries only the shopping list: it is the list this action changed
        (same reasoning as the meal-plan write).
        """
        added = [text.strip() for text in add]
        if any(text == "" for text in added):
            raise ValueError("Added line texts must be non-empty.")
        removed = [text.strip() for text in remove]
        if any(text == "" for text in removed):
            raise ValueError("Removed line texts must be non-empty.")
        # A write that neither adds nor removes would sync an untouched list and
        # (worse) could look like a successful one; the HTTP boundary already
        # refuses it, and this guard keeps a direct caller from the same mistake.
        if not added and not removed:
            raise ValueError("A shopping write must add or remove at least one line.")

        keep = authenticate(self._config)
        shopping = find_list_by_title(keep, self._config.shopping_title)

        # The baseline the verification measures against, taken before anything is
        # written: what has to hold afterwards is how the counts *changed*, not a
        # fixed target count (which cannot be known - the list belongs to the user).
        before = Counter(item.text.strip() for item in shopping.items)

        # Every named removal must be satisfiable before the add, so an add can never
        # be what a removal takes off, and an undo over a line the user deleted in Keep
        # in the meantime is reported instead of quietly doing nothing.
        missing = sorted(text for text, count in Counter(removed).items() if before[text] < count)
        if missing:
            raise KeepApiError(
                "The shopping list no longer carries a line the action named.",
                detail=f"cannot remove: {missing}",
            )

        remaining = Counter(removed)
        for item in list(shopping.items):
            text = item.text.strip()
            if remaining[text] > 0:
                remaining[text] -= 1
                item.delete()

        # `List.items` already hides deleted items, so the maximum is taken over what
        # remains: every new line ends up above all of them. A higher sort id renders
        # closer to the top, so the first listed line gets the highest id - the reading
        # order the app handed over survives the round trip (same technique and offset
        # as the meal-plan write).
        highest = max((int(item.sort) for item in shopping.items), default=0)
        for index, text in enumerate(added):
            shopping.add(
                text,
                False,
                highest + (len(added) - index) * SORT_OFFSET_ABOVE_EXISTING,
            )
        sync(keep)

        shopping_state = describe_list(shopping)
        verify_shopping_write(shopping_state, before, added, removed)
        return {"shopping": shopping_state}
