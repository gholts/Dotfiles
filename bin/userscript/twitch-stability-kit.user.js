// ==UserScript==
// @name         Twitch Stability Kit
// @namespace    gholts.twitch.stability-kit
// @version      2026.09.19.1
// @description  Ad suppression, max quality, channel points, live recovery, UI cleanup, and gentle playback keepalive for Twitch and MultiTwitch embeds.
// @author       Gholts
// @license      GNU Affero General Public License v3.0
// @homepageURL  https://github.com/Gholts/Dotfiles/tree/main/bin/userscript
// @updateURL    https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/twitch-stability-kit.user.js
// @downloadURL  https://raw.githubusercontent.com/Gholts/Dotfiles/main/bin/userscript/twitch-stability-kit.user.js
// @match        https://www.twitch.tv/*
// @match        https://twitch.tv/embed/*
// @match        https://player.twitch.tv/*
// @match        https://embed.twitch.tv/*
// @icon         https://assets.twitch.tv/assets/favicon-32-e29e246c157142c94346.png
// @run-at       document-start
// @inject-into  page
// @sandbox      raw
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

// Vendored TwitchAdSolutions VAFT 37.0.0 (internal version 24).
// Source: https://github.com/pixeltris/TwitchAdSolutions/tree/f8f86706daf90daa534b26bce5b2f01238667d5f/vaft
// License: MIT
(function() {
    'use strict';
    // Chat-only frames (including MultiTwitch) need no player or visibility hooks.
    if (/^\/embed\/[^/]+\/chat\/?$/.test(location.pathname)) return;
    const adPage = typeof unsafeWindow === 'object' ? unsafeWindow : window;
    const ourTwitchAdSolutionsVersion = 24;// Used to prevent conflicts with outdated versions of the scripts
    if (typeof adPage.twitchAdSolutionsVersion !== 'undefined' && adPage.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
        console.log("skipping vaft as there's another script active. ourVersion:" + ourTwitchAdSolutionsVersion + " activeVersion:" + adPage.twitchAdSolutionsVersion);
        adPage.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
        return;
    }
    adPage.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    function declareOptions(scope) {
        scope.AdSignifier = 'stitched';
        scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        scope.BackupPlayerTypes = [
            'embed',//Source
            'popout',//Source
            'autoplay',//360p
            //'picture-by-picture-CACHED'//360p (-CACHED is an internal suffix and is removed)
        ];
        scope.FallbackPlayerType = 'embed';
        scope.ForceAccessTokenPlayerType = 'popout';
        scope.SkipPlayerReloadOnHevc = false;// If true this will skip player reload on streams which have 2k/4k quality (if you enable this and you use the 2k/4k quality setting you'll get error #4000 / #3000 / spinning wheel on chrome based browsers)
        scope.AlwaysReloadPlayerOnAd = false;// Always pause/play when entering/leaving ads
        scope.ReloadPlayerAfterAd = true;// After the ad finishes do a player reload instead of pause/play
        scope.PlayerReloadMinimalRequestsTime = 1500;
        scope.PlayerReloadMinimalRequestsPlayerIndex = 2;//autoplay
        scope.HasTriggeredPlayerReload = false;
        scope.StreamInfos = [];
        scope.StreamInfosByUrl = [];
        scope.GQLDeviceID = null;
        scope.ClientVersion = null;
        scope.ClientSession = null;
        scope.ClientIntegrityHeader = null;
        scope.AuthorizationHeader = undefined;
        scope.SimulatedAdsDepth = 0;
        scope.PlayerBufferingFix = true;// If true this will pause/play the player when it gets stuck buffering
        scope.PlayerBufferingDelay = 600;// How often should we check the player state (in milliseconds)
        scope.PlayerBufferingSameStateCount = 3;// How many times of seeing the same player state until we trigger pause/play (it will only trigger it one time until the player state changes again)
        scope.PlayerBufferingDangerZone = 1;// The buffering time left (in seconds) when we should ignore the players playback position in the player state check
        scope.PlayerBufferingDoPlayerReload = false;// If true this will do a player reload instead of pause/play (player reloading is better at fixing the playback issues but it takes slightly longer)
        scope.PlayerBufferingMinRepeatDelay = 8000;// Minimum delay (in milliseconds) between each pause/play (this is to avoid over pressing pause/play when there are genuine buffering problems)
        scope.PlayerBufferingPrerollCheckEnabled = false;// Enable this if you're getting an immediate pause/play/reload as you open a stream (which is causing the stream to take longer to load). One problem with this being true is that it can cause the player to get stuck in some instances requiring the user to press pause/play
        scope.PlayerBufferingPrerollCheckOffset = 5;// How far the stream need to move before doing the buffering mitigation (depends on PlayerBufferingPrerollCheckEnabled being true)
        scope.V2API = false;
        scope.IsAdStrippingEnabled = true;
        scope.AdSegmentCache = new Map();
        scope.AllSegmentsAreAdSegments = false;
    }
    let isActivelyStrippingAds = false;
    let localStorageHookFailed = false;
    const twitchWorkers = [];
    const workerStringConflicts = [
        'twitch',
        'isVariantA'// TwitchNoSub
    ];
    const workerStringAllow = [];
    const workerStringReinsert = [
        'isVariantA',// TwitchNoSub (prior to (0.9))
        'besuper/',// TwitchNoSub (0.9)
        '${patch_url}'// TwitchNoSub (0.9.1)
    ];
    function getCleanWorker(worker) {
        let root = null;
        let parent = null;
        let proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringConflicts.some((x) => workerString.includes(x)) && !workerStringAllow.some((x) => workerString.includes(x))) {
                if (parent !== null) {
                    Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
                }
            } else {
                if (root === null) {
                    root = proto;
                }
                parent = proto;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return root;
    }
    function getWorkersForReinsert(worker) {
        const result = [];
        let proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringReinsert.some((x) => workerString.includes(x))) {
                result.push(proto);
            } else {
            }
            proto = Object.getPrototypeOf(proto);
        }
        return result;
    }
    function reinsertWorkers(worker, reinsert) {
        let parent = worker;
        for (let i = 0; i < reinsert.length; i++) {
            Object.setPrototypeOf(reinsert[i], parent);
            parent = reinsert[i];
        }
        return parent;
    }
    function isValidWorker(worker) {
        const workerString = worker.toString();
        return !workerStringConflicts.some((x) => workerString.includes(x))
            || workerStringAllow.some((x) => workerString.includes(x))
            || workerStringReinsert.some((x) => workerString.includes(x));
    }
    function hookWindowWorker() {
        const reinsert = getWorkersForReinsert(adPage.Worker);
        const newWorker = class Worker extends getCleanWorker(adPage.Worker) {
            constructor(twitchBlobUrl, options) {
                let isTwitchWorker = false;
                try {
                    isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv');
                } catch {}
                if (!isTwitchWorker) {
                    super(twitchBlobUrl, options);
                    return;
                }
                const newBlobStr = `
                    const pendingFetchRequests = new Map();
                    ${stripAdSegments.toString()}
                    ${getStreamUrlForResolution.toString()}
                    ${processM3U8.toString()}
                    ${hookWorkerFetch.toString()}
                    ${declareOptions.toString()}
                    ${getAccessToken.toString()}
                    ${gqlRequest.toString()}
                    ${parseAttributes.toString()}
                    ${getWasmWorkerJs.toString()}
                    ${getServerTimeFromM3u8.toString()}
                    ${replaceServerTimeInM3u8.toString()}
                    const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                    declareOptions(self);
                    GQLDeviceID = ${GQLDeviceID ? "'" + GQLDeviceID + "'" : null};
                    AuthorizationHeader = ${AuthorizationHeader ? "'" + AuthorizationHeader + "'" : undefined};
                    ClientIntegrityHeader = ${ClientIntegrityHeader ? "'" + ClientIntegrityHeader + "'" : null};
                    ClientVersion = ${ClientVersion ? "'" + ClientVersion + "'" : null};
                    ClientSession = ${ClientSession ? "'" + ClientSession + "'" : null};
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UpdateClientVersion') {
                            ClientVersion = e.data.value;
                        } else if (e.data.key == 'UpdateClientSession') {
                            ClientSession = e.data.value;
                        } else if (e.data.key == 'UpdateClientId') {
                            ClientID = e.data.value;
                        } else if (e.data.key == 'UpdateDeviceId') {
                            GQLDeviceID = e.data.value;
                        } else if (e.data.key == 'UpdateClientIntegrityHeader') {
                            ClientIntegrityHeader = e.data.value;
                        } else if (e.data.key == 'UpdateAuthorizationHeader') {
                            AuthorizationHeader = e.data.value;
                        } else if (e.data.key == 'FetchResponse') {
                            const responseData = e.data.value;
                            if (pendingFetchRequests.has(responseData.id)) {
                                const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                                pendingFetchRequests.delete(responseData.id);
                                if (responseData.error) {
                                    reject(new Error(responseData.error));
                                } else {
                                    // Create a Response object from the response data
                                    const response = new Response(responseData.body, {
                                        status: responseData.status,
                                        statusText: responseData.statusText,
                                        headers: responseData.headers
                                    });
                                    resolve(response);
                                }
                            }
                        } else if (e.data.key == 'TriggeredPlayerReload') {
                            HasTriggeredPlayerReload = true;
                        } else if (e.data.key == 'SimulateAds') {
                            SimulatedAdsDepth = e.data.value;
                            console.log('SimulatedAdsDepth: ' + SimulatedAdsDepth);
                        } else if (e.data.key == 'AllSegmentsAreAdSegments') {
                            AllSegmentsAreAdSegments = !AllSegmentsAreAdSegments;
                            console.log('AllSegmentsAreAdSegments: ' + AllSegmentsAreAdSegments);
                        }
                    });
                    hookWorkerFetch();
                    eval(workerString);
                `;
                super(URL.createObjectURL(new Blob([newBlobStr])), options);
                twitchWorkers.push(this);
                this.addEventListener('message', (e) => {
                    if (e.data.key == 'UpdateAdBlockBanner') {
                        updateAdblockBanner(e.data);
                    } else if (e.data.key == 'PauseResumePlayer') {
                        doTwitchPlayerTask(true, false);
                    } else if (e.data.key == 'ReloadPlayer') {
                        doTwitchPlayerTask(false, true);
                    }
                });
                this.addEventListener('message', async event => {
                    if (event.data.key == 'FetchRequest') {
                        const fetchRequest = event.data.value;
                        const responseData = await handleWorkerFetchRequest(fetchRequest);
                        this.postMessage({
                            key: 'FetchResponse',
                            value: responseData
                        });
                    }
                });
            }
        };
        let workerInstance = reinsertWorkers(newWorker, reinsert);
        Object.defineProperty(adPage, 'Worker', {
            get: function() {
                return workerInstance;
            },
            set: function(value) {
                if (isValidWorker(value)) {
                    workerInstance = value;
                } else {
                    console.log('Attempt to set twitch worker denied');
                }
            }
        });
    }
    function getWasmWorkerJs(twitchBlobUrl) {
        const req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.overrideMimeType("text/javascript");
        req.send();
        return req.responseText;
    }
    function hookWorkerFetch() {
        console.log('hookWorkerFetch (vaft)');
        const realFetch = fetch;
        fetch = async function(url, options) {
            if (typeof url === 'string') {
                if (AdSegmentCache.has(url)) {
                    return new Promise(function(resolve, reject) {
                        const send = function() {
                            return realFetch('data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA', options).then(function(response) {
                                resolve(response);
                            })['catch'](function(err) {
                                reject(err);
                            });
                        };
                        send();
                    });
                }
                url = url.trimEnd();
                if (url.endsWith('m3u8')) {
                    return new Promise(function(resolve, reject) {
                        const processAfter = async function(response) {
                            if (response.status === 200) {
                                resolve(new Response(await processM3U8(url, await response.text(), realFetch)));
                            } else {
                                resolve(response);
                            }
                        };
                        const send = function() {
                            return realFetch(url, options).then(function(response) {
                                processAfter(response);
                            })['catch'](function(err) {
                                reject(err);
                            });
                        };
                        send();
                    });
                } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
                    V2API = url.includes('/api/v2/');
                    const channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                    if (ForceAccessTokenPlayerType) {
                        // parent_domains is used to determine if the player is embeded and stripping it gets rid of fake ads
                        const tempUrl = new URL(url);
                        tempUrl.searchParams.delete('parent_domains');
                        url = tempUrl.toString();
                    }
                    return new Promise(function(resolve, reject) {
                        const processAfter = async function(response) {
                            if (response.status == 200) {
                                const encodingsM3u8 = await response.text();
                                const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                                let streamInfo = StreamInfos[channelName];
                                if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (await realFetch(streamInfo.EncodingsM3U8.match(/^https:.*\.m3u8$/m)[0])).status !== 200) {
                                    // The cached encodings are dead (the stream probably restarted)
                                    streamInfo = null;
                                }
                                if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                                    StreamInfos[channelName] = streamInfo = {
                                        ChannelName: channelName,
                                        IsShowingAd: false,
                                        LastPlayerReload: 0,
                                        EncodingsM3U8: encodingsM3u8,
                                        ModifiedM3U8: null,
                                        IsUsingModifiedM3U8: false,
                                        UsherParams: (new URL(url)).search,
                                        RequestedAds: new Set(),
                                        Urls: [],// xxx.m3u8 -> { Resolution: "284x160", FrameRate: 30.0 }
                                        ResolutionList: [],
                                        BackupEncodingsM3U8Cache: [],
                                        ActiveBackupPlayerType: null,
                                        IsMidroll: false,
                                        IsStrippingAdSegments: false,
                                        NumStrippedAdSegments: 0
                                    };
                                    const lines = encodingsM3u8.replaceAll('\r', '').split('\n');
                                    for (let i = 0; i < lines.length - 1; i++) {
                                        if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                                            const attributes = parseAttributes(lines[i]);
                                            const resolution = attributes['RESOLUTION'];
                                            if (resolution) {
                                                const resolutionInfo = {
                                                    Resolution: resolution,
                                                    FrameRate: attributes['FRAME-RATE'],
                                                    Codecs: attributes['CODECS'],
                                                    Url: lines[i + 1]
                                                };
                                                streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                                                streamInfo.ResolutionList.push(resolutionInfo);
                                            }
                                            StreamInfosByUrl[lines[i + 1]] = streamInfo;
                                        }
                                    }
                                    const nonHevcResolutionList = streamInfo.ResolutionList.filter((element) => element.Codecs.startsWith('avc') || element.Codecs.startsWith('av0'));
                                    if (AlwaysReloadPlayerOnAd || (nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((element) => element.Codecs.startsWith('hev') || element.Codecs.startsWith('hvc')) && !SkipPlayerReloadOnHevc)) {
                                        if (nonHevcResolutionList.length > 0) {
                                            for (let i = 0; i < lines.length - 1; i++) {
                                                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                                                    const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(':') + 1));
                                                    const codecsKey = 'CODECS';
                                                    if (resSettings[codecsKey].startsWith('hev') || resSettings[codecsKey].startsWith('hvc')) {
                                                        const oldResolution = resSettings['RESOLUTION'];
                                                        const [targetWidth, targetHeight] = oldResolution.split('x').map(Number);
                                                        const newResolutionInfo = nonHevcResolutionList.sort((a, b) => {
                                                            // TODO: Take into account 'Frame-Rate' when sorting (i.e. 1080p60 vs 1080p30)
                                                            const [streamWidthA, streamHeightA] = a.Resolution.split('x').map(Number);
                                                            const [streamWidthB, streamHeightB] = b.Resolution.split('x').map(Number);
                                                            return Math.abs((streamWidthA * streamHeightA) - (targetWidth * targetHeight)) - Math.abs((streamWidthB * streamHeightB) - (targetWidth * targetHeight));
                                                        })[0];
                                                        console.log('ModifiedM3U8 swap ' + resSettings[codecsKey] + ' to ' + newResolutionInfo.Codecs + ' oldRes:' + oldResolution + ' newRes:' + newResolutionInfo.Resolution);
                                                        lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newResolutionInfo.Codecs}"`);
                                                        lines[i + 1] = newResolutionInfo.Url + ' '.repeat(i + 1);// The stream doesn't load unless each url line is unique
                                                    }
                                                }
                                            }
                                        }
                                        if (nonHevcResolutionList.length > 0 || AlwaysReloadPlayerOnAd) {
                                            streamInfo.ModifiedM3U8 = lines.join('\n');
                                        }
                                    }
                                }
                                streamInfo.LastPlayerReload = Date.now();
                                resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                            } else {
                                resolve(response);
                            }
                        };
                        const send = function() {
                            return realFetch(url, options).then(function(response) {
                                processAfter(response);
                            })['catch'](function(err) {
                                reject(err);
                            });
                        };
                        send();
                    });
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    function getServerTimeFromM3u8(encodingsM3u8) {
        if (V2API) {
            const matches = encodingsM3u8.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
            return matches.length > 1 ? matches[1] : null;
        }
        const matches = encodingsM3u8.match('SERVER-TIME="([0-9.]+)"');
        return matches.length > 1 ? matches[1] : null;
    }
    function replaceServerTimeInM3u8(encodingsM3u8, newServerTime) {
        if (V2API) {
            return newServerTime ? encodingsM3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${newServerTime}$2`) : encodingsM3u8;
        }
        return newServerTime ? encodingsM3u8.replace(new RegExp('(SERVER-TIME=")[0-9.]+"'), `SERVER-TIME="${newServerTime}"`) : encodingsM3u8;
    }
    function stripAdSegments(textStr, stripAllSegments, streamInfo) {
        let hasStrippedAdSegments = false;
        const lines = textStr.replaceAll('\r', '').split('\n');
        const newAdUrl = 'https://twitch.tv';
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            // Remove tracking urls which appear in the overlay UI
            line = line
                .replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
                .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
            if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!line.includes(',live') || stripAllSegments || AllSegmentsAreAdSegments)) {
                const segmentUrl = lines[i + 1];
                if (!AdSegmentCache.has(segmentUrl)) {
                    streamInfo.NumStrippedAdSegments++;
                }
                AdSegmentCache.set(segmentUrl, Date.now());
                hasStrippedAdSegments = true;
            }
            if (line.includes(AdSignifier)) {
                hasStrippedAdSegments = true;
            }
        }
        if (hasStrippedAdSegments) {
            for (let i = 0; i < lines.length; i++) {
                // No low latency during ads (otherwise it's possible for the player to prefetch and display ad segments)
                if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:')) {
                    lines[i] = '';
                }
            }
        } else {
            streamInfo.NumStrippedAdSegments = 0;
        }
        streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
        AdSegmentCache.forEach((value, key, map) => {
            if (value < Date.now() - 120000) {
                map.delete(key);
            }
        });
        return lines.join('\n');
    }
    function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
        const encodingsLines = encodingsM3u8.replaceAll('\r', '').split('\n');
        const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
        let matchedResolutionUrl = null;
        let matchedFrameRate = false;
        let closestResolutionUrl = null;
        let closestResolutionDifference = Infinity;
        for (let i = 0; i < encodingsLines.length - 1; i++) {
            if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && encodingsLines[i + 1].includes('.m3u8')) {
                const attributes = parseAttributes(encodingsLines[i]);
                const resolution = attributes['RESOLUTION'];
                const frameRate = attributes['FRAME-RATE'];
                if (resolution) {
                    if (resolution == resolutionInfo.Resolution && (!matchedResolutionUrl || (!matchedFrameRate && frameRate == resolutionInfo.FrameRate))) {
                        matchedResolutionUrl = encodingsLines[i + 1];
                        matchedFrameRate = frameRate == resolutionInfo.FrameRate;
                        if (matchedFrameRate) {
                            return matchedResolutionUrl;
                        }
                    }
                    const [width, height] = resolution.split('x').map(Number);
                    const difference = Math.abs((width * height) - (targetWidth * targetHeight));
                    if (difference < closestResolutionDifference) {
                        closestResolutionUrl = encodingsLines[i + 1];
                        closestResolutionDifference = difference;
                    }
                }
            }
        }
        return closestResolutionUrl;
    }
    async function processM3U8(url, textStr, realFetch) {
        const streamInfo = StreamInfosByUrl[url];
        if (!streamInfo) {
            return textStr;
        }
        if (HasTriggeredPlayerReload) {
            HasTriggeredPlayerReload = false;
            streamInfo.LastPlayerReload = Date.now();
        }
        const haveAdTags = textStr.includes(AdSignifier) || SimulatedAdsDepth > 0;
        if (haveAdTags) {
            streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
            if (!streamInfo.IsShowingAd) {
                streamInfo.IsShowingAd = true;
                postMessage({
                    key: 'UpdateAdBlockBanner',
                    isMidroll: streamInfo.IsMidroll,
                    hasAds: streamInfo.IsShowingAd,
                    isStrippingAdSegments: false
                });
            }
            if (!streamInfo.IsMidroll) {
                const lines = textStr.replaceAll('\r', '').split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith('#EXTINF') && lines.length > i + 1) {
                        if (!line.includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
                            // Only request one .ts file per .m3u8 request to avoid making too many requests
                            //console.log('Fetch ad .ts file');
                            streamInfo.RequestedAds.add(lines[i + 1]);
                            fetch(lines[i + 1]).then((response)=>{response.blob()});
                            break;
                        }
                    }
                }
            }
            const currentResolution = streamInfo.Urls[url];
            if (!currentResolution) {
                console.log('Ads will leak due to missing resolution info for ' + url);
                return textStr;
            }
            const isHevc = currentResolution.Codecs.startsWith('hev') || currentResolution.Codecs.startsWith('hvc');
            if (((isHevc && !SkipPlayerReloadOnHevc) || AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8) {
                streamInfo.IsUsingModifiedM3U8 = true;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({
                    key: 'ReloadPlayer'
                });
            }
            let backupPlayerType = null;
            let backupM3u8 = null;
            let fallbackM3u8 = null;
            let startIndex = 0;
            let isDoingMinimalRequests = false;
            if (streamInfo.LastPlayerReload > Date.now() - PlayerReloadMinimalRequestsTime) {
                // When doing player reload there are a lot of requests which causes the backup stream to load in slow. Briefly prefer using a single version to prevent long delays
                startIndex = PlayerReloadMinimalRequestsPlayerIndex;
                isDoingMinimalRequests = true;
            }
            for (let playerTypeIndex = startIndex; !backupM3u8 && playerTypeIndex < BackupPlayerTypes.length; playerTypeIndex++) {
                const playerType = BackupPlayerTypes[playerTypeIndex];
                const realPlayerType = playerType.replace('-CACHED', '');
                const isFullyCachedPlayerType = playerType != realPlayerType;
                for (let i = 0; i < 2; i++) {
                    // This caches the m3u8 if it doesn't have ads. If the already existing cache has ads it fetches a new version (second loop)
                    let isFreshM3u8 = false;
                    let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
                    if (!encodingsM3u8) {
                        isFreshM3u8 = true;
                        try {
                            const accessTokenResponse = await getAccessToken(streamInfo.ChannelName, realPlayerType);
                            if (accessTokenResponse.status === 200) {
                                const accessToken = await accessTokenResponse.json();
                                const urlInfo = new URL('https://usher.ttvnw.net/api/' + (V2API ? 'v2/' : '') + 'channel/hls/' + streamInfo.ChannelName + '.m3u8' + streamInfo.UsherParams);
                                urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                                urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                                const encodingsM3u8Response = await realFetch(urlInfo.href);
                                if (encodingsM3u8Response.status === 200) {
                                    encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] = await encodingsM3u8Response.text();
                                }
                            }
                        } catch (err) {}
                    }
                    if (encodingsM3u8) {
                        try {
                            const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
                            const streamM3u8Response = await realFetch(streamM3u8Url);
                            if (streamM3u8Response.status == 200) {
                                const m3u8Text = await streamM3u8Response.text();
                                if (m3u8Text) {
                                    if (playerType == FallbackPlayerType) {
                                        fallbackM3u8 = m3u8Text;
                                    }
                                    if ((!m3u8Text.includes(AdSignifier) && (SimulatedAdsDepth == 0 || playerTypeIndex >= SimulatedAdsDepth - 1)) || (!fallbackM3u8 && playerTypeIndex >= BackupPlayerTypes.length - 1)) {
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                    if (isFullyCachedPlayerType) {
                                        break;
                                    }
                                    if (isDoingMinimalRequests) {
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                }
                            }
                        } catch (err) {}
                    }
                    streamInfo.BackupEncodingsM3U8Cache[playerType] = null;
                    if (isFreshM3u8) {
                        break;
                    }
                }
            }
            if (!backupM3u8 && fallbackM3u8) {
                backupPlayerType = FallbackPlayerType;
                backupM3u8 = fallbackM3u8;
            }
            if (backupM3u8) {
                textStr = backupM3u8;
                if (streamInfo.ActiveBackupPlayerType != backupPlayerType) {
                    streamInfo.ActiveBackupPlayerType = backupPlayerType;
                    console.log(`Blocking${(streamInfo.IsMidroll ? ' midroll ' : ' ')}ads (${backupPlayerType})`);
                }
            }
            // TODO: Improve hevc stripping. It should always strip when there is a codec mismatch (both ways)
            const stripHevc = isHevc && streamInfo.ModifiedM3U8;
            if (IsAdStrippingEnabled || stripHevc) {
                textStr = stripAdSegments(textStr, stripHevc, streamInfo);
            }
        } else if (streamInfo.IsShowingAd) {
            console.log('Finished blocking ads');
            streamInfo.IsShowingAd = false;
            streamInfo.IsStrippingAdSegments = false;
            streamInfo.NumStrippedAdSegments = 0;
            streamInfo.ActiveBackupPlayerType = null;
            if (streamInfo.IsUsingModifiedM3U8 || ReloadPlayerAfterAd) {
                streamInfo.IsUsingModifiedM3U8 = false;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({
                    key: 'ReloadPlayer'
                });
            } else {
                postMessage({
                    key: 'PauseResumePlayer'
                });
            }
        }
        postMessage({
            key: 'UpdateAdBlockBanner',
            isMidroll: streamInfo.IsMidroll,
            hasAds: streamInfo.IsShowingAd,
            isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
            numStrippedAdSegments: streamInfo.NumStrippedAdSegments
        });
        return textStr;
    }
    function parseAttributes(str) {
        return Object.fromEntries(
            str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
            .filter(Boolean)
            .map(x => {
                const idx = x.indexOf('=');
                const key = x.substring(0, idx);
                const value = x.substring(idx + 1);
                const num = Number(value);
                return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num];
            }));
    }
    function getAccessToken(channelName, playerType) {
        const body = {
            operationName: 'PlaybackAccessToken',
            variables: {
                isLive: true,
                login: channelName,
                isVod: false,
                vodID: "",
                playerType: playerType,
                platform: playerType == 'autoplay' ? 'android' : 'web'
            },
            extensions: {
                persistedQuery: {
                    version:1,
                    sha256Hash:"ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
                }
            }
        };
        return gqlRequest(body, playerType);
    }
    function gqlRequest(body, playerType) {
        if (!GQLDeviceID) {
            GQLDeviceID = '';
            const dcharacters = 'abcdefghijklmnopqrstuvwxyz0123456789';
            const dcharactersLength = dcharacters.length;
            for (let i = 0; i < 32; i++) {
                GQLDeviceID += dcharacters.charAt(Math.floor(Math.random() * dcharactersLength));
            }
        }
        let headers = {
            'Client-ID': ClientID,
            'X-Device-Id': GQLDeviceID,
            'Authorization': AuthorizationHeader,
            ...(ClientIntegrityHeader && {'Client-Integrity': ClientIntegrityHeader}),
            ...(ClientVersion && {'Client-Version': ClientVersion}),
            ...(ClientSession && {'Client-Session-Id': ClientSession})
        };
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            const fetchRequest = {
                id: requestId,
                url: 'https://gql.twitch.tv/gql',
                options: {
                    method: 'POST',
                    body: JSON.stringify(body),
                    headers
                }
            };
            pendingFetchRequests.set(requestId, {
                resolve,
                reject
            });
            postMessage({
                key: 'FetchRequest',
                value: fetchRequest
            });
        });
    }
    let playerForMonitoringBuffering = null;
    const playerBufferState = {
        channelName: null,
        hasStreamStarted: false,
        position: 0,
        bufferedPosition: 0,
        bufferDuration: 0,
        numSame: 0,
        lastFixTime: 0,
        isLive: true
    };
    function monitorPlayerBuffering() {
        if (playerForMonitoringBuffering) {
            try {
                const player = playerForMonitoringBuffering.player;
                const state = playerForMonitoringBuffering.state;
                if (!player.core) {
                    playerForMonitoringBuffering = null;
                } else if (state.props?.content?.type === 'live' && !player.isPaused() && !player.getHTMLVideoElement()?.ended && playerBufferState.lastFixTime <= Date.now() - PlayerBufferingMinRepeatDelay && !isActivelyStrippingAds) {
                    const m3u8Url = player.core?.state?.path;
                    if (m3u8Url) {
                      const fileName = new URL(m3u8Url).pathname.split('/').pop();
                      if (fileName?.endsWith('.m3u8')) {
                          const channelName = fileName.slice(0, -5);
                          if (playerBufferState.channelName != channelName) {
                              playerBufferState.channelName = channelName;
                              playerBufferState.hasStreamStarted = false;
                              playerBufferState.numSame = 0;
                              //console.log('Channel changed to ' + channelName);
                          }
                      }
                    }
                    if (player.getState() === 'Playing') {
                        playerBufferState.hasStreamStarted = true;
                    }
                    const position = player.core?.state?.position;
                    const bufferedPosition = player.core?.state?.bufferedPosition;
                    const bufferDuration = player.getBufferDuration();
                    if (position !== undefined && bufferedPosition !== undefined) {
                        //console.log('position:' + position + ' bufferDuration:' + bufferDuration + ' bufferPosition:' + bufferedPosition + ' state: ' + player.core?.state?.state + ' started: ' + playerBufferState.hasStreamStarted);
                        // NOTE: This could be improved. It currently lets the player fully eat the full buffer before it triggers pause/play
                        if (playerBufferState.hasStreamStarted &&
                            (!PlayerBufferingPrerollCheckEnabled || position > PlayerBufferingPrerollCheckOffset) &&
                            (playerBufferState.position == position || bufferDuration < PlayerBufferingDangerZone)  &&
                            playerBufferState.bufferedPosition == bufferedPosition &&
                            playerBufferState.bufferDuration >= bufferDuration &&
                            (position != 0 || bufferedPosition != 0 || bufferDuration != 0)
                        ) {
                            playerBufferState.numSame++;
                            if (playerBufferState.numSame == PlayerBufferingSameStateCount) {
                                console.log('Attempt to fix buffering position:' + playerBufferState.position + ' bufferedPosition:' + playerBufferState.bufferedPosition + ' bufferDuration:' + playerBufferState.bufferDuration);
                                const isPausePlay = !PlayerBufferingDoPlayerReload;
                                const isReload = PlayerBufferingDoPlayerReload;
                                doTwitchPlayerTask(isPausePlay, isReload);
                                playerBufferState.lastFixTime = Date.now();
                                playerBufferState.numSame = 0;
                            }
                        } else {
                            playerBufferState.numSame = 0;
                        }
                        playerBufferState.position = position;
                        playerBufferState.bufferedPosition = bufferedPosition;
                        playerBufferState.bufferDuration = bufferDuration;
                    } else {
                        playerBufferState.numSame = 0;
                    }
                }
            } catch (err) {
                console.error('error when monitoring player for buffering: ' + err);
                playerForMonitoringBuffering = null;
            }
        }
        if (!playerForMonitoringBuffering) {
            const playerAndState = getPlayerAndState();
            if (playerAndState && playerAndState.player && playerAndState.state) {
                playerForMonitoringBuffering = {
                    player: playerAndState.player,
                    state: playerAndState.state
                };
            }
        }
        const isLive = playerForMonitoringBuffering?.state?.props?.content?.type === 'live';
        if (playerBufferState.isLive && !isLive) {
            updateAdblockBanner({
                hasAds: false
            });
        }
        playerBufferState.isLive = isLive;
        setTimeout(monitorPlayerBuffering, PlayerBufferingDelay);
    }
    function updateAdblockBanner(data) {
        const playerRootDiv = document.querySelector('.video-player');
        if (playerRootDiv != null) {
            let adBlockDiv = null;
            adBlockDiv = playerRootDiv.querySelector('.adblock-overlay');
            if (adBlockDiv == null) {
                adBlockDiv = document.createElement('div');
                adBlockDiv.className = 'adblock-overlay';
                adBlockDiv.innerHTML = '<div class="player-adblock-notice" style="color: white; background-color: rgba(0, 0, 0, 0.8); position: absolute; top: 0px; left: 0px; padding: 5px;"><p></p></div>';
                adBlockDiv.style.display = 'none';
                adBlockDiv.P = adBlockDiv.querySelector('p');
                playerRootDiv.appendChild(adBlockDiv);
            }
            if (adBlockDiv != null) {
                isActivelyStrippingAds = data.isStrippingAdSegments;
                adBlockDiv.P.textContent = 'Blocking' + (data.isMidroll ? ' midroll' : '') + ' ads' + (data.isStrippingAdSegments ? ' (stripping)' : '');// + (data.numStrippedAdSegments > 0 ? ` (${data.numStrippedAdSegments})` : '');
                adBlockDiv.style.display = data.hasAds && playerBufferState.isLive ? 'block' : 'none';
            }
        }
    }
    function getPlayerAndState() {
        function findReactNode(root, constraint) {
            if (root.stateNode && constraint(root.stateNode)) {
                return root.stateNode;
            }
            let node = root.child;
            while (node) {
                const result = findReactNode(node, constraint);
                if (result) {
                    return result;
                }
                node = node.sibling;
            }
            return null;
        }
        function findReactRootNode() {
            let reactRootNode = null;
            const rootNode = document.querySelector('#root');
            if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
                reactRootNode = rootNode._reactRootContainer._internalRoot.current;
            }
            if (reactRootNode == null && rootNode != null) {
                const containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
                if (containerName != null) {
                    reactRootNode = rootNode[containerName];
                }
            }
            return reactRootNode;
        }
        const reactRootNode = findReactRootNode();
        if (!reactRootNode) {
            return null;
        }
        let player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
        player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
        if (player?.playerInstance) {
            player = player.playerInstance;
        }
        const playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
        return  {
            player: player,
            state: playerState
        };
    }
    function doTwitchPlayerTask(isPausePlay, isReload) {
        const playerAndState = getPlayerAndState();
        if (!playerAndState) {
            console.log('Could not find react root');
            return;
        }
        const player = playerAndState.player;
        const playerState = playerAndState.state;
        if (!player) {
            console.log('Could not find player');
            return;
        }
        if (!playerState) {
            console.log('Could not find player state');
            return;
        }
        if (player.isPaused() || player.core?.paused) {
            return;
        }
        playerBufferState.lastFixTime = Date.now();
        playerBufferState.numSame = 0;
        if (isPausePlay) {
            player.pause();
            player.play();
            return;
        }
        if (isReload) {
            const lsKeyQuality = 'video-quality';
            const lsKeyMuted = 'video-muted';
            const lsKeyVolume = 'volume';
            let currentQualityLS = null;
            let currentMutedLS = null;
            let currentVolumeLS = null;
            try {
                currentQualityLS = localStorage.getItem(lsKeyQuality);
                currentMutedLS = localStorage.getItem(lsKeyMuted);
                currentVolumeLS = localStorage.getItem(lsKeyVolume);
                if (localStorageHookFailed && player?.core?.state) {
                    localStorage.setItem(lsKeyMuted, JSON.stringify({default:player.core.state.muted}));
                    localStorage.setItem(lsKeyVolume, player.core.state.volume);
                }
                if (localStorageHookFailed && player?.core?.state?.quality?.group) {
                    localStorage.setItem(lsKeyQuality, JSON.stringify({default:player.core.state.quality.group}));
                }
            } catch {}
            console.log('Reloading Twitch player');
            playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
            postTwitchWorkerMessage('TriggeredPlayerReload');
            player.play();
            if (localStorageHookFailed && (currentQualityLS || currentMutedLS || currentVolumeLS)) {
                setTimeout(() => {
                    try {
                        if (currentQualityLS) {
                            localStorage.setItem(lsKeyQuality, currentQualityLS);
                        }
                        if (currentMutedLS) {
                            localStorage.setItem(lsKeyMuted, currentMutedLS);
                        }
                        if (currentVolumeLS) {
                            localStorage.setItem(lsKeyVolume, currentVolumeLS);
                        }
                    } catch {}
                }, 3000);
            }
            return;
        }
    }
    adPage.reloadTwitchPlayer = () => {
        doTwitchPlayerTask(false, true);
    };
    function postTwitchWorkerMessage(key, value) {
        twitchWorkers.forEach((worker) => {
            worker.postMessage({key: key, value: value});
        });
    }
    async function handleWorkerFetchRequest(fetchRequest) {
        try {
            const response = await adPage.realFetch(fetchRequest.url, fetchRequest.options);
            const responseBody = await response.text();
            const responseObject = {
                id: fetchRequest.id,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: responseBody
            };
            return responseObject;
        } catch (error) {
            return {
                id: fetchRequest.id,
                error: error.message
            };
        }
    }
    function hookFetch() {
        const realFetch = adPage.fetch;
        adPage.realFetch = realFetch;
        adPage.fetch = function(url, init, ...args) {
            if (typeof url === 'string') {
                if (url.includes('gql')) {
                    let deviceId = init.headers['X-Device-Id'];
                    if (typeof deviceId !== 'string') {
                        deviceId = init.headers['Device-ID'];
                    }
                    if (typeof deviceId === 'string' && GQLDeviceID != deviceId) {
                        GQLDeviceID = deviceId;
                        postTwitchWorkerMessage('UpdateDeviceId', GQLDeviceID);
                    }
                    if (typeof init.headers['Client-Version'] === 'string' && init.headers['Client-Version'] !== ClientVersion) {
                        postTwitchWorkerMessage('UpdateClientVersion', ClientVersion = init.headers['Client-Version']);
                    }
                    if (typeof init.headers['Client-Session-Id'] === 'string' && init.headers['Client-Session-Id'] !== ClientSession) {
                        postTwitchWorkerMessage('UpdateClientSession', ClientSession = init.headers['Client-Session-Id']);
                    }
                    if (typeof init.headers['Client-Integrity'] === 'string' && init.headers['Client-Integrity'] !== ClientIntegrityHeader) {
                        postTwitchWorkerMessage('UpdateClientIntegrityHeader', ClientIntegrityHeader = init.headers['Client-Integrity']);
                    }
                    if (typeof init.headers['Authorization'] === 'string' && init.headers['Authorization'] !== AuthorizationHeader) {
                        postTwitchWorkerMessage('UpdateAuthorizationHeader', AuthorizationHeader = init.headers['Authorization']);
                    }
                    // Get rid of mini player above chat - TODO: Reject this locally instead of having server reject it
                    if (init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && init.body.includes('picture-by-picture')) {
                        init.body = '';
                    }
                    if (ForceAccessTokenPlayerType && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                        let replacedPlayerType = '';
                        const newBody = JSON.parse(init.body);
                        if (Array.isArray(newBody)) {
                            for (let i = 0; i < newBody.length; i++) {
                                if (newBody[i]?.variables?.playerType && newBody[i]?.variables?.playerType !== ForceAccessTokenPlayerType) {
                                    replacedPlayerType = newBody[i].variables.playerType;
                                    newBody[i].variables.playerType = ForceAccessTokenPlayerType;
                                }
                            }
                        } else {
                            if (newBody?.variables?.playerType && newBody?.variables?.playerType !== ForceAccessTokenPlayerType) {
                                replacedPlayerType = newBody.variables.playerType;
                                newBody.variables.playerType = ForceAccessTokenPlayerType;
                            }
                        }
                        if (replacedPlayerType) {
                            console.log(`Replaced '${replacedPlayerType}' player type with '${ForceAccessTokenPlayerType}' player type`);
                            init.body = JSON.stringify(newBody);
                        }
                    }
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    function onContentLoaded() {
        // This stops Twitch from pausing the player when in another tab and an ad shows.
        // Taken from https://github.com/saucettv/VideoAdBlockForTwitch/blob/cefce9d2b565769c77e3666ac8234c3acfe20d83/chrome/content.js#L30
        try {
            Object.defineProperty(document, 'visibilityState', {
                get() {
                    return 'visible';
                }
            });
        }catch{}
        let hidden = document.__lookupGetter__('hidden');
        let webkitHidden = document.__lookupGetter__('webkitHidden');
        try {
            Object.defineProperty(document, 'hidden', {
                get() {
                    return false;
                }
            });
        }catch{}
        const block = e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        let wasVideoPlaying = true;
        const visibilityChange = e => {
            const isChrome = typeof chrome !== 'undefined';
            const videos = document.getElementsByTagName('video');
            if (videos.length > 0) {
                if (hidden.apply(document) === true || (webkitHidden && webkitHidden.apply(document) === true)) {
                    wasVideoPlaying = !videos[0].paused && !videos[0].ended;
                } else {
                    if (!playerBufferState.hasStreamStarted) {
                        //console.log('Tab focused. Stream should be active');
                        playerBufferState.hasStreamStarted = true;
                    }
                    if (isChrome && wasVideoPlaying && !videos[0].ended && videos[0].paused && videos[0].muted) {
                        videos[0].play();
                    }
                }
            }
            block(e);
        };
        document.addEventListener('visibilitychange', visibilityChange, true);
        document.addEventListener('webkitvisibilitychange', visibilityChange, true);
        document.addEventListener('mozvisibilitychange', visibilityChange, true);
        document.addEventListener('hasFocus', block, true);
        try {
            if (/Firefox/.test(navigator.userAgent)) {
                Object.defineProperty(document, 'mozHidden', {
                    get() {
                        return false;
                    }
                });
            } else {
                Object.defineProperty(document, 'webkitHidden', {
                    get() {
                        return false;
                    }
                });
            }
        }catch{}
        // Hooks for preserving volume / resolution
        try {
            const keysToCache = [
                'video-quality',
                'video-muted',
                'volume',
                'lowLatencyModeEnabled',// Low Latency
                'persistenceEnabled',// Mini Player
            ];
            const cachedValues = new Map();
            for (let i = 0; i < keysToCache.length; i++) {
                cachedValues.set(keysToCache[i], localStorage.getItem(keysToCache[i]));
            }
            const realSetItem = localStorage.setItem;
            localStorage.setItem = function(key, value) {
                if (cachedValues.has(key)) {
                    cachedValues.set(key, value);
                }
                realSetItem.apply(this, arguments);
            };
            const realGetItem = localStorage.getItem;
            localStorage.getItem = function(key) {
                if (cachedValues.has(key)) {
                    return cachedValues.get(key);
                }
                return realGetItem.apply(this, arguments);
            };
            if (!localStorage.getItem.toString().includes(Object.keys({cachedValues})[0])) {
                // These hooks are useful to preserve player state on player reload
                // Firefox doesn't allow hooking of localStorage functions but chrome does
                localStorageHookFailed = true;
            }
        } catch (err) {
            console.log('localStorageHooks failed ' + err)
            localStorageHookFailed = true;
        }
    }
    declareOptions(adPage);
    hookWindowWorker();
    hookFetch();
    if (PlayerBufferingFix) {
        monitorPlayerBuffering();
    }
    if (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive") {
        onContentLoaded();
    } else {
        adPage.addEventListener("DOMContentLoaded", function() {
            onContentLoaded();
        });
    }
    adPage.simulateAds = (depth) => {
        if (depth === undefined || depth < 0) {
            console.log('Ad depth paramter required (0 = no simulated ad, 1+ = use backup player for given depth)');
            return;
        }
        postTwitchWorkerMessage('SimulateAds', depth);
    };
    adPage.allSegmentsAreAdSegments = () => {
        postTwitchWorkerMessage('AllSegmentsAreAdSegments');
    };
})();

(() => {
    "use strict";

    const VERSION = "2026.09.19.1";

    const DEFAULTS = Object.freeze({
        maxQuality: true,
        autoClaimPoints: true,
        autoBackToLive: true,
        autoStartWatching: true,
        cleanUi: true,
        keepPlaying: true,
        wakeLock: false,
        debug: false,
        qualityBurstMs: 10000,
        qualityStepMs: 500,
        domCooldownMs: 250,
        claimCooldownMs: 3500,
        liveCooldownMs: 2500,
        gateCooldownMs: 3000,
        manualPauseWindowMs: 1500,
        pipKeepaliveMs: 12000,
        qualityStallWindowMs: 60000,
        qualityStallLimit: 3,
        qualitySuspendMs: 60000,
        pipMountDelayMs: 1500,
    });

    const TOGGLES = Object.freeze([
        ["maxQuality", "Max quality"],
        ["autoClaimPoints", "Claim points"],
        ["autoBackToLive", "Back to live"],
        ["autoStartWatching", "Start watching"],
        ["cleanUi", "Clean UI"],
        ["keepPlaying", "Keep playing"],
        ["wakeLock", "Wake lock"],
        ["debug", "Debug logs"],
    ]);
    const STORE_PREFIX = "twitchStabilityKit.";
    const CONFIG = { ...DEFAULTS };

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

    const host = location.hostname;
    const path = location.pathname || "";
    // frameElement is null for cross-origin frames, too.
    const isFrame = window.self !== window.top;
    const isChatEmbed = /^\/embed\/[^/]+\/chat\/?$/.test(path);
    const isEmbed =
        host === "player.twitch.tv" ||
        host === "embed.twitch.tv" ||
        path.startsWith("/embed/");
    if (isFrame && !isEmbed) return;

    const isDocumentHidden = document.__lookupGetter__("hidden").bind(document);

    const pageGlobal =
        typeof unsafeWindow === "object" && unsafeWindow
            ? unsafeWindow
            : window;
    const RUNTIME_KEY = "__twitchStabilityKitRuntime";
    try {
        if (pageGlobal[RUNTIME_KEY]) return;
        Object.defineProperty(pageGlobal, RUNTIME_KEY, {
            value: Object.freeze({ version: VERSION }),
            configurable: true,
        });
    } catch {
        if (document.documentElement?.dataset.twitchStabilityKit) return;
    }

    const markRuntime = () => {
        if (document.documentElement)
            document.documentElement.dataset.twitchStabilityKit = VERSION;
    };
    markRuntime();
    const CHAT_MUTATION_SELECTOR =
        '.chat-room, .chat-list, [data-a-target="chat-container"], [data-test-selector="chat-scrollable-area__message-container"]';

    const log = (...args) => {
        if (CONFIG.debug) console.debug("[TwitchKit]", ...args);
    };

    const isVisible = (el) => {
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
    };

    const onceBody = (fn) => {
        let done = false;
        let mo = null;
        const run = () => {
            if (done || !document.body) return;
            done = true;
            mo?.disconnect();
            fn();
        };
        if (document.body) {
            run();
            return;
        }
        document.addEventListener("DOMContentLoaded", run, { once: true });
        if (document.documentElement) {
            mo = new MutationObserver(run);
            mo.observe(document.documentElement, { childList: true });
        }
    };

    const PLAYER_ROOT_SELECTOR =
        '[data-a-target="video-player"], [data-a-target="player-container"], .video-player';
    let lastMainVideo = null;

    function getPlayerRoot() {
        if (isChatEmbed) return null;
        const root = document.querySelector(PLAYER_ROOT_SELECTOR);
        if (root) return root;
        return isEmbed ? document.body : null;
    }

    function getMainVideo() {
        const root = getPlayerRoot();
        const pipVideo = document.pictureInPictureElement;
        if (pipVideo?.tagName === "VIDEO" && pipVideo.isConnected) {
            lastMainVideo = pipVideo;
            return pipVideo;
        }
        if (!root) return lastMainVideo?.isConnected ? lastMainVideo : null;
        const video = [...root.querySelectorAll("video")].find(
            (video) =>
                isVisible(video) && !video.closest('[class*="carousel"]'),
        );
        if (video) {
            lastMainVideo = video;
            return video;
        }
        return root.contains(lastMainVideo) ? lastMainVideo : null;
    }

    function injectRuntimeCss() {
        if (document.getElementById("twitch-kit-runtime-css")) return;
        const style = document.createElement("style");
        style.id = "twitch-kit-runtime-css";
        style.textContent = `
      .player-controls__right-control-group div:has(> #twitch-kit-pip-control) {
        display: flex !important;
        flex: 0 0 auto !important;
        flex-wrap: nowrap !important;
        white-space: nowrap !important;
      }

      #twitch-kit-pip-control {
        flex: 0 0 32px !important;
      }

      #twitch-kit-pip-control,
      #twitch-kit-pip-control * {
        animation: none !important;
        transform: none !important;
      }
    `;
        (document.head || document.documentElement).appendChild(style);
    }

    function injectCleanerCss() {
        const existing = document.getElementById("twitch-kit-css");
        if (!CONFIG.cleanUi) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const style = document.createElement("style");
        style.id = "twitch-kit-css";
        style.textContent = `
      [data-test-selector="extension-disclaimer"],
      [data-a-target="top-nav-get-bits-button"],
      [data-a-target="top-nav-get-bits-button"] ~ .tw-new-item-indicator__container,
      div:has([data-a-target="top-nav-get-bits-button"]) > .tw-new-item-indicator__container,
      [data-a-target="prime-offers-icon"],
      [data-a-target="prime-offers-icon"] ~ .tw-new-item-indicator__container,
      div:has([data-a-target="prime-offers-icon"]) > .tw-new-item-indicator__container,
      .prime-offers,
      .top-nav__prime,
      .channel-panels,
      .channel-panels-container,
      [data-test-selector="masonry_container_selector"],
      [data-test-selector="user-notice-line"],
      #twilight-sticky-footer-root,
      div.tw-root--theme-light:has(> [style*="Channel_Promo_Banner_Web"]),
      .chat-room div:has(> div > button[aria-label="Previous leaderboard set" i]),
      .chat-room div:has(> div > button[aria-label$="Leaderboard" i]),
      html body [data-a-target="side-nav-stories-root"],
      html body [class*="storiesLeftNav" i],
      html body button[data-twitch-kit-hidden="1"],
      html body button[data-a-target*="gift" i],
      html body button[aria-label*="Gift a Sub" i],
      html body div:has(> div > div > button[data-a-target="gift-button"]),
      [data-target="channel-header-right"] > div:has([data-a-target="top-nav-get-bits-button"]),
      [data-a-target="video-player"] button:has([data-a-target="content-classification-warning-disclosure-overlay"]),
      [data-a-target="video-player"] .top-bar,
      [data-a-target="player-container"] .top-bar,
      .video-player .top-bar {
        display: none !important;
      }
    `;
        (document.head || document.documentElement).appendChild(style);
    }

    const qualityLabel = (q) =>
        String(q?.group || q?.name || q?.quality || q || "");
    const qualityParts = (q) =>
        [
            q?.group,
            q?.name,
            q?.quality,
            q?.label,
            q?.displayName,
            typeof q === "string" ? q : null,
        ]
            .filter(Boolean)
            .map(String);
    const qualityHeight = (q) => {
        const label = qualityLabel(q).toLowerCase();
        const parsed = label.match(/(\d{3,4})p/);
        if (Number(q?.height)) return Number(q.height);
        if (parsed) return Number(parsed[1]);
        if (label === "source" || label === "chunked") return 10000;
        return 0;
    };
    const qualityFps = (q) => {
        const parsed = qualityLabel(q).match(/p(\d{2,3})/);
        return Number(
            q?.frameRate || q?.framerate || (parsed && parsed[1]) || 0,
        );
    };
    const isAutoQuality = (q) =>
        qualityParts(q).some((part) => part.toLowerCase().includes("auto"));

    function findPlayer() {
        const root = getPlayerRoot();
        const fiberKey = Object.keys(root || {}).find(
            (key) =>
                key.startsWith("__reactFiber$") ||
                key.startsWith("__reactInternalInstance$") ||
                key.startsWith("__reactContainer$"),
        );
        const stack = [root?.[fiberKey]];
        const seen = new Set();

        while (stack.length && seen.size < 1000) {
            const node = stack.pop();
            if (!node || seen.has(node)) continue;
            seen.add(node);

            const values = [
                node.memoizedProps,
                node.pendingProps,
                node.stateNode,
                node.stateNode?.props,
            ];
            for (const value of values) {
                const player =
                    value?.mediaPlayerInstance ||
                    value?.playerInstance ||
                    value?.player ||
                    value;
                const direct = [player, player?.core].find(
                    (candidate) =>
                        typeof candidate?.getQualities === "function" &&
                        typeof candidate?.setQuality === "function",
                );
                if (direct) return direct;
            }

            if (node.return) stack.push(node.return);
            if (node.child) stack.push(node.child);
            if (node.sibling) stack.push(node.sibling);
        }
        return null;
    }

    function forceBestQuality() {
        if (!CONFIG.maxQuality || qualityBlocked()) return false;
        try {
            const player = findPlayer();
            if (!player) return false;
            const best = player
                .getQualities()
                .filter(
                    (quality) =>
                        !isAutoQuality(quality) && qualityHeight(quality) > 0,
                )
                .sort(
                    (a, b) =>
                        qualityHeight(b) - qualityHeight(a) ||
                        qualityFps(b) - qualityFps(a),
                )[0];
            if (!best) return false;

            const bestParts = qualityParts(best);
            if (
                qualityParts(player.getQuality?.()).some((part) =>
                    bestParts.includes(part),
                )
            )
                return true;

            player.setAutoQualityMode?.(false);
            player.setQuality(
                best.group || best.name || best.quality || best,
                false,
            );
            log("quality", qualityLabel(best));
        } catch (err) {
            log("quality error", err);
        }
        return false;
    }

    let qualityTimer = 0;
    let qualityUntil = 0;
    let qualityOk = 0;
    let qualitySuspendedUntil = 0;
    const qualityStalls = [];

    function qualityBlocked() {
        return Date.now() < qualitySuspendedUntil;
    }

    function recordQualityStall() {
        const now = Date.now();
        while (
            qualityStalls.length &&
            now - qualityStalls[0] > CONFIG.qualityStallWindowMs
        ) {
            qualityStalls.shift();
        }
        qualityStalls.push(now);
        if (qualityStalls.length >= CONFIG.qualityStallLimit) {
            qualitySuspendedUntil = now + CONFIG.qualitySuspendMs;
            stopQualityBurst();
            qualityStalls.length = 0;
            log("quality suspended");
        }
    }

    function burstQuality(durationMs = CONFIG.qualityBurstMs) {
        if (!CONFIG.maxQuality || qualityBlocked() || !getPlayerRoot()) return;
        qualityUntil = Math.max(qualityUntil, Date.now() + durationMs);
        qualityOk = 0;
        if (qualityTimer) return;

        const tick = () => {
            qualityTimer = 0;
            const ok = forceBestQuality();
            if (ok && ++qualityOk >= 2) return;
            if (Date.now() <= qualityUntil)
                qualityTimer = window.setTimeout(tick, CONFIG.qualityStepMs);
        };

        qualityTimer = window.setTimeout(tick, 0);
    }

    function stopQualityBurst() {
        if (qualityTimer) window.clearTimeout(qualityTimer);
        qualityTimer = 0;
        qualityUntil = 0;
        qualityOk = 0;
    }

    function claimPoints() {
        if (!CONFIG.autoClaimPoints) return;
        const now = Date.now();
        if (now - claimPoints.lastClick < CONFIG.claimCooldownMs) return;

        const selectors = [
            '[data-test-selector="community-points-summary"] .claimable-bonus__icon',
            ".claimable-bonus__icon",
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            const button =
                el?.closest?.("button") ||
                (el?.tagName === "BUTTON" ? el : null);
            if (button && !button.disabled && isVisible(button)) {
                claimPoints.lastClick = now;
                button.click();
                log("claimed points");
                return;
            }
        }

        const buttons = document.querySelectorAll(
            "button[aria-label], button[data-test-selector]",
        );
        for (const button of buttons) {
            const label =
                `${button.getAttribute("aria-label") || ""} ${button.getAttribute("data-test-selector") || ""}`.toLowerCase();
            if (
                !button.disabled &&
                isVisible(button) &&
                label.includes("claim") &&
                (label.includes("bonus") || label.includes("point"))
            ) {
                claimPoints.lastClick = now;
                button.click();
                log("claimed points");
                return;
            }
        }
    }
    claimPoints.lastClick = 0;

    const backToLivePatterns = [
        /\bback\s+to\s+live\b/,
        /\breturn\s+to\s+live\b/,
        /\bgo\s+to\s+live\b/,
        /voltar.*(live|vivo)/,
        /retour.*direct/,
        /zur[u\u00fc]ck.*live/,
        /volver.*(live|directo|vivo)/,
        /regresar.*(live|directo|vivo)/,
        /\u623b\u308b.*(\u30e9\u30a4\u30d6|live)/,
        /\u8fd4\u56de.*(\u76f4\u64ad|live)/,
    ];
    const blockWords = [
        "clip",
        "settings",
        "config",
        "follow",
        "subscribe",
        "chat",
        "share",
    ];

    function clickBackToLive() {
        if (!CONFIG.autoBackToLive) return;
        const now = Date.now();
        if (now - clickBackToLive.lastClick < CONFIG.liveCooldownMs) return;

        const root = getPlayerRoot();
        if (!root) return;

        const buttons = root.querySelectorAll("button");
        for (const button of buttons) {
            if (!isVisible(button) || button.disabled) continue;
            const label =
                `${button.textContent || ""} ${button.getAttribute("aria-label") || ""} ${button.dataset?.aTarget || ""}`.toLowerCase();
            if (
                label.length > 90 ||
                blockWords.some((word) => label.includes(word))
            )
                continue;
            if (
                button.dataset?.aTarget?.includes("back-to-live") ||
                backToLivePatterns.some((pattern) => pattern.test(label))
            ) {
                clickBackToLive.lastClick = now;
                button.click();
                burstQuality(4000);
                log("back to live");
                return;
            }
        }
    }
    clickBackToLive.lastClick = 0;

    function clickContentGate() {
        if (!CONFIG.autoStartWatching) return;
        const now = Date.now();
        if (now - clickContentGate.lastClick < CONFIG.gateCooldownMs) return;
        const root = getPlayerRoot();
        if (!root) return;

        const selectors = [
            '[data-a-target="content-classification-gate-overlay-start-watching-button"]',
            '[data-a-target="player-overlay-content-gate"] button:not([disabled])',
        ];

        for (const selector of selectors) {
            const button = root.querySelector(selector);
            if (button && !button.disabled && isVisible(button)) {
                clickContentGate.lastClick = now;
                button.click();
                log("content gate");
                return;
            }
        }
    }
    clickContentGate.lastClick = 0;

    function restoreCleanUiElements() {
        document
            .querySelectorAll('[data-twitch-kit-hidden="1"]')
            .forEach((box) => {
                box.hidden = false;
                delete box.dataset.twitchKitHidden;
            });
    }

    function cleanUiElements() {
        if (!CONFIG.cleanUi) {
            restoreCleanUiElements();
            return;
        }
        document
            .querySelectorAll('[class*="carousel"] video')
            .forEach((video) => {
                try {
                    video.muted = true;
                    video.volume = 0;
                    video.pause();
                } catch {}
                const box = video.closest('[class*="carousel"]');
                if (box && !box.hidden) {
                    box.dataset.twitchKitHidden = "1";
                    box.hidden = true;
                }
            });

        document.querySelectorAll("button").forEach((button) => {
            const label = (button.textContent || "")
                .replace(/\s+/g, " ")
                .trim();
            if (!/^(?:Gift Turbo|Gift a Sub|Get Ad-Free)$/i.test(label) || button.hidden)
                return;
            button.dataset.twitchKitHidden = "1";
            button.hidden = true;
        });
    }

    const boundVideos = new WeakSet();
    let wasPlaying = false;
    let lastPlayerInputAt = 0;
    let lastManualPauseAt = 0;
    let inPictureInPicture = false;
    let pipKeepaliveTimer = 0;
    let pipButton = null;
    let pipMountTemplate = null;
    let pipMountTemplateAt = 0;
    let pipMountTimer = 0;

    function getNativeMainVideo() {
        try {
            const nativeDocument = pageGlobal.document;
            const nativeRoot =
                nativeDocument?.querySelector(PLAYER_ROOT_SELECTOR);
            const nativeVideo = nativeRoot?.querySelector("video");
            if (nativeVideo) return nativeVideo;
        } catch {}
        return getMainVideo();
    }

    function nativePiPSupport(video = getNativeMainVideo()) {
        let standardRequest = null;
        try {
            const candidate =
                video?.requestPictureInPicture ||
                pageGlobal.HTMLVideoElement?.prototype?.requestPictureInPicture;
            if (typeof candidate === "function") standardRequest = candidate;
        } catch {}
        return {
            standardRequest,
            webkit: typeof video?.webkitSetPresentationMode === "function",
        };
    }

    function nativePiPActive(video = getNativeMainVideo()) {
        if (!video) return false;
        try {
            const nativeDocument = video.ownerDocument || pageGlobal.document;
            if (nativeDocument?.pictureInPictureElement === video) return true;
        } catch {}
        return video.webkitPresentationMode === "picture-in-picture";
    }

    function updatePiPButton() {
        if (!pipButton?.isConnected) return;
        const video = getNativeMainVideo();
        const support = nativePiPSupport(video);
        const supported = !!(support.standardRequest || support.webkit);
        const active = nativePiPActive(video);
        pipButton.disabled = !video || !supported;
        pipButton.setAttribute("aria-pressed", String(active));
        pipButton.setAttribute(
            "aria-label",
            active ? "Exit system mini player" : "Open system mini player",
        );
        pipButton.title = pipButton.disabled
            ? "System mini player unavailable"
            : pipButton.getAttribute("aria-label");
    }

    async function toggleNativePiP() {
        const video = getNativeMainVideo();
        if (!video) return;
        const nativeDocument = video.ownerDocument || pageGlobal.document;
        const support = nativePiPSupport(video);
        try {
            if (nativeDocument?.pictureInPictureElement) {
                await nativeDocument.exitPictureInPicture?.();
            } else if (nativePiPActive(video) && support.webkit) {
                video.webkitSetPresentationMode("inline");
            } else if (support.standardRequest) {
                await support.standardRequest.call(video);
            } else if (support.webkit) {
                if (
                    typeof video.webkitSupportsPresentationMode !==
                        "function" ||
                    video.webkitSupportsPresentationMode("picture-in-picture")
                ) {
                    video.webkitSetPresentationMode("picture-in-picture");
                }
            }
        } catch (err) {
            log("mini player error", err);
        }
        updatePiPButton();
    }

    function schedulePiPButtonMount(delayMs) {
        if (pipMountTimer) return;
        pipMountTimer = window.setTimeout(
            () => {
                pipMountTimer = 0;
                ensurePiPButton();
            },
            Math.max(50, delayMs),
        );
    }

    function playerControlsHavePiPRoom(settingsButton) {
        const group = settingsButton.closest(
            ".player-controls__right-control-group",
        );
        if (!group) return false;
        const available = group.getBoundingClientRect().width;
        const used = [...group.children].reduce(
            (width, child) => width + child.getBoundingClientRect().width,
            0,
        );
        return available >= used + 32;
    }

    function ensurePiPButton() {
        const existing = document.getElementById("twitch-kit-pip-control");
        if (existing?.isConnected) {
            pipButton = existing.querySelector("button");
            updatePiPButton();
            return;
        }

        const root = getPlayerRoot();
        const settingsButton = root?.querySelector(
            '[data-a-target="player-settings-button"]',
        );
        const template = settingsButton?.closest('[class*="InjectLayout"]');
        if (!settingsButton || !template?.parentElement) return;

        const now = Date.now();
        if (pipMountTemplate !== template) {
            pipMountTemplate = template;
            pipMountTemplateAt = now;
        }
        const mountDelay = CONFIG.pipMountDelayMs - (now - pipMountTemplateAt);
        if (mountDelay > 0) {
            schedulePiPButtonMount(mountDelay);
            return;
        }
        if (!playerControlsHavePiPRoom(settingsButton)) {
            schedulePiPButtonMount(250);
            return;
        }

        const control = template.cloneNode(true);
        control.id = "twitch-kit-pip-control";
        control.querySelectorAll("[id]").forEach((element) => {
            element.removeAttribute("id");
        });
        const button = control.querySelector("button");
        const svg = button?.querySelector("svg");
        if (!button || !svg) return;

        button.removeAttribute("aria-expanded");
        button.removeAttribute("aria-haspopup");
        button.removeAttribute("data-a-target");
        button.dataset.twitchKitPipButton = "1";
        button.type = "button";
        svg.replaceChildren();
        const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
        );
        path.setAttribute(
            "d",
            "M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-8v-2h8V6H3v12h7v2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 7h7v6h-7v-6Z",
        );
        svg.appendChild(path);
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleNativePiP();
        });

        template.parentElement.insertBefore(control, template);
        pipButton = button;
        updatePiPButton();
    }

    function isManagedVideo(video) {
        return video?.isConnected && video === getMainVideo();
    }

    function isPiPVideo(video = getMainVideo()) {
        return (
            !!video &&
            (inPictureInPicture || nativePiPActive(getNativeMainVideo()))
        );
    }

    function stopPiPKeepalive() {
        if (pipKeepaliveTimer) window.clearInterval(pipKeepaliveTimer);
        pipKeepaliveTimer = 0;
    }

    function shouldPiPKeepalive() {
        const video = getMainVideo();
        return (
            !!video &&
            isPiPVideo(video) &&
            (CONFIG.maxQuality || CONFIG.keepPlaying)
        );
    }

    function runPiPKeepalive() {
        const video = getMainVideo();
        if (!video || !isPiPVideo(video)) return;
        if (CONFIG.maxQuality) forceBestQuality();
        if (CONFIG.keepPlaying && wasPlaying && video.paused && !video.ended)
            resumeVideo();
    }

    function updatePiPKeepalive() {
        if (!shouldPiPKeepalive()) {
            stopPiPKeepalive();
            return;
        }
        runPiPKeepalive();
        if (!pipKeepaliveTimer) {
            pipKeepaliveTimer = window.setInterval(() => {
                if (shouldPiPKeepalive()) runPiPKeepalive();
                else stopPiPKeepalive();
            }, CONFIG.pipKeepaliveMs);
        }
    }

    function recoverPlaybackSoon(delayMs = 1000) {
        if (!CONFIG.keepPlaying || !wasPlaying || !isPiPVideo()) return;
        window.setTimeout(() => {
            resumeVideo();
            if (CONFIG.maxQuality) forceBestQuality();
        }, delayMs);
    }

    function bindVideo(video) {
        if (!video || boundVideos.has(video)) return;
        boundVideos.add(video);
        video.addEventListener(
            "play",
            () => {
                if (!isManagedVideo(video)) return;
                wasPlaying = true;
                burstQuality(6000);
                updatePiPKeepalive();
            },
            true,
        );
        video.addEventListener(
            "playing",
            () => {
                if (!isManagedVideo(video)) return;
                wasPlaying = true;
                burstQuality(6000);
                updatePiPKeepalive();
            },
            true,
        );
        video.addEventListener(
            "pause",
            () => {
                if (!isManagedVideo(video)) return;
                const now = Date.now();
                if (
                    !isDocumentHidden() ||
                    now - lastPlayerInputAt < CONFIG.manualPauseWindowMs
                ) {
                    wasPlaying = false;
                    lastManualPauseAt = now;
                } else {
                    recoverPlaybackSoon();
                }
            },
            true,
        );
        video.addEventListener(
            "enterpictureinpicture",
            () => {
                if (!isManagedVideo(video)) return;
                inPictureInPicture = true;
                wasPlaying = !video.paused && !video.ended;
                burstQuality(15000);
                updatePiPKeepalive();
                updatePiPButton();
            },
            true,
        );
        video.addEventListener(
            "leavepictureinpicture",
            () => {
                inPictureInPicture = false;
                stopPiPKeepalive();
                updatePiPButton();
            },
            true,
        );
        video.addEventListener(
            "webkitpresentationmodechanged",
            () => {
                inPictureInPicture = nativePiPActive(getNativeMainVideo());
                updatePiPKeepalive();
                updatePiPButton();
            },
            true,
        );
        for (const name of ["waiting", "stalled"]) {
            video.addEventListener(
                name,
                () => {
                    if (isManagedVideo(video)) recordQualityStall();
                    recoverPlaybackSoon(1500);
                },
                true,
            );
        }
        video.addEventListener(
            "suspend",
            () => recoverPlaybackSoon(1500),
            true,
        );
        video.addEventListener(
            "loadedmetadata",
            () => {
                if (isManagedVideo(video)) burstQuality(8000);
            },
            true,
        );
        video.addEventListener(
            "canplay",
            () => {
                if (isManagedVideo(video)) burstQuality(5000);
            },
            true,
        );
    }

    function bindVideos() {
        bindVideo(getMainVideo());
        updatePiPKeepalive();
        updatePiPButton();
    }

    function resumeVideo() {
        if (!CONFIG.keepPlaying || !wasPlaying) return;
        const video = getMainVideo();
        try {
            if (
                video?.paused &&
                !video.ended &&
                (video.readyState >= 2 || isPiPVideo(video))
            ) {
                const promise = video.play();
                if (promise?.catch) promise.catch(() => {});
            }
        } catch {}
    }

    let wakeLock = null;
    let wakeLockRequest = null;
    let wakeLockReleaseQueued = false;
    function releaseWakeLock() {
        wakeLockReleaseQueued = !!wakeLockRequest;
        const lock = wakeLock;
        wakeLock = null;
        if (!lock) return;
        try {
            const promise = lock.release();
            if (promise?.catch) promise.catch(() => {});
        } catch {}
    }

    async function requestWakeLock() {
        if (
            !CONFIG.wakeLock ||
            isDocumentHidden() ||
            getMainVideo()?.paused !== false ||
            wakeLock ||
            wakeLockRequest ||
            !navigator.wakeLock?.request
        )
            return;
        try {
            wakeLockRequest = navigator.wakeLock.request("screen");
            const lock = await wakeLockRequest;
            wakeLock = lock;
            lock.addEventListener(
                "release",
                () => {
                    if (wakeLock === lock) wakeLock = null;
                },
                { once: true },
            );
        } catch {
        } finally {
            wakeLockRequest = null;
            if (wakeLockReleaseQueued || isDocumentHidden()) releaseWakeLock();
        }
    }

    let menuCommandIds = [];

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

        for (const [key, label] of TOGGLES) {
            const state = CONFIG[key] ? "on" : "off";
            const commandLabel = canRefresh
                ? `${label} = ${state}`
                : `Toggle ${label}`;
            try {
                const id = GM_registerMenuCommand(commandLabel, () => {
                    setToggle(key, !CONFIG[key]);
                });
                menuCommandIds.push(id);
            } catch {}
        }
    }

    function setToggle(key, value) {
        if (typeof DEFAULTS[key] !== "boolean") return;
        CONFIG[key] = Boolean(value);
        writeBool(key, CONFIG[key]);
        applyToggleChange(key);
        registerMenuCommands();
    }

    function applyToggleChange(key) {
        if (key === "maxQuality" && !CONFIG.maxQuality) stopQualityBurst();
        if (key === "wakeLock" && !CONFIG.wakeLock) releaseWakeLock();
        if (
            (key === "maxQuality" || key === "keepPlaying") &&
            !shouldPiPKeepalive()
        ) {
            stopPiPKeepalive();
        }
        if (key === "cleanUi") {
            injectCleanerCss();
            cleanUiElements();
        }

        scheduleDomWork();
        if (CONFIG.maxQuality && getMainVideo()) burstQuality(4000);
        if (CONFIG.wakeLock) requestWakeLock();
        updatePiPKeepalive();
    }

    function mutationTarget(mutation) {
        const target = mutation.target;
        const elementNode = typeof Node === "undefined" ? 1 : Node.ELEMENT_NODE;
        if (target?.nodeType === elementNode) return target;
        return target?.parentElement || null;
    }

    function hasNonChatMutation(mutations) {
        return mutations.some((mutation) => {
            const target = mutationTarget(mutation);
            return (
                !target ||
                typeof target.closest !== "function" ||
                !target.closest(CHAT_MUTATION_SELECTOR)
            );
        });
    }

    function runDomWork() {
        markRuntime();
        injectRuntimeCss();
        injectCleanerCss();
        ensurePiPButton();
        bindVideos();
        cleanUiElements();
        claimPoints();
        if (getPlayerRoot()) {
            clickBackToLive();
            clickContentGate();
        }
    }

    let domScheduled = false;
    let lastDomRun = 0;

    function scheduleDomWork() {
        if (domScheduled) return;
        domScheduled = true;
        const delay = Math.max(
            0,
            CONFIG.domCooldownMs - (Date.now() - lastDomRun),
        );
        window.setTimeout(() => {
            window.requestAnimationFrame(() => {
                domScheduled = false;
                lastDomRun = Date.now();
                runDomWork();
            });
        }, delay);
    }

    function onPageActivity() {
        scheduleDomWork();
        if (getMainVideo()) {
            burstQuality(8000);
            window.setTimeout(resumeVideo, 150);
            requestWakeLock();
        }
    }

    function patchNavigation() {
        let pageHistory = history;
        try {
            pageHistory = pageGlobal.history || history;
        } catch {}
        for (const name of ["pushState", "replaceState"]) {
            const original = pageHistory[name];
            if (original?.__twitchKitPatched) continue;
            const wrapped = function wrappedHistoryState(...args) {
                const result = original.apply(this, args);
                window.setTimeout(onPageActivity, 0);
                return result;
            };
            Object.defineProperty(wrapped, "__twitchKitPatched", {
                value: true,
            });
            pageHistory[name] = wrapped;
        }
        window.addEventListener("popstate", onPageActivity, true);
    }

    injectRuntimeCss();
    injectCleanerCss();
    patchNavigation();
    registerMenuCommands();

    document.addEventListener(
        "pointerdown",
        (event) => {
            if (event.target?.closest?.(PLAYER_ROOT_SELECTOR)) {
                lastPlayerInputAt = Date.now();
            }
        },
        true,
    );

    document.addEventListener(
        "keydown",
        (event) => {
            const target = event.target;
            if (
                target?.isContentEditable ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)
            )
                return;
            if (
                event.defaultPrevented ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey
            )
                return;
            if (event.key === " " || event.key?.toLowerCase() === "k")
                if (getMainVideo()) lastPlayerInputAt = Date.now();
        },
        true,
    );

    document.addEventListener(
        "visibilitychange",
        () => {
            if (isDocumentHidden()) {
                const video = getMainVideo();
                const activeVideo = video && !video.paused && !video.ended;
                wasPlaying =
                    Date.now() - lastManualPauseAt < CONFIG.manualPauseWindowMs
                        ? false
                        : wasPlaying || activeVideo;
                updatePiPKeepalive();
                releaseWakeLock();
                return;
            }
            updatePiPKeepalive();
            onPageActivity();
        },
        true,
    );

    window.addEventListener("focus", onPageActivity, true);
    window.addEventListener("pageshow", onPageActivity, true);
    window.addEventListener("pagehide", releaseWakeLock, true);
    window.addEventListener("load", onPageActivity, { once: true });

    onceBody(() => {
        runDomWork();
        burstQuality(12000);
        requestWakeLock();

        const observer = new MutationObserver((mutations) => {
            if (hasNonChatMutation(mutations)) scheduleDomWork();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.setInterval(onPageActivity, 30000);
    });
})();
