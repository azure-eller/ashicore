export const TEST_ACCOUNT_EMAIL = process.env.TEST_EMAIL ?? "test@test.com";
export const TEST_ACCOUNT_PASSWORD =
  process.env.TEST_PASSWORD ?? "TestPassword123!";
export const TEST_ACCOUNT_NAME = process.env.TEST_NAME ?? "Test User";
export const TEST_ACCOUNT_ORG_NAME = process.env.TEST_ORG ?? "Test Org";
export const TEST_ACCOUNT_ORG_SLUG = process.env.TEST_ORG_SLUG ?? "test-org";

export const TEST_ACCOUNT = {
  email: TEST_ACCOUNT_EMAIL,
  password: TEST_ACCOUNT_PASSWORD,
  name: TEST_ACCOUNT_NAME,
  organizationName: TEST_ACCOUNT_ORG_NAME,
  organizationSlug: TEST_ACCOUNT_ORG_SLUG,
};
