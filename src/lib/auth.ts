import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env, isProduction, appOrigin, signupAllowlist } from "@/lib/env";
import { sendMail, sendSecurityNotice } from "@/lib/mail";
import { log } from "@/lib/security/logger";
import { recordAudit } from "@/lib/security/audit";
import { provisionNewUser, purgeUserData } from "@/lib/account-lifecycle";

/**
 * Authentication (§4).
 *
 * The previous shared APP_PASSWORD gate is gone entirely — not extended, not
 * wrapped. This is Better Auth 1.7, which brings the things a hand-rolled
 * gate does not have: scrypt password hashing, email verification, password
 * reset with expiring single-use tokens, a real session table that can be
 * listed and revoked, signed HttpOnly cookies, origin checking on
 * state-changing requests, and first-party 2FA/passkey plugins to turn on
 * later.
 *
 * We do not write any cryptography here. Hashing, token generation and
 * session signing are all the library's (§82).
 */

// NOTE: the production-configuration check is NOT run here. It runs on the
// first request, in src/lib/security/api.ts — see assertProductionSecrets().
// Asserting at module load would fire during `next build`, when runtime
// secrets are legitimately absent, and break the build rather than the deploy.

/** Opaque, stable, non-PII reference handed to Plaid as client_user_id (§8). */
function newPlaidUserRef(): string {
  return `mu_${randomBytes(16).toString("hex")}`;
}

/**
 * Registration gate (§85). Public signup ships OFF. While it is off, only
 * addresses on SIGNUP_ALLOWLIST may register, which is how the owner and
 * invited testers get in without opening the product to the world.
 */
function signupAllowed(email: string): boolean {
  if (env.PUBLIC_SIGNUP_ENABLED) return true;
  return signupAllowlist().has(email.trim().toLowerCase());
}

export const auth = betterAuth({
  appName: "Metta",
  baseURL: appOrigin(),
  secret: env.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, {
    provider: env.DATABASE_URL.startsWith("postgres") ? "postgresql" : "sqlite",
    transaction: true,
  }),

  // The financial `Account` model owns that name, so Better Auth's own
  // credential/OAuth table is mapped to AuthAccount.
  account: { modelName: "AuthAccount" },
  verification: { modelName: "Verification" },
  session: {
    modelName: "Session",
    // 30 days, matching the previous product behaviour (a phone PWA the owner
    // does not want to re-authenticate every week).
    expiresIn: 60 * 60 * 24 * 30,
    // Rolling refresh: an active session's expiry moves forward once a day,
    // so the token in the browser is rotated rather than being valid for a
    // fixed 30 days from issue (§5).
    updateAge: 60 * 60 * 24,
    // No cookie-cached session: we want every request to consult the session
    // table so that a revoked session stops working immediately rather than
    // up to five minutes later (§62 "revoked session denied").
    cookieCache: { enabled: false, maxAge: 0 },
  },

  user: {
    modelName: "User",
    additionalFields: {
      role: { type: "string", defaultValue: "USER", input: false },
      timezone: { type: "string", defaultValue: "UTC", input: false },
      /**
       * Minted here, by a function, on every create.
       *
       * `required: true` with `input: false` and no default is unsatisfiable:
       * Better Auth validates the create payload BEFORE the databaseHook that
       * was filling this in, and the client is forbidden from supplying it,
       * so every registration failed with "plaidUserRef is required". Account
       * creation was impossible.
       *
       * A function default runs per user, so two accounts never share a
       * reference — which matters, because this is the identifier Plaid sees.
       */
      plaidUserRef: {
        type: "string",
        required: true,
        input: false,
        defaultValue: () => newPlaidUserRef(),
      },
      termsAcceptedAt: { type: "date", required: false, input: false },
      privacyAcceptedAt: { type: "date", required: false, input: false },
      bankConsentAt: { type: "date", required: false, input: false },
      onboardedAt: { type: "date", required: false, input: false },
      aiDailyLimit: { type: "number", required: false, input: false },
      deletedAt: { type: "date", required: false, input: false },
    },

    deleteUser: {
      enabled: true,
      // Deleting an account is irreversible and destroys financial history,
      // so it is confirmed by email rather than by a single click (§37).
      sendDeleteAccountVerification: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Confirm deleting your Metta account",
          text:
            "You asked to delete your Metta account.\n\n" +
            "This permanently removes your bank connections, transactions, " +
            "budgets, goals and settings. It cannot be undone.\n\n" +
            `Confirm here (link expires in 24 hours):\n${url}\n\n` +
            "If you did not ask for this, ignore this email and change your " +
            "password.",
        });
      },
      // Runs inside Better Auth's deletion flow, before the User row goes.
      // Revokes bank access at Plaid and destroys the encrypted credentials.
      beforeDelete: async (user) => {
        await purgeUserData(user.id);
      },
      afterDelete: async (user) => {
        await recordAudit({
          userId: null, // the row is gone; the trail deliberately survives it
          type: "account.deleted",
          meta: { hadEmail: true, userRef: user.id.slice(0, 8) },
        });
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    // OWASP ASVS: length is the control that matters; a maximum exists only to
    // bound scrypt's work factor.
    minPasswordLength: 12,
    maxPasswordLength: 128,
    // A session is not issued until the address is proven (§69).
    requireEmailVerification: true,
    autoSignIn: false,
    // Resetting a password kicks every other device off — the common case for
    // a reset is "someone else may have my account" (§4, §71).
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour

    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Reset your Metta password",
        text:
          "Someone asked to reset the password for your Metta account.\n\n" +
          `Reset it here (link expires in 1 hour and can be used once):\n${url}\n\n` +
          "If this was not you, you can ignore this email — your password has " +
          "not changed.",
      });
    },

    onPasswordReset: async ({ user }) => {
      await recordAudit({ userId: user.id, type: "auth.password_reset" });
      await sendSecurityNotice(user.email, "password-reset");
    },

    /**
     * Anti-enumeration (§24). When someone signs up with an address that
     * already exists, Better Auth returns a synthetic success rather than
     * "that email is taken", and notifies the real account holder instead.
     */
    onExistingUserSignUp: async ({ user }) => {
      await recordAudit({ userId: user.id, type: "auth.signup_existing_email" });
      try {
        await sendMail({
          to: user.email,
          subject: "Someone tried to sign up with your email",
          text:
            "Someone just tried to create a Metta account with your email " +
            "address.\n\nIf that was you, you already have an account — sign in " +
            "instead, or reset your password if you have forgotten it.\n\n" +
            "If it was not you, no action is needed. Your account is unchanged.",
        });
      } catch {
        // Never let a mail failure change the response shape — that would
        // reintroduce the enumeration oracle we just closed.
      }
    },

    // The synthetic user returned for an existing address must be
    // indistinguishable from a real signup, including our added fields.
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      role: "USER",
      timezone: "UTC",
      plaidUserRef: newPlaidUserRef(),
      termsAcceptedAt: null,
      privacyAcceptedAt: null,
      bankConsentAt: null,
      onboardedAt: null,
      aiDailyLimit: null,
      deletedAt: null,
      ...additionalFields,
      id,
    }),
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24 hours
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Confirm your email for Metta",
        text:
          "Welcome to Metta.\n\n" +
          `Confirm your email address to finish setting up your account:\n${url}\n\n` +
          "This link expires in 24 hours.\n\n" +
          "Metta connects to your bank read-only. It can see balances and " +
          "transactions, and it can never move money.",
      });
    },
    afterEmailVerification: async (user) => {
      await recordAudit({ userId: user.id, type: "auth.email_verified" });
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * Registration gate + identity provisioning.
         *
         * Runs before the row is written, so a rejected signup never creates
         * a User. The Plaid reference is minted here rather than in a route
         * so that *every* path that can create a user (including future OAuth
         * providers) gets one.
         */
        before: async (user) => {
          if (!signupAllowed(user.email)) {
            log.warn("Registration refused: signup is closed");
            throw new Error("Registration is not open yet.");
          }
          return {
            data: {
              ...user,
              plaidUserRef: newPlaidUserRef(),
            },
          };
        },
        /**
         * A brand-new user needs their own copy of the category catalog
         * before any other feature works. Seeding it here means there is no
         * request path that can observe a user without categories.
         */
        after: async (user) => {
          await provisionNewUser(user.id);
          await recordAudit({ userId: user.id, type: "account.created" });
        },
      },
    },
    session: {
      create: {
        /**
         * A user marked deleted must not be able to obtain a new session,
         * even if their credentials still verify while deletion drains.
         */
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { deletedAt: true },
          });
          if (user?.deletedAt) {
            throw new Error("This account has been deleted.");
          }
          return { data: session };
        },
        after: async (session) => {
          await recordAudit({
            userId: session.userId,
            type: "auth.login",
            ip: session.ipAddress ?? undefined,
            userAgent: session.userAgent ?? undefined,
          });
        },
      },
    },
  },

  // Better Auth's own limiter, in front of its own endpoints. The
  // application's endpoints use src/lib/security/rate-limit.ts (§22).
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "BetterAuthRateLimit",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 300, max: 8 },
      "/sign-up/email": { window: 3600, max: 5 },
      "/forget-password": { window: 3600, max: 5 },
      "/reset-password": { window: 3600, max: 8 },
      "/send-verification-email": { window: 3600, max: 5 },
      "/change-password": { window: 3600, max: 10 },
      "/delete-user": { window: 3600, max: 5 },
    },
  },

  advanced: {
    // Pinned explicitly so the proxy's optimistic cookie check and the auth
    // server cannot disagree about the cookie name.
    cookiePrefix: "metta",
    // HTTPS-only cookies in production (§5, §27).
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax", // "lax" so the email-verification GET still carries it
      secure: isProduction,
      path: "/",
    },
    // Do NOT enable: origin checking on state-changing requests is a core
    // CSRF control (§17).
    disableCSRFCheck: false,
    database: {
      // cuid-shaped ids from the same generator the rest of the schema uses.
      generateId: () => `u_${randomBytes(16).toString("hex")}`,
    },
  },

  // Only our own origin may drive authentication. No wildcards (§18).
  trustedOrigins: [appOrigin()],

  onAPIError: {
    onError: (error) => {
      // Auth errors are logged with redaction and never returned verbatim.
      log.warn("Auth API error", { error });
    },
  },

  plugins: [
    // Must be last: writes Better Auth's Set-Cookie headers through Next's
    // cookie API in server actions and route handlers.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
