// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's CosplayTele extension (changes: JS/Venera-Next port).
// Upstream: https://github.com/keiyoushi/extensions-source/tree/92906c0382547f30a03b3176f2f2429be6b54dce/src/all/cosplaytele
class CosplayTeleSource extends ComicSource {
    name = "CosplayTele";
    key = "cosplaytele";
    version = "1.2.0";
    minAppVersion = "1.18.5";
    url = "";

    baseUrl = "https://cosplaytele.com";
    categories = [
        ["nude", "Cosplay Nude", "/category/cosplay-nudee/"],
        ["ero", "Cosplay Ero", "/category/cosplay-ero/"],
        ["cosplay", "Cosplay", "/category/cosplay/"],
        ["video", "Video Cosplay", "/category/video-cosplayyy/"],
    ];
    rankings = [
        ["top24h", "24 Hours", "last24hours"],
        // The /3-day/ page currently embeds the 24-hour widget; request an actual three-day range.
        ["top3d", "3 Days", "custom&time_quantity=3&time_unit=day"],
        ["top7d", "7 Days", "last7days"],
    ];
    creatorSlug = /^(?:[a-z0-9_-]|%[89a-f][0-9a-f])+$/i;

    async get(url, accept, headers) {
        const response = await Network.get(url, { Accept: accept, ...headers });
        if (response.status !== 200) {
            throw new Error(`CosplayTele: HTTP ${response.status} (${url.split("?")[0]})`);
        }
        return response.body;
    }

    parseHtml(html, parse) {
        const document = new HtmlDocument(html);
        try {
            return parse(document);
        } finally {
            document.dispose();
        }
    }

    async getHtml(url, parse, headers) {
        return this.parseHtml(await this.get(url, "text/html", headers), parse);
    }

    // The Venera QuickJS API does not provide the browser's URL constructor.
    absoluteUrl(value, pageUrl) {
        const url = typeof value === "string" ? value.trim() : "";
        if (!url || /[\s\\\u0000-\u001f\u007f]/.test(url)) return null;
        if (/^https?:\/\/[^/?#]+/i.test(url)) return url;
        if (url.startsWith("//")) return /^\/\/[^/?#]/.test(url) ? "https:" + url : null;
        if (/^[^/]*:/.test(url) || /^[?#]/.test(url)) return null;
        if (url.startsWith("/")) return this.baseUrl + url;
        return pageUrl.slice(0, pageUrl.lastIndexOf("/") + 1) + url;
    }

    postId(value) {
        const url = this.absoluteUrl(value, this.baseUrl + "/");
        const path = url?.match(/^https?:\/\/(?:www\.)?cosplaytele\.com(\/[^?#]*)/i)?.[1]
            .replace(/\/+$/, "");
        if (!path || /^\/(?:category|tag|page|feed|wp-json|wp-content|wp-admin)(?:\/|$)/i.test(path) ||
            path.split("/").some(segment => /^(?:\.|%2e){1,2}$/i.test(segment))) return null;
        return encodeURIComponent(path + "/");
    }

    postUrl(id) {
        const path = decodeURIComponent(id);
        if (this.postId(path) !== id) throw new Error("CosplayTele: invalid gallery ID");
        return this.baseUrl + path;
    }

    pageUrl(path, page, keyword = "") {
        const paginated = this.baseUrl + path + (page > 1 ? `page/${page}/` : "");
        return keyword ? `${paginated}?s=${encodeURIComponent(keyword)}` : paginated;
    }

    imageUrl(element, pageUrl) {
        const attrs = element?.attributes;
        return this.absoluteUrl(attrs?.["data-src"], pageUrl) ?? this.absoluteUrl(attrs?.src, pageUrl);
    }

    imageConfig(url, referer) {
        return { url, headers: { Referer: referer } };
    }

    async loadList(path, page, keyword = "") {
        const url = this.pageUrl(path, page, keyword);
        const pageUrl = url.split("?")[0];
        return this.getHtml(url, document => {
            const main = document.querySelector("main");
            if (!main) throw new Error("CosplayTele: gallery list not found");
            const comics = this.parseCards(main.querySelectorAll("div.box"), "h5 a", null, pageUrl);
            const hasNext = document.querySelector(".next.page-number") !== null;
            return { comics, maxPage: hasNext ? page + 1 : page };
        });
    }

    parseCards(cards, linkSelector, titleSelector, pageUrl, excludeId) {
        const comics = [];
        const seen = new Set();
        for (const card of cards) {
            const link = card.querySelector(linkSelector);
            const id = this.postId(link?.attributes.href);
            const title = (titleSelector ? link?.querySelector(titleSelector) : link)?.text.trim();
            if (!id || !title || id === excludeId || seen.has(id)) continue;
            const cover = this.imageUrl(card.querySelector("img"), pageUrl) ?? "";
            seen.add(id);
            comics.push(new Comic({ id, title, cover }));
        }
        return comics;
    }

    async loadCreators() {
        const url = this.baseUrl + "/best-cosplayer/";
        return this.getHtml(url, document => {
            const creators = new Map();
            for (const link of document.querySelectorAll("main .row-small .text a")) {
                const href = this.absoluteUrl(link.attributes.href, url);
                const slug = href?.match(/^https?:\/\/(?:www\.)?cosplaytele\.com\/category\/([^/?#]+)\/?(?:[?#]|$)/i)?.[1];
                const label = link.text.replace(/\s+/g, " ").trim();
                if (slug && this.creatorSlug.test(slug) && label && !creators.has(slug)) creators.set(slug, label);
            }
            if (!creators.size) throw new Error("CosplayTele: Best Cosplayer directory not found or empty");
            return Array.from(creators, ([slug, label]) => ({ slug, label,
                shortName: label.replace(/\s*-?\s*[(（][^()（）]+[)）]$/, "").trim() || label,
            }));
        }, { "cache-time": "no" });
    }

    async loadCreatorOptions() {
        const creators = await this.loadCreators();
        // Venera-Next uses chips through eight options and splits each key at its first hyphen.
        return [{ label: "Featured Cosplayers", options: creators.slice(0, 8).map(({ slug, shortName }) =>
            `${encodeURIComponent(slug).replace(/-/g, "%2D")}-${shortName}`) }];
    }

    creatorDirectoryTitle(name) {
        // Native explore headers don't wrap; reserve extra space for wide glyphs and the View more button.
        let width = 0;
        let title = "";
        for (const char of name) {
            width += /^[\u0020-\u007e]$/.test(char) ? 1 : 2;
            if (width > 18) return title + "…";
            title += char;
        }
        return title;
    }

    async loadCreatorDirectory() {
        const creators = await this.loadCreators();
        return creators.map(({ slug, label, shortName }) => ({
            // Use native section headers as directory rows, without fake Comic items or cover requests.
            title: this.creatorDirectoryTitle(shortName),
            comics: [],
            viewMore: { page: "category", attributes: { category: label, param: `creator:${slug}` } },
        }));
    }

    loadCreator(slug, page) {
        if (!this.creatorSlug.test(slug)) throw new Error("CosplayTele: invalid cosplayer category");
        return this.loadList(`/category/${slug}/`, page);
    }

    async loadPopular(page, range = "last7days") {
        const limit = 20;
        const url = `${this.baseUrl}/wp-json/wordpress-popular-posts/v1/popular-posts` +
            `?offset=${(page - 1) * limit}&limit=${limit}&range=${range}&embed=true` +
            "&_embed=wp%3Afeaturedmedia&_fields=title,link,_embedded,_links.wp%3Afeaturedmedia";
        const body = await this.get(url, "application/json");
        let posts;
        try {
            posts = JSON.parse(body);
        } catch (error) {
            throw new Error(`CosplayTele: invalid popular posts JSON (${error.message})`);
        }
        if (!Array.isArray(posts)) throw new Error("CosplayTele: invalid popular posts response");
        const comics = [];
        const seen = new Set();
        for (const post of posts) {
            const id = this.postId(post?.link);
            const rendered = post?.title?.rendered;
            if (!id || typeof rendered !== "string" || seen.has(id)) continue;
            const title = this.parseHtml(rendered, doc => doc.querySelector("body")?.text.trim());
            if (!title) continue;
            const media = post._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
            seen.add(id);
            comics.push(new Comic({ id, title, cover: this.absoluteUrl(media, this.baseUrl + "/") ?? "" }));
        }
        if (posts.length && !comics.length) throw new Error("CosplayTele: invalid popular post entries");
        return { comics, maxPage: posts.length >= limit ? page + 1 : page };
    }

    explore = [
        { title: "CosplayTele · Latest", type: "multiPageComicList", load: page => this.loadList("/", page) },
        { title: "CosplayTele · Popular", type: "multiPageComicList", load: page => this.loadPopular(page) },
        { title: "CosplayTele · Creator Directory", type: "multiPartPage", load: () => this.loadCreatorDirectory() },
    ];

    search = {
        optionList: [{
            label: "CosplayTele Categories",
            type: "select",
            default: "all",
            options: ["all-All", ...this.categories.map(([key, label]) => `${key}-${label}`)],
        }],
        load: (keyword, options, page) => {
            const path = this.categories.find(([key]) => key === options?.[0])?.[2] ?? "/";
            return this.loadList(path, page, keyword.trim());
        },
    };

    categoryPart(name, entries) {
        return {
            name,
            type: "fixed",
            categories: entries.map(([key, label]) => ({
                label,
                target: { page: "category", attributes: { category: label, param: key } },
            })),
        };
    }

    category = {
        title: "CosplayTele",
        parts: [
            this.categoryPart("CosplayTele Categories", [...this.categories, ["best", "Best Cosplayer"]]),
            this.categoryPart("Top Cosplay", this.rankings),
        ],
    };

    categoryComics = {
        optionLoader: (category, param) => param === "best" ? this.loadCreatorOptions() : [],
        load: (category, param, options, page) => {
            if (param === "best") return this.loadCreator(decodeURIComponent(options?.[0] ?? ""), page);
            if (param?.startsWith("creator:")) return this.loadCreator(param.slice(8), page);
            const ranking = this.rankings.find(([key]) => key === param);
            if (ranking) return this.loadPopular(page, ranking[2]);
            const path = this.categories.find(([key]) => key === param)?.[2];
            if (!path) throw new Error("CosplayTele: unknown category");
            return this.loadList(path, page);
        },
    };

    comic = {
        loadInfo: async id => {
            const url = this.postUrl(id);
            return this.getHtml(url, document => {
                const title = document.querySelector(".entry-title")?.text.trim();
                if (!title) throw new Error("CosplayTele: gallery title not found");
                const cover = this.absoluteUrl(document.querySelector('meta[property="og:image"]')?.attributes.content, url)
                    ?? this.imageUrl(document.querySelector(".gallery-item img"), url) ?? "";
                const tags = {};
                for (const link of document.querySelectorAll("#main a")) {
                    const href = this.absoluteUrl(link.attributes.href, url);
                    const namespace = href?.match(/^https?:\/\/(?:www\.)?cosplaytele\.com\/(category|tag)\/[^/?#]/i)?.[1];
                    const label = link.text.trim();
                    if (!namespace || !label) continue;
                    const values = tags[namespace] ??= [];
                    if (!values.includes(label)) values.push(label);
                }
                const updateTime = document.querySelector("time.updated")?.attributes.datetime
                    ?.match(/^\d{4}-\d{2}-\d{2}(?=$|[T ])/)?.[0];
                const recommend = this.parseCards(
                    document.querySelectorAll("main .entry-content .crp_related li"), "a.crp_link", ".crp_title", url, id,
                );
                return new ComicDetails({
                    title, cover, tags, chapters: null, ...(updateTime ? { updateTime } : {}),
                    ...(recommend.length ? { recommend } : {}), url,
                });
            });
        },
        loadEp: async (id, epId) => {
            const url = this.postUrl(id);
            return this.getHtml(url, document => {
                const images = document.querySelectorAll(".gallery-item img")
                    .map(image => this.imageUrl(image, url));
                if (!images.length || images.some(image => !image)) {
                    throw new Error("CosplayTele: gallery images missing or unrecognized");
                }
                return { images };
            });
        },
        onImageLoad: (url, id) => this.imageConfig(url, this.postUrl(id)),
        onThumbnailLoad: url => this.imageConfig(url, this.baseUrl + "/"),
    };

    translation = {
        zh_CN: {
            "CosplayTele · Latest": "CosplayTele · 最新",
            "CosplayTele · Popular": "CosplayTele · 热门",
            "CosplayTele · Creator Directory": "CosplayTele · 作者目录",
            "Featured Cosplayers": "精选作者",
            "CosplayTele Categories": "CosplayTele 分类",
            "Best Cosplayer": "人气 Cosplayer",
            "Top Cosplay": "Cosplay 排行",
            "24 Hours": "24 小时",
            "3 Days": "3 天",
            "7 Days": "7 天",
            All: "全部",
        },
        zh_TW: {
            "CosplayTele · Latest": "CosplayTele · 最新",
            "CosplayTele · Popular": "CosplayTele · 熱門",
            "CosplayTele · Creator Directory": "CosplayTele · 作者目錄",
            "Featured Cosplayers": "精選作者",
            "CosplayTele Categories": "CosplayTele 分類",
            "Best Cosplayer": "人氣 Cosplayer",
            "Top Cosplay": "Cosplay 排行",
            "24 Hours": "24 小時",
            "3 Days": "3 天",
            "7 Days": "7 天",
            All: "全部",
        },
    };
}
