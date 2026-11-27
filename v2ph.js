// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's V2PH extension (changes: JS/Venera-Next port).
// Upstream: https://github.com/keiyoushi/extensions-source/tree/92906c0382547f30a03b3176f2f2429be6b54dce/src/all/v2ph
class V2PHSource extends ComicSource {
    name = "V2PH";
    key = "v2ph";
    version = "1.0.0";
    minAppVersion = "1.18.5";
    url = "";

    baseUrl = "https://www.v2ph.com";
    popularPath = "/category/best-quality";
    genres = [
        ["sexy-girls", "Sexy"], ["nvshen", "Goddess"], ["short-hair", "Short hair"],
        ["pure", "Pure"], ["underwear-beauty", "Lingerie"], ["magazine", "Magazine"],
        ["glamour-models", "Glamour models"], ["beautiful-legs", "Legs"],
        ["japanese-girls", "Japanese"], ["best-quality", "Quality"],
        ["outside", "Outdoors"], ["bikini-girls", "Bikini"],
    ];
    countries = [
        ["china", "China"], ["japan", "Japan"], ["south-korea", "South Korea"],
        ["taiwan", "Taiwan"], ["thailand", "Thailand"], ["europe", "Europe and America"],
    ];
    tagNamespaces = { tag: "Tags", category: "Category", country: "Country", actor: "artist", vendor: "author" };
    tagPaths = new Map();
    sawLoginPage = false;

    text(element) {
        return element?.text.replace(/\s+/g, " ").trim() ?? "";
    }

    // Venera QuickJS does not expose the browser URL constructor.
    absoluteUrl(value, pageUrl) {
        const href = value?.trim();
        if (!href || /[\s\\\u0000-\u001f\u007f]/.test(href)) return null;
        if (href.startsWith("//")) return this.absoluteUrl("https:" + href, pageUrl);
        if (/^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i.test(href)) return href;
        if (/^[^/]*:|^[?#]/.test(href)) return null;
        if (href.startsWith("/")) return this.baseUrl + href;
        return pageUrl.slice(0, pageUrl.lastIndexOf("/") + 1) + href;
    }

    sitePath(value) {
        const match = this.absoluteUrl(value, this.baseUrl + "/")
            ?.match(/^https?:\/\/(?:www\.)?v2ph\.com(\/[^?#]*)?(?:[?#]|$)/i);
        return match ? (match[1] ?? "").replace(/\/+$/, "") : null;
    }

    contentPath(value, types) {
        const path = this.sitePath(value);
        const match = path?.match(/^\/([a-z]+)\/((?:[\w.~-]|%[\da-f]{2})+)$/i);
        if (!match || !types.includes(match[1]) || /^(?:\.|%2e){1,2}$/i.test(match[2]) ||
            /%(?:00|2f|5c)/i.test(match[2])) return null;
        return path.replace(/%[\da-f]{2}/gi, escape => escape.toUpperCase());
    }

    albumId(value) {
        return this.contentPath(value, ["album"])?.slice("/album/".length) ?? null;
    }

    albumUrl(id) {
        const path = `/album/${id}`;
        if (this.albumId(path) !== id) throw new Error("V2PH: invalid album ID");
        return this.baseUrl + path;
    }

    archivePath(value) {
        return this.contentPath(value, Object.keys(this.tagNamespaces));
    }

    imageUrl(element, pageUrl) {
        const attrs = element?.attributes;
        return this.absoluteUrl(attrs?.["data-src"], pageUrl) ?? this.absoluteUrl(attrs?.src, pageUrl);
    }

    async getHtml(url, parse, requestHeaders) {
        const { status, body, headers } = await Network.get(url, {
            Accept: "text/html", "Accept-Language": "en-US,en;q=0.9", ...requestHeaders,
        });
        // Preserve host-thrown CloudflareException so Venera can open its own verification UI.
        if (headers?.["cf-mitigated"] === "challenge") {
            throw new Error(`CloudflareException: ${url}`);
        }
        if (status === 401 || status === 402) {
            throw new Error(`V2PH: ${status === 401 ? "sign-in required" : "membership required"} (HTTP ${status})`);
        }
        if (status !== 200) throw new Error(`V2PH: HTTP ${status} (${url.split("?")[0]})`);
        const doc = new HtmlDocument(body);
        try {
            if (doc.querySelector("#challenge-form") || /^Just a moment/i.test(this.text(doc.querySelector("title")))) {
                throw new Error(`CloudflareException: ${url}`);
            }
            const canonical = this.sitePath(doc.querySelector('link[rel="canonical"]')?.attributes.href);
            if (canonical === "/user/upgrade" || doc.querySelector('.alert-warning a[href*="/user/upgrade"]')) {
                throw new Error("V2PH: the site requires membership or has reached its viewing limit");
            }
            if (canonical === "/user/login" || canonical === "/login" || doc.querySelector(".login-box-msg")) {
                throw new Error("V2PH: sign-in required");
            }
            return parse(doc);
        } finally {
            doc.dispose();
        }
    }

    parseCards(cards, url, excludeId) {
        const comics = [];
        const seen = new Set();
        for (const card of cards) {
            const link = card.querySelector(".card-body h6 a");
            const media = card.querySelector("a.media-cover");
            const id = this.albumId(media?.attributes.href) ?? this.albumId(link?.attributes.href);
            const title = this.text(link) || media?.attributes.title?.trim();
            if (!id || !title || seen.has(id) || id === excludeId) continue;
            const cover = this.imageUrl(card.querySelector(".card-cover img"), url) ?? "";
            seen.add(id);
            comics.push(new Comic({ id, title, cover }));
        }
        return comics;
    }

    maxPage(doc, url, page) {
        const path = this.sitePath(url);
        let maxPage = page;
        for (const link of doc.querySelectorAll("ul.pagination li.page-item:not(.disabled) a[href]")) {
            const href = link.attributes.href.split("#")[0];
            if (!href.startsWith("?") && this.sitePath(href) !== path) continue;
            const next = Number(href.match(/[?&]page=([1-9]\d*)(?:&|$)/)?.[1]);
            if (Number.isSafeInteger(next)) maxPage = Math.max(maxPage, next);
        }
        return maxPage;
    }

    async loadList(path, page, keyword = "") {
        const url = `${this.baseUrl}${path}?${keyword ? `q=${encodeURIComponent(keyword)}&` : ""}page=${page}`;
        return this.getHtml(url, doc => {
            const selector = path === "/" ? "#latest-albums-title ~ .albums-list" : ".albums-list";
            const lists = doc.querySelectorAll(selector);
            if (!lists.length) {
                const empty = path === "/search/" && doc.querySelectorAll(".alert-info, .alert-warning").some(node =>
                    /^(?:No (?:albums|results)(?: found)?|没有找到(?:相册|图集|结果)|找不到(?:相簿|結果))[.!。]?$/i.test(this.text(node)));
                if (empty) {
                    return { comics: [], maxPage: page };
                }
                throw new Error("V2PH: album list not found");
            }
            const cards = lists.flatMap(list => list.querySelectorAll(".card"));
            const comics = this.parseCards(cards, url.split("?")[0]);
            if (cards.length && !comics.length) throw new Error("V2PH: unrecognized album cards");
            return { comics, maxPage: comics.length ? this.maxPage(doc, url, page) : page };
        });
    }

    optionList(label, entries) {
        return { label, type: "select", default: "all", options: ["all-All", ...entries.map(([slug, text]) =>
            `${slug.replace(/-/g, "%2D")}-${text}`)] };
    }

    categoryTarget(label, path) {
        return { page: "category", attributes: { category: label, param: path } };
    }

    categoryPart(name, type, entries) {
        return { name, type: "fixed", categories: entries.map(([slug, label]) =>
            ({ label, target: this.categoryTarget(label, `/${type}/${slug}`) })) };
    }

    explore = [
        { title: "V2PH · Latest", type: "multiPageComicList", load: page => this.loadList("/", page) },
        { title: "V2PH · Popular", type: "multiPageComicList", load: page => this.loadList(this.popularPath, page) },
    ];

    search = {
        optionList: [this.optionList("Category", this.genres), this.optionList("Country", this.countries)],
        load: (keyword, options, page) => {
            const query = keyword.trim();
            if (query) return this.loadList("/search/", page, query);
            const genre = this.genres.find(([slug]) => slug.replace(/-/g, "%2D") === options?.[0]);
            const country = this.countries.find(([slug]) => slug.replace(/-/g, "%2D") === options?.[1]);
            const path = genre ? `/category/${genre[0]}` : country ? `/country/${country[0]}` : this.popularPath;
            return this.loadList(path, page);
        },
    };

    category = {
        title: "V2PH",
        parts: [this.categoryPart("Category", "category", this.genres), this.categoryPart("Country", "country", this.countries)],
    };

    categoryComics = {
        load: (category, param, options, page) => {
            const path = this.archivePath(param);
            if (!path) throw new Error("V2PH: invalid archive");
            return this.loadList(path, page);
        },
    };

    detailsFields(doc) {
        const fields = new Map();
        for (const label of doc.querySelectorAll("dl dt")) {
            const value = label.nextElementSibling;
            if (value?.localName === "dd") fields.set(this.text(label).replace(/[:：]$/, "").toLowerCase(), value);
        }
        return fields;
    }

    photosCount(fields) {
        const number = Number(this.text(fields.get("photos")));
        return Number.isSafeInteger(number) && number > 0 ? number : null;
    }

    albumDetails(doc, id, url) {
        const title = this.text(doc.querySelector("h1"));
        const fields = this.detailsFields(doc);
        const cover = this.absoluteUrl(doc.querySelector('meta[property="og:image"]')?.attributes.content, url)
            ?? this.imageUrl(doc.querySelector(".photos-list img"), url) ?? "";
        if (!title || (!fields.size && !doc.querySelector(".photos-list, .album-intro"))) {
            throw new Error("V2PH: album details not found");
        }
        const tags = {};
        for (const [fieldName, field] of fields) {
            for (const link of field.querySelectorAll("a[href]")) {
                const path = this.archivePath(link.attributes.href);
                const label = this.text(link);
                if (!path || !label) continue;
                const namespace = fieldName === "vendor" ? "author" : fieldName === "model" ? "artist" :
                    this.tagNamespaces[path.split("/")[1]];
                const values = tags[namespace] ??= [];
                if (!values.includes(label)) values.push(label);
                this.tagPaths.set(`${namespace}:${label}`, path);
            }
        }
        const photos = this.photosCount(fields);
        const description = [photos ? this.translate("Photos") + ": " + photos : "", this.text(doc.querySelector(".album-intro"))]
            .filter(Boolean).join("\n\n");
        const uploadTime = this.text(fields.get("date")).match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
        const recommend = this.parseCards(doc.querySelectorAll(".albums-list .card"), url, id);
        return new ComicDetails({
            title, cover, description, tags, chapters: null, url,
            ...(uploadTime ? { uploadTime } : {}), ...(recommend.length ? { recommend } : {}),
        });
    }

    async loadAlbumPage(url, page) {
        return this.getHtml(page === 1 ? url : `${url}?page=${page}`, doc => {
            const photos = page === 1 ? this.photosCount(this.detailsFields(doc)) : null;
            if (photos > 20 && doc.querySelector('a[href*="/login"], a[href*="/register"]') &&
                !doc.querySelector('a[href*="/user/logout"]')) {
                throw new Error("V2PH: sign-in required for albums with more than 20 photos");
            }
            const current = this.text(doc.querySelector("ul.pagination .page-item.active"));
            const nodes = doc.querySelectorAll(".photos-list img");
            const images = (nodes.length ? nodes : doc.querySelectorAll(".album-photo img"))
                .map(node => this.imageUrl(node, url));
            if ((/^[1-9]\d*$/.test(current) && Number(current) !== page) || !images.length || images.some(image => !image)) {
                throw new Error(`V2PH: album images missing or unrecognized (page ${page})`);
            }
            return { photos, images, maxPage: this.maxPage(doc, url, page) };
        });
    }

    account = {
        loginWithWebview: {
            // Start at the official homepage so the user follows the site's own sign-in link.
            url: this.baseUrl + "/",
            checkStatus: (url, title) => {
                const path = this.sitePath(url);
                if (path === null) return false;
                if (/^\/(?:user\/)?(?:login|signin)$/.test(path)) {
                    this.sawLoginPage = true;
                    return false;
                }
                return this.sawLoginPage && /v2ph|微[图圖]坊/i.test(title) &&
                    !/login|sign in|登录|登入|登錄|just a moment/i.test(title) &&
                    (path === "" || /^\/user(?:\/(?:index|profile|dashboard))?$/.test(path));
            },
            onLoginSuccess: async () => {
                try {
                    const signedIn = await this.getHtml(this.baseUrl + "/", doc =>
                        !!doc.querySelector('a[href*="/user/logout"]'), { "cache-time": "no" });
                    if (!signedIn) throw new Error("V2PH: sign-in could not be confirmed; sign in on the site first");
                } catch (error) {
                    // The host saves its login flag before calling this confirmation hook.
                    this.deleteData("account");
                    this.deleteData("_localStorage");
                    throw error;
                } finally {
                    this.sawLoginPage = false;
                }
            },
        },
        logout: () => {
            this.sawLoginPage = false;
            Network.deleteCookies(this.baseUrl + "/");
            Network.deleteCookies("https://v2ph.com/");
            this.deleteData("_localStorage");
        },
    };

    comic = {
        link: { domains: ["www.v2ph.com", "v2ph.com"], linkToId: url => this.albumId(url) },
        onClickTag: (namespace, tag) => {
            const path = this.tagPaths.get(`${namespace}:${tag}`);
            return path ? this.categoryTarget(tag, path) : null;
        },
        loadInfo: async id => {
            const url = this.albumUrl(id);
            return this.getHtml(url, doc => this.albumDetails(doc, id, url));
        },
        loadEp: async id => {
            const url = this.albumUrl(id);
            const first = await this.loadAlbumPage(url, 1);
            const { photos, images } = first;
            // Upstream albums have 10 images per HTML page. Read only the requested album, in order.
            let maxPage = photos ? Math.ceil(photos / 10) : first.maxPage;
            // Bound request count even if a broken pager keeps advertising more pages.
            for (let page = 2; page <= maxPage; page++) {
                if (maxPage > 500) throw new Error("V2PH: album pagination exceeds 500 pages");
                const next = await this.loadAlbumPage(url, page);
                images.push(...next.images);
                if (!photos) maxPage = Math.max(maxPage, next.maxPage);
            }
            if (photos && images.length !== photos) throw new Error(`V2PH: incomplete album (${images.length}/${photos} photos)`);
            return { images };
        },
        onImageLoad: (url, id) => ({ url, headers: { Referer: this.albumUrl(id) } }),
        onThumbnailLoad: url => ({ url, headers: { Referer: this.baseUrl + "/" } }),
    };

    translation = {
        zh_CN: {
            "V2PH · Latest": "V2PH · 最新", "V2PH · Popular": "V2PH · 热门",
            Category: "分类", Country: "地区", Tags: "标签", Photos: "照片", All: "全部",
            Sexy: "性感", Goddess: "女神", "Short hair": "短发", Pure: "清纯", Lingerie: "内衣",
            Magazine: "杂志", "Glamour models": "写真模特", Legs: "美腿", Japanese: "日系", Quality: "精选",
            Outdoors: "外拍", Bikini: "比基尼", China: "中国", Japan: "日本", "South Korea": "韩国",
            Taiwan: "台湾", Thailand: "泰国", "Europe and America": "欧美",
        },
        zh_TW: {
            "V2PH · Latest": "V2PH · 最新", "V2PH · Popular": "V2PH · 熱門",
            Category: "分類", Country: "地區", Tags: "標籤", Photos: "照片", All: "全部",
            Sexy: "性感", Goddess: "女神", "Short hair": "短髮", Pure: "清純", Lingerie: "內衣",
            Magazine: "雜誌", "Glamour models": "寫真模特", Legs: "美腿", Japanese: "日系", Quality: "精選",
            Outdoors: "外拍", Bikini: "比基尼", China: "中國", Japan: "日本", "South Korea": "韓國",
            Taiwan: "臺灣", Thailand: "泰國", "Europe and America": "歐美",
        },
    };
}
