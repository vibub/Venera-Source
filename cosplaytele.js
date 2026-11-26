// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's CosplayTele extension (changes: JS/Venera-Next port).
// Upstream: https://github.com/keiyoushi/extensions-source/tree/92906c0382547f30a03b3176f2f2429be6b54dce/src/all/cosplaytele
class CosplayTeleSource extends ComicSource {
    name = "CosplayTele";
    key = "cosplaytele";
    version = "1.0.0";
    minAppVersion = "1.18.5";
    url = "";

    baseUrl = "https://cosplaytele.com";
    categories = [
        ["nude", "Cosplay Nude", "/category/nude/"],
        ["ero", "Cosplay Ero", "/category/no-nude/"],
        ["cosplay", "Cosplay", "/category/cosplay/"],
    ];

    async get(url, accept) {
        const response = await Network.get(url, { Accept: accept });
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

    async getHtml(url, parse) {
        return this.parseHtml(await this.get(url, "text/html"), parse);
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
            const comics = [];
            const seen = new Set();
            for (const card of main.querySelectorAll("div.box")) {
                const link = card.querySelector("h5 a");
                const id = this.postId(link?.attributes.href);
                const title = link?.text.trim();
                if (!id || !title || seen.has(id)) continue;
                const cover = this.imageUrl(card.querySelector("img"), pageUrl) ?? "";
                seen.add(id);
                comics.push(new Comic({ id, title, cover }));
            }
            const hasNext = document.querySelector(".next.page-number") !== null;
            return { comics, maxPage: hasNext ? page + 1 : page };
        });
    }

    async loadPopular(page) {
        const limit = 20;
        const url = `${this.baseUrl}/wp-json/wordpress-popular-posts/v1/popular-posts` +
            `?offset=${(page - 1) * limit}&limit=${limit}&range=last7days&embed=true` +
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

    category = {
        title: "CosplayTele",
        parts: [{
            name: "CosplayTele Categories",
            type: "fixed",
            categories: this.categories.map(([key, label]) => ({
                label,
                target: { page: "category", attributes: { category: label, param: key } },
            })),
        }],
    };

    categoryComics = {
        load: (category, param, options, page) => {
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
                return new ComicDetails({ title, cover, tags, chapters: null, ...(updateTime ? { updateTime } : {}), url });
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
            "CosplayTele Categories": "CosplayTele 分类",
            All: "全部",
        },
        zh_TW: {
            "CosplayTele · Latest": "CosplayTele · 最新",
            "CosplayTele · Popular": "CosplayTele · 熱門",
            "CosplayTele Categories": "CosplayTele 分類",
            All: "全部",
        },
    };
}
