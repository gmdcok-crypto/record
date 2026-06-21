export type AdminRole = "owner" | "manager" | "operator" | "accounting" | "viewer";

export type AdminMenuKey =
  | "dashboard"
  | "jobs"
  | "transcribers"
  | "members"
  | "progress"
  | "sales"
  | "expenses"
  | "reports"
  | "analytics"
  | "admins";

export const ADMIN_ROLES: AdminRole[] = ["owner", "manager", "operator", "accounting", "viewer"];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  owner: "최고관리자",
  manager: "운영관리자",
  operator: "운영담당",
  accounting: "회계담당",
  viewer: "조회전용",
};

// Keep in sync with app/services/admin_permissions.py
const MENU_PERMISSIONS: Record<AdminMenuKey, AdminRole[]> = {
  dashboard: ["owner", "manager", "operator", "accounting", "viewer"],
  jobs: ["owner", "manager", "operator", "viewer"],
  transcribers: ["owner", "manager", "viewer"],
  members: ["owner", "manager", "operator", "viewer"],
  progress: ["owner", "manager", "operator", "accounting", "viewer"],
  sales: ["owner", "manager", "accounting"],
  expenses: ["owner", "manager", "accounting"],
  reports: ["owner", "manager", "accounting", "viewer"],
  analytics: ["owner", "manager", "accounting", "viewer"],
  admins: ["owner"],
};

export function normalizeAdminRole(role: string | null | undefined): AdminRole {
  const normalized = (role || "operator").trim().toLowerCase();
  if (normalized in ADMIN_ROLE_LABELS) return normalized as AdminRole;
  return "operator";
}

export function adminRoleLabel(role: string | null | undefined): string {
  return ADMIN_ROLE_LABELS[normalizeAdminRole(role)];
}

export function menusForRole(role: string | null | undefined): AdminMenuKey[] {
  const normalized = normalizeAdminRole(role);
  if (normalized === "owner") {
    return Object.keys(MENU_PERMISSIONS) as AdminMenuKey[];
  }
  return (Object.entries(MENU_PERMISSIONS) as Array<[AdminMenuKey, AdminRole[]]>)
    .filter(([, roles]) => roles.includes(normalized))
    .map(([menu]) => menu);
}

export function canAccessMenu(role: string | null | undefined, menu: AdminMenuKey): boolean {
  const normalized = normalizeAdminRole(role);
  if (normalized === "owner") return true;
  return MENU_PERMISSIONS[menu]?.includes(normalized) ?? false;
}

export function defaultMenuForRole(role: string | null | undefined): AdminMenuKey {
  return menusForRole(role)[0] ?? "dashboard";
}
