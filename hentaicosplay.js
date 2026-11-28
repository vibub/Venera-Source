// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's Hentai Cosplay extension and shared template (JS/Venera-Next port).
// Upstream: https://github.com/keiyoushi/extensions-source/tree/9f70fabf1105390dca5d5b3ae52d1cd8113afa7d/src/all/hentaicosplay
// Template: https://github.com/keiyoushi/extensions-source/tree/9f70fabf1105390dca5d5b3ae52d1cd8113afa7d/lib-multisrc/hentaicosplayxxx
// Referer default: https://github.com/keiyoushi/extensions-source/blob/9f70fabf1105390dca5d5b3ae52d1cd8113afa7d/core/src/main/kotlin/keiyoushi/source/KeiSource.kt
class HentaiCosplaySource extends ComicSource {
    name = "Hentai Cosplay";
    key = "hentaicosplay";
    version = "1.0.0";
    minAppVersion = "1.18.5";
    url = "";

    domain = "hentai-cosplay-xxx.com";
    baseUrl = `https://${this.domain}`;
    tagPaths = new Map();

    async getHtml(path, parse) {
        const result = await Network.get(this.baseUrl + path, { Accept: "text/html", Referer: this.baseUrl + "/" });
        if (result.status !== 200) throw new Error(`${this.name}: HTTP ${result.status}`);
        const document = new HtmlDocument(result.body);
        try {
            const title = document.querySelector("title")?.text.trim() ?? "";
            if (document.querySelector("#challenge-form, #cf-error-details") ||
                /^(?:Just a moment\.*|Attention Required! \| Cloudflare)$/i.test(title)) {
                throw new Error(`${this.name}: site returned a verification or access-denied page`);
            }
            return parse(document);
        } finally {
            document.dispose();
        }
    }

    // Gallery and taxonomy URLs use one slug segment. Canonicalize it without a browser URL API.
    route(value, kinds) {
        if (typeof value !== "string") return null;
        const url = value.trim();
        if (/[\\\s\u0000-\u001f\u007f]/.test(url)) return null;
        const urlParts = url.match(/^(?:https?:)?\/\/([^/?#]+)(.*)$/i);
        if (urlParts && urlParts[1].toLowerCase() !== this.domain) return null;
        const match = (urlParts ? urlParts[2] : url).match(/^\/(?:search\/(?=tag\/))?([^/]+)\/([^/?#]+)\/?(?:[?#].*)?$/);
        if (!match || !kinds.includes(match[1])) return null;
        let slug;
        try {
            slug = decodeURIComponent(match[2]);
        } catch (error) {
            if (!(error instanceof URIError)) throw error;
            return null;
        }
        if (/^(?:\.|\.\.)$|[\\/?#\u0000-\u001f\u007f]/.test(slug)) return null;
        return { kind: match[1], slug: encodeURIComponent(slug) };
    }

    galleryId(url) {
        return this.route(url, ["image", "story"])?.slug ?? null;
    }

    galleryPath(id, kind) {
        const path = `/${kind}/${id}/`;
        if (!id || this.galleryId(path) !== id) throw new Error(`${this.name}: invalid gallery ID`);
        return path;
    }

    archivePath(url) {
        const route = this.route(url, ["tag"]);
        return route ? `/search/tag/${route.slug}/` : null;
    }

    imageUrl(value, path, upgrade = false) {
        const url = value?.trim();
        if (!url || /[\\\s\u0000-\u001f\u007f]/.test(url)) return null;
        if (/^https?:\/\/[^/?#]+/i.test(url)) return upgrade ? url.replace(/^http:/i, "https:") : url;
        if (/^\/\/[^/?#]/.test(url)) return "https:" + url;
        if (/^\/\//.test(url) || /^(?:[^/]*:|[?#])/.test(url)) return null;
        return this.baseUrl + (url.startsWith("/") ? url : path + url);
    }

    cover(node, path) {
        return this.imageUrl(node?.attributes["data-src"], path, true)
            ?? this.imageUrl(node?.attributes.src, path, true) ?? "";
    }

    async loadList(archive, page) {
        const path = page === 1 ? archive : `${archive}page/${page}/`;
        return this.getHtml(path, document => {
            const desktop = document.querySelectorAll("div.image-list-item");
            const mobile = document.querySelector("#entry_list");
            const cards = desktop.length ? desktop : document.querySelectorAll("#entry_list > li");
            const comics = [];
            const seen = new Set();
            for (const card of cards) {
                const link = card.querySelector('a[href*="/image/"]');
                const id = this.galleryId(link?.attributes.href);
                const title = (desktop.length ? card.querySelector(".image-list-item-title") :
                    link?.querySelector("span:not(.posted)"))?.text.trim();
                if (!id || !title || seen.has(id)) continue;
                seen.add(id);
                comics.push(new Comic({ id, title, cover: this.cover(card.querySelector("img"), path) }));
            }
            if (!comics.length) {
                const empty = document.querySelector(".no-results, .no-result, #no-results");
                if (cards.length && !empty) throw new Error(`${this.name}: unrecognized gallery cards`);
                if (!mobile && !empty) throw new Error(`${this.name}: gallery list not found`);
            }
            const next = document.querySelector('div.wp-pagenavi > a[rel="next"][href], a.paginator_page[rel="next"][href]');
            return { comics, maxPage: comics.length && next ? page + 1 : page };
        });
    }

    async loadRankedTags() {
        return this.getHtml("/ranking-tag/", document => {
            const container = document.querySelector("#tags");
            if (!container) throw new Error(`${this.name}: ranked tag list not found`);
            const tags = this.readTags(container);
            if (!tags.size && container.querySelector("a")) throw new Error(`${this.name}: unrecognized ranked tags`);
            return [{ label: "Ranked Tags", options: ["all-All", ...Array.from(tags, ([path, name]) =>
                `${encodeURIComponent(path).replace(/-/g, "%2D")}-${name.replace(/\s*\(\d+\)\s*$/, "").trim()}`)] }];
        });
    }

    readTags(container) {
        const tags = new Map();
        for (const link of container?.querySelectorAll("a[href]") ?? []) {
            const path = this.archivePath(link.attributes.href);
            const label = link.text.trim();
            if (path && label && !tags.has(path)) tags.set(path, label);
        }
        return tags;
    }

    categoryTarget(label, param) {
        return { page: "category", attributes: { category: label, param } };
    }

    explore = [
        { title: "Hentai Cosplay · Latest", type: "multiPageComicList", load: page => this.loadList("/search/", page) },
        { title: "Hentai Cosplay · Popular", type: "multiPageComicList", load: page => this.loadList("/ranking/", page) },
    ];

    search = {
        load: async (keyword, options, page) => {
            const query = keyword.trim();
            if (/^https?:\/\//i.test(query)) {
                const id = this.galleryId(query);
                if (!id) return { comics: [], maxPage: 1 };
                const { title, cover } = await this.comic.loadInfo(id);
                return { comics: [new Comic({ id, title, cover })], maxPage: 1 };
            }
            const encoded = encodeURIComponent(query).replace(/%20/g, "+");
            return this.loadList(query ? `/search/keyword/${encoded}/` : "/search/", page);
        },
    };

    category = {
        title: "Hentai Cosplay",
        parts: [{
            name: "Categories",
            type: "fixed",
            categories: ["Ranked Tags", "Latest", "Popular"].map((label, index) => ({
                label, target: this.categoryTarget(label, ["tags", "latest", "popular"][index]),
            })),
        }],
    };

    categoryComics = {
        optionLoader: (category, param) => param === "tags" ? this.loadRankedTags() : [],
        load: (category, param, options, page) => {
            if (param === "popular") return this.loadList("/ranking/", page);
            if (param === "latest" || (param === "tags" && (!options?.[0] || options[0] === "all"))) {
                return this.loadList("/search/", page);
            }
            const value = param === "tags" ? decodeURIComponent(options[0]) : param;
            const path = this.archivePath(value);
            if (!path || value !== path) throw new Error(`${this.name}: invalid tag archive`);
            return this.loadList(path, page);
        },
    };

    relatedGalleries(document, path, id) {
        const recommend = [];
        const seen = new Set([id]);
        // Only expose recommendations already linked by the detail page; don't prefetch the story.
        for (const link of document.querySelectorAll('a[href*="/image/"], a[href*="/story/"]')) {
            const thumbnail = link.querySelector("amp-img.related-thumbnail, img.related-thumbnail, .related-thumbnail img, .related-thumbnail amp-img");
            if (!thumbnail) continue;
            const relatedId = this.galleryId(link.attributes.href);
            const title = link.querySelector(".related-title")?.text.trim() || thumbnail.attributes.alt?.trim() ||
                link.attributes.title?.trim() || link.text.trim();
            if (!relatedId || !title || seen.has(relatedId)) continue;
            seen.add(relatedId);
            recommend.push(new Comic({ id: relatedId, title, cover: this.cover(thumbnail, path) }));
        }
        return recommend;
    }

    imageConfig(url) {
        // KeiSource supplies the root Referer for both covers and pages; this template does not override it.
        return { url, headers: { Referer: this.baseUrl + "/" } };
    }

    comic = {
        link: { domains: [this.domain], linkToId: url => this.galleryId(url) },
        onClickTag: (namespace, tag) => {
            const path = namespace === "Tags" && this.tagPaths.get(tag);
            return path ? this.categoryTarget(tag, path) : null;
        },
        loadInfo: async id => {
            const path = this.galleryPath(id, "image");
            const { metadata, story } = await this.getHtml(path, document => {
                const heading = document.querySelector('meta[property="og:title"]')?.attributes.content?.trim() ?? "";
                const suffix = heading.lastIndexOf(" - ");
                const title = (suffix > 0 ? heading.slice(0, suffix) : heading) ||
                    document.querySelector("#display_image_detail_title")?.text.trim();
                if (!title) throw new Error(`${this.name}: gallery title not found`);
                const cover = this.imageUrl(document.querySelector('meta[property="og:image"]')?.attributes.content, path, true) ?? "";
                const labels = new Set();
                for (const container of document.querySelectorAll('[id="detail_tag"]')) {
                    for (const [archive, label] of this.readTags(container)) {
                        labels.add(label);
                        this.tagPaths.set(label, archive);
                    }
                }
                const tags = labels.size ? { Tags: [...labels] } : {};
                const recommend = this.relatedGalleries(document, path, id);
                const story = document.querySelectorAll('a[href*="/story/"]').some(link =>
                    this.route(link.attributes.href, ["story"])?.slug === id);
                return { metadata: { title, cover, tags, chapters: null, url: this.baseUrl + path, recommend }, story };
            });
            if (!metadata.recommend.length && story) {
                const storyPath = this.galleryPath(id, "story");
                // Recommendation cards are on the reader article, not the detail page. Only load its HTML.
                try {
                    metadata.recommend = await this.getHtml(storyPath, doc => this.relatedGalleries(doc, storyPath, id));
                } catch (error) {
                    log("warning", "Hentai Cosplay", `Optional recommendations: ${String(error)}`);
                }
            }
            const { recommend, ...details } = metadata;
            return new ComicDetails({ ...details, ...(recommend.length ? { recommend } : {}) });
        },
        loadEp: async (id, epId) => {
            const path = this.galleryPath(id, "story");
            return this.getHtml(path, document => {
                const images = document.querySelectorAll('amp-img[src*="upload"]:not(.related-thumbnail)')
                    .map(image => this.imageUrl(image.attributes.src, path));
                if (!images.length || images.some(image => !image)) {
                    throw new Error(`${this.name}: gallery images missing or unrecognized`);
                }
                return { images };
            });
        },
        onImageLoad: url => this.imageConfig(url),
        onThumbnailLoad: url => this.imageConfig(url),
    };

    translation = {
        zh_CN: {
            "Hentai Cosplay": "成人角色扮演",
            "Hentai Cosplay · Latest": "Hentai Cosplay · 最新",
            "Hentai Cosplay · Popular": "Hentai Cosplay · 热门",
            Categories: "分类", "Ranked Tags": "热门标签", Latest: "最新", Popular: "热门", Tags: "标签", All: "全部",
        },
        zh_TW: {
            "Hentai Cosplay": "成人角色扮演",
            "Hentai Cosplay · Latest": "Hentai Cosplay · 最新",
            "Hentai Cosplay · Popular": "Hentai Cosplay · 熱門",
            Categories: "分類", "Ranked Tags": "熱門標籤", Latest: "最新", Popular: "熱門", Tags: "標籤", All: "全部",
        },
    };
}
