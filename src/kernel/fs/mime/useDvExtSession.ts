/**
 * Deskvue kernel
 * 针对 reg+ext 类型节点，后缀名 *.session 的文件的 特殊读写方法
 *
 * 后缀 *.session 文件 是 系统会话文件
 * /sys/session 是系统本次会话数据保存的节点，其内容结构固定为 DvSessionStruct
 * 系统会话文件会被持久化，在下一次登录系统时，会被作为历史会话，保存在 last 键下
 * !! 针对 /sys/session 节点，有特殊的 toMem|toHdd 的节点数据转换方法
 *
 * 一般不会有其他会话文件被创建，
 * !! 如果某个程序创建了自有的 *.session 文件，其 read|write 行为与普通 reg+ext 文件一致
 * !! 文件内容被保存在 fnode._icache_.content 中，会被持久化到 hdd._content_ 中
 *
 * !! 权鉴由外层的 句柄类处理，此处只定义 特有操作
 */

import { type DvInodeHandler } from '../index'
import type {
    DvFsRegInodeReadOptions,
    DvFsRegInodeWriteOptions,
    DvFsMemStruct,
    DvFsHddStruct,
    DvFsInodeMemStruct,
    DvFsInodeHddStruct,
    DvFsInodeIcache,
    DvFsCallContext,
    //DvFsSessionIcache,
    DvFsUsign,
    DvFsUserProfile,
    DvFsIsoInfo,
} from '../types'
import { useDvFsCallCtx } from '../utils'
import { dvIs, dvExtend, dvJsonCopy, dvWait } from '@/utils'

//定义 /sys/session 系统会话的数据结构
export interface DvSessionStruct {
    //登录用户的 信息
    uuid: Uuid
    //uSign 用户标识 iso:uuid 形式
    uSign: DvFsUsign
    //用户 profile
    profile: DvFsUserProfile
    //项目隔离项目参数
    iso: DvFsIsoInfo
    //上一次成功登录的 历史会话数据
    last?: DvSessionStruct
    [K: string]: any
}

export const useDvExtSession = (handler?: DvInodeHandler<'DvExtRegInode'>) => {
    //read|write 使用 reg+ext 默认方法
    //...

    //!! 特殊的 节点数据结构转换方法
    //在 构建内存树时，将 dvHdd 中的此节点数据转为 dvMem 内存节点数据结构
    const toMem = (inode: DvFsHddStruct, recursive: boolean = false): DvFsMemStruct => {
        const _ipath_ = inode._ipath_
        const _inode_ = dvExtend<DvFsInodeMemStruct>(false, {}, inode._inode_, {
            modi: 0,
            lock: 0,
            open: [],
        })

        //hdd 中保存的 内容，session 内容必须是 {}
        const hddcnt: PlainObject =
            inode._content_ === undefined || typeof inode._content_ === 'string'
                ? {}
                : dvJsonCopy(inode._content_)

        let _icache_: DvFsInodeIcache = { handler: handler ?? null }
        //针对 /sys/session 节点，将历史会话，转移到 当前会话的 last 键下
        if (_ipath_ === '/sys/session') {
            //构建系统会话内存树节点时，还没有登录，没有会话信息
            _icache_.content = {} as DvSessionStruct
            //如果存在上一次成功会话，转移到 last
            if (inode._content_ && !dvIs.nemobj(inode._content_)) {
                _icache_.content.last = hddcnt as DvSessionStruct
            }
        }

        //针对其他 会话文件节点
        else {
            _icache_.content = hddcnt
        }

        return { _ipath_, _inode_, _icache_ } as DvFsMemStruct
    }
    //在刷盘之前，将内存树中的节点数据，转换为 磁盘中的节点数据结构
    const toHdd = (inode: DvFsMemStruct, recursive: boolean = false): DvFsHddStruct => {
        const _ipath_ = inode._ipath_
        const _inode_ = dvExtend<DvFsInodeHddStruct>(false, {}, inode._inode_, {
            modi: '__delete__',
            lock: '__delete__',
            open: '__delete__',
        })

        //内存中的 会话信息
        const memcnt: PlainObject = dvJsonCopy((inode._icache_.content ?? {}) as PlainObject)

        let _content_: PlainObject = {}
        //针对 /sys/session 节点，持久化时需要去除历史会话数据
        if (_ipath_ === '/sys/session') {
            if (memcnt.last !== undefined) {
                delete memcnt.last
            }
            _content_ = memcnt as DvSessionStruct
        }

        //针对其他 会话文件节点
        else {
            _content_ = memcnt
        }

        return { _ipath_, _inode_, _content_ } as DvFsHddStruct
    }

    return {
        toMem,
        toHdd,
    }
}
