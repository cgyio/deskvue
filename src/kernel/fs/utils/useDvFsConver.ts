/**
 * Deskvue kernel
 * 处理 内存节点数据 与 磁盘节点数据 的 数据类型转换
 * 通常由 dvHdd 引用
 */

import { dvTriggerKernelError } from '../../error'
import {
    type DvFsHddStruct,
    type DvFsMemStruct,
    type DvFsInodeHddStruct,
    type DvFsInodeMemStruct,
    type DvFsInodeCreateOptions,
    dvFsEmptyInodeTime,
    //type DvFsSessionIcache,
} from '../types'
import { useDvFsIpath, useDvFsCallCtx } from './index'
import { dvConfig } from '../../config'
import { useDvMemStore, useDvHddStore } from '../stores'
import { dvMimes } from '../mime'
import { type DvIoBuffer } from '../../os'
import { dvIs, dvWait, dvExtend, dvCopy, dvLoget, dvTrimAny } from '@utils/core'

//ipath 工具
const ipu = useDvFsIpath()

//!! 下列类型的节点，在从磁盘加载到内存时，需要将 节点的 _content_ 加载到 _icache_.content
const loadContentItypes = [
    'reg+ext',
    'reg+model',
    'lnk',
    'chr+clip',
    'blk+db',
    'blk+cloud_drive',
    'blk+idb',
    'blk+local',
    'blk+opfs',
]

//特殊转换方法的定义结构
export type DvFsConvertorToMem = (inode: DvFsHddStruct, recursive: boolean) => DvFsMemStruct
export type DvFsConvertorToHdd = (inode: DvFsMemStruct, recursive: boolean) => DvFsHddStruct

export const useDvFsConver = () => {
    //获取某个节点的复合类型 mode+extra.type
    const getItype = (inode: DvFsMemStruct | DvFsHddStruct): string => {
        const mode = inode._inode_.mode
        const type = inode._inode_.extra?.type ?? ''
        return `${mode}${type === '' ? '' : '+' + type}`
    }

    //通用数据结构转换 DvFsHddStruct  <-->  DvFsMemStruct
    //!! recursive = true 则会递归转换所有子节点，返回的节点数据中包含所有子节点
    //!! 默认 recursive = false 仅转换当前节点，返回的节点数据中不包含子节点
    const toMemStruct = (inode: DvFsHddStruct, recursive: boolean = false): DvFsMemStruct => {
        //先检查是否是特殊节点转换
        if (inode._inode_.mode === 'reg') {
            const specConvertor = getSpecificRegConvertor(inode, 'toMem')
            if (specConvertor) {
                return (specConvertor as DvFsConvertorToMem)(inode, recursive)
            }
        }

        const mem: DvFsMemStruct = {
            _ipath_: inode._ipath_,
            _inode_: dvExtend<DvFsInodeMemStruct>(false, {}, inode._inode_, {
                //添加运行时数据
                modi: 0,
                lock: 0,
                open: [],
            }),
            _icache_: {
                handler: null,
            },
        }
        //!! 某些类型的节点，需要将 节点的 _content_ 加载到 _icache_.content
        const itp = getItype(inode)
        if (loadContentItypes.includes(itp)) {
            mem._icache_.content =
                typeof inode._content_ === 'string' ? inode._content_ : dvCopy(inode._content_)
        }

        //默认不递归输出子节点
        if (recursive !== true) return mem

        //递归输出所有子节点
        const children = Object.keys(inode).filter((i: string) => ipu.isFid(i))
        if (children.length > 0) {
            for (const i of children) {
                const child = inode?.[i]
                if (!child) continue
                const cnode = toMemStruct(child as DvFsHddStruct, true)
                if (!cnode) continue
                mem[i] = cnode
            }
        }

        return mem
    }
    const toHddStruct = (inode: DvFsMemStruct, recursive: boolean = false): DvFsHddStruct => {
        //先检查是否是特殊节点转换
        if (inode._inode_.mode === 'reg') {
            const specConvertor = getSpecificRegConvertor(inode, 'toHdd')
            if (specConvertor) {
                return (specConvertor as DvFsConvertorToHdd)(inode, recursive)
            }
        }

        //生成持久化结构
        const hdd: PlainObject = {
            _ipath_: inode._ipath_,
            _inode_: dvExtend<DvFsInodeHddStruct>(false, {}, inode._inode_, {
                //使用 dvExtend 的 __delete__ 标记
                modi: '__delete__',
                lock: '__delete__',
                open: '__delete__',
            }),
        }
        //!! 如果是运行时生成的文件，内容通常由对应的处理程序 program 创建，并临时写入 _icache_.content
        if (inode._icache_?.content !== undefined) {
            //!! 字符串按值保存，json 对象需要拷贝，避免磁盘数据与运行时数据共享引用
            hdd._content_ =
                typeof inode._icache_.content === 'string'
                    ? inode._icache_.content
                    : dvCopy(inode._icache_.content)
        }

        //如果需要递归子节点
        if (recursive === true) {
            const children = Object.keys(inode).filter((i: string) => ipu.isFid(i))
            if (children.length > 0) {
                for (const i of children) {
                    const child = inode?.[i]
                    if (!child) continue
                    const cnode = toHddStruct(child as DvFsMemStruct, true)
                    if (!cnode) continue
                    hdd[i] = cnode
                }
            }
        }

        //原有 持久化结构
        let ost = useDvHddStore().addr(inode._ipath_)
        //!! 未持久化过的节点 直接返回新生成的
        if (!ost) {
            //!! _content_ 是必须的
            if (hdd._content_ === undefined) hdd._content_ = ''
            return hdd as DvFsHddStruct
        }
        //已经持久化过的数据，如果当前不含 _content_ 则使用原有的
        //!! 已经持久化过的节点一定包含 _content_
        else {
            if (hdd._content_ === undefined) {
                hdd._content_ =
                    typeof ost._content_ === 'string'
                        ? ost._content_
                        : ost._content_ === undefined
                          ? ''
                          : dvCopy(ost._content_)
            }
        }

        return hdd as DvFsHddStruct
    }

    //!! 一些特殊的 reg 节点类型，可能定义了 特殊转换方法
    //!! 通常定义在 useDv[Type][Mime] (例如：useDvExtBuffer) 扩展 reg 类型 hook 工具中
    const getSpecificRegConvertor = (
        inode: DvFsMemStruct | DvFsHddStruct,
        method: 'toMem' | 'toHdd',
    ): DvFsConvertorToHdd | DvFsConvertorToMem | undefined => {
        const mode = inode._inode_.mode
        if (mode !== 'reg') return undefined
        const type = inode._inode_.extra?.type
        let mime = inode._inode_.extra?.mime
        if (!type || !mime) return undefined
        if (mime.startsWith('*.')) mime = mime.slice(2)
        //hook 工具集键名形式：ext/buffer -> reg+ext, *.buffer
        const key = `${dvTrimAny(type, '/')}/${dvTrimAny(mime, '/')}`
        const hookDef = dvMimes?.[key]
        if (!hookDef) return undefined
        //外部调用 reg 扩展类型 hook 中定义的 toMem|toHdd 转换方法时，不需要传入 handler 句柄实例
        const hook = hookDef(undefined)
        if (!hook?.[method] || typeof hook[method] !== 'function') return undefined
        return hook[method]
    }

    return {
        loadContentItypes,

        getItype,
        toMemStruct,
        toHddStruct,

        getSpecificRegConvertor,
    }
}
