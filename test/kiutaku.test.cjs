const assert = require('node:assert/strict');
const test = require('node:test');
const { createSource, plain } = require('./source-host.cjs');

const base = 'https://kiutaku.com';
const pageImage = name => `https://img.invalid/${name}.webp`;
const card = (href, title, cover = '//img.invalid/cover.webp') =>
    `<div class="items-row"><a class="item-link" href="${href}"><img src="${cover}"></a><h2>${title}</h2></div>`;
const listing = (rows, pager = '', view = 'items') => `
    <div class="main-body container view-${view}">
        <div class="blog">${rows}</div><nav class="pagination">${pager}</nav>
    </div><div class="blog">${card('/99', 'Sidebar')}</div>`;
const nav = links => `<nav class="pagination"><div class="pagination-list">${links}</div></nav>`;
const pageLink = (label, href, current = false) =>
    `<a class="pagination-link${current ? ' is-current' : ''}" href="${href}">${label}</a>`;
const gallery = (title, links, images, extra = '') => `
    <div class="article-header"><h1>${title}</h1></div>
    ${nav(links)}<div class="article-fulltext">${images.map(src => `<img src="${src}">`).join('')}</div>${nav(links)}${extra}`;
const setup = respond => createSource('kiutaku.js', respond);

test('loads without requests and resolves links to a stable numeric ID', () => {
    const { source, requests } = setup();
    assert.deepEqual([source.name, source.key, source.version, source.minAppVersion, source.url],
        ['Kiutaku', 'kiutaku', '1.0.0', '1.18.5', '']);
    for (const link of [`${base}/123`, `${base}/123/?page=2#images`, 'http://www.kiutaku.com/123?page=3']) {
        assert.equal(source.comic.link.linkToId(link), '123');
    }
    for (const link of ['https://elsewhere.invalid/123', '//kiutaku.com.invalid/123', `${base}/tag/123`, `${base}/hot`, `${base}/123/456`]) {
        assert.equal(source.comic.link.linkToId(link), null);
    }
    assert.deepEqual(requests, []);
});

test('loads real latest and hot paths, encodes search, and advances by 20', async () => {
    const { source, requests, documents } = setup(url => {
        const page = Number(url.searchParams.get('start')) / 20 + 1;
        const query = url.searchParams.has('search') ? 'search=sample%20%26%20%E6%B5%8B%E8%AF%95&amp;' : '';
        return listing(card('/123/?page=1#first', 'Sample &amp; Example') + card('/123', 'Duplicate') +
            card('https://elsewhere.invalid/456', 'Foreign'),
        `<a class="pagination-next" href="${url.pathname}?${query}start=900">Last</a>${page === 3 ? '' :
            `<a class="pagination-next" href="${url.pathname}?${query}start=${page * 20}">Next</a>`}`, url.pathname === '/hot' ? 'hot' : 'items');
    });
    const expected = [{ id: '123', title: 'Sample & Example', cover: pageImage('cover') }];
    assert.deepEqual(plain(await source.explore[0].load(1)), { comics: expected, maxPage: 2 });
    assert.deepEqual(plain(await source.explore[1].load(2)), { comics: expected, maxPage: 3 });
    assert.deepEqual(plain(await source.search.load(' sample & 测试 ', [], 3)), { comics: expected, maxPage: 3 });
    assert.deepEqual(requests.map(e => e.url), [
        `${base}/?start=0`, `${base}/hot?start=20`, `${base}/?search=sample%20%26%20%E6%B5%8B%E8%AF%95&start=40`,
    ]);
    assert.ok(requests.every(e => !Object.keys(e.headers).some(key => key.toLowerCase() === 'referer')));
    assert.equal(documents.size, 0);
});

test('registers Venera category metadata and routes both real browse entries', async () => {
    const { source, requests } = setup(url => listing(card('/123', 'Sample'), '', url.pathname === '/hot' ? 'hot' : 'items'));
    assert.equal(source.category.title, 'Kiutaku');
    const [part] = source.category.parts;
    assert.equal(part.type, 'fixed');
    assert.deepEqual(plain(part.categories.map(item => item.target.attributes.param)), ['/', '/hot']);
    for (const item of part.categories) {
        const { page, attributes } = item.target;
        assert.equal(page, 'category');
        assert.equal(attributes.category, item.label);
        assert.equal((await source.categoryComics.load(attributes.category, attributes.param, [], 2)).comics.length, 1);
    }
    assert.throws(() => source.categoryComics.load('Invalid', '/other', [], 1), /invalid gallery archive/);
    assert.deepEqual(requests.map(e => e.url), [`${base}/?start=20`, `${base}/hot?start=20`]);
});

test('separates explicit empty results from HTTP and markup failures', async () => {
    const { source, documents } = setup(url => {
        switch (url.searchParams.get('search')) {
            case 'empty': return '<div class="main-body view-items"><pre>No item here!</pre></div>';
            case 'http': return { status: 403, body: '<html>Cloudflare</html>' };
            case 'changed': return '<div class="main-body view-items"><p>New layout</p></div>';
            case 'bad-row': return listing(card('/tag/4', 'Not a gallery'));
            default: return '<html><title>Just a moment...</title></html>';
        }
    });
    const search = term => source.search.load(term, [], 1);
    assert.deepEqual(plain(await search('empty')), { comics: [], maxPage: 1 });
    await assert.rejects(search('http'), /HTTP 403/);
    for (const term of ['challenge', 'changed', 'bad-row']) await assert.rejects(search(term), /gallery list not found/);
    assert.equal(documents.size, 0);
});

test('parses details, deduplicates tag controls and recommendations, and jumps to the exact tag archive', async () => {
    const tags = '<div class="article-tags"><a class="tag" href="/tag/17"><span>#Sample &amp; Tag</span></a>' +
        '<a class="tag" href="https://elsewhere.invalid/tag/18"><span>#Foreign</span></a></div>';
    const { source, requests, documents } = setup(url => url.pathname === '/tag/17' ? listing(card('/124', 'Recommendation')) :
        gallery('Sample Gallery - (Page 1 / 1)', pageLink('1', '/123', true), [pageImage('a')], tags + tags +
            `<div class="bottom-articles">${card('/123?page=2', 'Self')}${card('/124', 'Recommendation')}${card('/124', 'Duplicate')}</div>`));
    const info = plain(await source.comic.loadInfo('123'));
    assert.deepEqual(info, {
        title: 'Sample Gallery', cover: pageImage('a'), tags: { tag: ['Sample & Tag'] }, chapters: null,
        recommend: [{ id: '124', title: 'Recommendation', cover: pageImage('cover') }], url: `${base}/123`,
    });
    const target = source.comic.onClickTag('tag', 'Sample & Tag');
    assert.deepEqual(plain(target), { page: 'category', attributes: { category: 'Sample & Tag', param: '/tag/17' } });
    assert.equal(source.comic.onClickTag('other', 'Sample & Tag'), null);
    assert.equal(source.comic.onClickTag('tag', 'Foreign'), null);
    const result = await source.categoryComics.load(target.attributes.category, target.attributes.param, [], 2);
    assert.deepEqual(plain(result.comics), info.recommend);
    assert.equal(requests[1].url, `${base}/tag/17?start=20`);
    assert.equal(documents.size, 0);
});

test('loads gallery source pages in numerical order and keeps repeated image URLs', async () => {
    const { source, requests, documents } = setup(url => {
        const current = Number(url.searchParams.get('page') || 1);
        const links = pageLink('3', `${base}/123?page=3`, current === 3) + pageLink('1', '/123', current === 1) +
            pageLink('3', '/123?page=3') + pageLink('2', '?page=2', current === 2) +
            pageLink('9', '/456?page=9') + pageLink('Next', '/123?page=2');
        return gallery('Sample Gallery', links,
            current === 1 ? [pageImage('a'), pageImage('a'), '//img.invalid/b.webp'] :
            current === 2 ? [pageImage('b'), '/local.webp'] : [pageImage('c')],
            `<div class="bottom-articles"><img src="${pageImage('unrelated')}"></div>`);
    });
    const images = [pageImage('a'), pageImage('a'), pageImage('b'), pageImage('b'), `${base}/local.webp`, pageImage('c')];
    assert.deepEqual(plain(await source.comic.loadEp('123', null)), { images });
    assert.deepEqual(requests.map(e => e.url), [`${base}/123`, `${base}/123?page=2`, `${base}/123?page=3`]);
    assert.deepEqual(plain(source.comic.onThumbnailLoad(pageImage('a'))), { url: pageImage('a') });
    assert.deepEqual(plain(await source.comic.onImageLoad(pageImage('a'), '123', null)), { url: pageImage('a') });
    assert.equal(documents.size, 0);
});

test('rejects missing source pages and a later response serving page one again', async () => {
    const { source, documents } = setup(url => {
        const links = pageLink('1', url.pathname, true) + (url.pathname === '/123' ? '' : pageLink('2', '/456?page=2'));
        return gallery('Sample Gallery - (Page 1 / 2)', links, [pageImage('a')]);
    });
    await assert.rejects(source.comic.loadEp('123', ''), /incomplete gallery pagination/);
    await assert.rejects(source.comic.loadEp('456', null), /unexpected gallery page 2/);
    assert.equal(documents.size, 0);
});

test('rejects missing or unusable images and disposes the document on failure', async () => {
    const { source, documents } = setup(url => gallery('Sample Gallery', '', url.pathname === '/123' ? [] : ['data:,placeholder']));
    for (const id of ['123', '456']) await assert.rejects(source.comic.loadEp(id, null), /gallery images missing/);
    assert.equal(documents.size, 0);
});
