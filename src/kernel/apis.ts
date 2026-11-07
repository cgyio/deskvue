/**
 * Deskvue kernel
 * 定义内核自身的 接口方法
 * 全局通过 globalThis.DvKernel.sysCall('sys:***', ...) 调用
 *
 * !! 用户在任意 program 程序(进程)内发起内核调用时，需要指定当前调用的 上下文参数
 * !!   内核启动阶段，可以不用显式指定，默认为 {caller: root, program: /sys/prog0}
 * !!   一旦用户登录，进入用户态，必须显式传入 当前调用发生在的 program 程序(进程)的 ipath
 * !!   传入的调用参数，会在 kernel.sysCall 实际方法内部被解析成完整的 DvFsCallContext 对象
 *
 * !! 任何可被 sysCall 调用的内核接口方法，!! 不能是箭头函数 !! 因为需要通过 this 传递调用上下文
 *      sysCallApis = {
 *          open: function(ipath: string, opts: PlainObject): void {
 *              !! 内核接口内的 this 指向当前调用的上下文参数 DvFsCallContext
 *              this = {
 *                  caller: root 或 iso:uuid,
 *                  program: /sys/prog0 或 任意程序的 ipath
 *                  ...可扩展
 *              }
 *          }
 *      }
 *
 * !! 用户态中，任意 program 程序内部，可以使用 useDvProgramHook 提供的封装好的 sysCall 方法
 *      会自动添加当前的调用上下文参数，本质上是 fn.call(this, ...args)：
 *      useDvProgramHook().sysCall = (cmd, ...args) => {
 *          globalThis.DvKernel.sysCall.call('/program/fooBar', cmd, ...args)
 *      }
 *      !! 如果要传入更多的调用上下文参数，使用 sysCallWith
 *      useDvProgramHook().sysCallWith = (callContext: PlainObject, cmd, ...args) => {
 *          globalThis.DvKernel.sysCall.call(
 *              {
 *                  program: '/program/fooBar',
 *                  ...callContext,
 *              },
 *              cmd,
 *              ...args
 *          )
 *      }
 *
 * !! 如果是"裸调用"，区分实际方式：
 *      在桌面、开始菜单、资源管理器中双击程序或文件，打开程序的，对应的上下文 program：
 *          /program/DvDesktop | DvLauncher | DvExplorer
 *      在命令行中执行 ls|open 之类的命令，对应的上下文 program：
 *          /sys/service/DvCliService 或者是 /program/DvShell
 *              /program/DvShell 是用户程序，只有用户权限
 *              /sys/service/DvCliService 是内核服务，拥有 root 权限
 *
 */

import { type ComponentPublicInstance } from 'vue'
import { dvTriggerKernelError, type DvKernelErrorLevel } from './error'
import {
    sysCall as fsSysCall,
    useDvMemStore,
    useDvFsCallCtx,
    type DvFsMemStruct,
    type DvFsCallContext,
    type DvFsProgramMeta,
} from './fs'
import { dvIs, dvCamel, dvTrimAny, dvLoget } from '@utils/core'

//可以被 sysCall 调用的 内核接口方法类型
//!! 可被调用的内核接口方法，!! 一定不能是箭头函数 !!
//!! 其内部 this 将指向当前调用的 完整上下文对象 DvFsCallContext
export type DvSysCallMethod = <T>(this: DvFsCallContext, ...args: any[]) => T

const sysSysCall = {
    //osReady 标记，在 DvOs 组件 onMounted 中调用
    //sysCall('sys:setOsReady')
    setOsReady: function (): void {
        if (!globalThis.DvKernel) {
            return dvTriggerKernelError('OS 根组件加载时，内核还未初始化', 'PANIC')
        }
        const gdk = globalThis.DvKernel
        if (gdk.osReady === true) {
            return dvTriggerKernelError('OS 根组件加载时，内核已经标记为 osReady')
        }
        //标记
        gdk.osReady = true
    },

    //dvTriggerKernelError
    //sysCall('sys:triggerError', ...)
    triggerError: function (e: any, level?: DvKernelErrorLevel): void {
        return dvTriggerKernelError(e, level)
    },

    //任意程序启动时，申请内存，挂载程序组件实例
    /*onProgramStart: function (
        caller: string,
        programName: string,
        programMeta: DvFsProgramMeta,
        programInstance: ComponentPublicInstance,
    ): void {
        
    },*/
}

//导出 全局可通过 sysCall 调用的内核接口 注册表
export const sysCallApis = {
    //内核本身的 接口
    sys: sysSysCall,

    //FS 文件系统
    fs: fsSysCall,
}

//sysCall 传入的 cmd 解析，返回找到的 接口方法
//!! 支持 fooBar 或 foo_bar 形式的命令名称
//      sysCall('sys:setOsReady') 或 sysCall('sys:set_os_ready')
//          都指向 sysCallApis.sys.setOsReady 接口方法
//          !! 实际接口方法一定是 fooBar 形式命名
const parseCmd = (cmd: string): DvSysCallMethod | undefined => {
    cmd = dvTrimAny(cmd.trim(), ':')
    if (!cmd.includes(':')) cmd = `sys:${cmd}`
    //ca
    let ca = cmd.split(':').filter((i: string) => dvIs.nemstr(i))
    if (ca.length <= 1) return undefined
    //foo_bar 统一转为 fooBar
    ca = ca.map((i: string) => dvCamel(i, false))
    //loget
    const api = dvLoget(sysCallApis, ca.join('.'), undefined)
    if (!dvIs(api, 'function,asyncfunction')) return undefined
    return api as DvSysCallMethod
}

//导出 全局可用的 sysCall 内核接口调用入口 方法
export function sysCall<T>(
    this: string | DvFsMemStruct | DvFsCallContext | undefined,
    cmd: string,
    ...args: any[]
): T | any {
    const stage = globalThis.DvKernel.stage
    //!! 文件系统就绪之前，无法 sysCall，因为需要文件节点信息做权鉴操作
    if (!stage.isAcAvailable.value) {
        dvTriggerKernelError(`内核错误，无法调用内核接口方法 ${cmd}，文件系统还未就绪`)
        return undefined
    }
    //获取调用者
    //读取可能传入的 调用来源，解析得到完整的 DvFsCallContext 上下文
    const callContext = useDvFsCallCtx().create(this) as DvFsCallContext
    if (!callContext) {
        dvTriggerKernelError(`内核错误，调用内核接口方法 ${cmd}时，无法获取调用者`)
        return undefined
    }
    //cmd 解析得到接口方法
    const api = parseCmd(cmd)
    if (!api) {
        dvTriggerKernelError(`内核错误，未找到内核接口方法 ${cmd}`)
        return undefined
    }

    //TODO: 内核调用拦截器处理
    //...

    //返回：把解析出的完整调用上下文 callContext 作为 this 绑定给接口方法
    return api.call(callContext, ...args) as T
}
