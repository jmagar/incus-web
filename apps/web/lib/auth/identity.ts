import type { ActorContext } from "@/lib/workspaces/types";

export class AuthenticationRequiredError extends Error {
  constructor(message = "authenticated identity headers are required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

function requireTrustedIdentityHeaders(headers: Headers) {
  const secret = process.env.INCUS_WEB_TRUSTED_PROXY_SECRET?.trim();
  if (!secret) return;

  if (headers.get("x-incus-web-proxy-secret")?.trim() !== secret) {
    throw new AuthenticationRequiredError("trusted proxy secret is required");
  }
}

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
  requireTrustedIdentityHeaders(headers);

  const email =
    firstHeader(headers, [
      "x-auth-request-email",
      "x-forwarded-email",
      "remote-email",
      "x-authentik-email",
    ]) ?? devIdentity();
  const displayName =
    firstHeader(headers, [
      "x-auth-request-preferred-username",
      "x-auth-request-user",
      "x-forwarded-user",
      "remote-name",
      "remote-user",
      "x-authentik-name",
    ]) ?? email;
  const subject =
    firstHeader(headers, [
      "x-auth-request-subject",
      "x-forwarded-sub",
      "remote-user",
    ]) ??
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

function devIdentity(): string {
  if (
    process.env.INCUS_WEB_ALLOW_DEV_AUTH === "1" ||
    process.env.NODE_ENV !== "production"
  ) {
    return "dev@incus-web.local";
  }

  throw new AuthenticationRequiredError();
}
