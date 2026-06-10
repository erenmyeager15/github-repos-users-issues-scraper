import type { IssueRecord, RepoRecord, UserRecord, UserRepoSummary } from './types.js';

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function mapRepo(r: any, issues: IssueRecord[]): RepoRecord {
    return {
        entityType: 'repo',
        repoId: n(r.id),
        fullName: r.full_name ?? null,
        name: r.name ?? null,
        owner: r.owner?.login ?? null,
        description: r.description ?? null,
        url: r.html_url ?? null,
        homepage: r.homepage || null,
        language: r.language ?? null,
        stars: n(r.stargazers_count),
        forks: n(r.forks_count),
        watchers: n(r.subscribers_count ?? r.watchers_count),
        openIssues: n(r.open_issues_count),
        license: r.license?.spdx_id ?? r.license?.key ?? null,
        topics: Array.isArray(r.topics) ? r.topics : [],
        isFork: !!r.fork,
        isArchived: !!r.archived,
        defaultBranch: r.default_branch ?? null,
        createdAt: r.created_at ?? null,
        updatedAt: r.updated_at ?? null,
        pushedAt: r.pushed_at ?? null,
        issuesScrapedCount: issues.length,
        issues,
        scrapedAt: new Date().toISOString(),
    };
}

export function mapIssue(i: any): IssueRecord {
    return {
        number: n(i.number),
        title: i.title ?? null,
        state: i.state ?? null,
        isPullRequest: !!i.pull_request,
        author: i.user?.login ?? null,
        commentsCount: n(i.comments),
        labels: Array.isArray(i.labels) ? i.labels.map((l: any) => (typeof l === 'string' ? l : l.name)).filter(Boolean) : [],
        createdAt: i.created_at ?? null,
        updatedAt: i.updated_at ?? null,
        closedAt: i.closed_at ?? null,
        url: i.html_url ?? null,
    };
}

export function mapUserRepo(r: any): UserRepoSummary {
    return {
        fullName: r.full_name ?? null,
        description: r.description ?? null,
        language: r.language ?? null,
        stars: n(r.stargazers_count),
        forks: n(r.forks_count),
        url: r.html_url ?? null,
    };
}

export function mapUser(u: any, repos: UserRepoSummary[]): UserRecord {
    return {
        entityType: 'user',
        userId: n(u.id),
        login: u.login ?? null,
        name: u.name ?? null,
        type: u.type ?? null,
        company: u.company ?? null,
        blog: u.blog || null,
        location: u.location ?? null,
        email: u.email ?? null,
        bio: u.bio ?? null,
        followers: n(u.followers),
        following: n(u.following),
        publicRepos: n(u.public_repos),
        publicGists: n(u.public_gists),
        url: u.html_url ?? null,
        avatarUrl: u.avatar_url ?? null,
        createdAt: u.created_at ?? null,
        reposScrapedCount: repos.length,
        repos,
        scrapedAt: new Date().toISOString(),
    };
}
