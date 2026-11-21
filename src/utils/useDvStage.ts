/**
 * Deskvue hook
 * 单向线性 stage 通用工具
 *
 * !! 使用时需要传入 stage[] 序列，定义并传入 (typeof stage[])[number] 类型：
 *      const stages = [...] as const
 *      type StageType = (typeof stages)[number]
 *      const stageHook = useDvStage<StageType>({
 *          queue: stages,
 *          title: { 各 stage 的可理解标题... },
 *          !! 自定义判断函数
 *          isError: (queue, stage) => boolean,
 *          !! 自定义 onChange 钩子
 *          onChange: (from, to, queue) => any
 *      })
 *      !! 响应式 stage 状态：stageHook.stage.value
 *      !! stage 流转：stageHook.stageTo() | .stageNext()
 *      !! 响应式判断：stageHook.stageAfter() | .stageBetween() ..
 *
 * 主要用于 Deskvue 内核本身的 以及 DvOs 根组件内部的 stage 状态流转
 * !! 其他需要单向线性 stage 状态的组件可自行引用
 */

import { ref, computed, readonly, watch } from 'vue'

//stage 状态判断函数类型
export type DvStagePendingFn<T extends string> = (queue: T[], stage: T, ...args: any[]) => boolean
//需要调用者传入的 stage[] 序列的参数结构
export interface DvStageOption<T extends string> {
    queue: T[]
    title?: Record<T, string>
    //可以自定义 stage 判断函数
    isStart?: DvStagePendingFn<T>
    isFinished?: DvStagePendingFn<T>
    isLocked?: DvStagePendingFn<T>
    isError?: DvStagePendingFn<T>
    //stage 状态变化钩子函数
    onChange?: (from: T, to: T, queue: T[]) => any
    [K: string]: any
}

export const useDvStage = <T extends string>(opts: DvStageOption<T>) => {
    const queue = opts.queue
    const title = opts.title

    //stage 响应式数据，默认初始状态为 stage[] 序列的第一个
    const stage = ref<T>(opts.queue[0] as T)
    //外部只读
    const _stage = readonly(stage)
    //onChange 钩子放到 watch 中，不再通过 stageTo
    watch(stage, (nv, ov) => {
        if (opts.onChange) {
            opts.onChange(ov, nv, queue)
        }
    })

    //stage idx
    const stageIdx = computed<number>((): number => queue.indexOf(stage.value))
    //当前 stage 提示语
    const stageTitle = computed<string>((): string => title?.[stage.value as T] ?? stage.value)
    //stage 序列已开始
    const stageIsStart = computed<boolean>(() => {
        if (opts.isStart) return opts.isStart(queue, stage.value)
        //默认判断
        return stageIdx.value >= 0
    })
    //stage 序列已完成
    const stageIsFinished = computed<boolean>(() => {
        if (opts.isFinished) return opts.isFinished(queue, stage.value)
        //默认判断
        return stageIdx.value >= queue.length - 1
    })
    //处于 error stage
    const stageIsError = computed<boolean>((): boolean => {
        if (opts.isError) return opts.isError(queue, stage.value)
        //默认判断
        return stage.value.endsWith('-error')
    })
    //stage 状态锁定，不允许再次修改
    const stageIsLocked = computed<boolean>((): boolean => {
        if (opts.isLocked) return opts.isLocked(queue, stage.value)
        //默认判断
        return stageIsFinished.value === true || stageIsError.value === true
    })
    //设置 stage
    const stageTo = (to: T): void => {
        //锁定后，禁止修改 stage
        if (stageIsLocked.value === true) return
        //无变化
        if (to === stage.value) return
        //原状态
        //const from = stage.value
        //设置
        stage.value = to
        //onChange 钩子
        //if (opts.onChange) opts.onChange(from, to, queue)
    }
    //stage 向后跳转
    const stageNext = (skipError: boolean = false): void => {
        let to = queue?.[stageIdx.value + 1]
        if (!to) return

        //!! 跳过 *-error 标记，使用 next 方法可以跳过错误阶段
        if (skipError) {
            //如果 to 是 *-error 阶段标记，则继续跳转下一个
            if (to.endsWith('-error')) {
                let i = 2
                to = queue?.[stageIdx.value + i]
                while (!to || to.endsWith('-error') === true) {
                    i++
                    if (stageIdx.value + i >= queue.length - 1) break
                    to = queue?.[stageIdx.value + i]
                }
            }
            if (!!to) stageTo(to)
        }

        //直接 next
        else {
            stageTo(to)
        }
    }
    //stage 判断
    const stageIs = (...stages: T[]): boolean => stages.includes(stage.value)
    //after 或 before，edge === true 表示包含边界
    const stageAfter = (st: T, edge: boolean = false): boolean => {
        const idx = queue.indexOf(st)
        if (idx < 0) return false
        return edge === true ? stageIdx.value >= idx : stageIdx.value > idx
    }
    const stageBefore = (st: T, edge: boolean = false): boolean => {
        const idx = queue.indexOf(st)
        if (idx < 0) return false
        return edge === true ? stageIdx.value <= idx : stageIdx.value < idx
    }
    //between，edge === true 表示包含边界
    const stageBetween = (stageA: T, stageB: T, edge: boolean = false): boolean => {
        const idxa = queue.indexOf(stageA)
        const idxb = queue.indexOf(stageB)
        if (idxa < 0 || idxb < 0 || idxa === idxb) return false
        const idxs: [number, number] = idxb > idxa ? [idxa, idxb] : [idxb, idxa]
        if (edge === true) {
            return stageIdx.value >= idxs[0] && stageIdx.value <= idxs[1]
        }
        return stageIdx.value > idxs[0] && stageIdx.value < idxs[1]
    }
    //outside，edge === true 表示包含边界
    const stageOutside = (stageA: T, stageB: T, edge: boolean = false): boolean => {
        const idxa = queue.indexOf(stageA)
        const idxb = queue.indexOf(stageB)
        if (idxa < 0 || idxb < 0 || idxa === idxb) return false
        return !stageBetween(stageA, stageB, !edge)
    }

    return {
        stage: _stage,

        stageIdx,
        stageTitle,
        stageIsStart,
        stageIsFinished,
        stageIsError,
        stageIsLocked,

        stageTo,
        stageNext,

        stageIs,
        stageAfter,
        stageBefore,
        stageBetween,
        stageOutside,
    }
}

//stage 工具类型
export type DvStageHook<T extends string> = ReturnType<typeof useDvStage<T>>
