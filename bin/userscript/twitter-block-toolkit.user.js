// ==UserScript==
// @name         X Block Toolkit
// @namespace    gholts.x.block-toolkit
// @version      2026.11.17.1
// @description  Bulk-block X Lists and Communities and add native-style block controls to posts and account rows.
// @author       Gholts
// @license      GNU Affero General Public License v3.0
// @homepageURL  https://github.com/Gholts/Dotfiles/tree/main/bin/userscript
// @updateURL    https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/twitter-block-toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/twitter-block-toolkit.user.js
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(() => {
    "use strict";

    const API_PATH = "/i/api/1.1/blocks/create.json";
    const INSTANCE_MARK = "__xBlockToolkitInstance";
    const AUTH_PATCH_MARK = "__xBlockToolkitAuthPatch";
    const POST_BUTTON_ATTR = "data-x-block-toolkit-button";
    const POST_BUTTON_WRAPPER_ATTR = "data-x-block-toolkit-button-wrapper";
    const SUGGESTION_BLOCK_ATTR = "data-x-block-toolkit-suggestion-block";
    const SUGGESTION_ACTIONS_ATTR = "data-x-block-toolkit-suggestion-actions";
    const HIDDEN_SUGGESTION_ATTR = "data-x-block-toolkit-hidden-suggestion";
    const BLOCKED_PROFILE_SCREEN_ATTR =
        "data-x-block-toolkit-blocked-profile-screen";
    const VIEW_POSTS_CLICKED_ATTR = "data-x-block-toolkit-view-posts-clicked";
    const SUPPRESSED_NOTICE_ATTR = "data-x-block-toolkit-suppressed-notice";
    const PANEL_ID = "x-block-toolkit-panel";
    const STYLE_ID = "x-block-toolkit-style";
    const TOAST_ID = "x-block-toolkit-toast";
    const BLOCK_CONCURRENCY = 4;
    const REQUEST_GAP_MS = 120;
    const SCAN_WAIT_MS = 180;
    const SCAN_BOTTOM_IDLE_MS = 3000;
    const SCAN_LOADING_TIMEOUT_MS = 15000;
    const BLOCK_NOTICE =
        "Thanks. X will use this to make your timeline better.";
    const pageWindow =
        typeof unsafeWindow === "object" && unsafeWindow
            ? unsafeWindow
            : window;
    const previousInstance = pageWindow[INSTANCE_MARK];
    const retainedSuggestionIds =
        previousInstance?.recentlyBlockedSuggestionIds?.add &&
        previousInstance?.recentlyBlockedSuggestionIds?.has
            ? previousInstance.recentlyBlockedSuggestionIds
            : new Set();
    const instance = {
        disposed: false,
        observer: null,
        scanFrameId: 0,
        domReadyHandler: null,
        unblockGuardHandler: null,
        recentlyBlockedSuggestionIds: retainedSuggestionIds,
        dispose: disposeInstance,
    };

    const bulk = {
        running: false,
        cancelled: false,
        blocked: 0,
        failed: 0,
        total: 0,
    };
    const recentlyBlockedSuggestionIds = instance.recentlyBlockedSuggestionIds;

    let authState = null;
    let toastTimer = 0;
    let postBlockQueue = Promise.resolve();

    class CancelledError extends Error {}

    function getHeader(headers, name) {
        if (!headers) return "";
        const wanted = name.toLowerCase();

        try {
            if (typeof headers.get === "function") {
                return headers.get(name) || "";
            }
        } catch {}

        if (Array.isArray(headers)) {
            for (const [key, value] of headers) {
                if (String(key).toLowerCase() === wanted) return value;
            }
            return "";
        }

        if (typeof headers === "object") {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === wanted) return headers[key];
            }
        }

        return "";
    }

    function captureBearer(state, value) {
        const token = String(value || "").trim();
        if (/^Bearer\s+\S+/i.test(token)) state.bearerToken = token;
    }

    function captureFetchHeaders(state, input, init) {
        try {
            captureBearer(state, getHeader(init?.headers, "authorization"));
            captureBearer(state, getHeader(input?.headers, "authorization"));
        } catch {}
    }

    function patchAuthHeaders() {
        const shared = pageWindow[AUTH_PATCH_MARK];
        if (
            shared &&
            typeof shared === "object" &&
            shared.kind === "x-block-toolkit-auth" &&
            typeof shared.nativeFetch === "function"
        ) {
            authState = shared;
            return;
        }

        const currentFetch = pageWindow.fetch;
        authState = {
            kind: "x-block-toolkit-auth",
            bearerToken: "",
            nativeFetch:
                typeof currentFetch === "function"
                    ? currentFetch.bind(pageWindow)
                    : null,
        };
        pageWindow[AUTH_PATCH_MARK] = authState;

        if (typeof currentFetch === "function") {
            pageWindow.fetch = function (input, init) {
                captureFetchHeaders(authState, input, init);
                return currentFetch.apply(this, arguments);
            };
        }

        const Xhr = pageWindow.XMLHttpRequest;
        const originalSetHeader = Xhr?.prototype?.setRequestHeader;
        if (typeof originalSetHeader === "function") {
            Xhr.prototype.setRequestHeader = function (name, value) {
                if (String(name || "").toLowerCase() === "authorization") {
                    captureBearer(authState, value);
                }
                return originalSetHeader.apply(this, arguments);
            };
        }
    }

    function getCsrfToken() {
        const match = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
        if (!match) return "";
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }

    function delay(ms) {
        return new Promise((resolve) => pageWindow.setTimeout(resolve, ms));
    }

    async function cancellableDelay(ms) {
        let remaining = ms;
        while (remaining > 0) {
            if (bulk.cancelled) throw new CancelledError();
            const step = Math.min(remaining, 500);
            await delay(step);
            remaining -= step;
        }
    }

    async function waitForAuth(timeoutMs = 12000, cancellable = false) {
        const deadline = Date.now() + timeoutMs;
        while (!authState?.bearerToken && Date.now() < deadline) {
            if (cancellable && bulk.cancelled) throw new CancelledError();
            await delay(200);
        }
        if (!authState?.bearerToken) {
            throw new Error("X auth not captured. Reload X, then try again.");
        }
    }

    function rateLimitDelay(response) {
        const reset = Number(response.headers.get("x-rate-limit-reset"));
        if (Number.isFinite(reset) && reset > 0) {
            return Math.max(5000, reset * 1000 - Date.now() + 1500);
        }

        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
            return retryAfter * 1000 + 500;
        }
        return 60000;
    }

    async function responseError(response) {
        let detail = "";
        try {
            const payload = await response.json();
            detail =
                payload?.errors?.[0]?.message ||
                payload?.error ||
                payload?.detail ||
                "";
        } catch {}
        return `X block request failed (${response.status}${detail ? `: ${detail}` : ""})`;
    }

    async function blockAccount(userId, options = {}) {
        await waitForAuth(12000, Boolean(options.cancellable));
        if (!authState?.nativeFetch)
            throw new Error("X fetch API unavailable.");
        if (!userId) throw new Error("No X account identifier found.");

        for (let attempt = 0; attempt < 5; attempt++) {
            if (options.cancellable && bulk.cancelled)
                throw new CancelledError();

            const csrfToken = getCsrfToken();
            if (!csrfToken)
                throw new Error("X CSRF token unavailable. Reload X.");

            const body = new URLSearchParams();
            body.set("user_id", userId);
            body.set("skip_status", "1");
            body.set("include_entities", "0");

            const response = await authState.nativeFetch(
                `${location.origin}${API_PATH}`,
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        authorization: authState.bearerToken,
                        "content-type": "application/x-www-form-urlencoded",
                        "x-csrf-token": csrfToken,
                        "x-twitter-active-user": "yes",
                        "x-twitter-auth-type": "OAuth2Session",
                        "x-twitter-client-language":
                            document.documentElement.lang || "en",
                    },
                    body: body.toString(),
                },
            );

            if (response.ok) return;

            const wait = options.cancellable ? cancellableDelay : delay;
            if (response.status === 429 && attempt < 4) {
                const waitMs = rateLimitDelay(response);
                options.onRateLimit?.(waitMs);
                await wait(waitMs);
                continue;
            }

            if (response.status >= 500 && attempt < 4) {
                await wait(2000 * (attempt + 1));
                continue;
            }

            throw new Error(await responseError(response));
        }
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            [${POST_BUTTON_ATTR}][data-state="busy"] { opacity: 0.45; }
            [${SUGGESTION_BLOCK_ATTR}] {
                width: 32px !important;
                min-width: 32px !important;
                padding-right: 0 !important;
                padding-left: 0 !important;
                margin-right: 8px !important;
                border-color: transparent !important;
                background-color: transparent !important;
            }
            [${SUGGESTION_BLOCK_ATTR}]:hover,
            [${SUGGESTION_BLOCK_ATTR}]:focus,
            [${SUGGESTION_BLOCK_ATTR}]:active {
                border-color: transparent !important;
                background-color: transparent !important;
            }
            [${SUGGESTION_BLOCK_ATTR}] svg {
                flex: 0 0 18px !important;
                width: 18px !important;
                height: 18px !important;
                color: rgb(113, 118, 123) !important;
                fill: currentColor !important;
            }
            [${SUGGESTION_BLOCK_ATTR}][data-state="busy"] { opacity: 0.45; }
            [${SUGGESTION_ACTIONS_ATTR}] {
                flex-direction: row !important;
                align-items: center !important;
            }
            [${HIDDEN_SUGGESTION_ATTR}] { display: none !important; }
            [${BLOCKED_PROFILE_SCREEN_ATTR}] { display: none !important; }
            [${SUPPRESSED_NOTICE_ATTR}] { display: none !important; }

            #${PANEL_ID} {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
                margin-left: auto;
                padding: 0;
                font: 15px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            #${PANEL_ID} .x-block-toolkit-status {
                min-width: 0;
                max-width: 260px;
                overflow: hidden;
                color: rgb(113, 118, 123);
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${PANEL_ID} button {
                flex: 0 0 auto;
                height: 32px;
                min-height: 32px;
                padding: 0 16px;
                border: 0;
                border-radius: 9999px;
                background: rgb(244, 33, 46);
                color: white;
                font: inherit;
                font-weight: 700;
                cursor: pointer;
                white-space: nowrap;
            }
            #${PANEL_ID} button:hover { background: rgb(220, 30, 41); }
            #${PANEL_ID} button[data-running="true"] {
                background: rgb(83, 100, 113);
            }

            #${TOAST_ID} {
                position: fixed;
                left: 50%;
                bottom: 24px;
                transform: translateX(-50%);
                z-index: 2147483647;
                max-width: min(520px, calc(100vw - 32px));
                padding: 10px 16px;
                border-radius: 9999px;
                background: rgb(15, 20, 25);
                color: white;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
                font: 700 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                pointer-events: none;
            }

            @media (max-width: 700px) {
                #${PANEL_ID} .x-block-toolkit-status { display: none; }
                #${PANEL_ID} button { padding: 0 12px; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showToast(message, durationMs = 3500) {
        if (instance.disposed) return;
        document.getElementById(TOAST_ID)?.remove();
        pageWindow.clearTimeout(toastTimer);

        const toast = document.createElement("div");
        toast.id = TOAST_ID;
        toast.setAttribute("role", "status");
        toast.textContent = message;
        document.body.appendChild(toast);
        toastTimer = pageWindow.setTimeout(() => toast.remove(), durationMs);
    }

    function directDescendant(element, selector) {
        return Array.from(element.querySelectorAll(selector)).find(
            (candidate) => candidate.closest("article") === element,
        );
    }

    function postHandle(article) {
        const time = directDescendant(article, "time");
        const statusHref = time?.closest("a[href]")?.getAttribute("href") || "";
        const statusMatch = statusHref.match(
            /^\/?([A-Za-z0-9_]+)\/status\/\d+/,
        );
        if (statusMatch) return statusMatch[1];

        for (const link of article.querySelectorAll('a[href^="/"]')) {
            if (link.closest("article") !== article) continue;
            const href = link.getAttribute("href") || "";
            const match = href.match(/^\/([A-Za-z0-9_]+)$/);
            if (match) return match[1];
        }
        return "";
    }

    async function waitForUiElement(find, timeoutMs, errorMessage) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const element = find();
            if (element) return element;
            await delay(50);
        }
        throw new Error(errorMessage);
    }

    function queuePostBlock(task) {
        const pending = postBlockQueue.then(task, task);
        postBlockQueue = pending.catch(() => {});
        return pending;
    }

    function isBlockConfirmationFor(dialog, handle) {
        const confirm = dialog?.querySelector(
            '[data-testid="confirmationSheetConfirm"]',
        );
        const wanted = `@${handle}`.toLowerCase();
        return (
            (confirm?.textContent || "").trim().toLowerCase() === "block" &&
            (dialog?.textContent || "").toLowerCase().includes(wanted)
        );
    }

    async function blockPostThroughNativeUi(article, handle) {
        const more = directDescendant(article, 'button[data-testid="caret"]');
        if (!more) throw new Error("Native More button unavailable.");

        let confirmation = null;
        try {
            more.click();

            const blockItem = await waitForUiElement(
                () => {
                    const items = Array.from(
                        document.querySelectorAll(
                            '[data-testid="Dropdown"] [data-testid="block"]',
                        ),
                    );
                    const wanted = `@${handle}`.toLowerCase();
                    return items.find((item) =>
                        (item.textContent || "").toLowerCase().includes(wanted),
                    );
                },
                3000,
                `Native Block action for @${handle} unavailable.`,
            );
            blockItem.click();

            confirmation = await waitForUiElement(
                () =>
                    Array.from(
                        document.querySelectorAll(
                            '[data-testid="confirmationSheetDialog"]',
                        ),
                    ).find((dialog) => isBlockConfirmationFor(dialog, handle)),
                3000,
                "Native block confirmation unavailable.",
            );
            const confirm = confirmation.querySelector(
                '[data-testid="confirmationSheetConfirm"]',
            );
            if (!confirm)
                throw new Error(
                    "Native Block confirmation button unavailable.",
                );

            confirm.click();
            await waitForUiElement(
                () => !confirmation.isConnected,
                12000,
                "Native block request did not finish.",
            );
        } catch (error) {
            if (confirmation?.isConnected) {
                confirmation
                    .querySelector('[data-testid="confirmationSheetCancel"]')
                    ?.click();
            } else if (document.querySelector('[data-testid="Dropdown"]')) {
                more.click();
            }
            throw error;
        }
    }

    function resetPostButton(button, handle) {
        if (!button.isConnected) return;
        button.dataset.state = "ready";
        button.disabled = false;
        button.setAttribute("aria-label", `Block @${handle}`);
        button.setAttribute("title", `Block @${handle}`);
    }

    function setBlockIcon(button) {
        const svg = button.querySelector("svg");
        if (!svg) return;
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.innerHTML =
            '<g><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM4 12a8 8 0 0 1 12.9-6.31L5.69 16.9A7.96 7.96 0 0 1 4 12Zm8 8a7.96 7.96 0 0 1-4.9-1.69L18.31 7.1A8 8 0 0 1 12 20Z"></path></g>';
    }

    function configurePostButton(button, article, handle) {
        button.setAttribute(POST_BUTTON_ATTR, "");
        button.setAttribute("aria-label", `Block @${handle}`);
        button.setAttribute("title", `Block @${handle}`);
        button.removeAttribute("aria-describedby");
        button.removeAttribute("aria-expanded");
        button.removeAttribute("aria-haspopup");
        button.removeAttribute("data-testid");
        button.type = "button";
        button.dataset.handle = handle;
        button.dataset.state = "ready";

        for (const element of button.querySelectorAll("[id], [data-testid]")) {
            element.removeAttribute("id");
            element.removeAttribute("data-testid");
        }
        setBlockIcon(button);

        button.addEventListener(
            "click",
            async (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (button.dataset.state !== "ready") return;

                const currentHandle =
                    postHandle(article) || button.dataset.handle;
                button.dataset.state = "busy";
                button.disabled = true;
                button.setAttribute("aria-label", `Blocking @${currentHandle}`);

                try {
                    const completed = await queuePostBlock(async () => {
                        const latestHandle = postHandle(article);
                        if (
                            !article.isConnected ||
                            !button.isConnected ||
                            latestHandle.toLowerCase() !==
                                currentHandle.toLowerCase()
                        ) {
                            return false;
                        }

                        await blockPostThroughNativeUi(article, currentHandle);
                        return true;
                    });
                    if (!completed) {
                        resetPostButton(button, currentHandle);
                        return;
                    }

                    pageWindow.setTimeout(() => {
                        resetPostButton(button, currentHandle);
                    }, 4000);
                } catch (error) {
                    resetPostButton(button, currentHandle);
                    showToast(error.message || "Block failed", 6000);
                }
            },
            true,
        );
    }

    function addPostBlockButton(article) {
        const caret = directDescendant(article, 'button[data-testid="caret"]');
        if (!caret?.parentElement) return;

        const handle = postHandle(article);
        if (!handle) return;

        const grok = directDescendant(
            article,
            'button[aria-label="Grok actions"]',
        );
        if (!grok) return;

        let actionRow = grok.parentElement;
        while (
            actionRow &&
            actionRow !== article &&
            !actionRow.contains(caret)
        ) {
            actionRow = actionRow.parentElement;
        }
        if (!actionRow || actionRow === article) return;

        let grokSlot = grok;
        let caretSlot = caret;
        while (grokSlot.parentElement !== actionRow) {
            grokSlot = grokSlot.parentElement;
        }
        while (caretSlot.parentElement !== actionRow) {
            caretSlot = caretSlot.parentElement;
        }
        if (grokSlot === caretSlot) return;

        const existing = Array.from(
            article.querySelectorAll(`[${POST_BUTTON_ATTR}]`),
        ).find((button) => button.closest("article") === article);
        if (existing) {
            const slot = existing.closest(`[${POST_BUTTON_WRAPPER_ATTR}]`);
            const correctlyPlaced =
                slot?.parentElement === actionRow &&
                slot.nextElementSibling === caretSlot;
            if (existing.dataset.handle === handle && correctlyPlaced) return;
            if (slot) slot.remove();
            else existing.remove();
        }

        const slot = grokSlot.cloneNode(true);
        const button = slot.matches("button")
            ? slot
            : slot.querySelector('button[aria-label="Grok actions"]');
        if (!button) return;

        for (const element of [
            slot,
            ...slot.querySelectorAll("[id], [data-testid]"),
        ]) {
            element.removeAttribute("id");
            element.removeAttribute("data-testid");
        }
        slot.setAttribute(POST_BUTTON_WRAPPER_ATTR, "");
        configurePostButton(button, article, handle);
        caretSlot.before(slot);
    }

    function setSuggestionBlockIcon(button) {
        const label = button.firstElementChild || button;
        const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
        );
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute(
            "class",
            "r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1nao33i r-16y2uox r-8kz0gk",
        );
        label.replaceChildren(svg);
        setBlockIcon(button);
    }

    function setSuggestionHidden(cell, hidden) {
        const row = cell.closest('[data-testid="cellInnerDiv"]') || cell;
        row.toggleAttribute(HIDDEN_SUGGESTION_ATTR, hidden);
    }

    function isSuggestionCell(cell) {
        if (location.pathname === "/i/connect_people") return true;
        if (
            /^\/i\/communities\/\d+\/members\/?$/.test(location.pathname) &&
            cell.closest('[data-testid="primaryColumn"]')
        ) {
            return true;
        }
        const complementary = cell.closest('[role="complementary"], aside');
        if (!complementary) return false;
        return Array.from(
            complementary.querySelectorAll('h1, h2, [role="heading"]'),
        ).some(
            (heading) =>
                (heading.textContent || "").trim() === "You might like",
        );
    }

    function suggestionHandle(cell, action) {
        const ariaMatch = (action.getAttribute("aria-label") || "").match(
            /@([A-Za-z0-9_]+)/,
        );
        if (ariaMatch) return ariaMatch[1];

        for (const link of cell.querySelectorAll('a[href^="/"]')) {
            const match = (link.getAttribute("href") || "").match(
                /^\/([A-Za-z0-9_]+)$/,
            );
            if (match) return match[1];
        }
        return "";
    }

    function configureSuggestionBlockButton(button, cell, userId, handle) {
        button.setAttribute(SUGGESTION_BLOCK_ATTR, "");
        button.removeAttribute("data-testid");
        button.removeAttribute("aria-describedby");
        button.removeAttribute("aria-expanded");
        button.removeAttribute("aria-haspopup");
        button.type = "button";
        button.dataset.userId = userId;
        button.dataset.state = "ready";
        button.setAttribute("aria-label", `Block @${handle}`);
        button.setAttribute("title", `Block @${handle}`);
        setSuggestionBlockIcon(button);

        for (const element of button.querySelectorAll("[id], [data-testid]")) {
            element.removeAttribute("id");
            element.removeAttribute("data-testid");
        }

        button.addEventListener(
            "click",
            async (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (button.dataset.state !== "ready") return;

                button.dataset.state = "busy";
                button.disabled = true;
                button.setAttribute("aria-label", `Blocking @${handle}`);

                try {
                    await blockAccount(userId, {
                        onRateLimit: (waitMs) =>
                            showToast(
                                `Rate limited. Retrying in ${Math.ceil(waitMs / 1000)}s.`,
                                Math.min(waitMs, 10000),
                            ),
                    });
                    recentlyBlockedSuggestionIds.add(userId);
                    setSuggestionHidden(cell, true);
                    showToast(`Blocked @${handle}`);
                } catch (error) {
                    button.dataset.state = "ready";
                    button.disabled = false;
                    button.setAttribute("aria-label", `Block @${handle}`);
                    showToast(error.message || "Block failed", 6000);
                }
            },
            true,
        );
    }

    function userAction(cell) {
        for (const button of cell.querySelectorAll("button[data-testid]")) {
            const match = button.dataset.testid.match(
                /^(\d+)-(follow|unfollow|unblock)$/,
            );
            if (match) return { button, userId: match[1], name: match[2] };
        }
        return null;
    }

    function addSuggestionBlockButton(cell) {
        if (!isSuggestionCell(cell)) return;

        const { button: action, userId, name: actionName } =
            userAction(cell) || {};
        if (!action?.parentElement) return;
        const existing = cell.querySelector(`[${SUGGESTION_BLOCK_ATTR}]`);
        const shouldHide =
            actionName === "unblock" ||
            recentlyBlockedSuggestionIds.has(userId);
        setSuggestionHidden(cell, shouldHide);

        if (shouldHide) {
            existing?.remove();
            action.parentElement.removeAttribute(SUGGESTION_ACTIONS_ATTR);
            return;
        }

        const handle = suggestionHandle(cell, action);
        if (!handle) return;
        action.parentElement.setAttribute(SUGGESTION_ACTIONS_ATTR, "");

        const correctlyPlaced =
            existing?.dataset.userId === userId &&
            existing.parentElement === action.parentElement &&
            existing.nextElementSibling === action;
        if (correctlyPlaced) return;

        existing?.remove();
        const button = action.cloneNode(true);
        configureSuggestionBlockButton(button, cell, userId, handle);
        action.before(button);
    }

    function isSupportedListHeading(element) {
        const text = (element?.textContent || "").trim();
        return text === "List members" || text === "List followers";
    }

    function suppressBlockNotices() {
        for (const cell of document.querySelectorAll(
            '[data-testid="cellInnerDiv"]',
        )) {
            const text = (cell.textContent || "").replace(/\s+/g, " ").trim();
            const isBlockNotice =
                text === BLOCK_NOTICE &&
                !cell.querySelector('article[data-testid="tweet"]');
            cell.toggleAttribute(SUPPRESSED_NOTICE_ATTR, isBlockNotice);
        }
    }

    function isUnblockConfirmation(dialog) {
        const confirm = dialog?.querySelector(
            '[data-testid="confirmationSheetConfirm"]',
        );
        return (confirm?.textContent || "").trim().toLowerCase() === "unblock";
    }

    function cancelVisibleUnblockConfirmations() {
        for (const dialog of document.querySelectorAll(
            '[data-testid="confirmationSheetDialog"]',
        )) {
            if (!isUnblockConfirmation(dialog)) continue;
            dialog
                .querySelector('[data-testid="confirmationSheetCancel"]')
                ?.click();
        }
    }

    function preventUnblockConfirmClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const confirm = target?.closest(
            '[data-testid="confirmationSheetConfirm"]',
        );
        const dialog = confirm?.closest(
            '[data-testid="confirmationSheetDialog"]',
        );
        if (!dialog || !isUnblockConfirmation(dialog)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        dialog
            .querySelector('[data-testid="confirmationSheetCancel"]')
            ?.click();
    }

    function installUnblockGuard() {
        const handler = preventUnblockConfirmClick;
        instance.unblockGuardHandler = handler;
        document.addEventListener("click", handler, true);
    }

    function bypassBlockedProfileScreen() {
        for (const emptyState of document.querySelectorAll(
            '[data-testid="emptyState"]',
        )) {
            const text = (emptyState.textContent || "")
                .replace(/\s+/g, " ")
                .trim();
            const button = emptyState.querySelector(
                '[data-testid="empty_state_button_text"]',
            );
            const isBlockedProfile =
                /@\w+ is blocked/i.test(text) &&
                /Viewing posts (?:won’t|won't) unblock @/i.test(text) &&
                (button?.textContent || "").trim().toLowerCase() ===
                    "view posts";

            emptyState.toggleAttribute(
                BLOCKED_PROFILE_SCREEN_ATTR,
                isBlockedProfile,
            );
            if (
                !isBlockedProfile ||
                button.hasAttribute(VIEW_POSTS_CLICKED_ATTR)
            ) {
                continue;
            }

            button.setAttribute(VIEW_POSTS_CLICKED_ATTR, "");
            button.click();
        }
    }

    function findListDialog() {
        const headings = document.querySelectorAll(
            '#modal-header, [role="heading"], h1, h2',
        );
        for (const heading of headings) {
            if (!isSupportedListHeading(heading)) continue;
            const dialog = heading.closest('[role="dialog"]');
            if (dialog) return dialog;
        }
        return null;
    }

    function findCommunityMembersSurface() {
        if (!/^\/i\/communities\/\d+\/members\/?$/.test(location.pathname)) {
            return null;
        }

        const root = document.querySelector('[data-testid="primaryColumn"]');
        if (!root) return null;

        const heading = Array.from(
            root.querySelectorAll('[role="heading"], h1, h2'),
        ).find((element) => (element.textContent || "").trim() === "Members");
        if (!heading) return null;

        let header = heading.parentElement;
        while (
            header &&
            header !== root &&
            !header.querySelector(
                'button[data-testid="app-bar-back"], button[aria-label="Back"]',
            )
        ) {
            header = header.parentElement;
        }
        if (!header || header === root) return null;

        return {
            kind: "community",
            root,
            heading,
            header,
            listType: "members",
            panelLabel: "X Community member blocker",
        };
    }

    function findBulkSurface() {
        const dialog = findListDialog();
        if (dialog) {
            const heading = Array.from(
                dialog.querySelectorAll(
                    '#modal-header, [role="heading"], h1, h2',
                ),
            ).find(isSupportedListHeading);
            const close = dialog.querySelector(
                'button[data-testid="app-bar-close"]',
            );
            const header = close?.parentElement?.parentElement;
            if (!heading || !header?.contains(heading)) return null;

            return {
                kind: "list",
                root: dialog,
                heading,
                header,
                listType:
                    heading.textContent.trim() === "List followers"
                        ? "followers"
                        : "members",
                panelLabel: "X List blocker",
            };
        }

        return findCommunityMembersSurface();
    }

    function updatePanel(status, buttonText) {
        if (instance.disposed) return;
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        const statusElement = panel.querySelector(".x-block-toolkit-status");
        const button = panel.querySelector("button");
        if (statusElement) {
            statusElement.textContent = status || "";
            statusElement.hidden = !status;
        }
        if (button && buttonText) button.textContent = buttonText;
        if (button) {
            button.dataset.running = String(bulk.running);
            button.title = status || buttonText || "Block all members";
            button.setAttribute(
                "aria-label",
                status && buttonText ? `${buttonText}. ${status}` : buttonText,
            );
        }
    }

    function ensureBulkPanel() {
        const surface = findBulkSurface();
        const existing = document.getElementById(PANEL_ID);
        if (!surface) {
            existing?.remove();
            return;
        }
        if (existing && surface.root.contains(existing)) return;
        existing?.remove();

        const panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.setAttribute("role", "region");
        panel.setAttribute("aria-label", surface.panelLabel);

        const status = document.createElement("div");
        status.className = "x-block-toolkit-status";
        status.hidden = true;
        status.setAttribute("aria-live", "polite");

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Block all ${surface.listType}`;
        button.title =
            surface.kind === "community"
                ? "Block all members of this Community"
                : `Block all ${surface.listType} of this list`;
        button.setAttribute(
            "aria-label",
            `Block all ${surface.listType}`,
        );
        button.addEventListener("click", () => {
            if (bulk.running) {
                bulk.cancelled = true;
                updatePanel("Stopping after current request…", "Stopping…");
                return;
            }
            startBulkBlock();
        });

        panel.append(status, button);
        surface.header.appendChild(panel);
    }

    function findListScroller(dialog) {
        const candidates = [dialog, ...dialog.querySelectorAll("*")].filter(
            (element) => {
                if (element.scrollHeight <= element.clientHeight + 20)
                    return false;
                const overflow = getComputedStyle(element).overflowY;
                return overflow === "auto" || overflow === "scroll";
            },
        );
        candidates.sort(
            (a, b) =>
                b.scrollHeight -
                b.clientHeight -
                (a.scrollHeight - a.clientHeight),
        );
        return candidates[0] || null;
    }

    function collectVisibleMembers(root, targets, alreadyBlocked) {
        const before = targets.size + alreadyBlocked.size;

        for (const cell of root.querySelectorAll(
            '[data-testid="UserCell"]',
        )) {
            const action = userAction(cell);
            if (!action) continue;

            const { userId } = action;
            if (action.name === "unblock") {
                alreadyBlocked.add(userId);
                targets.delete(userId);
            } else if (!alreadyBlocked.has(userId)) {
                targets.add(userId);
            }
        }

        return targets.size + alreadyBlocked.size - before;
    }

    function listIsLoading(root) {
        return Boolean(
            root.querySelector(
                '[role="progressbar"], [data-testid="spinner"]',
            ),
        );
    }

    async function scanListMembers(surface) {
        const scroller =
            surface.kind === "community"
                ? document.scrollingElement
                : findListScroller(surface.root);
        if (!scroller) throw new Error("Member list scroller not found.");

        const targets = new Set();
        const alreadyBlocked = new Set();
        const initialScrollTop = scroller.scrollTop;
        let bottomWaitStartedAt = 0;

        try {
            for (let pass = 0; pass < 5000; pass++) {
                if (bulk.cancelled) throw new CancelledError();

                const foundBeforeScroll = collectVisibleMembers(
                    surface.root,
                    targets,
                    alreadyBlocked,
                );
                updatePanel(
                    `Scanning… ${targets.size} to block · ${alreadyBlocked.size} already blocked`,
                    "Stop",
                );

                const oldTop = scroller.scrollTop;
                const oldHeight = scroller.scrollHeight;
                const step = Math.max(
                    450,
                    Math.floor(scroller.clientHeight * 0.95),
                );
                scroller.scrollTop = Math.min(oldTop + step, oldHeight);
                await cancellableDelay(SCAN_WAIT_MS);

                const foundAfterScroll = collectVisibleMembers(
                    surface.root,
                    targets,
                    alreadyBlocked,
                );
                const atBottom =
                    scroller.scrollTop + scroller.clientHeight >=
                    scroller.scrollHeight - 4;
                const moved = scroller.scrollTop > oldTop + 1;
                const grew = scroller.scrollHeight > oldHeight + 1;
                const found = foundBeforeScroll + foundAfterScroll;

                if (!atBottom || moved || grew || found > 0) {
                    bottomWaitStartedAt = 0;
                    continue;
                }

                const now = Date.now();
                if (!bottomWaitStartedAt) bottomWaitStartedAt = now;

                const loading = listIsLoading(surface.root);
                const waitMs = now - bottomWaitStartedAt;
                if (loading) {
                    updatePanel(
                        `Loading more… ${targets.size} to block · ${alreadyBlocked.size} already blocked`,
                        "Stop",
                    );
                }

                if (
                    (!loading && waitMs >= SCAN_BOTTOM_IDLE_MS) ||
                    waitMs >= SCAN_LOADING_TIMEOUT_MS
                ) {
                    break;
                }
            }
        } finally {
            if (scroller.isConnected) scroller.scrollTop = initialScrollTop;
        }

        return {
            targets: [...targets.values()],
            alreadyBlocked: alreadyBlocked.size,
        };
    }

    async function startBulkBlock() {
        const surface = findBulkSurface();
        if (!surface) {
            showToast(
                "Open an X List or Community members page first.",
            );
            return;
        }
        const confirmation =
            surface.kind === "community"
                ? "Block every currently unblocked account on this Community members page?\n\nThis includes admins and moderators. You can stop the run, but completed blocks will remain."
                : "Block every currently unblocked account in this X List?\n\nYou can stop the run, but completed blocks will remain.";
        if (
            !pageWindow.confirm(confirmation)
        ) {
            return;
        }

        bulk.running = true;
        bulk.cancelled = false;
        bulk.blocked = 0;
        bulk.failed = 0;
        bulk.total = 0;
        updatePanel("Waiting for X authorization…", "Stop");

        try {
            await waitForAuth(12000, true);
            const scan = await scanListMembers(surface);
            bulk.total = scan.targets.length;

            if (!bulk.total) {
                updatePanel(
                    `Done. ${scan.alreadyBlocked} members already blocked.`,
                    "Run again",
                );
                return;
            }

            const workerCount = Math.min(BLOCK_CONCURRENCY, bulk.total);
            let nextIndex = 0;

            const runWorker = async (workerIndex) => {
                try {
                    if (workerIndex > 0) {
                        await cancellableDelay(workerIndex * REQUEST_GAP_MS);
                    }

                    while (!bulk.cancelled) {
                        const index = nextIndex++;
                        if (index >= bulk.total) return;
                        const userId = scan.targets[index];

                        updatePanel(
                            `Blocking ${bulk.blocked + bulk.failed}/${bulk.total}… ${workerCount} parallel`,
                            "Stop",
                        );

                        try {
                            await blockAccount(userId, {
                                cancellable: true,
                                onRateLimit: (waitMs) =>
                                    updatePanel(
                                        `Rate limited. Retrying in ${Math.ceil(waitMs / 1000)}s…`,
                                        "Stop",
                                    ),
                            });
                            recentlyBlockedSuggestionIds.add(userId);
                            bulk.blocked++;
                        } catch (error) {
                            if (error instanceof CancelledError) return;
                            bulk.failed++;
                            console.warn("[XBlockToolkit]", userId, error);
                        }

                        updatePanel(
                            `Blocking ${bulk.blocked + bulk.failed}/${bulk.total}… ${bulk.failed} failed`,
                            "Stop",
                        );

                        if (nextIndex < bulk.total && !bulk.cancelled) {
                            await cancellableDelay(REQUEST_GAP_MS);
                        }
                    }
                } catch (error) {
                    if (!(error instanceof CancelledError)) throw error;
                }
            };

            await Promise.all(
                Array.from({ length: workerCount }, (_, index) =>
                    runWorker(index),
                ),
            );
            if (bulk.cancelled) throw new CancelledError();

            updatePanel(
                `Done. ${bulk.blocked} blocked · ${bulk.failed} failed · ${scan.alreadyBlocked} already blocked`,
                "Run again",
            );
            showToast(
                `${surface.kind === "community" ? "Community" : "List"} blocking finished: ${bulk.blocked} blocked`,
                5000,
            );
        } catch (error) {
            if (error instanceof CancelledError) {
                updatePanel(
                    `Stopped. ${bulk.blocked} blocked · ${bulk.failed} failed`,
                    "Resume",
                );
            } else {
                updatePanel(error.message || "Bulk block failed", "Retry");
                showToast(error.message || "Bulk block failed", 6000);
            }
        } finally {
            bulk.running = false;
            bulk.cancelled = false;
            const button = document.querySelector(`#${PANEL_ID} button`);
            if (button) button.dataset.running = "false";
        }
    }

    function scanPage() {
        if (instance.disposed) return;
        instance.scanFrameId = 0;
        injectStyles();
        cancelVisibleUnblockConfirmations();
        bypassBlockedProfileScreen();
        suppressBlockNotices();
        for (const article of document.querySelectorAll(
            'article[data-testid="tweet"]',
        )) {
            addPostBlockButton(article);
        }
        for (const cell of document.querySelectorAll(
            '[data-testid="UserCell"]',
        )) {
            addSuggestionBlockButton(cell);
        }
        ensureBulkPanel();
    }

    function scheduleScan() {
        if (instance.disposed || instance.scanFrameId) return;
        instance.scanFrameId = pageWindow.requestAnimationFrame(scanPage);
    }

    function startUi() {
        if (instance.disposed) return;
        if (!document.documentElement) {
            pageWindow.setTimeout(startUi, 0);
            return;
        }
        instance.domReadyHandler = null;
        installUnblockGuard();
        scanPage();
        instance.observer = new MutationObserver(scheduleScan);
        instance.observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    function cleanupInjectedUi() {
        for (const element of document.querySelectorAll(
            `[${POST_BUTTON_WRAPPER_ATTR}], [${POST_BUTTON_ATTR}], [${SUGGESTION_BLOCK_ATTR}]`,
        )) {
            element.remove();
        }
        for (const element of document.querySelectorAll(
            `[${SUGGESTION_ACTIONS_ATTR}], [${HIDDEN_SUGGESTION_ATTR}], [${BLOCKED_PROFILE_SCREEN_ATTR}], [${VIEW_POSTS_CLICKED_ATTR}], [${SUPPRESSED_NOTICE_ATTR}]`,
        )) {
            element.removeAttribute(SUGGESTION_ACTIONS_ATTR);
            element.removeAttribute(HIDDEN_SUGGESTION_ATTR);
            element.removeAttribute(BLOCKED_PROFILE_SCREEN_ATTR);
            element.removeAttribute(VIEW_POSTS_CLICKED_ATTR);
            element.removeAttribute(SUPPRESSED_NOTICE_ATTR);
        }
        document.getElementById(PANEL_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
        document.getElementById(TOAST_ID)?.remove();
    }

    function disposeInstance() {
        if (instance.disposed) return;
        instance.disposed = true;
        bulk.cancelled = true;
        pageWindow.clearTimeout(toastTimer);

        if (instance.scanFrameId) {
            pageWindow.cancelAnimationFrame(instance.scanFrameId);
            instance.scanFrameId = 0;
        }
        instance.observer?.disconnect();
        instance.observer = null;

        if (instance.domReadyHandler) {
            document.removeEventListener(
                "DOMContentLoaded",
                instance.domReadyHandler,
            );
            instance.domReadyHandler = null;
        }
        if (instance.unblockGuardHandler) {
            document.removeEventListener(
                "click",
                instance.unblockGuardHandler,
                true,
            );
            instance.unblockGuardHandler = null;
        }

        if (pageWindow[INSTANCE_MARK] === instance) {
            cleanupInjectedUi();
            delete pageWindow[INSTANCE_MARK];
        }
    }

    function initialize() {
        try {
            previousInstance?.dispose?.();
        } catch (error) {
            console.warn(
                "[XBlockToolkit] Previous instance cleanup failed",
                error,
            );
        }

        cleanupInjectedUi();
        pageWindow[INSTANCE_MARK] = instance;
        patchAuthHeaders();

        if (document.readyState === "loading") {
            instance.domReadyHandler = startUi;
            document.addEventListener("DOMContentLoaded", startUi, {
                once: true,
            });
        } else {
            startUi();
        }
    }

    initialize();
})();
