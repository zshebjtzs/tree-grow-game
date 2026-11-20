import { decodeSaveFile } from '../storage/SaveCodec.js';
import { ReplaySaveValidator } from './ReplaySaveValidator.js';

export async function runReplayImport(file, { onProgress = () => {} } = {}) {
    if (typeof onProgress !== 'function') throw new TypeError('进度回调无效');
    onProgress({ progress: 8, message: '正在读取并解压存档…' });
    const data = await decodeSaveFile(file);
    onProgress({ progress: 28, message: '存档已解析，正在校验地图与完整棋谱…' });
    const validated = ReplaySaveValidator.validate(data);
    if (!validated.data.matchHistory) validated.data.matchHistory = validated.history.toJSON();
    onProgress({ progress: 96, message: '验证完成，正在载入回放界面…' });
    return { data: validated.data, warnings: validated.warnings, metadata: validated.metadata };
}
