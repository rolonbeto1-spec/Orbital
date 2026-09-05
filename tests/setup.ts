/**
 * Test environment.
 *
 * Every value here is a throwaway. Notably ENCRYPTION_KEY_V1 is a fixed test
 * key: the crypto tests need a known key, and a test key that leaked would
 * protect nothing, because it only ever encrypts test fixtures.
 */
// NODE_ENV is typed readonly by Next's ambient types; tests must set it.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-not-used-anywhere-real-0123456789";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.APP_URL = "http://localhost:3000";
// 32 bytes of zeros, base64. Test-only.
process.env.ENCRYPTION_KEY_V1 = Buffer.alloc(32, 1).toString("base64");
process.env.ENCRYPTION_KEY_V2 = Buffer.alloc(32, 2).toString("base64");
process.env.ENCRYPTION_KEY_ACTIVE = "v1";
process.env.PUBLIC_SIGNUP_ENABLED = "false";
process.env.EMAIL_PROVIDER = "console";
process.env.LOG_LEVEL = "error";
// A fake Anthropic key, so the cost-control paths are actually exercised.
// tests/ai-isolation.test.ts mocks the SDK, so no request is ever sent.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-never-used-for-a-real-request";
// Deliberately absent: PLAID_*. The suite must pass with no Plaid credential,
// and the code must degrade gracefully without one.
