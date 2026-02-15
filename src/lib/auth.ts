import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import { config } from "./config";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const email = user.email.toLowerCase();

      // Single source of truth: the DB User table.
      const dbUser = await prisma.user.findUnique({ where: { email } });

      if (dbUser) {
        // User exists in DB — check if active
        return dbUser.active;
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
    async session({ session, user }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = user.id;
        // Fetch role + lastLoginAt in a single query
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true, lastLoginAt: true },
        });
        (session.user as Record<string, unknown>).role = dbUser?.role || "user";
        // Only update lastLoginAt if >1 hour stale (avoids DB write on every request)
        if (dbUser) {
          const oneHourAgo = new Date(Date.now() - 3600_000);
          if (!dbUser.lastLoginAt || dbUser.lastLoginAt < oneHourAgo) {
            prisma.user.update({
              where: { id: user.id },
              data: { lastLoginAt: new Date() },
            }).catch(() => {});
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
