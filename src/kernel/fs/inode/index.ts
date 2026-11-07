/**
 * Deskvue kernel
 * Deskvue 模拟 Linux 文件系统
 *
 * 文件节点句柄类 Dv***Inode 工厂
 */

import { type DvFsCallContext, type DvFsMemStruct } from '../types'
import { useDvMemStore } from '../stores'
import { dvTriggerKernelError } from '../../error'
import { useDvFsCallCtx } from '../utils'
import { dvExtend, dvCamel } from '@utils/core'

//!! 依次导入 句柄类定义
import { DvInode } from './dv-inode'

import { DvDirInode } from './dv-dir'
import { DvRegInode } from './dv-reg'
import { DvLnkInode } from './dv-lnk'
//import { DvChrInode } from './dv-chr'
//import { DvBlkInode } from './dv-blk'
//import { DvSockInode } from './dv-sock'

//import { DvMimeRegInode } from './dv-mime-reg'
import { DvProgramRegInode } from './dv-program-reg'
//import { DvModelRegInode } from './dv-model-reg'
import { DvExtRegInode } from './dv-ext-reg'

//import { DvUsbChrInode } from './dv-usb-chr'

//import { DvDbBlkInode } from './dv-db-blk'
//import { DvCloudDriveBlkInode } from './dv-cloud-drive-blk'

//import { DvRequestSockInode } from './dv-request-sock'

//句柄类 注册表
export const dvInodeHandlers = {
    DvInode,

    DvDirInode,
    DvRegInode,
    DvLnkInode,
    //DvChrInode,
    //DvBlkInode,
    //DvSockInode,

    //DvMimeRegInode,
    DvProgramRegInode,
    //DvModelRegInode,
    DvExtRegInode,

    //DvUsbChrInode,

    //DvDbBlkInode,
    //DvCloudDriveBlkInode,

    //DvRequestSockInode,
}
//句柄类名类型
export type DvInodeHandlerName = keyof typeof dvInodeHandlers
export const dvInodeHandlerNames: DvInodeHandlerName[] = Object.keys(
    dvInodeHandlers,
) as DvInodeHandlerName[]
//句柄类 某一个类型
export type DvInodeHandler<T extends DvInodeHandlerName> = InstanceType<(typeof dvInodeHandlers)[T]>

//定义句柄工厂返回的 数据类型
export interface DvInodeHandlerReturn<T extends DvInodeHandlerName> {
    //句柄实例
    handler: DvInodeHandler<T>
    //调用此实例时的 上下文
    context: DvFsCallContext
}

//创建句柄实例的 工厂方法，返回句柄实例，以及调用上下文
export const useDvInodeHandler = <T extends DvInodeHandlerName>(
    inode: string | DvFsMemStruct,
    callFrom?: string | DvFsMemStruct | Partial<DvFsCallContext>,
): DvInodeHandlerReturn<T> | undefined => {
    //内存接口
    const dvMem = useDvMemStore()
    //必须传入有效的 inode 节点参数，或 ipath 节点完整路径
    const node: DvFsMemStruct | undefined = typeof inode === 'string' ? dvMem.addr(inode) : inode
    if (!node || !dvMem.isInode(node)) {
        dvTriggerKernelError(
            `发生内核错误，无法获取文件节点数据${typeof inode === 'string' ? ' ' + inode : ''}`,
        )
        return undefined
    }
    //必须传入有效的 调用上下文
    let context: DvFsCallContext | undefined
    //!! 如果已经传入完整的 调用上下文，直接使用，这通常是 sysCall 发起的内核调用
    if (callFrom && (callFrom as DvFsCallContext).caller && (callFrom as DvFsCallContext).program) {
        context = callFrom as DvFsCallContext
    } else {
        //自动获取 callContext
        context = useDvFsCallCtx().create(callFrom)
    }
    if (!context) {
        dvTriggerKernelError(`发生内核错误，调用文件句柄时缺少必要的上下文`)
        return undefined
    }

    //开始创建句柄实例
    let handler: DvInodeHandler<T>
    //优先使用 _icache_.handler 缓存实例
    if (node._icache_.handler) {
        handler = node._icache_.handler as DvInodeHandler<T>
    }
    //不存在实例缓存，则创建
    else {
        const mode = node._inode_.mode
        const type = node._inode_.extra?.type ?? ''
        const clsn =
            `Dv${type !== '' ? dvCamel(type, true) : ''}${dvCamel(mode, true)}Inode` as DvInodeHandlerName
        const cls = dvInodeHandlers[clsn]
        //!! 未找到句柄类
        if (!cls) {
            dvTriggerKernelError(`发生内核错误，未找到文件节点类型 ${clsn}`)
            return undefined
        }
        //实例化
        handler = new cls(node) as DvInodeHandler<T>
        //!! 确认 handler 是否有效，一般不可能无效，因为 node 本身已经过验证
        if (handler.ipath !== node._ipath_) {
            dvTriggerKernelError(`发生内核错误，无法创建文件句柄实例`)
            return undefined
        }
        //缓存到节点 icache
        if (!node._icache_) node._icache_ = { handler: null }
        node._icache_.handler = handler as DvInode
    }

    //返回句柄实例，以及本次调用的 上下文
    return {
        handler,
        context,
    }
}

//导出类型
export type * from './dv-inode'
export type * from './dv-dir'
export type * from './dv-reg'
export type * from './dv-lnk'
//export type * from './dv-chr'
//export type * from './dv-blk'
//export type * from './dv-sock'
//export type * from './dv-mime-reg'
export type * from './dv-program-reg'
//export type * from './dv-model-reg'
export type * from './dv-ext-reg'
//export type * from './dv-usb-chr'
//export type * from './dv-db-blk'
//export type * from './dv-cloud-drive-blk'
//export type * from './dv-request-sock'
