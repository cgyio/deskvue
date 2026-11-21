/**
 * Deskvue kernel
 * Deskvue 模拟 Linux 文件系统的部分行为
 *
 * 解析处理传入的 callContext 调用上下文对象，执行相关判断 与 资源获取 操作
 *
 * !! create 创建 callCtx 调用上下文对象，通常在 sysCall 调用时执行
 * !! sysCall 一定发生在某个已运行的 program 程序内部（通常是对应的 Vue 组件内部），程序实例（通常
 * !! 是 Vue 组件实例）持有此程序此次进程的 pid：
 *      <component
 *          v-for="(pidc, pididx) of dvMem.pidItems"
 *          :is="pidc.name"
 *          :pid="pidc.pid"
 *          v-bind="pidc.props ?? {}"
 *      ></component>
 * !! 组件内部的 useDvProgramHook 封装 sysCall 方法，自动传入程序节点的 ipath 以及 pid 作为调用来源
 *      useDvProgramHook(() => props).sysCall = (cmd, ...args) => {
 *          !! 内部获取 pid | ipath
 *          return globalThis.DvKernel.sysCall.call({
 *              program: '/foo/bar..',
 *              pid: props.pid
 *          }, cmd, ...args)
 *      }
 *      !! DvKernel.sysCall 内部调用此处的 useDvFsCallCtx().create(this) 解析得到最终的 callCtx
 *
 *
 */

import { dvTriggerKernelError } from '../../error'
import type { DvFsMemStruct, DvFsCallContext, DvFsCaller, DvFsUsign } from '../types'
import { useDvMemStore } from '../stores'
import { useDvFsAc } from './useDvFsAc'
import { dvIs, dvCopy, dvExtend } from '@utils/core'

export const useDvFsCallCtx = () => {
    //根据传入的 调用来源，获取 完整的调用上下文 DvFsCallContext
    //!! 通常在 sysCall 执行过程中，调用此方法
    //!! 调用来源可能是：
    //      来源是 undefined，则 检查用户是否已经登录，决定返回的调用者
    //          未登录表示处于启动流程，返回 root ，否则返回 当前用户的 iso:uuid
    //      来源是 程序 ipath 或 inode 节点参数
    //      则 检查此程序的 文件节点的 owner ，返回相应的调用者
    //          owner === 'user' 则调用者为当前用户的 iso:uuid
    //          owner === 'root' 则调用者为 root
    //          owner === iso:uuid 则调用者为当前用户的 iso:uuid
    //          owner === 其他用户的 iso:uuid   一般不可能，当前用户无法执行其他用户的 program
    //!!        service 程序的 owner 一般是 root 也可能是 user
    //      调用来源还可能是完整的 DvFsCallContext 调用上下文，可包含自行扩展更多字段
    //!! 返回 DvFsCallContext 处理后的 完整调用上下文对象，将被绑定到实际内核接口方法内部的 this 上
    const create = (
        callFrom?: string | DvFsMemStruct | Partial<DvFsCallContext>,
    ): DvFsCallContext | undefined => {
        //内核 stage
        const stage = globalThis.DvKernel.stage
        //内存接口
        const dvMem = useDvMemStore()
        //!! 入口判断
        //!! 文件系统就绪之前，无法 sysCall，因为需要文件节点信息做权鉴操作
        if (useDvFsAc().acAvailable() !== true || !dvMem || !dvMem.fs) {
            dvTriggerKernelError(`发生内核错误，在文件系统就绪之前无法获取文件节点信息`)
            return undefined
        }

        //处理 callFrom 调用来源
        let caller: DvFsCaller | undefined = undefined
        let program: string | undefined = undefined
        let pid: string | undefined = undefined
        let extra: PlainObject = {}
        let inode: DvFsMemStruct | undefined = undefined
        if (callFrom) {
            //!! 传入的调用来源是 程序的 ipath
            if (typeof callFrom === 'string') {
                program = callFrom
                inode = dvMem.addr(program)
            } else if (dvIs.nemobj(callFrom)) {
                //!! 传入的调用来源是 程序的 inode 节点数据
                if (dvMem.isProgramInode(callFrom)) {
                    inode = callFrom as DvFsMemStruct
                    program = inode._ipath_
                }
                //!! 如果传入的 调用来源 是 DvFsCallContext 结构
                else {
                    const cf = dvCopy(callFrom) as Partial<DvFsCallContext>
                    if (cf.caller && typeof cf.caller === 'string') caller = cf.caller
                    if (cf.program && typeof cf.program === 'string') program = cf.program
                    if (program) inode = dvMem.addr(program)
                    if (cf.pid && typeof cf.pid === 'string') pid = cf.pid
                    delete cf.caller
                    delete cf.program
                    delete cf.pid
                    extra = cf
                }
            }
        }

        //用户登录之前，使用默认的 root + /sys/prog0
        if (stage.stageBefore('is-login')) {
            caller = 'root'
            if (!program) program = '/sys/prog0'
            if (!inode) inode = dvMem.addr(program)
            if (!inode || !dvMem.isProgramInode(inode)) {
                dvTriggerKernelError(`发生内核错误，无法获取程序节点信息 ${program}`)
                return undefined
            }
        }
        //用户登录之后，需要获取会话信息中的 usign
        else {
            //!! 不能手动传入 callFrom.caller = 'root'
            if (caller === 'root') {
                dvTriggerKernelError(`发生内核错误，用户登录后不能手动发起 root 调用`)
                return undefined
            }

            //!! 用户裸调用，一般不可能，一定会通过 desktop|launcher|explorer|shell 等程序
            if (!program) {
                dvTriggerKernelError(`发生内核错误，无法在程序外执行内核调用`)
                return undefined
            }

            //用户标识 iso:uuid 保存在 /sys/session 文件中
            const usign = uSign() //dvMem.addrSession()?._icache_?.uSign
            if (!usign) {
                dvTriggerKernelError(`发生内核错误，无法读取当前会话信息`)
                return undefined
            }

            //program 内部调用
            //!! 必须找到有效的 program 节点数据
            if (!inode || !dvMem.isProgramInode(inode)) {
                dvTriggerKernelError(`发生内核错误，无法获取程序节点信息 ${program}`)
                return undefined
            }

            //调用程序 program 的 owner
            const owner = inode._inode_.owner
            //调用程序 program 是内核程序，拥有 root 权限
            //!! 只有此情况下 caller 才会是 root ，手动传入 caller = root 无效
            if (owner === 'root') {
                caller = 'root'
            }
            //调用程序 program 是普通用户程序
            else if (!owner || !dvIs.nemstr(owner) || owner === 'user' || owner === usign) {
                caller = usign
            }
            //!! program owner 通常不会是其他用户的 iso:uuid，因为当前用户无权运行其他用户的程序
            //返回当前用户的 iso:uuid
            else {
                caller = usign
            }
        }

        //program 发起 sysCall 时，必须已启动，需要解析得到有效的 pid
        if (!pid) {
            //!! 未传入 pid 时，默认使用第一个进程实例
            const pids = dvMem.getPidsByIpath(program)
            if (pids.length > 0 && pids?.[0]) {
                pid = pids[0]
            }
        } else {
            //!! 传入了 pid 则必须是有效的 pid
            if (!inode._icache_.program?.[pid]) {
                pid = undefined
            }
        }
        if (!pid) {
            //!! pid 无效
            dvTriggerKernelError(`发生内核错误，无法获取有效的调用程序 PID`)
            return undefined
        }

        //准备要返回的 完整的调用上下文
        let ctx: DvFsCallContext = {
            caller: caller as DvFsCaller,
            program,
            pid,
        }

        //如果存在额外的 调用上下文参数
        if (extra && dvIs.nemobj(extra)) {
            ctx = dvExtend(ctx, extra) as DvFsCallContext
        }

        //返回最终的 完整的 调用上下文参数
        return ctx
    }

    //判断传入的对象是完整有效的 DvFsCallContext
    const isCallCtx = (callCtx: DvFsCallContext): boolean => {
        if (!dvIs.nemobj(callCtx)) return false
        const ctx = callCtx as DvFsCallContext
        if (!(ctx.caller && ctx.program && ctx.pid)) return false
        return true
    }

    //从 dvMem.fs.sys.session 中读取当前登录用户的 uSign
    //!! 只能在 is-login 之后读取，否则返回 undefined
    const uSign = (): DvFsUsign | undefined => {
        if (globalThis.DvKernel.stage.stageBefore('is-login')) return undefined
        return useDvMemStore().addrSession()?.uSign
    }

    //解析 callCtx 得到对应的 pidCache
    //const parseCallCtx = (callCtx: DvFsCallContext):

    return {
        create,
        isCallCtx,
        uSign,
    }
}
