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

import { ref, computed, watch, type ComputedRef } from 'vue'
import { DvKernelError } from '../../error'
import {
    useDvMemStore,
    useDvFsIpath,
    type DvFsProgramMeta,
    type DvInodeHandler,
    type DvProcess,
} from '../../fs'
import { dvKernelServices, type DvKernelServiceName } from '../service'
import { type DvProgramHookGetter, useDvInstaller, type DvFsProgFrom } from './index'
import { dvIs, dvExtend, dvCopy, dvWait } from '@/utils'

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
}

export const useDvServiceWatcher = (hookGetter: DvProgramHookGetter) => {
    //系统服务守卫
    //所有已注册的 服务的 信息
    const services = ref<Record<string, DvOsServiceInfo>>({})
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
        const hook = hookGetter()
        //检查所有已启动的 且需要保活的 系统服务，如果未启动则尝试启动
        const srvs = serviceKeepAlive.value
        if (!srvs || !dvIs.nemobj(srvs)) return
        for (const srvn in srvs) {
            const srv = services.value[srvn]
            const run = srvs[srvn]
            if (!srv || run === undefined) continue
            //正在运行中，跳过
            if (run === true) continue
            //尝试启动
            const prc = (await hook.sysCall('fs:exec', srv.ipath, srv.props)) as DvProcess
            //如果启动失败
            if (!prc) {
                throw new DvKernelError(`发生内核错误，重启系统服务 ${srvn} 失败`)
            }
            //启动成功，更新 pid
            else {
                srv.pid = prc.pid
            }
        }
    })
    //向子组件 provide 的方法，获取系统服务程序信息
    //!! 可以传入服务名称，或服务节点的 ipath
    const serviceInfo = (srvn: string): ComputedRef<DvOsServiceInfo | undefined> => {
        return computed<DvOsServiceInfo | undefined>(() => {
            if (!srvn.includes('/')) return services.value?.[srvn]
            const ipu = useDvFsIpath()
            const ipath = ipu.norm(srvn)
            for (const i in services.value) {
                const srvi = services.value?.[i]
                if (!srvi || !srvi.ipath) continue
                if (srvi.ipath === ipath) return srvi
            }
            return undefined
        })
    }
    //判断一个程序是否在运行
    const isServiceRunning = (ipath: string): boolean => {
        return useDvMemStore().programRunning(ipath)
    }
    //根据 服务名称 或 ipath 返回 { handler 服务程序节点句柄实例, process 服务进程实例 }
    const useService = (
        srvn: string,
    ):
        | {
              handler: DvInodeHandler<'DvProgramRegInode'>
              process?: DvProcess
          }
        | undefined => {
        const ipath = srvn.includes('/') ? srvn : services.value?.[srvn]?.ipath
        if (!ipath) return undefined
        //获取服务程序节点句柄实例
        const hook = hookGetter()
        const handler = hook.sysCall('fs:open', ipath) as DvInodeHandler<'DvProgramRegInode'>
        if (!handler) return undefined
        //获取 进程实例，服务都是单例，直接获取即可
        const process = handler.getProcess(undefined, hook.callCtx.value)
        return { handler, process }
    }

    //在任意 服务程序节点 正确挂载后，将其注册到 services
    const register = async (handler: DvInodeHandler<'DvProgramRegInode'>): Promise<void> => {
        const icache = handler.inode._icache_
        const meta = icache?.meta as DvFsProgramMeta
        if (!icache || !meta) return
        const srvn = meta.name

        services.value[srvn] = {
            fid: useDvFsIpath().last(handler.ipath),
            name: srvn,
            title: meta.title ?? srvn,
            ipath: handler.ipath,
            from: 'kernel',
            keepAlive: meta.service?.keepAlive ?? false,
            autoStart: meta.isAutoStart ?? false,
            dependency: meta.dependency ?? [],
            props: globalThis.DvKernel.options.value?.service?.[srvn] ?? {},
            pid: '',
        } as DvOsServiceInfo
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

    //按 autoStartSequence 顺序，启动服务
    const autoStartServices = async (
        afterStart?: (process: DvProcess) => Promise<void>,
    ): Promise<void> => {
        if (serviceAutoStartSequence.value.length <= 0) {
            //!! 没有需要启动的服务，不可能
            throw new DvKernelError('发生内核错误，未找到任何系统服务', { level: 'PANIC' })
        }
        const hook = hookGetter()
        const errs: string[] = []
        for (const srvn of serviceAutoStartSequence.value) {
            const srv = services.value?.[srvn]
            if (!srv || srv.autoStart !== true) continue
            //是否已启动
            if (isServiceRunning(srv.ipath)) continue
            //开始启动，成功后返回 DvProcess 进程实例
            const prc = (await hook.sysCall('fs:exec', srv.ipath, srv.props)) as DvProcess
            if (!prc || !prc.pid || !dvIs.nemstr(prc.pid)) {
                //!! 内核服务必须启动成功，否则 panic
                if (srv.from === 'kernel') {
                    throw new DvKernelError(`发生内核错误，内核服务 ${srvn} 启动失败`, {
                        level: 'PANIC',
                    })
                }
                errs.push(srvn)
            } else {
                //!! 更新 services 列表中的 pid
                srv.pid = prc.pid
                //回调
                if (typeof afterStart === 'function') {
                    await afterStart(prc)
                }
            }
        }
        if (errs.length > 0) {
            throw new DvKernelError(`发生内核错误，这些服务程序未能正确启动 ${errs.join(',')}`)
        }
    }

    return {
        services,
        serviceAutoStartSequence,
        serviceKeepAlive,
        serviceInfo,
        isServiceRunning,
        useService,

        createKernelServiceInodes,
        createServiceInodes,

        autoStartServices,
    }
}
