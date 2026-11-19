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
    type DvFsInodeCreateOptions,
    type DvFsMemStruct,
    type DvFsCallContext,
    type DvFsInodeMemStruct,
} from './types'
import {
    useDvInodeHandler,
    type DvInodeHandler,
    type DvInodeHandlerName,
    type DvProgramRegInode,
    type DvProcess,
    type DvFsLsItem,
    type DvFsLsOpts,
} from './inode'
import { type DvOsProps } from '../os/index.vue'
import { useDvFsAc } from './utils'
import { dvWait, dvExtend, dvCopy, dvSortByKv } from '@utils/core'

//FS 初始化参数
export interface DvFsInitOption {
    [K: string]: any
}

//暴露到 sysCall 的 FS 文件系统内核接口方法
export const sysCall = {
    //获取文件节点句柄实例
    //!! 获取句柄本身不需要权限（但是必须传入 callCtx 调用上下文对象）
    $: function <T extends DvInodeHandlerName>(
        ipath: string | DvFsMemStruct,
    ): DvInodeHandler<T> | undefined {
        const callCtx = this as unknown as DvFsCallContext
        //调用 句柄工厂
        return useDvInodeHandler<T>(ipath, callCtx)?.handler
    },

    //打开文件节点，sysCall('fs:open', '/foo/bar')
    //!! 默认情况下返回获取到的 节点句柄实例，如果无权限则返回 undefined
    //!! 部分特殊节点类型，open 返回的不是节点句柄实例
    //!! fs:open 之后必须 fs:close 释放资源
    open: async function <T extends DvInodeHandlerName>(
        ipath: string | DvFsMemStruct,
    ): Promise<DvInodeHandler<T> | undefined> {
        //callFrom 调用上下文对象在 this 中
        const callCtx = this as unknown as DvFsCallContext
        //调用 句柄工厂
        const rtn = useDvInodeHandler<T>(ipath, callCtx)
        if (!rtn) return undefined
        return await rtn.handler.open(callCtx)
    },

    //关闭文件节点，sysCall('fs:close', DvInodeHandler)
    //!! 一定是通过 open 此节点的程序，来关闭节点
    close: async function <T extends DvInodeHandlerName>(
        hdlOrIpath: string | DvInodeHandler<T>,
        opts?: PlainObject,
    ): Promise<boolean> {
        //callFrom 调用上下文对象在 this 中
        const callCtx = this as unknown as DvFsCallContext
        const { program, pid } = callCtx
        if (!program || !pid) {
            dvTriggerKernelError(`发生内核错误，无效的调用上下文对象`, 'OOPS')
            return false
        }
        //调用程序句柄
        const prog = useDvInodeHandler<'DvProgramRegInode'>(program, callCtx)?.handler
        //进程实例
        const prc = prog?.getProcess(pid, callCtx)
        if (!prog || !prc) {
            dvTriggerKernelError(`发生内核错误，无效的调用上下文对象`, 'OOPS')
            return false
        }
        //要关闭的文件节点 ipath
        const ipath: string = typeof hdlOrIpath === 'string' ? hdlOrIpath : hdlOrIpath.ipath
        //release
        return await prc.releaseOpen(ipath, callCtx)
    },

    //列出路径下的子节点，sysCall('fs:ls', '/foo/bar')
    //!! 返回子节点列表 DvFsLsItem[]
    ls: async function (ipath: string, opts?: DvFsLsOpts): Promise<DvFsLsItem[]> {
        //获取 目录节点句柄
        const callCtx = this as unknown as DvFsCallContext
        const handler = useDvInodeHandler<'DvDirInode'>(ipath, callCtx)?.handler
        if (!handler) {
            dvTriggerKernelError(
                `发生内核错误，未找到要列出子文件的目录 ${typeof ipath === 'string' ? ipath : ''}`,
                'OOPS',
            )
            return []
        }
        return await handler.ls(opts, callCtx)
    },

    //启动 program 节点，sysCall('fs:exec', '/foo/bar', {...})
    //!! 返回进程实例 DvProcess，program 程序节点句柄实例在 process.handler
    exec: async function (
        ipath: string | DvFsMemStruct,
        props?: PlainObject,
    ): Promise<DvProcess | undefined> {
        //获取 program 节点句柄
        const callCtx = this as unknown as DvFsCallContext
        const program = useDvInodeHandler<'DvProgramRegInode'>(ipath, callCtx)?.handler
        if (!program) {
            dvTriggerKernelError(
                `发生内核错误，未找到要执行的程序节点 ${typeof ipath === 'string' ? ipath : ''}`,
                'OOPS',
            )
            return undefined
        }
        //执行 exec 获取 pid
        const pid = await program.exec(props, callCtx)
        if (!pid) {
            dvTriggerKernelError(
                `发生内核错误，启动程序 ${typeof ipath === 'string' ? ipath : ''}失败`,
                'OOPS',
            )
            return undefined
        }
        return program.getProcess(pid, callCtx)
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

    //从磁盘 dvHdd 中读取目录结构，挂载到内存文件树 dvMem.fs
    const memOk = await _initMemFs(options)
    if (!memOk) {
        //内核错误
        throw new DvKernelError('文件系统初始化失败，无法挂载内存树')
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
//从磁盘 dvHdd 中读取目录结构，挂载到内存文件树 dvMem.fs
const _initMemFs = async (options?: DvFsInitOption): Promise<boolean> => {
    //磁盘接口
    const dvHdd = useDvHddStore()
    //读取并挂载 FS 系统目录结构
    return await dvHdd.mountBaseDir()
}
//手动将 /sys/prog0 根程序设为启动状态
const _execProg0 = async (options?: DvFsInitOption): Promise<boolean> => {
    //!! dvMem 内存树已构建 /sys/prog0 默认存在于 dvMem.fs 中
    const dvMem = useDvMemStore()
    if (!dvMem.fs.sys || !dvMem.fs.sys.prog0) return false

    //DvKernel
    const gdk = globalThis.DvKernel
    if (!gdk) return false
    //const osProps = gdk.osProps

    //!! 手动启动 /sys/prog0
    const pid = await dvMem.setMemOnProgramStart(
        '/sys/prog0',

        //DvOs 组件的启动 props
        gdk.options.value?.os ?? {},

        //!! /sys/prog0 内存空间 初始化结构
        {
            //FS 文件系统的初始化参数，保存在 内核启动参数 options.fs
            options,
        },
    )
    if (!pid) return false
    //!! 将生成的 pid (0 号进程 pid) 写入 DvOs 组建的 props 中
    // 后续的 app.mount() 需要使用此 props
    if (!gdk.options.value?.os) gdk.options.value.os = {}
    gdk.options.value.os.pid = pid
    //pid 同时写入 /sys/prog0 私有内存中
    const mem = dvMem.getProgramMem(pid)
    if (!mem) return false
    mem.pid = pid
    //调用 句柄工厂，将填充 prog0._icache_.handler
    await useDvInodeHandler<'DvProgramRegInode'>('/sys/prog0')

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
