// ==UserScript==
// @name         Video Browser Fullscreen Kit
// @namespace    gholts.video-browser-fullscreen.kit
// @version      2026.11.17.1
// @description  Keep macOS video fullscreen inside the browser window and preserve rapid play/pause clicks.
// @author       Gholts
// @license      GNU Affero General Public License v3.0
// @homepageURL  https://github.com/Gholts/Dotfiles/tree/main/bin/userscript
// @updateURL    https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/video-browser-fullscreen.user.js
// @downloadURL  https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/video-browser-fullscreen.user.js
// @match        http://*/*
// @match        https://*/*
// @grant        none
// @run-at       document-start
// @inject-into  auto
// ==/UserScript==

(() => {
    "use strict";

    if (
        !/Mac/i.test(navigator.platform) ||
        navigator.maxTouchPoints > 1
    ) {
        return;
    }

    const INSTANCE_KEY = Symbol.for("local.videoBrowserFullscreen.instance");
    if (window[INSTANCE_KEY]) return;

    const TARGET_ATTR = "data-video-browser-fullscreen";
    const ROOT_ATTR = "data-video-browser-fullscreen-active";
    const STYLE_ATTR = "data-video-browser-fullscreen-style";
    const FRAME_MESSAGE_KEY = "__videoBrowserFullscreenFrameMessage";
    const MAX_Z_INDEX = "2147483647";
    const pageWindow =
        typeof exportFunction === "function" && window.wrappedJSObject
            ? window.wrappedJSObject
            : null;
    const FRAME_VIDEO_HINT_PATTERN =
        /(?:^|[./?&=_-])(?:media|player|twitch|video|vimeo|youtube)(?=$|[./?&=_-])/i;
    const PLAYER_HINT_PATTERN =
        /(^|[\s_-])(controls?|fullscreen|jwplayer|media|player|plyr|shaka|video|vjs|ytp)(?=$|[\s_-])/i;
    const FULLSCREEN_CSS = `
        [${TARGET_ATTR}]::backdrop {
            background: #000 !important;
        }

        [${TARGET_ATTR}] video,
        video[${TARGET_ATTR}] {
            width: 100% !important;
            height: 100% !important;
            max-width: none !important;
            max-height: none !important;
            left: 0 !important;
            object-fit: contain !important;
            top: 0 !important;
        }

        :has(> video[${TARGET_ATTR}]) {
            width: 100% !important;
            height: 100% !important;
            max-width: none !important;
            max-height: none !important;
            min-width: 0 !important;
            min-height: 0 !important;
        }

        video[playsinline][webkit-playsinline]::-webkit-media-controls-fullscreen-button {
            display: none !important;
        }

        html[${ROOT_ATTR}],
        html[${ROOT_ATTR}] body {
            overflow: hidden !important;
            overscroll-behavior: none !important;
        }
    `;
    const observedRoots = new WeakSet();
    const shadowRoots = new WeakMap();
    const styleElements = new WeakMap();
    const nativeFullscreenGetters = [];

    let active = null;
    let activationGeneration = 0;
    let consumedActivationGeneration = -1;
    let convertingNativeFullscreen = false;
    let frameRequestCounter = 0;
    let lastActivationEventTime = -Infinity;
    let lastDescendantActivationId = null;
    let observer = null;
    let rapidClickFullscreenBlockUntil = 0;
    let styleObserver = null;

    try {
        Object.defineProperty(window, INSTANCE_KEY, {
            configurable: true,
            value: Object.freeze({
                blockRapidClick: (requestId) =>
                    blockRapidClickFullscreen(requestId),
                escapeFromDescendant: (childWindow, requestId) =>
                    escapeFromDescendant(childWindow, requestId),
                exit: () => exitViewportFullscreen(),
                hasVideo: () => visitVideos(document, () => true),
                recordDescendantActivation: (requestId) =>
                    recordDescendantActivation(requestId),
            }),
        });
    } catch {
        return;
    }

    function isElement(value) {
        return value && value.nodeType === Node.ELEMENT_NODE;
    }

    function isVideo(value) {
        return (
            typeof HTMLVideoElement === "function" &&
            value instanceof HTMLVideoElement
        );
    }

    function shadowRootOf(element) {
        if (!isElement(element)) return null;

        try {
            return shadowRoots.get(element) || element.shadowRoot || null;
        } catch {
            return shadowRoots.get(element) || null;
        }
    }

    function assignedElementsOf(element) {
        if (
            typeof HTMLSlotElement !== "function" ||
            !(element instanceof HTMLSlotElement)
        ) {
            return [];
        }

        try {
            return element.assignedElements({ flatten: true });
        } catch {
            return [];
        }
    }

    function visitVideos(root, callback, seenRoots = new Set()) {
        return visitElements(
            root,
            (element) => isVideo(element) && callback(element),
            seenRoots,
        );
    }

    function visitElements(root, callback, seenRoots = new Set()) {
        if (!root || seenRoots.has(root)) return false;
        seenRoots.add(root);

        if (isElement(root) && callback(root)) return true;
        for (const assigned of assignedElementsOf(root)) {
            if (visitElements(assigned, callback, seenRoots)) {
                return true;
            }
        }

        let elements;
        try {
            elements = root.querySelectorAll("*");
        } catch {
            return false;
        }

        for (const element of elements) {
            if (callback(element)) return true;

            const shadowRoot = shadowRootOf(element);
            if (shadowRoot && visitElements(shadowRoot, callback, seenRoots)) {
                return true;
            }
            for (const assigned of assignedElementsOf(element)) {
                if (visitElements(assigned, callback, seenRoots)) {
                    return true;
                }
            }
        }

        const ownShadowRoot = shadowRootOf(root);
        return Boolean(
            ownShadowRoot && visitElements(ownShadowRoot, callback, seenRoots),
        );
    }

    function frameLooksVideoRelated(value) {
        if (!isFrameElement(value)) return false;

        try {
            return Boolean(
                value.contentDocument?.querySelector("video") ||
                value.contentWindow?.[INSTANCE_KEY]?.hasVideo?.(),
            );
        } catch {}

        return FRAME_VIDEO_HINT_PATTERN.test(
            [
                value.id,
                value.getAttribute("class"),
                value.getAttribute("src"),
                value.getAttribute("title"),
            ]
                .filter(Boolean)
                .join(" "),
        );
    }

    function isVideoRelated(value) {
        if (!isElement(value)) return false;
        return visitElements(
            value,
            (element) => isVideo(element) || frameLooksVideoRelated(element),
        );
    }

    function pointIsInsideElement(element, x, y) {
        const rect = element.getBoundingClientRect();
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
        );
    }

    function hasPlayerHint(element) {
        if (!isElement(element)) return false;

        try {
            return PLAYER_HINT_PATTERN.test(
                [
                    element.id,
                    element.getAttribute("class"),
                    element.getAttribute("role"),
                    element.getAttribute("aria-label"),
                ]
                    .filter(Boolean)
                    .join(" "),
            );
        } catch {
            return false;
        }
    }

    function eventHitsVideo(event) {
        const path =
            typeof event.composedPath === "function"
                ? event.composedPath()
                : [event.target];
        if (
            path.some(
                (node) => isVideo(node) || frameLooksVideoRelated(node),
            )
        ) {
            return true;
        }

        const roots = [document];
        const seenRoots = new Set();

        while (roots.length) {
            const root = roots.pop();
            if (!root || seenRoots.has(root)) continue;
            seenRoots.add(root);

            let elements;
            try {
                elements = root.elementsFromPoint(
                    event.clientX,
                    event.clientY,
                );
            } catch {
                continue;
            }

            for (const element of elements) {
                if (isVideo(element) || frameLooksVideoRelated(element)) {
                    return true;
                }
                const shadowRoot = shadowRootOf(element);
                if (shadowRoot) roots.push(shadowRoot);
            }
        }

        const player = path.find((node) => hasPlayerHint(node));
        return Boolean(
            player &&
                visitElements(player, (element) => {
                    if (
                        !isVideo(element) &&
                        !frameLooksVideoRelated(element)
                    ) {
                        return false;
                    }
                    return pointIsInsideElement(
                        element,
                        event.clientX,
                        event.clientY,
                    );
                }),
        );
    }

    function normalizeRapidVideoClick(event) {
        if (
            !event.isTrusted ||
            event.detail < 2 ||
            !eventHitsVideo(event)
        ) {
            return;
        }

        blockRapidClickFullscreen();
        try {
            Object.defineProperty(event, "detail", {
                configurable: true,
                enumerable: false,
                value: 1,
            });
        } catch {}
    }

    function now() {
        try {
            return performance.now();
        } catch {
            return Date.now();
        }
    }

    function rapidClickBlocksFullscreen() {
        return now() < rapidClickFullscreenBlockUntil;
    }

    function blockRapidClickFullscreen(requestId = null) {
        rapidClickFullscreenBlockUntil = Math.max(
            rapidClickFullscreenBlockUntil,
            now() + 750,
        );
        if (!hasParentFrame()) return;
        requestId ||= createFrameRequestId();

        try {
            const parentInstance = window.parent[INSTANCE_KEY];
            if (typeof parentInstance?.blockRapidClick === "function") {
                parentInstance.blockRapidClick(requestId);
                return;
            }
        } catch {}
        postFrameMessage(window.parent, "block", requestId);
    }

    function propagateFrameActivation(requestId) {
        if (!hasParentFrame()) return;

        try {
            const parentInstance = window.parent[INSTANCE_KEY];
            if (
                typeof parentInstance?.recordDescendantActivation === "function"
            ) {
                parentInstance.recordDescendantActivation(requestId);
                return;
            }
        } catch {}
        postFrameMessage(window.parent, "activate", requestId);
    }

    function recordDescendantActivation(requestId) {
        if (
            typeof requestId !== "string" ||
            requestId.length < 16 ||
            requestId.length > 200 ||
            requestId === lastDescendantActivationId
        ) {
            return;
        }

        lastDescendantActivationId = requestId;
        activationGeneration += 1;
        propagateFrameActivation(requestId);
    }

    function requestAncestorEscape(requestId = createFrameRequestId()) {
        if (!hasParentFrame()) return false;

        try {
            const parentInstance = window.parent[INSTANCE_KEY];
            if (typeof parentInstance?.escapeFromDescendant === "function") {
                return Boolean(
                    parentInstance.escapeFromDescendant(window, requestId),
                );
            }
        } catch {}
        postFrameMessage(window.parent, "escape", requestId);
        return false;
    }

    function escapeFromFrame(frame, requestId) {
        if (active && composedContains(active.target, frame)) {
            exitViewportFullscreen();
            return true;
        }
        return requestAncestorEscape(requestId);
    }

    function escapeFromDescendant(childWindow, requestId) {
        const frame = findFrameElement(childWindow);
        if (!frame) return false;
        return escapeFromFrame(frame, requestId);
    }

    function blockVideoDoubleClick(event) {
        if (!event.isTrusted || !eventHitsVideo(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function recordUserActivation(event) {
        if (!event.isTrusted) return;

        if (event.type === "click") {
            if (
                event.detail !== 0 ||
                event.timeStamp - lastActivationEventTime < 1000
            ) {
                return;
            }
        }

        activationGeneration += 1;
        lastActivationEventTime = event.timeStamp;
        if (hasParentFrame()) {
            propagateFrameActivation(createFrameRequestId());
        }
    }

    function forceInlinePlayback(video) {
        if (!isVideo(video)) return;
        if (!video.hasAttribute("playsinline")) {
            video.setAttribute("playsinline", "");
        }
        if (!video.hasAttribute("webkit-playsinline")) {
            video.setAttribute("webkit-playsinline", "");
        }
        try {
            if (!video.controlsList.contains("nofullscreen")) {
                video.controlsList.add("nofullscreen");
            }
        } catch {}
    }

    function ensureInlinePlayback(root) {
        let found = false;

        visitVideos(root, (video) => {
            found = true;
            forceInlinePlayback(video);
            return false;
        });
        return found;
    }

    function observeShadowRoots(root) {
        if (!root) return;

        if (isElement(root)) {
            const ownShadowRoot = shadowRootOf(root);
            if (ownShadowRoot) observeRoot(ownShadowRoot);
        }

        let elements;
        try {
            elements = root.querySelectorAll("*");
        } catch {
            return;
        }

        for (const element of elements) {
            const shadowRoot = shadowRootOf(element);
            if (shadowRoot) observeRoot(shadowRoot);
        }
    }

    function observeRoot(root) {
        if (!observer || !root || observedRoots.has(root)) return;

        try {
            observer.observe(root, {
                attributeFilter: [
                    ROOT_ATTR,
                    TARGET_ATTR,
                    "controlslist",
                    "name",
                    "popover",
                    "playsinline",
                    "slot",
                    "webkit-playsinline",
                ],
                attributes: true,
                childList: true,
                subtree: true,
            });
        } catch {
            return;
        }
        observedRoots.add(root);

        if (ensureInlinePlayback(root)) ensureStyles(root);
        observeShadowRoots(root);
    }

    function ensureStyles(root) {
        if (!root) return;

        const existing = styleElements.get(root);
        if (
            existing &&
            (root.nodeType === Node.DOCUMENT_NODE
                ? existing.isConnected
                : existing.parentNode === root)
        ) {
            if (existing.textContent !== FULLSCREEN_CSS) {
                existing.textContent = FULLSCREEN_CSS;
            }
            return;
        }

        const style = document.createElement("style");
        style.setAttribute(STYLE_ATTR, "");
        style.textContent = FULLSCREEN_CSS;

        try {
            if (root.nodeType === Node.DOCUMENT_NODE) {
                (document.head || document.documentElement).appendChild(style);
            } else {
                root.appendChild(style);
            }
            styleElements.set(root, style);
        } catch {}
    }

    function saveAndSetStyles(element, values) {
        const saved = [];

        for (const [property, value] of Object.entries(values)) {
            const item = {
                fullscreenValue: value,
                property,
                priority: element.style.getPropertyPriority(property),
                value: element.style.getPropertyValue(property),
            };
            element.style.setProperty(property, value, "important");
            item.appliedPriority = element.style.getPropertyPriority(property);
            item.appliedValue = element.style.getPropertyValue(property);
            saved.push(item);
        }

        return saved;
    }

    function restoreStyles(element, saved) {
        for (const item of saved) {
            if (
                element.style.getPropertyValue(item.property) !==
                    item.appliedValue ||
                element.style.getPropertyPriority(item.property) !==
                    item.appliedPriority
            ) {
                continue;
            }

            if (item.value) {
                element.style.setProperty(
                    item.property,
                    item.value,
                    item.priority,
                );
            } else {
                element.style.removeProperty(item.property);
            }
        }
    }

    function maintainFullscreenStyles(state) {
        for (const item of state.targetStyles) {
            const currentValue = state.target.style.getPropertyValue(
                item.property,
            );
            const currentPriority = state.target.style.getPropertyPriority(
                item.property,
            );

            if (
                currentValue === item.appliedValue &&
                currentPriority === item.appliedPriority
            ) {
                continue;
            }

            item.value = currentValue;
            item.priority = currentPriority;
            state.target.style.setProperty(
                item.property,
                item.fullscreenValue,
                "important",
            );
            item.appliedValue = state.target.style.getPropertyValue(
                item.property,
            );
            item.appliedPriority = state.target.style.getPropertyPriority(
                item.property,
            );
        }
    }

    function observeFullscreenStyles(state) {
        styleObserver?.disconnect();
        styleObserver = new MutationObserver(() => {
            if (active === state) maintainFullscreenStyles(state);
        });

        try {
            styleObserver.observe(state.target, {
                attributeFilter: ["style"],
                attributes: true,
            });
        } catch {
            styleObserver = null;
        }
    }

    function attributeSnapshot(element, name) {
        return {
            existed: element.hasAttribute(name),
            value: element.getAttribute(name),
        };
    }

    function restoreAttribute(element, name, snapshot, expectedValue) {
        if (element.getAttribute(name) !== expectedValue) return false;

        if (snapshot.existed) {
            element.setAttribute(name, snapshot.value ?? "");
        } else {
            element.removeAttribute(name);
        }
        return true;
    }

    function composedContains(container, node) {
        let current = node;

        while (current) {
            try {
                if (current === container || container.contains(current)) {
                    return true;
                }
            } catch {}

            if (current.assignedSlot) {
                current = current.assignedSlot;
                continue;
            }
            const root = current.getRootNode?.();
            if (
                typeof ShadowRoot !== "function" ||
                !(root instanceof ShadowRoot)
            ) {
                return false;
            }
            current = root.host;
        }
        return false;
    }

    function focusedElement() {
        let element = document.activeElement;

        while (element) {
            const root = shadowRootOf(element);
            if (!root?.activeElement) break;
            element = root.activeElement;
        }
        return element;
    }

    function captureScrollPositions(target) {
        const positions = [[window, window.scrollX, window.scrollY]];
        let element = target;

        while (element) {
            if (
                element !== document.scrollingElement &&
                (element.scrollHeight > element.clientHeight ||
                    element.scrollWidth > element.clientWidth)
            ) {
                positions.push([
                    element,
                    element.scrollLeft,
                    element.scrollTop,
                ]);
            }
            element =
                element.assignedSlot ||
                element.parentElement ||
                element.getRootNode?.().host ||
                null;
        }
        return positions;
    }

    function restoreScrollPositions(positions) {
        for (const [element, left, top] of positions) {
            try {
                if (element === window) {
                    window.scrollTo({ behavior: "instant", left, top });
                } else if (element.isConnected) {
                    element.scrollLeft = left;
                    element.scrollTop = top;
                }
            } catch {}
        }
    }

    function focusFullscreenPlayer(state) {
        if (active !== state) return;

        let focusTarget = null;
        visitVideos(state.target, (video) => {
            focusTarget = video;
            return !video.paused;
        });
        if (!focusTarget) {
            visitElements(state.target, (element) => {
                if (!frameLooksVideoRelated(element)) return false;
                focusTarget = element;
                return true;
            });
        }
        try {
            (focusTarget || state.target).focus({
                preventScroll: true,
            });
        } catch {}
    }

    function restoreFullscreenFocus(state) {
        try {
            state.focusBefore?.focus?.({
                preventScroll: true,
            });
        } catch {}
    }

    function decorateFullscreenVideo(state, video) {
        if (
            !isVideo(video) ||
            video === state.target ||
            state.videoAttributes.has(video) ||
            !composedContains(state.target, video)
        ) {
            return;
        }

        state.videoAttributes.set(video, attributeSnapshot(video, TARGET_ATTR));
        video.setAttribute(TARGET_ATTR, "");

        const root = video.getRootNode?.();
        if (root) ensureStyles(root);
    }

    function decorateFullscreenVideos(state, root = state.target) {
        visitVideos(root, (video) => {
            forceInlinePlayback(video);
            decorateFullscreenVideo(state, video);
            return false;
        });
    }

    function maintainFullscreenVideos(state) {
        for (const [video, snapshot] of state.videoAttributes) {
            if (!composedContains(state.target, video)) {
                restoreAttribute(video, TARGET_ATTR, snapshot, "");
                state.videoAttributes.delete(video);
                continue;
            }
            if (video.getAttribute(TARGET_ATTR) !== "") {
                video.setAttribute(TARGET_ATTR, "");
            }
        }
    }

    function isPopoverOpen(element) {
        try {
            return element.matches(":popover-open");
        } catch {
            return false;
        }
    }

    function putInTopLayer(target) {
        if (
            typeof HTMLElement !== "function" ||
            !(target instanceof HTMLElement) ||
            typeof target.showPopover !== "function"
        ) {
            return null;
        }

        const attribute = attributeSnapshot(target, "popover");
        const wasOpen = isPopoverOpen(target);
        let opened = false;

        try {
            target.setAttribute("popover", "manual");
            if (!wasOpen) {
                target.showPopover();
                opened = isPopoverOpen(target);
            }
        } catch {}

        if (!wasOpen && !opened) {
            restoreAttribute(target, "popover", attribute, "manual");
            return null;
        }
        return { attribute, opened, wasOpen };
    }

    function restorePopover(target, popover) {
        if (!popover) return;

        try {
            if (
                popover.opened &&
                isPopoverOpen(target) &&
                target.getAttribute("popover") === "manual"
            ) {
                target.hidePopover();
            }
        } catch {}

        const restored = restoreAttribute(
            target,
            "popover",
            popover.attribute,
            "manual",
        );
        if (restored && popover.wasOpen && !isPopoverOpen(target)) {
            try {
                target.showPopover();
            } catch {}
        }
    }

    function dispatchFullscreenChange(target) {
        const options = { bubbles: true, composed: true };

        try {
            if (target.isConnected) {
                target.dispatchEvent(new Event("fullscreenchange", options));
                target.dispatchEvent(
                    new Event("webkitfullscreenchange", options),
                );
            } else {
                document.dispatchEvent(new Event("fullscreenchange", options));
                document.dispatchEvent(
                    new Event("webkitfullscreenchange", options),
                );
            }
        } catch {}
    }

    function createFrameRequestId() {
        frameRequestCounter += 1;

        try {
            return `${crypto.randomUUID()}:${frameRequestCounter}`;
        } catch {
            return `${Date.now()}:${Math.random()}:${frameRequestCounter}`;
        }
    }

    function postFrameMessage(destination, action, requestId) {
        if (!destination || !requestId) return;

        try {
            destination.postMessage(
                {
                    [FRAME_MESSAGE_KEY]: true,
                    action,
                    requestId,
                },
                "*",
            );
        } catch {}
    }

    function hasParentFrame() {
        try {
            return window.parent !== window;
        } catch {
            return true;
        }
    }

    function isFrameElement(value) {
        return (
            (typeof HTMLIFrameElement === "function" &&
                value instanceof HTMLIFrameElement) ||
            (typeof HTMLFrameElement === "function" &&
                value instanceof HTMLFrameElement)
        );
    }

    function findFrameElement(sourceWindow) {
        let match = null;

        visitElements(document, (element) => {
            if (!isFrameElement(element)) return false;

            try {
                if (element.contentWindow !== sourceWindow) return false;
            } catch {
                return false;
            }
            match = element;
            return true;
        });
        return match;
    }

    function allowAttributeEnablesFullscreen(value) {
        for (const directive of String(value || "").split(";")) {
            const tokens = directive.trim().toLowerCase().split(/\s+/);
            if (tokens[0] !== "fullscreen") continue;
            return !tokens
                .slice(1)
                .some((token) => /^['"]?none['"]?$/.test(token));
        }
        return false;
    }

    function frameCanFullscreen(frame) {
        if (!isFrameElement(frame)) return false;
        if (
            typeof HTMLFrameElement === "function" &&
            frame instanceof HTMLFrameElement
        ) {
            return true;
        }

        try {
            if (frame.allowFullscreen) return true;
            if (allowAttributeEnablesFullscreen(frame.allow)) {
                return true;
            }

            const childDocument = frame.contentDocument;
            return Boolean(
                childDocument && childDocument.fullscreenEnabled !== false,
            );
        } catch {
            return false;
        }
    }

    function frameEnterIsAuthorized(frame) {
        try {
            const root = frame.getRootNode?.() || document;
            if (root.activeElement !== frame) return false;

            if (navigator.userActivation) {
                return navigator.userActivation.isActive;
            }
            return Boolean(frame.contentDocument?.fullscreenElement);
        } catch {
            return false;
        }
    }

    function propagateFrameEnter(state) {
        if (!hasParentFrame()) return;
        postFrameMessage(window.parent, "enter", state.frameRequestId);
    }

    function observeFrameNavigation(state) {
        if (!isFrameElement(state.target)) return;

        state.frameLoadListener = () => {
            if (active === state) exitViewportFullscreen();
        };
        state.target.addEventListener("load", state.frameLoadListener, true);
    }

    function maintainActiveFullscreen(state) {
        if (active !== state || !state.target.isConnected) return;

        const currentRoot = state.target.getRootNode?.() || document;
        if (currentRoot !== state.root) {
            state.root = currentRoot;
            ensureStyles(currentRoot);
            decorateFullscreenVideos(state);
        }
        maintainFullscreenVideos(state);

        if (!state.target.hasAttribute(TARGET_ATTR)) {
            state.target.setAttribute(TARGET_ATTR, "");
        }
        if (!document.documentElement.hasAttribute(ROOT_ATTR)) {
            document.documentElement.setAttribute(ROOT_ATTR, "");
        }

        if (!state.popover) return;
        if (state.target.getAttribute("popover") !== "manual") {
            state.popover.attribute = attributeSnapshot(
                state.target,
                "popover",
            );
            state.target.setAttribute("popover", "manual");
        }
        if (isPopoverOpen(state.target)) return;

        try {
            state.target.showPopover();
        } catch {}
    }

    function observePopoverState(state) {
        if (!state.popover) return;

        state.popoverToggleListener = () => {
            queueMicrotask(() => maintainActiveFullscreen(state));
        };
        state.target.addEventListener("toggle", state.popoverToggleListener);
    }

    function handleFrameMessage(event) {
        const data = event.data;
        if (
            !data ||
            data[FRAME_MESSAGE_KEY] !== true ||
            typeof data.action !== "string" ||
            typeof data.requestId !== "string" ||
            data.requestId.length < 16 ||
            data.requestId.length > 200
        ) {
            return;
        }

        if (
            data.action === "activate" ||
            data.action === "block" ||
            data.action === "escape" ||
            data.action === "enter"
        ) {
            const frame = findFrameElement(event.source);
            if (!frame) return;
            if (data.action === "escape") {
                escapeFromFrame(frame, data.requestId);
                return;
            }
            if (!frameEnterIsAuthorized(frame)) return;
            if (data.action === "activate") {
                recordDescendantActivation(data.requestId);
                return;
            }
            if (data.action === "block") {
                blockRapidClickFullscreen(data.requestId);
                return;
            }
            if (!frameCanFullscreen(frame)) return;
            enterViewportFullscreen(frame, {
                childWindow: event.source,
                frameRequestId: data.requestId,
            });
            return;
        }

        if (
            data.action === "exit-up" &&
            active?.childWindow === event.source &&
            active.frameRequestId === data.requestId
        ) {
            exitViewportFullscreen({
                notifyChild: false,
                notifyParent: true,
            });
            return;
        }

        if (
            data.action === "exit-down" &&
            event.source === window.parent &&
            active?.frameRequestId === data.requestId
        ) {
            exitViewportFullscreen({
                notifyChild: true,
                notifyParent: false,
            });
        }
    }

    function enterViewportFullscreen(target, frameLink = null) {
        if (!isElement(target) || !target.isConnected) return false;
        if (active?.target === target) {
            if (frameLink) {
                active.childWindow = frameLink.childWindow;
                active.frameRequestId = frameLink.frameRequestId;
                propagateFrameEnter(active);
            }
            return true;
        }
        if (active) exitViewportFullscreen();

        const root = target.getRootNode?.() || document;
        const focusBefore = focusedElement();
        const scrollPositions = captureScrollPositions(target);
        ensureStyles(document);
        if (root !== document) ensureStyles(root);

        const targetAttribute = attributeSnapshot(target, TARGET_ATTR);
        const rootAttribute = attributeSnapshot(
            document.documentElement,
            ROOT_ATTR,
        );
        const targetStyles = saveAndSetStyles(target, {
            "background-color": "#000",
            border: "0",
            "border-radius": "0",
            bottom: "0",
            "box-sizing": "border-box",
            height: "100dvh",
            left: "0",
            margin: "0",
            "max-height": "none",
            "max-width": "none",
            "min-height": "0",
            "min-width": "0",
            overflow: "hidden",
            padding: "0",
            position: "fixed",
            right: "0",
            top: "0",
            transform: "none",
            width: "100vw",
            "z-index": MAX_Z_INDEX,
        });

        target.setAttribute(TARGET_ATTR, "");
        document.documentElement.setAttribute(ROOT_ATTR, "");
        const popover = putInTopLayer(target);

        const state = {
            popover,
            rootAttribute,
            root,
            target,
            targetAttribute,
            targetStyles,
            videoAttributes: new Map(),
            childWindow: frameLink?.childWindow || null,
            focusBefore,
            frameLoadListener: null,
            popoverToggleListener: null,
            scrollPositions,
            frameRequestId:
                frameLink?.frameRequestId ||
                (hasParentFrame() ? createFrameRequestId() : null),
        };
        decorateFullscreenVideos(state);
        active = state;
        observeFullscreenStyles(state);
        observeFrameNavigation(state);
        observePopoverState(state);
        propagateFrameEnter(state);

        queueMicrotask(() => {
            if (active !== state) return;
            dispatchFullscreenChange(target);
            focusFullscreenPlayer(state);
        });
        return true;
    }

    function exitViewportFullscreen({
        notifyChild = true,
        notifyParent = true,
    } = {}) {
        if (!active) return false;

        const state = active;
        active = null;
        styleObserver?.disconnect();
        styleObserver = null;
        if (state.frameLoadListener) {
            state.target.removeEventListener(
                "load",
                state.frameLoadListener,
                true,
            );
        }
        if (state.popoverToggleListener) {
            state.target.removeEventListener(
                "toggle",
                state.popoverToggleListener,
            );
        }

        restorePopover(state.target, state.popover);
        restoreStyles(state.target, state.targetStyles);
        restoreAttribute(state.target, TARGET_ATTR, state.targetAttribute, "");
        restoreAttribute(
            document.documentElement,
            ROOT_ATTR,
            state.rootAttribute,
            "",
        );
        for (const [video, snapshot] of state.videoAttributes) {
            restoreAttribute(video, TARGET_ATTR, snapshot, "");
        }

        if (notifyChild && state.childWindow) {
            postFrameMessage(
                state.childWindow,
                "exit-down",
                state.frameRequestId,
            );
        }
        if (notifyParent && state.frameRequestId && hasParentFrame()) {
            postFrameMessage(window.parent, "exit-up", state.frameRequestId);
        }

        queueMicrotask(() => {
            dispatchFullscreenChange(state.target);
            if (active) return;

            restoreFullscreenFocus(state);
            restoreScrollPositions(state.scrollPositions);
            requestAnimationFrame(() => {
                if (!active) restoreScrollPositions(state.scrollPositions);
            });
        });
        return true;
    }

    function copyFunctionShape(wrapper, original) {
        try {
            Object.defineProperty(wrapper, "name", {
                configurable: true,
                value: original.name,
            });
            Object.defineProperty(wrapper, "length", {
                configurable: true,
                value: original.length,
            });
            Object.defineProperty(wrapper, "toString", {
                configurable: true,
                value: original.toString.bind(original),
            });
        } catch {}
    }

    function patchMethod(prototype, name, makeWrapper, targetScope = null) {
        if (!prototype) return;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.value !== "function") return;

        const original = descriptor.value;
        const wrapper = targetScope
            ? exportFunction(makeWrapper(original), targetScope)
            : makeWrapper(original);
        copyFunctionShape(wrapper, original);

        try {
            Object.defineProperty(prototype, name, {
                ...descriptor,
                value: wrapper,
            });
        } catch {}
    }

    function virtualFullscreenElementFor(root) {
        let element = active?.target || null;

        while (element) {
            const elementRoot = element.getRootNode?.();
            if (elementRoot === root) return element;
            if (
                typeof ShadowRoot !== "function" ||
                !(elementRoot instanceof ShadowRoot)
            ) {
                return null;
            }
            element = elementRoot.host;
        }
        return null;
    }

    function patchFullscreenGetter(
        prototype,
        name,
        recordNative = false,
        targetScope = null,
    ) {
        if (!prototype) return;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.get !== "function") return;

        const originalGet = descriptor.get;
        if (recordNative) nativeFullscreenGetters.push(originalGet);

        const get = function () {
            const nativeValue = originalGet.call(this);
            if (nativeValue) return nativeValue;
            if (this === document) {
                return virtualFullscreenElementFor(document);
            }
            if (
                typeof ShadowRoot === "function" &&
                this instanceof ShadowRoot
            ) {
                return virtualFullscreenElementFor(this);
            }
            return null;
        };

        try {
            Object.defineProperty(prototype, name, {
                ...descriptor,
                get: targetScope ? exportFunction(get, targetScope) : get,
            });
        } catch {}
    }

    function patchFullscreenBooleanGetter(prototype, name) {
        if (!prototype) return;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.get !== "function") return;

        const originalGet = descriptor.get;
        try {
            Object.defineProperty(prototype, name, {
                ...descriptor,
                get() {
                    return Boolean(
                        originalGet.call(this) || (this === document && active),
                    );
                },
            });
        } catch {}
    }

    function patchVideoStateGetter(prototype, name, virtualValue) {
        if (!prototype) return;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.get !== "function") return;

        const originalGet = descriptor.get;
        try {
            Object.defineProperty(prototype, name, {
                ...descriptor,
                get() {
                    if (active?.target === this) {
                        return virtualValue;
                    }
                    return originalGet.call(this);
                },
            });
        } catch {}
    }

    function consumeFullscreenPermission() {
        try {
            if (rapidClickBlocksFullscreen()) return false;
            if (
                "fullscreenEnabled" in document &&
                !document.fullscreenEnabled
            ) {
                return false;
            }

            if (navigator.userActivation) {
                if (!navigator.userActivation.isActive) return false;
            } else if (activationGeneration === 0) {
                return false;
            }

            if (consumedActivationGeneration === activationGeneration) {
                return false;
            }
            consumedActivationGeneration = activationGeneration;
            return true;
        } catch {
            return false;
        }
    }

    function installFullscreenRequestPatch(
        prototype,
        name,
        targetScope = null,
    ) {
        patchMethod(
            prototype,
            name,
            (original) =>
                function () {
                    if (!isVideoRelated(this)) {
                        return original.apply(this, arguments);
                    }
                    if (!consumeFullscreenPermission()) {
                        return window.Promise.reject(
                            new window.TypeError(
                                "Fullscreen requires permission and user activation.",
                            ),
                        );
                    }
                    if (enterViewportFullscreen(this)) {
                        return window.Promise.resolve();
                    }
                    return window.Promise.reject(
                        new window.TypeError(
                            "Fullscreen target is not connected.",
                        ),
                    );
                },
            targetScope,
        );
    }

    function installFullscreenExitPatch(
        prototype,
        name,
        targetScope = null,
    ) {
        patchMethod(
            prototype,
            name,
            (original) =>
                function () {
                    if (active && this === document) {
                        exitViewportFullscreen();
                        return window.Promise.resolve();
                    }
                    return original.apply(this, arguments);
                },
            targetScope,
        );
    }

    function installVideoVoidMethodPatch(prototype, name, action) {
        patchMethod(
            prototype,
            name,
            (original) =>
                function () {
                    if (action(this, arguments)) return undefined;
                    return original.apply(this, arguments);
                },
        );
    }

    function nativeFullscreenElement() {
        for (const getter of nativeFullscreenGetters) {
            try {
                const value = getter.call(document);
                if (value) return value;
            } catch {}
        }
        return null;
    }

    function exitNativeDocumentFullscreen() {
        const methods = [
            nativeDocumentExitFullscreen,
            nativeDocumentWebkitExitFullscreen,
            nativeDocumentWebkitCancelFullScreen,
        ];

        for (const method of methods) {
            if (typeof method !== "function") continue;
            try {
                return Promise.resolve(method.call(document));
            } catch {}
        }
        return null;
    }

    function convertNativeFullscreen() {
        if (convertingNativeFullscreen) return false;

        const target = nativeFullscreenElement();
        if (!target || !isVideoRelated(target)) return false;

        const exitPromise = exitNativeDocumentFullscreen();
        if (!exitPromise) return false;

        convertingNativeFullscreen = true;
        exitPromise
            .then(() => {
                if (
                    !nativeFullscreenElement() &&
                    !rapidClickBlocksFullscreen()
                ) {
                    enterViewportFullscreen(target);
                }
            })
            .catch(() => {})
            .finally(() => {
                convertingNativeFullscreen = false;
            });
        return true;
    }

    function handleNativeFullscreenChange(event) {
        if (!event.isTrusted) return;
        if (convertingNativeFullscreen || convertNativeFullscreen()) {
            event.stopImmediatePropagation();
        }
    }

    const nativeDocumentExitFullscreen = Document.prototype.exitFullscreen;
    const nativeDocumentWebkitExitFullscreen =
        Document.prototype.webkitExitFullscreen;
    const nativeDocumentWebkitCancelFullScreen =
        Document.prototype.webkitCancelFullScreen;

    installFullscreenRequestPatch(Element.prototype, "requestFullscreen");
    installFullscreenRequestPatch(Element.prototype, "webkitRequestFullscreen");
    installFullscreenRequestPatch(Element.prototype, "webkitRequestFullScreen");
    installFullscreenExitPatch(Document.prototype, "exitFullscreen");
    installFullscreenExitPatch(Document.prototype, "webkitExitFullscreen");
    installFullscreenExitPatch(Document.prototype, "webkitCancelFullScreen");

    patchFullscreenGetter(Document.prototype, "fullscreenElement", true);
    patchFullscreenGetter(
        Document.prototype,
        "webkitFullscreenElement",
        true,
    );
    patchFullscreenGetter(
        typeof ShadowRoot === "function" ? ShadowRoot.prototype : null,
        "fullscreenElement",
    );
    patchFullscreenBooleanGetter(Document.prototype, "webkitIsFullScreen");

    if (pageWindow) {
        installFullscreenRequestPatch(
            pageWindow.Element?.prototype,
            "requestFullscreen",
            pageWindow,
        );
        installFullscreenExitPatch(
            pageWindow.Document?.prototype,
            "exitFullscreen",
            pageWindow,
        );
        patchFullscreenGetter(
            pageWindow.Document?.prototype,
            "fullscreenElement",
            false,
            pageWindow,
        );
        patchFullscreenGetter(
            pageWindow.ShadowRoot?.prototype,
            "fullscreenElement",
            false,
            pageWindow,
        );
    }

    const videoPrototype =
        typeof HTMLVideoElement === "function"
            ? HTMLVideoElement.prototype
            : null;

    patchVideoStateGetter(videoPrototype, "webkitDisplayingFullscreen", true);
    patchVideoStateGetter(
        videoPrototype,
        "webkitPresentationMode",
        "fullscreen",
    );

    for (const name of ["webkitEnterFullscreen", "webkitEnterFullScreen"]) {
        installVideoVoidMethodPatch(
            videoPrototype,
            name,
            (video) =>
                !consumeFullscreenPermission() ||
                enterViewportFullscreen(video),
        );
    }

    for (const name of ["webkitExitFullscreen", "webkitExitFullScreen"]) {
        installVideoVoidMethodPatch(
            videoPrototype,
            name,
            (video) => {
                if (active?.target !== video) return false;
                return exitViewportFullscreen();
            },
        );
    }

    patchMethod(
        videoPrototype,
        "webkitSetPresentationMode",
        (original) =>
            function (mode) {
                if (mode === "fullscreen") {
                    if (consumeFullscreenPermission()) {
                        enterViewportFullscreen(this);
                    }
                    return undefined;
                }
                if (mode === "inline" && active?.target === this) {
                    exitViewportFullscreen();
                    return undefined;
                }
                return original.apply(this, arguments);
            },
    );

    patchMethod(
        typeof HTMLMediaElement === "function"
            ? HTMLMediaElement.prototype
            : null,
        "play",
        (original) =>
            function () {
                if (isVideo(this)) forceInlinePlayback(this);
                return original.apply(this, arguments);
            },
    );

    ensureStyles(document);
    ensureInlinePlayback(document.documentElement);

    observer = new MutationObserver((records) => {
        for (const record of records) {
            const recordRoot = record.target.getRootNode?.();
            if (recordRoot && styleElements.has(recordRoot)) {
                ensureStyles(recordRoot);
            }

            if (record.type === "attributes") {
                forceInlinePlayback(record.target);
                if (active && record.attributeName === "slot") {
                    decorateFullscreenVideos(active, record.target);
                } else if (
                    active &&
                    record.attributeName === "name" &&
                    typeof HTMLSlotElement === "function" &&
                    record.target instanceof HTMLSlotElement
                ) {
                    decorateFullscreenVideos(active);
                }
                if (
                    active?.videoAttributes.has(record.target) &&
                    record.target.getAttribute(TARGET_ATTR) !== ""
                ) {
                    record.target.setAttribute(TARGET_ATTR, "");
                }
                continue;
            }
            for (const node of record.addedNodes) {
                if (ensureInlinePlayback(node) && recordRoot) {
                    ensureStyles(recordRoot);
                }
                observeShadowRoots(node);
                if (active) decorateFullscreenVideos(active, node);
            }
        }

        ensureStyles(document);
        if (active && !active.target.isConnected) {
            exitViewportFullscreen();
        } else if (active) {
            maintainActiveFullscreen(active);
        }
    });

    patchMethod(
        typeof Element === "function" ? Element.prototype : null,
        "attachShadow",
        (original) =>
            function () {
                const shadowRoot = original.apply(this, arguments);
                shadowRoots.set(this, shadowRoot);
                observeRoot(shadowRoot);
                return shadowRoot;
            },
    );

    observeRoot(document);

    if (typeof PointerEvent === "function") {
        window.addEventListener("pointerdown", recordUserActivation, {
            capture: true,
            passive: true,
        });
    } else {
        window.addEventListener("mousedown", recordUserActivation, {
            capture: true,
            passive: true,
        });
        window.addEventListener("touchstart", recordUserActivation, {
            capture: true,
            passive: true,
        });
    }
    window.addEventListener("keydown", recordUserActivation, {
        capture: true,
        passive: true,
    });
    window.addEventListener("click", recordUserActivation, {
        capture: true,
        passive: true,
    });

    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key !== "Escape") return;

            if (active) {
                event.preventDefault();
                event.stopImmediatePropagation();
                exitViewportFullscreen();
                return;
            }
            if (requestAncestorEscape()) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        },
        true,
    );

    for (const type of ["mousedown", "mouseup", "click"]) {
        window.addEventListener(type, normalizeRapidVideoClick, {
            capture: true,
            passive: true,
        });
    }
    window.addEventListener("dblclick", blockVideoDoubleClick, {
        capture: true,
        passive: false,
    });
    window.addEventListener("message", handleFrameMessage, true);

    document.addEventListener(
        "fullscreenchange",
        handleNativeFullscreenChange,
        true,
    );
    document.addEventListener(
        "webkitfullscreenchange",
        handleNativeFullscreenChange,
        true,
    );
})();
