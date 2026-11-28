const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plain, createSource: createHost } = require('./source-host.cjs');

const base = 'https://hentai-cosplay-xxx.com';
const cdn = 'https://cdn.example.invalid';
const id = 'sample-gallery';
const imagePath = `/image/${id}/`;
const storyPath = `/story/${id}/`;
const createSource = respond => createHost('hentaicosplay.js', respond);
const desktop = (href = imagePath, title = 'Demo &amp; Sample', image = `<img src="${cdn}/cover.jpg">`) => `
    <div class="image-list-item"><a href="${href}">${image}<span class="image-list-item-title">${title}</span></a></div>`;
const mobile = (href = imagePath) => `<li><a href="${href}">
    <img src="//cdn.example.invalid/cover.jpg"><span class="posted">2026/1/2</span><span>Demo &amp; Sample</span>
    </a></li>`;
const details = (other = '') => `<meta property="og:title" content="Demo - Sample - Hentai Cosplay">
    <meta property="og:image" content="//cdn.example.invalid/cover.jpg">${other}`;
const loadLatest = (source, page = 1) => source.explore[0].load(page);
const loadImages = source => source.comic.loadEp(id, null);

function assertHeaders(requests) {
    assert.deepEqual(plain(requests.map(request => request.headers)),
        requests.map(() => ({ Accept: 'text/html', Referer: `${base}/` })));
}

test('install metadata and locale labels are available without requests', () => {
    const { source, requests, script } = createSource();
    assert.deepEqual([source.name, source.key, source.version, source.minAppVersion, source.url],
        ['Hentai Cosplay', 'hentaicosplay', '1.0.0', '1.18.5', '']);
    assert.match(script, /9f70fabf1105390dca5d5b3ae52d1cd8113afa7d\/lib-multisrc\/hentaicosplayxxx/);
    assert.equal(source.translation.zh_CN[source.name], '成人角色扮演');
    assert.equal(source.translation.zh_TW[source.name], '成人角色扮演');
    for (const entry of source.explore) {
        assert.ok(source.translation.zh_CN[entry.title]);
        assert.ok(source.translation.zh_TW[entry.title]);
    }
    assert.equal(requests.length, 0);
});

test('desktop latest and mobile popular pagination end at the last page advertised', async () => {
    const { source, requests, documents } = createSource(url => {
        if (url.pathname.startsWith('/search/')) {
            return `${desktop(`${base}${imagePath}?from=latest#cover`, 'Demo &amp; Sample', '<img src="http://cdn.example.invalid/cover.jpg">')}
                ${desktop()}${desktop(`https://other.example.invalid${imagePath}`, 'Ignore')}
                ${url.pathname === '/search/' ? '<div class="wp-pagenavi"><a rel="next" href="/search/page/2/">Next</a></div>' : ''}`;
        }
        return `<ul id="entry_list">${mobile()}<li><a href="/tag/ignore/">Other</a></li></ul>
            ${url.pathname === '/ranking/' ? '<a class="paginator_page" href="/ranking/page/2/" rel="next">Next</a>' : ''}`;
    });
    const comics = [{ id, title: 'Demo & Sample', cover: `${cdn}/cover.jpg` }];
    for (const loader of source.explore) {
        assert.deepEqual(plain(await loader.load(1)), { comics, maxPage: 2 });
        assert.deepEqual(plain(await loader.load(2)), { comics, maxPage: 2 });
    }
    assert.deepEqual(requests.map(request => new URL(request.url).pathname),
        ['/search/', '/search/page/2/', '/ranking/', '/ranking/page/2/']);
    assertHeaders(requests);
    assert.equal(documents.size, 0);
});

test('keyword search encodes path data, falls back to latest, and resolves pasted gallery URLs', async () => {
    const { source, requests, documents } = createSource(url => url.pathname === imagePath ? details() : desktop());
    const search = (query, page) => source.search.load(query, [], page);
    await search(' 示例 / & + # ? ', 3);
    await search('   ', 1);
    assert.deepEqual(plain(await search(`${base}${storyPath}?page=4#photo`, 1)), {
        comics: [{ id, title: 'Demo - Sample', cover: `${cdn}/cover.jpg` }], maxPage: 1,
    });
    assert.deepEqual(plain(await search('https://other.example.invalid/image/test/', 1)), { comics: [], maxPage: 1 });
    assert.deepEqual(requests.map(request => new URL(request.url).pathname), [
        '/search/keyword/%E7%A4%BA%E4%BE%8B+%2F+%26+%2B+%23+%3F/page/3/', '/search/', imagePath,
    ]);
    assert.equal(documents.size, 0);
});

test('ranked taxonomy loads on demand and preserves slug values through the category dropdown', async () => {
    const { source, requests, documents } = createSource(url => url.pathname === '/ranking-tag/' ? `
        <ul id="tags"><li><a href="/search/tag/some-demo/">Some-Demo (42)</a></li>
        <li><a href="${base}/search/tag/%E6%B8%AC%E8%A9%A6/">測試 (8)</a></li>
        <li><a href="/tag/some-demo/?from=rank">Not a second option</a></li>
        <li><a href="https://other.example.invalid/tag/ignore/">Ignore</a></li></ul><a href="/tag/sidebar/">Sidebar</a>` : desktop());
    const ranked = source.category.parts[0].categories[0].target;
    assert.deepEqual(plain(ranked), { page: 'category', attributes: { category: 'Ranked Tags', param: 'tags' } });
    const { category, param } = ranked.attributes;
    const [select] = await source.categoryComics.optionLoader(category, param);
    assert.deepEqual(plain(select), { label: 'Ranked Tags', options: [
        'all-All', '%2Fsearch%2Ftag%2Fsome%2Ddemo%2F-Some-Demo', '%2Fsearch%2Ftag%2F%25E6%25B8%25AC%25E8%25A9%25A6%2F-測試',
    ] });
    await source.categoryComics.load(category, param, [select.options[1].split('-')[0]], 3);
    await source.categoryComics.load(category, param, [select.options[2].split('-')[0]], 2);
    await source.categoryComics.load(category, param, ['all'], 1);
    assert.deepEqual(requests.map(request => new URL(request.url).pathname), [
        '/ranking-tag/', '/search/tag/some-demo/page/3/', '/search/tag/%E6%B8%AC%E8%A9%A6/page/2/', '/search/',
    ]);
    assert.equal(documents.size, 0);
});

test('details, recommendation metadata, tag archives and deep links agree on the gallery ID', async () => {
    const { source, requests, documents } = createSource(url => url.pathname === imagePath ? details(`
        <div id="detail_tag"><a href="${base}/search/tag/archived-slug/?q=tag#item">Example Label</a>
        <a href="/search/tag/archived-slug/">Duplicate label</a><a href="/tag/other-tag/">Other</a>
        <a href="https://other.example.invalid/tag/ignored/">Ignore</a></div>
        <a href="/tag/sidebar/">Sidebar</a>
        <a href="${imagePath}"><amp-img class="related-thumbnail" src="${cdn}/self.jpg" alt="Self"></amp-img></a>
        <a href="/image/related/"><amp-img class="related-thumbnail" src="${cdn}/related.jpg" alt="Related &amp; More"></amp-img></a>
        <a href="/story/related/"><img class="related-thumbnail" src="${cdn}/duplicate.jpg" alt="Duplicate"></a>
        <a href="/image/menu/"><img src="${cdn}/menu.jpg" alt="Not a recommendation"></a>
    `) : desktop());
    assert.deepEqual(plain(await source.comic.loadInfo(id)), {
        title: 'Demo - Sample', cover: `${cdn}/cover.jpg`, tags: { Tags: ['Example Label', 'Other'] },
        chapters: null, url: `${base}${imagePath}`,
        recommend: [{ id: 'related', title: 'Related & More', cover: `${cdn}/related.jpg` }],
    });
    const jump = source.comic.onClickTag('Tags', 'Example Label');
    assert.deepEqual(plain(jump), { page: 'category', attributes: { category: 'Example Label', param: '/search/tag/archived-slug/' } });
    await source.categoryComics.load(jump.attributes.category, jump.attributes.param, [], 2);
    for (const arguments_ of [['Tags', 'Sidebar'], ['other', 'Example Label']]) {
        assert.equal(source.comic.onClickTag(...arguments_), null);
    }
    const { linkToId } = source.comic.link;
    assert.deepEqual(plain(source.comic.link.domains), ['hentai-cosplay-xxx.com']);
    assert.equal(linkToId(`${base}${imagePath}`), id);
    assert.equal(linkToId(`${base}${storyPath}?q=x#page-2`), id);
    assert.equal(linkToId(`${base}/image/%e6%b8%ac%e8%a9%a6`), '%E6%B8%AC%E8%A9%A6');
    for (const url of [
        `${base}/tag/example/`, `${base}/story/`, `${base}/image/name/rest/`, `${base}/image/%2e%2e/`,
        `${base}/image/%ff/`, `${base}/image/x%2fy/`, 'https://hentai-cosplay-xxx.com.example.invalid/image/test/',
    ]) assert.equal(linkToId(url), null);
    await assert.rejects(source.comic.loadInfo('../example'), /invalid gallery ID/);
    assert.throws(() => source.categoryComics.load('Bad', '/tag/%2fexample/', [], 1), /invalid tag archive/);
    assert.deepEqual(requests.map(request => new URL(request.url).pathname), [imagePath, '/search/tag/archived-slug/page/2/']);
    assert.equal(documents.size, 0);
});

test('detail reads recommendation cards from its linked reader page without downloading images', async () => {
    const { source, requests, documents } = createSource(url => url.pathname === imagePath ?
        details(`<a href="${storyPath}">Read</a>`) : `<div class="related-list"><a href="/image/related/">
        <amp-img class="related-thumbnail" src="${cdn}/related.jpg"></amp-img><span class="related-title">Related</span>
        </a></div>`);
    const info = await source.comic.loadInfo(id);
    assert.deepEqual(plain(info.recommend), [{ id: 'related', title: 'Related', cover: `${cdn}/related.jpg` }]);
    assert.deepEqual(requests.map(request => new URL(request.url).pathname), [imagePath, storyPath]);
    assert.equal(documents.size, 0);
    const failed = createSource(url => url.pathname === imagePath ? details(`<a href="${storyPath}">Read</a>`) :
        { status: 503, body: '' });
    assert.equal((await failed.source.comic.loadInfo(id)).recommend, undefined);
    assert.match(failed.logs[0][2], /HTTP 503/);
});

test('story provides AMP image URLs in DOM order without removing repeats or loading thumbnails', async () => {
    const { source, requests, documents } = createSource(url => {
        assert.equal(url.pathname, storyPath);
        return `<amp-img src="${cdn}/upload/10.jpg"></amp-img>
            <amp-img class="extra related-thumbnail" src="${cdn}/upload/related.jpg"></amp-img>
            <img src="${cdn}/upload/ignore.jpg"><amp-img src="${cdn}/advert.jpg"></amp-img>
            <amp-img src="//cdn.example.invalid/upload/2.jpg?x=3&amp;y=4"></amp-img>
            <amp-img src="/upload/1.jpg"></amp-img>
            <amp-img src="${cdn}/upload/10.jpg"></amp-img>`;
    });
    const images = [`${cdn}/upload/10.jpg`, `${cdn}/upload/2.jpg?x=3&y=4`, `${base}/upload/1.jpg`, `${cdn}/upload/10.jpg`];
    assert.deepEqual(plain(await loadImages(source)), { images });
    assert.deepEqual(plain(source.comic.onImageLoad(images[0], id, null)), { url: images[0], headers: { Referer: `${base}/` } });
    assert.deepEqual(plain(source.comic.onThumbnailLoad(`${cdn}/cover.jpg`)), { url: `${cdn}/cover.jpg`, headers: { Referer: `${base}/` } });
    assert.equal(requests.length, 1);
    assertHeaders(requests);
    assert.equal(documents.size, 0);
});

test('legitimate emptiness, structure drift, HTTP failures and verification are distinct', async () => {
    const cases = new Map([
        ['empty-mobile', ['<ul id="entry_list"></ul>', null]],
        ['empty-message', ['<div class="no-results">No results.</div>', null]],
        ['bad-layout', ['<h1>Unexpected layout</h1>', /gallery list not found/]],
        ['bad-cards', ['<ul id="entry_list"><li>Wrong card</li></ul>', /unrecognized gallery cards/]],
        ['forbidden', [{ status: 403, body: '<div class="no-results"></div>' }, /HTTP 403/]],
        ['missing', [{ status: 404, body: '' }, /HTTP 404/]],
        ['server', [{ status: 503, body: '' }, /HTTP 503/]],
        ['verification', ['<title>Just a moment...</title><ul id="entry_list"></ul>', /verification or access-denied/]],
    ]);
    const { source, documents } = createSource(url => cases.get(url.pathname.split('/')[3])[0]);
    for (const [query, [, expected]] of cases) {
        const result = source.search.load(query, [], 1);
        if (expected) await assert.rejects(result, expected);
        else assert.deepEqual(plain(await result), { comics: [], maxPage: 1 });
        assert.equal(documents.size, 0);
    }
});

test('missing detail, taxonomy and story structures fail without leaking HTML documents', async () => {
    for (const [path, html, call, error] of [
        [imagePath, '<body>Not a gallery</body>', source => source.comic.loadInfo(id), /gallery title not found/],
        ['/ranking-tag/', '<ul id="not-tags"></ul>', source => source.categoryComics.optionLoader('Ranked Tags', 'tags'), /ranked tag list not found/],
        [storyPath, `<amp-img src="${cdn}/upload/related.jpg" class="related-thumbnail"></amp-img>`, loadImages, /gallery images missing/],
        [storyPath, `<amp-img src="${cdn}/upload/1.jpg"></amp-img><amp-img src="data:upload,bad"></amp-img>`, loadImages, /gallery images missing/],
    ]) {
        const { source, documents, requests } = createSource(url => { assert.equal(url.pathname, path); return html; });
        await assert.rejects(call(source), error);
        assert.equal(requests.length, 1);
        assert.equal(documents.size, 0);
    }
});
