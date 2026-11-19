/**
 * Deskvue kernel
 * 生成 磁盘 或 内存 的文件节点数据
 */

import {
    type DvFsHddStruct,
    type DvFsMemStruct,
    type DvFsInodeHddStruct,
    type DvFsInodeMemStruct,
    type DvFsInodeCreateOptions,
    dvFsEmptyInodeTime,
} from '../types'
import { useDvFsIpath } from '../utils'
import { dvIs, dvExtend } from '@utils/core'

//ipu
const ipu = useDvFsIpath()

//要为 磁盘 还是 内存 创建节点
const _fors = ['mem', 'hdd'] as const
type _createFor = (typeof _fors)[number]
type _structs = {
    mem: DvFsMemStruct
    hdd: DvFsHddStruct
}
type _inodeStructs = {
    mem: DvFsInodeMemStruct
    hdd: DvFsInodeHddStruct
}
type _struct<T extends _createFor> = _structs[T]
type _inodeStruct<T extends _createFor> = _inodeStructs[T]

export const useDvFsCreate = <T extends _createFor = 'hdd'>(createFor: T = 'hdd' as T) => {
    //快速构建 inode 文件节点
    const inode = (
        ipath: string,
        opts?: DvFsInodeCreateOptions,
        content?: string | PlainObject,
        children?: Record<string, _struct<T>>,
    ): _struct<T> => {
        ipath = ipu.norm(ipath)
        const name = ipu.last(ipath)
        const _ipath_ = ipath
        const _inode_: PlainObject = dvExtend(
            false,
            {
                mode: opts?.mode ?? 'reg',
                auth: opts?.auth ?? 111,
                owner: opts?.owner ?? 'user',
                name,
            },
            createFor === 'mem'
                ? {
                      modi: 0,
                      lock: 0,
                      open: [],
                  }
                : {},
            opts?.inode ?? {},
        )
        //reg 类型节点需要额外指定 type,mime
        if (_inode_.mode === 'reg') {
            if (!_inode_.extra) _inode_.extra = {}
            _inode_.extra.type = opts?.type ?? ''
            if (opts?.mime) _inode_.extra.mime = opts.mime
        }
        //可写的 非系统文件节点，需要指定 time 时间戳
        if (_inode_.owner !== 'root' && _inode_.auth !== 101) {
            if (!_inode_.time) {
                const now = Date.now()
                _inode_.time = { a: now, c: now, m: now, d: 0 }
            }
        } else {
            _inode_.time = { ...dvFsEmptyInodeTime }
        }
        let node: PlainObject = {
            _ipath_,
            _inode_: _inode_ as _inodeStruct<T>,
        }
        //content
        const cnt = content ?? (_inode_.mode === 'reg' && _inode_.extra.type === '' ? '' : {})
        if (createFor === 'mem') {
            node._icache_ = {
                handler: null,
                content: cnt,
            }
        } else {
            node._content_ = cnt
        }
        //合并子节点
        if (children && dvIs.nemobj(children)) {
            node = dvExtend(false, node, children)
        }
        return node as _struct<T>
    }
    //快速创建 dir 目录节点
    const dnode = (
        ipath: string,
        opts?: DvFsInodeCreateOptions,
        children?: Record<string, _struct<T>>,
    ): _struct<T> => {
        return inode(
            ipath,
            dvExtend<DvFsInodeCreateOptions>(
                {
                    mode: 'dir',
                },
                opts ?? {},
            ),
            '',
            children,
        )
    }
    //快速创建 reg 普通文件节点
    const fnode = (
        ipath: string,
        opts?: DvFsInodeCreateOptions,
        content?: string | PlainObject,
    ): _struct<T> => {
        return inode(
            ipath,
            dvExtend<DvFsInodeCreateOptions>(
                {
                    mode: 'reg',
                    type: 'ext',
                },
                opts ?? {},
            ),
            content,
        )
    }
    //快速创建 program 程序节点
    const pnode = (ipath: string, component: string, opts?: DvFsInodeCreateOptions): _struct<T> => {
        return inode(
            ipath,
            dvExtend<DvFsInodeCreateOptions>(
                {
                    mode: 'reg',
                    type: 'program',
                    inode: {
                        extra: { component },
                    },
                },
                opts ?? {},
            ),
        )
    }
    //创建系统目录节点
    const sysDir = (
        name: string,
        opts?: DvFsInodeCreateOptions,
        children?: Record<string, _struct<T>>,
    ): _struct<T> => {
        return dnode(
            name,
            dvExtend<DvFsInodeCreateOptions>(
                {
                    auth: 101,
                    owner: 'root',
                },
                opts ?? {},
            ),
            children,
        )
    }
    //创建系统文件
    const sysFile = (
        ipath: string,
        opts?: DvFsInodeCreateOptions,
        content?: string | PlainObject,
    ): _struct<T> => {
        return fnode(
            ipath,
            dvExtend<DvFsInodeCreateOptions>(
                {
                    auth: 101,
                    owner: 'root',
                },
                opts ?? {},
            ),
            content,
        )
    }

    return {
        inode,
        dnode,
        fnode,
        pnode,
        sysDir,
        sysFile,
    }
}
