/**
 * Deskvue kernel
 * Deskvue Fs 文件系统，模拟 Linux 文件系统的一些行为
 * 定义文件节点 handler 句柄类 Dv***Inode
 *
 * 定义普通文件类型节点的句柄类 DvRegInode
 * program 类型的节点句柄类 继承自此
 *
 * extra.type === '' 的普通文件节点类型，由此句柄处理
 * 按 纯字符文件来处理
 *
 * !! 纯文本文件的内容，运行时保存在 fnode._icache_.content 中
 * !! 持久化时由 _getFsyncContent() 生成 DvFsHddStruct 的 _content_
 */

import { DvInode } from './dv-inode'
import {
    type DvFsInodeAuth,
    type DvFsCallContext,
    type DvFsHddStruct,
    type DvFsRegInodeReadOptions,
    type DvFsRegInodeWriteOptions,
} from '../types'
import { useDvFsAc, type DvFsAcHook, type DvFsAcFn } from '../utils'
import { useDvHddStore, type DvHddStore } from '../stores'
import { dvIs, dvWait } from '@utils/core'

export class DvRegInode extends DvInode {
    //实例化 DvFsAcHook 注入此文件节点类型 自有的 特殊权鉴方法
    protected _getFsAcHook(): DvFsAcHook {
        return useDvFsAc((r: DvFsAcFn, w: DvFsAcFn, x: DvFsAcFn): Record<string, DvFsAcFn> => {
            return {
                //打开文件：需要 读 权限
                //'reg:open': (a: DvFsInodeAuth) => r(a),
                //读取内容：需要 读 权限
                'reg:read': (a: DvFsInodeAuth) => r(a),
                //写入内容：需要 写 权限
                'reg:write': (a: DvFsInodeAuth) => w(a),
                //截断内容：需要 写 权限
                'reg:truncate': (a: DvFsInodeAuth) => w(a),
            }
        })
    }

    //file_operations 针对文件内容的 操作函数列表

    //open 使用基类实现：校验权限 + 记录引用者
    //!! _onOpen 钩子：默认 只针对未指定 mime 和 后缀名的 普通文件，作为纯文本打开
    override async _onOpen(callCtx?: DvFsCallContext): Promise<any> {
        //!! 无需额外建立连接，纯文本文件直接读写即可
    }

    //读取：纯文本文件，内容保存在 dvHdd.[this.ipath]._content_ 中
    override async read(
        opts?: DvFsRegInodeReadOptions,
        callCtx?: DvFsCallContext,
    ): Promise<string> {
        //直接复用同步 read
        //!! reg 节点默认纯文本文件，可以同步读
        return this.readSync(opts, callCtx)
    }
    //!! 增加一个 同步 read，针对普通的静态文件
    //!! 方便外部组件内 computed 获取文件内容
    readSync(opts?: DvFsRegInodeReadOptions, callCtx?: DvFsCallContext): string {
        //读取需要 读 权限
        if (!this.ac('read', callCtx)) return this._acDenied('read')
        //纯文本内容
        let content: string = ''

        //先检查 脏标记
        if (this.inode._inode_.modi === 1) {
            //!! 优先从 缓存读取，注意 content 可能是空字符串 ''，不能用真值判断
            const cached = this.inode._icache_?.content
            if (!dvIs.string(cached)) return ''
            content = cached
        }

        //从 dvHdd 读文件内容
        else {
            const dvHdd = useDvHddStore()
            const fnode = dvHdd.addr(this.ipath)
            if (!fnode || !fnode._content_) return this._krError(`文件 ${this.ipath} 不存在`)
            if (typeof fnode._content_ !== 'string') return ''
            content = fnode._content_
        }

        //根据额外参数，输出
        if (content === '') return ''
        //输出指定长度
        if (opts?.size !== undefined && opts.size > 0) return content.slice(0, opts.size)
        //默认
        return content
    }

    //写入：纯文本文件，内容写入 _icache_.content 在刷盘时，由内核写入 dvHdd
    //!! opts.immediate 标记，立即落盘
    override async write(
        content: string,
        opts?: DvFsRegInodeWriteOptions,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> {
        //写入需要 写 权限
        if (!this.ac('write', callCtx)) return this._acDenied('write')
        //纯文本文件，仅接受字符串内容
        if (!dvIs.string(content)) return false
        if (!this.inode._icache_) this.inode._icache_ = { handler: null }
        this.inode._icache_.content = content
        //内容修改时间戳（m）+ 脏标记
        if (this._setTimestamp('m', undefined, callCtx) !== true) {
            return this._krError(`文件 ${this.ipath} 写入失败`)
        }
        //标记立即落盘
        if (opts?.immediate !== true) return true
        //等待脏标记 成功
        await dvWait(10)
        return await this.fsync(callCtx)
    }

    //截断：将文件内容截断到指定长度，默认 0 清空
    async truncate(size: number = 0, callCtx?: DvFsCallContext): Promise<boolean> {
        //截断需要 写 权限
        if (!this.ac('truncate', callCtx)) return this._acDenied('truncate')
        //size 必须是 >= 0 的数字
        if (!dvIs.number(size) || size < 0) return false
        const content = this.inode._icache_?.content
        const str = dvIs.string(content) ? (content as string) : ''
        if (!this.inode._icache_) this.inode._icache_ = { handler: null }
        this.inode._icache_.content = str.slice(0, Math.floor(size))
        //内容修改时间戳（m）+ 脏标记
        await dvWait(10)
        return this._setTimestamp('m', undefined, callCtx)
    }

    //刷磁盘具体方法
    //!! 默认 针对 纯文本文件
    //!! 使用 DvInode 默认的基类方法
    /*protected override async _doFsync(
        dvHdd: DvHddStore,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> {
        return await dvHdd.fsync(this.ipath)
    }*/
}
