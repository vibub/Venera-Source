// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi's CosplayRule34 extension (JS/Venera-Next port).
// Upstream: https://github.com/keiyoushi/extensions-source/tree/92906c0382547f30a03b3176f2f2429be6b54dce/src/all/cosplayrule34
class CosplayRule34Source extends ComicSource {
    name = "CosplayRule34";
    key = "cosplayrule34";
    version = "1.0.0";
    minAppVersion = "1.18.5";
    url = "";

    baseUrl = "https://cosplayrule34.com";
    domains = ["cosplayrule34.com", "www.cosplayrule34.com"];
    siteOrigin = /^https?:\/\/(?:www\.)?cosplayrule34\.com(?=\/|\?|#|$)/i;
    categories = [
        ["cosplay", "Cosplay"], ["asian", "Asian"], ["thots", "OnlyFans"],
        ["tiktok", "TikTok"], ["art", "Art"], ["celebs", "Celebs"],
        ["erotic", "Erotic"], ["tattoo", "Tattoo"], ["dark", "Dark"],
        ["fitness", "Fitness"], ["porno", "Porno"], ["amateur", "Amateur"],
    ];
    tagTypes = [["model", "Model"], ["cosplay", "Character"], ["fandom", "Fandom"], ["category", "Category"]];
    firstPageSizes = new Map();
    tagPaths = new Map();

    checkedBody(response, operation) {
        const { status, body } = response;
        if (status === 429 || status === 503) {
            const reason = status === 429 ? "rate limit" : "temporarily unavailable or rate limited";
            throw new Error(`CosplayRule34: ${operation}: ${reason} (HTTP ${status})`);
        }
        if (status !== 200) throw new Error(`CosplayRule34: ${operation}: HTTP ${status}`);
        if (Object.entries(response.headers ?? {}).some(([key, value]) =>
            key.toLowerCase() === "cf-mitigated" && value === "challenge") ||
            /<title>\s*(?:just a moment|access denied|attention required)|<form\b[^>]*\bid=["']challenge-form/i.test(body)) {
            throw new Error(`CosplayRule34: ${operation}: access denied or verification page`);
        }
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

    async getHtml(url, operation, parse) {
        const response = await Network.get(url, { Accept: "text/html" });
        return this.parseHtml(this.checkedBody(response, operation), parse);
    }

    // Shared by links and list navigation; archive slugs are paths, not queries.
    route(value) {
        if (typeof value !== "string" || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
        const url = value.startsWith("//") ? `https:${value}` : value;
        const path = url.replace(this.siteOrigin, "").split(/[?#]/, 1)[0] || "/";
        const match = path.match(/^\/(?:[a-z]{2}\/)?(post|model|cosplay|fandom|category|search|top)(?:\/([^/]+))?\/?$/);
        if (!match) return path === "/" ? { type: "latest", path } : null;
        const [, type, segment] = match;
        if (type === "top") return segment ? null : { type, path: "/top" };
        if (!segment) return null;
        let name;
        try {
            name = decodeURIComponent(segment);
        } catch (error) {
            if (!(error instanceof URIError)) throw error;
            return null;
        }
        if (/^(?:\.|\.\.)$|[\\\x00-\x1f\x7f]/.test(name) || (type !== "search" && name.includes("/"))) return null;
        if (type === "post" && !/^\d+$/.test(name)) return null;
        return { type, name, path: `/${type}/${encodeURIComponent(name)}` };
    }

    postUrl(id) {
        if (typeof id !== "string" || !/^\d+$/.test(id)) throw new Error("CosplayRule34: invalid gallery ID");
        return `${this.baseUrl}/post/${id}`;
    }

    imageUrl(value, basePath = "/") {
        const url = typeof value === "string" ? value.trim() : "";
        if (!url || /[\s\\\x00-\x1f\x7f]/.test(url)) return null;
        if (/^(?:https?:)?\/\/[^/?#@]+(?=[/?#]|$)/i.test(url)) return url.startsWith("//") ? `https:${url}` : url;
        if (/^(?:\/\/|[^/]*:|[?#])/.test(url)) return null;
        return this.baseUrl + (url.startsWith("/") ? url : basePath.slice(0, basePath.lastIndexOf("/") + 1) + url);
    }

    hasNext(root, path, page) {
        return root.querySelectorAll("a.next[href]").some(link => {
            const href = link.attributes.href;
            const target = href.startsWith("?") ? { path } : this.route(href);
            const query = href.split("#", 1)[0].split("?")[1];
            return target?.path === path && query?.split("&").includes(`page=${page + 1}`);
        });
    }

    async loadList(path, page) {
        // Venera v1.18.5's Network user agent is a desktop UA. Keep its cache key
        // separate from mobile: Keiyoushi documents different sizes per device.
        const url = `${this.baseUrl}${path}?page=${page}&device=desktop`;
        return this.getHtml(url, "listing", document => {
            const root = document.querySelector("main") ?? document;
            const cards = root.querySelectorAll("div.grid-item");
            const comics = [];
            const seen = new Set();
            let galleryCount = 0;
            for (const card of cards) {
                for (const link of card.querySelectorAll("a[href]")) {
                    const route = this.route(link.attributes.href);
                    const title = link.text.trim().replace(/\s+/g, " ");
                    if (route?.type !== "post" || !title) continue;
                    galleryCount++;
                    const id = route.name;
                    if (seen.has(id)) break;
                    seen.add(id);
                    const style = card.attributes.style ?? "";
                    const cover = style.match(/\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^)]*?))\s*\)/i);
                    const coverUrl = this.imageUrl(cover?.[1] ?? cover?.[2] ?? cover?.[3], path) ?? "";
                    comics.push(new Comic({ id, title, cover: coverUrl }));
                    break;
                }
            }
            if (comics.length === 0) {
                const emptyMessage = root.querySelectorAll("h1, h2, h3, p, .alert, .no-results").some(node =>
                    /^(?:no\s+(?:search\s+)?(?:results?|posts?|galler(?:y|ies)|albums?|items?|matches)(?:\s+(?:were\s+)?found)?\b|nothing found\b)/i.test(node.text.trim()));
                if (!emptyMessage && (cards.length || !root.querySelector(".grid"))) {
                    throw new Error("CosplayRule34: unrecognized gallery listing");
                }
                return { comics, maxPage: page };
            }
            const next = this.hasNext(document, path, page);
            if (page === 1 && next) this.firstPageSizes.set(path, galleryCount);
            // Some archive/search last pages still have a next link. Stop on a
            // short page, using the count from that same listing's first page.
            const hasMore = next && galleryCount >= (this.firstPageSizes.get(path) ?? 0);
            return { comics, maxPage: hasMore ? page + 1 : page };
        });
    }

    postConstants(document) {
        // Parse just these JSON literals; script text is never executed.
        const literal = /(?:^|[;\n])\s*const\s+(title|albumId|ownerId|totalPhotos|download|downloadId)\s*=\s*("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|0|[1-9]\d*)\s*(?=;)/g;
        for (const script of document.querySelectorAll("script:not([src])")) {
            const text = script.text;
            const values = new Map(Array.from(text.matchAll(literal), ([, key, value]) => [key,
                (key === "albumId" || key === "ownerId") && value[0] !== '"' ? value : JSON.parse(value),
            ]));
            if (values.has("albumId")) return values;
        }
        throw new Error("CosplayRule34: gallery metadata not found");
    }

    albumIds(constants) {
        const albumId = String(constants.get("albumId") ?? "");
        const ownerId = String(constants.get("ownerId") ?? "");
        if (![albumId, ownerId].every(value => /^[a-z0-9_-]+$/i.test(value))) {
            throw new Error("CosplayRule34: invalid gallery identifiers");
        }
        return { album_id: albumId, owner_id: ownerId };
    }

    async loadDetails(id) {
        const url = this.postUrl(id);
        return this.getHtml(url, "gallery", document => {
            const constants = this.postConstants(document);
            const { owner_id, album_id } = this.albumIds(constants);
            const title = constants.get("title");
            if (typeof title !== "string" || !title.trim()) throw new Error("CosplayRule34: gallery title not found");
            const tags = {};
            for (const link of document.querySelectorAll("a.btn[href]")) {
                const route = this.route(link.attributes.href);
                const namespace = this.tagTypes.find(([type]) => type === route?.type)?.[1];
                if (!namespace) continue;
                const label = link.text.trim().replace(/\s+/g, " ");
                if (!label) continue;
                const names = tags[namespace] ?? (tags[namespace] = []);
                if (names.includes(label)) continue;
                names.push(label);
                this.tagPaths.set(`${namespace}:${label}`, route.path);
            }
            return new ComicDetails({
                title: title.trim().replace(/\s+/g, " "),
                cover: `${this.baseUrl}/images/albums/${owner_id}/${album_id}.webp`,
                description: document.querySelector(".accordion-body")?.text.trim().replace(/\s+/g, " ") ?? "",
                tags, chapters: null, url,
            });
        });
    }

    async loadImages(id) {
        const post = this.postUrl(id);
        const data = await this.getHtml(post, "gallery", document => {
            const constants = this.postConstants(document);
            const integer = name => {
                const value = constants.get(name);
                const number = /^\d+$/.test(String(value)) ? Number(value) : NaN;
                if (!Number.isInteger(number) || number > 2147483647) {
                    throw new Error(`CosplayRule34: invalid gallery field ${name}`);
                }
                return number;
            };
            return { ...this.albumIds(constants), download: integer("download"), download_id: integer("downloadId"),
                offset: 0, limit: integer("totalPhotos") };
        });
        if (!data.limit) return { images: [] };
        // Mirrors upstream's PhotosBody and Fetch.XHR.from(post), not a download endpoint.
        const response = await Network.post(`${this.baseUrl}/cms/load-more-photos.php`, {
            Accept: "*/*", "Content-Type": "application/json; charset=utf-8", Origin: this.baseUrl,
            Referer: post, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
        }, JSON.stringify(data));
        const body = this.checkedBody(response, "photo API");
        let result;
        try {
            result = JSON.parse(body);
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            throw new Error("CosplayRule34: invalid photo API JSON");
        }
        if (!Array.isArray(result?.photos)) throw new Error("CosplayRule34: invalid photo API response");
        const photos = result.photos;
        if (!photos.length) throw new Error("CosplayRule34: photo API returned no photos for a nonempty gallery");
        if (photos.length !== data.limit) throw new Error(`CosplayRule34: photo count mismatch (${photos.length}/${data.limit})`);
        const images = photos.map(photo => {
            if (typeof photo?.html !== "string") throw new Error("CosplayRule34: invalid photo API item");
            return this.parseHtml(photo.html, document => {
                const url = this.imageUrl(document.querySelector("a[data-fancybox]")?.attributes.href);
                if (!url) throw new Error("CosplayRule34: photo link not found");
                return url;
            });
        });
        // Upstream corrects the API's lexical file order by comparing length,
        // then URL text (e.g. /6.webp before /10.webp); retain repeated images.
        images.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
        return { images };
    }

    categoryTarget(label, path) {
        return { page: "category", attributes: { category: label, param: path } };
    }

    explore = [
        { title: "CosplayRule34 · Latest", type: "multiPageComicList", load: page => this.loadList("/", page) },
        { title: "CosplayRule34 · Popular", type: "multiPageComicList", load: page => this.loadList("/top", page) },
    ];

    search = {
        optionList: [{ label: "Category", type: "select", default: "all",
            options: ["all-All", ...this.categories.map(([slug, label]) => `${slug}-${label}`)] }],
        load: async (keyword, options, page) => {
            const query = keyword.trim();
            const category = this.categories.find(([slug]) => slug === options?.[0]);
            if (/^https?:\/\//i.test(query) && this.siteOrigin.test(query)) {
                const route = this.route(query);
                if (route?.type === "post") {
                    const { title, cover } = await this.loadDetails(route.name);
                    return { comics: [new Comic({ id: route.name, title, cover })], maxPage: 1 };
                }
                if (route) return this.loadList(route.path, page);
            }
            return this.loadList(query ? `/search/${encodeURIComponent(query)}` : category ? `/category/${category[0]}` : "/", page);
        },
    };

    category = {
        title: "CosplayRule34 Categories",
        parts: [{ name: "Category", type: "fixed", categories: this.categories.map(([slug, label]) =>
            ({ label, target: this.categoryTarget(label, `/category/${slug}`) })) }],
    };

    categoryComics = {
        load: (_category, param, _options, page) => {
            const route = this.route(param);
            if (!route || !this.tagTypes.some(([type]) => route.type === type)) throw new Error("CosplayRule34: invalid archive");
            return this.loadList(route.path, page);
        },
    };

    comic = {
        loadInfo: id => this.loadDetails(id),
        loadEp: id => this.loadImages(id),
        onClickTag: (namespace, tag) => {
            const path = this.tagPaths.get(`${namespace}:${tag}`);
            return path ? this.categoryTarget(tag, path) : null;
        },
        onImageLoad: (url, id) => ({ url, headers: { Referer: this.siteOrigin.test(url) ? this.postUrl(id) : `${this.baseUrl}/` } }),
        onThumbnailLoad: url => ({ url, headers: { Referer: `${this.baseUrl}/` } }),
        link: {
            domains: this.domains,
            linkToId: url => {
                if (typeof url !== "string" || !this.siteOrigin.test(url)) return null;
                const route = this.route(url);
                return route?.type === "post" ? route.name : null;
            },
        },
    };

    translation = {
        zh_CN: { "CosplayRule34 · Latest": "CosplayRule34 · 最新", "CosplayRule34 · Popular": "CosplayRule34 · 热门",
            "CosplayRule34 Categories": "CosplayRule34 分类", Category: "分类", All: "全部", Model: "模特",
            Character: "角色", Fandom: "作品", Asian: "亚洲", Art: "艺术", Celebs: "名人", Erotic: "情色",
            Tattoo: "纹身", Dark: "暗黑", Fitness: "健身", Porno: "成人", Amateur: "业余" },
        zh_TW: { "CosplayRule34 · Latest": "CosplayRule34 · 最新", "CosplayRule34 · Popular": "CosplayRule34 · 熱門",
            "CosplayRule34 Categories": "CosplayRule34 分類", Category: "分類", All: "全部", Model: "模特兒",
            Character: "角色", Fandom: "作品", Asian: "亞洲", Art: "藝術", Celebs: "名人", Erotic: "情色",
            Tattoo: "刺青", Dark: "暗黑", Fitness: "健身", Porno: "成人", Amateur: "業餘" },
    };
}
