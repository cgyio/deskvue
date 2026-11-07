/**
 * Deskvue kernel
 * Request 请求处理
 */

//import { useDvKernelStore } from '@kernel/store'

/**
 * !! 每个 Deskvue kernel 内核模块都必须定义的 启动方法
 * !! 在内核启动时，会依次调用这些方法
 * request 内核启动方法
 */
export const start = (): boolean => {
    return true
}

/**
 * request utils
 */

//导出 框架默认接口定义
export { spfApis as dvDefaultApis } from './spf-apis'

//导出 框架接口类型
export type * from './types'
