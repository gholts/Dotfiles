// ==UserScript==
// @name         YouTube Embed New Tab Kit
// @namespace    gholts.youtube-embed.new-tab
// @version      2026.11.17.2
// @description  Open embedded YouTube videos in a new tab instead of playing inline (Alt+click plays inline).
// @author       Gholts
// @license      GNU Affero General Public License v3.0
// @homepageURL  https://github.com/Gholts/Dotfiles/tree/main/bin/userscript
// @updateURL    https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-youtube-embed-new-tab.user.js
// @downloadURL  https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-youtube-embed-new-tab.user.js
// @icon         https://www.youtube.com/s/desktop/favicon_144x144.png
// @match        *://*/*
// @run-at       document-start
// @grant        GM_openInTab
// ==/UserScript==

(() => {
    "use strict";

    function watchUrl(embedHref, currentTime = 0) {
        const embed = new URL(embedHref);
        const id = embed.pathname.split("/")[2] || "";
        const list = embed.searchParams.get("list");
        if (!/^[\w-]{11}$/.test(id) || id === "videoseries") {
            return list ? `https://www.youtube.com/playlist?list=${list}` : "";
        }
        const url = new URL(`https://www.youtube.com/watch?v=${id}`);
        if (list) url.searchParams.set("list", list);
        const t = Math.floor(currentTime) || Number(embed.searchParams.get("start"));
        if (t > 1) url.searchParams.set("t", `${t}s`);
        return url.href;
    }

    const open = (url) => url && GM_openInTab(url, { active: true, insert: true });

    const swallow = (event) => {
        if (event.altKey) return false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
    };

    const onClick = (handler) => {
        for (const type of ["click", "auxclick"]) {
            window.addEventListener(type, (event) => {
                if (event.button <= 1) handler(event);
            }, true);
        }
    };

    if (/^(?:[\w-]+\.)?youtube(?:-nocookie)?\.com$/.test(location.hostname) && location.pathname.startsWith("/embed")) {
        if (window.self === window.top) return;
        for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "dblclick"]) {
            window.addEventListener(type, swallow, true);
        }
        onClick((event) => {
            if (!swallow(event)) return;
            const video = document.querySelector("video");
            video?.pause();
            open(watchUrl(location.href, video?.currentTime));
        });
        return;
    }

    onClick((event) => {
        const facade = event.composedPath().find((el) => el.localName === "lite-youtube");
        const id = facade?.getAttribute("videoid");
        if (!id || facade.querySelector("iframe") || !swallow(event)) return;
        open(watchUrl(`https://www.youtube.com/embed/${id}?${facade.getAttribute("params") || ""}`));
    });
})();
