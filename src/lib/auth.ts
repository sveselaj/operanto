import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

// Compared against when the user does not exist, so unknown-account and
// wrong-password attempts take the same time.
const DUMMY_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpDLhFuLosDNKpz9icOTNXbXWJ12a";

class TooManyAttemptsError extends CredentialsSignin {
  code = "too_many_attempts";
}

/**
 * The shared rate-limit backend is configured but unreachable, so sign-in is
 * refused rather than degraded (see rate-limit.ts). Deliberately distinct from
 * "too many attempts" so an outage is not mistaken for an attack — and raised
 * BEFORE any account lookup, so it reveals nothing about whether the account
 * exists.
 */
class AuthUnavailableError extends CredentialsSignin {
  code = "temporarily_unavailable";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw, request) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        // Both limits are evaluated before the account is looked up, so
        // neither a lockout nor an outage can be used to probe for users.
        const ip = clientIp(request.headers);
        const perIp = await rateLimit(
          `login:ip:${identifierKey(ip)}`,
          40,
          15 * 60_000,
          { sensitive: true },
        );
        const perAccount = await rateLimit(
          `login:acct:${identifierKey(email)}`,
          10,
          15 * 60_000,
          { sensitive: true },
        );
        for (const verdict of [perIp, perAccount]) {
          if (verdict.backend === "denied-fail-closed") {
            throw new AuthUnavailableError();
          }
          if (!verdict.allowed) throw new TooManyAttemptsError();
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // Always run one bcrypt comparison; single generic failure outcome.
        const ok = await bcrypt.compare(
          parsed.data.password,
          user?.passwordHash ?? DUMMY_HASH,
        );
        if (!user?.passwordHash || !ok) return null;
        if (user.status !== "ACTIVE") return null;

        const activeMembership = await prisma.membership.findFirst({
          where: {
            userId: user.id,
            status: "ACTIVE",
            organisation: { status: "ACTIVE" },
          },
        });
        if (!activeMembership) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        token.issuedAt = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) {
        session.user.id = token.uid as string;
        session.user.tokenIssuedAt = (token.issuedAt as number) ?? 0;
      }
      return session;
    },
  },
});
