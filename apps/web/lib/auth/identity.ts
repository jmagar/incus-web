import type { ActorContext } from "@/lib/workspaces/types";

function firstHeader(headers: Headers, names: string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function getActorFromHeaders(headers: Headers): ActorContext {
  const email =
    firstHeader(headers, [
      "x-auth-request-email",
      "x-forwarded-email",
      "x-authentik-email",
    ]) ?? "dev@incus-web.local";
  const displayName =
    firstHeader(headers, [
      "x-auth-request-preferred-username",
      "x-auth-request-user",
      "x-forwarded-user",
      "x-authentik-name",
    ]) ?? email;
  const subject =
    firstHeader(headers, ["x-auth-request-subject", "x-forwarded-sub"]) ??
    email;

  return {
    userId: `oidc:${subject}`,
    oidcSubject: subject,
    email,
    displayName,
    requestId:
      firstHeader(headers, ["x-request-id", "x-correlation-id"]) ??
      "local-dev",
    ipAddress: firstHeader(headers, ["x-forwarded-for"]),
    userAgent: firstHeader(headers, ["user-agent"]),
  };
}
