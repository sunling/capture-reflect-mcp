# Account selection during OAuth connection

This optional flow puts GitHub account and repository selection before the return to the AI client:

```text
ChatGPT Connect → WorkOS → /auth/login → GitHub account picker
→ /auth/github/callback → repository selection → WorkOS completion → ChatGPT
```

The old hosted-auth flow remains available while `WORKOS_STANDALONE_ENABLED=false`. Code deployment alone does not activate this flow. Test in a separate WorkOS environment and deployment first.

## Prerequisites

1. In the GitHub App settings, retain `/github/callback` and add the exact new callback `https://api.bysunling.com/auth/github/callback` (use the staging origin when testing). The install setup URL remains `/github/installed`.
2. Add **Account permissions → Email addresses: Read-only** to the GitHub App. Approve the permission update where required. Standalone login calls `/user/emails` and requires a verified primary email; it never trusts an unverified profile email. Existing Contents and Metadata permissions remain unchanged.
3. Store a WorkOS environment API key as the server-only `WORKOS_API_KEY` in Netlify. Do not put this key in a public client or paste it into chat. The key must permit user lookup/creation and Standalone Connect completion in the same environment as `WORKOS_AUTHKIT_DOMAIN`.
4. Complete the identity mapping checks below before switching the production Login URI.

## Existing user migration

Standalone authentication uses the immutable numeric GitHub user ID, namespaced as `github:123456`, as the WorkOS **external ID**. GitHub usernames and email addresses are not identity keys. The MCP continues to use the WorkOS user ID from the access token's `sub`; no existing connection row is renamed or deleted.

For each existing `user_connections` row:

1. Read only `workos_user_id`, `github_user_id`, and `github_login` from the database. Do not export encrypted tokens.
2. Verify that the existing WorkOS user really belongs to the person controlling that GitHub account. Do not rely on an email match alone.
3. Set that **existing** WorkOS user's `external_id` to `github:<github_user_id>` using the WorkOS user update API or its supported administration UI. Preserve its WorkOS ID, email, and other fields. If a different external ID is already in use elsewhere, resolve that dependency before changing it.
4. Check that WorkOS lookup by this external ID returns exactly the `workos_user_id` already stored in the connection row.

Do not create a replacement WorkOS user for a legacy mapping. If multiple rows share a GitHub ID, or its external ID resolves to another WorkOS user, resolve the ambiguity explicitly before activation. The implementation stops these cases without merging accounts. A new GitHub identity whose email conflicts with another WorkOS identity also stops; email conflicts are not automatically merged.

This changes the authentication model: each GitHub account is a distinct login identity. Switching from GitHub A to B during reconnect signs into B's identity. It does not move A's records or attach B to A's WorkOS identity. Existing clients authenticated as A remain associated with A; reconnect each client that should use B.

## Activate after deployment

1. Deploy the code and set `WORKOS_STANDALONE_ENABLED=true` and `WORKOS_API_KEY` in the deployment environment.
2. In **WorkOS Dashboard → Connect → Configuration**, set **Login URI** to `https://api.bysunling.com/auth/login`. This setting applies to the WorkOS environment, so check other Connect applications sharing it. Do not change ChatGPT's OAuth callback to our URL.
3. Keep CIMD enabled (and DCR for clients that require it). Keep the resource indicator and AuthKit domain consistent with the current MCP configuration.
4. Disconnect/reconnect in a test AI-client session. Confirm that `/auth/login` is visited and that GitHub's account picker appears even with an existing browser session. Choose the intended account and an accessible repository.
5. After **Save & connect**, confirm the browser visits the configured AuthKit completion endpoint and then returns to the client's original OAuth callback. Read a record from the selected repository to confirm the final token resolves to the intended connection.
6. Repeat with a second GitHub account and with an existing migrated user. Confirm that the accounts remain separate and no records are moved or overwritten.

Do not reuse or manually edit OAuth callback URLs. Their codes, state values, and completion identifiers are specific to an authorization attempt.

## Failure behavior and verification limits

- Login state and setup tokens have separate audiences and expire after 15 minutes. GitHub OAuth state is bound to the initiating browser cookie. After that check succeeds, the signed setup token carries the verified identity and one-time WorkOS completion context across clients that do not preserve cookies between OAuth windows.
- GitHub credentials are stored encrypted server-side, never inside login/setup cookies. Successful GitHub authorization clears the previous repository selection and requires a fresh selection.
- WorkOS completion runs only after repository authorization checks, initialization, and selection succeed. A failure returns an error without claiming the AI client is connected. Restart from the AI client if WorkOS's temporary authorization context expired or was already consumed.
- New WorkOS user creation can precede consent completion. A canceled flow may leave a user/authorization record, but does not move existing personal records.
- The returned completion URL must use HTTPS on the exact configured AuthKit origin, without embedded credentials. The continuation path comes from the authenticated WorkOS API and is not restricted to documentation examples. Domain mismatch errors show only the received and expected origins; check that the API key and AuthKit domain belong to the same environment. Upstream error payloads are not shown to users.
- In standalone mode, legacy setup links can manage the signed-in identity's repository; switching to a different identity requires the AI client's reconnect flow.
- Automated tests simulate GitHub, WorkOS, and database responses. They do not prove the live dashboard configuration, provider permissions, token claims, or client behavior. Complete the live checks above before calling production activation finished.

## Rollback

Restore the previous WorkOS Login URI configuration first, then set `WORKOS_STANDALONE_ENABLED=false`. The original `/setup` and `/github/callback` flow remains available. Preserve external IDs and connection rows unless a separately reviewed identity change is needed; rollback must not delete records or credentials blindly.

## References

- [WorkOS Standalone Connect](https://workos.com/docs/authkit/connect/standalone)
- [WorkOS completion API](https://workos.com/docs/reference/workos-connect/standalone)
- [WorkOS user lookup, creation, and updates](https://workos.com/docs/reference/authkit/user)
- [GitHub App account picker](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub verified email permissions](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user)
