/**
 * Deskvue kernel
 * 被 program 程序节点关联的 Vue 组件视为 程序组件，必须引用此 hook
 * 为组件提供 通用的功能，例如 sysCall 内核调用
 *
 * !! 所有 program 组件的 props 中必须定义 pid 全局唯一的进程 id
 * DvTaskService 和 DvWinService 通过监听 dvMem.pidItems|winItems[] 动态渲染程序组件实例
 * 会自动将 pid 作为 props 传入组件
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
import { dvTriggerKernelError } from '../error'
import {
    type DvProgramRegInode,
    useDvMemStore,
    type DvFsMemStruct,
    type DvFsProgramMeta,
    type DvFsCallContext,
} from '../fs'

//!! 所有 program 组建的 props 类型必须继承自此
export interface DvProgramComponentProps {
    //!! 必须的
    pid: string

    [K: string]: any
}

//program 组件内部 programHook 实例的获取方法
export type DvProgramHookGetter = () => ReturnType<typeof useDvProgramHook>

//!! 引用此 hook 必须传入 propsGetter 方法，动态获取 组件 props
//!! 泛型 M 用于指定 程序私有内存 的结构类型，默认 PlainObject
export const useDvProgramHook = <M extends PlainObject = PlainObject>(
    propsGetter: () => DvProgramComponentProps,
) => {
    //!! 必须同步获取 获取 program 组件实例
    const program = getCurrentInstance()
    const programName = program?.type.name || null
    //服务组件实例
    const programPublic = program?.proxy as ComponentPublicInstance

    //pid
    const pid = computed<string | undefined>(() => {
        const props = propsGetter()
        return props.pid
    })
    //相同 program 程序的其他同时运行的实例 pid[]
    const siblingPids = computed<string[]>(() => {
        if (!ipath.value) return []
        const pids = useDvMemStore().getPidsByIpath(ipath.value)
        if (pid.value && pids.indexOf(pid.value) >= 0) {
            pids.splice(pids.indexOf(pid.value), 1)
        }
        return pids
    })
    //program 节点 ipath
    const ipath = computed<string | undefined>(() => {
        if (!inode.value) return undefined
        return inode.value._ipath_
    })
    //program 文件节点数据 computed 只读
    const inode = computed<DvFsMemStruct | undefined>(() => {
        if (!pid.value) return undefined
        return useDvMemStore().getProgramInodeByPid(pid.value)
    })
    //program 程序的 programMeta{}
    //!! 只能在程序运行时获取，程序未运行返回 undefined
    const meta = computed<DvFsProgramMeta | undefined>(() => {
        if (!inode.value || !inode.value._icache_.meta) return undefined
        return inode.value._icache_.meta
    })
    //program 程序的定义名称，运行时保存在 _icache_.meta.name
    const pname = computed<string | undefined>(() => {
        if (!meta.value || !meta.value.name) return undefined
        return meta.value.name
    })
    //当前 program 程序节点句柄
    const handler = computed<DvProgramRegInode | undefined>(() => {
        if (!inode.value || !inode.value._icache_.handler) return undefined
        return inode.value._icache_.handler as unknown as DvProgramRegInode
    })
    //isProgram 标记
    const isProgram = computed<boolean>(() => {
        return inode.value !== undefined
    })
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

    //获取 mem 程序私有内存 响应式数据 可读可写
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

    //!! program 通用的 onMounted|onUnmounted 方法
    onMounted(async () => {
        await nextTick()
        //!! 组件实例挂载到 dvMem.programInstance[pid]
        if (pid.value) {
            const dvMem = useDvMemStore()
            if (!dvMem.programInstance?.[pid.value]) {
                dvMem.programInstance[pid.value] = programPublic
            }
        }
    })
    onUnmounted(() => {
        //!! 从 dvMem.programInstance[pid] 删除组件实例
        if (pid.value) {
            const dvMem = useDvMemStore()
            if (dvMem.programInstance?.[pid.value]) {
                delete dvMem.programInstance[pid.value]
            }
        }
    })

    return {
        pid,
        siblingPids,
        ipath,
        inode,
        meta,
        pname,
        handler,
        isProgram,
        callCtx,

        memory,
        sysCall,
    }
}
