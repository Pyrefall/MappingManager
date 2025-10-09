from __future__ import annotations

import uuid
from typing import Any, Dict, Generator, List, Optional, Tuple

Node = Dict[str, Any]


def gen_id() -> str:
    return str(uuid.uuid4())


def default_node(name: str, node_type: str) -> Node:
    node: Node = {
        "id": gen_id(),
        "type": node_type,
        "name": name,
        "include": True,
        "completed": False,
        "override_message": "",
        "needs_snipe": False,
        "price": 0,
        "children": [],
        "sidenotes": "",
    }
    if node_type in {"subgroup", "region"}:
        node["must_contains_all"] = True
        node["auto_collapse"] = False
    return node


def deep_find(list_nodes: List[Node], node_id: str) -> Tuple[Optional[Node], Optional[List[Node]]]:
    stack: List[Tuple[List[Node], Optional[Node]]] = [(list_nodes, None)]
    while stack:
        cur_list, _ = stack.pop()
        for node in cur_list:
            if node.get("id") == node_id:
                return node, cur_list
            children = node.get("children") or []
            if children:
                stack.append((children, node))
    return None, None


def deep_delete(list_nodes: List[Node], node_id: str) -> bool:
    for idx, node in enumerate(list_nodes):
        if node.get("id") == node_id:
            del list_nodes[idx]
            return True
        if deep_delete(node.get("children") or [], node_id):
            return True
    return False


def preorder_iter(list_nodes: List[Node]) -> Generator[Node, None, None]:
    for node in list_nodes:
        yield node
        children = node.get("children") or []
        if children:
            yield from preorder_iter(children)


def ensure_node_defaults(node: Node) -> None:
    node_type = node.get("type")
    if node_type in {"subgroup", "region"}:
        node.setdefault("must_contains_all", True)
        node.setdefault("auto_collapse", False)
    for child in node.get("children") or []:
        ensure_node_defaults(child)


def ensure_tree_defaults(list_nodes: List[Node]) -> None:
    for node in list_nodes:
        ensure_node_defaults(node)
