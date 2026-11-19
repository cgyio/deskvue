/**
 * Deskvue kernel
 * Deskvue Fs 文件系统，模拟 Linux 文件系统的一些行为
 * 定义文件节点 handler 句柄类 Dv***Inode
 *
 * 所有文件节点句柄类的 基类 DvInode
 */

import { computed, type ComputedRef } from 'vue'
import { dvTriggerKernelError, DvKernelError, type DvKernelErrorLevel } from '../../error'
import { useDvMemStore } from '../stores/dv-mem'
import { useDvHddStore, type DvHddStore } from '../stores/dv-hdd'
import {
    type DvFsMemStruct,
    type DvFsHddStruct,
    type DvFsInodeMemStruct,
    type DvFsInodeHddStruct,
    type DvFsInodeAuth,
    type DvFsInodeCreateOptions,
    type DvFsCaller,
    type DvFsCallContext,
    type DvFsProgramRegInodeIcache,
    type DvFsPidCache,
} from '../types'
import { useDvFsIpath, useDvFsAc, type DvFsAcHook, type DvFsAcFn } from '../utils'
import {
    useDvInodeHandler,
    type DvInodeHandlerName,
    type DvInodeHandler,
    type DvProgramRegInode,
} from './index'
//import { DvDirInode } from './dv-dir'
import { dvIs, dvWait, dvExtend, dvCopy, dvSortByKv } from '@utils/core'

//ls 传入的额外参数类型
export type DvFsLsSortKey = 'asc' | 'desc' | `${'a' | 'c' | 'm'}:${'asc' | 'desc'}`
export interface DvFsLsOpts {
    //是否递归获取所有子目录内部节点，默认 false
    recursive?: boolean
    //sort 排序方法，默认按 fid 定义先后顺序
    sort?: DvFsLsSortKey | ((items: DvFsLsItem[]) => DvFsLsItem[])
    //filter 筛选方法
    filter?: (items: DvFsLsItem) => boolean
    [K: string]: any
}
//ls 得到的子节点 status 数据类型
export interface DvFsLsItem {
    fid: string
    ipath: string
    inode: DvFsInodeMemStruct
}

export class DvInode {
    //文件节点的全局唯一路径字符串，寻址依据
    ipath: string = ''
    //内存中此文件节点的数据
    inode: DvFsMemStruct = {} as DvFsMemStruct
    //保存构造时传入的 extra 额外参数，子类句柄可能需要执行个性化操作
    //!! 句柄实例的额外参数，与调用上下文强相关，因此放到调用上下文 DvFsCallContext 对象内
    //extra: PlainObject = {}
    //useFsAc 权鉴 hook 实例，节点句柄类需要注入自有的 特定权鉴函数
    acHook: DvFsAcHook = {} as DvFsAcHook

    //构造
    constructor(inode: string | DvFsMemStruct /*, extra?: PlainObject*/) {
        //内存寻址，获取节点数据
        const dvMem = useDvMemStore()
        const node: DvFsMemStruct | undefined = dvMem.isInode(inode)
            ? (inode as DvFsMemStruct)
            : typeof inode === 'string'
              ? dvMem.addr(inode)
              : undefined
        if (!node) {
            //内核错误：节点不存在，不终止后续流程
            dvTriggerKernelError(
                `[DvInode] 内核错误，无法获取文件节点数据${typeof inode === 'string' ? ' ' + inode : ''}`,
            )
        } else {
            this.ipath = node._ipath_
            this.inode = node
            this.acHook = this._getFsAcHook()
        }
    }

    //实例化 DvFsAcHook 注入此文件节点类型 自有的 特殊权鉴方法
    //!! 句柄子类必须 overrdie
    protected _getFsAcHook(): DvFsAcHook {
        return useDvFsAc((r: DvFsAcFn, w: DvFsAcFn, x: DvFsAcFn): Record<string, DvFsAcFn> => {
            //!! 基类不注入任何权鉴方法，子类必须 override
            return {
                //'reg:program:open': (a: DvFsInodeAuth) => r(a) && x(a),
            }
        })
    }

    //节点权鉴方法
    ac(op: string, callCtx?: DvFsCallContext): boolean {
        //!! 基类中直接使用 权鉴工具的 ac 方法
        //!! 子类可以 override 执行更复杂的 权鉴方法，例如：黑白名单，特权跳过 等
        return this.acHook.ac(this.inode, op, callCtx)
    }

    //将传入的 ipath 参数 转为有效的 ipath 形式
    //  不带 / 的情况：作为本节点下的子节点名(fid/显示名)查找
    //  带 / 的情况：
    //      /foo/bar    绝对路径，完整 ipath 寻址并校验父目录确实是 this（原逻辑）
    //      foo/bar     相对路径，基于当前节点拼接 useDvFsIpath().join()
    //      ../foo/bar  上级路径，join 内部解析 . / .. 路径计算
    //      ./foo/bar   在当前节点所在的 /*** 根目录下查找
    //!! 句柄实例内，如果传入 ipath 参数，一般都需要经过此方法处理为有效的 ipath 参数
    protected _normIpath(ipath: string): string {
        const ipu = useDvFsIpath()
        const cip = this.ipath

        //不带 / 作为当前节点的子节点
        if (!ipath.includes('/')) {
            return ipu.join(cip, ipath)
        }

        //绝对路径 /foo/bar 直接使用
        if (ipath.startsWith('/')) {
            return ipu.norm(ipath)
        }

        //相对路径
        //./foo/bar：在当前节点所在的 /*** 根目录下查找
        if (ipath.startsWith('./')) {
            const root = ipu.norm(ipu.first(cip))
            return ipu.join(root, ipath.slice(2))
        }
        //foo/bar 或 ../foo/bar 基于当前节点拼接，join 解析 . / ..
        else {
            return ipu.join(cip, ipath)
        }
    }

    //获取父节点 返回句柄实例, 调用上下文为当前上下文
    parentHandler<T extends DvInodeHandlerName>(
        callCtx?: DvFsCallContext,
    ): DvInodeHandler<T> | undefined {
        //父节点 ipath
        const ppath = useDvFsIpath().parent(this.ipath)
        if (!ppath || !dvIs.nemstr(ppath)) return undefined
        const parent = useDvInodeHandler<T>(ppath, callCtx)
        if (!parent) return undefined
        return parent.handler
    }

    //!! 针对可以拥有子节点的 文件节点的 句柄通用方法

    //通用的 "不支持操作" 内核错误报错
    protected _unSupport(op: string): never {
        throw new DvKernelError(
            `[DvInode] 内核错误：节点 ${this.ipath} 不支持操作 ${op}`,
            //!! OOPS 内核错误级别 在用户态会弹窗提示，不会终止后续
            { level: 'OOPS' },
        )
    }

    //通用的 无权限 内核错误报错
    protected _acDenied(op: string): never {
        throw new DvKernelError(
            `[DvInode] 内核错误：节点 ${this.ipath} 没有 ${op} 操作权限`,
            //!! OOPS 内核错误级别 在用户态会弹窗提示，不会终止后续
            { level: 'OOPS' },
        )
    }

    //其他操作失败，返回内核错误
    protected _krError(msg: string): never {
        throw new DvKernelError(`[DvInode] 内核错误：${msg}`, { level: 'OOPS' })
    }

    //操作 inode 节点数据本身
    //针对 ipath 的快捷判断
    //是否 全局根目录 /
    isBaseDir(): boolean {
        return useDvFsIpath().isBase(this.ipath)
    }
    //是否 根目录 /***
    isRootDir(): boolean {
        return useDvFsIpath().isRoot(this.ipath)
    }
    //是否 可以编辑 inode 节点数据
    //!! 可写，且不能是 / 或 /*** 目录节点，这些节点被设计为不允许任何人修改节点数据，包括 root
    isInodeEditable(callCtx?: DvFsCallContext): boolean {
        return !(this.isBaseDir() || this.isRootDir()) && this.ac('w', callCtx)
    }
    //写入 inode._inode_{}
    protected _setInode(data: Partial<DvFsInodeMemStruct>, callCtx?: DvFsCallContext): boolean {
        if (!this.isInodeEditable(callCtx)) return false
        if (!data || !dvIs.nemobj(data)) return false

        //去除要写入的 data 数据中，不属于 DvFsInodeMemStruct 的键
        const d: PlainObject = {}
        for (const k in data) {
            if (!(k in this.inode._inode_)) {
                if (['extra'].includes(k) !== true) continue
            } else {
                //!! time | modi | lock | open 这些运行时标记，不能通过 setInode 修改
                if (['time', 'modi', 'lock', 'open'].includes(k)) continue
            }
            d[k] = (data as PlainObject)[k]
        }
        if (!dvIs.nemobj(d)) return false

        //!! 修改 文件节点数据
        //!! dvExtend 第一个参数 false 表示对于数组，使用覆盖，而不是合并去重
        this.inode._inode_ = dvExtend<DvFsInodeMemStruct>(false, this.inode._inode_, d)
        //脏标记
        return this._setTimestamp('c', undefined, callCtx)
    }
    //时间戳
    protected _setTimestamp(
        key: 'a' | 'c' | 'm' | 'd',
        timestamp?: number,
        callCtx?: DvFsCallContext,
    ): boolean {
        //if (!this.isInodeEditable(callCtx)) return false
        if (timestamp === undefined) timestamp = Date.now()
        //写入 inode._inode_.time[key]
        const ts = this.inode._inode_.time
        ts[key] = timestamp
        //脏标记
        return this._setModi(true, callCtx)
    }
    //引用者数组
    //从 callCtx 调用上下文中 拆分出调用 program 节点 ipath
    protected _getOpenerFromCallCtx(callCtx?: DvFsCallContext): string | undefined {
        let opener: string = callCtx?.program ?? ''
        //!! 如果不存在 opener
        if (opener === '') {
            //!! 如果调用这不是 root 表示是在用户态调用节点，但是未传入调用上下文，报错
            if (!callCtx || callCtx.caller !== 'root') {
                dvTriggerKernelError(
                    `[DvInode] 内核错误：调用文件节点 ${this.ipath} 未传入有效的上下文`,
                    'OOPS',
                )
                return undefined
            }
            //!! root 调用者 一般表示这是在 内核启动阶段，默认 opener = /sys/prog0
            else {
                opener = '/sys/prog0'
            }
        }
        if (!opener || !dvIs.nemstr(opener)) return undefined
        return opener
    }
    //从 callCtx 调用上下文中 拆分出调用 program 节点当前的 pid
    protected _getPidFromCallCtx(callCtx?: DvFsCallContext): string | undefined {
        const pid = callCtx?.pid
        if (pid) return pid
        //内核 /sys/prog0 调用
        const opener = this._getOpenerFromCallCtx(callCtx)
        if (!opener || opener !== '/sys/prog0') return undefined
        const dvMem = useDvMemStore()
        const pids = dvMem.getPidsByIpath(opener)
        if (!pids || pids.length <= 0 || !pids[0]) return undefined
        //内核 /sys/prog0 调用一定是单例
        return pids[0]
    }
    //添加引用者
    protected _addOpener(callCtx?: DvFsCallContext): boolean {
        //if (!this.isInodeEditable(callCtx)) return false
        //引用者，保存在 调用上下文 callCtx.program 中
        const opener = this._getOpenerFromCallCtx(callCtx)
        if (!opener || !dvIs.nemstr(opener)) return false

        //写入 inode._inode_.open[] 数组
        const opens = this.inode._inode_.open
        //!! 同一个程序，多次打开同一个文件，返回 true
        if (opens.includes(opener)) return true
        opens.push(opener)
        //!! 修改 open[] 不需要 脏标记
        //this._setModi(true, callCtx)
        //锁
        return this._setLock(opens.length > 0, callCtx)
    }
    //删除引用者
    protected _delOpener(callCtx?: DvFsCallContext): boolean {
        //if (!this.isInodeEditable(callCtx)) return false
        //引用者，保存在 调用上下文 callCtx.program 中
        const opener = this._getOpenerFromCallCtx(callCtx)
        if (!opener || !dvIs.nemstr(opener)) return false
        //修改 open[] 数组
        const opens = this.inode._inode_.open
        if (!opens.includes(opener)) return false
        opens.splice(opens.indexOf(opener), 1)
        //!! 修改 open[] 不需要 脏标记
        //this._setModi(true, callCtx)
        //锁
        return this._setLock(opens.length > 0, callCtx)
    }
    //脏标记
    protected _setModi(modi: boolean, callCtx?: DvFsCallContext): boolean {
        this.inode._inode_.modi = modi ? 1 : 0
        //!! 操作内存中的 脏标记缓存
        const dvMem = useDvMemStore()
        //写入 modiCache
        if (modi) return dvMem.setInodeModiCache(this.ipath)
        //从缓存中删除
        return dvMem.unsetInodeModiCache(this.ipath)
    }
    //锁
    protected _setLock(lock: boolean, callCtx?: DvFsCallContext): boolean {
        //if (!this.isInodeEditable(callCtx)) return false
        this.inode._inode_.lock = lock ? 1 : 0
        return true
    }

    //模拟 Linux 文件系统 文件节点的 操作函数列表
    //!! DvInode 基类实现 与节点类型无关 的通用逻辑，类型相关行为交由子类实现 或 重载
    //!! 并不是每个类型的 DvInode 都要实现所有函数
    //!! 未实现的操作 调用后会抛出 内核错误，终止后续流程（避免静默失败）

    //快速判断节点是否已被锁定（有其他节点引用了此节点）
    isInodeLocked(callCtx?: DvFsCallContext): boolean {
        //lock === 0 表示此时没有其他节点 引用此节点
        if (this.inode._inode_.lock === 0) return false
        //从调用上下文对象中解析 调用来源的 文件节点 ipath
        const opener = this._getOpenerFromCallCtx(callCtx)
        if (!opener) return true
        return !this.inode._inode_.open.includes(opener)
    }
    //快速判断当前节点是否可以执行 rename|mv|unlink 等操作
    isInodeOperatable(callCtx?: DvFsCallContext): boolean {
        return !(this.isBaseDir() || this.isRootDir() || this.isInodeLocked(callCtx))
    }
    //针对 mv 操作的额外判断，返回 true 或 错误信息
    isInodeMovable(ipath: string, callCtx?: DvFsCallContext): true | string {
        //operatable
        if (!this.isInodeOperatable(callCtx)) {
            return `无法重命名 ${this.ipath}，当前文件无操作权限或以被其他程序锁定`
        }
        const ipu = useDvFsIpath()
        const dvMem = useDvMemStore()
        //!! 移动节点，需要父节点的 w+x 权限
        const oParent = this.parentHandler(callCtx)
        if (!oParent || oParent.ac('wx', callCtx) !== true) {
            return `无法移动文件 ${this.ipath}，文件不存在或缺少目录权限`
        }
        //处理传入的 ipath
        const toip = this._normIpath(ipath)
        //!! 要移动到的 父节点 也需要 w+x 权限
        const ppath = ipu.parent(toip)
        const nParent = useDvInodeHandler(ppath, callCtx)?.handler
        if (!nParent || nParent.ac('wx', callCtx) !== true) {
            return `无法移动文件到 ${ppath}，目录不存在或缺少权限`
        }
        //目标节点不能已存在
        if (dvMem.addr(toip) !== undefined) {
            return `无法将文件 ${this.ipath} 移动到 ${toip}，目标文件已存在`
        }
        return true
    }
    //快速判断当前节点是否可以被打开
    isInodeOpenable(callCtx?: DvFsCallContext): boolean {
        //!! 锁定不影响 open，lock 不是独占锁，可以有多个程序引用同一个文件
        //if (this.isInodeLocked(callCtx)) return false
        //!! open 需要父目录的 x 权限
        const parent = this.parentHandler(callCtx)
        return !!parent && parent.ac('x', callCtx)
    }

    //inode_operations 文件节点本身的操作列表
    //lookup 路径解析（dir 查 _snode_、blk 解析 model、chr/sock 各有逻辑）
    lookup<T extends DvInodeHandlerName>(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): DvInodeHandler<T> | undefined {
        return this._unSupport('lookup')
    }
    //mkdir 创建子目录
    async mkdir(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<'DvDirInode'> | undefined> {
        return this._unSupport('mkdir')
    }
    //create 创建文件节点
    async create<T extends DvInodeHandlerName>(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        return this._unSupport('create')
    }
    //symlink 创建软连接
    async symlink(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<'DvLnkInode'> | undefined> {
        return this._unSupport('symlink')
    }
    //rename 重命名自身节点
    async rename<T extends DvInodeHandlerName>(
        name: string,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        //operatable
        if (!this.isInodeOperatable(callCtx)) {
            return this._krError(`无法重命名 ${this.ipath}，当前文件无操作权限`)
        }
        //!! 通过父节点执行
        const parent = this.parentHandler<'DvDirInode'>(callCtx)
        if (!parent) return undefined
        return parent.renameChild<T>(useDvFsIpath().last(this.ipath), name, callCtx)
    }
    //mv 移动自身节点
    async mv<T extends DvInodeHandlerName>(
        ipath: string,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        const dvMem = useDvMemStore()
        //movable
        const mvok = this.isInodeMovable(ipath, callCtx)
        if (mvok !== true) {
            return this._krError(mvok)
        }

        //一切正常，执行 mv
        const toip = this._normIpath(ipath)
        const nip = await dvMem.mv(this.ipath, toip)
        if (!nip) {
            return this._krError(`移动文件 ${this.ipath} 失败，原因未知`)
        }

        //返回新节点 句柄
        return useDvInodeHandler<T>(nip, callCtx)?.handler
    }
    //unlink 删除文件节点（目录、文件、符号链接..）
    async unlink(callCtx?: DvFsCallContext): Promise<boolean> {
        //operatable
        if (!this.isInodeOperatable(callCtx)) {
            return this._krError(`无法重命名 ${this.ipath}，当前文件无操作权限`)
        }
        //!! 通过父节点执行
        const parent = this.parentHandler<'DvDirInode'>(callCtx)
        if (!parent) return false
        return parent.unlinkChild(useDvFsIpath().last(this.ipath), callCtx)
    }
    //rmdir 清空目录
    async rmdir(callCtx?: DvFsCallContext): Promise<boolean> {
        return this._unSupport('rmdir')
    }
    //ls 列出子节点
    async ls(opts?: DvFsLsOpts, callCtx?: DvFsCallContext): Promise<DvFsLsItem[]> {
        const dvMem = useDvMemStore()
        //权鉴，列出子节点需要 r+x
        if (this.ac('rx', callCtx) !== true) return []

        //子节点 fids
        const fids = dvMem.inodeFids(this.inode)
        if (fids.length <= 0) return []
        let items: DvFsLsItem[] = fids.map((i: string) => {
            const idi = this.inode[i] as DvFsMemStruct
            return {
                fid: i,
                ipath: idi?._ipath_,
                inode: dvCopy(idi?._inode_ ?? {}),
            }
        })

        //filter 筛选
        if (typeof opts?.filter === 'function') {
            items = items.filter(opts.filter)
        }

        //先递归
        if (opts?.recursive === true) {
            const subOpts = { recursive: true } as DvFsLsOpts
            if (typeof opts?.filter === 'function') subOpts.filter = opts.filter

            for (const item of items) {
                const handler = useDvInodeHandler(item.ipath, callCtx)?.handler
                if (!handler) continue
                const subItems = await handler.ls(subOpts, callCtx)
                if (subItems.length > 0) {
                    items.push(...subItems)
                }
            }
        }

        //最后排序
        if (opts?.sort !== undefined) {
            //自定义排序方法
            if (typeof opts.sort === 'function') {
                items = opts.sort(items)
            }
            //使用预定义的排序方法
            else {
                const sort = opts.sort as DvFsLsSortKey
                //默认按 fid 排序
                if (!sort.includes(':')) {
                    items = dvSortByKv(items, 'fid', sort as 'asc' | 'desc') as DvFsLsItem[]
                }
                //按 inode.time.a|c|m 排序
                else {
                    const sa = sort.split(':')
                    const sk = sa[0] as 'a' | 'c' | 'm'
                    const st = sa[1] as 'asc' | 'desc'
                    items = dvSortByKv(items, ['inode', 'time', sk], st) as DvFsLsItem[]
                }
            }
        }

        return items
    }
    //attr 元数据
    getattr(callCtx?: DvFsCallContext): ComputedRef<DvFsInodeMemStruct | undefined> {
        //返回内存中此节点的 _inode_ 元数据（ComputedRef 只读）
        return computed<DvFsInodeMemStruct | undefined>(() => {
            //!! 需要 r 权限
            if (this.ac('r', callCtx)) return this.inode._inode_
            return undefined
        })
    }
    setattr(attr: PlainObject, callCtx?: DvFsCallContext): DvInode | undefined {
        //调用 setInode
        const setOk = this._setInode(attr, callCtx)
        if (!setOk) return this
        //子类钩子：个性化校验 / 副作用
        this._onSetattr?.(attr, callCtx)
        return this
    }
    settime(key: 'a' | 'c' | 'm' | 'd', timestamp?: number, callCtx?: DvFsCallContext): boolean {
        return this._setTimestamp(key, timestamp, callCtx)
    }
    setopener(callCtx?: DvFsCallContext): boolean {
        return this._addOpener(callCtx)
    }
    delopener(callCtx?: DvFsCallContext): boolean {
        return this._delOpener(callCtx)
    }

    //file_operations 针对文件内容的 操作函数列表
    //打开，默认返回节点句柄实例
    async open(callCtx?: DvFsCallContext): Promise<any> {
        //!! 使用默认的 权鉴方法，子类可以 override 这个 open 方法，使用其他权鉴方法
        //!! 或者只实现 _onOpen 钩子
        if (!this.isInodeOpenable(callCtx)) {
            return this._acDenied('open')
        }

        //记录引用者
        const opener = this._getOpenerFromCallCtx(callCtx)
        const openerOk = this._addOpener(callCtx)
        if (!opener || !openerOk) return undefined

        //在引用者自己的 opens 中记录当前文件节点 ipath
        const ophdl = useDvInodeHandler(opener, callCtx)?.handler as DvProgramRegInode
        if (ophdl && ophdl.isRunning()) {
            //进入进程实例
            const prc = ophdl.getProcess(undefined, callCtx)
            if (prc) {
                //记录当前文件节点 ipath
                prc.pushOpen(this.ipath, callCtx)
            }
        }

        //子类钩子：真正建立连接 / 发起请求
        const res = await this._onOpen?.(callCtx)
        //如果钩子有返回值，则使用
        if (res !== undefined) return res
        //默认返回句柄实例
        return this
    }
    //释放，默认返回节点句柄实例
    async release(callCtx?: DvFsCallContext): Promise<any> {
        //删除引用者
        const openerOk = this._delOpener(callCtx)
        if (!openerOk) return false

        //子类钩子：释放连接 / 中断请求
        const res = await this._onRelease?.(callCtx)
        //如果钩子有返回值，则使用
        if (res !== undefined) return res
        //默认返回句柄实例
        return this
    }
    //读写：内容 I/O 与存储后端强相关，必须由子类实现
    async read(opts?: PlainObject, callCtx?: DvFsCallContext): Promise<any> {
        return this._unSupport('read')
    }
    async write(content?: any, opts?: PlainObject, callCtx?: DvFsCallContext): Promise<any> {
        return this._unSupport('write')
    }

    //写入磁盘：把内存节点持久化到 dvHdd
    async fsync(callCtx?: DvFsCallContext): Promise<boolean> {
        //!! 用户还未登录阶段，不执行任何持久化操作
        const stage = globalThis.DvKernel.stage
        if (!stage || stage.stageBefore('is-login')) return false
        //!! 根目录 / 和 /*** 不能持久化
        if (this.isBaseDir() || this.isRootDir()) return false

        const dvMem = useDvMemStore()
        //必须包含 脏标记，才能刷盘
        if (this.inode._inode_.modi !== 1 && !dvMem.hasInodeModiCache(this.ipath)) return false
        //!! 如果此节点已标记为 正在刷盘，则终止本次刷盘
        if (dvMem.isInodeModiFsyncing(this.ipath)) return false

        //dvHdd 磁盘
        const dvHdd = useDvHddStore()
        if (!dvHdd || !dvHdd.fs) {
            dvTriggerKernelError(
                `[DvInode] 内核错误：无法加载磁盘`,
                //!! 这是严重错误
                'PANIC',
            )
            return false
        }

        //!! 标记此节点 正在刷盘 状态
        dvMem.setInodeModiFsyncing(this.ipath, true)

        //!! 根据当前节点的实际类型，有不同的持久化方法
        //!! 子类实现具体 刷磁盘方法
        const syncOk = (await this._doFsync?.(dvHdd, callCtx)) ?? false
        if (!syncOk) {
            dvTriggerKernelError(`[DvInode] 内核错误：保存节点 ${this.ipath} 数据失败`, 'OOPS')
            dvMem.setInodeModiFsyncing(this.ipath, false)
            return false
        }

        //写入磁盘后 清除脏标记
        dvMem.setInodeModiFsyncing(this.ipath, false)
        await dvWait(10)
        return this._setModi(false)
    }

    //子类句柄 可覆盖的钩子方法
    //!! 基类只提供通用逻辑，类型相关行为由子类实现

    //setattr 个性化校验 / 副作用
    protected _onSetattr?(attr: PlainObject, callCtx?: DvFsCallContext): void
    //open 真正建立连接 / 发起请求
    protected async _onOpen?(callCtx?: DvFsCallContext): Promise<any>
    //release 释放连接 / 中断请求
    protected async _onRelease?(callCtx?: DvFsCallContext): Promise<any>
    //最终刷盘操作
    //!! 默认使用 dvHdd.fsync() 方法
    //!! 不同的文件节点类型，可能有不同的刷盘方法，应在对应的节点句柄类中覆盖这个钩子
    protected async _doFsync(dvHdd: DvHddStore, callCtx?: DvFsCallContext): Promise<boolean> {
        return await dvHdd.fsync(this.inode)
    }
}
