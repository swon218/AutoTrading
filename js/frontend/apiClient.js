import { getAccessToken } from './supabaseClient.js';

export const KIWOOM_CREDENTIAL_GUIDE = '회원정보수정에서 Kiwoom API 앱키와 시크릿키를 추가 후 이용해주세요.';

export async function getClientSessionMode() {
    const accessToken = await getAccessToken();
    return {
        accessToken,
        isGuest: !accessToken,
    };
}

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
