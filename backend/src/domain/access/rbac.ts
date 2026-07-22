/**
 * RBAC + ABAC checks shared by the API middleware (mirrors docs/etms/04).
 * Pure functions over the caller's resolved permissions and scope.
 */
export interface Principal {
  userId: string;
  tenantId: string;
  permissions: ReadonlySet<string>;
  /** null/empty = tenant-wide; otherwise limited to these site ids (ABAC). */
  scopeSiteIds?: readonly string[] | null;
  /** true when the access token was minted after an MFA step-up challenge. */
  mfa?: boolean;
}

export function can(principal: Principal, permission: string): boolean {
  return principal.permissions.has(permission);
}

export function canAll(principal: Principal, permissions: readonly string[]): boolean {
  return permissions.every((p) => principal.permissions.has(p));
}

export function canAny(principal: Principal, permissions: readonly string[]): boolean {
  return permissions.some((p) => principal.permissions.has(p));
}

/** ABAC: is a given site within the principal's scope? (empty scope = all). */
export function inSiteScope(principal: Principal, siteId: string): boolean {
  const scope = principal.scopeSiteIds;
  return !scope || scope.length === 0 || scope.includes(siteId);
}
