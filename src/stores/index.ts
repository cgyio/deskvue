/**
 * Deskvue 库依赖的 store
 * 初始化，并导出
 */

import { type App } from 'vue'
import { createPinia, type Pinia, type Store } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { dvCamel } from '@/utils/core'

//所有 Deskvue 依赖的 store
import { useDvUpdateStore } from './dv-update'
import { useDvConfigStore } from './dv-config'
import { useDvRootStore } from './dv-root'
import { useDvCmdStore } from './dv-cmd'
import { useDvApisStore } from './dv-apis'
import { useDvDbsStore } from './dv-dbs'
import { useDvRuntimeStore } from './dv-runtime'
import { useDvAccountStore } from './dv-account'

//导出 dvStores 供 Deskvue 打包
export const dvStores = {
    //useDvUpdateStore,
    useDvConfigStore,
    useDvRootStore,
    useDvCmdStore,
    useDvApisStore,
    useDvDbsStore,
    useDvRuntimeStore,
    useDvAccountStore,
}
//DvStoreName 类型
export type DvStoreName = keyof typeof dvStores

// ====================================================================
//  Store 专用类型推导（ExtractShortName / BuildShortNameMap 来自全局声明）
//  useDvRootStore → root → DvRootStore
// ====================================================================

type DvStoreShortMap = BuildShortNameMap<typeof dvStores, 'Store'>
type DvStoreReturnMap = {
    [K in keyof DvStoreShortMap]: ReturnType<DvStoreShortMap[K]>
}
type DvStoreKey = keyof DvStoreReturnMap | keyof typeof dvStores

// 分派：短名称用 DvStoreReturnMap，完整函数名用 ReturnType
type DvStoreReturn<K extends string> = K extends keyof DvStoreReturnMap
    ? DvStoreReturnMap[K]
    : K extends keyof typeof dvStores
      ? ReturnType<(typeof dvStores)[K]>
      : any

/**
 * !! 初始化 store
 * Deskvue store 使用 dv:{iso}:{uuid}:{storeId} 作为持久化的 键名 key
 *
 */
const isStaticKey = (key: string): boolean => {
    //这些 store 使用静态 key 不依赖登录账号做区分
    const keys = 'dvUpdate,dvConfig,dvRoot,dvDbs'.split(',')
    for (const k of keys) {
        if (key.includes(k)) return true
    }
    return false
}
export const setupDvStores = (app: App<Element>, options: Record<string, any> = {}): void => {
    const pinia = createPinia()

    //持久化插件
    pinia.use(
        createPersistedState({
            key: (storeId: string) => {
                //针对 dvRootStore 使用固定的 key
                //if (storeId.includes('dvRoot')) return 'dv:dvRoot'
                if (isStaticKey(storeId)) return storeId
                return useDvRootStore().persistKey(storeId)
            },
            storage: localStorage,
            serializer: {
                serialize: JSON.stringify,
                deserialize: JSON.parse,
            },
        }),
    )

    //应用
    app.use(pinia)

    //useDvUpdateStore 单独启动
    const dvUpdate = useDvUpdateStore(pinia)
    //挂载到 app.config.globalProperties.$dvUpdate
    app.config.globalProperties.$dvUpdate = dvUpdate

    //自动更新
    dvUpdate.autoCheck().then(() => {
        //必须等待自动更新的异步方法执行完成后，才继续

        //从 Deskvue 插件 install options 中合并对应的初始参数
        const stores = Object.keys(dvStores)
        for (const store of stores) {
            //!! 需要跳过 dvAccount 必须在用户成功登录后，才能首次 useDvAccountStore()
            //if (['useDvUpdateStore', 'useDvAccountStore'].includes(store)) continue
            if (store === 'useDvAccountStore') continue

            const useStore = dvStores[store as DvStoreName]
            if (!useStore) continue
            const storeIns = useStore(pinia)
            if (!storeIns?.initStore || typeof storeIns.initStore !== 'function') continue
            storeIns.initStore(app, options)
        }
    })

    //从 Deskvue 插件 install options 中合并对应的初始参数
    /*const stores = Object.keys(dvStores)
    for (const store of stores) {
        //!! 需要跳过 dvAccount 必须在用户成功登录后，才能首次 useDvAccountStore()
        if (['useDvAccountStore'].includes(store)) continue

        const useStore = dvStores[store as DvStoreName]
        if (!useStore) continue
        const storeIns = useStore(pinia)
        if (!storeIns?.initStore || typeof storeIns.initStore !== 'function') continue
        storeIns.initStore(app, options)
    }*/
}

/**
 * 提供一个快捷方法  useDvStore('root') --> dvStores.useDvRootStore()
 * 挂载在 globalThis.Deskvue.useDvStore()
 * 业务库开发时，直接 import { useDvStore } from '@/Deskvue'
 * !! 会自动传入 pinia 实例
 */

// 类型重载：精确 key → 精确 Store 实例类型
export function useDvStore<K extends DvStoreKey>(storeId: K, pinia?: Pinia): DvStoreReturn<K>
// 兜底：任意字符串 → any（用于业务库自定义 store）
export function useDvStore(storeId: string, pinia?: Pinia): any
// 运行时实现
export function useDvStore(storeId: string, pinia?: Pinia): any {
    //自动传入 pinia 实例
    if (!pinia) pinia = globalThis.DvApp.config.globalProperties.$pinia
    //foo-bar --> FooBar
    const key = dvCamel(storeId.trim(), true)
    const name = `useDv${key}Store`
    const useFn = dvStores[name as DvStoreName]
    return useFn(pinia)
}

//导出所有依赖的 store 以供 业务库开发时直接导入使用
/*export {
    useDvRootStore,
    useDvCmdStore,
    useDvApisStore,
    useDvConfigStore,
    useDvRuntimeStore,
    useDvAccountStore,
}*/
//导出所有 store 实例类型
//export type { DvRootStore, DvCmdStore, DvApisStore, DvConfigStore, DvRuntimeStore, DvAccountStore }

//导出所有 store 中定义的 类型
export type * from './types'
