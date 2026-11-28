const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { root, plain, createSource: createHost } = require('./source-host.cjs');

const base = 'https://www.v2ph.com';
const cdn = 'https://images.example.invalid';
const id = 'Example-Album';
const albumUrl = `${base}/album/${id}`;
const createSource = (...args) => createHost('v2ph.js', ...args);
const cards = (...items) => `<div class="albums-list">${items.join('')}</div>`;
const card = (href = `/album/${id}`, title = 'Demo &amp; Sample', image = `<img src="${cdn}/cover.jpg">`) => `
    <div class="card"><div class="card-cover"><a class="media-cover" href="${href}">${image}</a></div>
    <div class="card-body"><h6><a href="${href}">${title}</a></h6></div></div>`;
const pagination = (...links) => `<ul class="pagination">${links.join('')}</ul>`;
const pageLink = (href, text, state = '') => `<li class="page-item ${state}"><a href="${href}">${text}</a></li>`;
const photos = (...items) => `<div class="photos-list">${items.map(src => `<img src="${src}">`).join('')}</div>`;
const count = number => `<dl><dt>Photos</dt><dd>${number}</dd></dl>`;
const filenames = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => `${cdn}/${start + index}.jpg`);
const latest = source => source.explore[0].load;
const album = source => source.comic.loadEp(id, null);

test('V2PH is independently installable without requesting the network', () => {
    const { source, script, requests } = createSource();
    const repo = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
    const entry = repo.find(entry => entry.key === source.key);
    assert.deepEqual([entry.name, entry.version, entry.fileName], [source.name, source.version, 'v2ph.js']);
    assert.equal(readFileSync(join(root, entry.fileName), 'utf8'), script);
    assert.equal(source.minAppVersion, '1.18.5');
    assert.equal(source.url, '');
    assert.equal(requests.length, 0);
});

test('latest ignores the featured list, canonicalizes album IDs and reads numbered or localized pagination', async () => {
    const { source, requests, documents } = createSource(url => `
        ${cards(card('/album/Featured'))}<h2 id="latest-albums-title">Latest</h2>
        ${cards(card('https://v2ph.com/album/Example-Album/?from=home#cover'), card(), card('https://other.example.invalid/album/Ignore'))}
        ${url.searchParams.get('page') === '1' ? pagination(pageLink('?page=2', '下一页'), pageLink('/?page=32', '末页'),
            pageLink('/category/other?page=99', 'Other'), pageLink('?page=100', 'Disabled', 'disabled')) : ''}`);
    const item = { id, title: 'Demo & Sample', cover: `${cdn}/cover.jpg` };
    assert.deepEqual(plain(await latest(source)(1)), { comics: [item], maxPage: 32 });
    assert.deepEqual(plain(await latest(source)(32)), { comics: [item], maxPage: 32 });
    assert.deepEqual(requests.map(r => r.url), [`${base}/?page=1`, `${base}/?page=32`]);
    assert.equal(requests[0].headers['Accept-Language'], 'en-US,en;q=0.9');
    assert.equal(documents.size, 0);
});

test('popular, keyword search and category/country filtering follow site routes and 1-based pages', async () => {
    const { source, requests } = createSource(() => cards(card()));
    const [[, genre], [, country]] = plain(source.search.optionList.map(option => option.options));
    assert.equal(genre, 'sexy%2Dgirls-Sexy');
    assert.equal(country, 'china-China');
    const southKorea = source.search.optionList[1].options.find(option => option.endsWith('-South Korea')).split('-')[0];
    await source.explore[1].load(2);
    await source.search.load(' 中 & + # ', ['sexy%2Dgirls', southKorea], 3);
    await source.search.load(' ', ['sexy%2Dgirls', southKorea], 4);
    await source.search.load('', ['all', southKorea], 5);
    await source.search.load('', [], 1);
    const parts = source.category.parts;
    assert.deepEqual(plain(parts.map(part => part.categories.length)), [12, 6]);
    const { category, param } = parts[1].categories[2].target.attributes;
    await source.categoryComics.load(category, param, [], 6);
    assert.deepEqual(requests.map(request => request.url), [
        `${base}/category/best-quality?page=2`, `${base}/search/?q=%E4%B8%AD%20%26%20%2B%20%23&page=3`,
        `${base}/category/sexy-girls?page=4`, `${base}/country/south-korea?page=5`,
        `${base}/category/best-quality?page=1`, `${base}/country/south-korea?page=6`,
    ]);
    for (const path of ['https://other.example.invalid/actor/example', '/actor/../example', '/category/%2fexample', '/album/Example']) {
        assert.throws(() => source.categoryComics.load('Invalid', path, [], 1), /invalid archive/);
    }
    assert.equal(requests.length, 6);
});

test('detail exposes source metadata, recommendations, tag archives and link recognition', async () => {
    const { source, requests, documents } = createSource(url => url.pathname.startsWith('/album/') ? `
        <meta property="og:image" content="//images.example.invalid/cover.jpg">
        <h1> Demo &amp; Sample </h1><div class="album-intro"> A sample   gallery. </div>
        <dl><dt>Photos</dt><dd>12</dd><dt>Date:</dt><dd>2025-04-06</dd>
        <dt>Vendor</dt><dd><a href="/vendor/Demo-Publisher">Publisher</a></dd>
        <dt>Model</dt><dd><a href="https://v2ph.com/actor/Demo-Model?hl=en">Example Model</a></dd>
        <dt>Tags</dt><dd><a href="/tag/demo">Demo</a><a href="/tag/demo/">Demo</a>
        <a href="/category/magazine">Magazine</a><a href="/country/japan">Japan</a>
        <a href="https://other.example.invalid/tag/demo">Ignore</a></dd></dl>
        ${cards(card(), card('/album/Other', 'Related', '<img src="data:image/gif;base64,demo" data-src="//images.example.invalid/other.jpg">'))}` : cards(card()));
    assert.deepEqual(plain(await source.comic.loadInfo(id)), {
        title: 'Demo & Sample', cover: `${cdn}/cover.jpg`, description: 'Photos: 12\n\nA sample gallery.',
        tags: { author: ['Publisher'], artist: ['Example Model'], Tags: ['Demo'], Category: ['Magazine'], Country: ['Japan'] },
        chapters: null, url: albumUrl, uploadTime: '2025-04-06',
        recommend: [{ id: 'Other', title: 'Related', cover: `${cdn}/other.jpg` }],
    });
    assert.equal(source.comic.onClickTag('artist', 'Missing'), null);
    for (const [namespace, name, path] of [['artist', 'Example Model', '/actor/Demo-Model'], ['author', 'Publisher', '/vendor/Demo-Publisher'], ['Tags', 'Demo', '/tag/demo']]) {
        const target = source.comic.onClickTag(namespace, name);
        assert.deepEqual(plain(target), { page: 'category', attributes: { category: name, param: path } });
        assert.equal((await source.categoryComics.load(name, path, [], 2)).comics[0].id, id);
    }
    const linkToId = source.comic.link.linkToId;
    assert.equal(linkToId(`${albumUrl}/?page=2#photo`), id);
    assert.equal(linkToId('http://v2ph.com/album/Example-A.html'), 'Example-A.html');
    assert.equal(linkToId(`${base}/album/%e4%b8%ad`), '%E4%B8%AD');
    for (const url of [base + '/tag/demo', 'https://v2ph.com.example.invalid/album/Example', `${base}/album/%2e%2e`, `${base}/album/x%2fy`]) {
        assert.equal(linkToId(url), null);
    }
    await assert.rejects(source.comic.loadInfo(`${id}?page=2`), /invalid album ID/);
    assert.equal(requests.length, 4);
    assert.equal(documents.size, 0);
});

test('reader requests only the chosen album in order and preserves duplicate images and image headers', async () => {
    const images = filenames(1, 21);
    images[10] = images[2];
    const { source, requests, documents } = createSource(url => {
        const page = Number(url.searchParams.get('page') ?? 1);
        const pictures = photos(...images.slice((page - 1) * 10, page * 10));
        return (page === 1 ? count(images.length) : '') + pictures;
    });
    assert.deepEqual(plain(await album(source)), { images });
    assert.deepEqual(requests.map(request => request.url), [albumUrl, `${albumUrl}?page=2`, `${albumUrl}?page=3`]);
    assert.deepEqual(plain(source.comic.onImageLoad(images[0], id, null)), { url: images[0], headers: { Referer: albumUrl } });
    assert.deepEqual(plain(source.comic.onThumbnailLoad(images[0])), { url: images[0], headers: { Referer: `${base}/` } });
    assert.equal(documents.size, 0);
});

test('reader follows pagination when photo count is absent and resolves lazy and relative URLs', async () => {
    const { source, requests } = createSource(url => {
        const page = url.searchParams.get('page');
        if (page === '3') return photos(`${cdn}/03.jpg`);
        if (page === '2') return '<div class="album-photo"><img src="relative.jpg"></div>' + pagination(pageLink('?page=3', 'Next'));
        return `<div class="photos-list"><img src="data:image/gif;base64,demo" data-src="//images.example.invalid/01.jpg"></div>
        ${pagination(pageLink('?page=2', 'Next'))}<aside><img src="/ignore.jpg"></aside>`;
    });
    assert.deepEqual(plain(await album(source)), { images: [`${cdn}/01.jpg`, `${base}/album/relative.jpg`, `${cdn}/03.jpg`] });
    assert.equal(requests.length, 3);
});

test('successfully empty search is distinct from a broken layout, unrelated error or Cloudflare', async () => {
    const { source, documents } = createSource(url => {
        switch (url.searchParams.get('q')) {
            case 'empty': return cards();
            case 'empty message': return '<div class="alert-info">No albums found.</div>';
            case 'broken': return cards('<div class="card">Unrecognized</div>');
            case '403': return { status: 403, body: 'Forbidden' };
            case 'challenge': return { status: 403, body: '', headers: { 'cf-mitigated': 'challenge' } };
            case 'challenge html': return '<title>Just a moment...</title>';
            case 'host challenge': throw 'CloudflareException: https://www.v2ph.com/';
            default: return '<h1>Unexpected layout</h1>';
        }
    });
    const search = query => source.search.load(query, [], 1);
    for (const query of ['empty', 'empty message']) assert.deepEqual(plain(await search(query)), { comics: [], maxPage: 1 });
    await assert.rejects(search('malformed'), /album list not found/);
    await assert.rejects(search('broken'), /unrecognized album cards/);
    await assert.rejects(search('403'), /HTTP 403/);
    await assert.rejects(search('challenge'), /CloudflareException:/);
    await assert.rejects(search('challenge html'), /CloudflareException:/);
    await assert.rejects(search('host challenge'), error => error === `CloudflareException: ${base}/`);
    assert.equal(documents.size, 0);
});

test('guest, paywall, missing pages and repeated page redirects do not return partial albums', async () => {
    for (const [first, second, expected, total] of [
        [count(21) + '<a href="/user/login">Log in</a>' + photos(...filenames(1, 10)), null, /sign-in required/, 1],
        ['<h1>Upgrade</h1><div class="alert-warning"><a href="/user/upgrade">Upgrade</a></div>', null, /requires membership/, 1],
        ['<h1 class="login-box-msg">Sign in</h1>', null, /sign-in required/, 1],
        [count(11) + photos(...filenames(1, 10)), { status: 503, body: '' }, /HTTP 503/, 2],
        [count(11) + photos(...filenames(1, 10)), '<div class="photos-list"><img src="data:invalid"></div>', /unrecognized \(page 2\)/, 2],
        [count(11) + photos(...filenames(1, 10)), photos(...filenames(1, 10)) + pagination(pageLink('?page=1', '1', 'active')), /unrecognized \(page 2\)/, 2],
        [count(12) + photos(...filenames(1, 10)), photos(...filenames(11, 11)), /incomplete album \(11\/12 photos\)/, 2],
        [photos(`${cdn}/01.jpg`) + pagination(pageLink('?page=501', 'Last')), null, /pagination exceeds 500 pages/, 1],
    ]) {
        const { source, requests, documents } = createSource(url => url.search ? second : first);
        await assert.rejects(album(source), expected);
        assert.equal(requests.length, total);
        assert.equal(documents.size, 0);
    }
});

test('manual WebView sign-in validates a real session marker and clears source login data on failure or logout', async () => {
    const storage = new Map([['account', 'ok'], ['_localStorage', { fixture: true }]]);
    let signedIn = true;
    const { source, requests, documents, deletedCookies } = createSource(() =>
        signedIn ? '<a href="/user/logout">Sign out</a>' : '<a href="/user/login">Sign in</a>', storage);
    const login = source.account.loginWithWebview;
    assert.equal(login.url, `${base}/`);
    assert.equal(login.checkStatus(`${base}/`, 'V2PH'), false);
    assert.equal(login.checkStatus(`${base}/user/login`, 'Sign in - V2PH'), false);
    assert.equal(login.checkStatus('https://other.example.invalid/', 'V2PH'), false);
    assert.equal(login.checkStatus(`${base}/`, 'Just a moment...'), false);
    assert.equal(login.checkStatus(`${base}/`, 'V2PH'), true);
    await login.onLoginSuccess();
    assert.equal(requests[0].headers['cache-time'], 'no');
    assert.equal(login.checkStatus(`${base}/`, 'V2PH'), false);
    signedIn = false;
    await assert.rejects(login.onLoginSuccess(), /sign-in could not be confirmed/);
    assert.equal(storage.size, 0);
    storage.set('_localStorage', {});
    source.account.logout();
    assert.equal(storage.size, 0);
    assert.deepEqual(deletedCookies, [`${base}/`, 'https://v2ph.com/']);
    assert.equal(documents.size, 0);
});
