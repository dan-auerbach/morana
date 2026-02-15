import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import { config } from "./config";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  // JWT strategy is required for Edge middleware on Vercel
  // (Edge runtime cannot access the database to validate session tokens)
  session: { strategy: "jwt" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;
      const email = user.email.toLowerCase();

      // Single source of truth: the DB User table.
      const dbUser = await prisma.user.findUnique({ where: { email } });

      if (dbUser) {
        // User exists in DB — check if active
        if (!dbUser.active) return false;

        // Ensure the OAuth Account link exists.
        // When admin pre-creates a user via the admin panel, the User record
        // exists but there's no Account record linking it to Google.
        // PrismaAdapter will try to createUser() which fails on unique email.
        // We fix this by creating the Account link here if missing.
        if (account) {
          const existingAccount = await prisma.account.findUnique({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
            },
          });
          if (!existingAccount) {
            await prisma.account.create({
              data: {
                userId: dbUser.id,
                type: account.type,
                provider: account.provider,
                providerAccountId: account.providerAccountId,
                refresh_token: account.refresh_token,
                access_token: account.access_token,
                expires_at: account.expires_at,
                token_type: account.token_type,
                scope: account.scope,
                id_token: account.id_token,
                session_state: account.session_state as string | null,
              },
            }).catch(() => {
              // Race condition or already exists — fine
            });
          }
        }

        // Overwrite user.id so the JWT callback gets the correct DB id
        user.id = dbUser.id;
        return true;
      }

      // BOOTSTRAP: if email is in ALLOWED_EMAILS env, auto-create in DB.
      // This only runs on the very first sign-in for bootstrap emails.
      // After that the DB is the sole authority.
      if (config.bootstrapEmails.includes(email)) {
        await prisma.user.create({
          data: {
            email,
            role: email === config.bootstrapEmails[0] ? "admin" : "user",
            active: true,
          },
        }).catch(() => {
          // Race condition: user was created between findUnique and create
          // This is fine, the PrismaAdapter will link the account
        });
        return true;
      }

      // Not in DB and not a bootstrap email → deny
      return false;
    },
    async jwt({ token, user }) {
      // On first sign-in, `user` is set — persist id + role into the JWT
      if (user) {
        token.id = user.id;
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        });
        token.role = dbUser?.role || "user";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        (session.user as Record<string, unknown>).id = token.id;
        (session.user as Record<string, unknown>).role = token.role || "user";
        // Update lastLoginAt if >1 hour stale (fire-and-forget)
        if (token.id) {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { lastLoginAt: true },
          });
          if (dbUser) {
            const oneHourAgo = new Date(Date.now() - 3600_000);
            if (!dbUser.lastLoginAt || dbUser.lastLoginAt < oneHourAgo) {
              prisma.user.update({
                where: { id: token.id as string },
                data: { lastLoginAt: new Date() },
              }).catch(() => {});
            }
          }
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
};
