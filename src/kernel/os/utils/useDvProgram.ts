/**
 * Deskvue kernel
 * 被 program 程序节点关联的 Vue 组件视为 程序组件，必须引用此 hook
 * 为组件提供 通用的功能，例如 sysCall 内核调用
 *
 * !! 所有 program 组件的 props 中必须定义 pid 全局唯一的进程 id
 * DvTaskService 和 DvWinService 通过监听 dvMem.pidItems|winItems[] 动态渲染程序组件实例
 * 会自动将 pid 作为 props 传入组件
 *
 */

import {
    ref,
    type Ref,
    computed,
    onMounted,
    onUnmounted,
    nextTick,
    getCurrentInstance,
    type ComponentPublicInstance,
} from 'vue'
import { computedAsync } from '@vueuse/core'
import { dvTriggerKernelError } from '../../error'
import {
    type DvProgramRegInode,
    useDvMemStore,
    type DvFsMemStruct,
    type DvFsProgramMeta,
    type DvFsCallContext,
    type DvFsSessionIcache,
    type DvProcess,
    useDvFsIpath,
    type DvInodeHandler,
    useDvInodeHandler,
} from '../../fs'
import { type DvConfigDefine, dvConfig } from '../../config'
import type { DvIoBuffer } from './useDvIoBuffer'
import { dvIs, dvWait } from '@/utils'

//!! 所有 program 组建的 props 类型必须继承自此
export interface DvProgramComponentProps {
    //!! 必须的
    pid: string

    [K: string]: any
}

//program 组件内部 programHook 实例的获取方法
export type DvProgramHookGetter = () => ReturnType<typeof useDvProgram>

//调用其他程序时，获取目标程序的相关实例 类型
export interface DvCallProgramIns {
    handler?: DvInodeHandler<'DvProgramRegInode'>
    process?: DvProcess
    instance?: ComponentPublicInstance
}

//!! 引用此 hook 必须传入 propsGetter 方法，动态获取 组件 props
//!! 泛型 M 用于指定 程序私有内存 的结构类型，默认 PlainObject
export const useDvProgram = <M extends PlainObject = PlainObject>(
    propsGetter: () => DvProgramComponentProps,
) => {
    //!! 必须同步获取 获取 program 组件实例
    const program = getCurrentInstance()
    const programName = program?.type.name || null
    //服务组件实例
    const programPublic = program?.proxy as ComponentPublicInstance

    //FS 文件节点 以及 进程 相关
    //从 props 中获取当前程序进程的 pid  computed 只读
    //!! 任何程序节点指向的 Vue 组件在挂载时，必须传入 props.pid 参数
    const pid = computed<string | undefined>(() => {
        const props = propsGetter()
        return props.pid
    })
    //根据 pid 读取 program 文件节点数据 computed 只读
    const inode = computed<DvFsMemStruct | undefined>(() => {
        if (!pid.value) return undefined
        return useDvMemStore().getProgramInodeByPid(pid.value)
    })
    //根据 inode 节点数据 获取 program 节点 ipath  computed 只读
    const ipath = computed<string | undefined>(() => {
        if (!inode.value) return undefined
        return inode.value._ipath_
    })
    //相同 program 程序的其他同时运行的实例 pid[]  computed 只读
    const siblingPids = computed<string[]>(() => {
        if (!ipath.value) return []
        const pids = useDvMemStore().getPidsByIpath(ipath.value)
        if (pid.value && pids.indexOf(pid.value) >= 0) {
            pids.splice(pids.indexOf(pid.value), 1)
        }
        return pids
    })
    //program 程序的 programMeta{} computed 只读
    //!! 在程序运行时直接返回 inode._icache_.meta
    //!! 在程序未运行时，无法在此处获取组件 meta，返回 undefined
    const meta = computed<DvFsProgramMeta | undefined>(() => {
        //运行时
        if (inode.value && inode.value._icache_.meta) return inode.value._icache_.meta
        //!! 未运行时，获取程序组件 meta，通常不会出现此情况
        return undefined
    })
    //program 程序的定义名称，运行时保存在 _icache_.meta.name computed 只读
    const pname = computed<string | undefined>(() => {
        if (!meta.value || !meta.value.name) return undefined
        return meta.value.name
    })
    //当前 program 程序节点句柄实例 computed 只读
    const handler = computed<DvProgramRegInode | undefined>(() => {
        if (!inode.value || !inode.value._icache_.handler) return undefined
        return inode.value._icache_.handler as unknown as DvProgramRegInode
    })
    //获取此程序的 当前 pid 指向的 DvProcess 进程实例
    const process = computed<DvProcess | undefined>(() => {
        if (!pid.value || !handler.value) return undefined
        return handler.value.getProcess(pid.value, callCtx.value)
    })
    //isProgram 标记
    const isProgram = computed<boolean>(() => {
        return inode.value !== undefined && useDvMemStore().isProgramInode(inode.value)
    })

    //获取 程序私有内存 dvMem.program[pid]，响应式数据 可读可写
    //!! 读取：memory.value 直接修改内部属性即可（内存对象本身是响应式的）
    //!! 写入：memory.value = {} 会整体替换程序内存，并保留 pid
    const memory = computed<M>({
        get() {
            if (!pid.value) return {} as M
            const mem = useDvMemStore().getProgramMem<M>(pid.value)
            return mem ?? ({} as M)
        },
        set(value) {
            if (!pid.value || !value) return
            const dvMem = useDvMemStore()
            //!! 内存空间不存在（程序未运行）时不允许写入
            if (!dvMem.program?.[pid.value]) return
            dvMem.program[pid.value] = { ...value, pid: pid.value }
        },
    })

    //在任意程序组件内部，读取 一些特殊系统文件的 内容
    //特殊节点 /sys/buffer 输入输出缓冲区
    //!! 任意程序仅可读取，只有有限的程序可以写 buffer 缓冲区
    //!! 系统文件节点的读取统一走 sysCall + 节点 read 方法
    //!! buffer 缓冲区文件节点支持 readSync 同步读方法，可直接包装为 computed
    const ioBuffer = computed<DvIoBuffer>(() => {
        //通过 sysCall 获取文件节点句柄（fs:$ 是同步接口）
        //!! 获取节点句柄操作本身不需要权限
        const buffer = sysCall('fs:$', '/sys/buffer') as DvInodeHandler<'DvExtRegInode'> | undefined
        if (!buffer) return [] as DvIoBuffer
        //!! 同步读取 缓冲区内容
        //!! 需要 r 权限，普通用户 对 归属于 root 的 reg+ext 文件有 r 权限
        return buffer.readSync({}, callCtx.value) as DvIoBuffer
    })
    //保留 @vueuse 的 computedAsync 写法示例
    //!! computed 的 getter 不能返回 Promise，因此使用 computedAsync：
    //!!   读取 resolve 后写回响应式 ref，依赖它的组件会自动重新渲染
    //!! lazy: 与原 computed 行为一致，首次被访问时才执行读取
    const __ioBuffer = computedAsync<DvIoBuffer>(
        (): DvIoBuffer | Promise<DvIoBuffer> => {
            //通过 sysCall 获取文件节点句柄（fs:$ 是同步接口，异步的是节点的 read）
            const buffer = sysCall('fs:$', '/sys/buffer') as
                | DvInodeHandler<'DvExtRegInode'>
                | undefined
            if (!buffer) return [] as DvIoBuffer
            //!! read 必须在同步阶段调用，返回的 Promise 交给 computedAsync 等待
            //!! read 内部对 _icache_.buffer 的读取发生在首个 await 之前，这样才能被
            //!! Vue 的同步依赖收集追踪到；若先 await sysCall 再调用 read，缓冲区变化后不会重新求值
            return buffer.read({}, callCtx.value) as Promise<DvIoBuffer>
        },
        [] as DvIoBuffer,
        {
            lazy: true,
            //read 可能抛出内核错误（如无读取权限），统一走内核错误处理
            onError: (e: unknown) => dvTriggerKernelError(e),
        },
    )
    //特殊节点 /sys/config 系统设置
    //!! 用户登录后，会自动合并用户覆盖的设置内容
    const sysConfig = computed<DvConfigDefine>(() => {
        //return useDvMemStore().sysConfig() ?? dvConfig
        const config = sysCall('fs:$', '/sys/config') as DvInodeHandler<'DvExtRegInode'> | undefined
        if (!config) return {} as DvConfigDefine
        return config.readSync({}, callCtx.value)
    })
    //特殊节点 /sys/session 当前会话数据
    //!! 如果用户还未登录，则返回的是上一次用户登录的 历史会话记录
    //!! 在用户登录之前，可能需要使用上一次登录的会话信息，比如 iso 项目标识，用以填充登录表单
    const userSession = computed<DvFsSessionIcache | undefined>(() => {
        return useDvMemStore().addrSession()?._icache_
    })

    //sysCall 在任意程序内部执行 调用内核接口
    //sysCall 必须的 调用上下文对象 DvFsCallContext
    //!! 仅在程序运行时能获取到
    const callCtx = computed<DvFsCallContext | undefined>(() => {
        if (!pid.value || !ipath.value) return undefined
        //!! 指定 caller 用户登录之前是 root ，登录后传 '' ，自动转为 用户 uSign
        return {
            caller: globalThis.DvKernel.stage.stageBefore('is-login') ? 'root' : '',
            program: ipath.value,
            pid: pid.value,
        } as DvFsCallContext
    })
    //!! program 组件内部通过 sysCall 调用内核接口
    const sysCall = (cmd: string, ...args: any[]): any => {
        //确保必须是 program 组件
        if (isProgram.value !== true || callCtx.value === undefined) {
            //!! 普通报错，只有 program 组件才能 sysCall
            return dvTriggerError(
                new Error(
                    `只有程序组件才允许调用内核，${pname.value ?? programName} 不是有效的程序组件`,
                ),
                //不终止，仅报错
                false,
                //返回 undefined
                undefined,
            )
        }

        if (!globalThis.DvKernel.sysCall) {
            dvTriggerKernelError(
                `发生内核错误，无法调用内核接口 ${cmd} @${pname.value ?? programName}，内核对象不存在`,
                'PANIC',
            )
            return
        }

        //sysCall
        try {
            return globalThis.DvKernel.sysCall.call(callCtx.value, cmd, ...args)
        } catch (e: any) {
            dvTriggerKernelError(e)
            return
        }
    }

    //进程间相互 调用 与 通信
    //根据传入的 单例程序(例如：服务)的 ipath|pname 查找目标程序的 进程 pid
    const _getCallProgramPid = (key: string): string | undefined => {
        //如果直接传入 pid ，直接返回
        if (key.startsWith('prog_')) return key

        //单例程序还可以传入 ipath|pname
        const dvMem = useDvMemStore()
        //传入的是 ipath
        if (key.includes('/')) {
            return dvMem.getPidsByIpath(useDvFsIpath().norm(key))?.[0]
        }
        //直接传入的是 pname 程序名称
        const inode = dvMem.addrInProgram(key)
        if (!inode || !inode._ipath_) return undefined
        return dvMem.getPidsByIpath(inode._ipath_)?.[0]
    }
    //根据传入的 pid|ipath|pname 获取对应目标程序的 {handler,process,instance}
    const getCallProgramIns = (
        //要调用的程序的进程 pid
        //!! 单例程序(例如：服务程序)，可以只提供 ipath 或直接提供程序名
        //!! 支持多实例的程序，必须传入有效的 进程 pid
        key: string,
    ): DvCallProgramIns => {
        //获取 pid
        const pid = _getCallProgramPid(key)
        if (!pid || !dvIs.nemstr(pid)) return {}
        const dvMem = useDvMemStore()
        //获取程序组件实例
        //!! 获取目标程序组件实例不需要权限
        const instance = dvMem.programInstance?.[pid]

        //目标程序节点
        const inode = dvMem.getProgramInodeByPid(pid)
        if (!inode || !inode._ipath_) return { instance }
        //!! 获取目标程序句柄实例，此步骤需要权限
        const handler = useDvInodeHandler<'DvProgramRegInode'>(inode, callCtx.value)?.handler
        //!! 获取目标进程实例，需要权限
        const process = handler?.getProcess(pid) ?? undefined
        //返回找到的 目标程序相关实例
        return { handler, process, instance }
    }
    //调用其他程序进程
    const callProgram = (
        //要调用的程序的 key 可以是 pid|ipath|pname
        key: string,
        //要调用的程序的 方法名
        //!! 遵循下列规则：
        //      someMethod              指向程序组件实例 defineExpose 暴露的组件实例方法
        //      program:someMethod      指向程序句柄的实例方法
        //      process:someMethod      指向目标程序进程的实例方法
        method: string,
        //要调用的目标程序方法的 参数序列
        ...args: any[]
    ): any => {
        //获取要调用的目标程序实例
        //!! 调用目标程序的 句柄|进程 实例方法需要权限
        //!! 调用目标程序组件实例 exposed 暴露方法 不需要权限
        const { handler, process, instance } = getCallProgramIns(key)
        //目标程序的显示名称
        const name = handler?.inode._inode_.name ?? 'unknown'

        //指向程序组件实例的 defineExpose 暴露方法
        if (!method.includes(':')) {
            if (!instance) {
                dvTriggerKernelError(`发生内核错误，未获取到程序 ${name} 的组件实例`)
                return undefined
            }
            //要调用的目标程序的 方法
            const callFn = instance?.$?.exposed?.[method]
            if (!callFn || typeof callFn !== 'function') {
                dvTriggerKernelError(
                    `发生内核错误，在要调用的目标程序 ${name} 上没有找到方法 ${method}`,
                )
                return undefined
            }
            //调用
            return callFn(...args)
        }

        //解析传入的 method
        const ma = method.split(':')
        if (ma.length < 2 || !ma[0] || !ma[1]) {
            dvTriggerKernelError(
                `发生内核错误，调用的目标程序 ${name} 时，传入了无效的方法名 ${method}`,
            )
            return undefined
        }

        //指向目标程序句柄的实例方法
        if (ma[0] === 'program') {
            if (!handler || !(handler as unknown as PlainObject)?.[ma[1]]) {
                dvTriggerKernelError(
                    `发生内核错误，未找到目标程序 ${name} 的句柄实例，或在句柄实例上没有找到方法 ${ma[1]}`,
                )
                return undefined
            }
            //调用句柄方法，需要传入调用上下文
            const callFn = (handler as unknown as PlainObject)[ma[1]]
            return typeof callFn === 'function' ? callFn(...args, callCtx.value) : undefined
        }

        //指向目标程序当前进程实例的方法
        if (ma[0] === 'process') {
            if (!process || !(process as unknown as PlainObject)?.[ma[1]]) {
                dvTriggerKernelError(
                    `发生内核错误，未找到目标程序 ${name} 的进程实例，或在进程实例上没有找到方法 ${ma[1]}`,
                )
                return undefined
            }
            //调用句柄方法，需要传入调用上下文
            const callFn = (process as unknown as PlainObject)[ma[1]]
            return typeof callFn === 'function' ? callFn(...args, callCtx.value) : undefined
        }

        //其他情况不合法
        dvTriggerKernelError(`发生内核错误，调用目标程序 ${name} 时，传入了无效的方法名`)
        return undefined
    }
    //快捷调用：调用其他程序的 sysCall
    const callProgramSysCall = (key: string, cmd: string, ...args: any[]): any => {
        return callProgram(key, 'sysCall', cmd, ...args)
    }
    //快捷调用：调用服务程序
    const callService = (srvn: string, method: string, ...args: any[]): any => {
        const dvMem = useDvMemStore()
        const ipath = dvMem.addrInProgram(srvn)?._ipath_
        if (!ipath) {
            dvTriggerKernelError(`发生内核错误，未找到服务 ${srvn}`)
            return undefined
        }
        const pid = dvMem.getPidsByIpath(ipath)?.[0]
        if (!pid) {
            dvTriggerKernelError(`发生内核错误，未找到服务 ${srvn} 的进程实例`)
            return undefined
        }
        return callProgram(pid, method, ...args)
    }
    //快捷调用：调用服务的 sysCall
    const callServiceSysCall = (srvn: string, cmd: string, ...args: any[]): any => {
        return callService(srvn, 'sysCall', cmd, ...args)
    }

    //程序组件生命周期 通用方法
    //!! 组件内部需要 定义并 defineExpose 暴露这些方法，必须是异步方法
    //组件实例挂载完成后，在 onMounted 内部调用
    //const afterInstanceSetted = async (): Promise<void> => {}
    //组件实例从 内存卸载之前，在 onUnmounted 内部调用
    //!! 必须返回 boolean ，false 表示不能正确卸载，会触发内核错误
    //const beforeInstanceUnset = async (): Promise<boolean> => {}

    //set|unsetProgramInstance 挂载|卸载 程序组件实例到 内存 dvMem.programInstance[pid]
    const setProgramInstance = async (): Promise<boolean> => {
        //!! 组件实例挂载到 dvMem.programInstance[pid]
        if (pid.value) {
            const dvMem = useDvMemStore()
            if (!dvMem.programInstance?.[pid.value]) {
                dvMem.programInstance[pid.value] = programPublic
                await dvWait(10)
                const after = programPublic?.$?.exposed?.afterInstanceSetted
                if (typeof after === 'function' && dvIs.asyncfunction(after)) {
                    await after()
                }
            }
            return true
        }
        return false
    }
    const unsetProgramInstance = async (): Promise<boolean> => {
        //!! 从 dvMem.programInstance[pid] 删除组件实例
        if (pid.value) {
            const dvMem = useDvMemStore()
            if (dvMem.programInstance?.[pid.value]) {
                const before = programPublic?.$?.exposed?.beforeInstanceUnset
                if (typeof before === 'function' && dvIs.asyncfunction(before)) {
                    const canUnset = await before()
                    if (!canUnset) {
                        //!! 当前组件标记为不能卸载，报内核错误
                        dvTriggerKernelError(`发生内核错误，程序 ${pname.value} 不能正确退出`)
                        return false
                    }
                    //卸载组件实例
                    delete dvMem.programInstance[pid.value]
                }
            }
            return true
        }
        return false
    }

    //!! program 通用的 onMounted|onUnmounted 方法
    onMounted(async () => {
        await nextTick()
        //挂载组件实例
        await setProgramInstance()
    })
    onUnmounted(async () => {
        //卸载组件实例
        await unsetProgramInstance()
    })

    //导出程序组件的 通用方法
    //!! 在程序组件内部，可以将这里的部分方法 defineExpose 暴露出来，用于 进程间相互调用
    return {
        pid,
        inode,
        ipath,
        siblingPids,
        meta,
        pname,
        handler,
        process,
        isProgram,

        memory,

        ioBuffer,
        sysConfig,
        userSession,

        callCtx,
        sysCall,

        getCallProgramIns,
        callProgram,
        callProgramSysCall,
        callService,
        callServiceSysCall,

        //afterInstanceSetted,
        //beforeInstanceUnset,
    }
}
