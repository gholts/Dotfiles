// ==UserScript==
// @name         Feed Finder Kit
// @namespace    gholts.feed-finder.kit
// @version      2026.11.17.1
// @description  Find and copy RSS, Atom, and JSON feeds for the current page.
// @author       Gholts
// @license      GNU Affero General Public License v3.0
// @homepageURL  https://github.com/Gholts/Dotfiles/tree/main/bin/userscript
// @updateURL    https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-feed-finder.user.js
// @downloadURL  https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-feed-finder.user.js
// @match        *://*/*
// @connect      *
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(() => {
    "use strict";

    try {
        if (window.self !== window.top) return;
    } catch {
        return;
    }

    const DEFAULTS = Object.freeze({
        autoScan: true,
        probeCommonPaths: true,
        debug: false,
    });
    const TOGGLES = Object.freeze([
        ["autoScan", "Auto scan"],
        ["probeCommonPaths", "Probe common paths"],
        ["debug", "Debug logs"],
    ]);
    const STORE_PREFIX = "feedFinderKit.";
    const PROBE_PATHS = Object.freeze([
        "/feed",
        "/rss",
        "/atom.xml",
        "/rss.xml",
        "/feed.xml",
        "/feed.json",
    ]);
    const FEED_CONTENT_TYPES =
        /\b(application\/(rss|atom|rdf)\+xml|application\/feed\+json|application\/json|application\/xml|text\/xml)\b/i;
    const FEED_SELECTOR =
        'link[type], link[rel~="alternate" i], a[href*="rss" i], a[href*="feed" i], a[href*="atom" i], a[href$=".xml" i]';
    const FEED_TYPE_RE = /\b(?:(?:rss|atom|rdf)\+xml|feed\+json)\b/i;
    const FEED_HREF_RE = /(?:^|[/._=-])(?:feeds?|rss|atom)(?:[/._?#&=-]|$)/i;
    const FEED_HINT_RE = /\b(?:rss|atom|feed)\b/i;
    const PROBE_TIMEOUT_MS = 5000;
    const PROBE_CONCURRENCY = 3;
    const CONFIG = { ...DEFAULTS };

    const pageKey = () => location.href.replace(/#.*$/, "");

    const State = {
        currentUrl: pageKey(),
        hasSearched: false,
        lastStatus: "idle",
        lastFeeds: [],
        menuIds: [],
        scanId: 0,
    };

    const siteRules = {
        "github.com": (url) => {
            const feeds = new Map();
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts.length >= 2) {
                const [user, repo] = parts;
                feeds.set(
                    `${url.origin}/${user}/${repo}/releases.atom`,
                    "Releases",
                );
                feeds.set(
                    `${url.origin}/${user}/${repo}/commits.atom`,
                    "Commits",
                );
            } else if (parts.length === 1) {
                feeds.set(
                    `${url.origin}/${parts[0]}.atom`,
                    `${parts[0]} activity`,
                );
            }
            return feeds;
        },
        "medium.com": (url) => {
            const first = url.pathname.split("/").filter(Boolean)[0];
            const isUser = first?.startsWith("@");
            return new Map([
                [
                    isUser
                        ? `${url.origin}/${first}/feed`
                        : `${url.origin}/feed`,
                    isUser ? `${first} on Medium` : "Medium feed",
                ],
            ]);
        },
    };

    function storageKey(key) {
        return `${STORE_PREFIX}${key}`;
    }

    function readBool(key, fallback) {
        try {
            if (typeof GM_getValue === "function") {
                const value = GM_getValue(storageKey(key), fallback);
                if (typeof value === "boolean") return value;
            }
        } catch {}
        try {
            const value = localStorage.getItem(storageKey(key));
            if (value === "true") return true;
            if (value === "false") return false;
        } catch {}
        return fallback;
    }

    function writeBool(key, value) {
        try {
            if (typeof GM_setValue === "function") {
                GM_setValue(storageKey(key), value);
                return;
            }
        } catch {}
        try {
            localStorage.setItem(storageKey(key), String(value));
        } catch {}
    }

    for (const [key] of TOGGLES) CONFIG[key] = readBool(key, DEFAULTS[key]);

    const log = (...args) => {
        if (CONFIG.debug) console.debug("[FeedFinderKit]", ...args);
    };

    function debounce(fn, ms) {
        let timer = 0;
        return (...args) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = 0;
                fn(...args);
            }, ms);
        };
    }

    function safeUrl(href) {
        try {
            const url = new URL(href, location.href);
            if (/\.svg$/i.test(url.pathname)) return "";
            return url.href;
        } catch {
            return "";
        }
    }

    function titleFromElement(element, fallback) {
        return (
            element.getAttribute("title") ||
            element.getAttribute("aria-label") ||
            element.textContent?.trim() ||
            fallback
        );
    }

    function requestUrl(url, options = {}) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error("GM_xmlhttpRequest unavailable"));
                return;
            }

            GM_xmlhttpRequest({
                method: options.method || "GET",
                url,
                responseType: "text",
                timeout: options.timeout || PROBE_TIMEOUT_MS,
                onload: (response) => {
                    const headers = new Map();
                    for (const line of (response.responseHeaders || "").split(
                        /[\r\n]+/,
                    )) {
                        const index = line.indexOf(":");
                        if (index <= 0) continue;
                        headers.set(
                            line.slice(0, index).trim().toLowerCase(),
                            line.slice(index + 1).trim(),
                        );
                    }

                    resolve({
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        headers: {
                            get: (name) =>
                                headers.get(String(name).toLowerCase()) || "",
                        },
                    });
                },
                onerror: reject,
                ontimeout: reject,
            });
        });
    }

    async function runLimited(items, limit, worker) {
        let index = 0;
        const workers = Array.from(
            { length: Math.min(limit, items.length) },
            async () => {
                while (index < items.length) {
                    const item = items[index++];
                    await worker(item);
                }
            },
        );
        await Promise.allSettled(workers);
    }

    function clearMenu() {
        if (typeof GM_unregisterMenuCommand !== "function") return;
        for (const id of State.menuIds) {
            try {
                GM_unregisterMenuCommand(id);
            } catch {}
        }
        State.menuIds = [];
    }

    function addMenu(label, action) {
        if (typeof GM_registerMenuCommand !== "function") return;
        try {
            const id = GM_registerMenuCommand(label, action);
            State.menuIds.push(id);
        } catch {}
    }

    function registerMenu(status = State.lastStatus, feeds = State.lastFeeds) {
        clearMenu();
        State.lastStatus = status;
        State.lastFeeds = feeds;

        for (const [key, label] of TOGGLES) {
            addMenu(`${label} = ${CONFIG[key] ? "on" : "off"}`, () => {
                setToggle(key, !CONFIG[key]);
            });
        }

        addMenu("Scan now", () => {
            State.hasSearched = false;
            discoverInBackground(true);
        });

        if (status === "scanning") {
            addMenu("Status: scanning", () => {});
            return;
        }
        if (status === "error") {
            addMenu("Status: error", () => {});
            return;
        }
        if (!feeds.length) {
            addMenu(
                status === "idle" ? "Status: idle" : "Status: no feeds",
                () => {},
            );
            return;
        }

        for (const feed of feeds) {
            const title =
                feed.title === feed.url ? labelFromUrl(feed.url) : feed.title;
            addMenu(`Copy feed: ${title}`, () => copyFeed(feed.url));
        }
    }

    function setToggle(key, value) {
        if (typeof DEFAULTS[key] !== "boolean") return;
        CONFIG[key] = Boolean(value);
        writeBool(key, CONFIG[key]);
        if (key === "probeCommonPaths") {
            State.hasSearched = false;
        }
        if (CONFIG.autoScan && !State.hasSearched) {
            debouncedDiscovery();
        }
        registerMenu();
    }

    function labelFromUrl(url) {
        try {
            return (
                new URL(url).pathname.split("/").filter(Boolean).pop() || url
            );
        } catch {
            return url;
        }
    }

    function copyFeed(url) {
        try {
            GM_setClipboard(url, "text");
        } catch {
            navigator.clipboard?.writeText(url).catch(() => {});
        }

        try {
            GM_notification({
                title: "Feed Finder Kit",
                text: `Copied:\n${url}`,
                timeout: 2000,
            });
        } catch {}
    }

    function extractFeedUrl(element) {
        const href = element.getAttribute("href") || "";
        if (!href || /^(?:javascript|data):/i.test(href)) return "";
        if (element.closest("svg")) return "";

        let isFeed;
        if (element.localName === "link") {
            isFeed =
                FEED_TYPE_RE.test(element.type) ||
                (/\balternate\b/i.test(element.rel) &&
                    FEED_HREF_RE.test(href));
        } else {
            const image = element.querySelector("img");
            isFeed =
                FEED_HREF_RE.test(href) ||
                FEED_HINT_RE.test(
                    `${element.textContent} ${image?.src || ""} ${image?.className || ""}`,
                );
        }

        return isFeed ? safeUrl(element.href) : "";
    }

    function addSiteRuleFeeds(url, feeds) {
        try {
            siteRules[url.hostname]?.(url)?.forEach((title, href) => {
                feeds.set(href, title);
            });
        } catch (error) {
            log("site rule failed", error);
        }
    }

    function addDocumentFeeds(doc, feeds) {
        try {
            doc.querySelectorAll(FEED_SELECTOR).forEach((element) => {
                const feedUrl = extractFeedUrl(element);
                if (!feedUrl || feeds.has(feedUrl)) return;
                feeds.set(feedUrl, titleFromElement(element, feedUrl));
            });
        } catch (error) {
            log("DOM scan failed", error);
        }
    }

    async function probeFeeds(url, feeds) {
        if (!CONFIG.probeCommonPaths || feeds.size) return;

        const bases = [url.origin];
        const path = url.pathname.replace(/\/$/, "");
        if (path) bases.push(`${url.origin}${path}`);

        const targets = bases.flatMap((base) =>
            PROBE_PATHS.map((pathPart) => `${base}${pathPart}`),
        );

        await runLimited(targets, PROBE_CONCURRENCY, async (target) => {
            try {
                let response = await requestUrl(target, { method: "HEAD" });
                if (response.status === 405) {
                    response = await requestUrl(target, { method: "GET" });
                }

                const contentType = response.headers.get("content-type");
                if (response.ok && FEED_CONTENT_TYPES.test(contentType)) {
                    feeds.set(target, "Discovered feed");
                }
            } catch {}
        });
    }

    async function discoverFeeds(pageUrl) {
        const feeds = new Map();
        let url;
        try {
            url = new URL(pageUrl);
        } catch {
            return [];
        }

        addSiteRuleFeeds(url, feeds);
        addDocumentFeeds(document, feeds);
        await probeFeeds(url, feeds);

        return Array.from(feeds, ([feedUrl, title]) => ({
            url: feedUrl,
            title: title || feedUrl,
        }));
    }

    async function discoverInBackground(force = false) {
        if (State.hasSearched && !force) return;
        State.hasSearched = true;

        const pageUrl = pageKey();
        const scanId = ++State.scanId;
        registerMenu("scanning", []);

        try {
            const feeds = await discoverFeeds(pageUrl);
            if (scanId !== State.scanId || pageUrl !== State.currentUrl) return;
            registerMenu("done", feeds);
        } catch (error) {
            log("scan failed", error);
            if (scanId === State.scanId) registerMenu("error", []);
        }
    }

    const debouncedDiscovery = debounce(() => {
        if (CONFIG.autoScan) discoverInBackground(false);
    }, 500);

    function mount() {
        if (pageKey() !== State.currentUrl) {
            State.currentUrl = pageKey();
            State.hasSearched = false;
            State.scanId++;
            registerMenu("idle", []);
        }

        if (CONFIG.autoScan && !State.hasSearched) {
            debouncedDiscovery();
        }
    }

    function patchHistory(method) {
        const original = history[method];
        if (typeof original !== "function") return;
        history[method] = function (...args) {
            const result = original.apply(this, args);
            mount();
            return result;
        };
    }

    registerMenu("idle", []);

    if (document.readyState === "complete") mount();
    else window.addEventListener("load", mount, { once: true });

    patchHistory("pushState");
    patchHistory("replaceState");
    window.addEventListener("popstate", mount);
    document.addEventListener("astro:page-load", mount);
    document.addEventListener("astro:after-swap", mount);
    window.navigation?.addEventListener("navigatesuccess", mount);
})();
