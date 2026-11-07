/**
 * Deskvue kernel
 * Deskvue Fs 文件系统，模拟 Linux 文件系统的一些行为
 * 定义 文件节点 handler 句柄类 Dv***Inode
 *
 * 文件节点数据的实际储存方式：
 *      文件节点的唯一路径字符串形式：          /foo/bar/fid    一定以 / 开头
 *      对应的在 内存(dvMem) 中的储存位置：     dvMem.fs.foo.bar.fid  直接以 fs 对象的子键形式保存
 *
 * !! 文件名的行为：
 *      fnode._ipath_ 为全局唯一的文件路径字符串，结构为：/foo/bar/[fid]
 *      [fid] 是文件节点 在父目录节点参数对象中的键名，默认情况下文件显示名称与键名一致
 *      !! 修改文件名称后，显示名称与键名不一致，保存在 dvMem.fs.foo.bar.[fid]._inode_.name 中
 *      !! [fid] 不包含后缀名，如果包含 . 也不会被作为后缀名
 *          文件后缀名由内核根据 fnode._inode_.mode 和 fnode._inode_.extra.type 自动推断
 *          在 资源管理器中显示的后缀名 使用自动推断得到的，以 .ext 形式附加到文件显示名称之后：
 *              例如：/foo/bar/[fid]
 *                  显示名称：nameFoo.aa，推断后缀名 .bb，则在资源管理器中显示为：nameFoo.aa.bb
 *      !! [fid] 文件节点键名命名规则：
 *              不能包含 /
 *              不能使用 dvFsFidKeywords[] 中包含的系统关键字 _ipath_,_inode_,_icache_,_content_..
 *      !! [fid] 文件节点键名的创建：
 *          通过父节点 parentFnode.create('/foo/bar/文件名', {type: ...}) 创建文件节点时：
 *          !! 这通常是用户行为，需要用户提供文件名
 *              !! 会检查传入的文件名是否符合命名规则，不符合会报错：文件名不合法
 *              !! 如果传入的文件名带 .** 后缀，且未传入额外的 type 节点类型参数，会执行：
 *                  裁切最后一个 .** 检查剩余文件名合法性，
 *                      一切正常会自动将新建的文件节点 mode 设为 reg，extra.type 设为 ext，将 .** 写入 extra.mime
 *                      如果文件不合法，则忽略后缀，将其作为文件名本身，检查合法性并创建文件节点
 *          内核自动创建的文件节点，[fid] 完全由内核控制生成，例如：
 *              /sys/update，/sys/service/winService，/program/explorer，/mnt/db_[md5]
 *      !! 对文件节点执行 rename 改名时，传入的名称将被设置为 fnode._inode_.name
 *          !! 同一路径下，不可重名 !! 例如：
 *              存在文件  /foo/bar/aaa  其显示名称为 bbb，则：
 *                  /foo/bar 目录下的其他文件，都不可以将显示名称改为 aaa 或 bbb
 *      !! 在调用文件节点路径字符时，需要区分传入的 是 [fid] 还是 fnode._inode_.name
 *          优先把传入的 文件名作为 [fid] 直接寻址
 *              !! 如果不存在，则尝试作为 _inode_.name
 *          如果传入的文件名包含 .** 后缀，则截取后缀，将剩余的文件名优先作为 _inode_.name
 *          !! 内核调用文件路径一定不会包含后缀名，且一定使用 [fid]
 *
 * inode 基础节点类型：dir
 * 定义句柄类 DvDirInode
 *
 * !! 其他可以拥有子节点的 节点句柄类型，要继承此类
 * 例如： mnt 类型节点
 *
 */

import { DvInode } from './dv-inode'
import { DvLnkInode } from './dv-lnk'
import { useDvInodeHandler, type DvInodeHandlerName, type DvInodeHandler } from './index'
import { useDvMemStore } from '../stores/dv-mem'
import {
    type DvFsMemStruct,
    type DvFsInodeAuth,
    type DvFsInodeCreateOptions,
    type DvFsCallContext,
} from '../types'
import { useDvFsIpath, useDvFsAc, type DvFsAcHook, type DvFsAcFn } from '../utils'
import { dvIs } from '@utils/core'

export class DvDirInode extends DvInode {
    //实例化 DvFsAcHook 注入此文件节点类型 自有的 特殊权鉴方法
    protected _getFsAcHook(): DvFsAcHook {
        return useDvFsAc((r: DvFsAcFn, w: DvFsAcFn, x: DvFsAcFn): Record<string, DvFsAcFn> => {
            return {
                //查找子节点：需要 r+x
                'dir:lookup': (a: DvFsInodeAuth) => r(a) && x(a),
                //创建子节点(mkdir/create/symlink)：需要 w+x
                'dir:create': (a: DvFsInodeAuth) => w(a) && x(a),
                //删除/重命名子节点(unlink/rmdir/rename)：需要 w+x
                'dir:unlink': (a: DvFsInodeAuth) => w(a) && x(a),
            }
        })
    }

    //获取可能存在的 子节点句柄实例
    childHandler<T extends DvInodeHandlerName>(
        child: string | DvFsMemStruct,
        callCtx?: DvFsCallContext,
    ): DvInodeHandler<T> | undefined {
        const inode: DvFsMemStruct | undefined =
            typeof child === 'string' ? useDvMemStore().addr(this._normIpath(child)) : child
        if (!inode) return undefined
        //句柄工厂
        return useDvInodeHandler(inode, callCtx)?.handler as DvInodeHandler<T>
    }

    //获取子节点 fid[]
    childFids(): string[] {
        const ipu = useDvFsIpath()
        return Object.keys(this.inode).filter((i: string) => ipu.isFid(i))
    }
    //获取子节点的 句柄实例
    childHandlers<T extends DvInodeHandlerName>(callCtx?: DvFsCallContext): DvInodeHandler<T>[] {
        if (this.isEmpty()) return []
        const fids = this.childFids()
        const hdls: DvInodeHandler<T>[] = []
        for (let i = 0; i < fids.length; i++) {
            const fid = fids[i]
            if (!fid) continue
            const sinode = this.inode[fid] as DvFsMemStruct
            if (!sinode) continue
            const hdl = useDvInodeHandler<T>(sinode, callCtx)?.handler
            if (!hdl) continue
            hdls.push(hdl)
        }
        return hdls
    }

    //判断当前节点是否不包含任何子节点，除了 dir 节点类型，其他节点类型也可能有子节点，例如：mnt
    isEmpty(): boolean {
        const ipu = useDvFsIpath()
        return !Object.keys(this.inode).some((k) => ipu.isFid(k))
    }

    //在当前节点下创建子节点，返回子节点句柄实例
    protected async _createChild<T extends DvInodeHandlerName>(
        ipath: string,
        opts?: DvFsInodeCreateOptions,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        //处理传入的 ipath
        const nip = this._normIpath(ipath)
        //执行创建
        const inode = await useDvMemStore().create(nip, opts)
        if (!inode) return this._krError(`无法创建文件节点 ${nip}`)
        //返回 handler
        return this.childHandler(inode, callCtx) as DvInodeHandler<T>
    }
    protected async _createChildRecursive<T extends DvInodeHandlerName>(
        ipath: string,
        opts?: DvFsInodeCreateOptions,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        //处理传入的 ipath
        const nip = this._normIpath(ipath)
        //执行创建
        const inode = await useDvMemStore().create(nip, opts, true)
        if (!inode) return this._krError(`无法创建文件节点 ${nip}`)
        //返回 handler
        return this.childHandler(inode, callCtx) as DvInodeHandler<T>
    }

    //重命名当前节点下的子节点，返回子节点句柄实例
    //!! oldName 可以是显示名称
    async renameChild<T extends DvInodeHandlerName>(
        oldName: string,
        newName: string,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        //!! 重命名子节点需要当前节点的 w+x 权限
        if (!this.ac('wx', callCtx)) return this._acDenied('renameChild')
        //获取子节点句柄
        const inode = this.childHandler<T>(oldName, callCtx)
        if (!inode) return undefined
        //修改子节点数据
        const rnok = await useDvMemStore().rename(inode.ipath, newName)
        if (!rnok)
            return this._krError(`无法重命名文件 ${inode.ipath}，可能存在重名文件 ${newName}`)
        //子节点的 脏标记，时间戳
        //!! 如果子节点本身不允许修改节点数据，则会标记失败，但不影响改名
        inode.settime('c', undefined, callCtx)
        //返回子节点句柄
        return inode
    }

    //删除当前节点下的子节点，返回 boolean
    async unlinkChild(ipath: string, callCtx?: DvFsCallContext): Promise<boolean> {
        //!! 删除子节点需要当前节点的 w+x 权限
        if (!this.ac('wx', callCtx)) return this._acDenied('unlinkChild')
        //获取子节点句柄
        const inode = this.childHandler(ipath, callCtx)
        if (!inode) return false
        //!! 如果子节点是 目录，还需要检查是否空目录
        if (inode instanceof DvDirInode) {
            if (!inode.isEmpty()) {
                return this._krError(`无法删除目录 ${inode.ipath}，目录不为空`)
            }
        }
        //删除子节点
        const ulok = await useDvMemStore().unlink(inode.ipath)
        if (!ulok) return this._krError(`无法删除 ${inode.ipath}，无操作权限`)
        return true
    }

    //快速判断节点是否已被锁定（有其他节点引用了此节点）
    //!! override 目录节点需要递归判断子节点 lock
    override isInodeLocked(callCtx?: DvFsCallContext): boolean {
        //先判断目录节点自身
        const locked = super.isInodeLocked(callCtx)
        if (locked) return true
        if (this.isEmpty()) return false
        //递归判断子节点
        const hdls = this.childHandlers(callCtx)
        for (let i = 0; i < hdls.length; i++) {
            const hdl = hdls[i]
            if (!hdl) continue
            if (hdl.isInodeLocked(callCtx)) return true
        }
        return false
    }

    //inode_operations 文件节点本身的操作列表
    //lookup 路径解析（dir 查 _snode_、blk 解析 model、chr/sock 各有逻辑）
    override lookup<T extends DvInodeHandlerName>(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): DvInodeHandler<T> | undefined {
        //dir 需要 r+x 权限（dir:lookup）
        if (!this.ac('lookup', callCtx)) return this._acDenied('lookup')
        //直接调用 childHandler 方法
        return this.childHandler(ipath, callCtx) as DvInodeHandler<T>
    }
    //mkdir 创建子目录
    override async mkdir(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<DvDirInode | undefined> {
        //dir 需要 w+x 权限（dir:create）
        if (!this.ac('create', callCtx)) return this._acDenied('mkdir')
        //创建 dir 类型子节点
        return await this._createChild<'DvDirInode'>(
            ipath,
            { ...(opts ?? {}), mode: 'dir' } as DvFsInodeCreateOptions,
            callCtx,
        )
    }
    //create 创建文件节点
    override async create<T extends DvInodeHandlerName>(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<DvInodeHandler<T> | undefined> {
        //dir 需要 w+x 权限（dir:create）
        if (!this.ac('create', callCtx)) return this._acDenied('create')
        //创建任意类型子节点
        return await this._createChild<T>(ipath, (opts ?? {}) as DvFsInodeCreateOptions, callCtx)
    }
    //symlink 创建软连接
    //!! opts.target 为目标 ipath，可以是绝对路径，也可以是相对于当前目录的路径
    //!! 目标不存在也允许创建（悬空链接），直到使用链接时才报错
    override async symlink(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<DvLnkInode | undefined> {
        //dir 需要 w+x 权限（dir:create）
        if (!this.ac('create', callCtx)) return this._acDenied('symlink')

        //目标 ipath
        //!! target 不是节点创建参数，不能传递给 _createChild
        const { target, ...rest } = opts ?? {}
        if (!dvIs.nemstr(target)) {
            return this._krError(`创建符号链接 ${ipath} 失败，未指定目标 target`)
        }

        //创建 lnk 类型子节点
        const handler = await this._createChild<'DvLnkInode'>(
            ipath,
            { ...rest, mode: 'lnk' } as DvFsInodeCreateOptions,
            callCtx,
        )
        if (!handler) return undefined

        //写入链接目标（settarget 内部写入 _icache_.content 并标脏）
        if (!handler.settarget(target as string, callCtx)) {
            return this._krError(`创建符号链接 ${ipath} 失败，写入目标失败`)
        }
        return handler
    }
    //rename 重命名自身，使用基类方法
    //override async rename() {}
    //mv 移动节点自身，使用基类方法
    //override async mv() {}
    //unlink 删除自身，使用基类方法
    //override async unlink() {}
    //rmdir 清空目录
    //!! 仅针对自身节点：删除自身，且目录必须为空
    override async rmdir(callCtx?: DvFsCallContext): Promise<boolean> {
        //operatable
        if (!this.isInodeOperatable(callCtx)) {
            return this._krError(`无法重命名 ${this.ipath}，当前文件无操作权限`)
        }
        //目录必须为空
        if (!this.isEmpty()) return this._krError(`无法删除目录 ${this.ipath}，目录不为空`)
        //!! 通过父节点执行
        const parent = this.parentHandler<'DvDirInode'>(callCtx)
        if (!parent) return false
        return parent.unlinkChild(useDvFsIpath().last(this.ipath), callCtx)
    }
}
