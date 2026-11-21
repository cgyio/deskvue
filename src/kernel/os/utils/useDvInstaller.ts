/**
 * Deskvue kernel
 * 由 prog0 和 DvPmService 内核服务使用的 程序安装器
 * 将 内核服务程序，以及收集到的 系统|用户 服务|程序，挂载到内存树对应节点
 * 在用户登录后 user-initing 阶段，将用户自行安装的 程序|服务 挂载到内存树对应节点
 */

import { ref, computed, watch, type ComputedRef } from 'vue'
import { DvKernelError } from '../../error'
import {
    useDvMemStore,
    useDvFsIpath,
    type DvFsMemStruct,
    type DvFsProgramMeta,
    type DvInodeHandler,
    type DvFsInodeCreateOptions,
    type DvProcess,
} from '../../fs'
import { type DvProgramHookGetter } from './useDvProgram'
import { dvIs, dvExtend, dvCopy, dvWait } from '@/utils'

//程序定义的 来源类型
export type DvFsProgFrom = /*'install' | */ 'user' | 'sys' | 'kernel'

export const useDvInstaller = <M extends PlainObject = PlainObject>(
    hookGetter: DvProgramHookGetter<M>,
) => {
    //处理 程序|服务 组件的 programMeta
    //!! 会自动覆盖一些参数，生成最终的 meta 参数用于程序节点挂载
    const progMeta = (from: DvFsProgFrom, meta: DvFsProgramMeta): DvFsProgramMeta => {
        //内核服务
        if (from === 'kernel') {
            return dvExtend(false, {}, meta, {
                //!! 内核服务程序 meta，不可修改
                isService: true,
                service: {
                    //内核服务一定保活
                    keepAlive: true,
                    //程序定义来源 kernel
                    type: 'kernel',
                },
                //内核服务一定自启
                isAutoStart: true,
                //服务一定单例
                isMultiple: false,
            }) as DvFsProgramMeta
        }

        const issys = 'kernel,sys'.split(',').includes(from)
        const issrv = meta.isService ?? false

        //服务
        if (issrv) {
            const rtn = dvExtend(
                false,
                {
                    service: {
                        //系统服务默认保活，用户服务默认不保活
                        keepAlive: issys,
                    },
                    //系统服务默认自启动
                    isAutoStart: issys,
                },
                meta,
                {
                    isService: true,
                    service: {
                        //服务类型
                        type: from,
                    },
                    //服务不是程序
                    isSysProgram: false,
                    //服务一定单例
                    isMultiple: false,
                },
            ) as DvFsProgramMeta

            //autoStart 和 keepAlive 要匹配
            if (rtn.service?.keepAlive === true) {
                rtn.isAutoStart = true
            }
            return rtn
        }
        //程序
        else {
            return dvExtend(
                false,
                {
                    //程序默认不自启
                    isAutoStart: false,
                    //程序默认多实例
                    isMultiple: true,
                },
                meta,
                {
                    //程序不是服务
                    isService: false,
                    //剔除 service 额外参数
                    service: '__delete__',
                    //标记系统程序
                    isSysProgram: issys,
                },
            ) as DvFsProgramMeta
        }
    }

    //创建程序节点 createOptions 构建参数
    const progOpts = (from: DvFsProgFrom, meta: DvFsProgramMeta): DvFsInodeCreateOptions => {
        const issys = 'sys,kernel'.split(',').includes(from)
        const issrv = meta.isService ?? false
        return {
            mode: 'reg',
            type: 'program',
            auth: issys ? 101 : 111,
            owner: issys && issrv ? 'root' : 'user',
            inode: {
                time: { a: 0, c: 0, m: 0, d: 0 },
                name: meta.title ?? meta.name,
                extra: {
                    component: meta.name,
                },
            },
        }
    }

    //根据程序定义来源，以及 meta 获取此程序节点需要挂载到的 目录节点句柄
    //!! 后续需要关闭 目录节点句柄
    const openProgDir = async (
        from: DvFsProgFrom,
        meta: DvFsProgramMeta,
    ): Promise<DvInodeHandler<'DvDirInode'> | undefined> => {
        const dirIpath =
            (meta.isService ?? false) !== true
                ? '/program'
                : from === 'kernel'
                  ? '/sys/service/kernel'
                  : '/sys/service'
        return (await hookGetter().sysCall('fs:open', dirIpath)) as DvInodeHandler<'DvDirInode'>
    }

    const dvMem = useDvMemStore()
    //挂载某个程序节点，到目录句柄
    const createProgInode = async (
        from: DvFsProgFrom,
        meta: DvFsProgramMeta,
        dir?: DvInodeHandler<'DvDirInode'>,
        afterMount?: (handler: DvInodeHandler<'DvProgramRegInode'>) => Promise<void>,
    ): Promise<boolean> => {
        const hook = hookGetter()
        //处理 meta
        meta = progMeta(from, meta)
        //生成 opts
        const opts = progOpts(from, meta)
        //要挂载到的 目录节点句柄
        const hasdir = !!dir
        if (!dir) {
            //未传入 dir 则根据 from|meta 自动获取
            dir = await openProgDir(from, meta)
            if (!dir) return false
        }
        //创建
        const hdl = await dir.create<'DvProgramRegInode'>(meta.name, opts, hook.callCtx.value)
        //!! 如果未传入 dir 则需要关闭之前开启的 dir 句柄
        if (!hasdir) await hook.sysCall('fs:close', dir)

        //创建失败
        if (!hdl) return false

        //创建成功
        //!! meta 写入 icache
        hdl.inode._icache_.meta = dvCopy(meta) as DvFsProgramMeta
        await dvWait(10)

        //!! 将此程序节点支持的 mimes[] 注册到全局的 mimeMap
        dvMem.setMimeMap(hdl.ipath, meta.mimes ?? [])

        //执行 afterMount 钩子
        if (typeof afterMount === 'function') {
            await afterMount(hdl)
        }

        return true
    }
    //批量挂载同类型的 程序节点 到对应的目录句柄
    //!! 这些程序必须有相同的 from 和 meta.isService
    const createProgInodeBatch = async (
        type: 'program' | 'service',
        from: DvFsProgFrom,
        metaBatch: Record<string, DvFsProgramMeta>,
        afterMount?: (handler: DvInodeHandler<'DvProgramRegInode'>) => Promise<void>,
    ): Promise<boolean> => {
        if (!metaBatch || !dvIs.nemobj(metaBatch)) return true
        const issrv = type === 'service'
        const iskrn = from === 'kernel'

        //打开对应的 挂载目录节点句柄
        const dir = await openProgDir(from, { isService: issrv } as DvFsProgramMeta)
        if (!dir) {
            throw new DvKernelError('发生内核错误，无法获取程序挂载点目录', {
                level: iskrn ? 'PANIC' : 'OOPS',
            })
        }

        //收集错误
        const errs: string[] = []
        //挂载计数
        let count = 0
        for (const i in metaBatch) {
            let meta = metaBatch[i]
            if (!meta) continue
            if ((meta?.isService ?? false) !== issrv) continue
            //挂载
            const ok = await createProgInode(from, meta, dir, afterMount)
            //挂载失败
            if (!ok) {
                errs.push(i)
            }
            //挂载成功
            else {
                count++
            }
        }

        //关闭挂载目录
        await hookGetter().sysCall('fs:close', dir)

        //发生错误
        if (errs.length > 0) {
            throw new DvKernelError(
                `发生内核错误，这些${issrv ? '服务' : '程序'}未能正确挂载 ${errs.join(',')}`,
                { level: iskrn ? 'PANIC' : 'OOPS' },
            )
        } else if (count <= 0) {
            throw new DvKernelError(`发生内核错误，没有任何${issrv ? '服务' : '程序'}被成功挂载`, {
                level: iskrn ? 'PANIC' : 'OOPS',
            })
        }

        //挂载成功
        return true
    }

    //用户登录之前 os-mounting 阶段批量挂载收集到的 系统|用户 程序到 /program 节点
    //!! 由 prog0 根程序调用
    const createProgramInodes = async (
        afterMount?: (handler: DvInodeHandler<'DvProgramRegInode'>) => Promise<void>,
    ): Promise<void> => {
        const progs = globalThis.DvApp.config.globalProperties.$programs ?? {}
        //将标记为 program 的组件，挂载到 /program 下
        const prgs = {
            sys: progs?.sys?.programs ?? {},
            lib: progs?.lib?.programs ?? {},
        }

        //挂载
        const sysOk = await createProgInodeBatch('program', 'sys', prgs.sys, afterMount)
        const libOk = await createProgInodeBatch('program', 'user', prgs.lib, afterMount)

        //挂载失败
        if (!sysOk || !libOk) {
            throw new DvKernelError(`发生内核错误，有程序未能正确挂载`, {
                level: 'OOPS',
            })
        }
    }

    //用户登录之后，在 user-initing 阶段将用户自行安装的 程序 挂载到对应节点
    //!! 由 DvPmService 程序管理服务调用
    const installUserProgram = async (
        //传入保存在用户目录下的 程序安装文件节点句柄 reg+ext 类型，*.progi
        //或者传入安装文件节点的 ipath
        hdl: string | DvInodeHandler<'DvExtRegInode'>,
    ): Promise<boolean> => {
        //TODO：
        return false
    }

    return {
        progMeta,
        progOpts,
        openProgDir,
        createProgInode,
        createProgInodeBatch,

        createProgramInodes,
        installUserProgram,
    }
}
