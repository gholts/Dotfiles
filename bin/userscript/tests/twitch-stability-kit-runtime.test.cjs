const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../twitch-stability-kit.user.js'), 'utf8');

function runtimeHarness() {
    const h = { now: 10000, hidden: false, timers: new Map(), intervals: new Map(), buttons: [], icons: [], counters: [], rectReads: 0, qualityReads: 0, qualityCalls: [], auto: true };
    let timerID = 0;
    class Doc extends EventTarget { get hidden() { return h.hidden; } }
    const document = new Doc();
    document.listeners = new Map();
    document.addEventListener = (name, handler, options) => { document.listeners.set(name, handler); EventTarget.prototype.addEventListener.call(document, name, handler, options); };
    document.documentElement = { dataset: {} };
    document.getElementById = () => null;
    document.querySelector = selector => selector.includes('video-player') ? h.root : null;
    document.querySelectorAll = selector => selector.startsWith('button') ? h.buttons : selector === '.claimable-bonus__icon' ? h.icons : selector.startsWith('span[') ? h.counters : [];
    const window = new EventTarget();
    Object.assign(window, {
        self: window, top: window, document,
        setTimeout(fn, delay) { const id = ++timerID; h.timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { h.timers.delete(id); },
        setInterval(fn, delay) { const id = ++timerID; h.intervals.set(id, { fn, delay }); return id; },
        clearInterval(id) { h.intervals.delete(id); },
        requestAnimationFrame(fn) { fn(); },
    });
    h.makeVideo = () => Object.assign(new EventTarget(), {
        tagName: 'VIDEO', isConnected: true, paused: false, ended: false, readyState: 4, seeking: false, ownerDocument: document, playCalls: 0,
        closest() { return null; },
        getBoundingClientRect() { h.rectReads++; return { width: 100, height: 100 }; },
        play() { this.playCalls++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); },
        pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
    });
    h.video = h.makeVideo();
    h.qualities = [{ group: '720p30', height: 720, framerate: 30 }, { group: '1080p60', height: 1080, framerate: 60 }];
    h.quality = h.qualities[0];
    h.player = {
        getQualities() { h.qualityReads++; return h.qualities; },
        getQuality() { return h.quality; },
        isAutoQualityMode() { return h.auto; },
        setAutoQualityMode(value) { h.auto = value; },
        setQuality(value) { assert.equal(typeof value, 'object'); h.qualityCalls.push(value); h.quality = value; },
    };
    const top = { stateNode: {} }; top.stateNode.current = top;
    const fiber = { return: { return: top, memoizedProps: { value: { mediaPlayerInstance: h.player } } } };
    h.root = {
        __reactFiber$test: fiber,
        querySelector(selector) { if (selector === 'video') return h.video; if (selector.includes('player-settings-button')) return h.settings || null; return null; },
        querySelectorAll(selector) { return selector === 'video' ? [h.video] : []; },
        contains(node) { return node === h.video; },
    };
    h.window = window; h.document = document; h.fiber = fiber;
    const navigator = { wakeLock: { request: () => { throw new Error('unexpected wake request'); } } };
    const context = vm.createContext({
        window, document, Document: Doc, Node: { ELEMENT_NODE: 1 }, navigator,
        location: { hostname: 'www.twitch.tv', pathname: '/atrioc', search: '' },
        history: {}, localStorage: { getItem() { return null; }, setItem() {} },
        URLSearchParams, AbortController, AbortSignal,
        Date: { now: () => h.now },
    });
    let main = source.slice(source.indexOf('(() => {\n    "use strict";'));
    const startup = main.indexOf('    injectRuntimeCss();\n    injectCleanerCss();\n    patchNavigation();');
    const events = main.slice(main.indexOf('    document.addEventListener(\n        "pointerdown"', startup), main.indexOf('    onceBody(() =>', startup));
    main = main.slice(0, startup) + events + `\nthis.runtime = {
        CONFIG, rewind, findPlayer, wrapCounterWriter, optimizeAnimatedNumbers, forceBestQuality, recordQualityStall, claimPoints,
        hasNonChatMutation, ensurePiPButton, updatePiPKeepalive, bindVideo,
        recoverPlaybackSoon, resumeVideo, requestWakeLock, releaseWakeLock, isDocumentHidden,
        get wasPlaying() { return wasPlaying; }, set wasPlaying(value) { wasPlaying = value; },
        get wakeLock() { return wakeLock; }
    }; })();`;
    // Arrow IIFE's lexical this is the VM global, used only for test access.
    vm.runInContext(main, context);
    h.runtime = context.runtime; h.navigator = navigator; h.context = context;
    h.runTimeouts = () => { const pending = [...h.timers.values()]; h.timers.clear(); pending.forEach(t => t.fn()); };
    return h;
}

test('live arrow handler runs before native shortcut and consumes only successful seeks', () => {
    const h = runtimeHarness(), calls = [];
    h.document.body = {};
    h.runtime.rewind.seekBy = value => { calls.push(value); return true; };
    const handle = h.document.listeners.get('keydown');
    const event = { key: 'ArrowLeft', target: h.document.body, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    handle(event);
    assert.deepEqual(calls, [-10]);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    // Twitch gives ordinary Play/Pause controls aria-haspopup="menu", too.
    h.video.closest = selector => selector.includes('[aria-haspopup]') ? {} : null;
    handle({ ...event, key: 'ArrowRight', target: h.video });
    assert.deepEqual(calls, [-10, 10]);
    h.runtime.rewind.seekBy = () => false;
    const unhandled = { ...event, key: 'ArrowRight', prevented: false, stopped: false };
    handle(unhandled);
    assert.equal(unhandled.prevented, false);
    assert.equal(unhandled.stopped, false);
});

test('live arrow handler preserves text editing, chat, widgets, modifiers and composition', () => {
    const h = runtimeHarness();
    h.document.body = {};
    h.runtime.rewind.seekBy = () => { throw new Error('unrelated key intercepted'); };
    const handle = h.document.listeners.get('keydown');
    for (const patch of [
        { target: { tagName: 'INPUT' } }, { target: { isContentEditable: true } },
        { target: { tagName: 'BUTTON' } }, // Chat/sidebar focus lies outside player.
        { target: h.video },
        { shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true },
        { isComposing: true }, { defaultPrevented: true },
    ]) {
        h.video.closest = () => ({}); // A focused slider/menu/dialog inside player.
        handle({ key: 'ArrowLeft', target: h.document.body, ...patch });
    }
});

test('quality uses SDK Quality object and exits automatic mode even when current rendition is highest', () => {
    const h = runtimeHarness();
    h.runtime.forceBestQuality();
    assert.equal(h.qualityCalls[0], h.qualities[1]);
    assert.equal(h.auto, false);
    h.auto = true;
    assert.equal(h.runtime.forceBestQuality(), true);
    assert.equal(h.auto, false);
    assert.equal(h.qualityCalls.length, 1);
});

test('quality lookup walks player ancestors without traversing unrelated descendants', () => {
    const h = runtimeHarness();
    Object.defineProperty(h.fiber, 'child', { get() { throw new Error('unrelated subtree traversed'); } });
    assert.equal(h.runtime.findPlayer(), h.player);
});

test('unrelated buttons require no layout reads during point scan', () => {
    const h = runtimeHarness();
    h.buttons = Array.from({ length: 1000 }, () => ({ disabled: false, getAttribute: () => 'Settings' }));
    h.runtime.claimPoints();
    assert.equal(h.rectReads, 0);
    let clicks = 0;
    h.buttons.push({ isConnected: true, disabled: false, getAttribute: () => 'Claim bonus points', click() { clicks++; }, getBoundingClientRect() { h.rectReads++; return { width: 32, height: 32 }; } });
    h.runtime.claimPoints();
    assert.equal(h.rectReads, 1);
    assert.equal(clicks, 1);
});

test('known point icons avoid full-page fallback and select visible reward among hidden copies', () => {
    const h = runtimeHarness();
    h.buttons = [{ getAttribute() { throw new Error('unnecessary full-page scan'); } }];
    h.icons = [{ closest: () => ({ isConnected: true, getBoundingClientRect: () => ({ width: 0, height: 0 }) }) }];
    h.runtime.claimPoints();
    let clicks = 0;
    h.icons.push({ closest: () => ({ isConnected: true, getBoundingClientRect: () => ({ width: 32, height: 32 }), click() { clicks++; } }) });
    h.runtime.claimPoints();
    assert.equal(clicks, 1);
});

test('mutation filter ignores clocks/chat but detects controls and chat-point rewards', () => {
    const h = runtimeHarness();
    const record = (closest, nodeType) => [{ target: { nodeType: 1, closest }, addedNodes: [{ nodeType }], removedNodes: [] }];
    assert.equal(h.runtime.hasNonChatMutation(record(() => null, 3)), false);
    assert.equal(h.runtime.hasNonChatMutation(record(() => null, 1)), true);
    assert.equal(h.runtime.hasNonChatMutation(record(selector => selector.includes('.chat-room') ? {} : null, 1)), false);
    assert.equal(h.runtime.hasNonChatMutation(record(selector => selector.includes('.chat-room') || selector.includes('community-points-summary') ? {} : null, 1)), true);
    assert.equal(h.runtime.hasNonChatMutation(record(selector => selector === 'button' ? {} : null, 3)), true);
});

test('narrow player does not create an endless PiP mounting poll', () => {
    const h = runtimeHarness();
    const template = { parentElement: {} };
    const group = { getBoundingClientRect: () => ({ width: 32 }), children: [{ getBoundingClientRect: () => ({ width: 32 }) }] };
    h.settings = { closest: selector => selector.includes('InjectLayout') ? template : group };
    h.runtime.ensurePiPButton();
    assert.equal(h.timers.size, 1);
    h.now += 1500; h.runTimeouts();
    assert.equal(h.timers.size, 0);
});

test('entering player schedules one mount retry; movement inside controls does not poll', () => {
    const h = runtimeHarness();
    const target = { closest: () => h.root };
    const onEnter = h.document.listeners.get('pointerover');
    onEnter({ target, relatedTarget: target });
    assert.equal(h.timers.size, 0);
    for (let i = 0; i < 20; i++) onEnter({ target, relatedTarget: null });
    assert.equal(h.timers.size, 1);
});

test('PiP quality checks run at keepalive cadence, not on every DOM pass', () => {
    const h = runtimeHarness();
    h.document.pictureInPictureElement = h.video;
    h.runtime.updatePiPKeepalive();
    for (let i = 0; i < 30; i++) h.runtime.updatePiPKeepalive();
    assert.equal(h.qualityReads, 1);
    assert.equal(h.intervals.size, 1);
    const timer = [...h.intervals.values()][0];
    assert.equal(timer.delay, 12000); timer.fn();
    assert.equal(h.qualityReads, 2);
    h.document.pictureInPictureElement = null;
    h.runtime.updatePiPKeepalive();
    assert.equal(h.intervals.size, 0);
});

test('manual pause in hidden PiP stays paused', () => {
    const h = runtimeHarness();
    h.document.pictureInPictureElement = h.video; h.hidden = true;
    h.runtime.bindVideo(h.video);
    h.video.pause();
    h.runtime.resumeVideo();
    h.runtime.recoverPlaybackSoon();
    assert.equal(h.runtime.wasPlaying, false);
    assert.equal(h.video.paused, true);
    assert.equal(h.video.playCalls, 0);
});

test('recovery timers coalesce and cannot resume a replacement video', () => {
    const h = runtimeHarness();
    h.document.pictureInPictureElement = h.video;
    h.runtime.bindVideo(h.video);
    for (let i = 0; i < 20; i++) h.runtime.recoverPlaybackSoon();
    assert.equal(h.timers.size, 1);
    h.video = h.makeVideo(); h.video.paused = true; h.document.pictureInPictureElement = h.video;
    h.runtime.bindVideo(h.video); h.runtime.wasPlaying = true;
    h.runTimeouts();
    assert.equal(h.video.playCalls, 0);
});

test('play intent does not leak to unbound or initially paused replacement video', () => {
    const h = runtimeHarness();
    h.runtime.bindVideo(h.video);
    h.video = h.makeVideo(); h.video.paused = true;
    h.runtime.resumeVideo();
    assert.equal(h.video.playCalls, 0);
    h.runtime.bindVideo(h.video);
    h.runtime.resumeVideo();
    assert.equal(h.runtime.wasPlaying, false);
    assert.equal(h.video.playCalls, 0);
});

test('seek buffering does not suspend max quality; real repeated stalls enable adaptive quality', () => {
    const h = runtimeHarness(); h.auto = false; h.video.seeking = true;
    for (let i = 0; i < 3; i++) h.runtime.recordQualityStall();
    assert.equal(h.auto, false);
    h.video.seeking = false;
    for (let i = 0; i < 3; i++) h.runtime.recordQualityStall();
    assert.equal(h.auto, true);
    assert.equal(h.runtime.forceBestQuality(), false);
    h.now += 61000; h.runtime.forceBestQuality();
    assert.equal(h.auto, false);
});

test('pause releases pending wake lock and requests remain single-flight', async () => {
    const h = runtimeHarness();
    h.runtime.CONFIG.wakeLock = true; h.runtime.bindVideo(h.video);
    let resolve, requests = 0, releases = 0;
    h.navigator.wakeLock.request = () => { requests++; return new Promise(r => { resolve = r; }); };
    const first = h.runtime.requestWakeLock();
    await h.runtime.requestWakeLock();
    h.video.pause();
    const lock = Object.assign(new EventTarget(), { release() { releases++; return Promise.resolve(); } });
    resolve(lock); await first;
    assert.equal(requests, 1);
    assert.equal(releases, 1);
    assert.equal(h.runtime.wakeLock, null);
});

test('real hidden state and window capture survive VAFT document visibility interception', async () => {
    const h = runtimeHarness(); h.runtime.CONFIG.wakeLock = true;
    let releases = 0;
    h.navigator.wakeLock.request = async () => Object.assign(new EventTarget(), { release() { releases++; return Promise.resolve(); } });
    await h.runtime.requestWakeLock();
    Object.defineProperty(h.document, 'hidden', { get: () => false });
    h.hidden = true;
    assert.equal(h.runtime.isDocumentHidden(), true);
    h.window.dispatchEvent(new Event('visibilitychange'));
    assert.equal(releases, 1);
});

function installVendorVisibility(h) {
    h.document.getElementsByTagName = tag => tag === 'video' ? [h.video] : [];
    h.video.muted = true;
    h.context.chrome = {};
    h.context.playerBufferState = { hasStreamStarted: true };
    h.context.localStorageHookFailed = false;
    const start = source.indexOf('    function onContentLoaded()');
    const end = source.indexOf('    declareOptions(adPage);', start);
    vm.runInContext(source.slice(start, end) + '\nonContentLoaded();', h.context);
    return hidden => {
        h.hidden = hidden;
        h.window.dispatchEvent(new Event('visibilitychange'));
        h.document.dispatchEvent(new Event('visibilitychange'));
    };
}

test('vendor visibility handler cannot restart manually paused PiP on tab return', () => {
    for (const keepPlaying of [true, false]) {
        const h = runtimeHarness();
        h.runtime.CONFIG.keepPlaying = keepPlaying;
        h.document.pictureInPictureElement = h.video;
        h.runtime.bindVideo(h.video);
        const visibility = installVendorVisibility(h);
        visibility(true);
        h.video.pause();
        visibility(false);
        h.runtime.resumeVideo();
        assert.equal(h.video.paused, true);
        assert.equal(h.video.playCalls, 0);
    }
});

test('Kit still resumes an involuntary ordinary background pause after vendor auto-resume removal', () => {
    const h = runtimeHarness();
    h.runtime.bindVideo(h.video);
    const visibility = installVendorVisibility(h);
    visibility(true);
    h.video.pause();
    visibility(false);
    const resume = [...h.timers.values()].find(timer => timer.delay === 150);
    assert.ok(resume);
    resume.fn();
    assert.equal(h.video.paused, false);
    assert.equal(h.video.playCalls, 1);
});

function counterSpan(value = '') {
    let content = value;
    const writes = { html: [], text: [], data: [] };
    const text = { nodeType: 3, nextSibling: null };
    Object.defineProperty(text, 'data', { get: () => content, set: value => { content = value; writes.data.push(value); } });
    const element = { tagName: 'SPAN', firstChild: text, childElementCount: 0, writes };
    Object.defineProperties(element, {
        textContent: { get: () => content, set: value => { content = value; writes.text.push(value); } },
        innerHTML: { get: () => content, set: value => { content = value; writes.html.push(value); } },
    });
    return element;
}

function nativeCounterFixture(h) {
    function CountUp(element) {
        if (!element) throw new Error('[CountUp] target is null or undefined');
        this.options = { formattingFn: String };
        this.printValue = function (value) { this.d.innerHTML = this.options.formattingFn(value); };
        this.d = element;
        this.start = callback => { this.printValue(100); callback(); };
    }
    const element = counterSpan('100');
    const counter = new CountUp(element);
    element.__reactFiber$counter = { return: { stateNode: { instance: counter } } };
    h.counters.push(element);
    return { CountUp, counter, element };
}

test('counter writer skips equal formatted frames and reuses text node for changes', () => {
    const h = runtimeHarness();
    const element = counterSpan('100');
    const text = element.firstChild;
    let formattingCalls = 0;
    const counter = { d: element, options: { formattingFn(value) { formattingCalls++; return String(Math.round(value)); } } };
    counter.printValue = h.runtime.wrapCounterWriter(function(value) { this.d.innerHTML = this.options.formattingFn(value); });
    for (let i = 0; i < 1000; i++) counter.printValue(100.1);
    assert.equal(formattingCalls, 1000);
    assert.deepEqual(element.writes, { html: [], text: [], data: [] });
    counter.printValue(101);
    counter.printValue(0);
    assert.equal(element.firstChild, text);
    assert.deepEqual(element.writes.data, ['101', '0']);
    assert.equal(element.writes.html.length, 0);
});

test('counter writer preserves HTML, entities, non-string values and formatting receiver', () => {
    const h = runtimeHarness();
    for (const value of ['<b>123</b>', '&nbsp;10', '\r12', '\u000012', 123, null, { trustedHTML: true }]) {
        const element = counterSpan('');
        const options = { formattingFn() { assert.equal(this, options); return value; } };
        const counter = { d: element, options };
        h.runtime.wrapCounterWriter(function(value) { this.d.innerHTML = this.options.formattingFn(value); }).call(counter, 0);
        assert.equal(element.writes.html[0], value);
    }
});

test('non-span counter targets retain original behavior and return value', () => {
    const h = runtimeHarness();
    const input = { tagName: 'INPUT', value: '' };
    const counter = { d: input, options: { formattingFn: String } };
    const original = function (value, suffix) {
        const output = this.options.formattingFn(value) + suffix;
        if (this.d.tagName === 'INPUT') this.d.value = output;
        else this.d.innerHTML = output;
        return 'native';
    };
    const wrapped = h.runtime.wrapCounterWriter(original);
    assert.notEqual(wrapped, original);
    assert.equal(wrapped.call(counter, '12', '%'), 'native');
    assert.equal(input.value, '12%');
});

test('one-time native hook covers existing and future counters without rescanning or changing lifecycle', () => {
    const h = runtimeHarness();
    const { CountUp, counter, element } = nativeCounterFixture(h);
    const start = counter.start;
    h.runtime.optimizeAnimatedNumbers();
    counter.printValue(100);
    assert.equal(element.writes.html.length, 0);
    assert.equal(counter.start, start);
    let completed = 0;
    counter.start(() => completed++);
    assert.equal(completed, 1);
    const nextElement = counterSpan('100');
    const next = new CountUp(nextElement);
    next.printValue(100);
    next.printValue(101);
    assert.equal(nextElement.writes.html.length, 0);
    assert.deepEqual(nextElement.writes.data, ['101']);
    assert.equal(Object.getOwnPropertyDescriptor(next, 'printValue').enumerable, true);
    h.document.querySelectorAll = () => { throw new Error('steady-state rescan'); };
    h.runtime.optimizeAnimatedNumbers();
});

test('counter hook leaves unknown engines and existing prototype patches untouched', () => {
    const h = runtimeHarness();
    const { CountUp, counter } = nativeCounterFixture(h);
    const original = counter.printValue;
    Object.defineProperty(CountUp.prototype, 'printValue', { value: function () {} });
    h.runtime.optimizeAnimatedNumbers();
    assert.equal(counter.printValue, original);

    const other = runtimeHarness();
    const element = counterSpan('1');
    const instance = { d: element, printValue() {}, options: { formattingFn: String } };
    element.__reactFiber$counter = { return: { stateNode: { instance } } };
    other.counters.push(element);
    other.runtime.optimizeAnimatedNumbers();
    assert.equal(Object.prototype.hasOwnProperty('printValue'), false);
});
