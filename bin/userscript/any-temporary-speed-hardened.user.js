// ==UserScript==
// @name         Temporary Speed Kit
// @namespace    gholts.temporary-speed.kit
// @version      2026.11.17.1
// @description  Hold a key to speed up playing videos, release to restore.
// @author       Gholts
// @license      GNU Affero General Public License v3.0
// @homepageURL  https://github.com/Gholts/Dotfiles/tree/main/bin/userscript
// @updateURL    https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-temporary-speed-hardened.user.js
// @downloadURL  https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-temporary-speed-hardened.user.js
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    const DEFAULTS = Object.freeze({
        speed: 3,
        key: "z",
        pitch: true,
        syncFix: false,
    });
    const MIN_SPEED = 0.25;
    const MAX_SPEED = 16;

    const FIELDS = {
        speed: ["target_speed", clampSpeed],
        key: ["trigger_key", normalizeKey],
        pitch: ["preserve_pitch", Boolean],
        syncFix: ["av_sync_fix", Boolean],
    };

    const originalByVideo = new Map();
    let active = false;
    let settings = loadSettings();
    let menuCommandIds = [];

    function clampSpeed(value) {
        const speed = Number.parseFloat(value);
        if (!Number.isFinite(speed)) return DEFAULTS.speed;
        return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
    }

    function normalizeKey(value) {
        const key = String(value || DEFAULTS.key)
            .trim()
            .toLowerCase();
        return key.length === 1 ? key : DEFAULTS.key;
    }

    function loadSettings() {
        const loaded = {};
        for (const [name, [store, parse]] of Object.entries(FIELDS)) {
            loaded[name] = parse(GM_getValue(store, DEFAULTS[name]));
        }
        return loaded;
    }

    function save(name, value) {
        const [store, parse] = FIELDS[name];
        settings[name] = parse(value);
        GM_setValue(store, settings[name]);
        registerMenuCommands();
    }

    function getPlayingVideos(root = document, out = new Set()) {
        if (!root || !root.querySelectorAll) return out;

        root.querySelectorAll("video").forEach((video) => {
            if (!video.paused && !video.ended) out.add(video);
        });

        root.querySelectorAll("*").forEach((element) => {
            if (element.shadowRoot) getPlayingVideos(element.shadowRoot, out);
        });

        return out;
    }

    function getPitch(video) {
        if ("preservesPitch" in video) return video.preservesPitch;
        if ("mozPreservesPitch" in video) return video.mozPreservesPitch;
        if ("webkitPreservesPitch" in video) return video.webkitPreservesPitch;
        return true;
    }

    function setVideoPitch(video, value) {
        try {
            if ("preservesPitch" in video) video.preservesPitch = value;
            else if ("mozPreservesPitch" in video)
                video.mozPreservesPitch = value;
            else if ("webkitPreservesPitch" in video)
                video.webkitPreservesPitch = value;
        } catch (_) {}
    }

    function setVideoSpeed(video, speed) {
        try {
            video.playbackRate = speed;
            return true;
        } catch (_) {
            return false;
        }
    }

    function applySpeed(video) {
        if (!originalByVideo.has(video)) {
            originalByVideo.set(video, {
                speed: video.playbackRate,
                pitch: getPitch(video),
            });
        }

        if (!setVideoSpeed(video, settings.speed)) return false;
        setVideoPitch(video, settings.pitch);
        return true;
    }

    function restoreVideo(video, original) {
        setVideoSpeed(video, original.speed);
        setVideoPitch(video, original.pitch);

        if (!settings.syncFix || !Number.isFinite(video.currentTime)) return;
        try {
            video.currentTime = video.currentTime;
        } catch (_) {}
    }

    function activateSpeed() {
        if (active) return;

        let changed = false;
        getPlayingVideos().forEach((video) => {
            changed = applySpeed(video) || changed;
        });

        if (!changed) {
            originalByVideo.clear();
            return;
        }

        active = true;
    }

    function restoreSpeed() {
        if (!active) return;

        originalByVideo.forEach((original, video) =>
            restoreVideo(video, original),
        );
        originalByVideo.clear();
        active = false;
    }

    function isEditableTarget(target) {
        if (!target || !target.tagName) return false;
        const tag = target.tagName.toUpperCase();
        return (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            Boolean(target.isContentEditable)
        );
    }

    function isTriggerKey(event) {
        return (
            typeof event.key === "string" &&
            event.key.toLowerCase() === settings.key
        );
    }

    document.addEventListener(
        "keydown",
        (event) => {
            if (
                event.repeat ||
                active ||
                event.ctrlKey ||
                event.altKey ||
                event.shiftKey ||
                event.metaKey ||
                !isTriggerKey(event) ||
                isEditableTarget(event.target)
            )
                return;
            activateSpeed();
        },
        true,
    );

    document.addEventListener(
        "keyup",
        (event) => {
            if (isTriggerKey(event)) restoreSpeed();
        },
        true,
    );

    window.addEventListener("blur", restoreSpeed);
    window.addEventListener("pagehide", restoreSpeed);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) restoreSpeed();
    });

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== "function") return;

        const canRefresh = typeof GM_unregisterMenuCommand === "function";
        if (menuCommandIds.length) {
            if (!canRefresh) return;
            for (const id of menuCommandIds) {
                try {
                    GM_unregisterMenuCommand(id);
                } catch {}
            }
            menuCommandIds = [];
        }

        const commands = [
            [
                `Set speed (${settings.speed}x)`,
                () => {
                    const value = prompt(
                        `Target speed (${MIN_SPEED}-${MAX_SPEED}):`,
                        settings.speed,
                    );
                    if (value !== null) save("speed", value);
                },
            ],
            [
                `Set trigger key (${settings.key.toUpperCase()})`,
                () => {
                    const value = prompt("Single trigger key:", settings.key);
                    if (value !== null) save("key", value);
                },
            ],
            [
                `Audio pitch = ${settings.pitch ? "on" : "off"}`,
                () => save("pitch", !settings.pitch),
            ],
            [
                `A/V sync fix = ${settings.syncFix ? "on" : "off"}`,
                () => save("syncFix", !settings.syncFix),
            ],
        ];

        for (const [label, action] of commands) {
            try {
                const id = GM_registerMenuCommand(
                    canRefresh ? label : label.replace(/ = .+$/, ""),
                    action,
                );
                menuCommandIds.push(id);
            } catch {}
        }
    }

    registerMenuCommands();
})();
