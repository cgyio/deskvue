/**
 * Deskvue kernel
 * Deskvue Fs 文件系统，模拟 Linux 文件系统的一些行为
 * 定义文件节点 handler 句柄类 Dv***Inode
 *
 * 定义标准 mime 文件类型节点的句柄类 DvMimeRegInode
 *
 */

import { DvRegInode } from './dv-reg'
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

export class DvMimeRegInode extends DvRegInode {}
