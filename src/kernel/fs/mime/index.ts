/**
 * Deskvue kernel
 * 定义文件系统支持的 mime|ext 文件类型|后缀 的 特殊操作方法
 */

import { type DvInodeHandler } from '../inode'

import { useDvExtBuffer } from './useDvExtBuffer'
import { useDvExtConf } from './useDvExtConf'
import { useDvExtSession } from './useDvExtSession'

//定义 mime|ext hook 类型
export type DvMimeHook = (handler: any) => PlainObject

export const dvMimes: Record<string, DvMimeHook> = {
    'ext/buffer': useDvExtBuffer,
    'ext/conf': useDvExtConf,
    'ext/session': useDvExtSession,
}

//导出类型
export type * from './useDvExtBuffer'
export type * from './useDvExtConf'
export type * from './useDvExtSession'
