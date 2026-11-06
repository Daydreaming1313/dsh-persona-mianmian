import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MianmianConfigV3 } from './types.js'

export interface DataPaths {
  dir: string
  stateFile: string
  transcriptFile: string
}

/**
 * §3.3 数据目录优先级：
 *   config.dataDir > env DSH_MIANMIAN_DATA > env DSH_DATA_DIR > ~/.dsh/mianmian
 * DSH_HOME 存在时作为 ~/.dsh 的替代（隔离测试用）。
 */
export function resolvePaths(config: MianmianConfigV3): DataPaths {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  let dir: string
  if (config.dataDir) {
    dir = config.dataDir
  } else if (process.env.DSH_MIANMIAN_DATA?.trim()) {
    dir = process.env.DSH_MIANMIAN_DATA.trim()
  } else if (process.env.DSH_DATA_DIR?.trim()) {
    dir = join(process.env.DSH_DATA_DIR.trim(), 'mianmian')
  } else {
    dir = join(home, 'mianmian')
  }
  return {
    dir,
    stateFile: join(dir, 'state.json'),
    transcriptFile: join(dir, 'transcript.jsonl'),
  }
}

/** 备份文件名：state.v{old}.bak.json / state.before-reset.bak.json */
export function backupPath(paths: DataPaths, tag: string): string {
  return join(paths.dir, `state.${tag}.bak.json`)
}
