// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's Kiutaku extension (changes: JS/Venera-Next port and single-volume gallery pagination).
// Upstream: https://github.com/keiyoushi/extensions-source/tree/9f70fabf1105390dca5d5b3ae52d1cd8113afa7d/src/all/kiutaku
class KiutakuSource extends ComicSource {
    name = "Kiutaku";
    key = "kiutaku";
    version = "1.0.0";
    minAppVersion = "1.18.5";
    url = "";

    baseUrl = "https://kiutaku.com";
    tagIds = new Map();

    async getHtml(url, parse) {
        const response = await Network.get(url, { Accept: "text/html" });
        if (response.status !== 200) {
            throw new Error(`Kiutaku: HTTP ${response.status} (${url.split("?")[0]})`);
        }
        const document = new HtmlDocument(response.body);
        try {
            return parse(document);
        } finally {
            document.dispose();
        }
    }

    // Only gallery and tag links on Kiutaku are eligible for routing.
    sitePath(value) {
        const href = typeof value === "string" ? value.trim() : "";
        const path = href.replace(/^(?:https?:)?\/\/(?:www\.)?kiutaku\.com(?=\/|$)/i, "");
        return /^\/(?!\/)[^\s\\]*$/.test(path) ? path : null;
    }

    galleryId(value) {
        return this.sitePath(value)?.match(/^\/([1-9]\d*)\/?(?:[?#]|$)/)?.[1] ?? null;
    }

    galleryUrl(id) {
        if (!/^[1-9]\d*$/.test(id)) throw new Error("Kiutaku: invalid gallery ID");
        return `${this.baseUrl}/${id}`;
    }

    imageUrl(node) {
        const src = node?.attributes.src?.trim();
        if (!src || /[\s\\]/.test(src)) return null;
        if (/^https?:\/\/[^/?#]+/i.test(src)) return src;
        if (/^\/\/[^/?#]/.test(src)) return `https:${src}`;
        if (src.startsWith("//") || /^[?#]|^[^/]*:/.test(src)) return null;
        return `${this.baseUrl}/${src.replace(/^\//, "")}`;
    }

    cards(rows, excludeId) {
        const comics = [];
        const seen = new Set();
        for (const row of rows) {
            const id = this.galleryId(row.querySelector("a.item-link")?.attributes.href);
            if (!id || id === excludeId || seen.has(id)) continue;
            const title = row.querySelector("h2")?.text.trim() || "Cosplay";
            const cover = this.imageUrl(row.querySelector("img")) ?? "";
            comics.push(new Comic({ id, title, cover }));
            seen.add(id);
        }
        return comics;
    }

    loadList(path, page, keyword = "") {
        const requested = `${path}?${keyword ? `search=${encodeURIComponent(keyword)}&` : ""}start=${(page - 1) * 20}`;
        return this.getHtml(this.baseUrl + requested, document => {
            const main = document.querySelector(path === "/hot" ? ".main-body.view-hot" : ".main-body.view-items");
            const rows = main?.querySelectorAll("div.blog > div.items-row") ?? [];
            const comics = this.cards(rows);
            if (rows.length ? !comics.length : !main?.querySelector("pre")?.text.trim().includes("No item here!")) {
                throw new Error("Kiutaku: gallery list not found or unrecognized");
            }
            const hasNext = main.querySelectorAll("nav > a.pagination-next[href]:not([disabled]):not(.disabled)")
                .some(link => {
                    const next = this.sitePath(link.attributes.href)?.split("#")[0];
                    return next?.split("?")[0] === path &&
                        next.split("?")[1]?.split("&").includes(`start=${page * 20}`);
                });
            return { comics, maxPage: hasNext ? page + 1 : page };
        });
    }

    galleryTitle(document) {
        const title = document.querySelector("div.article-header")?.text.trim();
        if (!title) throw new Error("Kiutaku: gallery title not found");
        return title;
    }

    readGalleryPage(document, id, page) {
        const title = this.galleryTitle(document);
        const pager = document.querySelector("nav.pagination");
        const images = document.querySelectorAll("div.article-fulltext img[src]").map(node => this.imageUrl(node));
        if (!images.length || images.some(image => !image)) {
            throw new Error(`Kiutaku: gallery images missing or unrecognized on page ${page}`);
        }
        const links = pager?.querySelectorAll(".pagination-list a.pagination-link") ?? [];
        const current = pager?.querySelector("a.pagination-link.is-current")?.text.trim();
        if ((current && Number(current) !== page) || (page > 1 && !current)) {
            throw new Error(`Kiutaku: unexpected gallery page ${page}`);
        }
        const pages = new Set([page]);
        for (const link of links) {
            const label = link.text.trim();
            if (!/^[1-9]\d*$/.test(label)) continue;
            const href = link.attributes.href?.trim();
            const path = this.sitePath(href?.startsWith("?") ? `/${id}${href}` : href);
            const pageParam = path?.split("#")[0].match(/[?&]page=([1-9]\d*)(?:&|$)/)?.[1] ?? "1";
            if (this.galleryId(path) === id && label === pageParam) pages.add(Number(label));
        }
        const expected = Number(title.match(/\(\s*Page\s+\d+\s*\/\s*(\d+)\s*\)\s*$/i)?.[1] ?? 1);
        return { images, pages: [...pages], expected };
    }

    explore = [
        { title: "Kiutaku · Latest", type: "multiPageComicList", load: page => this.loadList("/", page) },
        { title: "Kiutaku · Popular", type: "multiPageComicList", load: page => this.loadList("/hot", page) },
    ];

    search = { load: (keyword, options, page) => this.loadList("/", page, keyword.trim()) };

    // Venera 1.18.5 also requires categoryData for category links opened from tags.
    category = {
        title: "Kiutaku",
        parts: [{
            name: "Browse",
            type: "fixed",
            categories: [["Kiutaku · Latest", "/"], ["Kiutaku · Popular", "/hot"]].map(([label, param]) => ({
                label,
                target: { page: "category", attributes: { category: label, param } },
            })),
        }],
    };

    categoryComics = {
        load: (category, param, options, page) => {
            if (param !== "/" && param !== "/hot" && !/^\/tag\/[1-9]\d*$/.test(param)) {
                throw new Error("Kiutaku: invalid gallery archive");
            }
            return this.loadList(param, page);
        },
    };

    comic = {
        link: { domains: ["kiutaku.com", "www.kiutaku.com"], linkToId: url => this.galleryId(url) },
        onClickTag: (namespace, tag) => {
            const param = namespace === "tag" && this.tagIds.get(tag);
            return param ? { page: "category", attributes: { category: tag, param } } : null;
        },
        loadInfo: id => {
            const url = this.galleryUrl(id);
            return this.getHtml(url, document => {
                const title = this.galleryTitle(document).replace(/\s*-?\s*\(\s*Page\s+\d+\s*\/\s*\d+\s*\)\s*$/i, "");
                const cover = this.imageUrl(document.querySelector("div.article-fulltext img[src]")) ?? "";
                const tags = [];
                for (const link of document.querySelectorAll("div.article-tags a.tag")) {
                    const label = link.querySelector("span")?.text.trim().replace(/^#+\s*/, "");
                    const path = this.sitePath(link.attributes.href)?.match(/^\/tag\/[1-9]\d*(?=\/?(?:[?#]|$))/)?.[0];
                    if (!label || !path || tags.includes(label)) continue;
                    this.tagIds.set(label, path);
                    tags.push(label);
                }
                const recommend = this.cards(document.querySelectorAll("div.bottom-articles .items-row"), id);
                return new ComicDetails({ title, cover, tags: tags.length ? { tag: tags } : {}, chapters: null, recommend, url });
            });
        },
        loadEp: async id => {
            const url = this.galleryUrl(id);
            const first = await this.getHtml(url, document => this.readGalleryPage(document, id, 1));
            const pages = first.pages.sort((a, b) => a - b);
            if (pages.length < first.expected || pages.some((page, index) => page !== index + 1)) {
                throw new Error("Kiutaku: incomplete gallery pagination");
            }
            const images = first.images;
            for (const page of pages.slice(1)) {
                const result = await this.getHtml(`${url}?page=${page}`, document => this.readGalleryPage(document, id, page));
                for (const image of result.images) images.push(image);
            }
            return { images };
        },
        // The upstream mitaku.net CDN rejects a Kiutaku Referer on both covers and pages.
        onImageLoad: url => ({ url }),
        onThumbnailLoad: url => ({ url }),
    };

    translation = {
        zh_CN: { "Kiutaku · Latest": "Kiutaku · 最新", "Kiutaku · Popular": "Kiutaku · 热门", Browse: "浏览", tag: "标签" },
        zh_TW: { "Kiutaku · Latest": "Kiutaku · 最新", "Kiutaku · Popular": "Kiutaku · 熱門", Browse: "瀏覽", tag: "標籤" },
    };
}
