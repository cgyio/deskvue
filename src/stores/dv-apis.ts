/**
 * Deskvue 库 接口定义
 * 此 store 不会持久化
 */

import { type App, ref, reactive, readonly, computed } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useDvRuntimeStore } from './dv-runtime'
import { useDvAccountStore } from './dv-account'
import {
    dvDefaultApis,
    dvErrorCodes,
    type DvApiDefine,
    type DvApiExtended,
    type DvThisApiParam,
    type DvThisApiReturn,
} from '@/types/apis'
import { type DvRequestInfo } from '@utils/composable'
import { dvIs, dvExtend, dvWait } from '@utils/core'
import { DvHttpError, DvBusinessError } from '@utils/error'

//接口 请求与响应 数据缓存类型
export interface DvApiFetchCache {
    key: string //全局唯一的 fetchKey
    apiDefine: DvApiDefine //接口完整信息
    requestInfo: DvRequestInfo<keyof DvApiExtended> //此请求的完整信息
    //此请求的状态
    status: 'inited' | 'fetching' | 'finished' | 'error'
    //此请求各状态节点的 时间戳
    timestamp: {
        init: number
        start: number
        finish: number
    }
    returnValue?: DvThisApiReturn<keyof DvApiExtended> | DvBusinessError | DvHttpError | null
    [K: string]: any
}
//接口缓存数据 可显示的类型
export interface DvApiFetchCachePlain {
    key: string
    name: string
    apiKey: string
    api: string
    url: string
    iso: string
    token: string
    post?: DvThisApiParam<keyof DvApiExtended>
    status: 'inited' | 'fetching' | 'finished' | 'error'
    finish: number
    spend: number
    return: DvThisApiReturn<keyof DvApiExtended> | string | null
    [K: string]: any
}

export const useDvApisStore = defineStore(
    'dvApis',
    () => {
        //已初始化标记
        const inited = ref<boolean>(false)

        //是否静默调用 接口，接口实例的 log() 方法依赖此标记
        //!! 此标记会被持久化到 账号数据中
        const consoleLog = ref<boolean>(false)

        //接口 baseUrl 根据 租户iso、用户ID 从 dvRoot 中获取并同步到这里
        //const baseUrl = ref<string>('')
        //完整接口定义，可通过 插件 options.apis 覆盖
        const apis = reactive<Record<string, DvApiDefine>>({
            ...dvDefaultApis,
        })

        //外部通过 extendApis 覆盖|扩展 接口定义
        const extendApis = (apisToExtend: Partial<DvApiExtended>): void => {
            if (apisToExtend) {
                Object.assign(apis, apisToExtend)
            }
        }

        //根据 api-key 获取接口定义内容
        const getApiDefine = (apiKey: string): DvApiDefine | undefined => {
            const { apiKey: ak, args } = parseApiKey(apiKey)
            if (!ak || ak === '') return undefined
            //从 apis 中读取 对应的 api 定义
            const def = apis[ak]
            if (!def || !def.api || def.api === '') return undefined

            //准备结果
            return {
                api: parseApiUrl(def.api, args ?? []),
                apiKey: ak,
                name: def.name ?? '未知接口',
                param: def.param ? Object.assign({}, def.param) : {},
                return: def.return ? Object.assign({}, def.return) : {},
                noCache: def.noCache ?? false,
                expireIn: def.expireIn ?? 15000,
            } as DvApiDefine
        }

        //解析在调用 api 时，传入的 apiKey 可能是： uacLogin 或 dbsConfig/dbname/tbname 形式
        const parseApiKey = (apiKey: string): { apiKey: string; args?: string[] } => {
            apiKey = apiKey.trim()
            if (apiKey.startsWith('/')) apiKey = apiKey.substring(1)
            if (apiKey.endsWith('/')) apiKey = apiKey.substring(0, apiKey.length - 1)
            const rtn: { apiKey: string; args?: string[] } = {
                apiKey: '',
                args: [],
            }

            //空字符
            if (!apiKey || apiKey === '') return rtn

            //uacLogin 形式
            if (apiKey.includes('/') !== true) {
                rtn.apiKey = apiKey
                return rtn
            }

            //dbsConfig/dbn/tbn 形式
            const aks = apiKey.split('/')
            rtn.apiKey = aks.shift() as string
            rtn.args = [...aks]
            return rtn
        }

        /**
         * 处理 /foo/:bar/:jaz? 形式的 带参数的 接口地址，替换为传入的 参数值
         * 使用方法：
         *  定义接口 someApi: { api: '/foo/:bar/:jaz?/tom/:jry?', ... }
         *  调用接口：
         *      request('someApi/bar_val/jaz_val')
         *          调用 parseApiUrl('/foo/:bar/:jaz?/tom/:jry?', ['bar_val', 'jaz_val'])
         *                                                  --> url: /foo/bar_val/jaz_val/tom
         *      request('someApi/bar_val/jaz_val/jry_val')  --> url: /foo/bar_val/jaz_val/tom/jry_val
         *      request('someApi/bar_val/?/jry_val')        --> url: /foo/bar_val/tom/jry_val
         *      request('someApi/?/jaz_val')                --> 报错，url: /foo/:bar/jaz_val/tom
         *
         *      多余的传入参数，自动附加到 url 末尾
         *      request('someApi/bar_val/?/jry_val/ext_a/ext_b')
         *                                                  --> url: /foo/bar_val/tom/jry_val/ext_a/ext_b
         */
        const parseApiUrl = (url: string, args?: string[]): string => {
            url = url.trim()
            if (url.startsWith('/') !== true) url = `/${url}`
            if (url.endsWith('/')) url = url.substring(0, url.length - 1)
            if (!url.includes('/:')) return url

            let idx = 0
            const segments = args ?? []
            let fix = url.replace(/:([^/]+)/g, (match, name) => {
                const optional = name.endsWith('?')
                const val = segments[idx]

                //显式跳过标记 '?'
                if (val === '?') {
                    idx++
                    //必选参数不允许跳过，保留占位符，后面报错
                    return optional ? '' : match
                }

                //有实际值
                if (val !== undefined) {
                    idx++
                    return String(val)
                }

                //args 已用完：可选参数删除，必选参数保留占位符
                return optional ? '' : match
            })
            //传入了多余的 args
            if (segments.length > idx) {
                const extra = segments.slice(idx)
                fix = `${fix}/${extra.join('/')}`
            }

            //去除处理后 url 中可能产生的 // 或冗余 /
            fix = fix.replace(/\/{2,}/g, '/')
            if (fix.length > 1 && fix.endsWith('/')) fix = fix.substring(0, fix.length - 1)

            //如果处理后的 url 中还包含 /: 表示缺少必须参数，报错
            if (fix.includes('/:')) {
                return dvTriggerError(new Error(`接口地址 ${url} 缺少必须参数：${fix}`), false, fix)
            }

            return fix
        }

        //判断返回的错误码类型
        const errorIs = (errType: string, errCode: string | number): boolean => {
            const ecs = dvErrorCodes as Record<string, any[]>
            const ek = `${errType}Codes`
            if (!ecs?.[ek]) return false
            const cs = ecs[ek]
            return cs.includes(errCode)
        }

        //接口请求与响应 数据缓存 相关
        //!! 此缓存数据不会被持久化，仅单次会话有效

        //fetch 缓存数量限制 100 条，可配置，持久化到 用户数据
        const apiFetchCacheMaxLength = ref<number>(100)
        //以全局唯一的 fetchKey 为键的 数据缓存
        const apiFetchCache = ref<DvApiFetchCache[]>([])
        //将 fetchCache 转为可以显示的 数据形式
        //!! 将错误实例转为 plainObject
        //!! 将时间戳计算为 耗时
        const apiFetchCachePlain = computed<DvApiFetchCachePlain[]>(() => {
            if (apiFetchCache.value.length <= 0) return []
            const rtn: DvApiFetchCachePlain[] = []
            for (const ci of apiFetchCache.value) {
                const def = ci.apiDefine
                const info = ci.requestInfo
                const rtni: DvApiFetchCachePlain = {
                    key: ci.key,
                    name: def.name ?? '',
                    api: def.api,
                    apiKey: def.apiKey ?? '',
                    url: info.api,
                    iso: info.iso,
                    token: info.token,
                    post: info.post,
                    status: ci.status,
                    finish: ci.timestamp.finish,
                    spend: 0,
                    return: null,
                }
                if (ci.status === 'finished' || ci.status === 'error') {
                    //计算 请求耗时
                    rtni.spend = ci.timestamp.finish - ci.timestamp.start
                    //处理错误信息
                    if (ci.status === 'error') {
                        const err = ci.returnValue as DvHttpError | DvBusinessError
                        rtni.return = `[${err instanceof DvHttpError ? 'HttpError' : 'BusinessError'}] ${err.message}`
                    }
                    //正常返回数据
                    else if (dvIs.plainObject(ci.returnValue) || ci.returnValue === null) {
                        rtni.return = ci.returnValue as DvThisApiReturn<keyof DvApiExtended>
                    }
                    //不支持类型的数据
                    else {
                        rtni.return = 'unsupport value'
                    }
                }
                rtn.push(rtni)
            }
            return rtn
        })
        //以 api-key 组织 fetchCache 数据
        const apiKeyFetchCache = computed<Record<string, DvApiFetchCache[]> | undefined>(() => {
            if (apiFetchCache.value.length <= 0) return undefined
            const cache = apiFetchCache.value
            const rtn: Record<string, DvApiFetchCache[]> = {}
            for (const ci of cache) {
                const ak = ci.apiDefine.apiKey
                if (!ak || ak === '') continue
                if (!rtn?.[ak]) rtn[ak] = []
                rtn[ak].push(ci)
            }
            if (!dvIs.nemobj(rtn)) return undefined
            return rtn
        })
        //以 api-key 组织 fetchCachePlain 数据
        const apiKeyFetchCachePlain = computed<Record<string, DvApiFetchCachePlain[]> | undefined>(
            () => {
                if (apiFetchCachePlain.value.length <= 0) return undefined
                const cache = apiFetchCachePlain.value
                const rtn: Record<string, DvApiFetchCachePlain[]> = {}
                for (const ci of cache) {
                    const ak = ci.apiKey
                    if (!ak || ak === '') continue
                    if (!rtn?.[ak]) rtn[ak] = []
                    rtn[ak].push(ci)
                }
                if (!dvIs.nemobj(rtn)) return undefined
                return rtn
            },
        )
        //全局 fetching 标记
        const apiFetching = computed<boolean>(() => {
            if (apiFetchCache.value.length <= 0) return false
            const cache = apiFetchCache.value
            for (const ci of cache) {
                if (!ci.status) continue
                if (ci.status === 'fetching') return true
            }
            return false
        })
        //全局 并发请求统计
        const apiFetchingCount = computed<number>(() => {
            if (apiFetchCache.value.length <= 0) return 0
            const cache = apiFetchCache.value
            let count = 0
            for (const ci of cache) {
                if (!ci.status) continue
                if (ci.status === 'fetching') {
                    count++
                }
            }
            return count
        })
        //fetchCache 存在性检查，以 fetchKey 为条件，存在则返回 idx 序号，不存在返回 false
        const apiFetchCacheExists = (fetchKey: string): number | false => {
            if (apiFetchCache.value.length <= 0) return false
            const cache = apiFetchCache.value
            let idx = 0
            for (let i = 0; i < cache.length; i++) {
                const ci = cache[i]
                if (!ci) continue
                if (ci.key === fetchKey) return i
            }
            return false
        }
        //指定的 fetchKey 请求是否正在请求中
        const apiIsFetching = (fetchKey: string): boolean => {
            const cache = getApiFetchCache(fetchKey)
            if (!cache) return false
            return cache.status === 'fetching'
        }
        //指定的 fetchKey 请求是否已经结束
        const apiFetchingIsFinished = (fetchKey: string): boolean => {
            const cache = getApiFetchCache(fetchKey)
            if (!cache) return false
            return cache.status === 'finished' || cache.status === 'error'
        }
        //根据 fetchKey 查找缓存数据，找到则返回数据，否则返回 undefined
        const getApiFetchCache = (fetchKey: string): DvApiFetchCache | undefined => {
            const idx = apiFetchCacheExists(fetchKey)
            if (idx !== false) return apiFetchCache.value[idx]
            return undefined
        }
        //根据 fetchKey 查找缓存的 returnValue
        const getApiFetchCacheReturnValue = (
            fetchKey: string,
        ):
            | DvThisApiReturn<keyof DvApiExtended>
            | DvBusinessError
            | DvHttpError
            | null
            | undefined => {
            const cache = getApiFetchCache(fetchKey)
            if (!cache || !(cache.status === 'finished' || cache.status === 'error'))
                return undefined
            return cache.returnValue
        }
        //fetchCache 初始化，新建一个 请求缓存
        //!! 如果此请求已经执行过，则需要更新 cache 数据，并将此请求提升到 cache[] 首位
        const initApiFetchCache = (
            fetchKey: string,
            apiDefine: DvApiDefine,
            requestInfo: DvRequestInfo<keyof DvApiExtended>,
        ): boolean => {
            //!! noCache 标记的接口，不允许缓存
            if (apiDefine?.noCache === true) return false

            //准备要生成的 cache 数据
            const cache: DvApiFetchCache = {
                key: fetchKey,
                apiDefine,
                requestInfo,
                status: 'inited',
                timestamp: {
                    init: Date.now(),
                    start: 0,
                    finish: 0,
                },
                returnValue: undefined,
            }

            //先检查此请求是否已经存在
            const cidx = apiFetchCacheExists(fetchKey)
            //已存在 请求缓存记录
            if (cidx !== false && apiFetchCache.value?.[cidx]) {
                const ocache = apiFetchCache.value[cidx]
                if (!(ocache.status === 'finished' || ocache.status === 'error')) {
                    //!! 全局存在 并行的 进行中的 同一个请求
                    //!! fetchKey 相同表示请求参数完全相同
                    //!! init 阶段不处理，直接返回
                    //!! 在 fetch start 时，会再次检查
                    return true
                }

                //已存在的 是历史请求，从原有 cache[] 中 splice
                apiFetchCache.value.splice(cidx, 1)
            }

            //!! 新请求插到 cache[] 首位
            apiFetchCache.value.unshift(cache)

            //LRU 缓存长度限制
            if (apiFetchCache.value.length > apiFetchCacheMaxLength.value) {
                apiFetchCache.value.length = apiFetchCacheMaxLength.value // 直接截断末尾
            }

            return true
        }
        //fetchCache 数据写入
        //fetch 状态写入缓存
        const setApiFetchCacheStatus = (
            fetchKey: string,
            status: 'fetching' | 'finished' | 'error',
        ): boolean => {
            const idx = apiFetchCacheExists(fetchKey)
            if (idx === false || !apiFetchCache.value?.[idx]) return false
            const cache = apiFetchCache.value[idx]
            if (cache.status === status) return true
            //状态变化限定
            if (status === 'fetching' && cache.status !== 'inited') return false
            const isfin = 'finished,error'.split(',').includes(status)
            //完成 fetch 时，可能存在并行的 同时进行的请求，因此状态只要不是 inited 都可以
            if (isfin && cache.status === 'inited') return false
            //修改状态
            apiFetchCache.value[idx].status = status
            //修改对应的 时间戳
            if (status === 'fetching') {
                apiFetchCache.value[idx].timestamp.start = Date.now()
                apiFetchCache.value[idx].timestamp.finish = 0
            } else if (isfin) {
                apiFetchCache.value[idx].timestamp.finish = Date.now()
            }
            return true
        }
        //开始 fetch
        const startApiFetching = (fetchKey: string): boolean => {
            const idx = apiFetchCacheExists(fetchKey)
            if (idx === false || !apiFetchCache.value?.[idx]) return false
            const cache = apiFetchCache.value[idx]
            //未经过初始化的 fetchCache
            if (cache.status === 'finished' || cache.status === 'error') return false
            //正常情况
            if (cache.status === 'inited') {
                return setApiFetchCacheStatus(fetchKey, 'fetching')
            }
            //!! 存在并行的 进行中的 相同请求
            //!! 且 其他请求已经抢先开始
            //!! 直接返回，后结束的请求结果，将会覆盖先结束的
            if (cache.status === 'fetching') {
                return true
            }
            return false
        }
        //fetch 返回值写入缓存
        const setApiFetchCache = (
            fetchKey: string,
            value: DvThisApiReturn<keyof DvApiExtended> | DvBusinessError | DvHttpError | null,
        ): boolean => {
            const idx = apiFetchCacheExists(fetchKey)
            if (idx === false || !apiFetchCache.value?.[idx]) return false
            const cache = apiFetchCache.value[idx]
            //状态错误
            if (cache.status === 'inited') return false

            //!! 此时的 status 可以是 fetching | finished | error
            //!! finished | error 表示存在并行的 进行中的 相同请求，且 其他请求已经结束
            //!! 一律 使用当前请求的结果，覆盖先结束的
            //!! 时间戳也会覆盖

            //是否返回错误实例
            const iserr = value instanceof DvHttpError || value instanceof DvBusinessError
            //修改状态
            const st = setApiFetchCacheStatus(fetchKey, iserr ? 'error' : 'finished')
            if (!st) return false
            //缓存 返回值
            apiFetchCache.value[idx].returnValue = value
            return true
        }

        //初始化 store
        const initStore = (app: App, options: Record<string, any> = {}): void => {
            //!! 运行时插入接口定义，是无法获得类型提示的，只能插入接口定义内容到 dvApisStore
            if (options?.apis) {
                extendApis(options.apis as Partial<DvApiExtended>)
            }
        }

        //在账号登录成功后，runtime 初始化
        const initAfterLoginOk = async (): Promise<void> => {
            //必须在账号成功登录后执行
            if (useDvRuntimeStore().isLogin !== true) return

            //从 账号 config 中读取 个性化参数
            await syncConfig('from')
        }

        //持久化数据
        const syncConfig = async (type: 'from' | 'to' = 'from'): Promise<void> => {
            //必须在账号成功登录后执行
            if (useDvRuntimeStore().isLogin !== true) return

            //账号持久化数据
            const dvAccount = useDvAccountStore()
            const config = dvAccount.config
            if (!config?.apis) config.apis = {} as Record<string, any>

            //定义可以被用户个性化配置的 参数项目
            const configs: Record<string, any> = {
                consoleLog,
                apiFetchCacheMaxLength,
            }
            const keys: string[] = Object.keys(configs)
            for (const key of keys) {
                if (type === 'from') {
                    //从持久化数据中 获取 config
                    if (config.apis?.[key] === undefined) {
                        //没有个性化配置，则写入
                        config.apis[key] = configs[key].value
                    } else if (config.apis[key] !== configs[key].value) {
                        //存在个性化配置，则从个性化配置中获取
                        configs[key].value = config.apis[key]
                    }
                } else if (type === 'to') {
                    //将 runtime 中的参数 写入 持久化数据中
                    config.apis[key] = configs[key].value
                }
            }
            await dvWait(100)
        }
        //恢复默认设置，如果用户已登录，则同时恢复持久化设置
        const restoreConfig = async (): Promise<void> => {
            //先恢复默认设置
            consoleLog.value = false
            apiFetchCacheMaxLength.value = 100

            await dvWait(100)
            await syncConfig('to')
        }

        //自动更新接口返回 对应数据后，写入 store
        const updateStore = (updata: Record<string, any>): void => {}

        return {
            inited,

            consoleLog,

            apis,
            extendApis,
            getApiDefine,
            parseApiKey,
            parseApiUrl,

            errorIs,

            initStore,
            initAfterLoginOk,
            syncConfig,
            restoreConfig,
            updateStore,

            apiFetchCacheMaxLength,
            apiFetchCache,
            apiFetchCachePlain,
            apiKeyFetchCache,
            apiKeyFetchCachePlain,
            apiFetching,
            apiFetchingCount,
            apiFetchCacheExists,
            apiIsFetching,
            apiFetchingIsFinished,
            getApiFetchCache,
            getApiFetchCacheReturnValue,
            initApiFetchCache,
            startApiFetching,
            setApiFetchCache,
            setApiFetchCacheStatus,
        }
    },
    {
        persist: false,
    },
)

//!! 返回 store 类型
export type DvApisStore = ReturnType<typeof useDvApisStore>
