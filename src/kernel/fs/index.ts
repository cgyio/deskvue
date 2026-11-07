/**
 * Deskvue kernel
 * 基于 pinia 模拟 Linux 系统 FS 文件系统行为
 * 详细说明见 types 文件注释
 */

import { ref, reactive, computed, type App } from 'vue'
import { DvKernelError, dvTriggerKernelError } from '../error'
import {
    useDvMemStore,
    useDvHddStore,
    type DvMemStore,
    type DvHddStore,
    start as storeStart,
} from './stores'
import {
    dvFsDefaultRoots,
    type DvFsInodeCreateOptions,
    type DvFsMemStruct,
    type DvFsCallContext,
} from './types'
import {
    useDvInodeHandler,
    type DvInodeHandler,
    type DvInodeHandlerName,
    type DvProgramRegInode,
} from './inode'
import { type DvOsProps } from '../os/index.vue'
import { useDvFsAc } from './utils'
import { dvWait, dvExtend } from '@utils/core'

//FS 初始化参数
export interface DvFsInitOption {
    [K: string]: any
}

//暴露到 sysCall 的 FS 文件系统内核接口方法
export const sysCall = {
    //打开文件节点，sysCall('fs:open', '/foo/bar')
    //!! 返回 Dv***Inode 句柄实例，无权限返回 undefined
    open: function <T extends DvInodeHandlerName>(
        ipath: string | DvFsMemStruct,
    ): DvInodeHandler<T> | undefined {
        //callFrom 调用上下文对象在 this 中
        const callCtx = this as unknown as DvFsCallContext
        //调用 句柄工厂
        const rtn = useDvInodeHandler<T>(ipath, callCtx)
        if (!rtn) return undefined
        return rtn.handler
    },

    //启动 program 节点，sysCall('fs:exec', '/foo/bar', {...})
    exec: function (ipath: string | DvFsMemStruct, props?: PlainObject): any {
        //program 节点句柄
        const program = globalThis.DvSysCall.call(this, 'fs:open', ipath) as DvProgramRegInode
        if (!program) {
            dvTriggerKernelError(
                `发生内核错误，未找到要执行的程序节点${typeof ipath === 'string' ? ' ' + ipath : ''}`,
                'OOPS',
            )
            return undefined
        }
        //callFrom 调用上下文对象在 this 中
        const callCtx = this as unknown as DvFsCallContext
        return program.exec(props, callCtx)
    },
}

//定义 Deskvue FS 文件系统 初始化入口方法
export const start = async (app: App, options?: DvFsInitOption): Promise<boolean> => {
    //pinia store 启动
    const storeOk = await storeStart(app)
    if (!storeOk) {
        //内核错误
        throw new DvKernelError('文件系统初始化失败，无法启动 store')
    }

    //手动将 /sys/prog0 根程序设为启动状态
    const progOk = await _execProg0(options)
    if (!progOk) {
        //内核错误
        throw new DvKernelError('文件系统初始化失败，无法启动 prog0 根程序')
    }

    return true
}

//私有方法
//手动将 /sys/prog0 根程序设为启动状态
const _execProg0 = async (options?: DvFsInitOption): Promise<boolean> => {
    //!! /sys 和 /sys/prog0 默认存在于 dvMem.fs 中
    const dvMem = useDvMemStore()
    if (!dvMem.fs.sys || !dvMem.fs.sys.prog0) return false

    //DvKernel
    const gdk = globalThis.DvKernel
    if (!gdk) return false
    const osProps = gdk.osProps
    gdk.prints.value.push('系统目录已创建：/sys')

    //!! 手动启动 /sys/prog0
    const pid = await dvMem.setMemOnProgramStart('/sys/prog0', osProps.value, {
        //!! /sys/prog0 内存控件初始化结构
        //FS 文件系统初始化参数，来自 Deskvue 启动参数 options.fs
        options,
    })
    if (!pid) return false
    //!! 将生成的 pid (0 号进程 pid) 写入 DvOs 组建的 props 中
    // 后续的 app.mount() 需要使用此 props
    gdk.osProps.value.pid = pid
    //pid 同时写入 /sys/prog0 私有内存中
    const mem = dvMem.getProgramMem(pid)
    if (!mem) return false
    mem.pid = pid

    //print
    gdk.prints.value.push('根进程已启动：/sys/prog0')

    return true
}

//导出 useDvMem|HddStore
export { useDvMemStore, useDvHddStore }
//导出所有句柄类
export * from './inode'
//导出 FS 工具
export * from './utils'

//导出类型
export type * from './types'
