/**
 * Deskvue kernel
 * 专门处理 program 运行时的 pid 全局唯一的进程 id
 * !! 此工具不执行权鉴操作，无副作用，仅作为纯工具使用
 */

import { useDvMemStore } from '../stores'
import type { DvFsMemStruct } from '../types'
import { dvKabab } from '@utils/core'
import { md5 } from 'js-md5'

export const useDvFsPid = () => {
    //内存接口
    const dvMem = useDvMemStore()

    //创建全局唯一 pid
    const createPid = (ipath: string, props?: PlainObject): string | undefined => {
        //读取 programMeta 定义数据
        const meta = dvMem.programMeta(ipath)
        if (!meta) return undefined
        //组装 pid
        const pida: string[] = ['prog']
        //组件名
        pida.push(meta.name)
        //组件 props MD5
        pida.push(md5(JSON.stringify(props ?? {})))
        //返回 pid
        return pida.join('_')
    }

    return {
        createPid,
    }
}
