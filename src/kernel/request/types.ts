/**
 * Deskvue kernel
 * Request 请求 类型系统
 *
 */

import type { InjectionKey } from 'vue'
import { spfApis } from './spf-apis'

//logic 比较运算符 可选值
const logics = ['=', '!', '>', '>=', '<', '<=', '<>', '><', '~', '!~'] as const
export type DvLogic = (typeof logics)[number]

//通用 接口 url 字符串类型 / 开头
export type DvApiUrl = `/${string}`

//通用 查询接口入参类型
export interface DvApiQueryParam {
    where?: PlainObject
    sk?: string | string[]
    sort?: {
        [K: string]: 'asc' | 'desc'
    }
    filter?: {
        [K: string]: {
            logic: DvLogic
            value: any
        }
    }
    page?: {
        ipage?: number
        pagesize?: number
    }
    //额外参数
    join?: string[]
    column?: string | string[]
    limit?: number | number[]
    match?: {
        [K: string]: any
    }
    group?: {
        [K: string]: any
    }
    having?: {
        [K: string]: any
    }
    [K: string]: any
}

//通用 接口入参类型
export interface DvApiParam {
    query?: DvApiQueryParam
    data?: PlainObject
    [k: string]: any
}

//通用 返回值类型
export type DvApiReturn = PlainObject | Array<any>

//通用 完整返回值类型，会经过 response 处理，最终只返回 data 的内容
export interface DvApiFullReturn {
    error: boolean
    data: DvApiReturn
}
//通用 Spf 框架错误返回值
export interface DvApiErrorReturn {
    code: string | number
    title: string
    message: string
    file?: string
    line?: string | number
    ekey?: string
    xpath?: string
    trace?: string | string[]
    [K: string]: any
}

//默认适配 Spf 框架接口定义，根据 spfApis 推导 接口定义的 数据类型
export type DvApiDefinitions = typeof spfApis //dvDefaultApis

/**
 * !! 允许外部 declare 覆盖的接口定义 类型插槽
 * 任意位置：
 *  import { DvApiToExtend } from '@/kernel/request/types' (业务库内部应 from '@/Deskvue')
 *  declare module '@/kernel/request/types' {
 *      export interface DvApiToExtend {
 *          ... 要扩展的 接口定义
 *          ...
 *      }
 *  }
 *  如果是 *.d.ts 文件还需要：export {}
 */
export interface DvApiToExtend {}

//!! 合并后的 默认内置 + 外部扩展 的所有接口定义 类型
export type DvApiExtended = DvApiDefinitions & DvApiToExtend

//!! 动态推到 每个接口的 param / return
export type DvThisApiParam<K extends keyof DvApiExtended> = DvApiExtended[K]['param']
export type DvThisApiReturn<K extends keyof DvApiExtended> = DvApiExtended[K]['return']

//!! 动态接口定义
export type DvApiDefine<Param = DvApiParam, Return = DvApiReturn> = {
    api: string //DvApiUrl
    apiKey?: string
    name?: string
    desc?: string
    param?: Param
    return?: Return
    noCache?: boolean
    expireIn?: number //接口超时，默认 15000 毫秒
}

//!! 依赖注入
export const DvApisKey: InjectionKey<DvApiExtended> = Symbol('DvApis')
