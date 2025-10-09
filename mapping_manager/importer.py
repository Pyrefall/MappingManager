from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple

from .models import Node


@dataclass
class ParsedTargets:
    missing: List[str]
    found: List[str]


@dataclass
class MatchResult:
    missing_matches: List[Tuple[str, Node]]
    found_matches: List[Tuple[str, Node]]
    unfound_missing: List[str]
    unfound_found: List[str]


HEADER_RE = re.compile(r"^(missing|found)\b[:\-]?\s*(.*)$", re.IGNORECASE)
TRANSITION_RE = re.compile(
    r"(missing|found).*(mouse|mice|hunter|hunters)", re.IGNORECASE
)
KEYWORD_RE = {
    "missing": re.compile(r"\bmissing\b", re.IGNORECASE),
    "found": re.compile(r"\bfound\b", re.IGNORECASE),
}
BULLET_RE = re.compile(r"^[\-\*\u2022]+")


def parse_pasted_targets(text: str) -> ParsedTargets:
    missing: List[str] = []
    found: List[str] = []
    current: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        line = BULLET_RE.sub("", line, count=1).strip()
        header = HEADER_RE.match(line)
        if header:
            current = header.group(1).lower()
            continue

        inferred = _infer_category(line, current)
        if _looks_like_header_line(line):
            if inferred:
                current = inferred
            continue

        if not inferred:
            continue

        bucket = missing if inferred == "missing" else found
        _append_target(bucket, line)

    return ParsedTargets(missing=missing, found=found)


def _infer_category(line: str, current: str | None) -> str | None:
    lower_line = line.lower()
    if KEYWORD_RE["missing"].search(lower_line):
        return "missing"
    if KEYWORD_RE["found"].search(lower_line):
        return "found"
    return current


def _looks_like_header_line(line: str) -> bool:
    lower_line = line.lower()
    if TRANSITION_RE.search(lower_line):
        return True
    if (":" in line or "(" in line or ")" in line) and (
        "missing" in lower_line or "found" in lower_line
    ):
        return True
    return False


def _append_target(bucket: List[str], text: str) -> None:
    cleaned = _clean_target_name(text)
    if cleaned and cleaned not in bucket:
        bucket.append(cleaned)


def _clean_target_name(name: str) -> str:
    cleaned = name.strip()
    cleaned = BULLET_RE.sub("", cleaned, count=1).strip()
    cleaned = HEADER_RE.sub(lambda m: m.group(2).strip(), cleaned, count=1)
    cleaned = cleaned.strip(":-—–• ").strip()
    cleaned = re.sub(r"\(\d+\)$", "", cleaned).strip()
    return cleaned


def match_targets(parsed: ParsedTargets, nodes: Iterable[Node]) -> MatchResult:
    catalog = list(nodes)
    missing_matches: List[Tuple[str, Node]] = []
    found_matches: List[Tuple[str, Node]] = []
    unfound_missing: List[str] = []
    unfound_found: List[str] = []

    for target in parsed.missing:
        node = _find_best_match(target, catalog)
        if node:
            missing_matches.append((target, node))
        else:
            unfound_missing.append(target)

    for target in parsed.found:
        node = _find_best_match(target, catalog)
        if node:
            found_matches.append((target, node))
        else:
            unfound_found.append(target)

    return MatchResult(
        missing_matches=missing_matches,
        found_matches=found_matches,
        unfound_missing=unfound_missing,
        unfound_found=unfound_found,
    )


def _find_best_match(target: str, nodes: Sequence[Node]) -> Node | None:
    target_norm = target.casefold()
    best_node: Node | None = None
    best_score: Tuple[int, int, int, int] | None = None

    for node in nodes:
        name = (node.get("name") or "").strip()
        if not name:
            continue
        name_norm = name.casefold()
        match_kind: int
        distance: int
        if name_norm == target_norm:
            match_kind = 0
            distance = 0
        elif target_norm in name_norm:
            match_kind = 1
            distance = len(name_norm) - len(target_norm)
        elif name_norm in target_norm:
            match_kind = 2
            distance = len(target_norm) - len(name_norm)
        else:
            continue

        type_weight = _type_weight(node)
        score = (type_weight, match_kind, distance, len(name_norm))
        if best_score is None or score < best_score:
            best_score = score
            best_node = node

    return best_node


def _type_weight(node: Node) -> int:
    node_type = node.get("type")
    if node_type == "enemy":
        return 0
    if node_type == "subgroup":
        return 1
    if node_type == "region":
        return 2
    return 3
