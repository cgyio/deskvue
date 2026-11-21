/**
 * Deskvue kernel
 * 由 prog0 系统程序使用的 系统服务 守卫
 *
 * 执行这些操作：
 *      内核服务程序的 节点挂载，自启动
 *      收集到 globalProperties.$programs 中的所有 服务 的 节点挂载，自启动
 *      守卫所有标记为 programMeta.service.keepAlive == true 的服务程序
 *          监听运行状态，如果停止则重启
 */

import {
    ref,
    computed,
    watch,
    readonly,
    type ComputedRef,
    type Ref,
    type ComponentPublicInstance,
} from 'vue'
import { DvKernelError, dvTriggerKernelError } from '../../error'
import {
    useDvMemStore,
    useDvFsIpath,
    type DvFsProgramMeta,
    type DvInodeHandler,
    type DvProcess,
    type DvFsCallContext,
    useDvFsCallCtx,
} from '../../fs'
import { dvKernelServices, type DvKernelServiceName } from '../service'
import { type DvProgramHookGetter, useDvInstaller, type DvFsProgFrom } from './index'
import { dvIs, dvExtend, dvCopy, dvWait, dvUntil, dvCamel } from '@/utils'

//prog0 持有的 所有注册服务的 进程信息
export interface DvOsServiceInfo {
    //服务程序 键名
    fid: string
    //服务程序名称，定义在 meta 中 meta.name，通常与 fid 相同
    name: string
    //服务程序标题，定义在 meta 中 meta.title 通常是中文标题
    title: string
    //服务程序节点的 ipath
    ipath: string
    //服务程序的注册来源
    from: DvFsProgFrom
    //是否需要保活
    keepAlive: boolean
    //是否需要自启
    autoStart: boolean
    //依赖的其他服务，可能是服务名称 或 服务节点的 ipath
    dependency: string[]
    //服务程序组件的启动 props，通过内核启动参数传入 options.service.**
    props: PlainObject

    //运行时
    //当前正在运行的 进程 pid，所有服务都是单例，只会有一个 pid
    pid: string
    //服务组件实例 mounted 完成
    mounted: boolean
}

//通过 DvOs provide 到全局的 service 方法结构
//!! 不能完整暴露此工具实例，会导致所有组件可以以 prog0 身份任意操作服务
export interface DvOsServiceExposed {
    services: Readonly<Ref<Record<string, DvOsServiceInfo>>>
    use: (
        srvn: string,
    ) => { handler: DvInodeHandler<'DvProgramRegInode'>; process?: DvProcess } | undefined
    info: (srvn: string) => ComputedRef<DvOsServiceInfo | undefined>
    isRunning: (...srvns: string[]) => boolean
    isMounted: (...srvns: string[]) => boolean
    isMountable: (...srvns: string[]) => boolean
    setPid: (srvn: string, pid: string) => void
    setMounted: (srvn: string) => void
    setStopped: (srvn: string) => void
    register: (
        handler: DvInodeHandler<'DvProgramRegInode'>,
        callCtx?: DvFsCallContext,
    ) => Promise<void>
    logoff: (srvn: string, callCtx?: DvFsCallContext) => Promise<void>
    start: (srvn: string, silence?: boolean, callCtx?: DvFsCallContext) => Promise<boolean>
    startAll: (srvns: string[], silence?: boolean, callCtx?: DvFsCallContext) => Promise<boolean>
    stop: (srvn: string, silence?: boolean, callCtx?: DvFsCallContext) => Promise<boolean>
}

export const useDvServiceWatcher = <M extends PlainObject = PlainObject>(
    hookGetter: DvProgramHookGetter<M>,
) => {
    //系统服务守卫
    //所有已注册的 服务的 信息
    const services = ref<Record<string, DvOsServiceInfo>>({})
    const _services = readonly(services)
    //从所有已注册的服务中，筛选出需要自启动，且按照依赖顺序排序后的 服务名称序列
    const serviceAutoStartSequence = computed<string[]>(() => {
        const seq: string[] = []
        for (const srvn in services.value) {
            const srv = services.value?.[srvn]
            if (!srv || srv.autoStart !== true) continue
            //解析依赖
            const deps = resolveDependency(srv)
            for (const depi of deps) {
                if (!seq.includes(depi)) seq.push(depi)
            }
        }
        return seq
    })
    //需要保活的服务的 运行状态
    const serviceKeepAlive = computed<Record<string, boolean>>(() => {
        const running: Record<string, boolean> = {}
        if (!dvIs.nemobj(services.value)) return {}
        for (const srvn in services.value) {
            const srv = services.value?.[srvn]
            if (!srv || srv.keepAlive !== true) continue
            running[srvn] = isServiceRunning(srv.ipath) ?? false
        }
        return running
    })
    //监听守卫
    watch(serviceKeepAlive, async () => {
        //仅在 service-ready 之后开始
        if (globalThis.DvKernel.stage.stageBefore('service-ready')) return
        //检查所有已启动的 且需要保活的 系统服务，如果未启动则尝试启动
        const srvs = serviceKeepAlive.value
        if (!srvs || !dvIs.nemobj(srvs)) return
        for (const srvn in srvs) {
            const run = srvs[srvn]
            //正在运行中，跳过
            if (run !== false) continue
            //!! 使用 startService 统一处理 依赖启动 / fs:exec / 等待 mounted / 内核错误
            //!! silence = false，保活重启失败需要报内核错误
            //!! 必须传入 callCtx 因为可能在用户登录后需要重启服务，必须以 prog0 身份调用
            await startService(srvn, false, hookGetter().callCtx.value)
        }
    })
    //根据 服务名称 或 服务程序节点的 ipath 在服务注册表中查找 DvOsServiceInfo
    const _findService = (srvn: string): DvOsServiceInfo | undefined => {
        if (!srvn.includes('/')) {
            let srv = services.value?.[srvn]
            if (srv) return srv
            if (srvn.startsWith('Dv')) return undefined
            //!! 新增使用服务短名称：
            //!!    fooBar      --> DvFooBarService
            //!!    foo-bar     --> DvFooBarService
            //!!    foo_bar     --> DvFooBarService
            srvn = `Dv${dvCamel(srvn, true)}Service`
            return services.value?.[srvn]
        }
        const ipu = useDvFsIpath()
        const ipath = ipu.norm(srvn)
        for (const i in services.value) {
            const srvi = services.value?.[i]
            if (!srvi || !srvi.ipath) continue
            if (srvi.ipath === ipath) return srvi
        }
        return undefined
    }
    //向子组件 provide 的方法，获取系统服务程序信息
    //!! 可以传入服务名称，或服务节点的 ipath
    const serviceInfo = (srvn: string): ComputedRef<DvOsServiceInfo | undefined> => {
        return computed<DvOsServiceInfo | undefined>(() => _findService(srvn))
    }
    //根据 服务名称 或 ipath 返回 { handler 服务程序节点句柄实例, process 服务进程实例 }
    const useService = (
        srvn: string,
    ):
        | {
              handler: DvInodeHandler<'DvProgramRegInode'>
              process?: DvProcess
              instance?: ComponentPublicInstance
          }
        | undefined => {
        //查找服务
        const srv = _findService(srvn)
        if (!srv) return undefined
        const ipath = srv.ipath
        //获取服务程序节点句柄实例
        const hook = hookGetter()
        const handler = hook.sysCall('fs:$', ipath) as DvInodeHandler<'DvProgramRegInode'>
        if (!handler) return undefined
        //获取 进程实例，服务都是单例，直接获取即可
        const process = handler.getProcess(undefined, hook.callCtx.value)
        //获取服务组件实例，可能不存在
        const instance =
            process === undefined ? undefined : useDvMemStore().programInstance?.[process.pid]
        return { handler, process, instance }
    }

    //服务状态判断，可以传入 一个或多个 服务名称 或 ipath，必须同时满足才返回 true
    //判断一个或多个服务是否在运行
    const isServiceRunning = (...srvns: string[]): boolean => {
        const dvMem = useDvMemStore()
        for (const srvn of srvns) {
            const srv = _findService(srvn)
            if (!srv) return false
            if (dvMem.programRunning(srv.ipath) !== true) return false
        }
        return true
    }
    //判断一个或多个服务组件是否已经成功挂载
    const isServiceMounted = (...srvns: string[]): boolean => {
        for (const srvn of srvns) {
            const srvi = _findService(srvn)
            if (!srvi || srvi.mounted !== true) return false
        }
        return true
    }
    //判断一个或多个服务组件是否可以被挂载，用于 DvOs 响应式挂载服务组件实例
    const isServiceMountable = (...srvns: string[]): boolean => {
        const dvMem = useDvMemStore()
        for (const srvn of srvns) {
            const srvi = _findService(srvn)
            if (!srvi) return false
            if (srvi.pid === undefined || srvi.pid === '') return false
            if (dvMem.programRunning(srvi.ipath) !== true) return false
        }
        return true
    }

    //服务状态修改
    //在服务程序启动后，将创建的 进程单例的 pid 写入 services 注册表
    const setServicePid = (srvn: string, pid: string): void => {
        const srvi = _findService(srvn)
        if (!srvi) return
        srvi.pid = pid
    }
    //在服务程序组件 onMounted 后，将注册表中的 mounted 标记为 true
    const setServiceMounted = (srvn: string): void => {
        const srvi = _findService(srvn)
        if (!srvi) return
        srvi.mounted = true
    }
    //在服务程序停止后，清理注册表中的 状态标记，用于手动启停的 服务程序，在程序组件的 onUnmounted 方法内部调用
    const setServiceStopped = (srvn: string): void => {
        const srvi = _findService(srvn)
        if (!srvi) return
        //清理运行状态标记
        srvi.pid = ''
        srvi.mounted = false
    }

    //处理 在 启动阶段 和 系统运行阶段 操作服务程序需要的 callCtx 调用上下文
    //!! 在系统运行阶段，外部调用 serviceWatcher.register|logoff|startService|stopService 这些方法时
    //!! 必须显式传入 callCtx 调用上下文，如果 caller 是普通用户，可能无法操作 from == kernel | sys 的某些服务
    const _getCallCtx = (callCtx?: DvFsCallContext): DvFsCallContext | undefined => {
        if (globalThis.DvKernel.stage.stageAfter('is-login', true)) {
            if (!callCtx || useDvFsCallCtx().isCallCtx(callCtx) !== true) return undefined
            return callCtx
        }

        //用户登录之前 默认使用 prog0 作为 callCtx
        return hookGetter().callCtx.value
    }

    //在任意 服务程序节点 正确挂载后，将其注册到 services
    //!! 暴露给外部，用户可以在系统运行过程中，动态注册服务
    const register = async (
        handler: DvInodeHandler<'DvProgramRegInode'>,
        callCtx?: DvFsCallContext,
    ): Promise<void> => {
        //!! 用户登录后，再注册服务，必须传入有效的 callCtx 调用上下文
        callCtx = _getCallCtx(callCtx)
        if (!callCtx) return

        const icache = handler.inode._icache_
        //通过 installer 安装的程序节点的 meta 一定是经过处理的完整的 DvFsProgramMeta
        const meta = icache?.meta as DvFsProgramMeta
        if (!icache || !meta) return
        const srvn = meta.name
        //!! 根据 callCtx、meta 和 ipath 决定服务的 注册来源
        const from =
            callCtx?.caller !== 'root'
                ? 'user'
                : meta.service?.type !== undefined
                  ? meta.service.type
                  : handler.ipath.startsWith('/sys/service/kernel')
                    ? 'kernel'
                    : 'user'

        services.value[srvn] = {
            fid: useDvFsIpath().last(handler.ipath),
            name: srvn,
            title: meta.title ?? srvn,
            ipath: handler.ipath,
            from,
            keepAlive: meta.service?.keepAlive ?? false,
            autoStart: meta.isAutoStart ?? false,
            dependency: meta.dependency ?? [],
            props: globalThis.DvKernel.options.value?.service?.[srvn] ?? {},
            pid: '',
            mounted: false,
        } as DvOsServiceInfo
        await dvWait(10)
    }
    //在系统运行过程中，写在某个服务程序之前，从服务注册表注销服务
    const logoff = async (srvn: string, callCtx?: DvFsCallContext): Promise<void> => {
        const srv = _findService(srvn)
        if (!srv) return

        //!! 内核服务、保活的服务 无法注销
        if (srv.from === 'kernel' || srv.keepAlive === true) return
        //!! 运行中的服务 无法注销
        if (isServiceRunning(srvn)) return

        //!! 用户登录后必须传入 callCtx
        callCtx = _getCallCtx(callCtx)
        if (!callCtx) return

        //!! 普通用户无法注销 root 服务
        if (callCtx?.caller !== 'root' && srv.from !== 'user') return

        //执行注销
        delete services.value?.[srv.name]
        await dvWait(10)
    }

    //解析服务依赖链，按依赖顺序排序
    const resolveDependency = (srvInfo: DvOsServiceInfo): string[] => {
        const rtn: string[] = []
        const srvn = srvInfo.name
        const deps = srvInfo.dependency
        if (!deps || deps.length <= 0) return [srvn]
        try {
            for (const depi of deps) {
                const srvi = serviceInfo(depi)?.value
                if (!srvi) continue
                //递归
                const sdeps = resolveDependency(srvi)
                //!! 循环依赖
                if (sdeps.includes(srvn)) {
                    throw new DvKernelError(`发生内核错误，系统服务 ${srvn} 发生循环依赖`, {
                        level: 'OOPS',
                    })
                }
                for (const sdepi of sdeps) {
                    if (!rtn.includes(sdepi)) rtn.push(sdepi)
                }
            }
            //添加自身到依赖链
            rtn.push(srvn)
            return rtn
        } catch (e: any) {
            return [srvn]
        }
    }
    //检查有哪些服务依赖此服务
    const getDependBy = (srvn: string): string[] => {
        const srv = _findService(srvn)
        if (!srv) return []
        const rtn: string[] = []
        for (const i in services.value) {
            const srvi = services.value?.[i]
            if (!srvi) continue
            if (srvi.name === srv.name) continue
            const deps = srvi.dependency ?? []
            if (deps.includes(srv.name) || deps.includes(srv.ipath)) {
                rtn.push(srvi.name)
            }
        }
        return rtn
    }

    //将内核服务程序节点 挂载到内存树 /sys/service/kernel 下
    const createKernelServiceInodes = async (
        afterMount?: (handler: DvInodeHandler<'DvProgramRegInode'>) => Promise<void>,
    ): Promise<void> => {
        if (!dvIs.nemobj(dvKernelServices)) {
            throw new DvKernelError('发生内核错误，未找到任何内核服务程序', { level: 'PANIC' })
        }
        //内核服务的 meta{}
        const metaBatch: Record<string, DvFsProgramMeta> = {}
        for (const srvn in dvKernelServices) {
            const def = dvKernelServices[srvn as DvKernelServiceName]
            if (!def || !def.programMeta) continue
            metaBatch[srvn] = dvCopy(def.programMeta)
        }

        //回调
        const cb = async (handler: DvInodeHandler<'DvProgramRegInode'>): Promise<void> => {
            await register(handler)
            if (afterMount) await afterMount(handler)
        }

        //挂载
        const installer = useDvInstaller(hookGetter)
        const ok = await installer.createProgInodeBatch('service', 'kernel', metaBatch, cb)
        //!! 内核服务挂载失败，直接 panic
        if (!ok) {
            throw new DvKernelError(`发生内核错误，有内核服务未能正确挂载`, {
                level: 'PANIC',
            })
        }
    }
    //将收集到 globalProperties.$programs 中的 系统|用户 服务，挂载到内存树 /sys/service
    const createServiceInodes = async (
        afterMount?: (handler: DvInodeHandler<'DvProgramRegInode'>) => Promise<void>,
    ): Promise<void> => {
        const progs = globalThis.DvApp.config.globalProperties.$programs ?? {}
        //将标记为 service 的组件，挂载到 /sys/service 下
        const srvs = {
            sys: progs?.sys?.services ?? {},
            lib: progs?.lib?.services ?? {},
        }

        //回调
        const cb = async (handler: DvInodeHandler<'DvProgramRegInode'>): Promise<void> => {
            await register(handler)
            if (afterMount) await afterMount(handler)
        }

        //挂载
        const installer = useDvInstaller(hookGetter)
        const sysOk = await installer.createProgInodeBatch('service', 'sys', srvs.sys, cb)
        const libOk = await installer.createProgInodeBatch('service', 'user', srvs.lib, cb)

        //挂载失败
        if (!sysOk || !libOk) {
            throw new DvKernelError(`发生内核错误，有服务未能正确挂载`, {
                level: 'OOPS',
            })
        }
    }

    //正在启动中的服务，用于防止循环依赖导致无限递归
    const startingServices = new Set<string>()
    //启动某个已注册的服务，可能是在启动阶段，或 运行中
    const startService = async (
        srvn: string,
        silence: boolean = false,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> => {
        //报错
        const err = (msg: string, srv?: DvOsServiceInfo): boolean => {
            if (!silence) {
                dvTriggerKernelError(
                    `发生内核错误，${msg}`,
                    //!! 内核服务必须启动成功，否则 panic
                    (srv?.from ?? 'user') === 'kernel' ? 'PANIC' : 'OOPS',
                )
            }
            return false
        }

        //!! 用户登录后必须传入 callCtx
        callCtx = _getCallCtx(callCtx)
        if (!callCtx) return false

        const srv = _findService(srvn) //services.value?.[srvn]
        //未注册的服务
        if (!srv) return err(`未找到目标服务 ${srvn}`)

        //在系统运行时，普通用户无法操作 内核服务
        if (callCtx.caller !== 'root' && srv.from === 'kernel') return false

        //!! 进程在运行 且 组件已 mounted，才视为已就绪
        //!! mounted 一旦置 true 不会重置，进程退出后 mounted 仍为 true，
        //!! 因此不能只判断 mounted，否则保活重启时会被当作已就绪而直接跳过
        const running = isServiceRunning(srv.ipath)
        if (running && isServiceMounted(srvn)) return true
        //!! 如果包含 dependency 依赖服务，则尝试先启动所有依赖服务
        if (srv.dependency && srv.dependency.length > 0) {
            //!! 循环依赖：当前服务已经在启动流程中
            if (startingServices.has(srvn)) {
                return err(`服务 ${srvn} 存在循环依赖`)
            }
            startingServices.add(srvn)
            try {
                for (const depi of srv.dependency) {
                    //依赖项可能是 服务名称 或 服务节点的 ipath
                    const depSrv = _findService(depi) //serviceInfo(depi)?.value
                    //未注册的依赖服务
                    if (!depSrv) return err(`服务 ${srvn} 的依赖项 ${depi} 未注册`)
                    //!! 递归启动依赖服务，成功返回 true 或已在运行
                    //!! 传入 silence 避免依赖服务启动失败时重复报内核错误
                    const depOk = await startService(depSrv.name, true)
                    if (!depOk) {
                        return err(`服务 ${srvn} 的依赖项 ${depSrv.name} 启动失败`)
                    }
                }
            } finally {
                startingServices.delete(srvn)
            }
        }
        //!! 进程不在运行中时，之前记录的 mounted 已失效（重启场景），重置后重新等待组件挂载
        //!! 若进程仍在运行（只是尚未 mounted），则不能重置，否则会去等一个不会再触发的 mount 事件
        if (!isServiceRunning(srv.ipath)) {
            //srv.mounted = false
            setServiceStopped(srv.name)
        }
        //开始启动，成功后返回 DvProcess 进程实例
        const prc = (await hookGetter().sysCall('fs:exec', srv.ipath, srv.props)) as DvProcess
        if (!prc || !prc.pid || !dvIs.nemstr(prc.pid)) {
            return err(`服务 ${srvn} 启动失败`)
        } else {
            //!! 更新 services 列表中的 pid
            setServicePid(srv.name, prc.pid) //srv.pid = prc.pid
            //!! 必须等待 srv.mounted == true 后，此服务启动完成
            //!! 在服务组件内部，必须将服务注册信息中的 mounted 标记为 true
            try {
                await dvUntil(() => isServiceMounted(srvn), 5000)
            } catch (e: any) {
                //!! 等待此服务就绪，超时
                return err(`服务 ${srvn} 启动超时`)
            }
            //服务已就绪，返回
            return true
        }
    }
    //批量启动服务
    const startServices = async (
        srvns: string[],
        silence: boolean = true,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> => {
        //!! 登录后必须传入 callCtx
        callCtx = _getCallCtx(callCtx)
        if (!callCtx) return false

        const errs: string[] = []
        for (const srvn of srvns) {
            const srv = _findService(srvn) //services.value?.[srvn]
            if (!srv) {
                errs.push(srvn)
                continue
            }

            //先检查一次，此服务程序是否正在运行
            if (isServiceRunning(srvn) && isServiceMounted(srvn)) {
                continue
            }

            //!! 普通用户不能操作 内核服务
            if (callCtx.caller !== 'root' && srv.from === 'kernel') {
                errs.push(srvn)
                continue
            }

            //使用 startService 统一处理 依赖启动，不报错，最后统一报错
            const ok = await startService(srvn, true)
            if (ok) continue

            //未能成功启动，标记错误
            errs.push(srvn)
        }
        if (errs.length > 0) {
            if (!silence) {
                dvTriggerKernelError(`发生内核错误，这些服务程序未能正确启动 ${errs.join(',')}`)
            }
            return false
        }
        return true
    }
    //按 autoStartSequence 顺序，启动服务
    const autoStartServices = async (): Promise<boolean> => {
        const seq = serviceAutoStartSequence.value
        if (seq.length <= 0) {
            //!! 没有需要启动的服务，不可能
            throw new DvKernelError('发生内核错误，未找到任何系统服务', { level: 'PANIC' })
        }
        const errs: string[] = []
        for (const srvn of seq) {
            const srv = _findService(srvn) //services.value?.[srvn]
            if (!srv || srv.autoStart !== true) continue
            //!! 使用 startService 统一处理 依赖启动 / fs:exec / 等待 mounted / pid 更新
            //!! silence = true：批量启动时统一收集错误，最后一次性抛出，避免重复报内核错误
            //!! 不传 callCtx ，在系统运行期间，再次调用此方法，会因为没有调用上下文而失败
            const ok = await startService(srvn, true)
            if (ok) continue
            //!! 内核服务必须启动成功，否则 panic
            if (srv.from === 'kernel') {
                throw new DvKernelError(`发生内核错误，内核服务 ${srvn} 启动失败`, {
                    level: 'PANIC',
                })
            }
            errs.push(srvn)
        }
        if (errs.length > 0) {
            throw new DvKernelError(`发生内核错误，这些服务程序未能正确启动 ${errs.join(',')}`)
        }
        return true
    }
    //等待 autoStartServices 全部 mounted
    const awaitAutoStartServicesMounted = async (): Promise<boolean> => {
        const srvns = serviceAutoStartSequence.value
        try {
            await dvUntil(() => isServiceMounted(...srvns))
            return true
        } catch (e: any) {
            dvTriggerKernelError('发生内核错误，等待所有自启动服务就绪超时')
            return false
        }
    }

    //手动停止某个服务程序，用于在系统运行过程中，用户手动启停服务
    //!! 应在服务组件的 onUnmounted 方法内部执行，必须先卸载组件实例，再停止服务程序运行
    const stopService = async (
        srvn: string,
        silence: boolean = false,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> => {
        //报错
        const err = (msg: string, srv?: DvOsServiceInfo): boolean => {
            if (!silence) {
                dvTriggerKernelError(
                    `发生内核错误，${msg}`,
                    //!! 服务停止失败，一律 OOPS
                    'OOPS',
                )
            }
            return false
        }

        //!! 用户登录后必须传入 callCtx
        callCtx = _getCallCtx(callCtx)
        if (!callCtx) return false

        const srv = _findService(srvn) //services.value?.[srvn]
        //未注册的服务
        if (!srv) return err(`未找到目标服务 ${srvn}`)

        //在系统运行时，普通用户无法操作 内核服务
        if (callCtx.caller !== 'root' && srv.from === 'kernel') return false

        //服务还未启动
        if (isServiceRunning(srvn) !== true) return true

        //!! 所有依赖此服务的其他服务，不能在运行中
        const depbys = getDependBy(srvn)
        if (depbys.length > 0) {
            //!! 所有依赖我的服务不能在运行
            for (const depsrv of depbys) {
                if (isServiceRunning(depsrv)) {
                    return err(`无法停止服务 ${srv.name}，有依赖于此服务的其他服务正在运行`)
                }
            }
        }

        //调用 sysCall 停止服务程序，返回 boolean
        const stop = await hookGetter().sysCall('fs:stop', srv.ipath, srv.pid)
        if (stop !== true) return err(`停止服务 ${srv.name} 失败，发生未知错误`)

        //服务已停止，清理标记
        //!! 在服务组件的 onUnmounted 内执行
        //setServiceStopped(srvn)
        return true
    }

    return {
        //!! 内核启动阶段，仅在 DvOs 组件内部使用
        //services,
        //serviceAutoStartSequence,
        //serviceKeepAlive,
        createKernelServiceInodes,
        createServiceInodes,
        autoStartServices,
        awaitAutoStartServicesMounted,

        //!! 要暴露到全局的 service 服务操作方法
        exposed: {
            services: _services,
            use: useService,
            info: serviceInfo,
            isRunning: isServiceRunning,
            isMounted: isServiceMounted,
            isMountable: isServiceMountable,
            setPid: setServicePid,
            setMounted: setServiceMounted,
            setStopped: setServiceStopped,
            register,
            logoff,
            start: startService,
            startAll: startServices,
            stop: stopService,
        } as DvOsServiceExposed,
    }
}
