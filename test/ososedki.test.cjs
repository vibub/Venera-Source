const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plain, createSource: createHost } = require('./source-host.cjs');

const base = 'https://ososedki.com';
const id = '-123_456';
const path = `/photos/${id}`;
const archiveApi = '/api/albums';
const createSource = (...args) => createHost('ososedki.js', ...args);
const albums = (html, hasMore) => JSON.stringify({ html, hasMore });
const card = (href, title = 'Fixture &amp; Sample', extra = '') => `<article class="gallery-item">
    <a class="gallery-link" href="${href}"><h3>${title}</h3>${extra}</a></article>`;
const detail = `
    <h1>Different browser title</h1>
    <meta property="og:image" content="https://images.example.invalid/unneeded.jpg">
    <script type="application/ld+json">{"datePublished": "2026-11-20T18:07:00Z"}</script>
    <a href="/model/Model+Slug?tracking=1"> Model &amp; Example  </a>
    <a href="/model/Model+Slug">Model &amp; Example</a>
    <a href="/model/Second">Another Model</a>
    <a href="//www.ososedki.com/cosplay/Character%2BName/">Example Character</a>
    <a href="${base}/fandom/%E6%B8%AC%E8%A9%A6#top">Example Series</a>
    <a href="https://other.example.invalid/model/spoof">Not a tag</a>
    <a href="/model/%E0%A4">Invalid encoding</a>
    <a href="/model/Extra/path">Not an archive</a>
    <a href="/model/+">Empty</a>
    <a href="/images/ignore.jpg">Outside reader</a>
    <div id="photos">
        <a href="/images/a/1280/fixture/10.jpg?x=1&amp;y=2">Page ten</a>
        <a href="${base}/images/a/1280/fixture/2.jpg">Page two</a>
        <a href="//www.ososedki.com/images/a/604/fixture/01.jpg">Page one</a>
        <a href="/images/a/1280/fixture/2.jpg">Duplicate link</a>
        <a href="/images/a/604/fixture/insert.jpg">Insert</a>
        <a href="/images/a/604/fixture/bonus.png">Bonus</a>
        <a href="https://other.example.invalid/images/a/1280/3.jpg">External</a>
        <a href="/photos/23_45">Not an image</a>
        <a href="javascript:fixture">Invalid image</a>
    </div>`;
const params = url => Object.fromEntries(url.searchParams.entries());

test('metadata and supported filters are available without network', () => {
    const { source, requests, script } = createSource();
    assert.deepEqual([source.name, source.key, source.version, source.minAppVersion, source.url],
        ['OSOSEDKI', 'ososedki', '1.0.0', '1.18.5', '']);
    assert.match(script, /92906c0382547f30a03b3176f2f2429be6b54dce/);
    assert.deepEqual(plain(source.search.optionList[0].options), [
        'search-Keyword', 'model-Model', 'cosplay-Character', 'fandom-Series',
    ]);
    assert.equal(source.search.optionList[0].default, 'search');
    assert.equal(source.translation.zh_CN[source.explore[1].title], 'OSOSEDKI · 热门');
    assert.equal(source.translation.zh_TW[source.explore[1].title], 'OSOSEDKI · 熱門');
    assert.equal(requests.length, 0);
});

test('latest and popular use one-based API pages and carry hasMore without guessing', async () => {
    const { source, requests, documents } = createSource(url => {
        assert.equal(url.pathname, archiveApi);
        if (url.searchParams.get('page') === '1') {
            return albums(`<aside><a class="gallery-link" href="/photos/99_99">Not a card</a></aside>` +
                card(`https://www.ososedki.com${path}/?utm=fixture#top`, undefined,
                    '<img class="gallery-img" data-src="//images.example.invalid/lazy.webp" src="/placeholder.jpg">' +
                    '<span class="badge bg-dark">Ignore</span><span class="badge"> Fixture Model </span>'), true);
        }
        return albums(card('/photos/23_45', ' ', '<img class="gallery-img" src="images/sample.jpg" alt="Alt &amp; Sample nude. suffix">'));
    });
    const [latest, popular] = source.explore;
    assert.equal(latest.type, 'multiPageComicList');
    assert.equal(popular.type, 'multiPageComicList');
    const first = { comics: [{ id, title: 'Fixture & Sample', cover: 'https://images.example.invalid/lazy.webp', subtitle: 'Fixture Model' }], maxPage: 2 };
    const second = { comics: [{ id: '23_45', title: 'Alt & Sample', cover: `${base}/images/sample.jpg` }], maxPage: 2 };
    assert.deepEqual(plain(await latest.load(1)), first);
    assert.deepEqual(plain(await latest.load(2)), second);
    assert.deepEqual(plain(await popular.load(1)), first);
    assert.deepEqual(plain(await popular.load(2)), second);
    assert.deepEqual(requests.map(({ url }) => params(new URL(url))), [
        { page: '1' }, { page: '2' }, { page: '1', type: 'top', value: '1' }, { page: '2', type: 'top', value: '1' },
    ]);
    assert.deepEqual(plain(requests[0].headers), {
        Accept: 'application/json', Referer: `${base}/`, 'X-Requested-With': 'XMLHttpRequest',
    });
    assert.equal(documents.size, 0);
});

test('free text, blank search, and the three upstream search filters stay distinct', async () => {
    const { source, requests } = createSource(() => albums(' \n ', false));
    const query = '  詞 & + # ? /  ';
    assert.deepEqual(plain(await source.search.load(query, [], 1)), { comics: [], maxPage: 1 });
    assert.deepEqual(plain(await source.search.load('  ', ['model'], 2)), { comics: [], maxPage: 2 });
    for (const key of ['model', 'cosplay', 'fandom']) await source.search.load(query, [key], 3);
    assert.deepEqual(requests.map(({ url }) => params(new URL(url))), [
        { page: '1', type: 'search', value: query.trim() }, { page: '2', type: 'top', value: '1' },
        ...['model', 'cosplay', 'fandom'].map(type => ({ page: '3', type, value: query.trim() })),
    ]);
});

test('detail is one volume and label chips use the site archive values, not their display text', async () => {
    const { source, requests, documents } = createSource(url => {
        if (url.pathname === path) return detail;
        return albums(card(path), url.searchParams.get('page') === '1');
    });
    const result = await source.comic.loadInfo(id);
    assert.deepEqual(plain(result), {
        title: 'Model & Example - Example Character - Example Series', cover: `${base}/images/albums/-123/456.webp`,
        tags: { model: ['Model & Example', 'Another Model'], cosplay: ['Example Character'], fandom: ['Example Series'] },
        chapters: null, url: `${base}${path}`, subtitle: 'Model & Example, Another Model', uploadTime: '2026-11-20',
    });
    for (const [namespace, label, value] of [
        ['model', 'Model & Example', 'Model Slug'], ['cosplay', 'Example Character', 'Character Name'],
        ['fandom', 'Example Series', '測試'],
    ]) {
        const target = source.comic.onClickTag(namespace, label);
        assert.deepEqual(plain(target), { page: 'search', attributes: { text: value, options: [namespace] } });
        const { text, options } = target.attributes;
        assert.equal((await source.search.load(text, options, 1)).maxPage, 2);
        assert.equal((await source.search.load(text, options, 2)).comics[0].id, id);
        assert.deepEqual(params(new URL(requests.at(-1).url)), { page: '2', type: namespace, value });
    }
    assert.equal(source.comic.onClickTag('model', 'Not a tag'), null);
    assert.equal(result.recommend, undefined);
    assert.equal(documents.size, 0);
});

test('detail can use the clean heading without tags and omits untrustworthy dates', async () => {
    const { source } = createSource(() => `<h1>Example Gallery (12 leaked photos) from Onlyfans, Patreon and Fansly</h1>
        <div id="photos"></div><script type="application/ld+json">{"datePublished":"2026-02-30T09:00:00Z"}</script>`);
    assert.deepEqual(plain(await source.comic.loadInfo('23_45')), {
        title: 'Example Gallery', cover: `${base}/images/albums/23/45.webp`, tags: {},
        chapters: null, url: `${base}/photos/23_45`,
    });
});

test('deep links resolve album IDs synchronously; pasted archive URLs use the archive API', async () => {
    const { source, requests } = createSource(url => url.pathname === path ? detail : albums(card(path), false));
    const { linkToId, domains } = source.comic.link;
    assert.deepEqual(plain(domains), ['ososedki.com', 'www.ososedki.com']);
    assert.equal(linkToId(`${base}${path}#anchor`), id);
    assert.equal(linkToId(`http://www.ososedki.com${path.replace('-', '%2D')}/?ref=test`), id);
    for (const href of [`https://ososedki.com.example.invalid${path}`, `${base}/photos/not-an-id`,
        `${base}${path}/extra`, `${base}/model/Demo`, `${base}/photos/%FF`]) assert.equal(linkToId(href), null);
    assert.equal((await source.search.load(`${base}${path}/?a=1`, [], 1)).comics[0].id, id);
    assert.deepEqual(plain(await source.search.load(`${base}${path}`, [], 2)), { comics: [], maxPage: 1 });
    assert.equal((await source.search.load(`http://www.ososedki.com/fandom/Some+Title/?d=1`, [], 4)).comics[0].id, id);
    assert.deepEqual(plain(await source.search.load('https://other.example.invalid/photos/23_45', [], 1)), { comics: [], maxPage: 1 });
    assert.equal(requests.length, 2);
    assert.deepEqual(params(new URL(requests[1].url)), { page: '4', type: 'fandom', value: 'Some Title' });
});

test('single-volume reading keeps only album anchors, deduplicates and sorts numeric filenames', async () => {
    const { source, requests, documents } = createSource(() => detail);
    assert.deepEqual(plain(await source.comic.loadEp(id, null)), { images: [
        'https://www.ososedki.com/images/a/604/fixture/01.jpg', `${base}/images/a/1280/fixture/2.jpg`,
        `${base}/images/a/1280/fixture/10.jpg?x=1&y=2`, `${base}/images/a/604/fixture/insert.jpg`,
        `${base}/images/a/604/fixture/bonus.png`,
    ] });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${base}${path}`);
    assert.equal(documents.size, 0);
});

test('thumbnail configuration is synchronous and only a confirmed 1280-image 404 retries at 604', async () => {
    let status = 404;
    const { source, requests } = createSource((_url, request) => {
        assert.equal(request.method, 'HEAD');
        return { status, body: '' };
    });
    const url = `${base}/images/a/1280/fixture/2.jpg?x=1`;
    const config = source.comic.onImageLoad(url, id, null);
    const headers = { Referer: `${base}/` };
    assert.deepEqual(plain(source.comic.onThumbnailLoad(url)), { url, headers });
    assert.deepEqual(plain(config.headers), headers);
    assert.equal(requests.length, 0);
    const fallback = await config.onLoadFailed();
    assert.equal(fallback.onLoadFailed, undefined);
    assert.deepEqual(plain(fallback), { url: url.replace('/1280/', '/604/'), headers });
    assert.deepEqual(plain(requests[0].headers), { ...headers, 'cache-time': 'no' });
    assert.equal(requests[0].url, url);
    for (status of [200, 403, 405, 429, 503]) assert.equal(await config.onLoadFailed(), null);
    assert.equal(requests.length, 6);
    for (const other of [`${base}/images/a/604/fixture/2.jpg`, 'https://images.example.invalid/images/a/1280/2.jpg']) {
        assert.equal(source.comic.onImageLoad(other, id, null).onLoadFailed, undefined);
    }
});

test('empty list, malformed API or HTML, HTTP refusal, and invalid album links are distinct', async () => {
    let data = albums('');
    const { source, documents, requests } = createSource(() => data);
    const load = source.explore[0].load;
    assert.deepEqual(plain(await load(1)), { comics: [], maxPage: 1 });
    for (const [response, error] of [
        ['<html><h1>Verify</h1></html>', /invalid album list JSON/], ['null', /invalid album list response/],
        ['{}', /invalid album list response/], [albums('', 'false'), /invalid album list response/],
        [albums('', true), /album cards missing/], [albums('<h1>Verify</h1>', false), /album cards missing/],
        [albums(card('https://other.example.invalid/photos/1_2')), /invalid album link/],
        [albums(card('/photos/23_45', ' ')), /title missing/],
        [{ status: 403, body: '' }, /HTTP 403/],
    ]) {
        data = response;
        await assert.rejects(load(1), error);
        assert.equal(documents.size, 0);
    }
    await assert.rejects(source.comic.loadInfo(id), /HTTP 403/);
    await assert.rejects(source.comic.loadEp(id, null), /HTTP 403/);
    data = '<h1>Verify</h1>';
    await assert.rejects(source.comic.loadInfo(id), /detail structure/);
    data = '<div id="photos"><a href="/not-an-image.jpg">Non-gallery content</a></div>';
    await assert.rejects(source.comic.loadInfo(id), /title missing/);
    await assert.rejects(source.comic.loadEp(id, null), /images missing/);
    const count = requests.length;
    await assert.rejects(source.comic.loadInfo('../other'), /invalid album ID/);
    assert.equal(requests.length, count);
    assert.equal(documents.size, 0);
});
