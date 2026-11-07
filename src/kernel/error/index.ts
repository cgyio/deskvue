/**
 * Deskvue kernel
 * 全局统一的错误处理方法
 */

import { canIgnoreError } from './ignore'
import { DvKernelError } from './kernel-error'
import { DvHttpError } from './http-error'
import { DvBusinessError } from './business-error'
//import { useDvService } from '@/components'
import { dvIs } from '@utils/core'

//全局错误处理方法
const dvHandleGlobalError = (err: unknown, type: string): void => {
    //调用 dvWinService 窗口服务
    //const dvWinService = useDvService('win')

    if (err instanceof DvKernelError) {
        console.error(`${type} [DvKernelError] >>> `, err)
        //先弹窗
        //if (dvWinService) {
        //    dvWinService.error(err.message, `发生内核错误：${err.message}`)
        //}
        //后 confirm
        //调用 自定义 handler
        err.handle()
    }

    //http 请求响应错误
    else if (err instanceof DvHttpError) {
        //if (dvWinService) {
        //    dvWinService.error(err.message, `网络请求发生错误：${err.status}`)
        //}
        console.error(`${type} [DvHttpError] >>> `, err)
    }

    //业务错误
    else if (err instanceof DvBusinessError) {
        //业务错误 弹窗参数
        const alertProps = err.alertProps()
        //console.log(alertProps)
        //if (dvWinService && err.silence !== true) {
        //如果是静默错误，则不显示错误弹窗(通常在运行时请求api返回未登录错误时)
        //    dvWinService.error(alertProps.msg, alertProps.title, alertProps.props)
        //}
        console.error(`${type} [DvBusinessError] >>> `, err)
        if (alertProps.trace.length > 0) {
            console.error(`${type} [DvBusinessError] >>> trace`, alertProps.trace)
        }
        //调用 自定义 handler
        err.handle()
    }

    //默认错误
    else {
        const eo = err as Error
        //if (dvWinService) {
        //    dvWinService.error(eo?.message ?? '未知错误')
        //}
        console.error(`${type} >>> `, err)
    }
}

//注册全局错误事件处理
export const setupDvGlobalErrorHandler = (): void => {
    //捕获所有 同步代码错误 throw error
    window.addEventListener('error', (e: ErrorEvent) => {
        //阻止默认操作
        e.preventDefault()
        //console.log(e)
        const err = e.error ?? new Error(e.message)

        //忽略错误
        if (canIgnoreError(err)) {
            return e.stopImmediatePropagation()
        }

        dvHandleGlobalError(err, 'DvSyncError')
    })

    //捕获所有 Promise 未捕获错误 fetch await
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
        //阻止默认操作
        e.preventDefault()
        //console.log('async catch error', e)
        const err = e.reason

        //忽略错误
        if (canIgnoreError(err)) {
            return e.stopImmediatePropagation()
        }

        dvHandleGlobalError(err, 'DvAsyncError')
    })

    //增加 globalThis.triggerError 方法，代替 throw new Error
    //!! 当 abort != true 可以指定一个 returnValue 返回值
    globalThis.dvTriggerError = (
        err: Error,
        abort: boolean = false,
        returnValue?: any,
    ): void | typeof returnValue => {
        //调用错误处理函数
        dvHandleGlobalError(err, 'DvTriggered')

        //!! 内核错误，level === PANIC 默认终止后续
        const kernelError = err instanceof DvKernelError && err.level === 'PANIC'
        abort =
            abort ||
            /*!(err instanceof DvBusinessError) ||*/
            kernelError

        if (abort) {
            throw kernelError ? 'Deskvue Kernel Panic !!' : 'Deskvue Abort !!'
        } else {
            return returnValue
        }
    }
}

//自定义错误类型
export * from './kernel-error'
export * from './http-error'
export * from './business-error'

//导出 TS 类型
//export type { DvKernelError } from './kernel-error'
//export type { DvHttpError } from './http-error'
//export type { DvBusinessError } from './business-error'
