const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { load } = require('cheerio');

const root = join(__dirname, '..');
const base = 'https://cosplaytele.com';
const script = readFileSync(join(root, 'cosplaytele.js'), 'utf8');
const className = script.match(/^\s*class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+extends\s+ComicSource\b/m)[1];
const id = '%2Fdemo-gallery%2F';

function createSource(respond = () => assert.fail('Unexpected request')) {
    const requests = [];
    const documents = new Set();
    class HtmlDocument {
        constructor(html) {
            const $ = load(html);
            documents.add(this);
            const check = () => assert.ok(documents.has(this), 'Access after document disposal');
            const wrap = selection => selection.length ? {
                get text() { check(); return selection.text(); },
                get attributes() { check(); return selection.attr(); },
                querySelector: selector => { check(); return wrap(selection.find(selector).first()); },
                querySelectorAll: selector => { check(); return selection.find(selector).toArray().map(node => wrap($(node))); },
            } : null;
            this.querySelector = selector => { check(); return wrap($(selector).first()); };
            this.querySelectorAll = selector => { check(); return $(selector).toArray().map(node => wrap($(node))); };
        }
        dispose() { assert.ok(documents.delete(this)); }
    }
    const source = vm.runInNewContext(`${script}\nnew ${className}()`, {
        ComicSource: class {},
        Comic: class { constructor(fields) { Object.assign(this, fields); } },
        ComicDetails: class { constructor(fields) { Object.assign(this, fields); } },
        HtmlDocument,
        Network: { get: async (url, headers) => {
            requests.push({ url, headers });
            const body = respond(new URL(url));
            return typeof body === 'string' ? { status: 200, body } : body;
        } },
    }, { filename: 'cosplaytele.js' });
    return { source, requests, documents };
}

const plain = value => JSON.parse(JSON.stringify(value));
const card = (path, title, image = '') => `<div class="box"><h5><a href="${path}">${title}</a></h5>${image}</div>`;
const list = (body = '', hasNext = false) => `<main id="main">${body}${hasNext ? '<a class="next page-number" href="/page/2/">Next</a>' : ''}</main>`;
const gallery = `<meta property="og:image" content="//images.example.invalid/cover.jpg">
<main id="main"><h1 class="entry-title">Demo &amp; Sample</h1>
    <time class="updated" datetime="2026-11-20T12:00:00+01:00"></time>
    <a href="/category/cosplay/">Cosplay</a><a href="/tag/example/">Example</a>
    <a href="/tag/example/">Example</a><a href="https://other.example.invalid/tag/example/">External</a>
    <figure class="gallery-item"><img src="data:image/gif;base64,fixture" data-src="/images/02.jpg?x=1&amp;y=2"></figure>
    <figure class="gallery-item"><img src="//images.example.invalid/01.jpg"></figure>
    <figure class="gallery-item"><img src="/images/02.jpg?x=1&amp;y=2"></figure>
    <img src="/images/ignore.jpg">
</main>`;

function popularPost(index) {
    return {
        title: { rendered: '<b>Sample</b> &amp; Demo ' + index },
        link: index === 0 ? `${base}/demo-gallery/?utm=fixture` : `${base}/gallery-${index}/`,
        _embedded: { 'wp:featuredmedia': [{ source_url: `https://images.example.invalid/${index}.jpg` }] },
    };
}

function explore(source, title) {
    const page = source.explore.find(page => page.title.endsWith(title));
    assert.equal(page.type, 'multiPageComicList');
    return page;
}

test('index is a JSON array matching the source and resolves its script relative to the CDN URL', () => {
    const { source, requests } = createSource();
    const repo = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
    assert.equal(repo.length, 1);
    assert.deepEqual([repo[0].name, repo[0].key, repo[0].version], [source.name, source.key, source.version]);
    assert.match(source.key, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
    assert.match(source.version, /^\d+\.\d+\.\d+$/);
    assert.equal(source.minAppVersion, '1.18.5');
    assert.equal(source.url, '');
    assert.equal(repo[0].fileName, 'cosplaytele.js');
    assert.equal(new URL(repo[0].fileName, 'https://cdn.jsdelivr.net/gh/example/sources@main/index.json').href,
        'https://cdn.jsdelivr.net/gh/example/sources@main/cosplaytele.js');
    assert.equal(readFileSync(join(root, repo[0].fileName), 'utf8'), script);
    assert.equal(requests.length, 0);
});

test('latest is 1-based, scopes results to main, and stops at the end', async () => {
    const { source, requests, documents } = createSource(url => url.pathname === '/' ? `
        <aside>${card('/sidebar-gallery/', 'Ignore')}</aside>
        ${list(card('https://www.cosplaytele.com/demo-gallery?tracking=1#top', 'Demo &amp; Sample', '<img src="/cover.webp">') +
        card('/demo-gallery/', 'Duplicate') + card('https://example.invalid/other/', 'External'), true)}` :
        list(card('/other-gallery/', 'Other')));
    const latest = explore(source, 'Latest');
    assert.deepEqual(plain(await latest.load(1)), { comics: [{ id, title: 'Demo & Sample', cover: `${base}/cover.webp` }], maxPage: 2 });
    assert.deepEqual(plain(await latest.load(2)), { comics: [{ id: '%2Fother-gallery%2F', title: 'Other', cover: '' }], maxPage: 2 });
    assert.deepEqual(requests.map(request => request.url), [`${base}/`, `${base}/page/2/`]);
    assert.equal(documents.size, 0);
});

test('search escapes the query and applies the selected category to all pages', async () => {
    const { source, requests } = createSource(() => list());
    assert.equal(source.search.optionList[0].default, 'all');
    assert.deepEqual(plain(source.search.optionList[0].options), [
        'all-All', 'nude-Cosplay Nude', 'ero-Cosplay Ero', 'cosplay-Cosplay', 'video-Video Cosplay',
    ]);
    assert.deepEqual(plain(await source.search.load('  中 & + # ?  ', [], 1)), { comics: [], maxPage: 1 });
    assert.deepEqual(plain(await source.search.load(' a+b ', ['ero'], 2)), { comics: [], maxPage: 2 });
    await source.search.load('demo', ['video'], 1);
    await source.search.load('', ['all'], 1);
    assert.deepEqual(requests.map(request => request.url), [
        `${base}/?s=%E4%B8%AD%20%26%20%2B%20%23%20%3F`,
        `${base}/category/cosplay-ero/page/2/?s=a%2Bb`,
        `${base}/category/video-cosplayyy/?s=demo`,
        `${base}/`,
    ]);
});

test('category targets use the host parameter and preserve paging', async () => {
    const { source, requests } = createSource(() => list(card('/demo-gallery/', 'Demo'), true));
    const categories = source.category.parts[0].categories;
    const paths = ['cosplay-nudee', 'cosplay-ero', 'cosplay', 'video-cosplayyy'];
    assert.deepEqual(plain(categories.map(entry => entry.label)), [
        'Cosplay Nude', 'Cosplay Ero', 'Cosplay', 'Video Cosplay', 'Best Cosplayer',
    ]);
    for (const [index, entry] of categories.slice(0, 4).entries()) {
        assert.equal(entry.target.page, 'category');
        const { category, param } = entry.target.attributes;
        assert.deepEqual(plain(await source.categoryComics.optionLoader(category, param)), []);
        const result = await source.categoryComics.load(category, param, [], 3);
        assert.equal(result.maxPage, 4);
        assert.equal(result.comics[0].id, id);
        assert.equal(requests[index].url, `${base}/category/${paths[index]}/page/3/`);
    }
    assert.throws(() => source.categoryComics.load('Unknown', 'other', [], 1), /unknown category/);
    assert.equal(requests.length, 4);
});

test('Best Cosplayer loads the directory once per filter load and pages the chosen creator archive', async () => {
    const directory = `<main><a href="/category/misc/">Menu</a><div class="row row-small">
        <a href="/category/demo-creator/" class="fill"></a>
        <div class="text"><a href="${base}/category/demo-creator/?tracking=1">Demo &amp; Co-op</a></div>
        <div class="text"><a href="/category/demo-creator/#top">Duplicate</a></div>
        <div class="text"><a href="/category/%e4%b8%ad/">Sample</a></div>
        <div class="text"><a href="https://example.invalid/category/other/">External</a></div>
        <div class="text"><a href="/tag/example/">Not a creator archive</a></div>
    </div></main>`;
    const { source, requests, documents } = createSource(url => {
        if (url.pathname === '/best-cosplayer/') return directory;
        if (url.pathname === '/category/demo-creator/') return list(card('/demo-gallery/', 'Demo'), true);
        return list();
    });
    const { category, param } = source.category.parts[0].categories.at(-1).target.attributes;
    const [filter] = await source.categoryComics.optionLoader(category, param);
    assert.deepEqual(plain(filter), { label: 'Best Cosplayer', options: ['demo%2Dcreator-Demo & Co-op', '%25e4%25b8%25ad-Sample'] });
    const [first, second] = filter.options.map(option => option.split('-', 1)[0]);
    assert.equal((await source.categoryComics.load(category, param, [first], 1)).comics[0].id, id);
    assert.deepEqual(plain(await source.categoryComics.load(category, param, [first], 2)), { comics: [], maxPage: 2 });
    await source.categoryComics.load(category, param, [second], 1);
    assert.throws(() => source.categoryComics.load(category, param, ['..%2Fother'], 1), /invalid cosplayer category/);
    assert.deepEqual(requests.map(r => new URL(r.url).pathname), [
        '/best-cosplayer/', '/category/demo-creator/', '/category/demo-creator/page/2/', '/category/%e4%b8%ad/',
    ]);
    assert.equal(documents.size, 0);
});

test('Top Cosplay uses the 24-hour, custom three-day and seven-day ranges directly', async () => {
    const { source, requests } = createSource(() => '[]');
    const top = source.category.parts[1];
    assert.equal(top.name, 'Top Cosplay');
    assert.deepEqual(plain(top.categories.map(entry => entry.label)), ['24 Hours', '3 Days', '7 Days']);
    for (const entry of top.categories) {
        const { category, param } = entry.target.attributes;
        assert.deepEqual(plain(await source.categoryComics.optionLoader(category, param)), []);
        assert.deepEqual(plain(await source.categoryComics.load(category, param, [], 2)), { comics: [], maxPage: 2 });
    }
    const urls = requests.map(r => new URL(r.url));
    assert.ok(urls.every(url => url.pathname.endsWith('/popular-posts') && url.searchParams.get('offset') === '20'));
    assert.deepEqual(urls.map(url => ['range', 'time_quantity', 'time_unit'].map(key => url.searchParams.get(key))), [
        ['last24hours', null, null], ['custom', '3', 'day'], ['last7days', null, null],
    ]);
});

test('popular uses offset 0, skips to offset 20, decodes titles and stops on a short page', async () => {
    const { source, requests, documents } = createSource(url => {
        assert.equal(url.pathname, '/wp-json/wordpress-popular-posts/v1/popular-posts');
        assert.equal(url.searchParams.get('limit'), '20');
        assert.equal(url.searchParams.get('range'), 'last7days');
        assert.equal(url.searchParams.get('_embed'), 'wp:featuredmedia');
        const offset = Number(url.searchParams.get('offset'));
        return JSON.stringify(Array.from({ length: offset === 0 ? 20 : 1 }, (_, i) => popularPost(offset + i)));
    });
    const popular = explore(source, 'Popular');
    const first = await popular.load(1);
    const second = await popular.load(2);
    assert.deepEqual(plain(first.comics[0]), { id, title: 'Sample & Demo 0', cover: 'https://images.example.invalid/0.jpg' });
    assert.equal(first.comics.length, 20);
    assert.equal(first.maxPage, 2);
    assert.equal(second.comics[0].id, '%2Fgallery-20%2F');
    assert.equal(second.maxPage, 2);
    assert.deepEqual(requests.map(request => new URL(request.url).searchParams.get('offset')), ['0', '20']);
    assert.equal(documents.size, 0);
});

test('gallery detail is unchaptered; page order, repeated images and image headers are preserved', async () => {
    const { source, requests, documents } = createSource(() => gallery);
    const images = [`${base}/images/02.jpg?x=1&y=2`, 'https://images.example.invalid/01.jpg', `${base}/images/02.jpg?x=1&y=2`];
    assert.deepEqual(plain(await source.comic.loadInfo(id)), {
        title: 'Demo & Sample', cover: 'https://images.example.invalid/cover.jpg',
        tags: { category: ['Cosplay'], tag: ['Example'] }, chapters: null,
        updateTime: '2026-11-20', url: `${base}/demo-gallery/`,
    });
    assert.deepEqual(plain(await source.comic.loadEp(id, null)), { images });
    assert.deepEqual(plain(source.comic.onImageLoad(images[0], id, null)), { url: images[0], headers: { Referer: `${base}/demo-gallery/` } });
    assert.deepEqual(plain(source.comic.onThumbnailLoad(images[0])), { url: images[0], headers: { Referer: `${base}/` } });
    assert.deepEqual(requests.map(request => request.url), [`${base}/demo-gallery/`, `${base}/demo-gallery/`]);
    assert.equal(documents.size, 0);
});

test('Recommend For You exposes only related galleries with stable IDs in site order', async () => {
    const related = (href, title, img = '') => `<li><a class="crp_link" href="${href}">${img}<span class="crp_title">${title}</span></a></li>`;
    const body = gallery.replace('</main>', `<div class="entry-content"><div class="crp_related crp-thumbs-grid"><h3>Recommend For You:</h3><ul>
        ${related('https://www.cosplaytele.com/next-gallery?ref=demo#top', ' Next &amp; Demo ', '<img src="/placeholder.jpg" data-src="//images.example.invalid/next.jpg">')}
        ${related('/next-gallery/', 'Duplicate')}
        ${related('/demo-gallery/?ref=self', 'Self')}
        ${related('https://example.invalid/external/', 'External')}
        ${related('/category/cosplay/', 'Category')}
        ${related('/no-title/', '  ')}
        ${related('/another-gallery/', 'Another gallery')}
    </ul></div>${card('/elsewhere/', 'Not a recommendation')}</div></main>`);
    const { source, requests, documents } = createSource(() => body);
    const details = await source.comic.loadInfo(id);
    assert.deepEqual(plain(details.recommend), [
        { id: '%2Fnext-gallery%2F', title: 'Next & Demo', cover: 'https://images.example.invalid/next.jpg' },
        { id: '%2Fanother-gallery%2F', title: 'Another gallery', cover: '' },
    ]);
    assert.equal(source.postUrl(details.recommend[0].id), `${base}/next-gallery/`);
    assert.equal(requests.length, 1);
    assert.equal(documents.size, 0);
});

test('an empty recommendation block does not spoil a valid gallery', async () => {
    const { source, documents } = createSource(() => gallery.replace('</main>',
        '<div class="entry-content"><div class="crp_related"><ul></ul></div></div></main>'));
    assert.equal((await source.comic.loadInfo(id)).recommend, undefined);
    assert.equal(documents.size, 0);
});

test('gallery cover falls back to its first image and an absent date is not fabricated', async () => {
    const { source } = createSource(() => '<main><h1 class="entry-title">Demo</h1><figure class="gallery-item"><img src="first.jpg"></figure></main>');
    assert.deepEqual(plain(await source.comic.loadInfo(id)), {
        title: 'Demo', cover: `${base}/demo-gallery/first.jpg`, tags: {}, chapters: null, url: `${base}/demo-gallery/`,
    });
});

test('HTTP, malformed popular responses, broken gallery and invalid IDs produce errors', async () => {
    const unavailable = createSource(() => ({ status: 403, body: '' })).source;
    await assert.rejects(unavailable.search.load('foo', [], 1), /HTTP 403/);
    await assert.rejects(unavailable.categoryComics.optionLoader('Best Cosplayer', 'best'), /HTTP 403/);
    await assert.rejects(unavailable.categoryComics.load('24 Hours', 'top24h', [], 1), /HTTP 403/);
    await assert.rejects(createSource(() => list()).source.categoryComics.optionLoader('Best Cosplayer', 'best'), /directory not found or empty/);
    await assert.rejects(explore(createSource(() => '<html/>').source, 'Popular').load(1), /invalid popular posts JSON/);
    await assert.rejects(explore(createSource(() => '{}').source, 'Popular').load(1), /invalid popular posts response/);
    await assert.rejects(explore(createSource(() => '[null]').source, 'Popular').load(1), /invalid popular post entries/);
    assert.deepEqual(plain(await explore(createSource(() => '[]').source, 'Popular').load(1)), { comics: [], maxPage: 1 });
    const { source, requests, documents } = createSource(() => '<div class="gallery-item"><img src="javascript:invalid"></div>');
    await assert.rejects(source.comic.loadInfo(id), /gallery title not found/);
    await assert.rejects(source.comic.loadEp(id, null), /gallery images missing/);
    await assert.rejects(explore(source, 'Latest').load(1), /gallery list not found/);
    await assert.rejects(source.comic.loadInfo('%2F..%2Fwp-admin%2F'), /invalid gallery ID/);
    assert.equal(requests.length, 3);
    assert.equal(documents.size, 0);
});
