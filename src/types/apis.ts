/**
 * 定义 Deskvue 接口类型
 * 定义 默认接口、入参、返回值 类型
 *
 * !! 完全适配 Spf 后端框架 接口定义
 *
 *
 * !! 扩展接口定义
 * 所有接口定义的数据，保存在 dvApisStore 中
 * 如果要扩展 Deskvue 默认接口，必须在 Deskvue 插件 install 参数 options.apis{} 中添加需要扩展的接口定义
 * 如果业务库需要扩展接口，执行以下操作：
 *      0   在 @/types/business/[业务库名]/ 路径下创建 apis.d.ts ：
 *              import type { DvApiExtended } from '@/Deskvue
 *              declare module '@/types/apis' {
 *                  export interface DvApiExtended {
 *                      # 写入要扩展的接口定义
 *                      fooBar: {
 *                          api: '/foo/api/bar',
 *                          name: '接口名称',
 *                          param: { 入参结构 },
 *                          return: { 返回值结构 },
 *                          noCache: false,
 *                      },
 *                      ...
 *                  }
 *              }
 *              export {}
 *      1   在 业务库 setup 中：
 *              import { useDvStore } from '@/Deskvue'
 *              const dvApis = useDvStore('apis')
 *              # 调用 extendApis 方法将接口定义数据写入 dvApisStore
 *              dvApis.extendApis({
 *                  # 写入要扩展的接口定义
 *                  fooBar: { ... 与 apis.d.ts 中内容一致 ...},
 *                  ...
 *              })
 */

import type { InjectionKey } from 'vue'

/**
 * Spf 后端框架 默认接口定义
 */
export const dvDefaultApis = {
    //Deskvue update 接口
    dvUpdate: {
        api: '/api/deskvue/update/:api',
        name: 'Deskvue 自动更新接口',
        param: {},
        return: {},
        noCache: true,
    },
    //Deskvue remoteConfig 接口
    dvRemoteConfig: {
        api: '/api/deskvue/config/:api',
        name: 'Deskvue 远程配置接口',
        param: {},
        return: {
            hash: '',
        },
        noCache: true,
    },

    //uac 接口
    uacLogin: {
        api: '/uac/api/login',
        name: '登录接口',
        param: {
            iso: '',
            name: '',
            pswd: '',
            vcode: '',
        },
        return: {
            token: '',
            uuid: '',
        },
        noCache: true,
    },
    uacLogout: {
        api: '/uac/api/logout',
        name: '登出接口',
        param: {
            uuid: '',
        },
        return: {
            success: true,
        },
        noCache: true,
    },
    uacAccount: {
        api: '/uac/api/account',
        name: '账号信息接口',
        param: {
            uuid: '',
        },
        return: {
            id: '',
            uuid: '',
            openid: '',
            name: '',
            role_list: [''],
            auth_list: [''],
            iso_list: [''],
        },
        noCache: false,
    },
    uacAuthCheck: {
        api: '/uac/api/auth_check',
        name: '权鉴接口',
        param: {
            uuid: '',
            auths: [''],
        },
        return: {
            grant: true,
            msg: '',
        },
        noCache: true,
    },
    //!! 心跳接口
    heartBeat: {
        api: '/api/heartbeat',
        name: '心跳接口',
        param: {},
        return: {
            timestamp: 0,
            timestr: '',
        },
        noCache: true,
    },
    //!! Task 长耗时接口测试
    testTaskCreate: {
        api: '/api/test_task/create',
        name: 'Task 创建接口',
        param: {},
        return: {
            id: '',
            title: '',
            status: '',
            stepTo: -1,
            timestamp: {
                start: 0,
                end: 0,
            },
            step: [],
        },
    },
    testTaskNext: {
        api: '/api/test_task/next',
        name: 'Task 执行接口',
        param: {
            taskId: '',
        },
        return: {
            id: '',
            title: '',
            status: '',
            stepTo: -1,
            timestamp: {
                start: 0,
                end: 0,
            },
            step: [],
        },
    },

    //db 接口，对接 SPF-Orm 后端系统的标准化数据库操作接口
    dbAvailable: {
        api: '/orm/api/available',
        name: '获取全部可用数据模型接口',
        param: {},
        return: {},
        noCache: false,
    },
    dbConfig: {
        api: '/orm/api/front_db_config/deskvue/:dbn',
        name: '数据库结构化配置参数接口',
        param: {},
        return: {
            meta: {
                name: '',
                title: '',
                desc: '',
            },
            frontend: '',
            models: [],
            model: {},
        },
        noCache: false,
    },
    dbOptions: {
        api: '/orm/api/select_options',
        name: '获取数据库所有可用下拉列表选项',
        param: {},
        return: {},
        noCache: false,
    },
    //curd
    dbCreate: {
        api: '/db/:dbn/:model/create',
        name: '记录创建接口',
        param: {
            data: {},
        },
        return: {},
        noCache: false,
    },
    dbUpdate: {
        api: '/db/:dbn/:model/update',
        name: '记录编辑接口',
        param: {
            query: {},
            data: {},
        },
        return: {},
        noCache: false,
    },
    dbRetrieve: {
        api: '/db/:dbn/:model/retrieve',
        name: '记录查询接口',
        param: {
            query: {},
        },
        return: {
            result: [],
            query: {},
            page: {},
        },
        noCache: false,
    },
    dbDelete: {
        api: '/db/:dbn/:model/delete',
        name: '记录删除接口',
        param: {
            query: {},
        },
        return: {},
        noCache: false,
    },
    //任意模型接口
    dbModelApi: {
        api: '/db/:dbn/:model/:api',
        name: '数据模型业务接口',
        param: {},
        return: {},
        noCache: false,
    },
} //as const

/**
 * Spf 后端框架，返回错误码
 */
export const dvErrorCodes = {
    //需要终止后续
    abortCodes: [
        '0310018', //token 被篡改
        '0310019', //token 与访问来源不一致，被冒用
    ],

    //未登录
    notLoginCodes: [
        '0310015', //用户已经手动登出
        '0310016', //用户还未登录
        '0310017', //token 已过期
    ],

    //登录过程中的错误，需要静默处理
    inLoginCodes: [
        '0310021', //错误的用户名密码，不存在的用户名，登录次数过多
    ],
}

//logic 比较运算符 可选值
const logics = ['=', '!', '>', '>=', '<', '<=', '<>', '><', '~', '!~'] as const
export type DvLogic = (typeof logics)[number]

//通用 PlainObject
type PlainObject = Record<string, any>

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

//根据默认值 dvDefaultApis 推导 接口定义的 数据类型
export type DvApiDefinitions = typeof dvDefaultApis

/**
 * !! 允许外部 declare 覆盖的接口定义 类型插槽
 * 任意位置：
 *  import { DvApiToExtend } from '@/types/apis' (业务库内部应 from '@/Deskvue')
 *  declare module '@/types/apis' {
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
