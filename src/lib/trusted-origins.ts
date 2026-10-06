// BETTER_AUTH_URL is always trusted. Vercel preview deployments get their own host, so their
// generated URLs are trusted too; both are set by Vercel and cannot be influenced by a request.
export function trustedOrigins(source: Record<string, string | undefined>): string[] {
  const origins = new Set<string>();
  if (source.BETTER_AUTH_URL) origins.add(new URL(source.BETTER_AUTH_URL).origin);
  for (const host of [source.VERCEL_URL, source.VERCEL_BRANCH_URL]) {
    if (host) origins.add(`https://${host}`);
  }
  return [...origins];
}
