import {
    getAccessToken,
    getCurrentUser,
    signInWithEmail,
    signOut,
    signUpWithProfile,
} from './supabaseClient.js';

const TEXT = {
    login: '\uB85C\uADF8\uC778',
    signup: '\uD68C\uC6D0\uAC00\uC785',
    accountEdit: '\uD68C\uC6D0\uC815\uBCF4\uC218\uC815',
    logout: '\uB85C\uADF8\uC544\uC6C3',
    id: '\uC544\uC774\uB514',
    password: '\uD328\uC2A4\uC6CC\uB4DC',
    nickname: '\uB2C9\uB124\uC784',
    emailPlaceholder: '\uC774\uBA54\uC77C\uC744 \uC785\uB825\uD558\uC138\uC694',
    passwordPlaceholder: '\uD328\uC2A4\uC6CC\uB4DC\uB97C \uC785\uB825\uD558\uC138\uC694',
    nicknamePlaceholder: '\uB2C9\uB124\uC784\uC744 \uC785\uB825\uD558\uC138\uC694',
    processing: '\uCC98\uB9AC \uC911...',
    user: '\uC0AC\uC6A9\uC790',
    alreadyAccount: '\uC774\uBBF8 \uACC4\uC815\uC774 \uC788\uB098\uC694?',
    kiwoomAppKey: '\uD0A4\uC6C0 API \uC571\uD0A4',
    kiwoomSecretKey: '\uD0A4\uC6C0 API \uC2DC\uD06C\uB9BF\uD0A4',
    telegramBotKey: '\uD154\uB808\uADF8\uB7A8 \uBD07 API \uD0A4',
    appKeyPlaceholder: '\uC571\uD0A4\uB97C \uC785\uB825\uD558\uC138\uC694',
    secretKeyPlaceholder: '\uC2DC\uD06C\uB9BF\uD0A4\uB97C \uC785\uB825\uD558\uC138\uC694',
    botKeyPlaceholder: '\uBD07 \uD1A0\uD070\uC744 \uC785\uB825\uD558\uC138\uC694',
    save: '\uC800\uC7A5',
};

document.addEventListener('DOMContentLoaded', () => {
    const accountButton = document.getElementById('profileBtn');
    let authModal = document.getElementById('authModal');

    if (!accountButton) return;

    let currentUser = null;

    accountButton.className = 'login-trigger';
    accountButton.type = 'button';
    accountButton.setAttribute('aria-haspopup', 'dialog');
    accountButton.setAttribute('aria-controls', 'authModal');

    const legacyProfileMenu = document.getElementById('profileMenu');
    if (legacyProfileMenu) {
        legacyProfileMenu.classList.add('hidden');
        legacyProfileMenu.setAttribute('aria-hidden', 'true');
    }

    const accountMenu = document.createElement('div');
    accountMenu.id = 'accountMenu';
    accountMenu.className = 'account-menu hidden';
    accountMenu.innerHTML = `
        <button id="accountSettingsButton" type="button">${TEXT.accountEdit}</button>
        <button id="accountLogoutButton" type="button">${TEXT.logout}</button>
    `;
    accountButton.insertAdjacentElement('afterend', accountMenu);

    if (!authModal) {
        authModal = document.createElement('div');
        authModal.id = 'authModal';
        authModal.className = 'auth-modal-overlay hidden';
        authModal.setAttribute('role', 'dialog');
        authModal.setAttribute('aria-modal', 'true');
        authModal.setAttribute('aria-labelledby', 'authModalTitle');
        document.body.append(authModal);
    }

    authModal.innerHTML = getAuthModalMarkup();

    const closeButton = authModal.querySelector('#authModalClose');
    const modalCard = authModal.querySelector('.auth-modal-card');
    const modalTitle = authModal.querySelector('#authModalTitle');
    const modalIcon = authModal.querySelector('.auth-modal-icon i');
    const loginForm = authModal.querySelector('[data-auth-panel="login"]');
    const signupForm = authModal.querySelector('[data-auth-panel="signup"]');
    const credentialsForm = authModal.querySelector('[data-auth-panel="credentials"]');
    const signupLink = authModal.querySelector('#authSignupLink');
    const loginLink = authModal.querySelector('#authLoginLink');
    const authMessage = authModal.querySelector('#authMessage');
    const accountSettingsButton = accountMenu.querySelector('#accountSettingsButton');
    const accountLogoutButton = accountMenu.querySelector('#accountLogoutButton');

    const setAuthMessage = (message = '', type = 'info') => {
        if (!authMessage) return;
        authMessage.textContent = message;
        authMessage.dataset.type = type;
        authMessage.classList.toggle('hidden', !message);
    };

    const setFormPending = (form, isPending) => {
        const submitButton = form?.querySelector('button[type="submit"]');
        if (!submitButton) return;
        submitButton.disabled = isPending;
        submitButton.textContent = isPending ? TEXT.processing : submitButton.dataset.defaultText;
    };

    const resetAuthForms = () => {
        loginForm?.reset();
        signupForm?.reset();
        credentialsForm?.reset();
        setFormPending(loginForm, false);
        setFormPending(signupForm, false);
        setFormPending(credentialsForm, false);
        setAuthMessage();
    };

    const showAuthPanel = (panelName) => {
        const isLogin = panelName === 'login';
        const isSignup = panelName === 'signup';
        const isCredentials = panelName === 'credentials';

        loginForm?.classList.toggle('hidden', !isLogin);
        signupForm?.classList.toggle('hidden', !isSignup);
        credentialsForm?.classList.toggle('hidden', !isCredentials);

        if (modalTitle) {
            modalTitle.textContent = isCredentials ? TEXT.accountEdit : (isSignup ? TEXT.signup : TEXT.login);
        }

        if (modalIcon) {
            modalIcon.className = isCredentials
                ? 'fa-solid fa-key'
                : (isSignup ? 'fa-solid fa-user-plus' : 'fa-solid fa-user-lock');
        }

        setAuthMessage();
    };

    const updateAccountButton = (user) => {
        currentUser = user;
        accountMenu.classList.add('hidden');

        if (!user) {
            accountButton.innerHTML = `
                <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>
                <span>${TEXT.login}</span>
            `;
            accountButton.setAttribute('aria-haspopup', 'dialog');
            return;
        }

        const nickname = user.user_metadata?.nickname;
        const label = nickname || user.email || TEXT.user;
        accountButton.innerHTML = `
            <i class="fa-solid fa-user" aria-hidden="true"></i>
            <span>${escapeHtml(label)}</span>
            <i class="fa-solid fa-chevron-down account-menu-caret" aria-hidden="true"></i>
        `;
        accountButton.setAttribute('aria-haspopup', 'menu');
    };

    const openAuthModal = (panelName = 'login') => {
        resetAuthForms();
        showAuthPanel(panelName);
        accountMenu.classList.add('hidden');
        authModal.classList.remove('hidden');
        document.body.classList.add('auth-modal-open');

        const activeForm = authModal.querySelector('[data-auth-panel]:not(.hidden)');
        activeForm?.querySelector('input')?.focus();
    };

    const closeAuthModal = () => {
        resetAuthForms();
        authModal.classList.add('hidden');
        document.body.classList.remove('auth-modal-open');
        accountButton.focus();
    };

    const reloadAfterAuthChange = () => {
        window.location.reload();
    };

    accountButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();

        if (!currentUser) {
            openAuthModal('login');
            return;
        }

        accountMenu.classList.toggle('hidden');
    }, true);

    accountSettingsButton?.addEventListener('click', () => {
        openAuthModal('credentials');
    });

    accountLogoutButton?.addEventListener('click', async () => {
        try {
            accountLogoutButton.disabled = true;
            await signOut();
            updateAccountButton(null);
            reloadAfterAuthChange();
        } catch (error) {
            openAuthModal('login');
            setAuthMessage(error.message || '\uB85C\uADF8\uC544\uC6C3\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
        } finally {
            accountLogoutButton.disabled = false;
        }
    });

    closeButton?.addEventListener('click', closeAuthModal);
    signupLink?.addEventListener('click', () => showAuthPanel('signup'));
    loginLink?.addEventListener('click', () => showAuthPanel('login'));

    loginForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setAuthMessage();

        const formData = new FormData(loginForm);
        const email = String(formData.get('loginId') || '').trim();
        const password = String(formData.get('password') || '');

        if (!email || !password) {
            setAuthMessage('\uC544\uC774\uB514\uC640 \uD328\uC2A4\uC6CC\uB4DC\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694.', 'error');
            return;
        }

        try {
            setFormPending(loginForm, true);
            const data = await signInWithEmail({ email, password });
            updateAccountButton(data.user);
            closeAuthModal();
            reloadAfterAuthChange();
        } catch (error) {
            setAuthMessage(getFriendlyAuthError(error, '\uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.'), 'error');
        } finally {
            setFormPending(loginForm, false);
        }
    });

    signupForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setAuthMessage();

        const formData = new FormData(signupForm);
        const email = String(formData.get('signupId') || '').trim();
        const password = String(formData.get('signupPassword') || '');
        const nickname = String(formData.get('nickname') || '').trim();

        if (!email || !password || !nickname) {
            setAuthMessage('\uC544\uC774\uB514, \uD328\uC2A4\uC6CC\uB4DC, \uB2C9\uB124\uC784\uC744 \uBAA8\uB450 \uC785\uB825\uD574\uC8FC\uC138\uC694.', 'error');
            return;
        }

        try {
            setFormPending(signupForm, true);
            const data = await signUpWithProfile({ email, password, nickname });

            if (data.session) {
                updateAccountButton(data.user);
                closeAuthModal();
                reloadAfterAuthChange();
                return;
            }

            showAuthPanel('login');
            setAuthMessage('\uD68C\uC6D0\uAC00\uC785\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC774\uBA54\uC77C \uC778\uC99D \uD6C4 \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694.', 'success');
        } catch (error) {
            setAuthMessage(getFriendlyAuthError(error, '\uD68C\uC6D0\uAC00\uC785\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.'), 'error');
        } finally {
            setFormPending(signupForm, false);
        }
    });

    credentialsForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setAuthMessage();

        const formData = new FormData(credentialsForm);
        const payload = {
            kiwoomAppKey: String(formData.get('kiwoomAppKey') || '').trim(),
            kiwoomSecretKey: String(formData.get('kiwoomSecretKey') || '').trim(),
            telegramBotToken: String(formData.get('telegramBotToken') || '').trim(),
        };

        if (!payload.kiwoomAppKey || !payload.kiwoomSecretKey) {
            setAuthMessage('\uD0A4\uC6C0 \uC571\uD0A4\uC640 \uC2DC\uD06C\uB9BF\uD0A4\uB294 \uBC18\uB4DC\uC2DC \uC785\uB825\uD574\uC8FC\uC138\uC694. \uD154\uB808\uADF8\uB7A8 \uBD07 API \uD0A4\uB294 \uC120\uD0DD\uC785\uB2C8\uB2E4.', 'error');
            return;
        }

        try {
            setFormPending(credentialsForm, true);
            const accessToken = await getAccessToken();
            const response = await fetch('/api/user-api-credentials', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify(payload),
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result.message || '\uD0A4 \uC815\uBCF4 \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.');
            }

            credentialsForm.reset();
            setAuthMessage('\uD0A4 \uC815\uBCF4\uB97C \uC554\uD638\uD654\uD574 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.', 'success');
        } catch (error) {
            setAuthMessage(error.message || '\uD0A4 \uC815\uBCF4 \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
        } finally {
            setFormPending(credentialsForm, false);
        }
    });

    authModal.addEventListener('click', (event) => {
        if (!modalCard?.contains(event.target)) {
            closeAuthModal();
        }
    });

    document.addEventListener('click', (event) => {
        if (!accountMenu.classList.contains('hidden')
            && !accountMenu.contains(event.target)
            && !accountButton.contains(event.target)) {
            accountMenu.classList.add('hidden');
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (!authModal.classList.contains('hidden')) closeAuthModal();
            accountMenu.classList.add('hidden');
        }
    });

    getCurrentUser()
        .then(updateAccountButton)
        .catch(() => updateAccountButton(null));
});

function getAuthModalMarkup() {
    return `
        <div class="auth-modal-card">
            <button id="authModalClose" type="button" class="auth-modal-close" aria-label="${TEXT.login} \uCC3D \uB2EB\uAE30">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <div class="auth-modal-icon">
                <i class="fa-solid fa-user-lock" aria-hidden="true"></i>
            </div>
            <h2 id="authModalTitle">${TEXT.login}</h2>
            <p id="authMessage" class="auth-message hidden" aria-live="polite"></p>
            <form class="auth-login-form" data-auth-panel="login">
                <label class="auth-field">
                    <span>${TEXT.id}</span>
                    <input type="text" name="loginId" autocomplete="username" placeholder="${TEXT.emailPlaceholder}">
                </label>
                <label class="auth-field">
                    <span>${TEXT.password}</span>
                    <input type="password" name="password" autocomplete="current-password" placeholder="${TEXT.passwordPlaceholder}">
                </label>
                <button type="submit" class="auth-submit-button" data-default-text="${TEXT.login}">${TEXT.login}</button>
                <p class="auth-switch-text">
                    <button id="authSignupLink" type="button">${TEXT.signup}</button>
                </p>
            </form>
            <form class="auth-login-form hidden" data-auth-panel="signup">
                <label class="auth-field">
                    <span>${TEXT.id}</span>
                    <input type="text" name="signupId" autocomplete="username" placeholder="${TEXT.emailPlaceholder}">
                </label>
                <label class="auth-field">
                    <span>${TEXT.password}</span>
                    <input type="password" name="signupPassword" autocomplete="new-password" placeholder="${TEXT.passwordPlaceholder}">
                </label>
                <label class="auth-field">
                    <span>${TEXT.nickname}</span>
                    <input type="text" name="nickname" autocomplete="nickname" placeholder="${TEXT.nicknamePlaceholder}">
                </label>
                <button type="submit" class="auth-submit-button" data-default-text="${TEXT.signup}">${TEXT.signup}</button>
                <p class="auth-switch-text">
                    <span>${TEXT.alreadyAccount}</span>
                    <button id="authLoginLink" type="button">${TEXT.login}</button>
                </p>
            </form>
            <form class="auth-login-form hidden" data-auth-panel="credentials">
                <label class="auth-field">
                    <span>${TEXT.kiwoomAppKey}</span>
                    <input type="password" name="kiwoomAppKey" autocomplete="off" placeholder="${TEXT.appKeyPlaceholder}">
                </label>
                <label class="auth-field">
                    <span>${TEXT.kiwoomSecretKey}</span>
                    <input type="password" name="kiwoomSecretKey" autocomplete="off" placeholder="${TEXT.secretKeyPlaceholder}">
                </label>
                <label class="auth-field">
                    <span>${TEXT.telegramBotKey}</span>
                    <input type="password" name="telegramBotToken" autocomplete="off" placeholder="${TEXT.botKeyPlaceholder}">
                </label>
                <button type="submit" class="auth-submit-button" data-default-text="${TEXT.save}">${TEXT.save}</button>
            </form>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
        const replacements = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        };
        return replacements[character];
    });
}

function getFriendlyAuthError(error, fallbackMessage) {
    const message = String(error?.message || '');
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('email not confirmed')) {
        return '\uC774\uBA54\uC77C \uC778\uC99D\uC774 \uC544\uC9C1 \uC644\uB8CC\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uAC00\uC785\uD55C \uC774\uBA54\uC77C\uC758 \uC778\uC99D \uB9C1\uD06C\uB97C \uBA3C\uC800 \uD655\uC778\uD574\uC8FC\uC138\uC694.';
    }

    if (lowerMessage.includes('invalid login credentials')) {
        return '\uC544\uC774\uB514 \uB610\uB294 \uD328\uC2A4\uC6CC\uB4DC\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.';
    }

    if (lowerMessage.includes('invalid email')) {
        return '\uC544\uC774\uB514\uC5D0\uB294 \uC774\uBA54\uC77C \uD615\uC2DD\uC73C\uB85C \uC785\uB825\uD574\uC8FC\uC138\uC694.';
    }

    if (lowerMessage.includes('already registered') || lowerMessage.includes('user already registered')) {
        return '\uC774\uBBF8 \uAC00\uC785\uB41C \uC774\uBA54\uC77C\uC785\uB2C8\uB2E4. \uB85C\uADF8\uC778\uD558\uAC70\uB098 \uB2E4\uB978 \uC774\uBA54\uC77C\uC744 \uC0AC\uC6A9\uD574\uC8FC\uC138\uC694.';
    }

    return message || fallbackMessage;
}
