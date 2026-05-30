import { getAccessToken } from './supabaseClient.js';

export async function authFetch(input, options = {}) {
    const accessToken = await getAccessToken();
    const headers = new Headers(options.headers || {});
    if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
    }

    return fetch(input, {
        ...options,
        headers,
    });
}

export async function createAuthenticatedEventSource(url) {
    const accessToken = await getAccessToken();
    const sourceUrl = new URL(url, window.location.origin);
    if (accessToken) {
        sourceUrl.searchParams.set('access_token', accessToken);
    }

    return new EventSource(sourceUrl.toString());
}
