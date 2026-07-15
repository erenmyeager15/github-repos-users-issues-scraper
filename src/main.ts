import { Actor, log } from 'apify';
import { createGitHubClient } from './github-client.js';
import { normalizeInput } from './input.js';
import { scrapeGitHub } from './scraper.js';
import type { ActorInput, GitHubRunStatus } from './types.js';

await Actor.main(async () => {
    const startedAt = Date.now();
    let input;
    try {
        input = normalizeInput((await Actor.getInput<ActorInput>()) ?? {});
    } catch (error) {
        await Actor.setValue('RUN_STATUS', failedInputStatus(startedAt, error));
        throw error;
    }

    try {
        const proxyConfiguration = input.proxyConfiguration.useApifyProxy || input.proxyConfiguration.proxyUrls?.length
            ? await Actor.createProxyConfiguration(input.proxyConfiguration as never)
            : undefined;

        if (!input.githubToken) {
            log.warning('No GitHub token provided. Public unauthenticated API requests are limited to 60 per hour per source IP.');
        }
        log.info('Starting GitHub REST API scrape.', {
            repositories: input.repos.length,
            usersOrOrganizations: input.users.length,
            searchQueries: input.searchQueries.length,
            includeIssues: input.includeIssues,
            includeUserRepos: input.includeUserRepos,
            maxResults: input.maxResults,
            authenticated: Boolean(input.githubToken),
            proxyEnabled: Boolean(proxyConfiguration),
        });

        const client = createGitHubClient({
            token: input.githubToken,
            proxyUrlProvider: proxyConfiguration
                ? async () => (await proxyConfiguration.newUrl()) ?? null
                : undefined,
        });

        const result = await scrapeGitHub(input, {
            client,
            pushData: async (record, eventName) => Actor.pushData(record, eventName),
            updateStatus: async (status) => Actor.setValue('RUN_STATUS', status),
            log,
        });

        if (result.spendingLimitReached) {
            await Actor.setStatusMessage(`Stopped at the user's spending limit after ${result.status.recordsSaved} GitHub record(s).`);
        } else if (result.runtimeLimitReached) {
            await Actor.setStatusMessage(`Stopped at the safe runtime limit after ${result.status.recordsSaved} GitHub record(s).`);
        } else if (result.status.recordsSaved === 0) {
            await Actor.setStatusMessage('No matching public GitHub repositories, users, or organizations were found.');
        } else {
            await Actor.setStatusMessage(`Finished with ${result.status.recordsSaved} GitHub record(s).`);
        }

        log.info('GitHub scrape finished.', {
            status: result.status.status,
            recordsSaved: result.status.recordsSaved,
            repositoriesSaved: result.status.repositoriesSaved,
            usersSaved: result.status.usersSaved,
            notFound: result.status.notFound,
            duplicateTargetsSkipped: result.status.duplicateTargetsSkipped,
        });
    } catch (error) {
        const current = await Actor.getValue<GitHubRunStatus>('RUN_STATUS');
        if (current?.status !== 'failed') {
            await Actor.setValue('RUN_STATUS', failedRunStatus(startedAt, current, error));
        }
        throw error;
    }
});

function failedInputStatus(startedAt: number, error: unknown): GitHubRunStatus {
    return {
        status: 'failed',
        source: 'github_rest_api',
        recordsSaved: 0,
        repositoriesSaved: 0,
        usersSaved: 0,
        repositoryTargets: 0,
        userTargets: 0,
        searchQueriesRequested: 0,
        searchQueriesCompleted: 0,
        searchQueriesSkipped: 0,
        incompleteSearchResponses: 0,
        duplicateTargetsSkipped: 0,
        notFound: 0,
        nonPublicSkipped: 0,
        nestedResourcesUnavailable: 0,
        durationMs: Date.now() - startedAt,
        failureMessage: sanitizedErrorMessage(error),
    };
}

function failedRunStatus(startedAt: number, current: GitHubRunStatus | null, error: unknown): GitHubRunStatus {
    return {
        ...failedInputStatus(startedAt, error),
        ...(current ?? {}),
        status: 'failed',
        durationMs: Date.now() - startedAt,
        failureMessage: sanitizedErrorMessage(error),
    };
}

function sanitizedErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/(https?:\/\/)[^/@\s]+(?::[^/@\s]*)?@/gi, '$1[redacted]@')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}
