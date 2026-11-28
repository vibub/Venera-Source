const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSource: host, plain } = require('./source-host.cjs');

const base = 'https://jjcos.com';
const archive = '/tag/HSQ2151O0wZ';
const id = 'Cosplay%20%E6%A0%B7%E6%9C%AC';
const album = `${base}/post/${id}`;
const makeSource = respond => host('jjcos.js', respond);
const card = (href = 'https://www.jjcos.com/post/Cosplay 样本/?source=archive', title = 'Demo &amp; Sample') => `<article class="custom-article">
    <figure><img src="/cover.webp"></figure><h3 class="fh5co-article-title"><a href="${href}">${title}</a></h3></article>`;
const archiveHtml = (cards = '', pager = '') => `<div class="row fh5co-post-entry">${cards}</div><ul class="pagination-ul">${pager}</ul>`;
const detail = `<h1 class="fh5co-article-title">Demo &amp; Sample - JJCOS</h1>
    <meta property="article:published_time" content="2026-01-09T09:00:00Z">
    <div class="tag-container"><a class="tag" href="/tag/demo-1/"># Theme</a>
    <a class="tag" href="https://jjcos.com/tag/demo-1/"># Theme</a></div>
    <div id="post-content"><img src="data:image/gif;base64,demo" data-src="//images.example.invalid/01.jpg">
    <img src="part.jpg"><img src="//images.example.invalid/01.jpg"></div>
    <aside><img src="/unrelated.webp"></aside>`;

test('archive browse and the Cosplay category use the real tag route and numbered pages', async () => {
    const { source, requests, documents } = makeSource(url => archiveHtml(card() + card(),
        url.pathname.endsWith('/2/') ? '' : `<a href="${archive}/page/2">2</a><a href="${archive}/page/18">Last</a>
            <a href="https://other.example.invalid${archive}/page/99">External</a><a href="/tag/unrelated/page/90">Other tag</a>`));
    assert.equal(source.explore.length, 1);
    const result = await source.explore[0].load(1);
    assert.deepEqual(plain(result), { comics: [{ id, title: 'Demo & Sample', cover: base + '/cover.webp' }], maxPage: 18 });
    const category = source.category.parts[0].categories[0].target.attributes;
    assert.equal((await source.categoryComics.load(category.category, category.param, [], 2)).maxPage, 2);
    assert.equal((await source.search.load('  ', [], 1)).comics[0].id, id);
    assert.deepEqual(requests.map(request => request.url), [base + archive + '/', base + archive + '/page/2/', base + archive + '/']);
    assert.throws(() => source.categoryComics.load('bad', '/tag/../post', [], 1), /invalid tag archive/);
    assert.equal(documents.size, 0);
});

test('search queries share one index fetch and paginate after title and content filtering', async () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({
        title: i === 21 ? 'Other title' : `Sample cosplay ${i + 1}`,
        content: i === 21 ? 'A COSPLAY gallery' : '',
        link: `/post/sample-${i + 1}/`, feature: '//images.example.invalid/cover.jpg',
    }));
    const { source, requests } = makeSource(() => JSON.stringify({ posts: [...rows, rows[0]] }));
    const [first, second, empty] = await Promise.all([
        source.search.load(' cosplay ', [], 1), source.search.load('cosplay', [], 2), source.search.load('不匹配 & #', [], 1),
    ]);
    assert.equal(first.comics.length, 20);
    assert.equal(first.maxPage, 2);
    assert.deepEqual(plain(second.comics.map(comic => comic.title)), ['Sample cosplay 21', 'Other title']);
    assert.equal(second.maxPage, 2);
    assert.deepEqual(plain(empty), { comics: [], maxPage: 1 });
    assert.deepEqual(requests.map(request => request.url), [base + '/api/']);
});

test('details, direct links and tag archives keep the same ID; reader preserves repeat images', async () => {
    const { source, requests, documents } = makeSource(url => url.pathname.startsWith('/tag/') ? archiveHtml(card()) : detail);
    const direct = source.comic.link.linkToId;
    assert.equal(direct(album + '/?tracking=1#first'), id);
    assert.equal(direct('https://www.jjcos.com/post/Cosplay 样本/'), id);
    for (const url of ['/post/%2Ffake', '/post/%2e%2e', '/post/two//parts', 'https://evil.example.invalid/post/demo', '/tag/demo']) {
        assert.equal(direct(url), null);
    }
    assert.deepEqual(plain(await source.comic.loadInfo(id)), {
        title: 'Demo & Sample', cover: 'https://images.example.invalid/01.jpg', tags: { Tags: ['Theme'] },
        chapters: null, uploadTime: '2026-01-09', url: album,
    });
    const target = source.comic.onClickTag('Tags', 'Theme');
    assert.deepEqual(plain(target), { page: 'category', attributes: { category: 'Theme', param: '/tag/demo-1' } });
    assert.equal((await source.categoryComics.load('Theme', target.attributes.param, [], 1)).comics[0].id, id);
    const img = 'https://images.example.invalid/01.jpg';
    assert.deepEqual(plain(await source.comic.loadEp(id, null)), { images: [img, base + '/post/part.jpg', img] });
    assert.deepEqual(plain(source.comic.onImageLoad(img, id, null)), { url: img, headers: { Referer: album } });
    assert.deepEqual(plain(source.comic.onThumbnailLoad(img)), { url: img, headers: { Referer: base + '/' } });
    assert.deepEqual(requests.map(r => r.url), [album, base + '/tag/demo-1/', album]);
    assert.equal(documents.size, 0);
});

test('empty archive, broken layouts, HTTP denial and malformed index are not confused', async () => {
    for (const [response, expected] of [['<main>Oops</main>', /tag archive not found/],
        [archiveHtml('<article class="custom-article">Broken card</article>'), /unrecognized archive/],
        [{ status: 403, body: 'Access denied' }, /HTTP 403/],
        [{ status: 403, headers: { 'cf-mitigated': 'challenge' }, body: '' }, /CloudflareException/]]) {
        const { source, documents } = makeSource(() => response);
        await assert.rejects(source.explore[0].load(1), expected);
        assert.equal(documents.size, 0);
    }
    const { source, requests } = makeSource(url => url.pathname.startsWith('/tag/') ? archiveHtml() :
        [{}, '{', { posts: [] }].map(x => typeof x === 'string' ? x : JSON.stringify(x))[requests.length - 2]);
    assert.deepEqual(plain(await source.explore[0].load(1)), { comics: [], maxPage: 1 });
    await assert.rejects(source.search.load('sample', [], 1), /post index not found/);
    await assert.rejects(source.search.load('sample', [], 1), /invalid list JSON/);
    assert.deepEqual(plain(await source.search.load('sample', [], 1)), { comics: [], maxPage: 1 });
    const { source: missing, documents } = makeSource(() => '<h1 class="fh5co-article-title">Example</h1>');
    await assert.rejects(missing.comic.loadEp(id, null), /album images missing/);
    assert.equal(documents.size, 0);
});
