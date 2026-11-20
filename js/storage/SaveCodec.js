const MAGIC = 'TGSV\u0001\n';
const SAVE_MIME = 'application/octet-stream';

function hasCompressionSupport() {
    return typeof CompressionStream === 'function' &&
        typeof DecompressionStream === 'function' &&
        typeof Response === 'function';
}

/**
 * Serialize a save compactly and gzip it when the runtime supports the
 * Compression Streams API. Legacy JSON remains the fallback format.
 */
export async function encodeSaveFile(data) {
    const json = JSON.stringify(data);
    if (typeof json !== 'string') throw new TypeError('存档数据无法序列化');

    const source = new Blob([json], { type: SAVE_MIME });
    if (!hasCompressionSupport() || typeof source.stream !== 'function') return source;

    const compressed = await new Response(
        source.stream().pipeThrough(new CompressionStream('gzip'))
    ).blob();

    // Small or incompressible saves stay as ordinary compact JSON.
    if (compressed.size >= source.size) return source;
    return new Blob([MAGIC, compressed], { type: SAVE_MIME });
}

/**
 * Read both the current TGSV+gzip container and historical plain JSON .sav
 * / .json files. The caller performs domain-specific validation afterwards.
 */
export async function decodeSaveFile(file) {
    if (!file || typeof file.text !== 'function' || typeof file.slice !== 'function') {
        throw new TypeError('存档文件无效');
    }

    const prefix = await file.slice(0, MAGIC.length).text();
    if (prefix !== MAGIC) {
        return JSON.parse(await file.text());
    }

    if (!hasCompressionSupport() || typeof file.stream !== 'function') {
        throw new Error('当前运行环境不支持读取压缩存档，请使用较新版本的浏览器或 Windows 桌面版。');
    }

    const compressedStream = file.slice(MAGIC.length).stream()
        .pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(compressedStream).text();
    return JSON.parse(json);
}

export const SAVE_FORMAT = Object.freeze({
    magic: MAGIC,
    mimeType: SAVE_MIME,
    compression: 'gzip'
});
