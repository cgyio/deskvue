/**
 * Deskvue kernel
 * 针对 reg+ext 类型节点，后缀名 *.buffer 的文件的 特殊读写方法
 *
 * 后缀 *.buffer 文件 是 系统 ioBuffer 输入输出缓冲区在 内存树中的保存节点
 * 有自己的 read|write|truncate 方法
 *
 * !! 权鉴由外层的 句柄类处理，此处只定义 特有操作
 */

import { type DvInodeHandler } from '../index'
import type { DvFsCallContext, DvFsRegInodeReadOptions, DvFsRegInodeWriteOptions } from '../types'
import { type DvIoBuffer, type DvIoInputRow, type DvIoOutputRow } from '../../os/utils'
import { dvIs, dvExtend, dvJsonCopy, dvWait } from '@/utils'

export const useDvExtBuffer = (handler: DvInodeHandler<'DvExtRegInode'>) => {
    //readSync 同步读
    const readSync = (opts?: DvFsRegInodeReadOptions, callCtx?: DvFsCallContext): DvIoBuffer => {
        //!! 返回拷贝
        return dvJsonCopy(handler.inode._icache_.buffer ?? []) as DvIoBuffer
    }

    //write
    //!! 输入输出缓冲区仅存在于内存中，不会刷盘，因此不打脏标记，不会被刷盘
    const write = async (
        content: DvIoBuffer | DvIoInputRow | DvIoOutputRow,
        opts?: DvFsRegInodeWriteOptions,
        callCtx?: DvFsCallContext,
    ): Promise<boolean> => {
        //写入内存
        if (
            handler.inode._icache_.buffer === undefined ||
            !dvIs.array(handler.inode._icache_.buffer)
        ) {
            handler.inode._icache_.buffer = []
        }
        const buffer = handler.inode._icache_.buffer as DvIoBuffer
        //!! opts.extend === true 表示在最后一行追加
        if (opts?.extend === true) {
            if (dvIs.nemobj(content)) {
                const idx = buffer.length - 1
                if (idx < 0) return false
                buffer[idx] = dvExtend<DvIoInputRow | DvIoOutputRow>(
                    false,
                    {},
                    buffer[idx],
                    content,
                )
                await dvWait(10)
                return true
            }
            return false
        }
        //新增行 或 覆盖
        else {
            //传入单行参数 DvIoInputRow | DvIoOutputRow 则新增行
            if (dvIs.nemobj(content)) {
                buffer.push(content as DvIoInputRow | DvIoOutputRow)
            }
            //传入完整的 DvIoBuffer 则覆盖
            else {
                handler.inode._icache_.buffer = content
            }
            await dvWait(10)
            return true
        }
    }

    //truncate
    //!! 外部的 cli 服务根据 maxRows 截断 DvIoBuffer 数组
    const truncate = async (size: number, callCtx?: DvFsCallContext): Promise<boolean> => {
        const buffer = handler.inode._icache_.buffer as DvIoBuffer
        if (buffer.length <= size) return true
        //从 尾部 向前 截断
        handler.inode._icache_.buffer = buffer.slice(size * -1)
        return true
    }

    return {
        readSync,
        write,
        truncate,
    }
}
