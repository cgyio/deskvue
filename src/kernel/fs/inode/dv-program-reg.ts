/**
 * Deskvue kernel
 * Deskvue Fs 文件系统，模拟 Linux 文件系统的一些行为
 * 定义文件节点 handler 句柄类 Dv***Inode
 *
 * 定义 program 文件类型节点的句柄类 DvProgramRegInode
 *
 * !! 可执行的 文件节点类型(reg+program) DvProgramRegInode
 * !! 会模拟 Linux 系统中的 process 进程的部分特征行为：
 *      0   每个启动的 program 程序节点，会生成全局唯一的 pid ，构成形式为：
 *          prog_[program_name]_md5(program 指向的 Vue 组件的启动参数 props{})
 *              允许多实例的 program 程序，每个启动的实例拥有不同的 pid
 *                  !! 也就意味着只有组件 props 不同，才会生成新实例，
 *                  !! 如果 props 与已有实例相同，则只会复用已有实例
 *      1   每个启动的 program 程序节点，会在内存中占据一个区域用于存放运行时缓存数据：
 *              dvMem.program.[pid] = {
 *                  ...储存程序运行时的私有数据
 *              }
 *          program 指向的 Vue 组件是实例会自动挂载到：
 *              dvMem.programInstance.[pid] = ComponentPublicInstance
 *      2   每个启动的 program 程序节点，在对应节点的 _icache_ 中，会有这些结构：
 *              programFnode._icache_ = {
 *                  !! 所有实例共享一个 program 节点句柄实例
 *                  handler: DvProgramRegInode 句柄实例,
 *                  meta: {
 *                      ... 在对应 Vue 组件 options.programMeta{} 中定义的参数
 *                  },
 *
 *                  !! 储存此程序所有已运行实例的 节点相关缓存数据
 *                  program: {
 *                      !! 以 pid 为键名
 *                      [pid]: {
 *                          !! 根路径，默认 /user
 *                          !! service 默认根路径 /
 *                          root: '/user',
 *                          !! 工作路径，默认 /user
 *                          !! 通过 DvProgramRegInode.cd() 可切换工作路径
 *                          !! 工作路径只能是 root 根路径的同级或下级
 *                          dir: '/user',
 *                          !! 保存此应用持有的(打开的)其他 文件节点 ipath[]
 *                          opens: [ '/foo/bar', ... ]
 *                      },
 *                      ...多实例时，其他 pid 数据
 *                  }
 *
 *              }
 *      3   应用的运行时实例，通过调用 opens 中的文件节点的句柄实例，执行对应的操作
 *          _icache_.handler.getProcess(pid).getOpenInode(n).write(...)
 *    !!4   由于不是真实的进程，无法真实意义上的进行 进程隔离
 *          在某个 program 运行时，可以读取执行任意其他运行中的 program 的数据方法
 *          !! 但是一定不要这么做 !! 按以下原则：
 *              某个 program 组件内部通过 computed 读取其他运行中程序的状态数据(只读方式)
 *                  如果目标程序未运行，将返回 undefined 或默认数据
 *              !! 如果一定要操作另一个程序，一定通过 DvProgramHook 提供的 callProgram(pid)
 *                  const result = await callProgram('/foo/bar', 'handlerMethod', ...args)
 *                  !! 这个方法主要是为了操作 service，可以使用专门的 callService(ipath)
 *
 *      5   program 程序启动流程：
 *              用户通过某个 program 程序调用 sysCall(
 *                  'fs:open', '/program/FooBar', {...vue 组件的启动参数 props}
 *              )
 *              优先组装 pid，到 dvMem.program 下查找是否已存在 pid
 *                  已存在则直接复用已有实例，窗口管理器会 active 对应的窗口
 *              不存在 pid 则 FS 文件系统内部会：
 *                  寻址，找到程序节点，创建 _icache_ | _icache_.program.[pid]
 *                  在 dvMem.program 创建新键名 [pid] 初始化默认结构
 *                  窗口管理器会根据 dvMem 数据变化，响应式的在界面挂载对应的 Vue 组件（默认是窗口组件）
 *                  Vue 组件 mount 完成后，会自动将组件实例 挂到 dvMem.programInstance.[pid]
 *                  最后由 Vue 组件实例接管后续的 用户操作
 *
 */

import { DvRegInode } from './dv-reg'
import { useDvInodeHandler, type DvInodeHandlerName, type DvInodeHandler } from './index'
import { useDvMemStore } from '../stores/dv-mem'
import {
    type DvFsMemStruct,
    type DvFsInodeAuth,
    type DvFsCallContext,
    type DvFsPidCache,
    type DvFsProgramMeta,
    type DvFsProgramRegInodeIcache,
    type DvFsProgramType,
} from '../types'
import { DvKernelError } from '../../error'
import { useDvFsIpath, useDvFsAc, type DvFsAcHook, type DvFsAcFn } from '../utils'
import { dvIs, dvExtend } from '@utils/core'

//program 程序运行状态
export interface DvProgramStatus {
    ipath: string
    name: string
    type: DvFsProgramType
    running: boolean
    pid: string
    //未指定 pid 时，返回整体运行状态：运行中的实例数量
    count?: number
    //指定 pid 时，返回单个实例的 cache | memory
    cache?: DvFsPidCache
    memory?: PlainObject
}

export class DvProgramRegInode extends DvRegInode {
    //实例化 DvFsAcHook 注入此文件节点类型 自有的 特殊权鉴方法
    protected _getFsAcHook(): DvFsAcHook {
        return useDvFsAc((r: DvFsAcFn, w: DvFsAcFn, x: DvFsAcFn): Record<string, DvFsAcFn> => {
            return {
                //执行 program：需要 x 执行权限
                'reg:program:exec': (a: DvFsInodeAuth) => x(a),
                //终止 program 进程：需要 x 执行权限
                'reg:program:kill': (a: DvFsInodeAuth) => x(a),
                //查询 program 进程状态：需要 x 执行权限
                'reg:program:status': (a: DvFsInodeAuth) => x(a),
                //通过 program 打开 mime 关联文件：需要 x 执行权限
                'reg:program:open': (a: DvFsInodeAuth) => x(a),
                //切换进程工作目录：需要 x 执行权限
                'reg:program:cd': (a: DvFsInodeAuth) => x(a),
            }
        })
    }

    //快速判断程序是否已启动
    isRunning(): boolean {
        return useDvMemStore().programRunning(this.ipath)
    }

    //快速判断程序复合类型
    //!! 不是程序节点的 返回 false
    getType(): DvFsProgramType | false {
        const type = useDvMemStore().programType(this.ipath)
        if (!type) return false
        return type
    }
    typeIs(type: DvFsProgramType): boolean {
        const tp = this.getType()
        if (tp === false) return false
        return type === tp
    }

    //读取 program cache，响应式
    getCache(): DvFsProgramRegInodeIcache | undefined {
        return this.inode._icache_ as DvFsProgramRegInodeIcache
    }

    //获取正在运行的 pid 进程列表
    getPids(): string[] {
        const cache = this.getCache()
        const progs = cache?.program ?? {}
        return Object.keys(progs)
    }

    //获取进程句柄
    getProcess(pid?: string, callCtx?: DvFsCallContext): DvProcess | undefined {
        if (!this.isRunning()) return undefined
        const pids = this.getPids()
        if (pids.length <= 0 || !pids[0]) return undefined
        if (!pid || !dvIs.nemstr(pid)) {
            pid = this._getPidFromCallCtx(callCtx)
            if (!pid || !pids.includes(pid)) pid = pids[0]
        }
        return new DvProcess(this, pid)
    }

    //读取 program 元数据，响应式
    getMeta(): DvFsProgramMeta | undefined {
        const icache = this.getCache()
        if (icache?.meta) return icache.meta
        return useDvMemStore().programMeta(this.ipath)
    }

    //校验文件 mime|*.ext 是否命中 programMeta.mimes[]
    private _mimeMatches(fnode: DvFsMemStruct): boolean {
        const meta = this.getMeta()
        const mimes = meta?.mimes
        if (!mimes || !dvIs.nemarr(mimes)) return false
        const mime = fnode?._inode_?.extra?.mime
        if (!mime || !dvIs.nemstr(mime)) return false
        const ipu = useDvFsIpath()
        return mimes.some((m: string) => {
            if (!dvIs.nemstr(m)) return false
            //*.ext 后缀匹配
            if (m.startsWith('*.')) return ipu.extIs(fnode, m.slice(2))
            //mime 精确匹配
            return m === mime
        })
    }

    //program 特有 的 文件操作函数列表

    //执行：启动 program 实例（或复用同 props 的已有实例），返回 pid
    async exec(props?: PlainObject, callCtx?: DvFsCallContext): Promise<string | undefined> {
        //执行需要 x 权限
        if (!this.ac('exec', callCtx)) return this._acDenied('exec')
        //组装 pid 并初始化运行时内存
        return await useDvMemStore().setMemOnProgramStart(this.ipath, props)
    }

    //终止：停止 pid 对应的实例，未指定 pid 则停止全部实例
    async kill(pid?: string, callCtx?: DvFsCallContext): Promise<boolean> {
        //程序必须在运行中
        if (!this.isRunning()) return true
        //终止需要 x 权限
        if (!this.ac('kill', callCtx)) return this._acDenied('kill')
        //pids
        let pids = this.getPids()
        if (pids.length <= 0 || !pids[0]) return true
        //指定了 pid 则仅停止目标进程，否则停止所有
        if (pid) {
            if (!pids.includes(pid)) {
                return this._krError(`未找到目标进程 ${pid}`)
            } else {
                pids = [pid]
            }
        }
        //停止
        for (const p of pids) {
            const prc = this.getProcess(p, callCtx)
            if (!prc) continue
            await prc.kill(callCtx)
        }
        return true
    }

    //状态：查询 program 运行状态
    status(pid?: string, callCtx?: DvFsCallContext): DvProgramStatus | undefined {
        //查询需要 x 权限
        if (!this.ac('status', callCtx)) return this._acDenied('status')
        //meta
        const meta = this.getMeta()
        if (!meta) return undefined
        //type
        const type = this.getType()
        if (type === false) return undefined
        //pids
        let pids = this.getPids()
        //输出
        const rtn: DvProgramStatus = {
            ipath: this.ipath,
            name: meta.name,
            type,
            running: pids.length > 0,
            pid: pid ?? '',
            count: pids.length,
        }

        //指定了 pid 则仅停止目标进程，否则停止所有
        if (pid && pids.includes(pid)) {
            const prc = this.getProcess(pid, callCtx)
            const cache = prc?.getCache()
            const memory = prc?.getMemory()
            if (!prc || !cache) return rtn
            //获取指定 pid 进程 cache | memory
            rtn.cache = cache
            rtn.memory = memory
        }

        return rtn
    }

    //openFile：按 mime 关联打开文件
    //!! 文件 mime|*.ext 必须命中 programMeta.mimes[]，否则返回 undefined
    //!! 成功会 启动/复用 程序实例，将文件 ipath 注入 props 并记录到实例的 opens[]
    //!! 注意：这是「程序打开关联文件」，与基类的 open（打开自身节点）语义不同，因此不能叫 open
    //!! ipath 必须是绝对路径（以 / 开头）
    async openFile<T extends DvInodeHandlerName>(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        //通过 program 打开文件需要 x 权限
        if (!this.ac('open', callCtx)) return this._acDenied('open')
        //!! 只接受绝对路径：dvMem.addr 对不含 / 的字符串会优先按 program 名称查找，
        //!! 且 norm 不会基于进程 cwd 解析 . / .. 相对路径
        if (!dvIs.nemstr(ipath) || !ipath.startsWith('/')) {
            return this._krError(`打开文件失败，${ipath} 不是有效的绝对路径`)
        }
        const dvMem = useDvMemStore()
        //目标文件节点
        const fnode = dvMem.addr(ipath)
        if (!fnode || !dvMem.isInode(fnode)) {
            return this._krError(`文件 ${ipath} 不存在，无法打开`)
        }
        //校验 mime 关联
        const meta = this.getMeta()
        if (!meta || !this._mimeMatches(fnode)) {
            return this._krError(`不支持的文件类型 ${fnode._inode_.extra?.mime ?? fnode._ipath_}`)
        }
        //先解析目标文件句柄，失败则不启动程序实例
        const handler = useDvInodeHandler<T>(fnode, callCtx)?.handler
        if (!handler) {
            return this._krError(`无法获取文件 ${fnode._ipath_} 的句柄`)
        }
        //启动/复用程序实例，将文件 ipath 注入 props
        const props = dvExtend({}, opts ?? {}, { file: fnode._ipath_ })
        const pid = await this.exec(props, callCtx)
        if (!pid) {
            return this._krError(`无法启动程序 ${this.ipath}`)
        }
        //构造新的 callCtx
        const ctx = dvExtend({}, callCtx, {
            program: this.ipath,
            pid,
        })
        //打开目标文件节点（调用其自身的 open，记录引用者）
        //!! 基类 open 在 _addOpener 失败时返回 undefined 且不抛错，必须检查结果
        const opened = await handler.open(ctx as DvFsCallContext)
        if (!opened) {
            return this._krError(`打开文件 ${fnode._ipath_} 失败`)
        }
        return handler
    }

    //切换工作目录：dir 只能是 root 根路径的同级或下级
    cd(dir: string, callCtx?: DvFsCallContext): boolean {
        //切换需要 x 权限
        if (!this.ac('cd', callCtx)) return this._acDenied('cd')
        if (!dvIs.nemstr(dir)) return false
        //解析目标 pid
        const pid = this._getPidFromCallCtx(callCtx)
        if (!pid) return false
        //进入进程实例
        const prc = this.getProcess(pid, callCtx)
        if (!prc) return false
        return prc.cd(dir, callCtx)
    }
}

//定义 进程类
export class DvProcess {
    handler: DvProgramRegInode
    pid: string

    constructor(handler: DvProgramRegInode, pid?: string) {
        this.handler = handler
        const pids = handler.getPids()
        if (!pid || !dvIs.nemstr(pid)) {
            //获取 program 节点第一个 pid
            if (pids.length <= 0 || !pids[0]) {
                throw new DvKernelError(
                    `发生内核错误，无法获取进程实例，程序 ${handler.ipath} 没有启动`,
                )
            }
            pid = pids[0]
        }
        if (!pids.includes(pid)) {
            throw new DvKernelError(`发生内核错误，无法获取进程实例，未找到进程 ${pid}`)
        }
        this.pid = pid
    }

    //获取 pidCache 进程缓存，响应式
    getCache(): DvFsPidCache | undefined {
        const icache = this.handler.inode._icache_ as DvFsProgramRegInodeIcache
        return icache?.program?.[this.pid]
    }

    //获取进程 私有内存，响应式
    getMemory(): PlainObject | undefined {
        const dvMem = useDvMemStore()
        return dvMem.program?.[this.pid]
    }

    //将某个文件节点 写入 opens[]
    pushOpen(ipath: string, callCtx?: DvFsCallContext): boolean {
        const cache = this.getCache()
        if (!cache) return false
        if (!cache.opens) cache.opens = []
        if (!cache.opens.includes(ipath)) cache.opens.push(ipath)
        return true
    }

    //获取 cache.opens 中打开的某个文件节点 句柄实例
    getOpenInode<T extends DvInodeHandlerName>(
        ipath: string | number,
        callCtx?: DvFsCallContext,
    ): DvInodeHandler<T> | undefined {
        const cache = this.getCache()
        const opens = cache?.opens ?? []
        if (opens.length <= 0) return undefined
        const fip: string | undefined = typeof ipath === 'number' ? opens?.[ipath] : ipath
        if (!fip) return undefined
        return useDvInodeHandler<T>(fip, callCtx)?.handler
    }

    //切换工作目录：dir 只能是 root 根路径的同级或下级
    cd(dir: string, callCtx?: DvFsCallContext): boolean {
        const cache = this.getCache()
        if (!cache) return false
        //基于当前 dir 解析目标路径
        const ipu = useDvFsIpath()
        const root = ipu.norm(cache.root)
        const target = ipu.join(cache.dir, dir)
        //工作路径只能是 root 根路径的同级或下级
        if (target !== root && !target.startsWith(root + '/')) return false
        //目标必须是存在的 目录 节点
        const dvMem = useDvMemStore()
        const node = dvMem.addr(target)
        if (!node || !dvMem.isInode(node) || node._inode_.mode !== 'dir') return false
        cache.dir = target
        return true
    }

    //释放进程持有的 某个文件节点
    async releaseOpen(ipath?: string, callCtx?: DvFsCallContext): Promise<boolean> {
        const cache = this.getCache()
        if (!cache) return false
        const opens = cache.opens ?? []
        if (!ipath || !dvIs.nemstr(ipath) || !opens.includes(ipath)) return false
        const handler = useDvInodeHandler(ipath, callCtx)?.handler
        await handler?.release?.(callCtx)
        opens.splice(opens.indexOf(ipath), 1)
        return true
    }

    //释放进程持有的 全部文件节点引用（停止进程前调用）
    async releaseAllOpens(callCtx?: DvFsCallContext): Promise<boolean> {
        const cache = this.getCache()
        if (!cache) return false
        const opens = cache.opens ?? []
        for (const ipath of opens) {
            const handler = useDvInodeHandler(ipath, callCtx)?.handler
            handler?.release?.(callCtx)
        }
        //cache.opens = []
        opens.splice(0)
        return true
    }

    //停止进程
    async kill(callCtx?: DvFsCallContext): Promise<boolean> {
        const release = await this.releaseAllOpens(callCtx)
        const stop = await useDvMemStore().setMemOnProgramStop(this.pid)
        return release && stop
    }
}
