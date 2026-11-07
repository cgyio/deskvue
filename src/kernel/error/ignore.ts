/**
 * Deskvue 全局错误处理
 * 需要忽略的错误
 */

//!! 这些错误信息会被忽略
const ignoreErrors = ['ResizeObserver loop completed with undelivered notifications.']

//判断错误需要被忽略
export const canIgnoreError = (e: Error | string): boolean => {
    const msg = typeof e === 'string' ? e : (e.message ?? null)
    if (!msg) return false
    for (const i of ignoreErrors) {
        if (msg.includes(i)) return true
    }
    return false
}
