"""Semantic identity of policy documents.

Two documents that decide identically must share a semantic hash, so the
improvement loop can reject a proposal that changed nothing but the wording or
the order of ANDed conditions - instead of spending two evaluation passes
rediscovering numbers it already has.

`canonical_hash` keeps its old meaning: the exact document, byte for byte.
"""

from __future__ import annotations

import copy

from app.policies.schema import validate_document
from app.policies.store import create_policy_version, find_semantic_duplicate

BASE = {
    "schema_version": "1",
    "name": "least privilege",
    "description": "scoped support agent",
    "default_effect": "deny",
    "rules": [
        {
            "id": "deny_export",
            "description": "Bulk export is never permitted.",
            "effect": "deny",
            "tools": ["export_customers"],
            "reason_code": "BULK_EXPORT_NOT_PERMITTED",
        },
        {
            "id": "allow_refund",
            "description": "Refund own eligible order within limits.",
            "effect": "allow",
            "tools": ["issue_refund"],
            "when": {
                "all": [
                    {"field": "resource.merchant_id", "op": "eq", "value_ref": "context.tenant_id"},
                    {"field": "request.amount_minor", "op": "gt", "value": 0},
                    {"field": "request.amount_minor", "op": "lte", "config_ref": "business.max_refund_minor"},
                ]
            },
            "response_fields": ["refund_id", "order_id", "amount_minor"],
        },
    ],
}


def doc(raw: dict):
    result = validate_document(raw)
    assert result.valid, result.errors
    return result.document


def test_reordering_anded_conditions_is_the_same_policy():
    """The exact v2 -> v3 case from the live run: same conditions, shuffled."""
    shuffled = copy.deepcopy(BASE)
    conditions = shuffled["rules"][1]["when"]["all"]
    shuffled["rules"][1]["when"]["all"] = [conditions[2], conditions[0], conditions[1]]

    assert doc(BASE).semantic_hash() == doc(shuffled).semantic_hash()
    # but the exact document genuinely differs, so provenance still separates them
    assert doc(BASE).canonical_hash() != doc(shuffled).canonical_hash()


def test_wording_changes_are_the_same_policy():
    reworded = copy.deepcopy(BASE)
    reworded["name"] = "a completely different name"
    reworded["description"] = "rewritten"
    reworded["rules"][0]["description"] = "No exporting, ever."
    assert doc(BASE).semantic_hash() == doc(reworded).semantic_hash()


def test_field_and_tool_ordering_is_the_same_policy():
    reordered = copy.deepcopy(BASE)
    reordered["rules"][1]["response_fields"] = ["amount_minor", "refund_id", "order_id"]
    reordered["rules"][1]["tools"] = ["issue_refund"]
    assert doc(BASE).semantic_hash() == doc(reordered).semantic_hash()


def test_changing_a_value_is_a_different_policy():
    changed = copy.deepcopy(BASE)
    changed["rules"][1]["when"]["all"][1]["value"] = 1
    assert doc(BASE).semantic_hash() != doc(changed).semantic_hash()


def test_changing_an_operator_is_a_different_policy():
    changed = copy.deepcopy(BASE)
    changed["rules"][1]["when"]["all"][2]["op"] = "lt"
    assert doc(BASE).semantic_hash() != doc(changed).semantic_hash()


def test_dropping_a_response_field_is_a_different_policy():
    narrowed = copy.deepcopy(BASE)
    narrowed["rules"][1]["response_fields"] = ["refund_id", "order_id"]
    assert doc(BASE).semantic_hash() != doc(narrowed).semantic_hash()


def test_rule_order_is_significant_and_not_normalised():
    """Deny-then-allow ordering decides outcomes, so it must change the hash."""
    swapped = copy.deepcopy(BASE)
    swapped["rules"] = [swapped["rules"][1], swapped["rules"][0]]
    assert doc(BASE).semantic_hash() != doc(swapped).semantic_hash()


def test_any_node_ordering_is_normalised_but_all_versus_any_is_not():
    or_form = copy.deepcopy(BASE)
    or_form["rules"][1]["when"] = {"any": copy.deepcopy(BASE["rules"][1]["when"]["all"])}
    or_shuffled = copy.deepcopy(or_form)
    or_shuffled["rules"][1]["when"]["any"].reverse()

    assert doc(or_form).semantic_hash() == doc(or_shuffled).semantic_hash()
    # AND and OR over the same children are different policies
    assert doc(or_form).semantic_hash() != doc(BASE).semantic_hash()


def test_duplicate_detection_finds_the_earlier_version(session):
    original = create_policy_version(session, raw_document=BASE, kind="candidate", name="original")
    shuffled = copy.deepcopy(BASE)
    shuffled["rules"][1]["when"]["all"].reverse()
    shuffled["rules"][0]["description"] = "reworded"
    twin = create_policy_version(session, raw_document=shuffled, kind="candidate", name="twin")
    session.flush()

    found = find_semantic_duplicate(
        session, family_id=twin.family_id, semantic_hash=twin.semantic_hash, exclude_id=twin.id
    )
    assert found is not None
    assert found.id == original.id

    # a genuinely different policy has no duplicate
    narrowed = copy.deepcopy(BASE)
    narrowed["rules"][1]["response_fields"] = ["refund_id"]
    other = create_policy_version(session, raw_document=narrowed, kind="candidate", name="narrower")
    session.flush()
    assert (
        find_semantic_duplicate(
            session, family_id=other.family_id, semantic_hash=other.semantic_hash, exclude_id=other.id
        )
        is None
    )


def test_invalid_documents_have_no_semantic_hash_and_never_match(session):
    broken = create_policy_version(
        session,
        raw_document={"schema_version": "1", "name": "bad", "rules": [{"id": "r", "effect": "allow", "tools": ["nope"]}]},
        kind="candidate",
    )
    session.flush()
    assert broken.validation_status == "invalid"
    assert broken.semantic_hash == ""
    assert find_semantic_duplicate(session, family_id=broken.family_id, semantic_hash="") is None
