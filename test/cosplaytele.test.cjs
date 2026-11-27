const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { root, plain, createSource: createHost } = require('./source-host.cjs');

const base = 'https://cosplaytele.com';
const id = '%2Fdemo-gallery%2F';
const createSource = (...args) => createHost('cosplaytele.js', ...args);
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
    const { source, requests, script } = createSource();
    const repo = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
    const entry = repo.find(item => item.key === source.key);
    assert.deepEqual([entry.name, entry.key, entry.version], [source.name, source.key, source.version]);
    assert.match(source.key, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
    assert.match(source.version, /^\d+\.\d+\.\d+$/);
    assert.equal(source.minAppVersion, '1.18.5');
    assert.equal(source.url, '');
    assert.equal(entry.fileName, 'cosplaytele.js');
    assert.equal(new URL(entry.fileName, 'https://cdn.jsdelivr.net/gh/example/sources@main/index.json').href,
        'https://cdn.jsdelivr.net/gh/example/sources@main/cosplaytele.js');
    assert.equal(readFileSync(join(root, entry.fileName), 'utf8'), script);
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

test('HTML listings report the last numbered page from the main pagination bar', async () => {
    const { source, requests } = createSource(url => {
        const current = Number(url.pathname.match(/\/page\/(\d+)\//)?.[1] ?? 1);
        return list(card('/demo-gallery/', 'Demo') + `<ul class="page-numbers nav-pagination links text-center">
            <li><span class="page-number current">${current}</span></li>
            <li><span class="page-number dots">…</span></li>
            <li><a class="page-number" href="/category/demo/page/44/">44</a></li>
            <li><a class="page-number">9007199254740993</a></li>
        </ul>`, current < 44) + '<aside><div class="nav-pagination"><a class="page-number">99</a></div></aside>';
    });
    for (const page of [1, 2, 44]) {
        assert.equal((await source.categoryComics.load('Demo', 'taxonomy:/category/demo/', [], page)).maxPage, 44);
    }
    assert.equal((await source.search.load('Demo', [], 1)).maxPage, 44);
    assert.equal((await explore(source, 'Latest').load(1)).maxPage, 44);
    assert.equal(requests.length, 5);
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

test('Best Cosplayer fetches short-name shortcuts once and pages the chosen creator archive', async () => {
    const directory = `<main><a href="/category/misc/">Menu</a><div class="row row-small">
        <a href="/category/demo-creator/" class="fill"></a>
        <div class="text"><a href="${base}/category/demo-creator/?tracking=1"> Demo &amp; Co-op   (demo_handle) </a></div>
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
    assert.deepEqual(plain(filter), { label: 'Featured Cosplayers', options: ['demo%2Dcreator-Demo & Co-op', '%25e4%25b8%25ad-Sample'] });
    const [first, second] = filter.options.map(option => option.split('-', 1)[0]);
    assert.equal((await source.categoryComics.load(category, param, [first], 1)).comics[0].id, id);
    assert.deepEqual(plain(await source.categoryComics.load(category, param, [first], 2)), { comics: [], maxPage: 2 });
    await source.categoryComics.load(category, param, [second], 1);
    assert.throws(() => source.categoryComics.load(category, param, ['..%2Fother'], 1), /invalid cosplayer category/);
    assert.deepEqual(requests.map(r => new URL(r.url).pathname), [
        '/best-cosplayer/', '/category/demo-creator/', '/category/demo-creator/page/2/', '/category/%e4%b8%ad/',
    ]);
    assert.equal(requests[0].headers['cache-time'], 'no');
    assert.equal(documents.size, 0);
});

test('the mixed author tab uses a fresh PageStorage key while preserving its Chinese label', () => {
    const { source } = createSource();
    const legacyTitle = 'CosplayTele · Creator Directory';
    const directory = source.explore.find(entry => entry.type === 'mixed');
    assert.equal(directory.title, 'CosplayTele · Creator Previews');
    assert.ok(!source.explore.some(entry => entry.title === legacyTitle));
    assert.equal(source.translation.zh_CN[directory.title], 'CosplayTele · 作者目录');
    assert.equal(source.translation.zh_TW[directory.title], 'CosplayTele · 作者目錄');
});

test('directory pages list one real gallery per creator and refresh independently of the first 30 shortcuts', async () => {
    let changed = false;
    const { source, requests, documents } = createSource(url => {
        if (url.pathname === '/best-cosplayer/') {
            const names = changed
                ? [['new-creator', '长名字作者甲乙丙丁戊己庚辛 （New handle）']]
                : [['first-creator', 'First Creator (first.handle)']];
            return `<main><div class="row-small"><div class="text">${names.concat(
                Array.from({ length: changed ? 1 : 34 }, (_, i) => [`sample-${i + 2}`, `Sample ${i + 2}`]),
            ).map(([slug, name]) => `<a href="/category/${slug}/">${name}</a>`).join('')}</div></div></main>`;
        }
        assert.match(url.pathname, /^\/category\/\w[\w-]*\/(?:page\/2\/)?$/);
        return list(card('/demo-gallery/', 'Demo', '<img src="/demo.jpg">') + card('/another-gallery/', 'Another'));
    });
    const directory = source.explore.find(entry => entry.type === 'mixed');
    const [initial] = await source.categoryComics.optionLoader('Best Cosplayer', 'best');
    assert.equal(initial.options.length, 30);
    assert.equal(initial.options[29], 'sample%2D30-Sample 30');
    assert.equal(requests.length, 1);
    const before = await directory.load(1);
    assert.equal(before.maxPage, 6);
    assert.equal(before.data.length, 6);
    assert.equal(requests.length, 8);
    assert.ok(before.data.every(row => row.comics.length === 1 && row.viewMore.page === 'category'));
    assert.deepEqual(plain(before.data[0]), {
        title: 'First Creator', comics: [{ id, title: 'Demo', cover: `${base}/demo.jpg` }],
        viewMore: { page: 'category', attributes: { category: 'First Creator (first.handle)', param: 'creator:first-creator' } },
    });
    changed = true;
    const next = await directory.load(2);
    assert.equal(next.data.length, 6);
    assert.equal(next.data[0].viewMore.attributes.param, 'creator:sample-7');
    assert.equal(requests.length, 14);
    const last = await directory.load(6);
    assert.equal(last.maxPage, 6);
    assert.equal(last.data.length, 5);
    assert.equal(last.data[0].viewMore.attributes.param, 'creator:sample-31');
    assert.equal(requests.length, 19);
    assert.deepEqual(plain(await directory.load(7)), { data: [], maxPage: 6 });
    assert.equal(requests.length, 19);
    const after = await directory.load(1);
    assert.equal(requests.length, 21); // Refresh the directory and fetch only the new author's preview.
    assert.equal(after.maxPage, 1);
    assert.equal(after.data.length, 2);
    assert.equal(after.data[0].title, '长名字作者甲乙丙丁…');
    const { category, param } = after.data[0].viewMore.attributes;
    assert.equal(category, '长名字作者甲乙丙丁戊己庚辛 （New handle）');
    assert.equal(param, 'creator:new-creator');
    assert.deepEqual(plain(await source.categoryComics.optionLoader(category, param)), []);
    assert.equal((await source.categoryComics.load(category, param, [], 2)).comics[0].id, id);
    assert.equal(new URL(requests.at(-1).url).pathname, '/category/new-creator/page/2/');
    const directoryRequests = requests.filter(r => new URL(r.url).pathname === '/best-cosplayer/');
    assert.equal(directoryRequests.length, 3);
    assert.ok(directoryRequests.every(r => r.headers['cache-time'] === 'no'));
    assert.equal(documents.size, 0);
});

test('empty or failed previews keep their creator links and archive concurrency stays bounded', async () => {
    let active = 0;
    let peak = 0;
    const { source, requests, logs, documents } = createSource(async url => {
        if (url.pathname === '/best-cosplayer/') return list(`<div class="row-small"><div class="text">
            <a href="/category/ok/">OK</a><a href="/category/empty/">Empty</a><a href="/category/fail/">Fail</a>
        </div></div>`);
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        if (url.pathname === '/category/fail/') return { status: 503, body: '' };
        return list(url.pathname === '/category/ok/' ? card('/demo-gallery/', 'Demo') : '');
    });
    const directory = source.explore.find(entry => entry.type === 'mixed');
    const { data } = await directory.load(1);
    assert.deepEqual(plain(data.map(row => [row.viewMore.attributes.param, row.comics.length])), [
        ['creator:ok', 1], ['creator:empty', 0], ['creator:fail', 0],
    ]);
    assert.equal(peak, 3);
    assert.equal(logs.length, 1);
    assert.match(logs[0][2], /fail: .*HTTP 503/);
    assert.deepEqual(plain((await directory.load(1)).data), plain(data));
    assert.equal(logs.length, 2); // Failed previews are retried, not cached as empty.
    const paths = requests.map(({ url }) => new URL(url).pathname);
    assert.equal(paths.filter(path => path === '/category/ok/').length, 1);
    assert.equal(paths.filter(path => path === '/category/empty/').length, 2);
    assert.equal(paths.filter(path => path === '/category/fail/').length, 2);
    assert.equal(documents.size, 0);
});

test('preview metadata survives source reload and the recent author homepage is reused', async () => {
    const storage = new Map();
    const respond = url => {
        if (url.pathname === '/best-cosplayer/') return list('<div class="row-small"><div class="text"><a href="/category/demo/">Demo</a></div></div>');
        assert.equal(url.pathname, '/category/demo/');
        return list(card('/demo-gallery/', 'Demo') + card('/other-gallery/', 'Other') +
            '<ul class="nav-pagination"><li><a class="page-number" href="/category/demo/page/44/">44</a></li></ul>', true);
    };
    const first = createSource(respond, storage);
    const dir = first.source.explore.find(entry => entry.type === 'mixed');
    const { data: [entry] } = await dir.load(1);
    assert.equal(first.requests.length, 2);
    const { category, param } = entry.viewMore.attributes;
    const archive = await first.source.categoryComics.load(category, param, [], 1);
    assert.equal(archive.comics.length, 2);
    assert.equal(archive.maxPage, 44);
    assert.equal(first.requests.length, 2);
    assert.deepEqual(Object.values(storage.get('creatorPreviewsV1')).map(v => v.comic), [{ id, title: 'Demo', cover: '' }]);
    const reopened = createSource(respond, storage);
    const reopenedDir = reopened.source.explore.find(entry => entry.type === 'mixed');
    assert.deepEqual(plain((await reopenedDir.load(1)).data), [plain(entry)]);
    assert.equal(reopened.requests.length, 1);
    reopened.source.creatorPreviews.get('demo').time -= 6 * 60 * 60 * 1000;
    await reopenedDir.load(1);
    assert.equal(reopened.requests.length, 3);
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

test('popular keeps offsets at 20 per page and uses a lookahead row to avoid empty last pages', async () => {
    const { source, requests, documents } = createSource(url => {
        assert.equal(url.pathname, '/wp-json/wordpress-popular-posts/v1/popular-posts');
        assert.equal(url.searchParams.get('limit'), '21');
        assert.equal(url.searchParams.get('range'), 'last7days');
        assert.equal(url.searchParams.get('_embed'), 'wp:featuredmedia');
        const offset = Number(url.searchParams.get('offset'));
        return JSON.stringify(Array.from({ length: offset === 0 ? 21 : 20 }, (_, i) => popularPost(offset + i)));
    });
    const popular = explore(source, 'Popular');
    const first = await popular.load(1);
    const second = await popular.load(2);
    assert.deepEqual(plain(first.comics[0]), { id, title: 'Sample & Demo 0', cover: 'https://images.example.invalid/0.jpg' });
    assert.equal(first.comics.length, 20);
    assert.equal(first.maxPage, 2);
    assert.equal(second.comics[0].id, '%2Fgallery-20%2F');
    assert.equal(second.comics.length, 20);
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

test('detail taxonomy chips open their own archives using the actual href and paginate', async () => {
    const detail = gallery.replace('</main>', `
        <a href="/category/fixture-author/?source=detail">作者示例 (Example Author)</a>
        <a href="//www.cosplaytele.com/category/game-series#top">Game Series</a>
        <a href="/tag/the-game/">Game Series</a>
        <a href="/tag/%e6%b5%8b%e8%af%95/">虚构角色</a>
        <a href="/category/no-nude/">Old Ero</a>
        <a href="/tag/%2e%2e/">Invalid path</a>
        <a href="/category/game-series/page/2/">Invalid archive</a>
        <a href="https://example.invalid/category/spoof/">External</a>
    </main>`);
    const { source, requests, documents } = createSource(url => {
        if (url.pathname === '/demo-gallery/') return detail;
        if (url.pathname.endsWith('/page/2/')) return list();
        return list(card('/demo-gallery/', 'Demo'), true);
    });
    assert.equal(source.comic.onClickTag('category', 'Game Series'), null);
    const { tags } = await source.comic.loadInfo(id);
    assert.deepEqual(plain(tags), {
        category: ['Cosplay', '作者示例 (Example Author)', 'Game Series', 'Old Ero'],
        tag: ['Example', 'Game Series', '虚构角色'],
    });
    const links = [
        ['category', '作者示例 (Example Author)', '/category/fixture-author/'],
        ['category', 'Game Series', '/category/game-series/'],
        ['tag', 'Game Series', '/tag/the-game/'],
        ['tag', '虚构角色', '/tag/%e6%b5%8b%e8%af%95/'],
        ['category', 'Old Ero', '/category/cosplay-ero/'],
    ];
    for (const [namespace, label, path] of links) {
        const target = source.comic.onClickTag(namespace, label);
        assert.deepEqual(plain(target), { page: 'category', attributes: { category: label, param: `taxonomy:${path}` } });
        const { category, param } = target.attributes;
        assert.deepEqual(plain(await source.categoryComics.optionLoader(category, param)), []);
        const result = await source.categoryComics.load(category, param, [], 1);
        assert.equal(result.comics[0].id, id);
        assert.equal(result.maxPage, 2);
        assert.deepEqual(plain(await source.categoryComics.load(category, param, [], 2)), { comics: [], maxPage: 2 });
    }
    assert.equal(source.comic.onClickTag('update', 'Game Series'), null);
    assert.equal(source.comic.onClickTag('category', 'External'), null);
    assert.throws(() => source.categoryComics.load('External', 'taxonomy://example.invalid/tag/spoof/', [], 1), /invalid taxonomy archive/);
    assert.throws(() => source.categoryComics.load('Invalid', 'taxonomy:/tag/%2e%2e/', [], 1), /invalid taxonomy archive/);
    assert.deepEqual(requests.map(({ url }) => url), [
        `${base}/demo-gallery/`, ...links.flatMap(([, , path]) => [`${base}${path}`, `${base}${path}page/2/`]),
    ]);
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
    const noDirectory = createSource(() => list()).source;
    await assert.rejects(noDirectory.categoryComics.optionLoader('Best Cosplayer', 'best'), /directory not found or empty/);
    await assert.rejects(noDirectory.explore.find(entry => entry.type === 'mixed').load(1), /directory not found or empty/);
    assert.throws(() => noDirectory.categoryComics.load('', 'creator:../other', [], 1), /invalid cosplayer category/);
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
