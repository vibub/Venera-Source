// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's OSOSEDKI extension for Venera-Next.
// Upstream: https://github.com/keiyoushi/extensions-source/tree/92906c0382547f30a03b3176f2f2429be6b54dce/src/all/ososedki
class OsosedkiSource extends ComicSource {
    name = "OSOSEDKI";
    key = "ososedki";
    version = "1.0.0";
    minAppVersion = "1.18.5";
    url = "";

    baseUrl = "https://ososedki.com";
    domains = ["ososedki.com", "www.ososedki.com"];
    albumId = /^-?\d+_\d+$/;
    filters = [["model", "Model"], ["cosplay", "Character"], ["fandom", "Series"]];
    tagValues = new Map();

    async get(url, headers) {
        const { status, body } = await Network.get(url, headers);
        if (status !== 200) throw new Error(`OSOSEDKI: HTTP ${status} (${url.split("?")[0]})`);
        return body;
    }

    parseHtml(html, parse) {
        const document = new HtmlDocument(html);
        try {
            return parse(document);
        } finally {
            document.dispose();
        }
    }

    // Resolve the forms used by the site without QuickJS browser globals.
    absoluteUrl(value, from = this.baseUrl + "/") {
        const href = value?.trim();
        if (!href || /[\s\\\u0000-\u001f\u007f]/.test(href) || /^[?#]/.test(href)) return null;
        if (/^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i.test(href)) return href;
        if (href.startsWith("//")) return /^\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i.test(href) ? "https:" + href : null;
        if (/^[^/]*:/.test(href)) return null;
        if (href.startsWith("/")) return this.baseUrl + href;
        return from.slice(0, from.lastIndexOf("/") + 1) + href.replace(/^(?:\.\/)+/, "");
    }

    sitePath(url) {
        return url?.match(/^https?:\/\/(?:www\.)?ososedki\.com(\/[^?#]*)(?:[?#]|$)/i)?.[1];
    }

    idFromLink(url) {
        const segment = this.sitePath(url)?.match(/^\/photos\/([^/]+)\/?$/)?.[1];
        const id = segment && this.decodeSegment(segment);
        return id && this.albumId.test(id) ? id : null;
    }

    decodeSegment(segment) {
        try {
            return decodeURIComponent(segment);
        } catch (error) {
            if (!(error instanceof URIError)) throw error;
            return null;
        }
    }

    archiveFromLink(url) {
        const match = this.sitePath(url)?.match(/^\/(model|cosplay|fandom)\/([^/]+)\/?$/);
        if (!match) return null;
        const value = this.decodeSegment(match[2])?.replace(/\+/g, " ").trim();
        return value && !/[\u0000-\u001f\u007f]/.test(value) ? [match[1], value] : null;
    }

    photoUrl(id) {
        if (!this.albumId.test(id)) throw new Error("OSOSEDKI: invalid album ID");
        return `${this.baseUrl}/photos/${id}`;
    }

    coverUrl(id) {
        const [owner, album] = id.split("_");
        return `${this.baseUrl}/images/albums/${owner}/${album}.webp`;
    }

    cardCover(card, from) {
        const image = card.querySelector("img.gallery-img")?.attributes;
        return this.absoluteUrl(image?.["data-src"], from) ?? this.absoluteUrl(image?.src, from);
    }

    async loadAlbums(page, type = "", value = "") {
        const url = `${this.baseUrl}/api/albums?page=${page}` + (type ? `&type=${type}&value=${encodeURIComponent(value)}` : "");
        const body = await this.get(url, {
            Accept: "application/json",
            Referer: this.baseUrl + "/",
            "X-Requested-With": "XMLHttpRequest",
        });
        let result;
        try {
            result = JSON.parse(body);
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            throw new Error("OSOSEDKI: invalid album list JSON");
        }
        if (typeof result?.html !== "string" || (result.hasMore !== undefined && typeof result.hasMore !== "boolean")) {
            throw new Error("OSOSEDKI: invalid album list response");
        }
        if (!result.html.trim() && !result.hasMore) return { comics: [], maxPage: page };

        const comics = this.parseHtml(result.html, document => {
            const comics = [];
            for (const card of document.querySelectorAll("article.gallery-item")) {
                const link = card.querySelector("a.gallery-link");
                if (!link) continue;
                const id = this.idFromLink(this.absoluteUrl(link.attributes.href));
                if (!id) throw new Error("OSOSEDKI: invalid album link in list");
                const title = card.querySelector("h3")?.text.trim() ||
                    card.querySelector("img.gallery-img")?.attributes.alt?.split(" nude.")[0].trim();
                if (!title) throw new Error("OSOSEDKI: album title missing in list");
                const subtitle = card.querySelector("span.badge:not(.bg-dark)")?.text.trim();
                const cover = this.cardCover(card) ?? this.coverUrl(id);
                comics.push(new Comic({ id, title, cover, ...(subtitle ? { subtitle } : {}) }));
            }
            if (!comics.length) throw new Error("OSOSEDKI: album cards missing from list");
            return comics;
        });
        return { comics, maxPage: result.hasMore ? page + 1 : page };
    }

    loadPopular(page) {
        return this.loadAlbums(page, "top", "1");
    }

    async loadSearch(keyword, options, page) {
        const query = keyword.trim();
        if (!query) return this.loadPopular(page);
        const selected = this.filters.find(([key]) => key === options?.[0]);
        if (selected) return this.loadAlbums(page, selected[0], query);
        if (/^https?:\/\//i.test(query)) {
            const id = this.idFromLink(query);
            if (id) {
                if (page !== 1) return { comics: [], maxPage: 1 };
                const { title, cover, subtitle } = await this.loadDetails(id);
                return { comics: [new Comic({ id, title, cover, ...(subtitle ? { subtitle } : {}) })], maxPage: 1 };
            }
            const archive = this.archiveFromLink(query);
            if (archive) return this.loadAlbums(page, ...archive);
            return { comics: [], maxPage: page };
        }
        return this.loadAlbums(page, "search", query);
    }

    async loadDetails(id) {
        const url = this.photoUrl(id);
        const html = await this.get(url, { Accept: "text/html" });
        return this.parseHtml(html, document => {
            const tags = {};
            const tagEntries = [];
            for (const link of document.querySelectorAll("a[href]")) {
                const archive = this.archiveFromLink(this.absoluteUrl(link.attributes.href, url));
                const label = link.text.replace(/\s+/g, " ").trim();
                if (!archive || !label) continue;
                const [type, value] = archive;
                const group = tags[type] ??= [];
                if (group.includes(label)) continue;
                group.push(label);
                tagEntries.push([`${type}:${label}`, value]);
            }
            // A generic h1 alone also matches access-denied and other non-album pages.
            if (!tagEntries.length && !document.querySelector("#photos")) {
                throw new Error("OSOSEDKI: album detail structure not found");
            }
            const title = this.filters.map(([key]) => tags[key]?.[0]).filter(Boolean).join(" - ") ||
                document.querySelector("h1")?.text.trim()
                    .replace(/\s*\(\d+\s+leaked\s+photos\)\s+from\s+Onlyfans,\s+Patreon\s+and\s+Fansly\s*$/i, "").trim();
            if (!title) throw new Error("OSOSEDKI: album title missing from detail");
            const subtitle = tags.model?.join(", ");
            const uploadTime = this.uploadDate(document);
            for (const [key, value] of tagEntries) this.tagValues.set(key, value);
            return new ComicDetails({
                title, cover: this.coverUrl(id), tags, chapters: null, url,
                ...(subtitle ? { subtitle } : {}), ...(uploadTime ? { uploadTime } : {}),
            });
        });
    }

    uploadDate(document) {
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            const date = script.text.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})(?=[T "])/)?.[1];
            const parsed = date && new Date(date);
            if (parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) return date;
        }
    }

    imageNumber(url) {
        const filename = this.sitePath(url).split("/").pop();
        const number = this.decodeSegment(filename)?.split(".")[0];
        return /^[+-]?\d+$/.test(number) && Number.isSafeInteger(+number) ? +number : Infinity;
    }

    async loadImages(id) {
        const url = this.photoUrl(id);
        const html = await this.get(url, { Accept: "text/html" });
        return this.parseHtml(html, document => {
            const photos = document.querySelector("#photos");
            const links = photos?.querySelectorAll("a[href]") ?? [];
            const urls = links.map(link => this.absoluteUrl(link.attributes.href, url))
                .filter(image => this.sitePath(image)?.startsWith("/images/"));
            if (!urls.length) throw new Error("OSOSEDKI: album images missing or unrecognized");
            // Keiyoushi removes duplicate anchors before ordering album pages by filename number.
            const images = [...new Set(urls)].sort((left, right) => this.imageNumber(left) - this.imageNumber(right));
            return { images };
        });
    }

    imageConfig(url) {
        return { url, headers: { Referer: this.baseUrl + "/" } };
    }

    pageImageConfig(url) {
        const config = this.imageConfig(url);
        if (this.sitePath(url)?.startsWith("/images/a/1280/")) {
            // v1.18.5 passes no error/status to onLoadFailed. Confirm upstream's 404-only fallback
            // with one bodyless request; the new config deliberately has no retry callback.
            config.onLoadFailed = async () => {
                const { status } = await Network.sendRequest("HEAD", url, { ...config.headers, "cache-time": "no" });
                if (status !== 404) return null;
                const fallback = url.replace(/^(https?:\/\/[^/]+\/images\/a\/)1280\//i, (_, prefix) => prefix + "604/");
                return this.imageConfig(fallback);
            };
        }
        return config;
    }

    explore = [
        { title: "OSOSEDKI · Latest", type: "multiPageComicList", load: page => this.loadAlbums(page) },
        { title: "OSOSEDKI · Popular", type: "multiPageComicList", load: page => this.loadPopular(page) },
    ];

    search = {
        optionList: [{
            label: "Search by",
            type: "select",
            default: "search",
            options: ["search-Keyword", ...this.filters.map(([key, label]) => `${key}-${label}`)],
        }],
        load: (keyword, options, page) => this.loadSearch(keyword, options, page),
    };

    comic = {
        loadInfo: id => this.loadDetails(id),
        loadEp: (id, epId) => this.loadImages(id),
        onClickTag: (namespace, tag) => {
            const value = this.tagValues.get(`${namespace}:${tag}`);
            // A category jump requires a separate category directory in Venera-Next.
            return value ? { page: "search", attributes: { text: value, options: [namespace] } } : null;
        },
        link: { domains: this.domains, linkToId: url => this.idFromLink(url) },
        idMatch: "^-?\\d+_\\d+$",
        onImageLoad: url => this.pageImageConfig(url),
        onThumbnailLoad: url => this.imageConfig(url),
    };

    translation = {
        zh_CN: {
            "OSOSEDKI · Latest": "OSOSEDKI · 最新",
            "OSOSEDKI · Popular": "OSOSEDKI · 热门",
            "Search by": "搜索方式",
            Keyword: "关键词", Model: "模特", Character: "角色", Series: "作品",
            model: "模特", cosplay: "角色", fandom: "作品",
        },
        zh_TW: {
            "OSOSEDKI · Latest": "OSOSEDKI · 最新",
            "OSOSEDKI · Popular": "OSOSEDKI · 熱門",
            "Search by": "搜尋方式",
            Keyword: "關鍵字", Model: "模特兒", Character: "角色", Series: "作品",
            model: "模特兒", cosplay: "角色", fandom: "作品",
        },
    };
}
