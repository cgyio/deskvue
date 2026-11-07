/**
 * Deskvue 自动更新 + 远程配置 store
 *
 * !! 需要配合后端的 deskvue 模块提供 这些接口：
 *      0   /deskvue/update             自动更新接口
 *                          /latest     获取最新版本号
 *                          /fetch      获取最新的更新数据
 *      1   /deskvue/config             远程配置接口
 *                          /hash       获取当前最新版的配置 hash
 *                          /fetch      获取远程配置数据
 *
 * TODO：Deskvue 自动更新流程..
 *
 * Deskvue 自动加载最新版 远程配置：
 *  0   dv:dvUpdate store 会持久化保存：当前使用的远程配置 hash 以及 数据
 *  1   dvUpdate store 会早于其他 store 启动，启动时执行：
 *      1.1     自动检查一次最新版的配置 hash，缓存到 _latestHash
 *      1.2     自动判断当前配置是否最新版本，如果不是最新版本，将会：
 *              1.2.1   将 remoteConfig 清空
 *              1.2.2   执行 loadRemoteConfig() 异步方法 获取远程配置
 *              1.2.2   将获取到的 remoteConfig 写回
 *  2   等待步骤 1 全部完成后，才会继续执行其他 store 的启动初始化 initStore 方法，其内部会：
 *      2.1     自动读取 dvUpdate.remoteConfig[store name] 执行各 store 自己的 updateStore() 方法
 *      2.2     所有 store 初始化结束
 *
 * Deskvue 运行时的手动更新远程配置，通常由用户触发，通过 dvUpdateService 服务组件实例 执行：
 *  0   dvUpdateService.updateRemoteConfig() 异步方法
 *      其内部会：
 *      0.1     自动检查一次最新版的配置 hash，缓存到 _latestHash
 *      0.2     自动判断当前配置是否最新版本，如果不是最新版本，将会：
 *              0.2.1   将 remoteConfig 清空
 *              0.2.2   执行 loadRemoteConfig() 异步方法 获取远程配置
 *              0.2.2   将获取到的 remoteConfig 写回
 *      0.3     异步方法执行完成后，调用 dvUpdate.updateStore() 依次对各 store 执行 update 操作
 *
 *
 *
 *
 */

import { type App, ref, reactive, readonly, computed } from 'vue'
import { defineStore } from 'pinia'
import type { DvRemoteConfigData } from './dv-config'
import type { DvRemoteRootConfig } from './dv-root'
import type { DvRemoteRuntimeConfig } from './dv-runtime'
import type { DvRemoteAccountConfig, DvUacRules } from './dv-account'
//import type { DvStoreName } from './index'
import { useDvRequest, type DvRequestInstance } from '@utils/composable'
import { dvIs, dvExtend, dvWait, dvVerCompare, dvCamel } from '@utils/core'

//定义自动更新接口返回的 更新数据结构
export interface DvUpdateData {}

//完整的 后端获取的 远程配置数据结构
export interface DvRemoteConfig {
    config?: DvRemoteConfigData
    root?: DvRemoteRootConfig
    runtime?: DvRemoteRuntimeConfig
    account?: DvRemoteAccountConfig
    //TODO: 功能开关，灰度发布
    feature?: Record<string, boolean | DvUacRules>
    [K: string]: any
}

export const useDvUpdateStore = defineStore(
    'dvUpdate',
    () => {
        //TODO：自动更新
        //当前已经更新到的 版本号，会被持久化
        const _version = ref<string>('0.1.0')
        const version = readonly(_version)
        //接口返回的 最新版本号
        const _latestVersion = ref<string>('')
        //当前已经更新到的 版本号 是否已是最新版本
        const isLatestVersion = computed<boolean>(() => {
            if (_latestVersion.value === '') return false
            const cp = dvVerCompare(_version.value, _latestVersion.value)
            if (cp >= 0) return true
            //版本比较发生错误，也作为 非最新版本来处理
            return false
        })
        //缓存的 后台获取到的 更新数据，会被持久化
        const updata = ref<DvUpdateData | undefined>()
        //是否存在 更新数据
        const isEmptyUpdata = computed<boolean>(() => !dvIs.nemobj(updata))

        //remoteConfig 远程配置

        //当前配置 hash，会被持久化
        const _hash = ref<string>('')
        const hash = readonly(_hash)
        //接口返回的 最新 hash
        const _latestHash = ref<string>('')
        //是否最新 hash
        const isLatestHash = computed<boolean>(() => _latestHash.value === _hash.value)
        //当前配置的完整数据，会被持久化
        const remoteConfig = ref<DvRemoteConfig | undefined>()
        //是否存在 远程配置数据
        const isEmptyRemoteConfig = computed<boolean>(() => !dvIs.nemobj(remoteConfig.value))

        //远程配置中的 feature 功能开关
        const feature = computed<Record<string, boolean | DvUacRules>>(() => {
            if (isEmptyRemoteConfig.value) return {}
            return remoteConfig.value?.feature ?? {}
        })

        //加载 远程配置
        //加载最新配置 hash
        const rchReq = useDvRequest('dvRemoteConfig/hash')
        const loadLatestHash = async (): Promise<boolean> => {
            const res = await rchReq.request()
            if (rchReq.responseError(res)) return false
            const hash = (res as Record<string, any>).hash
            if (!hash || hash === '') return false
            _latestHash.value = hash ?? ''
            //等待 自动判断
            await dvWait(10)

            //如果不是最新版本
            if (isLatestHash.value !== true) {
                //清空 当前的 remoteConfig
                remoteConfig.value = undefined
                await dvWait(10)
                //开始远程加载更新数据
                return await loadRemoteConfig()
            }

            //已是最新版本，直接返回
            return true
        }
        //获取自动更新的数据
        const rcReq = useDvRequest('dvRemoteConfig/fetch')
        const loadRemoteConfig = async (): Promise<boolean> => {
            //仅在 isLatestHash == false 时执行
            if (isLatestHash.value || _latestHash.value === '') return true
            //执行请求
            const res = await rcReq.request()
            if (rcReq.responseError(res)) return false
            const rc = res as DvRemoteConfig
            if (!rc || !dvIs.nemobj(rc)) return false
            remoteConfig.value = rc
            //更新已加载的版本号，会被持久化
            _hash.value = _latestHash.value
            await dvWait(50)
            return true
        }
        //自动更新某个 store 的数据，由各 store 在其内部的 updateStore() 方法中执行
        //在 各 store 的初始化方法中，会执行一次 updateStore
        const updateStore = (store: string): void => {
            if (isLatestHash.value === true && remoteConfig.value?.[store] !== undefined) {
                const rc = remoteConfig.value[store]
                if (!dvIs.nemobj(rc)) return
                const stk = `useDv${dvCamel(store, true)}Store` //as DvStoreName
                //更新 store 数据
                const useFn = globalThis.Deskvue?.dvStores?.[stk]
                if (typeof useFn === 'function') {
                    const storeIns = useFn(globalThis.DvApp.config.globalProperties.$pinia)
                    const updFn = storeIns?.updateStore ?? undefined
                    if (typeof updFn === 'function') {
                        updFn(rc)
                    }
                }
            }
        }

        //在 pinia 初始化，启动 dvUpdate store 时，执行此方法
        const autoCheck = async (): Promise<void> => {
            //TODO: 自动检查更新
            //...

            //自动检查远程配置
            await loadLatestHash()
        }

        //初始化 store
        //!! 不需要，但是必须有，否则 stores/index ts 报错
        const initStore = (app: App, options: Record<string, any> = {}): void => {}

        return {
            _version,
            version,
            _latestVersion,
            isLatestVersion,
            updata,
            isEmptyUpdata,

            _hash,
            hash,
            _latestHash,
            isLatestHash,
            remoteConfig,
            isEmptyRemoteConfig,
            loadLatestHash,
            loadRemoteConfig,
            feature,
            updateStore,

            autoCheck,

            initStore,
        }
    },
    {
        persist: {
            //dvUpdate store 使用固定 key
            key: 'dv:dvUpdate',
            //储存项目
            pick: [
                //需要持久化当前 Deskvue version 用于自动更新
                '_version',
                //持久化上一次的 update 数据
                'updata',

                //remoteconfig
                '_hash',
                'remoteConfig',
            ],
        },
    },
)

//!! 返回 store 类型
export type DvUpdateStore = ReturnType<typeof useDvUpdateStore>
