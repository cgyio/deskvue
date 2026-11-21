/**
 * Deskvue kernel
 * 由 prog0 调用的 FS 刷盘调度器
 * !! 只能是 /sys/prog0 调用
 */

import { ref, computed, watch, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
//import { DvKernelError } from '../../error'
import {
    useDvMemStore,
    useDvInodeHandler,
    useDvFsIpath,
    type DvFsProgramMeta,
    type DvInodeHandler,
    type DvProcess,
} from '../../fs'
import { type DvProgramHookGetter } from './index'
import { dvIs, dvExtend, dvCopy, dvWait } from '@/utils'

//刷盘定时器
let intervalFlusher: ReturnType<typeof setInterval> | null = null

export const useDvFlusher = <M extends PlainObject = PlainObject>(
    hookGetter: DvProgramHookGetter<M>,
) => {
    //!! 确保只有 /sys/prog0 可以调用此 hook
    const _isProg0 = (): boolean => {
        const hook = hookGetter()
        return hook.ipath.value === '/sys/prog0'
    }

    //单次刷盘流程 进行中标记
    const fsyncing = ref<boolean>(false)

    //单次刷盘
    const stdFsync = async (): Promise<void> => {
        if (!_isProg0()) return
        if (fsyncing.value === true) return
        const dvMem = useDvMemStore()
        //标记为 脏 的节点
        const { modiCache } = storeToRefs(dvMem)
        if (!modiCache.value || !dvIs.nemobj(modiCache.value)) {
            //!! 没有脏节点
            return
        }
        //开始单次刷盘
        fsyncing.value = true
        const callCtx = hookGetter().callCtx.value
        for (const ipath in modiCache.value) {
            //调用对应节点的句柄实例
            const handler = useDvInodeHandler(ipath, callCtx)?.handler
            if (!handler || !handler?.fsync) continue
            //!! 调用节点的 fsync 入口
            //!! 不管刷盘结果，节点 fsync 方法内部会自行处理 状态、锁
            await handler.fsync(callCtx)
        }
        fsyncing.value = false
    }

    //启动后台定时刷盘
    const startIntervalFlush = (timeGap: number = 30 * 1000): void => {
        intervalFlusher = setInterval(stdFsync, timeGap)
    }
    const stopIntervalFlush = (): void => {
        if (intervalFlusher !== null) {
            clearInterval(intervalFlusher)
            intervalFlusher = null
        }
    }

    return {
        startIntervalFlush,
        stopIntervalFlush,
    }
}
