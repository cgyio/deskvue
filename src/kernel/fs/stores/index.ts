/**
 * Deskvue kernel
 * Deskvue 模拟 Linux 文件系统的 部分行为
 *
 * 使用 pinia + pinia-plugin-persistedstate 模拟 内存 + 磁盘
 */

import { type App } from 'vue'
import { createPinia, type Pinia, type Store } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { dvWait } from '@utils/core'

//pinia store 启动
export const start = async (app: App): Promise<boolean> => {
    //pinia 启动
    const pinia = createPinia()
    //持久化插件
    pinia.use(
        createPersistedState({
            storage: localStorage,
            serializer: {
                serialize: JSON.stringify,
                deserialize: JSON.parse,
            },
        }),
    )
    app.use(pinia)

    //等待状态同步
    await dvWait(100)

    return true
}

//导出 内存 磁盘 store
export * from './dv-mem'
export * from './dv-hdd'

//导出类型
export type * from './dv-mem'
export type * from './dv-hdd'
