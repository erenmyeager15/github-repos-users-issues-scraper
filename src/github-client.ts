import { ProxyAgent } from 'undici';

const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);
const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;

export type GitHubResult<T> =
    | { outcome: 'ok'; data: T }
    | { outcome: 'not_found' };

export interface GitHubApi {
    get(path: string): Promise<GitHubResult<unknown>>;
}

export type GitHubErrorKind =
    | 'authentication'
    | 'forbidden'
    | 'rate_limit'
    | 'invalid_request'
    | 'upstream'
    | 'timeout'
    | 'network'
    | 'invalid_response';

export class GitHubApiError extends Error {
    constructor(
        message: string,
        public readonly status: number | null,
        public readonly kind: GitHubErrorKind,
    ) {
        super(message);
        this.name = 'GitHubApiError';
    }
}

export interface GitHubClientOptions {
    token?: string;
    proxyUrlProvider?: () => Promise<string | null>;
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
    maxAttempts?: number;
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubApi {
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now ?? Date.now;
    const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, 60_000, 'timeoutMs');
    const maxAttempts = boundedInteger(options.maxAttempts ?? DEFAULT_ATTEMPTS, 1, 5, 'maxAttempts');
    const token = options.token?.trim() ?? '';

    const headers: Record<string, string> = {
        'User-Agent': 'apify-github-scraper',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    return {
        async get(path: string): Promise<GitHubResult<unknown>> {
            if (!path.startsWith('/')) throw new Error('GitHub API paths must start with /.');
            const url = `https://api.github.com${path}`;
            let lastError: GitHubApiError | null = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                let dispatcher: ProxyAgent | undefined;
                try {
                    const proxyUrl = await options.proxyUrlProvider?.();
                    if (proxyUrl) dispatcher = new ProxyAgent(proxyUrl);

                    const response = await fetchImpl(url, {
                        headers,
                        redirect: 'follow',
                        signal: AbortSignal.timeout(timeoutMs),
                        ...(dispatcher ? { dispatcher } : {}),
                    } as RequestInit);
                    const body = await response.text();

                    if (response.status === 404) return { outcome: 'not_found' };
                    if (response.ok) {
                        if (!body.trim()) {
                            throw new GitHubApiError(`GitHub returned an empty response for ${path}.`, response.status, 'invalid_response');
                        }
                        try {
                            return { outcome: 'ok', data: JSON.parse(body) as unknown };
                        } catch {
                            throw new GitHubApiError(`GitHub returned invalid JSON for ${path}.`, response.status, 'invalid_response');
                        }
                    }

                    const detail = responseMessage(body);
                    if (response.status === 401) {
                        throw new GitHubApiError('GitHub rejected the token. Remove it or provide a valid token for public API access.', 401, 'authentication');
                    }

                    const rateLimited = response.status === 429 || isRateLimit403(response, detail);
                    if (rateLimited) {
                        const waitMs = rateLimitWaitMilliseconds(response.headers, now());
                        const reset = resetDescription(response.headers);
                        const error = new GitHubApiError(
                            `GitHub API rate limit reached${reset ? `; retry after ${reset}` : ''}. Add a GitHub token or run again later.`,
                            response.status,
                            'rate_limit',
                        );
                        if (attempt === maxAttempts || waitMs === null || waitMs > MAX_RATE_LIMIT_WAIT_MS) throw error;
                        lastError = error;
                        await sleep(waitMs);
                        continue;
                    }

                    if (response.status === 403) {
                        throw new GitHubApiError(`GitHub denied access to ${path}${detail ? `: ${detail}` : ''}.`, 403, 'forbidden');
                    }
                    if (response.status === 422) {
                        throw new GitHubApiError(`GitHub rejected the request for ${path}${detail ? `: ${detail}` : ''}.`, 422, 'invalid_request');
                    }

                    const retryable = RETRYABLE_STATUSES.has(response.status) || response.status >= 500;
                    const error = new GitHubApiError(
                        `GitHub API request failed (${response.status}) for ${path}${detail ? `: ${detail}` : ''}.`,
                        response.status,
                        response.status >= 500 ? 'upstream' : 'invalid_request',
                    );
                    if (!retryable || attempt === maxAttempts) throw error;
                    lastError = error;
                    await sleep(transientRetryDelay(response.headers, attempt, now()));
                } catch (error) {
                    if (error instanceof GitHubApiError) throw error;
                    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
                    const normalized = new GitHubApiError(
                        `${timedOut ? 'GitHub request timed out' : 'GitHub network request failed'} for ${path}: ${safeErrorMessage(error)}`,
                        null,
                        timedOut ? 'timeout' : 'network',
                    );
                    if (attempt === maxAttempts) throw normalized;
                    lastError = normalized;
                    await sleep(Math.min(500 * (2 ** (attempt - 1)), 4_000));
                } finally {
                    if (dispatcher) {
                        try {
                            await dispatcher.close();
                        } catch {
                            // The request result is more useful than a proxy-agent cleanup error.
                        }
                    }
                }
            }

            throw lastError ?? new GitHubApiError(`GitHub API request failed for ${path}.`, null, 'network');
        },
    };
}

function isRateLimit403(response: Response, detail: string): boolean {
    return response.headers.get('x-ratelimit-remaining') === '0'
        || /(?:secondary |primary )?rate limit|abuse detection/i.test(detail);
}

function rateLimitWaitMilliseconds(headers: Headers, nowMs: number): number | null {
    const retryAfter = parseRetryAfter(headers.get('retry-after'), nowMs);
    if (retryAfter !== null) return retryAfter;
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (!Number.isFinite(reset) || reset <= 0) return null;
    return Math.max((reset * 1_000) - nowMs + 250, 0);
}

function transientRetryDelay(headers: Headers, attempt: number, nowMs: number): number {
    const retryAfter = parseRetryAfter(headers.get('retry-after'), nowMs);
    return retryAfter === null
        ? Math.min(500 * (2 ** (attempt - 1)), 4_000)
        : Math.min(retryAfter, MAX_RATE_LIMIT_WAIT_MS);
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : Math.max(timestamp - nowMs, 0);
}

function resetDescription(headers: Headers): string | null {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) return `${retryAfter} second(s)`;
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (!Number.isFinite(reset) || reset <= 0) return null;
    return new Date(reset * 1_000).toISOString();
}

function responseMessage(body: string): string {
    if (!body.trim()) return '';
    try {
        const parsed = JSON.parse(body) as { message?: unknown };
        return typeof parsed.message === 'string' ? cleanMessage(parsed.message) : '';
    } catch {
        return cleanMessage(body);
    }
}

function cleanMessage(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function safeErrorMessage(error: unknown): string {
    return cleanMessage(error instanceof Error ? error.message : String(error))
        .replace(/(https?:\/\/)[^/@\s]+(?::[^/@\s]*)?@/gi, '$1[redacted]@');
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
    }
    return value;
}
