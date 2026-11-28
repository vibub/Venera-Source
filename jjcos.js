// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's JJCOS extension (JS/Venera-Next port).
// Upstream: https://github.com/keiyoushi/extensions-source/tree/9f70fabf1105390dca5d5b3ae52d1cd8113afa7d/src/all/jjcos
class JJCOSSource extends ComicSource {
    name = "JJCOS";
    key = "jjcos";
    version = "1.0.0";
    minAppVersion = "1.18.5";
    url = "";

    baseUrl = "https://jjcos.com";
    pageSize = 20;
    cosplayTag = "/tag/HSQ2151O0wZ";
    tagPaths = new Map();
    searchIndex = null;

    text(node) {
        return node?.text.replace(/\s+/g, " ").trim() ?? "";
    }

    albumPath(value) {
        if (typeof value !== "string") return null;
        const href = value.trim().split(/[?#]/, 1)[0];
        if (!href || /[\\\u0000-\u001f\u007f]/.test(href)) return null;
        const path = href.replace(/^(?:https?:)?\/\/(?:www\.)?jjcos\.com(?=\/)/i, "")
            .replace(/^post\//, "/post/").replace(/\/+$/, "");
        if (!path.startsWith("/post/")) return null;
        const segments = path.slice(6).split("/");
        if (segments.some(segment => !segment || /^(?:\.|%2e){1,2}$/i.test(segment) ||
            /%(?:00|2f|5c)|%(?![0-9a-f]{2})/i.test(segment))) return null;
        return "/post/" + segments.map(segment => segment.split(/(%[0-9a-f]{2})/i)
            .map((part, index) => index % 2 ? part.toUpperCase() : encodeURIComponent(part)).join("")).join("/");
    }

    albumId(value) {
        return this.albumPath(value)?.slice(6) ?? null;
    }

    albumUrl(id) {
        if (typeof id !== "string" || this.albumId(`/post/${id}`) !== id) throw new Error("JJCOS: invalid album ID");
        return `${this.baseUrl}/post/${id}`;
    }

    imageUrl(value, pageUrl) {
        const src = typeof value === "string" ? value.trim() : "";
        if (!src || /[\s\\\u0000-\u001f\u007f]/.test(src)) return null;
        if (/^(?:https?:)?\/\/[a-z0-9.-]+(?::\d+)?(?=\/|$)/i.test(src)) return src.startsWith("//") ? "https:" + src : src;
        if (/^\/\/|^[^/]*:|^[?#]/.test(src)) return null;
        return src.startsWith("/") ? this.baseUrl + src : pageUrl.slice(0, pageUrl.lastIndexOf("/") + 1) + src;
    }

    async get(url, accept) {
        const response = await Network.get(url, { Accept: accept });
        const { status, headers, body } = response;
        if (headers?.["cf-mitigated"] === "challenge" || /<title>\s*Just a moment/i.test(body)) {
            throw new Error(`CloudflareException: ${url}`);
        }
        if (status !== 200) throw new Error(`JJCOS: HTTP ${status} (${url.split("?")[0]})`);
        return body;
    }

    async html(url, parse) {
        const doc = new HtmlDocument(await this.get(url, "text/html"));
        try {
            return parse(doc);
        } finally {
            doc.dispose();
        }
    }

    tagPath(value) {
        return typeof value === "string" ? value.trim().match(/^(?:(?:https?:)?\/\/(?:www\.)?jjcos\.com)?(\/tag\/[\w-]+)\/?(?:[?#]|$)/i)?.[1] ?? null : null;
    }

    categoryTarget(label, path) {
        return { page: "category", attributes: { category: label, param: path } };
    }

    async loadArchive(path, page) {
        const url = this.baseUrl + path + (page === 1 ? "/" : `/page/${page}/`);
        return this.html(url, doc => {
            const root = doc.querySelector(".fh5co-post-entry");
            if (!root) throw new Error("JJCOS: tag archive not found");
            const cards = root.querySelectorAll("article.custom-article");
            const comics = [];
            const seen = new Set();
            for (const card of cards) {
                const link = card.querySelector(".fh5co-article-title a");
                const id = this.albumId(link?.attributes.href);
                const title = this.text(link);
                if (!id || !title || seen.has(id)) continue;
                seen.add(id);
                const image = card.querySelector("figure img");
                comics.push(new Comic({ id, title, cover: image ? this.photo(image, url) ?? "" : "" }));
            }
            if (cards.length && !comics.length) throw new Error("JJCOS: unrecognized archive entries");
            let maxPage = page;
            for (const link of doc.querySelectorAll(".pagination-ul a[href]")) {
                const href = link.attributes.href.replace(/^(?:https?:)?\/\/(?:www\.)?jjcos\.com(?=\/)/i, "");
                if (!href.startsWith(path + "/page/")) continue;
                const number = Number(href.slice(path.length).match(/^\/page\/([1-9]\d*)\/?(?:[?#]|$)/)?.[1]);
                if (Number.isSafeInteger(number)) maxPage = Math.max(maxPage, number);
            }
            return { comics, maxPage: comics.length ? maxPage : page };
        });
    }

    async loadIndex() {
        // /api/index.html redirects to the canonical JSON resource.
        const body = await this.get(this.baseUrl + "/api/", "application/json");
        let result;
        try {
            result = JSON.parse(body);
        } catch (error) {
            throw new Error(`JJCOS: invalid list JSON (${error.message})`);
        }
        if (!Array.isArray(result?.posts)) throw new Error("JJCOS: post index not found");
        return result.posts;
    }

    async searchPosts(keyword, page) {
        const needle = keyword.trim().toLowerCase();
        if (!needle) return this.loadArchive(this.cosplayTag, page);
        // The site returns the same large index regardless of page or query.
        if (!this.searchIndex || Date.now() >= this.searchIndex.expires) {
            this.searchIndex = { rows: this.loadIndex(), expires: Infinity };
        }
        const current = this.searchIndex;
        let rows;
        try {
            rows = await current.rows;
        } catch (error) {
            if (this.searchIndex === current) this.searchIndex = null;
            throw error;
        }
        if (current.expires === Infinity) current.expires = Date.now() + 5 * 60 * 1000;
        const start = (page - 1) * this.pageSize;
        const comics = [];
        const seen = new Set();
        let matched = 0;
        for (const row of rows) {
            const title = typeof row?.title === "string" ? row.title.trim() : "";
            if (!title.toLowerCase().includes(needle) &&
                !(typeof row?.content === "string" && row.content.toLowerCase().includes(needle))) continue;
            const id = this.albumId(row.link);
            if (!id || !title || seen.has(id)) continue;
            seen.add(id);
            if (matched++ < start) continue;
            if (comics.length === this.pageSize) return { comics, maxPage: page + 1 };
            comics.push(new Comic({ id, title, cover: this.imageUrl(row.feature, this.baseUrl + "/") ?? "" }));
        }
        return { comics, maxPage: page };
    }

    async album(id, parse) {
        const url = this.albumUrl(id);
        return this.html(url, doc => {
            const title = this.text(doc.querySelector("h1.fh5co-article-title")).replace(/\s+[-|]\s+JJCOS$/i, "");
            if (!title) throw new Error("JJCOS: album details not found");
            return parse(doc, title, url);
        });
    }

    imageNodes(doc) {
        const content = doc.querySelector("#post-content");
        return content ? content.querySelectorAll("img") : doc.querySelectorAll("article p img");
    }

    photo(node, url) {
        return this.imageUrl(node.attributes["data-src"], url) ?? this.imageUrl(node.attributes.src, url);
    }

    explore = [{ title: "JJCOS · Browse", type: "multiPageComicList", load: page => this.loadArchive(this.cosplayTag, page) }];

    search = { load: (keyword, options, page) => this.searchPosts(keyword, page) };

    category = {
        title: "JJCOS",
        parts: [{ name: "Categories", type: "fixed", categories: [
            { label: "Cosplay", target: this.categoryTarget("Cosplay", this.cosplayTag) },
        ] }],
    };

    categoryComics = {
        load: (category, param, options, page) => {
            const path = this.tagPath(param);
            if (!path) throw new Error("JJCOS: invalid tag archive");
            return this.loadArchive(path, page);
        },
    };

    comic = {
        link: { domains: ["jjcos.com", "www.jjcos.com"], linkToId: url => this.albumId(url) },
        onClickTag: (namespace, tag) => {
            const path = namespace === "Tags" && this.tagPaths.get(tag);
            return path ? this.categoryTarget(tag, path) : null;
        },
        loadInfo: id => this.album(id, (doc, title, url) => {
            const labels = new Set();
            for (const link of doc.querySelectorAll(".tag-container a.tag")) {
                const label = this.text(link).replace(/^#\s*/, "");
                if (!label) continue;
                labels.add(label);
                const path = this.tagPath(link.attributes.href);
                if (path) this.tagPaths.set(label, path);
            }
            const firstImage = this.imageNodes(doc)[0];
            const photo = firstImage ? this.photo(firstImage, url) : null;
            const cover = this.imageUrl(doc.querySelector('meta[property="og:image"]')?.attributes.content, url) ?? photo ?? "";
            const date = doc.querySelector('meta[property="article:published_time"]')?.attributes.content ||
                this.text(doc.querySelector(".breadcrumb-item.date-overlay"));
            const uploadTime = date.match(/^\d{4}-\d{2}-\d{2}(?=$|[T |])/)?.[0];
            return new ComicDetails({ title, cover, tags: labels.size ? { Tags: [...labels] } : {},
                chapters: null, ...(uploadTime ? { uploadTime } : {}), url });
        }),
        loadEp: id => this.album(id, (doc, title, url) => {
            const images = this.imageNodes(doc).map(node => this.photo(node, url));
            if (!images.length || images.some(image => !image)) throw new Error("JJCOS: album images missing or unrecognized");
            return { images };
        }),
        onImageLoad: (url, id) => ({ url, headers: { Referer: this.albumUrl(id) } }),
        onThumbnailLoad: url => ({ url, headers: { Referer: this.baseUrl + "/" } }),
    };

    translation = {
        zh_CN: { "JJCOS · Browse": "JJCOS · 浏览", Categories: "分类", Tags: "标签" },
        zh_TW: { "JJCOS · Browse": "JJCOS · 瀏覽", Categories: "分類", Tags: "標籤" },
    };
}
