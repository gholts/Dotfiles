const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../twitch-stability-kit.user.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const json = data => new Response(JSON.stringify(data));
const recording = id => ({ user: { videos: { edges: [{ node: { id, status: 'RECORDING' } }] } } });

function harness() {
    const document = { documentElement: { dataset: {} } };
    const window = new EventTarget();
    const top = { stateNode: {} }; top.stateNode.current = top;
    const provider = { return: top, memoizedProps: {} };
    const fiber = { return: provider };
    const root = { __reactFiber$test: fiber };
    const env = {
        requests: [], changes: [],
        lookup: async () => recording('100'),
        token: async () => ({ videoPlaybackAccessToken: { value: '{}', signature: 'sig' } }),
        playlist: async () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://cdn.example/media.m3u8'),
    };
    const setPlayerContent = content => { env.changes.push(content); provider.memoizedProps.value = { ...provider.memoizedProps.value, content }; };
    provider.memoizedProps.value = { content: { type: 'live', channelLogin: 'atrioc' }, setPlayerContent, playbackID: 'session' };
    const location = { pathname: '/atrioc', search: '' };
    const CONFIG = { rewind: true };
    const context = vm.createContext({
        window, document, location, CONFIG, isChatEmbed: false, isEmbed: false,
        URL, URLSearchParams, AbortController, AbortSignal,
        pageGlobal: { fetch: async (url, options) => {
            env.requests.push(url);
            if (url.includes('usher.')) return env.playlist();
            const body = JSON.parse(options.body);
            const data = await (body.query.includes('videos(first:') ? env.lookup(body.variables) : env.token());
            return data instanceof Response ? data : json({ data });
        } },
        getPlayerRoot: () => root, log() {},
    });
    const code = between('    function getReactFiber(', '    function findPlayer()') + between('    function createRewind()', '    const backToLivePatterns');
    vm.runInContext(code.replace('return { update, get active()', 'return { update, context, get session() { return session; }, get active()') + '\nthis.rewind = createRewind();', context);
    return { env, document, window, root, fiber, top, provider, location, CONFIG, rewind: context.rewind, get content() { return provider.memoizedProps.value.content; } };
}
async function started() { const h = harness(); h.rewind.update(); await flush(); return h; }

test('public recording enables native DVR through content context; no custom DOM or player loader', async () => {
    const h = await started();
    assert.equal(h.content.dvrVideoID, '100');
    assert.equal(h.env.changes.length, 1);
    assert.equal(h.env.requests.length, 3);
    assert.equal(h.content.type, 'live');
    assert.doesNotMatch(source, /twitch-kit-rewind|createRewindPreviews|new Hls\(/);
});

test('native context lookup follows current React fiber rather than stale alternate', () => {
    const h = harness();
    const newTop = { stateNode: h.top.stateNode };
    const current = { ...h.provider.memoizedProps.value, content: { type: 'live', channelLogin: 'current' } };
    h.fiber.alternate = { return: { return: newTop, memoizedProps: { value: current } } };
    h.top.stateNode.current = newTop;
    assert.equal(h.rewind.context().content.channelLogin, 'current');
});

test('existing native rewind is preserved without lookup or content changes', async () => {
    const h = harness(); h.content.dvrVideoID = 'native';
    h.rewind.update(); await flush();
    assert.equal(h.env.requests.length, 0);
    h.CONFIG.rewind = false; h.rewind.update();
    assert.equal(h.content.dvrVideoID, 'native');
    assert.equal(h.env.changes.length, 0);
});

test('native VOD state suppresses live recovery without custom playback state', async () => {
    const h = await started();
    h.provider.memoizedProps.value.setPlayerContent({ type: 'video', channelLogin: 'atrioc', vodID: '100', isDVR: true });
    h.rewind.update();
    assert.equal(h.rewind.active, true);
    assert.equal(h.document.documentElement.dataset.twitchKitRewinding, '1');
    h.CONFIG.rewind = false; h.rewind.update();
    assert.equal(h.content.type, 'live');
    assert.equal(h.content.dvrVideoID, undefined);
    h.rewind.update();
    assert.equal(h.document.documentElement.dataset.twitchKitRewinding, undefined);
});

test('native LIVE transition retaining isDVR metadata re-enables live recovery', async () => {
    const h = await started();
    const value = h.provider.memoizedProps.value;
    value.setPlayerContent({ ...h.content, type: 'video', isDVR: true, vodID: '100', videoOffset: 300 });
    h.rewind.update();
    value.setPlayerContent({ ...h.content, type: 'live', dvrVideoID: '100' });
    h.rewind.update();
    assert.equal(h.rewind.active, false);
    assert.equal(h.document.documentElement.dataset.twitchKitRewinding, undefined);
});

test('native content rerender reapplies verified ID without repeating requests', async () => {
    const h = await started();
    h.provider.memoizedProps.value.content = { type: 'live', channelLogin: 'atrioc' };
    for (let i = 0; i < 20; i++) h.rewind.update();
    assert.equal(h.content.dvrVideoID, '100');
    assert.equal(h.env.requests.length, 3);
    assert.equal(h.env.changes.length, 2);
});

test('temporary player detachment retains ownership for later disable', async () => {
    const h = await started();
    const fiber = h.root.__reactFiber$test;
    delete h.root.__reactFiber$test;
    h.rewind.update();
    assert.equal(h.rewind.session.installedID, '100');
    h.root.__reactFiber$test = fiber;
    h.CONFIG.rewind = false; h.rewind.update();
    assert.equal(h.content.dvrVideoID, undefined);
});

test('navigation cancels lookup and cannot enable rewind on stale channel', async () => {
    const h = harness(); const pending = deferred();
    h.env.lookup = () => pending.promise;
    h.rewind.update();
    h.location.pathname = '/directory'; h.rewind.update();
    pending.resolve(recording('100')); await flush();
    assert.equal(h.env.changes.length, 0);
    assert.equal(h.rewind.session, null);
});

test('disabling during playlist verification cannot resurrect native rewind', async () => {
    const h = harness(); const pending = deferred();
    h.env.playlist = () => pending.promise;
    h.rewind.update(); await flush();
    h.CONFIG.rewind = false; h.rewind.update();
    pending.resolve(new Response('#EXTM3U')); await flush();
    assert.equal(h.env.changes.length, 0);
});

test('HTTP or GraphQL access failure leaves native content unchanged', async () => {
    for (const status of [401, 403, 404, 500]) {
        const h = harness(); h.env.playlist = async () => new Response('unavailable', { status });
        h.rewind.update(); await flush();
        assert.equal(h.env.changes.length, 0);
        assert.equal(h.rewind.session.installedID, undefined);
    }
    const h = await started();
    h.env.lookup = async () => json({ data: { user: null }, errors: [{ message: 'service failure' }] });
    h.rewind.session.nextCheck = 0; h.rewind.update(); await flush();
    assert.equal(h.content.dvrVideoID, '100');
    assert.equal(h.rewind.session.misses, 0);
});

test('two confirmed missing recordings restore original live content', async () => {
    const h = await started(); h.env.lookup = async () => ({ user: { videos: { edges: [] } } });
    h.rewind.session.nextCheck = 0; h.rewind.update(); await flush();
    assert.equal(h.content.dvrVideoID, '100');
    h.rewind.session.nextCheck = 0; h.rewind.update(); await flush();
    assert.equal(h.content.dvrVideoID, undefined);
    assert.equal(h.rewind.session.vodID, null);
});

test('recording rotation waits for native return-to-live before switching ID', async () => {
    const h = await started();
    h.provider.memoizedProps.value.setPlayerContent({ type: 'video', channelLogin: 'atrioc', vodID: '100', isDVR: true });
    h.env.lookup = async () => recording('200');
    h.rewind.session.nextCheck = 0; h.rewind.update(); await flush();
    assert.equal(h.content.vodID, '100');
    h.provider.memoizedProps.value.setPlayerContent({ type: 'live', channelLogin: 'atrioc', dvrVideoID: '100' });
    h.rewind.update();
    assert.equal(h.content.dvrVideoID, '200');
});

test('disable never overwrites a recording installed by Twitch itself', async () => {
    const h = await started();
    h.provider.memoizedProps.value.content = { type: 'live', channelLogin: 'atrioc', dvrVideoID: 'native' };
    h.CONFIG.rewind = false; h.rewind.update();
    assert.equal(h.content.dvrVideoID, 'native');
});

test('page exit restores owned context and aborts session', async () => {
    const h = await started(); const signal = h.rewind.session.abort.signal;
    h.window.dispatchEvent(new Event('pagehide'));
    assert.equal(h.content.dvrVideoID, undefined);
    assert.equal(signal.aborted, true);
    assert.equal(h.rewind.session, null);
});

function vodFetch(original) {
    const context = vm.createContext({ URL, Response, AbortSignal, Date });
    vm.runInContext(between('    function createVodFetch(', '    function hookWorkerFetch()'), context);
    return context.createVodFetch(original);
}

test('worker preserves unrelated requests and HTTP errors without extra network calls', async () => {
    for (const status of [200, 204, 404, 429, 500]) {
        const response = new Response(status === 204 ? null : 'body', { status });
        let calls = 0;
        const fetch = vodFetch(async () => { calls++; return response; });
        assert.equal(await fetch('https://usher.ttvnw.net/vod/123.m3u8?x=1'), response);
        assert.equal(calls, 1);
    }
    const response = new Response('denied', { status: 403 });
    let calls = 0;
    const fetch = vodFetch(async () => { calls++; return response; });
    assert.equal(await fetch(new Request('https://example.com/vod/123.m3u8')), response);
    assert.equal(calls, 1);
});

test('blocked VOD uses CDN qualities; transient lookup failure preserves original response', async () => {
    const denied = new Response('denied', { status: 403 });
    const requests = [];
    const fetch = vodFetch(async url => {
        requests.push(url);
        if (url.includes('usher.')) return denied;
        if (url.includes('gql.')) return json({ data: { video: { broadcastType: 'ARCHIVE', seekPreviewsURL: 'https://d.example.cloudfront.net/special/storyboards/1.jpg' } } });
        return new Response(url.includes('/chunked/') ? '#EXTM3U\n#EXTINF:10\n1.ts' : '', { status: url.includes('/chunked/') ? 200 : 404 });
    });
    const result = await fetch('https://usher.ttvnw.net/vod/123.m3u8?token=test');
    const playlist = await result.text();
    assert.equal(result.status, 200);
    assert.match(playlist, /special\/chunked\/index-dvr.m3u8/);
    assert.doesNotMatch(playlist, /CODECS=|RESOLUTION=/);
    assert.equal(requests.length, 8);
    const failing = vodFetch(async url => { if (url.includes('usher.')) return denied; throw new Error('offline'); });
    assert.equal(await failing('https://usher.ttvnw.net/vod/123.m3u8'), denied);
});

test('leaving channel removes only owned DVR and navigation back remains disableable', async () => {
    const h = await started();
    h.location.pathname = '/directory'; h.rewind.update();
    assert.equal(h.content.dvrVideoID, undefined);
    h.location.pathname = '/atrioc'; h.rewind.update(); await flush();
    h.CONFIG.rewind = false; h.rewind.update();
    assert.equal(h.content.dvrVideoID, undefined);
});

test('disable while detached restores native context after reattachment', async () => {
    const h = await started();
    const fiber = h.root.__reactFiber$test;
    delete h.root.__reactFiber$test;
    h.CONFIG.rewind = false; h.rewind.update();
    assert.equal(h.rewind.session.abort.signal.aborted, true);
    h.root.__reactFiber$test = fiber;
    h.rewind.update();
    assert.equal(h.content.dvrVideoID, undefined);
    assert.equal(h.rewind.session, null);
});

function workerFetch(original, process = (_url, body) => body) {
    const context = vm.createContext({
        URL, Request, Response, AbortSignal, Date, Map, Set,
        fetch: original, processM3U8: process, console: { log() {} },
    });
    vm.runInContext(
        between('    function declareOptions(', '    let isActivelyStrippingAds') +
        'declareOptions(this);' +
        between('    function createVodFetch(', '    function stripAdSegments(') +
        between('    function parseAttributes(', '    function getAccessToken(') +
        'hookWorkerFetch();', context);
    return context;
}

const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2"\nhttps://cdn.example/live/index.m3u8?token=media';

test('master playlist without SERVER-TIME parses; Request headers and cancellation survive URL rewrite', async () => {
    const requests = [];
    const h = workerFetch(async (input, init) => { requests.push({ input, init }); return new Response(master); });
    const abort = new AbortController();
    const input = new Request('https://usher.ttvnw.net/api/channel/hls/atrioc.m3u8?parent_domains=example.com', { headers: { 'X-Test': 'preserved' }, signal: abort.signal });
    const result = await h.fetch(input);
    assert.equal(await result.text(), master);
    assert.equal(h.getServerTimeFromM3u8(master), null);
    assert.equal(requests[0].input.headers.get('X-Test'), 'preserved');
    assert.equal(new URL(requests[0].input.url).searchParams.has('parent_domains'), false);
    abort.abort();
    assert.equal(requests[0].input.signal.aborted, true);
});

test('playlist parse/read failures reject rather than leave player fetch pending', { timeout: 1000 }, async () => {
    const h = workerFetch(async () => new Response('#EXTM3U'), () => { throw new Error('bad playlist'); });
    await assert.rejects(h.fetch('https://cdn.example/live.m3u8?token=x'), /bad playlist/);
    const broken = workerFetch(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('body failed')); } })));
    await assert.rejects(broken.fetch('https://cdn.example/live.m3u8'), /body failed/);
});

test('muted VOD rewrite reads once without cloning; query-string media playlists are processed', async () => {
    let reads = 0, processed = 0;
    const response = new Response('#EXTM3U\n#EXTINF:10\n1-unmuted.ts');
    const read = response.text.bind(response);
    response.text = () => { reads++; return read(); };
    response.clone = () => { throw new Error('unnecessary copy'); };
    const h = workerFetch(async () => response, (_url, body) => { processed++; return body; });
    const result = await h.fetch('https://cdn.example/archive/chunked/index-dvr.m3u8?token=x');
    assert.match(await result.text(), /1-muted.ts/);
    assert.equal(reads, 1);
    assert.equal(processed, 1);
});

test('ad marker stripping preserves media entries and rewrites tracking fields', () => {
    const context = vm.createContext({ AdSignifier: 'stitched', AllSegmentsAreAdSegments: false, AdSegmentCache: new Map(), Date });
    vm.runInContext(between('    function stripAdSegments(', '    function getStreamUrlForResolution('), context);
    const body = '#EXTM3U\n#EXT-X-DATERANGE:ID="stitched-ad",X-TV-TWITCH-AD-URL="https://ad.example/track"\n#EXTINF:10,ad\nhttps://cdn.example/ad.ts\n#EXT-X-TWITCH-PREFETCH:https://cdn.example/next.ts';
    const result = context.stripAdSegments(body, false, { NumStrippedAdSegments: 0 });
    assert.match(result, /X-TV-TWITCH-AD-URL="https:\/\/twitch.tv"/);
    assert.match(result, /https:\/\/cdn.example\/ad.ts/);
    assert.doesNotMatch(result, /PREFETCH/);
    assert.equal(context.AdSegmentCache.size, 1);
});

test('terminated workers and bootstrap blobs are released; unrelated/module workers pass through', async () => {
    const created = new Map(), revoked = new Set();
    let id = 0;
    class WorkerURL extends URL {
        static createObjectURL(blob) { const url = `blob:generated:${++id}`; created.set(url, blob); return url; }
        static revokeObjectURL(url) { revoked.add(url); }
    }
    class BrowserWorker extends EventTarget {
        constructor(url, options) { super(); this.url = url; this.options = options; }
        terminate() { this.stopped = true; }
    }
    const context = vm.createContext({ Worker: BrowserWorker, URL: WorkerURL, Blob, console: { log() {} } });
    const bootstrapDependencies = ['stripAdSegments','getStreamUrlForResolution','processM3U8','hookWorkerFetch','createVodFetch','getAccessToken','gqlRequest','parseAttributes','getWasmWorkerJs','getServerTimeFromM3u8','replaceServerTimeInM3u8'];
    const stubs = bootstrapDependencies.map(name => `function ${name}() {}`).join('\n');
    vm.runInContext(`const adPage = this;\n${between('    function declareOptions(', '    let isActivelyStrippingAds')}declareOptions(this);${stubs}\n${between('    const twitchWorkers', '    function getWasmWorkerJs(')}hookWindowWorker();`, context);
    const worker = new context.Worker(new URL('blob:https://www.twitch.tv/source'));
    assert.equal(vm.runInContext('twitchWorkers.size', context), 1);
    const script = await created.get(worker.url).text();
    assert.doesNotThrow(() => new vm.Script(script));
    worker.dispatchEvent(new MessageEvent('message', { data: { key: 'ready' } }));
    assert.equal(revoked.has(worker.url), true);
    worker.terminate();
    assert.equal(worker.stopped, true);
    assert.equal(vm.runInContext('twitchWorkers.size', context), 0);
    const neverStarted = new context.Worker('blob:https://www.twitch.tv/pending');
    neverStarted.terminate();
    assert.equal(revoked.has(neverStarted.url), true);
    const module = new context.Worker('https://www.twitch.tv/worker.js', { type: 'module' });
    assert.equal(module.url, 'https://www.twitch.tv/worker.js');
    assert.equal(module.options.type, 'module');
    const unrelated = new context.Worker('https://example.com/worker.js');
    unrelated.terminate();
    assert.equal(created.size, 2);
    assert.equal(vm.runInContext('twitchWorkers.size', context), 0);
});

test('recovery lookup remains inside player neighborhood and returns matching SDK/controller', () => {
    let rootQueries = 0;
    const sdk = { core: {} };
    const controller = { setSrc() {}, setInitialPlaybackSettings() {} };
    const root = { return: null };
    const parent = { child: root, memoizedProps: { value: { mediaPlayerInstance: { playerInstance: sdk } } } };
    root.return = parent;
    root.sibling = { return: parent, stateNode: controller };
    const element = { __reactFiber$test: root };
    const context = vm.createContext({ document: { querySelector(selector) { rootQueries++; assert.doesNotMatch(selector, /#root/); return element; } } });
    vm.runInContext(between('    function getPlayerAndState()', '    function doTwitchPlayerTask('), context);
    const result = context.getPlayerAndState();
    assert.equal(result.player, sdk);
    assert.equal(result.state, controller);
    assert.equal(rootQueries, 1);
});

test('live recovery cannot reload native VOD even if DOM rewind marker has not updated', () => {
    let changes = 0;
    const context = vm.createContext({
        document: { documentElement: { dataset: {} } },
        getPlayerAndState: () => ({ player: { isPaused: () => false }, state: { props: { content: { type: 'video', isDVR: true } }, setSrc: () => changes++ } }),
        console: { log() {} },
    });
    vm.runInContext(between('    function doTwitchPlayerTask(', '    adPage.reloadTwitchPlayer'), context);
    context.doTwitchPlayerTask(false, true);
    assert.equal(changes, 0);
});
