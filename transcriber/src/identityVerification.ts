/** PortOne/KCP ordr_idxx: 영문·숫자만, 40자 이하 */
export function createIdentityVerificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `iv${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 40);
  }
  const suffix = Math.random().toString(36).slice(2, 12);
  return `iv${Date.now()}${suffix}`.slice(0, 40);
}
