/**
 * Deskvue 库通用设置项 store
 * !! 需要针对不同业务库进行适配时，可以修改此处配置后，重新编译
 */

import { type App, ref, reactive, readonly, computed } from 'vue'
import { defineStore } from 'pinia'
import { useDvAccountStore } from './dv-account'
import { dvWait } from '@utils/core'

//可以外部配置的 root 参数结构 通过 install options 或 update 自动更新 传入此结构数据
export interface DvRemoteConfigData {
    [K: string]: any
}

export const useDvConfigStore = defineStore(
    'dvConfig',
    () => {
        //Deskvue version
        const version = ref<string>('0.1.0')

        //已初始化标记
        const inited = ref<boolean>(false)

        //用户登录成功后
        //!! 此处不判断 isLogin，由外部调用方自行判断后执行此处的方法
        //在账号登录成功后，config 初始化
        const initAfterLoginOk = async (): Promise<void> => {
            //从 账号 config 中读取 个性化参数
            await syncConfig('from')
        }
        //登录后从 账号 config 中读取 个性化参数 或 将 config 中的参数写入账号持久化数据中
        const syncConfig = async (type: 'from' | 'to' = 'from'): Promise<void> => {
            //读取账号个性化配置
            const dvAccount = useDvAccountStore()
            const config = dvAccount.config

            //定义可以被用户个性化配置的 参数项目
            const configs: Record<string, any> = {
                //用持久化到 account 数据中的 此 store 中的参数
            }
            const keys: string[] = Object.keys(configs)
            for (const key of keys) {
                if (type === 'from') {
                    //从持久化数据中 获取 config
                    if (config?.[key] === undefined) {
                        //没有个性化配置，则写入
                        config[key] = configs[key].value
                    } else if (config[key] !== configs[key].value) {
                        //存在个性化配置，则从个性化配置中获取
                        configs[key].value = config[key]
                    }
                } else if (type === 'to') {
                    //将 runtime 中的参数 写入 持久化数据中
                    config[key] = configs[key].value
                }
            }
            await dvWait(100)
        }

        //初始化 store
        const initStore = (app: App, options: Record<string, any>): void => {
            if (inited.value) return

            //自动更新
            const dvUpdate = globalThis.DvApp.config.globalProperties.$dvUpdate
            if (dvUpdate?.updateStore) dvUpdate.updateStore('config')

            //标记 已初始化
            inited.value = true
        }

        //自动更新接口返回 对应数据后，写入 store
        const updateStore = (updata?: DvRemoteConfigData): void => {
            console.log('update config', updata)

            //自动更新
            const dvUpdate = globalThis.DvApp.config.globalProperties.$dvUpdate
            const ver = dvUpdate.version.value
            if (ver) version.value = ver
        }

        return {
            inited,
            version,

            initStore,
            updateStore,
        }
    },
    {
        persist: false,
    },
)

//!! 返回 store 类型
export type DvConfigStore = ReturnType<typeof useDvConfigStore>
