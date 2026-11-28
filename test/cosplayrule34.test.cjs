const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plain, createSource: createHost } = require('./source-host.cjs');

const base = 'https://cosplayrule34.com';
const post = `${base}/post/4242`;
const cdn = 'https://images.example.invalid';
const createSource = (...args) => createHost('cosplayrule34.js', ...args);
const card = (href, title = 'Synthetic &amp; Sample', cover = `${cdn}/cover.webp`) =>
    `<div class="grid-item" style="background-image: url('${cover}')"><a href="${href}">${title}</a></div>`;
const grid = (...cards) => `<main><div class="grid">${cards.join('')}</div></main>`;
const next = href => `<a class="next" href="${href.replace(/&/g, '&amp;')}">Next</a>`;
const gallery = (total = 3) => `<main>
    <meta property="og:image" content="${cdn}/ignored.jpg">
    <script>const unrelated = true;</script>
    <script>
    const albumId = "album_01"; const ownerId = "owner-02";
    const totalPhotos = ${total}; const download = 0; const downloadId = 17;
    const title = "Synthetic\\u0020 \\"Sample\\"";
    globalThis.shouldNotRun = noSuchFunction();
    </script>
    <div class="accordion-body"> A   synthetic description. </div>
    <a class="btn" href="/model/example-model">Example Model</a>
    <a class="btn" href="/us/model/example-model">Example Model</a>
    <a class="btn" href="/en/cosplay/demo-character/">Example Character</a>
    <a class="btn" href="https://www.cosplayrule34.com/fandom/%E4%BD%9C%E5%93%81/?ref=demo">Example Fandom</a>
    <a class="btn" href="/category/thots">OnlyFans</a>
    <a class="btn" href="https://others.example.invalid/model/example">Foreign</a>
    <a href="/model/ignored">Not a metadata button</a>
</main>`;
const photo = href => ({ html: `<figure><a href="${href}" data-fancybox="gallery"><img src="/ignore.webp"></a></figure>` });

test('source metadata and class initialization match the Venera contract without requests', () => {
    const { source, requests, script } = createSource();
    assert.deepEqual([source.name, source.key, source.version, source.minAppVersion, source.url],
        ['CosplayRule34', 'cosplayrule34', '1.0.0', '1.18.5', '']);
    assert.match(script, /92906c0382547f30a03b3176f2f2429be6b54dce/);
    assert.deepEqual(plain(source.explore.map(entry => entry.title)), ['CosplayRule34 · Latest', 'CosplayRule34 · Popular']);
    assert.equal(source.translation.zh_CN['CosplayRule34 · Popular'], 'CosplayRule34 · 热门');
    assert.equal(source.translation.zh_TW['CosplayRule34 · Popular'], 'CosplayRule34 · 熱門');
    assert.equal(requests.length, 0);
});

test('latest and popular read CSS covers, use desktop cache keys, and stop at the last page', async () => {
    const { source, requests, documents } = createSource(url => {
        const page = url.searchParams.get('page');
        const href = page === '1' ? `${post}/?tracking=x#viewer` : '/us/post/4343';
        return grid(card(href), card(href), card('/terms', 'Decoration')) +
            '<aside>' + card('/post/9999', 'Sidebar') + '</aside>' +
            (page === '1' ? next(`${url.pathname}?device=desktop&page=2`) : next('/category/tattoo?page=3'));
    });
    for (const { load } of source.explore) {
        assert.deepEqual(plain(await load(1)), {
            comics: [{ id: '4242', title: 'Synthetic & Sample', cover: `${cdn}/cover.webp` }], maxPage: 2,
        });
        assert.deepEqual(plain(await load(2)), {
            comics: [{ id: '4343', title: 'Synthetic & Sample', cover: `${cdn}/cover.webp` }], maxPage: 2,
        });
    }
    assert.deepEqual(requests.map(r => r.url), [
        `${base}/?page=1&device=desktop`, `${base}/?page=2&device=desktop`,
        `${base}/top?page=1&device=desktop`, `${base}/top?page=2&device=desktop`,
    ]);
    assert.equal(documents.size, 0);
});

test('keyword takes precedence, categories route by slug, and a false next link on a short page is ignored', async () => {
    const { source, requests } = createSource(url => {
        const page = url.searchParams.get('page');
        if (url.pathname.startsWith('/search/') && page === '1') {
            return grid(card('/post/4242'), card('/post/4343')) + next('?page=2&device=desktop');
        }
        return grid(card('/post/4242')) + next('?page=3&device=desktop');
    });
    const search = (keyword, category, page) => source.search.load(keyword, [category], page);
    const keyword = '  中/a? #  ';
    assert.equal((await search(keyword, 'thots', 1)).maxPage, 2);
    assert.equal((await search(keyword, 'thots', 2)).maxPage, 2);
    assert.equal((await search('different list', 'thots', 2)).maxPage, 3);
    await search(' ', 'asian', 1);
    await search('', 'all', 1);
    assert.equal(source.search.optionList[0].options.length, 13);
    const categories = source.category.parts[0].categories;
    assert.deepEqual(categories.map(item => item.target.attributes.param).join(' '),
        '/category/cosplay /category/asian /category/thots /category/tiktok /category/art /category/celebs /category/erotic /category/tattoo /category/dark /category/fitness /category/porno /category/amateur');
    const { category, param } = categories.find(item => item.label === 'OnlyFans').target.attributes;
    await source.categoryComics.load(category, param, [], 2);
    assert.deepEqual(requests.map(r => r.url), [
        `${base}/search/%E4%B8%AD%2Fa%3F%20%23?page=1&device=desktop`,
        `${base}/search/%E4%B8%AD%2Fa%3F%20%23?page=2&device=desktop`,
        `${base}/search/different%20list?page=2&device=desktop`,
        `${base}/category/asian?page=1&device=desktop`, `${base}/?page=1&device=desktop`,
        `${base}/category/thots?page=2&device=desktop`,
    ]);
});

test('detail is a single gallery with synchronous archive links, and deep links normalize canonical IDs', async () => {
    const { source, requests, documents } = createSource(url => url.pathname.startsWith('/post/') ? gallery() : grid(card('/post/4242')));
    const cover = `${base}/images/albums/owner-02/album_01.webp`;
    assert.deepEqual(plain(await source.comic.loadInfo('4242')), {
        title: 'Synthetic "Sample"', cover, description: 'A synthetic description.',
        tags: { Model: ['Example Model'], Character: ['Example Character'], Fandom: ['Example Fandom'], Category: ['OnlyFans'] },
        chapters: null, url: post,
    });
    const targets = [['Model', 'Example Model', '/model/example-model'], ['Character', 'Example Character', '/cosplay/demo-character'],
        ['Fandom', 'Example Fandom', '/fandom/%E4%BD%9C%E5%93%81'], ['Category', 'OnlyFans', '/category/thots']];
    for (const [namespace, label, path] of targets) {
        const target = source.comic.onClickTag(namespace, label);
        assert.deepEqual(plain(target), { page: 'category', attributes: { category: label, param: path } });
        await source.categoryComics.load(label, path, [], 1);
    }
    assert.equal(source.comic.onClickTag('Model', 'Missing'), null);
    assert.throws(() => source.categoryComics.load('', '/model/%2e%2e', [], 1), /invalid archive/);
    const linkToId = source.comic.link.linkToId;
    assert.equal(linkToId('https://www.cosplayrule34.com/us/post/4242/?x=1#page'), '4242');
    assert.equal(linkToId('http://cosplayrule34.com/post/%34%32%34%32'), '4242');
    for (const url of ['/post/4242', `${base}/fandom/demo`, `${base}/post/4242/extra`, `${base}.evil.example.invalid/post/4242`,
        `${base}/post/../../4242`, `${base}/post/%2f4242`, `${base}/post/%zz`, 'https://cosplayrule34.com@evil.example.invalid/post/4242']) {
        assert.equal(linkToId(url), null);
    }
    await assert.rejects(source.comic.loadInfo('4242?other=1'), /invalid gallery ID/);
    assert.deepEqual(plain(await source.search.load(`https://www.cosplayrule34.com/us/post/4242?x=y`, [], 1)), {
        comics: [{ id: '4242', title: 'Synthetic "Sample"', cover }], maxPage: 1,
    });
    await source.search.load(`${base}/en/fandom/%E4%BD%9C%E5%93%81/`, [], 2);
    assert.deepEqual(requests.map(r => r.url), [post, ...targets.map(([, , path]) => `${base}${path}?page=1&device=desktop`),
        post, `${base}/fandom/%E4%BD%9C%E5%93%81?page=2&device=desktop`]);
    assert.equal(documents.size, 0);
});

test('reading sends one upstream-shaped photo request and returns sorted URLs including duplicates', async () => {
    const short = `${base}/images/example/6.webp`;
    const long = `${base}/images/example/10.webp`;
    const { source, requests, documents } = createSource((url, request) => {
        if (request?.method !== 'POST') return gallery();
        assert.equal(url.pathname, '/cms/load-more-photos.php');
        return JSON.stringify({ photos: [photo('/images/example/10.webp'), photo('images/example/6.webp'), photo('//cosplayrule34.com/images/example/6.webp')] });
    });
    assert.deepEqual(plain(await source.comic.loadEp('4242', null)), { images: [short, short, long] });
    assert.equal(requests[0].url, post);
    assert.equal(requests.length, 2);
    const request = requests[1];
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Referer, post);
    assert.equal(request.headers.Origin, base);
    assert.equal(request.headers.Accept, '*/*');
    assert.match(request.headers['Content-Type'], /^application\/json/);
    assert.equal(request.headers['Sec-Fetch-Site'], 'same-origin');
    assert.deepEqual(JSON.parse(request.data), { album_id: 'album_01', owner_id: 'owner-02', download: 0, download_id: 17, offset: 0, limit: 3 });
    assert.deepEqual(plain(source.comic.onImageLoad(short, '4242', null)), { url: short, headers: { Referer: post } });
    assert.deepEqual(plain(source.comic.onImageLoad(`${cdn}/6.webp`, '4242', null)), { url: `${cdn}/6.webp`, headers: { Referer: `${base}/` } });
    assert.deepEqual(plain(source.comic.onThumbnailLoad(short)), { url: short, headers: { Referer: `${base}/` } });
    assert.equal(documents.size, 0);
});

test('large numeric album identifiers remain exact strings in covers and photo requests', async () => {
    const numeric = gallery(1).replace('"album_01"', '9007199254740993').replace('"owner-02"', '9007199254740995');
    const { source, requests } = createSource((_url, request) => request?.method === 'POST'
        ? JSON.stringify({ photos: [photo('/images/synthetic/1.webp')] }) : numeric);
    assert.equal((await source.comic.loadInfo('4242')).cover,
        `${base}/images/albums/9007199254740995/9007199254740993.webp`);
    await source.comic.loadEp('4242', null);
    const sent = JSON.parse(requests[2].data);
    assert.deepEqual([sent.album_id, sent.owner_id], ['9007199254740993', '9007199254740995']);
});

test('empty listing and explicit empty gallery are distinct from malformed responses and HTTP denial', async () => {
    for (const [response, expected] of [
        [grid(), null], ['<h2>No results found</h2>', null], [grid(card('/advert', 'Changed markup')), /unrecognized gallery listing/],
        ['<main><p>Unexpected layout</p></main>', /unrecognized gallery listing/],
        [{ status: 403, body: '' }, /HTTP 403/], ['<title>Just a moment...</title>', /verification page/],
        [{ status: 429, body: '' }, /rate limit .*429/], [{ status: 503, body: '' }, /temporarily unavailable or rate limited .*503/],
    ]) {
        const { source, documents, requests } = createSource(() => response);
        const result = source.search.load('test', [], 1);
        if (expected) await assert.rejects(result, expected);
        else assert.deepEqual(plain(await result), { comics: [], maxPage: 1 });
        assert.equal(documents.size, 0);
        assert.equal(requests.length, 1);
    }
    const { source, requests } = createSource(() => gallery(0));
    assert.deepEqual(plain(await source.comic.loadEp('4242', null)), { images: [] });
    assert.equal(requests.length, 1);
});

test('invalid metadata, denied requests and invalid or incomplete photo results fail without retries', async () => {
    const badMetadata = createSource(() => gallery('arr.length'));
    await assert.rejects(badMetadata.source.comic.loadEp('4242', null), /invalid gallery field totalPhotos/);
    assert.equal(badMetadata.requests.length, 1);
    assert.equal(badMetadata.documents.size, 0);
    for (const [body, expected] of [
        [{ status: 429, body: '' }, /rate limit .*429/], [{ status: 503, body: '' }, /rate limited .*503/],
        [{ status: 403, body: '' }, /HTTP 403/], ['<title>Access denied</title>', /verification page/],
        ['not JSON', /invalid photo API JSON/], ['{}', /invalid photo API response/],
        ['{"photos":[]}', /no photos/], [JSON.stringify({ photos: [photo('/images/demo/1.webp')] }), /photo count mismatch/],
        ['{"photos":[null,null,null]}', /invalid photo API item/],
        [JSON.stringify({ photos: [photo('/images/demo/1.webp'), photo('javascript:void(0)'), photo('/images/demo/3.webp')] }), /photo link not found/],
    ]) {
        const { source, requests, documents } = createSource((_url, request) => request?.method === 'POST' ? body : gallery());
        await assert.rejects(source.comic.loadEp('4242', null), expected);
        assert.equal(requests.length, 2);
        assert.equal(documents.size, 0);
    }
});
