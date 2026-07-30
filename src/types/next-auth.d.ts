import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** Unix seconds the JWT was issued — compared with User.sessionsRevokedAt. */
      tokenIssuedAt: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    issuedAt?: number;
  }
}
