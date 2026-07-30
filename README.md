# GitHub Scraper - Repos, Users & Issues

Scrape public GitHub repository and profile metadata through the official GitHub REST API. Start with a repository, username, organization, or repository search query, then export clean rows to JSON, CSV, Excel, HTML, or the Apify API.

This Actor is API-based, lightweight, and does not need a browser. A GitHub token is optional, but recommended for larger jobs because unauthenticated GitHub API calls are limited to 60 requests per hour per IP.

## What It Extracts

- Repository name, owner, description, URL, homepage, language, license, topics, stars, forks, watchers, open issues, archive/fork status, default branch, created/updated/pushed dates
- Optional nested recent issues and pull requests for each repository
- User or organization login, name, type, company, location, bio, public counts, followers, following, profile URL, and created/updated dates
- Optional nested repositories for each user or organization
- Scrape timestamp plus machine-readable run diagnostics

## Quick Start

Use this small input first:

```json
{
  "repos": ["openai/openai-node"],
  "users": [],
  "searchQueries": [],
  "includeIssues": false,
  "maxIssuesPerRepo": 0,
  "includeUserRepos": false,
  "maxReposPerUser": 0,
  "maxResults": 1,
  "githubToken": "",
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

For larger jobs, add a GitHub token with no scopes for public data. Prefer a token over proxy rotation for normal GitHub API usage.

## Input

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `repos` | array<string> | `["openai/openai-node"]` | `owner/repo` or GitHub repository URLs. |
| `users` | array<string> | `[]` | GitHub usernames or organization names. |
| `searchQueries` | array<string> | `[]` | GitHub repository search syntax, e.g. `topic:typescript stars:>1000`. |
| `includeIssues` | boolean | `false` | Adds recent issues and pull requests inside each repository record. |
| `maxIssuesPerRepo` | integer | `20` | Applies only when `includeIssues` is enabled. |
| `includeUserRepos` | boolean | `false` | Adds repositories inside each user or organization record. |
| `maxReposPerUser` | integer | `20` | Applies only when `includeUserRepos` is enabled. |
| `maxResults` | integer | `1` | Maximum repositories from explicit repos and search queries. Use 1-5 for tests. |
| `githubToken` | secret string | empty | Optional token for higher GitHub API limits. |
| `proxyConfiguration` | object | disabled | Keep disabled unless you intentionally need proxy routing. |

Input is validated before any request. Repository URLs must point to one exact
`owner/repo` path, profile URLs must point to one exact user or organization, and
duplicates are removed case-insensitively. A run accepts at most 1,000 repository
inputs, 500 user or organization inputs, and 20 repository search queries.

## Output Dataset

The default dataset contains repository records and user/organization records. The Store table includes separate views for repositories and users/organizations, while JSON exports include the full nested issue or repository arrays when those options are enabled.

The default key-value store also contains `RUN_STATUS`. It records saved repository
and user counts, completed or skipped searches, duplicate and not-found targets,
GitHub incomplete-search signals, non-public records skipped, spending/runtime stops, and a sanitized failure
message when the official API cannot provide trustworthy data.

Verified sample from an existing successful run:

```json
{
  "entityType": "repo",
  "repoId": 438419937,
  "fullName": "openai/openai-node",
  "name": "openai-node",
  "owner": "openai",
  "description": "Official JavaScript / TypeScript library for the OpenAI API",
  "url": "https://github.com/openai/openai-node",
  "homepage": "https://www.npmjs.com/package/openai",
  "language": "TypeScript",
  "stars": 10984,
  "forks": 1520,
  "watchers": 156,
  "openIssues": 264,
  "license": "Apache-2.0",
  "topics": ["nodejs", "openai", "typescript"],
  "isFork": false,
  "isArchived": false,
  "defaultBranch": "main",
  "createdAt": "2021-12-14T22:32:58Z",
  "updatedAt": "2026-06-21T04:29:27Z",
  "pushedAt": "2026-06-18T02:14:48Z",
  "issuesScrapedCount": 0,
  "issues": [],
  "scrapedAt": "2026-06-21T07:13:13.054Z"
}
```

## Pricing And Cost Control

Current live pricing and Store competition checked on 2026-07-30:

| Event | Active price |
| --- | ---: |
| `repo-scraped` | `$0.002` per repository/user record |
| `apify-actor-start` | `$0.00005` per GB |

Nested issues and nested user repositories are included inside the saved repo/user record. The Actor saves and charges each repo/user record atomically and stops when the user's spending limit is reached.

The `$2/1,000` price is intentionally retained between current comparable
repository/user Actors advertised around `$1.50/1,000` and `$3.78/1,000`.
Scope differs across Actors; this Actor includes optional nested issues and
user repositories without charging each nested item separately.

Cost-control tips:

- Test with one repository and `maxResults: 1`.
- Keep `includeIssues` and `includeUserRepos` disabled until you need nested data.
- Use a GitHub token for larger jobs instead of proxy routing.
- Split very broad search queries into smaller runs.

## Use Cases

- Open-source ecosystem research
- Repository and dependency intelligence
- Technical due-diligence datasets
- Organization and project monitoring
- Public issue and pull-request analysis

## Known Limits

- Unauthenticated GitHub API calls are limited to 60 requests/hour per IP.
- GitHub Search API exposes at most 1,000 results per query and can mark a response as incomplete; narrow search queries work better.
- This Actor collects public GitHub data only. It does not bypass private repositories or authentication.

## Reliability Behavior

- Requests have a 20-second timeout and bounded retries for network and transient `5xx` failures.
- Real rate limits honor GitHub's `Retry-After` or `X-RateLimit-Reset` headers when the wait is short enough; longer limits fail clearly instead of hammering the API.
- `401`, ordinary `403`, rate-limit `403/429`, confirmed `404`, malformed JSON, and valid empty searches are handled as distinct outcomes.
- Records are validated before the atomic dataset write and `repo-scraped` event charge.
- Private repository payloads exposed by an over-scoped user token are skipped before nested requests or billing.
- Requests run serially to reduce GitHub secondary-rate-limit risk, and a safe runtime guard stops before the platform timeout.

## Responsible Use

Use this Actor only for lawful collection and analysis of public GitHub data. Follow GitHub's terms, applicable privacy laws, anti-spam rules, and your own compliance requirements. Do not use exported profiles for spam or harassment.

## License

Apache-2.0
