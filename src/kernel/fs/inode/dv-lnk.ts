/**
 * Deskvue kernel
 * Deskvue Fs 文件系统，模拟 Linux 文件系统的一些行为
 * 定义 文件节点 handler 句柄类 Dv***Inode
 *
 * 定义符号链接节点类型句柄类 DvLnkInode
 * 这类文件的 _content_ 中只保存 连接到的 其他节点的 ipath
 * 文件句柄的所有相应方法，只通过 ipath 透传到目标节点上
 *
 * !! 链接目标保存在 运行时 _icache_.content 中，未加载到内存时从 dvHdd 的 _content_ 读取
 * !! 目标可以是相对路径，相对 符号链接自身所在的目录 解析
 * !! 支持 链接指向链接 的链式解析，并做循环引用检测
 * !! rename|mv|unlink|rmdir 作用于 符号链接节点自身，不转发到目标
 * !! fsync 不转发：符号链接自身的持久化内容就是 目标 ipath
 */

import { type ComputedRef } from 'vue'
import { DvInode } from './dv-inode'
import { useDvInodeHandler } from './index'
import { type DvFsCallContext, type DvFsHddStruct, type DvFsInodeMemStruct } from '../types'
import { useDvFsIpath } from '../utils'
import { useDvHddStore, type DvHddStore } from '../stores'
import { dvIs } from '@utils/core'

//链式符号链接 最大解析层级，超过则认为存在循环引用
const DV_LNK_MAX_HOPS = 16

export class DvLnkInode extends DvInode {
    //读取链接的目标 ipath（原始值，可能是相对路径）
    //!! 优先 运行时缓存（已修改未刷盘），否则读磁盘
    protected _targetIpath(): string | undefined {
        const cached = this.inode._icache_?.content
        if (dvIs.nemstr(cached)) return cached as string

        const content = useDvHddStore().addr(this.ipath)?._content_
        if (dvIs.nemstr(content)) return content as string
        return undefined
    }

    //将目标路径转换为 绝对 ipath
    //!! 相对路径基于 符号链接所在目录 解析
    protected _normTarget(target: string): string {
        const ipu = useDvFsIpath()
        if (target.startsWith('/')) return ipu.norm(target)
        return ipu.join(ipu.parent(this.ipath), target)
    }

    //解析目标节点，返回 最终目标的 句柄实例（一定不是 lnk）
    //!! 链式链接逐级解析，同时检测循环引用
    protected _targetHandler(callCtx?: DvFsCallContext): DvInode | undefined {
        let link: DvLnkInode = this
        const seen: string[] = [this.ipath]

        for (let i = 0; i < DV_LNK_MAX_HOPS; i++) {
            const raw = link._targetIpath()
            if (!raw) {
                return this._krError(`符号链接 ${link.ipath} 未指定目标节点`)
            }
            const tpath = link._normTarget(raw)
            //循环引用检测
            if (seen.includes(tpath)) {
                return this._krError(`符号链接 ${this.ipath} 存在循环引用 ${tpath}`)
            }
            seen.push(tpath)

            const handler = useDvInodeHandler(tpath, callCtx)?.handler
            if (!handler) {
                return this._krError(`符号链接 ${this.ipath} 的目标节点 ${tpath} 不存在`)
            }
            //目标仍然是符号链接，继续解析
            if (handler instanceof DvLnkInode) {
                link = handler
                continue
            }
            return handler
        }
        return this._krError(`符号链接 ${this.ipath} 解析层级过深，可能存在循环引用`)
    }

    //转发操作到 目标节点的句柄实例
    //!! callCtx 仅用于解析目标句柄，args 是目标方法自身的参数（其中已经包含 callCtx）
    //!! 目标节点不支持该方法时，抛出 OOPS 内核错误
    protected _forward<T = any>(
        method: string,
        callCtx: DvFsCallContext | undefined,
        ...args: any[]
    ): T {
        const target = this._targetHandler(callCtx)
        if (!target) return undefined as T
        const fn = (target as any)[method]
        if (typeof fn !== 'function') return this._unSupport(method)
        return fn.apply(target, args) as T
    }

    //符号链接自身的 目标操作

    //读取目标 ipath（解析为绝对路径；链式链接只解析一层）
    readlink(): string | undefined {
        const raw = this._targetIpath()
        if (!raw) return undefined
        return this._normTarget(raw)
    }

    //设置目标 ipath，支持绝对路径或相对路径
    settarget(target: string, callCtx?: DvFsCallContext): boolean {
        if (!dvIs.nemstr(target)) return false
        //先标脏，失败则不写入
        if (this._setTimestamp('m', undefined, callCtx) !== true) return false
        if (!this.inode._icache_) this.inode._icache_ = { handler: null }
        this.inode._icache_.content = (target as string).trim()
        return true
    }

    //file_operations 转发

    override async open(callCtx?: DvFsCallContext): Promise<any> {
        return this._forward('open', callCtx, callCtx)
    }
    override async release(callCtx?: DvFsCallContext): Promise<any> {
        return this._forward('release', callCtx, callCtx)
    }
    override async read(callCtx?: DvFsCallContext): Promise<any> {
        return this._forward('read', callCtx, callCtx)
    }
    override async write(
        content?: any,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<any> {
        return this._forward('write', callCtx, content, opts, callCtx)
    }
    //truncate 不在基类中定义，与 DvRegInode|DvExtRegInode 保持相同签名
    truncate(size: number = 0, callCtx?: DvFsCallContext): boolean {
        return this._forward('truncate', callCtx, size, callCtx)
    }

    //inode_operations 转发

    override getattr(callCtx?: DvFsCallContext): ComputedRef<DvFsInodeMemStruct | undefined> {
        return this._forward('getattr', callCtx, callCtx)
    }
    override setattr(attr: PlainObject, callCtx?: DvFsCallContext): DvInode | undefined {
        return this._forward('setattr', callCtx, attr, callCtx)
    }
    override settime(
        key: 'a' | 'c' | 'm' | 'd',
        timestamp?: number,
        callCtx?: DvFsCallContext,
    ): boolean {
        return this._forward('settime', callCtx, key, timestamp, callCtx)
    }
    override setopener(callCtx?: DvFsCallContext): boolean {
        return this._forward('setopener', callCtx, callCtx)
    }
    override delopener(callCtx?: DvFsCallContext): boolean {
        return this._forward('delopener', callCtx, callCtx)
    }

    override lookup(ipath: string, opts?: PlainObject, callCtx?: DvFsCallContext): any {
        return this._forward('lookup', callCtx, ipath, opts, callCtx)
    }
    override async mkdir(ipath: string, opts?: PlainObject, callCtx?: DvFsCallContext): Promise<any> {
        return this._forward('mkdir', callCtx, ipath, opts, callCtx)
    }
    override async create(ipath: string, opts?: PlainObject, callCtx?: DvFsCallContext): Promise<any> {
        return this._forward('create', callCtx, ipath, opts, callCtx)
    }
    override async symlink(
        ipath: string,
        opts?: PlainObject,
        callCtx?: DvFsCallContext,
    ): Promise<any> {
        return this._forward('symlink', callCtx, ipath, opts, callCtx)
    }
    //!! rename|mv|unlink|rmdir 不转发，使用基类实现，作用于 符号链接节点自身

    //刷磁盘：符号链接节点自身的持久化，不转发
    //!! 磁盘中的 _content_ 保存的就是 目标 ipath

    protected override async _getFsyncContent?(
        callCtx?: DvFsCallContext,
    ): Promise<DvFsHddStruct | undefined> {
        //没有目标节点时 不持久化
        if (!this._targetIpath()) return undefined
        return useDvHddStore().toHddStruct(this.inode)
    }
    protected override async _doFsync?(
        content: DvFsHddStruct,
        dvHdd: DvHddStore,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> {
        return await dvHdd.fsync(this.ipath, content)
    }
}
