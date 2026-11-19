/**
 * Deskvue kernel
 * 针对 reg+ext 类型节点，后缀名 *.conf 的文件的 特殊读写方法
 *
 * 后缀 *.conf 文件 是 系统设置 在 内存树中的保存节点
 * 有自己的 read|write 方法
 *
 * !! 分别保存在 /sys/config.conf 和 /user/config.conf 两个节点中
 * !! 需要根据用户是否登录，来决定是否要返回合并后的 系统设置
 *
 * !! 权鉴由外层的 句柄类处理，此处只定义 特有操作
 */

import { type DvInodeHandler } from '../index'
import type { DvFsRegInodeReadOptions, DvFsCallContext } from '../types'
import { useDvFsCallCtx } from '../utils'
import { dvConfig, type DvConfigDefine } from '../../config'
import { dvIs, dvExtend, dvJsonCopy, dvWait } from '@/utils'

export const useDvExtConf = (handler: DvInodeHandler<'DvExtRegInode'>) => {
    //readSync
    //!! config 文件内容在构建内存树时，自动读取内容到 _icache_.content
    const readSync = (
        opts?: DvFsRegInodeReadOptions,
        callCtx?: DvFsCallContext,
    ): PlainObject | undefined => {
        const ipath = handler.ipath
        //针对 /sys/config 节点，可能需要合并用户设置
        if (ipath === '/sys/config') {
            const conf = dvJsonCopy(handler.inode._icache_.content ?? dvConfig) as DvConfigDefine
            const gdk = globalThis.DvKernel
            if (gdk?.stage && gdk.stage.stageBefore('is-login')) return conf
            //登录后，需要合并用户设置
            const uconfHdl = gdk.sysCall.call(
                callCtx,
                'fs:$',
                '/user/config',
            ) as DvInodeHandler<'DvExtRegInode'>
            if (!uconfHdl) return conf
            const uconf = uconfHdl.readSync({}, callCtx) as Partial<DvConfigDefine>
            if (!uconf) return conf
            return dvExtend<DvConfigDefine>(false, conf, uconf)
        }

        //针对 /user/config 节点，直接返回读取到的用户设置数据
        else if (ipath === '/user/config') {
            return handler.inode._icache_.content as Partial<DvConfigDefine>
        }

        //针对其他后缀名为 *.conf 的此类型文件，直接返回内容
        else {
            return handler.inode._icache_.content as PlainObject
        }
    }

    //write
    //使用 DvExtRegInode 节点默认 write 方法

    return {
        readSync,
    }
}
