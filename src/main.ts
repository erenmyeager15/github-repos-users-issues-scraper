import { Actor, log } from 'apify';
import { ProxyAgent } from 'undici';
import type { ActorInput } from './types.js';
import { mapIssue, mapRepo, mapUser, mapUserRepo } from './routes.js';

await Actor.init();

const input = ((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput;
const {
    repos = [],
    users = [],
    searchQueries = [],
    includeIssues = false,
    maxIssuesPerRepo = 20,
    includeUserRepos = false,
    maxReposPerUser = 20,
    maxResults = 50,
    githubToken = '',
    proxyConfiguration: proxyInput,
} = input;

function parseRepo(raw: string): string | null {
    const s = raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
    const m = s.match(/^([^/\s]+)\/([^/\s]+)/);
    return m ? `${m[1]}/${m[2]}` : null;
}
function parseUser(raw: string): string | null {
    const s = raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^@/, '').replace(/\/+$/, '');
    const m = s.match(/^([^/\s]+)/);
    return m ? m[1] : null;
}

const repoList = [...new Set(repos.map(parseRepo).filter((x): x is string => !!x))];
const userList = [...new Set(users.map(parseUser).filter((x): x is string => !!x))];
const queries = searchQueries.map((q) => q.trim()).filter(Boolean);

if (repoList.length === 0 && userList.length === 0 && queries.length === 0) {
    log.error('No input. Provide repos ("owner/repo"), users ("username"), or searchQueries.');
    await Actor.exit();
}

const proxyConfiguration = (proxyInput?.useApifyProxy || proxyInput?.proxyUrls?.length)
    ? await Actor.createProxyConfiguration(proxyInput)
    : undefined;

if (!githubToken) {
    log.warning('No GitHub token provided - unauthenticated requests are limited to 60/hour per IP. Add a token (or proxies) for larger runs.');
}

const baseHeaders: Record<string, string> = {
    'User-Agent': 'apify-github-scraper',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
};
if (githubToken) baseHeaders.Authorization = `Bearer ${githubToken.trim()}`;

async function ghFetch<T = any>(path: string): Promise<T | null> {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    for (let attempt = 0; attempt < 4; attempt++) {
        let dispatcher: ProxyAgent | undefined;
        if (proxyConfiguration) {
            const proxyUrl = await proxyConfiguration.newUrl();
            if (proxyUrl) dispatcher = new ProxyAgent(proxyUrl);
        }
        try {
            const res = await fetch(url, { headers: baseHeaders, ...(dispatcher ? { dispatcher } : {}) } as any);
            if (res.status === 404) {
                log.warning(`Not found: ${url}`);
                return null;
            }
            if (res.status === 403 || res.status === 429) {
                const remaining = res.headers.get('x-ratelimit-remaining');
                log.warning(`Rate limited (${res.status}, remaining ${remaining}) on ${url} - attempt ${attempt + 1}`);
                // With proxy, a fresh IP next loop resets the limit; otherwise back off briefly.
                if (!proxyConfiguration) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
                continue;
            }
            if (!res.ok) {
                log.warning(`HTTP ${res.status} on ${url}`);
                return null;
            }
            return (await res.json()) as T;
        } catch (e) {
            log.warning(`Request error on ${url}: ${(e as Error).message}`);
        }
    }
    return null;
}

let scraped = 0;
const repoTargets = [...repoList];

// Resolve search queries into repo full names (search returns full repo objects).
for (const q of queries) {
    if (scraped >= 0 && repoTargets.length >= maxResults) break;
    const data = await ghFetch<any>(`/search/repositories?q=${encodeURIComponent(q)}&per_page=${Math.min(maxResults, 100)}`);
    const items: any[] = data?.items ?? [];
    for (const it of items) if (it.full_name) repoTargets.push(it.full_name);
    log.info(`Search "${q}" -> ${items.length} repos`);
}

const uniqueRepos = [...new Set(repoTargets)].slice(0, maxResults > 0 ? maxResults : undefined);

async function processRepo(fullName: string): Promise<void> {
    const repo = await ghFetch<any>(`/repos/${fullName}`);
    if (!repo || !repo.id) return;
    let issues: any[] = [];
    if (includeIssues && maxIssuesPerRepo > 0) {
        const data = await ghFetch<any[]>(`/repos/${fullName}/issues?state=all&per_page=${Math.min(maxIssuesPerRepo, 100)}&sort=created&direction=desc`);
        if (Array.isArray(data)) issues = data.slice(0, maxIssuesPerRepo);
    }
    await Actor.pushData(mapRepo(repo, issues.map(mapIssue)));
    await Actor.charge({ eventName: 'repo-scraped' }).catch(() => null);
    scraped++;
    log.info(`repo ${fullName}: ${repo.stargazers_count} stars${issues.length ? ` + ${issues.length} issues` : ''}`);
}

async function processUser(username: string): Promise<void> {
    const user = await ghFetch<any>(`/users/${username}`);
    if (!user || !user.id) return;
    let userRepos: any[] = [];
    if (includeUserRepos && maxReposPerUser > 0) {
        const data = await ghFetch<any[]>(`/users/${username}/repos?per_page=${Math.min(maxReposPerUser, 100)}&sort=updated`);
        if (Array.isArray(data)) userRepos = data.slice(0, maxReposPerUser);
    }
    // Users go to a dedicated dataset so the default (repos) dataset stays one clean shape.
    const usersDataset = await Actor.openDataset('users').catch(() => null);
    const record = mapUser(user, userRepos.map(mapUserRepo));
    if (usersDataset) await usersDataset.pushData(record);
    else await Actor.pushData(record);
    await Actor.charge({ eventName: 'user-scraped' }).catch(() => null);
    scraped++;
    log.info(`user ${username}: ${user.followers} followers${userRepos.length ? ` + ${userRepos.length} repos` : ''}`);
}

// Concurrency-limited execution.
const tasks: Array<() => Promise<void>> = [
    ...uniqueRepos.map((r) => () => processRepo(r)),
    ...userList.map((u) => () => processUser(u)),
];
const CONCURRENCY = proxyConfiguration ? 5 : 2;
let idx = 0;
async function worker(): Promise<void> {
    while (idx < tasks.length) {
        const task = tasks[idx++];
        await task();
    }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()));

log.info(`GitHub scrape finished. ${scraped} entities scraped.`);
await Actor.exit();
