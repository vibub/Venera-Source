const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { load } = require('cheerio');

const root = join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

function createSource(filename, respond = () => assert.fail('Unexpected request'), storage = new Map()) {
    const script = readFileSync(join(root, filename), 'utf8');
    const className = script.match(/^\s*class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+extends\s+ComicSource\b/m)[1];
    const requests = [];
    const documents = new Set();
    const logs = [];
    const deletedCookies = [];
    class HtmlDocument {
        constructor(html) {
            const $ = load(html);
            documents.add(this);
            const check = () => assert.ok(documents.has(this), 'Access after document disposal');
            const wrap = selection => selection.length ? {
                get text() { check(); return selection.text(); },
                get attributes() { check(); return selection.attr(); },
                get localName() { check(); return selection[0].name; },
                get nextElementSibling() { check(); return wrap(selection.next()); },
                querySelector: selector => { check(); return wrap(selection.find(selector).first()); },
                querySelectorAll: selector => { check(); return selection.find(selector).toArray().map(node => wrap($(node))); },
            } : null;
            this.querySelector = selector => { check(); return wrap($(selector).first()); };
            this.querySelectorAll = selector => { check(); return $(selector).toArray().map(node => wrap($(node))); };
        }
        dispose() { assert.ok(documents.delete(this)); }
    }
    async function request(method, url, headers, data, extra) {
        const entry = method === 'GET' && extra === undefined ? { url, headers } : { method, url, headers, data, extra };
        requests.push(entry);
        const body = await respond(new URL(url), entry);
        return typeof body === 'string' ? { status: 200, body } : body;
    }
    const source = vm.runInNewContext(`${script}\nnew ${className}()`, {
        ComicSource: class {
            loadData(key) { return storage.get(key); }
            saveData(key, value) { storage.set(key, plain(value)); }
            deleteData(key) { storage.delete(key); }
            translate(text) { return text; }
        },
        Comic: class { constructor(fields) { Object.assign(this, fields); } },
        ComicDetails: class { constructor(fields) { Object.assign(this, fields); } },
        HtmlDocument,
        log: (...entry) => logs.push(entry),
        Network: {
            get: (url, headers, extra) => request('GET', url, headers, undefined, extra),
            post: (url, headers, data, extra) => request('POST', url, headers, data, extra),
            sendRequest: request,
            deleteCookies: url => deletedCookies.push(url),
        },
    }, { filename });
    return { source, requests, documents, logs, deletedCookies, script };
}

module.exports = { root, plain, createSource };
