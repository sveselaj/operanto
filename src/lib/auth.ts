import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

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
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        const perAccount = await rateLimit(`login:acct:${email}`, 10, 15 * 60_000);
        if (!perAccount.allowed) throw new TooManyAttemptsError();

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
