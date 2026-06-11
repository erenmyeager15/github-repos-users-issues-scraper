# GitHub Scraper - Repos, Users & Issues

Scrape **GitHub repositories, users, and issues** via the official GitHub REST API - no login required (add a free token for higher rate limits). Get stars, forks, languages, topics, licenses, open-issue counts, full user profiles, follower counts, and recent issues/PRs. Search repositories by query. Export to **JSON, CSV, Excel, or HTML**, or pull via the Apify API.

Perfect for **developer lead generation, OSS research, tech-trend analysis, and recruiting**.

## Features

- ✅ **Official GitHub API** - accurate, structured data
- ✅ **Repos, users, and issues** in one actor
- ✅ **Repository search** by query (language, stars, topics, etc.)
- ✅ **Nested data** - issues nested per repo, repos nested per user (no messy mixed rows)
- ✅ **Optional token** - 5,000 requests/hour with a free GitHub token (60/hour without)
- ✅ **Proxy rotation** - multiply the unauthenticated limit across IPs
- ✅ **Fast & lightweight** - pure API, no headless browser

## Input

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `repos` | `string[]` | `"owner/repo"` or GitHub URLs | `["facebook/react"]` |
| `users` | `string[]` | Usernames / org names | `[]` |
| `searchQueries` | `string[]` | Repo search queries | `[]` |
| `includeIssues` | `boolean` | Nest recent issues/PRs per repo | `false` |
| `maxIssuesPerRepo` | `integer` | Max issues per repo | `20` |
| `includeUserRepos` | `boolean` | Nest a user's repos per user | `false` |
| `maxReposPerUser` | `integer` | Max repos per user | `20` |
| `maxResults` | `integer` | Max repos total | `50` |
| `githubToken` | `string` (secret) | Personal access token for higher limits | `""` |
| `proxyConfiguration` | `object` | Proxy settings | Apify Proxy |

### Example input

```json
{
  "repos": ["facebook/react"],
  "users": ["torvalds"],
  "searchQueries": ["web scraper language:python stars:>1000"],
  "includeIssues": true,
  "maxIssuesPerRepo": 20,
  "githubToken": "ghp_xxx"
}
```

## Sample output

### Repository

```json
{
  "entityType": "repo",
  "fullName": "facebook/react",
  "owner": "facebook",
  "description": "The library for web and native user interfaces.",
  "language": "JavaScript",
  "stars": 245739,
  "forks": 51045,
  "openIssues": 1276,
  "license": "MIT",
  "topics": ["javascript", "react", "ui", "frontend"],
  "createdAt": "2013-05-24T16:15:54Z",
  "pushedAt": "2026-06-10T18:19:47Z",
  "url": "https://github.com/facebook/react",
  "issuesScrapedCount": 3,
  "issues": [
    { "number": 36743, "title": "[compiler] ...", "state": "open", "isPullRequest": true, "author": "mvitousek", "labels": ["CLA Signed"] }
  ],
  "scrapedAt": "2026-06-11T10:00:00.000Z"
}
```

### User

```json
{
  "entityType": "user",
  "login": "torvalds",
  "name": "Linus Torvalds",
  "type": "User",
  "company": "Linux Foundation",
  "followers": 306470,
  "publicRepos": 12,
  "createdAt": "2011-09-03T15:26:22Z",
  "reposScrapedCount": 3,
  "repos": [{ "fullName": "torvalds/linux", "stars": 190000, "language": "C" }],
  "scrapedAt": "2026-06-11T10:00:00.000Z"
}
```

Repositories land in the default dataset (**Repositories** view). User profiles are saved to a separate **users** dataset so each output stays one clean shape.

## How to Scrape GitHub (Step by Step)

1. Click **Try for free** / **Run**.
2. Add repositories (`owner/repo`), usernames/orgs, or repository search queries.
3. (Optional) Paste a GitHub token to lift the rate limit to 5,000 requests/hour, and enable `includeIssues` / `includeUserRepos` for nested data.
4. Set `maxResults` (start small to test).
5. Run, then export results as JSON, CSV, Excel, or HTML, or pull them via the Apify API.

## Pricing

This Actor uses **pay-per-result** pricing:

| Event | Price |
|-------|-------|
| Per repository scraped | **$0.002** ($2 / 1,000 repos) |
| Per user scraped | **$0.002** ($2 / 1,000 users) |

Nested issues and user-repos are included free. You are only charged for entities actually returned. Apify platform usage is billed separately by Apify.

## Use cases

- **Developer lead generation** - find and profile users/orgs by activity
- **Open-source research** - analyze stars, languages, topics, and licenses at scale
- **Tech-trend analysis** - track popular repos and ecosystems
- **Recruiting** - surface contributors and maintainers in a domain

## Tips

- Add a **GitHub token** (github.com/settings/tokens, no scopes needed for public data) to lift the limit to 5,000 requests/hour.
- Use rich search queries: `topic:machine-learning language:python stars:>500`.
- Turn on `includeIssues` / `includeUserRepos` for deeper, nested datasets.

## License

Apache-2.0
