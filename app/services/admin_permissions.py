from __future__ import annotations

from typing import Literal

AdminRole = Literal["owner", "manager", "operator", "accounting", "viewer"]

ADMIN_ROLES: tuple[AdminRole, ...] = ("owner", "manager", "operator", "accounting", "viewer")

ADMIN_ROLE_LABELS: dict[AdminRole, str] = {
    "owner": "최고관리자",
    "manager": "운영관리자",
    "operator": "운영담당",
    "accounting": "회계담당",
    "viewer": "조회전용",
}

MENU_KEYS: tuple[str, ...] = (
    "dashboard",
    "jobs",
    "transcribers",
    "members",
    "sales",
    "expenses",
    "reports",
    "analytics",
    "admins",
)

MENU_PERMISSIONS: dict[str, tuple[AdminRole, ...]] = {
    "dashboard": ("owner", "manager", "operator", "accounting", "viewer"),
    "jobs": ("owner", "manager", "operator", "viewer"),
    "transcribers": ("owner", "manager", "viewer"),
    "members": ("owner", "manager", "operator", "viewer"),
    "sales": ("owner", "manager", "accounting"),
    "expenses": ("owner", "manager", "accounting"),
    "reports": ("owner", "manager", "accounting", "viewer"),
    "analytics": ("owner", "manager", "accounting", "viewer"),
    "admins": ("owner",),
}


def normalize_admin_role(role: str | None) -> AdminRole:
    normalized = (role or "operator").strip().lower()
    if normalized in ADMIN_ROLES:
        return normalized  # type: ignore[return-value]
    return "operator"


def role_label(role: str | None) -> str:
    return ADMIN_ROLE_LABELS.get(normalize_admin_role(role), "운영담당")


def menus_for_role(role: str | None) -> list[str]:
    normalized = normalize_admin_role(role)
    if normalized == "owner":
        return list(MENU_KEYS)
    return [menu for menu, roles in MENU_PERMISSIONS.items() if normalized in roles]


def permissions_for_role(role: str | None) -> list[str]:
    normalized = normalize_admin_role(role)
    if normalized == "owner":
        return ["*"]
    return [f"menu:{menu}" for menu in menus_for_role(normalized)]


def can_access_menu(role: str | None, menu: str) -> bool:
    normalized = normalize_admin_role(role)
    if normalized == "owner":
        return True
    allowed = MENU_PERMISSIONS.get(menu)
    if allowed is None:
        return False
    return normalized in allowed


def has_permission(role: str | None, permission: str) -> bool:
    normalized = normalize_admin_role(role)
    if normalized == "owner":
        return True
    if permission == "*":
        return False
    if permission.startswith("menu:"):
        return can_access_menu(normalized, permission.removeprefix("menu:"))
    return permission in permissions_for_role(normalized)
