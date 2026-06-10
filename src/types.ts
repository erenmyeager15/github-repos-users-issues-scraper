export interface ActorInput {
    repos?: string[];
    users?: string[];
    searchQueries?: string[];
    includeIssues?: boolean;
    maxIssuesPerRepo?: number;
    includeUserRepos?: boolean;
    maxReposPerUser?: number;
    maxResults?: number;
    githubToken?: string;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        proxyUrls?: string[];
    };
}

export interface IssueRecord {
    number: number | null;
    title: string | null;
    state: string | null;
    isPullRequest: boolean;
    author: string | null;
    commentsCount: number | null;
    labels: string[];
    createdAt: string | null;
    updatedAt: string | null;
    closedAt: string | null;
    url: string | null;
}

export interface RepoRecord {
    entityType: 'repo';
    repoId: number | null;
    fullName: string | null;
    name: string | null;
    owner: string | null;
    description: string | null;
    url: string | null;
    homepage: string | null;
    language: string | null;
    stars: number | null;
    forks: number | null;
    watchers: number | null;
    openIssues: number | null;
    license: string | null;
    topics: string[];
    isFork: boolean;
    isArchived: boolean;
    defaultBranch: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    pushedAt: string | null;
    issuesScrapedCount: number;
    issues: IssueRecord[];
    scrapedAt: string;
}

export interface UserRepoSummary {
    fullName: string | null;
    description: string | null;
    language: string | null;
    stars: number | null;
    forks: number | null;
    url: string | null;
}

export interface UserRecord {
    entityType: 'user';
    userId: number | null;
    login: string | null;
    name: string | null;
    type: string | null;
    company: string | null;
    blog: string | null;
    location: string | null;
    email: string | null;
    bio: string | null;
    followers: number | null;
    following: number | null;
    publicRepos: number | null;
    publicGists: number | null;
    url: string | null;
    avatarUrl: string | null;
    createdAt: string | null;
    reposScrapedCount: number;
    repos: UserRepoSummary[];
    scrapedAt: string;
}
