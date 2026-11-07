/**
 * Deskvue 自定义错误类型
 * DvBusinessError 业务错误
 * 适配 Spf 后端框架
 */

import type { DvApiErrorReturn } from '@/types/apis'
import { dvIs } from '@utils/core'

export interface DvBusinessErrorManualOption {
    code?: string | number
    title?: string
    url?: string
    cause?: unknown
}
export type DvBusinessErrorOption = DvBusinessErrorManualOption | DvApiErrorReturn
export type DvBusinessErrorCustomHandler = () => void

//判断一个对象是否 DvApiErrorReturn 类型
const isDvApiErrorReturn = (o: unknown): boolean => {
    if (!o) return false
    const oo = o as DvApiErrorReturn
    return 'code' in oo && 'message' in oo && 'title' in oo
}

export class DvBusinessError extends Error {
    code: string | number
    title?: string
    url?: string
    cause?: unknown
    silence?: boolean

    //可以传入 customHandler
    customHandler?: DvBusinessErrorCustomHandler

    constructor(
        message: string,
        options?: DvBusinessErrorOption,
        customHandler?: DvBusinessErrorCustomHandler,
    ) {
        const cause = isDvApiErrorReturn(options)
            ? options
            : options && 'cause' in options
              ? options.cause
              : undefined
        super(message, { cause })
        this.name = 'DvBusinessError'
        this.code = options?.code ?? 'unknown'
        this.title = options?.title
        this.url = options?.url
        this.cause = cause
        this.silence = false

        if (typeof customHandler === 'function') {
            this.customHandler = customHandler
        }
    }

    //为业务错误增加自定义 handle 方法
    handle() {
        if (typeof this.customHandler === 'function') {
            this.customHandler()
        }
    }

    //业务错误弹出 error 错误信息，生成 弹窗参数
    alertProps(): { title: string; msg: string; trace: string[]; props: Record<string, any> } {
        const msgs: string[] = [] //[`<span>${this.message}</span>`]
        const traces = []
        const wrap = (str: string): string =>
            `<span class="dv-text-secondary text-xs">${str}</span>`

        //cause
        if (this.cause && dvIs.nemobj(this.cause)) {
            const cause = this.cause as Record<string, any>
            const file = cause?.file
            const line = cause?.line
            const trace = cause?.trace
            if (dvIs.defined(file) && dvIs.defined(line)) {
                msgs.push(`<span>${cause.message}</span>`)
                msgs.push('')
                msgs.push(wrap(`file: ${file}`))
                msgs.push(wrap(`line: ${line}`))
            }
            if (dvIs.array(trace) || dvIs.string(trace)) {
                //trace 输出到 console
                if (dvIs.array(trace)) {
                    for (const tri of trace) {
                        traces.push(tri)
                    }
                } else {
                    traces.push(trace)
                }
            }
        }

        return {
            msg: msgs.join('<br>'),
            title: this.title ?? '未知错误',
            trace: traces,
            props: {
                errorCode: this.code,
                msgAsHtml: true,
            },
        }
    }

    //是否静默错误，不弹出 error 错误信息
    silent(silence?: boolean): DvBusinessError {
        this.silence = dvIs.defined(silence) ? silence : true
        return this
    }
}
