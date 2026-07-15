import type { ActorInput } from './types.js';

const OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const REPOSITORY_PATTERN = /^[a-z\d._-]{1,100}$/i;
const MAX_REPOSITORIES = 1_000;
const MAX_USERS = 500;
const MAX_SEARCH_QUERIES = 20;
const MAX_SEARCH_QUERY_LENGTH = 256;

export interface NormalizedActorInput {
    repos: string[];
    users: string[];
    searchQueries: string[];
    includeIssues: boolean;
    maxIssuesPerRepo: number;
    includeUserRepos: boolean;
    maxReposPerUser: number;
    maxResults: number;
    githubToken: string;
    proxyConfiguration: NonNullable<ActorInput['proxyConfiguration']>;
}

export function normalizeInput(input: ActorInput): NormalizedActorInput {
    if (!isObject(input)) throw new Error('Input must be a JSON object.');

    const rawRepos = stringArray(input.repos, 'repos', MAX_REPOSITORIES);
    const rawUsers = stringArray(input.users, 'users', MAX_USERS);
    const rawQueries = stringArray(input.searchQueries, 'searchQueries', MAX_SEARCH_QUERIES);

    const repos = uniqueNormalized(rawRepos, parseRepositoryIdentifier, 'repository');
    const users = uniqueNormalized(rawUsers, parseUserIdentifier, 'user or organization');
    const searchQueries = uniqueSearchQueries(rawQueries);

    if (repos.length === 0 && users.length === 0 && searchQueries.length === 0) {
        throw new Error('Provide at least one repository, user/organization, or repository search query.');
    }

    const githubToken = input.githubToken ?? '';
    if (typeof githubToken !== 'string') throw new Error('githubToken must be a string.');
    if (githubToken.trim().length > 512) throw new Error('githubToken is unexpectedly long.');

    const proxyConfiguration = input.proxyConfiguration ?? { useApifyProxy: false };
    if (!isObject(proxyConfiguration)) throw new Error('proxyConfiguration must be an object.');

    return {
        repos,
        users,
        searchQueries,
        includeIssues: booleanValue(input.includeIssues, false, 'includeIssues'),
        maxIssuesPerRepo: integerValue(input.maxIssuesPerRepo, 20, 0, 100, 'maxIssuesPerRepo'),
        includeUserRepos: booleanValue(input.includeUserRepos, false, 'includeUserRepos'),
        maxReposPerUser: integerValue(input.maxReposPerUser, 20, 0, 100, 'maxReposPerUser'),
        maxResults: integerValue(input.maxResults, 1, 1, 1_000, 'maxResults'),
        githubToken: githubToken.trim(),
        proxyConfiguration,
    };
}

export function parseRepositoryIdentifier(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;

    let parts: string[];
    if (/^https?:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
            parts = url.pathname.split('/').filter(Boolean);
        } catch {
            return null;
        }
    } else {
        parts = value.replace(/^github\.com\//i, '').split('/').filter(Boolean);
    }

    if (parts.length !== 2) return null;
    const owner = decodeComponent(parts[0]);
    const repository = decodeComponent(parts[1]).replace(/\.git$/i, '');
    if (!owner || !repository || !OWNER_PATTERN.test(owner) || !REPOSITORY_PATTERN.test(repository)) return null;
    if (repository === '.' || repository === '..') return null;
    return `${owner}/${repository}`;
}

export function parseUserIdentifier(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;

    let username: string;
    if (/^https?:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length !== 1) return null;
            username = decodeComponent(parts[0]);
        } catch {
            return null;
        }
    } else {
        const normalized = value.replace(/^github\.com\//i, '').replace(/^@/, '').replace(/\/+$/, '');
        if (normalized.includes('/')) return null;
        username = decodeComponent(normalized);
    }

    return OWNER_PATTERN.test(username) ? username : null;
}

function uniqueNormalized(
    values: string[],
    parser: (value: string) => string | null,
    label: string,
): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const invalid: string[] = [];
    for (const value of values) {
        const normalized = parser(value);
        if (!normalized) {
            invalid.push(value);
            continue;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
    }
    if (invalid.length > 0) {
        const examples = invalid.slice(0, 3).map((value) => JSON.stringify(value)).join(', ');
        throw new Error(`Invalid ${label} input${invalid.length === 1 ? '' : 's'}: ${examples}.`);
    }
    return result;
}

function uniqueSearchQueries(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
        const query = raw.replace(/\s+/g, ' ').trim();
        if (!query) throw new Error('searchQueries cannot contain an empty query.');
        if (query.length > MAX_SEARCH_QUERY_LENGTH) {
            throw new Error(`Each search query must be at most ${MAX_SEARCH_QUERY_LENGTH} characters.`);
        }
        const key = query.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(query);
    }
    return result;
}

function stringArray(value: unknown, field: string, maximum: number): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
    if (value.length > maximum) throw new Error(`${field} supports at most ${maximum} entries per run.`);
    if (!value.every((item) => typeof item === 'string')) throw new Error(`${field} must contain only strings.`);
    return value as string[];
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number, field: string): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || (resolved as number) < minimum || (resolved as number) > maximum) {
        throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
    }
    return resolved as number;
}

function booleanValue(value: unknown, fallback: boolean, field: string): boolean {
    const resolved = value ?? fallback;
    if (typeof resolved !== 'boolean') throw new Error(`${field} must be true or false.`);
    return resolved;
}

function decodeComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
