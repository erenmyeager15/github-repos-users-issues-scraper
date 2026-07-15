import { GitHubApiError, type GitHubApi } from './github-client.js';
import { parseRepositoryIdentifier, type NormalizedActorInput } from './input.js';
import { mapIssue, mapRepo, mapUser, mapUserRepo, validateGitHubRecord } from './routes.js';
import type { ChargeResult, GitHubRecord, GitHubRunStatus } from './types.js';

const CHARGE_EVENT_NAME = 'repo-scraped';
const SAFE_RUNTIME_LIMIT_MS = 50 * 60 * 1_000;

interface Logger {
    info(message: string, data?: Record<string, unknown>): void;
    warning(message: string, data?: Record<string, unknown>): void;
}

export interface ScrapeDependencies {
    client: GitHubApi;
    pushData: (record: GitHubRecord, eventName: string) => Promise<ChargeResult>;
    updateStatus: (status: GitHubRunStatus) => Promise<void>;
    log: Logger;
    now?: () => number;
    isoNow?: () => string;
    runtimeLimitMs?: number;
}

export interface GitHubScrapeResult {
    status: GitHubRunStatus;
    spendingLimitReached: boolean;
    runtimeLimitReached: boolean;
}

interface SearchResponse {
    items: Array<{ full_name: string }>;
    incomplete: boolean;
}

export async function scrapeGitHub(
    input: NormalizedActorInput,
    dependencies: ScrapeDependencies,
): Promise<GitHubScrapeResult> {
    const now = dependencies.now ?? Date.now;
    const isoNow = dependencies.isoNow ?? (() => new Date().toISOString());
    const runtimeLimitMs = dependencies.runtimeLimitMs ?? SAFE_RUNTIME_LIMIT_MS;
    const startedAt = now();
    const counters = {
        recordsSaved: 0,
        repositoriesSaved: 0,
        usersSaved: 0,
        repositoryTargets: 0,
        userTargets: input.users.length,
        searchQueriesCompleted: 0,
        searchQueriesSkipped: 0,
        incompleteSearchResponses: 0,
        duplicateTargetsSkipped: 0,
        notFound: 0,
        nonPublicSkipped: 0,
        nestedResourcesUnavailable: 0,
    };
    let spendingLimitReached = false;
    let runtimeLimitReached = false;

    const buildStatus = (
        status: GitHubRunStatus['status'],
        failureMessage?: string,
    ): GitHubRunStatus => ({
        status,
        source: 'github_rest_api',
        ...counters,
        searchQueriesRequested: input.searchQueries.length,
        durationMs: Math.max(now() - startedAt, 0),
        ...(failureMessage ? { failureMessage } : {}),
    });
    const publishStatus = async (status: GitHubRunStatus['status'], failureMessage?: string) => {
        const document = buildStatus(status, failureMessage);
        await dependencies.updateStatus(document);
        return document;
    };
    const reachedRuntimeLimit = () => {
        if (now() - startedAt < runtimeLimitMs) return false;
        runtimeLimitReached = true;
        return true;
    };

    await dependencies.updateStatus(buildStatus('running'));

    try {
        const repoTargets: string[] = [];
        const repoKeys = new Set<string>();
        const addRepoTarget = (fullName: string): boolean => {
            const key = fullName.toLowerCase();
            if (repoKeys.has(key)) {
                counters.duplicateTargetsSkipped += 1;
                return false;
            }
            repoKeys.add(key);
            repoTargets.push(fullName);
            return true;
        };

        for (const fullName of input.repos.slice(0, input.maxResults)) addRepoTarget(fullName);
        if (input.repos.length > input.maxResults) {
            dependencies.log.warning('Explicit repository inputs exceed maxResults; remaining repositories were not scheduled.', {
                provided: input.repos.length,
                maxResults: input.maxResults,
            });
        }

        searchLoop:
        for (const [queryIndex, query] of input.searchQueries.entries()) {
            if (repoTargets.length >= input.maxResults) {
                counters.searchQueriesSkipped = input.searchQueries.length - queryIndex;
                break;
            }
            const pageSize = Math.min(100, input.maxResults - repoTargets.length);
            let foundForQuery = 0;
            let queryWasIncomplete = false;

            for (let page = 1; page <= 10 && repoTargets.length < input.maxResults; page += 1) {
                if (reachedRuntimeLimit()) {
                    counters.searchQueriesSkipped = input.searchQueries.length - queryIndex;
                    break searchLoop;
                }
                const result = await dependencies.client.get(
                    `/search/repositories?q=${encodeURIComponent(query)}&per_page=${pageSize}&page=${page}`,
                );
                if (result.outcome === 'not_found') {
                    throw new Error('GitHub repository search endpoint unexpectedly returned 404.');
                }
                const parsed = parseSearchResponse(result.data);
                queryWasIncomplete ||= parsed.incomplete;
                for (const item of parsed.items) {
                    const normalized = parseRepositoryIdentifier(item.full_name);
                    if (!normalized) throw new Error('GitHub search returned an invalid repository identifier.');
                    if (addRepoTarget(normalized)) foundForQuery += 1;
                    if (repoTargets.length >= input.maxResults) break;
                }
                if (parsed.items.length < pageSize) break;
            }

            counters.searchQueriesCompleted += 1;
            if (queryWasIncomplete) counters.incompleteSearchResponses += 1;
            dependencies.log.info(`Repository search completed for "${query}".`, {
                uniqueRepositoriesAdded: foundForQuery,
                incompleteResults: queryWasIncomplete,
            });
        }

        counters.repositoryTargets = repoTargets.length;
        if (runtimeLimitReached) {
            const status = await publishStatus('stopped_runtime_limit');
            return { status, spendingLimitReached, runtimeLimitReached };
        }
        await dependencies.updateStatus(buildStatus('running'));

        for (const fullName of repoTargets) {
            if (reachedRuntimeLimit()) break;
            const result = await dependencies.client.get(`/repos/${encodePath(fullName)}`);
            if (result.outcome === 'not_found') {
                counters.notFound += 1;
                dependencies.log.warning(`Repository not found: ${fullName}`);
                continue;
            }

            const repository = requiredObject(result.data, `repository ${fullName}`);
            if (repository.private === true || (typeof repository.visibility === 'string' && repository.visibility !== 'public')) {
                counters.nonPublicSkipped += 1;
                dependencies.log.warning(`Skipped non-public repository: ${fullName}`);
                continue;
            }
            let issues: unknown[] = [];
            if (input.includeIssues && input.maxIssuesPerRepo > 0) {
                try {
                    const issueResult = await dependencies.client.get(
                        `/repos/${encodePath(fullName)}/issues?state=all&per_page=${input.maxIssuesPerRepo}&sort=created&direction=desc`,
                    );
                    if (issueResult.outcome === 'not_found') {
                        counters.nestedResourcesUnavailable += 1;
                    } else {
                        issues = requiredObjectArray(issueResult.data, `issues for ${fullName}`).slice(0, input.maxIssuesPerRepo);
                    }
                } catch (error) {
                    if (error instanceof GitHubApiError && error.status === 410) {
                        counters.nestedResourcesUnavailable += 1;
                        dependencies.log.warning(`Issues are disabled or unavailable for ${fullName}.`);
                    } else {
                        throw error;
                    }
                }
            }

            const record = mapRepo(repository, issues.map(mapIssue), isoNow());
            assertValidRecord(record, fullName);
            const chargeResult = await dependencies.pushData(record, CHARGE_EVENT_NAME);
            if (wasPushedRecordSaved(chargeResult)) {
                counters.recordsSaved += 1;
                counters.repositoriesSaved += 1;
            }
            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                break;
            }
            dependencies.log.info(`Saved repository ${fullName}.`, {
                stars: record.stars,
                nestedIssues: record.issuesScrapedCount,
            });
        }

        if (!spendingLimitReached && !runtimeLimitReached) {
            for (const username of input.users) {
                if (reachedRuntimeLimit()) break;
                const result = await dependencies.client.get(`/users/${encodeURIComponent(username)}`);
                if (result.outcome === 'not_found') {
                    counters.notFound += 1;
                    dependencies.log.warning(`User or organization not found: ${username}`);
                    continue;
                }

                const user = requiredObject(result.data, `user or organization ${username}`);
                let repositories: unknown[] = [];
                if (input.includeUserRepos && input.maxReposPerUser > 0) {
                    const repoResult = await dependencies.client.get(
                        `/users/${encodeURIComponent(username)}/repos?per_page=${input.maxReposPerUser}&sort=updated`,
                    );
                    if (repoResult.outcome === 'not_found') {
                        counters.nestedResourcesUnavailable += 1;
                    } else {
                        const repositoryCandidates = requiredObjectArray(repoResult.data, `repositories for ${username}`);
                        const publicRepositories = repositoryCandidates.filter((repository) => repository.private !== true
                            && (typeof repository.visibility !== 'string' || repository.visibility === 'public'));
                        counters.nonPublicSkipped += repositoryCandidates.length - publicRepositories.length;
                        repositories = publicRepositories.slice(0, input.maxReposPerUser);
                    }
                }

                const record = mapUser(user, repositories.map(mapUserRepo), isoNow());
                assertValidRecord(record, username);
                const chargeResult = await dependencies.pushData(record, CHARGE_EVENT_NAME);
                if (wasPushedRecordSaved(chargeResult)) {
                    counters.recordsSaved += 1;
                    counters.usersSaved += 1;
                }
                if (chargeResult.eventChargeLimitReached) {
                    spendingLimitReached = true;
                    break;
                }
                dependencies.log.info(`Saved user or organization ${username}.`, {
                    followers: record.followers,
                    nestedRepositories: record.reposScrapedCount,
                });
            }
        }

        const outcome: GitHubRunStatus['status'] = spendingLimitReached
            ? 'stopped_spending_limit'
            : runtimeLimitReached
                ? 'stopped_runtime_limit'
                : counters.recordsSaved === 0
                    ? 'empty'
                    : 'succeeded';
        const status = await publishStatus(outcome);
        return { status, spendingLimitReached, runtimeLimitReached };
    } catch (error) {
        const message = safeErrorMessage(error);
        await publishStatus('failed', message);
        throw error;
    }
}

export function parseSearchResponse(value: unknown): SearchResponse {
    const root = requiredObject(value, 'repository search response');
    if (!Array.isArray(root.items) || !root.items.every((item) => {
        const object = asObject(item);
        return object !== null && typeof object.full_name === 'string' && object.full_name.trim().length > 0;
    })) {
        throw new Error('GitHub repository search response did not contain a valid items array.');
    }
    return {
        items: root.items.map((item) => ({ full_name: (item as Record<string, unknown>).full_name as string })),
        incomplete: root.incomplete_results === true,
    };
}

export function wasPushedRecordSaved(result: ChargeResult): boolean {
    return result.chargedCount > 0 || result.eventChargeLimitReached !== true;
}

function assertValidRecord(record: GitHubRecord, target: string): void {
    const errors = validateGitHubRecord(record);
    if (errors.length > 0) {
        throw new Error(`GitHub returned an invalid ${record.entityType} record for ${target}: ${errors.join(' ')}`);
    }
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
    const object = asObject(value);
    if (!object) throw new Error(`GitHub returned a malformed ${label} response.`);
    return object;
}

function requiredObjectArray(value: unknown, label: string): Array<Record<string, unknown>> {
    if (!Array.isArray(value) || !value.every((item) => asObject(item) !== null)) {
        throw new Error(`GitHub returned a malformed ${label} response.`);
    }
    return value as Array<Record<string, unknown>>;
}

function encodePath(fullName: string): string {
    return fullName.split('/').map(encodeURIComponent).join('/');
}

function safeErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function asObject(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}
