const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { root, createSource } = require('./source-host.cjs');

const repo = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));

test('index lists unique independent source scripts with matching runtime metadata', () => {
    assert.deepEqual(repo.map(entry => entry.key).sort(), [
        'cosplayrule34', 'cosplaytele', 'hentaicosplay', 'jjcos', 'kiutaku', 'ososedki', 'v2ph',
    ]);
    const exploreTitles = new Set();
    for (const { name, key, version, fileName } of repo) {
        assert.match(key, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
        assert.match(version, /^\d+\.\d+\.\d+$/);
        assert.equal(fileName, `${key}.js`);
        const { source, requests, documents } = createSource(fileName);
        assert.deepEqual([source.name, source.key, source.version], [name, key, version]);
        assert.equal(source.minAppVersion, '1.18.5');
        assert.equal(source.url, '');
        assert.equal(typeof source.search.load, 'function');
        assert.equal(typeof source.comic.loadInfo, 'function');
        assert.equal(typeof source.comic.loadEp, 'function');
        assert.ok(source.explore.length > 0);
        for (const { title } of source.explore) {
            assert.ok(!exploreTitles.has(title), `Duplicate explore title: ${title}`);
            exploreTitles.add(title);
        }
        assert.equal(requests.length, 0);
        assert.equal(documents.size, 0);
    }
});
