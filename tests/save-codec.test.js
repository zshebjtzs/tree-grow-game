import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSaveFile, encodeSaveFile, SAVE_FORMAT } from '../js/storage/SaveCodec.js';

test('new saves use gzip when it reduces the serialized size and round-trip exactly', async () => {
    const data = {
        schemaVersion: 2,
        matchHistory: {
            actions: Array.from({ length: 1000 }, (_, index) => ({
                id: index + 1,
                side: index % 2 ? 'blue' : 'red',
                action: { type: 'skip', owner: index % 2 ? 'blue' : 'red' },
                repeated: 'TreeGrow replay snapshot '.repeat(12)
            }))
        }
    };
    const plain = new Blob([JSON.stringify(data)]);
    const encoded = await encodeSaveFile(data);
    assert.equal(encoded.type, 'application/octet-stream');
    assert.ok(encoded.size < plain.size);
    assert.equal(await encoded.slice(0, SAVE_FORMAT.magic.length).text(), SAVE_FORMAT.magic);
    assert.deepEqual(await decodeSaveFile(encoded), data);
});

test('legacy plain JSON saves remain readable, including files larger than 20 MB', async () => {
    const data = { schemaVersion: 2, payload: 'x'.repeat(20 * 1024 * 1024 + 1) };
    const legacy = new Blob([JSON.stringify(data)], { type: 'application/json' });
    assert.ok(legacy.size > 20 * 1024 * 1024);
    const decoded = await decodeSaveFile(legacy);
    assert.equal(decoded.schemaVersion, 2);
    assert.equal(decoded.payload.length, data.payload.length);
});

test('rejects a truncated compressed save instead of treating it as JSON', async () => {
    const encoded = await encodeSaveFile({ payload: 'compressed '.repeat(1000) });
    if (encoded.type !== 'application/octet-stream') return;
    const truncated = encoded.slice(0, Math.max(SAVE_FORMAT.magic.length + 1, encoded.size - 4));
    await assert.rejects(() => decodeSaveFile(truncated));
});
