// ==UserScript==
// @name         YouTube Embed New Tab Kit
// @namespace    gholts.youtube-embed.new-tab
// @version      2026.11.17
// @description  Open embedded YouTube players in a new tab instead of playing inline (Alt+click plays inline).
// @author       Gholts
// @license      GNU Affero General Public License v3.0
// @homepageURL  https://github.com/Gholts/Dotfiles/tree/main/bin/userscript
// @updateURL    https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-youtube-embed-new-tab.user.js
// @downloadURL  https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/any-youtube-embed-new-tab.user.js
// @icon         https://www.youtube.com/s/desktop/favicon_144x144.png
// @match        *://*.youtube.com/embed*
// @match        *://*.youtube-nocookie.com/embed*
// @run-at       document-start
// @grant        GM_openInTab
// ==/UserScript==

(() => {
    "use strict";

    if (window.self === window.top) return;

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

    const swallow = (event) => {
        if (event.altKey) return false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
    };

    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "dblclick"]) {
        window.addEventListener(type, swallow, true);
    }
    for (const type of ["click", "auxclick"]) {
        window.addEventListener(type, (event) => {
            if (event.button > 1 || !swallow(event)) return;
            const video = document.querySelector("video");
            const url = watchUrl(location.href, video?.currentTime);
            if (!url) return;
            video?.pause();
            GM_openInTab(url, { active: true, insert: true });
        }, true);
    }
})();
