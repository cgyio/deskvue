/**
 * Deskvue 自定义错误类型
 * DvHttpError 请求响应错误
 */

export interface DvHttpErrorOption {
    status: number
    url?: string
    cause?: unknown
}

export class DvHttpError extends Error {
    // 额外字段
    status: number
    url?: string
    cause?: unknown

    constructor(message: string, options?: DvHttpErrorOption) {
        const cause = options?.cause ? options.cause : 'fetch error'
        super(message, { cause })
        this.name = 'DvHttpError'
        this.status = options?.status ?? 0
        this.url = options?.url ?? ''
    }
}
