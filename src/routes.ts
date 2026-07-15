import type { GitHubRecord, IssueRecord, RepoRecord, UserRecord, UserRepoSummary } from './types.js';

export function mapRepo(value: unknown, issues: IssueRecord[], scrapedAt = new Date().toISOString()): RepoRecord {
    const repository = asObject(value);
    const owner = asObject(repository?.owner);
    const license = asObject(repository?.license);
    return {
        entityType: 'repo',
        repoId: finiteNumber(repository?.id),
        fullName: cleanText(repository?.full_name, 141),
        name: cleanText(repository?.name, 100),
        owner: cleanText(owner?.login, 39),
        description: cleanText(repository?.description, 2_000),
        url: safeHttpUrl(repository?.html_url, 'github.com'),
        homepage: safeHttpUrl(repository?.homepage),
        language: cleanText(repository?.language, 100),
        stars: finiteNumber(repository?.stargazers_count),
        forks: finiteNumber(repository?.forks_count),
        watchers: finiteNumber(repository?.subscribers_count ?? repository?.watchers_count),
        openIssues: finiteNumber(repository?.open_issues_count),
        license: cleanText(license?.spdx_id ?? license?.key, 100),
        topics: uniqueCleanStrings(repository?.topics, 100, 100),
        isFork: repository?.fork === true,
        isArchived: repository?.archived === true,
        defaultBranch: cleanText(repository?.default_branch, 255),
        createdAt: isoTimestamp(repository?.created_at),
        updatedAt: isoTimestamp(repository?.updated_at),
        pushedAt: isoTimestamp(repository?.pushed_at),
        issuesScrapedCount: issues.length,
        issues,
        scrapedAt,
    };
}

export function mapIssue(value: unknown): IssueRecord {
    const issue = asObject(value);
    const user = asObject(issue?.user);
    return {
        number: finiteNumber(issue?.number),
        title: cleanText(issue?.title, 1_000),
        state: cleanText(issue?.state, 30),
        isPullRequest: asObject(issue?.pull_request) !== null,
        author: cleanText(user?.login, 39),
        commentsCount: finiteNumber(issue?.comments),
        labels: normalizeLabels(issue?.labels),
        createdAt: isoTimestamp(issue?.created_at),
        updatedAt: isoTimestamp(issue?.updated_at),
        closedAt: isoTimestamp(issue?.closed_at),
        url: safeHttpUrl(issue?.html_url, 'github.com'),
    };
}

export function mapUserRepo(value: unknown): UserRepoSummary {
    const repository = asObject(value);
    return {
        fullName: cleanText(repository?.full_name, 141),
        description: cleanText(repository?.description, 2_000),
        language: cleanText(repository?.language, 100),
        stars: finiteNumber(repository?.stargazers_count),
        forks: finiteNumber(repository?.forks_count),
        url: safeHttpUrl(repository?.html_url, 'github.com'),
    };
}

export function mapUser(value: unknown, repos: UserRepoSummary[], scrapedAt = new Date().toISOString()): UserRecord {
    const user = asObject(value);
    return {
        entityType: 'user',
        userId: finiteNumber(user?.id),
        login: cleanText(user?.login, 39),
        name: cleanText(user?.name, 255),
        type: cleanText(user?.type, 30),
        company: cleanText(user?.company, 255),
        blog: safeHttpUrl(user?.blog),
        location: cleanText(user?.location, 255),
        bio: cleanText(user?.bio, 1_000),
        followers: finiteNumber(user?.followers),
        following: finiteNumber(user?.following),
        publicRepos: finiteNumber(user?.public_repos),
        publicGists: finiteNumber(user?.public_gists),
        url: safeHttpUrl(user?.html_url, 'github.com'),
        avatarUrl: safeHttpUrl(user?.avatar_url),
        createdAt: isoTimestamp(user?.created_at),
        updatedAt: isoTimestamp(user?.updated_at),
        reposScrapedCount: repos.length,
        repos,
        scrapedAt,
    };
}

export function validateGitHubRecord(record: GitHubRecord): string[] {
    const errors: string[] = [];
    if (!positiveInteger(record.entityType === 'repo' ? record.repoId : record.userId)) {
        errors.push(`${record.entityType === 'repo' ? 'repoId' : 'userId'} must be a positive integer.`);
    }
    if (!isTimestamp(record.scrapedAt)) errors.push('scrapedAt must be a valid ISO timestamp.');

    if (record.entityType === 'repo') {
        if (!record.fullName || !/^[^/\s]+\/[^/\s]+$/.test(record.fullName)) errors.push('fullName is invalid.');
        if (!record.name) errors.push('name is required.');
        if (!record.owner) errors.push('owner is required.');
        if (!isGitHubUrl(record.url, 2)) errors.push('url must be a GitHub repository URL.');
        if (!isTimestampOrNull(record.createdAt) || record.createdAt === null) errors.push('createdAt must be a valid timestamp.');
        if (!isTimestampOrNull(record.updatedAt) || record.updatedAt === null) errors.push('updatedAt must be a valid timestamp.');
        if (record.issuesScrapedCount !== record.issues.length) errors.push('issuesScrapedCount does not match issues.');
        for (const field of ['stars', 'forks', 'watchers', 'openIssues'] as const) {
            if (!nonNegativeOrNull(record[field])) errors.push(`${field} must be a non-negative number or null.`);
        }
        for (const issue of record.issues) {
            if (!positiveInteger(issue.number)) errors.push('Nested issue number must be a positive integer.');
            if (!issue.title) errors.push('Nested issue title is required.');
            if (!issue.state) errors.push('Nested issue state is required.');
            if (!isGitHubUrl(issue.url, 4)) errors.push('Nested issue URL must be a GitHub issue or pull-request URL.');
            if (!nonNegativeOrNull(issue.commentsCount)) errors.push('Nested issue commentsCount is invalid.');
        }
    } else {
        if (!record.login || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(record.login)) errors.push('login is invalid.');
        if (!isGitHubUrl(record.url, 1)) errors.push('url must be a GitHub profile URL.');
        if (!isTimestampOrNull(record.createdAt) || record.createdAt === null) errors.push('createdAt must be a valid timestamp.');
        if (!isTimestampOrNull(record.updatedAt) || record.updatedAt === null) errors.push('updatedAt must be a valid timestamp.');
        if (record.reposScrapedCount !== record.repos.length) errors.push('reposScrapedCount does not match repos.');
        for (const field of ['followers', 'following', 'publicRepos', 'publicGists'] as const) {
            if (!nonNegativeOrNull(record[field])) errors.push(`${field} must be a non-negative number or null.`);
        }
        for (const repository of record.repos) {
            if (!repository.fullName || !/^[^/\s]+\/[^/\s]+$/.test(repository.fullName)) errors.push('Nested repository fullName is invalid.');
            if (!isGitHubUrl(repository.url, 2)) errors.push('Nested repository URL must be a GitHub repository URL.');
            if (!nonNegativeOrNull(repository.stars) || !nonNegativeOrNull(repository.forks)) {
                errors.push('Nested repository counts must be non-negative numbers or null.');
            }
        }
    }
    return errors;
}

function normalizeLabels(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const labels = value.map((item) => {
        if (typeof item === 'string') return cleanText(item, 100);
        return cleanText(asObject(item)?.name, 100);
    });
    return uniqueCleanStrings(labels, 100, 100);
}

function uniqueCleanStrings(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value)) return [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const text = cleanText(item, maxLength);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= maxItems) break;
    }
    return result;
}

function cleanText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const text = value.replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, maxLength) : null;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeHttpUrl(value: unknown, requiredHost?: string): string | null {
    const text = cleanText(value, 2_000);
    if (!text) return null;
    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        if (requiredHost && ![requiredHost, `www.${requiredHost}`].includes(url.hostname.toLowerCase())) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function isGitHubUrl(value: string | null, expectedSegments: number): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return ['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())
            && url.pathname.split('/').filter(Boolean).length === expectedSegments;
    } catch {
        return false;
    }
}

function positiveInteger(value: number | null): boolean {
    return value !== null && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeOrNull(value: number | null): boolean {
    return value === null || (Number.isFinite(value) && value >= 0);
}

function isTimestamp(value: string): boolean {
    return Number.isFinite(Date.parse(value));
}

function isTimestampOrNull(value: string | null): boolean {
    return value === null || isTimestamp(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}
