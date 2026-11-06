import type { MianmianConfigV3 } from './types.js';
export interface DataPaths {
    dir: string;
    stateFile: string;
    transcriptFile: string;
}
/**
 * §3.3 数据目录优先级：
 *   config.dataDir > env DSH_MIANMIAN_DATA > env DSH_DATA_DIR > ~/.dsh/mianmian
 * DSH_HOME 存在时作为 ~/.dsh 的替代（隔离测试用）。
 */
export declare function resolvePaths(config: MianmianConfigV3): DataPaths;
/** 备份文件名：state.v{old}.bak.json / state.before-reset.bak.json */
export declare function backupPath(paths: DataPaths, tag: string): string;
