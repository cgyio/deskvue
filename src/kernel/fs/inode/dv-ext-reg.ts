/**
 * Deskvue kernel
 * Deskvue Fs 文件系统，模拟 Linux 文件系统的一些行为
 * 定义文件节点 handler 句柄类 Dv***Inode
 *
 * 定义 Deskvue 自有后缀名体系的 普通文件类型节点 句柄类 DvExtRegInode
 *      这类文件以 json对象 形式直接保存在 dvHdd.fs.[ipath]._content_ 中
 *      运行时由处理程序读取，程序内部 文件内容 缓存在哪里由程序决定
 *      !! 但是如果要修改文件内容，程序在保存之前一定要将修改后的文件内容放到：
 *      !!      此文件的 内存映射节点的 inode._icache_.content 中
 *      !!      后续刷盘时，将根据 _icache_.content 中的内容来修改磁盘中的 _content_
 *
 * !! 为了确保上面这条约定不被绕过，本句柄的 read 返回的是内容的深拷贝，
 * !!    程序不能通过直接修改返回值来改文件内容，必须调用 write 写回
 */

import { DvRegInode } from './dv-reg'
import {
    type DvFsInodeAuth,
    type DvFsCallContext,
    type DvFsRegInodeReadOptions,
    type DvFsRegInodeWriteOptions,
} from '../types'
import { dvMimes } from '../mime'
import { useDvFsAc, type DvFsAcHook, type DvFsAcFn } from '../utils'
import { useDvHddStore, type DvHddStore } from '../stores'
import { dvIs, dvWait, dvJsonCopy, dvExtend } from '@utils/core'

export class DvExtRegInode extends DvRegInode {
    //实例化 DvFsAcHook 注入此文件节点类型 自有的 特殊权鉴方法
    //!! ext 节点的 op-key 是 reg:ext:op，父类注册的 reg:op 不会命中，必须自己注册
    protected override _getFsAcHook(): DvFsAcHook {
        return useDvFsAc((r: DvFsAcFn, w: DvFsAcFn, _x: DvFsAcFn): Record<string, DvFsAcFn> => {
            return {
                //读取内容：需要 读 权限
                'reg:ext:read': (a: DvFsInodeAuth) => r(a),
                //写入内容：需要 写 权限
                'reg:ext:write': (a: DvFsInodeAuth) => w(a),
                //清空内容：需要 写 权限
                'reg:ext:truncate': (a: DvFsInodeAuth) => w(a),
            }
        })
    }

    //根据 此 reg+ext 类型节点的 后缀名，查找可能存在的 特殊操作 hook
    private _getExtHook = (): PlainObject | undefined => {
        let mime = this.inode._inode_.extra?.mime
        if (!mime) return undefined
        if (mime.startsWith('*.')) {
            mime = `ext/${mime.slice(2)}`
        } else {
            mime = `ext/${mime}`
        }
        //支持的 后缀名 hook
        const hookGetter = dvMimes?.[mime]
        if (!hookGetter) return undefined
        //返回 hook 实例
        return hookGetter(this)
    }

    //读取：返回 json 内容（深拷贝）
    //!! 脏标记为 1 时优先读运行时缓存，否则以磁盘数据为准
    //!! 父类签名是 Promise<string>，这里内容类型不同，显式用 any 兼容
    override async read(opts?: DvFsRegInodeReadOptions, callCtx?: DvFsCallContext): Promise<any> {
        //读取需要 读 权限
        if (!this.ac('read', callCtx)) return this._acDenied('read')

        //!! 优先使用 特殊后缀名文件的 特殊 read 方法
        const hook = this._getExtHook()
        if (hook && typeof hook.read === 'function') {
            return await hook.read(opts, callCtx)
        }

        //!! 复用同步读方法
        return this.readSync(opts, callCtx)
    }
    //同步 read
    override readSync(opts?: DvFsRegInodeReadOptions, callCtx?: DvFsCallContext): any {
        //读取需要 读 权限
        if (!this.ac('read', callCtx)) return this._acDenied('read')

        //!! 优先使用 特殊后缀名文件的 特殊 read 方法
        const hook = this._getExtHook()
        if (hook && typeof hook.readSync === 'function') {
            return hook.readSync(opts, callCtx)
        }

        //要输出的内容
        let content: PlainObject = {}

        //先检查 脏标记
        if (this.inode._inode_.modi === 1) {
            //优先从 缓存读取
            const cached = this.inode._icache_?.content
            if (!dvIs.plainObject(cached)) return {}
            content = dvJsonCopy(cached)
        }

        //从 dvHdd 读文件内容
        else {
            const fnode = useDvHddStore().addr(this.ipath)
            if (!fnode || !fnode._content_) return this._krError(`文件 ${this.ipath} 不存在`)
            if (!dvIs.plainObject(fnode._content_)) {
                return this._krError(`文件 ${this.ipath} 内容不是有效的 json 对象`)
            }
            content = dvJsonCopy(fnode._content_ as PlainObject)
        }

        //根据额外参数，输出文件内容
        if (!dvIs.nemobj(content)) return {}
        //仅输出指定的 key
        if (opts?.keys !== undefined && opts.keys.length > 0) {
            const cnt: PlainObject = {}
            for (const key of opts.keys) {
                if (content?.[key] !== undefined) {
                    cnt[key] = content[key]
                }
            }
            content = cnt
        }
        //输出 json 字符串
        if (opts?.stringify === true) {
            return JSON.stringify(content)
        }
        //默认
        return content
    }

    //写入：接受 json 对象，或 json 字符串
    //!! 内容写入 _icache_.content，刷盘时由内核写入 dvHdd
    //!! opts.immediate 标记，立即落盘
    override async write(
        content: string | PlainObject,
        opts?: DvFsRegInodeWriteOptions,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> {
        //写入需要 写 权限
        if (!this.ac('write', callCtx)) return this._acDenied('write')

        //!! 优先使用 特殊后缀名文件的 特殊 write 方法
        const hook = this._getExtHook()
        if (hook && typeof hook.write === 'function') {
            return await hook.write(content, opts, callCtx)
        }

        //字符串按 json 解析
        let cnt: any = content
        if (dvIs.string(content)) {
            if (!dvIs.json(content)) return false
            try {
                cnt = JSON.parse(content as string)
            } catch (e) {
                return false
            }
        }
        //ext 类型只接受 json 对象
        if (!dvIs.plainObject(cnt)) return false

        //深拷贝 + 校验可序列化
        let copy = dvJsonCopy(cnt as PlainObject)
        if (!copy) return false

        //如果额外参数指定使用 extend 方法
        if (opts?.extend === true) {
            copy = dvExtend<PlainObject>(
                false,
                {},
                (this.inode._icache_?.content ?? {}) as PlainObject,
                copy,
            )
        }

        //先标脏（失败则不写入，避免出现「有缓存但无脏标记」的不一致状态）
        if (this._setTimestamp('m', undefined, callCtx) !== true) return false
        if (!this.inode._icache_) this.inode._icache_ = { handler: null }
        this.inode._icache_.content = copy

        //标记立即落盘
        if (opts?.immediate !== true) return true
        return await this.fsync(callCtx)
    }

    //清空：ext 内容是 json 对象，不支持按长度截断，只支持 truncate(0) 清空为 {}
    override async truncate(size: number = 0, callCtx?: DvFsCallContext): Promise<boolean> {
        //清空需要 写 权限
        if (!this.ac('truncate', callCtx)) return this._acDenied('truncate')

        //!! 优先使用 特殊后缀名文件的 特殊 fsync 方法
        const hook = this._getExtHook()
        if (hook && typeof hook.truncate === 'function') {
            return await hook.truncate(size, callCtx)
        }

        //size 必须是 >= 0 的数字
        if (!dvIs.number(size) || size < 0) return false
        //非 0 截断对 json 对象没有意义
        if (Math.floor(size) !== 0) return this._unSupport('truncate')

        //先标脏
        if (this._setTimestamp('m', undefined, callCtx) !== true) return false
        if (!this.inode._icache_) this.inode._icache_ = { handler: null }
        this.inode._icache_.content = {}
        await dvWait(10)
        return true
    }

    //刷盘：需要适配特殊后缀名文件的 特殊刷盘方法
    protected override async _doFsync(
        dvHdd: DvHddStore,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> {
        //!! 优先使用 特殊后缀名文件的 特殊 fsync 方法
        const hook = this._getExtHook()
        if (hook && typeof hook.fsync === 'function') {
            return await hook.fsync(dvHdd, callCtx)
        }

        //默认使用 dvHdd.fsync 方法
        return await dvHdd.fsync(this.inode)
    }
}
