/**
 * Deskvue 全局根 store
 * 储存 租户iso、lastAccountId、lastToken
 */

import { type App, ref, reactive, readonly, computed } from 'vue'
import { defineStore } from 'pinia'
import { dvIs, dvExtend } from '@utils/core'

//定义类型
//租户 iso 的信息类型
export interface DvIsoInfo {
    iso: string
    name: string
    baseUrl: string
    logo?: string
}
//dvRoot 对应的 install options 参数类型
export interface DvRemoteRootConfig {
    isos?: Record<string, DvIsoInfo>
    [K: string]: any
}

export const useDvRootStore = defineStore(
    'dvRoot',
    () => {
        //已初始化标记
        const inited = ref<boolean>(false)

        //定义当前 Deskvue 支持的租户iso
        //!! 可通过 options.isos 传入更多支持的 租户 iso 信息
        const isos = reactive<Record<string, DvIsoInfo>>({
            'ms.qypms': {
                iso: 'ms.qypms',
                name: '乾耀PMS',
                baseUrl: 'https://ms.systech.work/qypms',
                logo: 'https://io.cgy.design/icon/qy-pms${dark}${expand}',
                /*logo: {
                    expand: {
                        light: 'https://io.cgy.design/icon/qy-pms-expand',
                        dark: 'https://io.cgy.design/icon/qy-pms-dark-expand',
                    },
                    square: {
                        light: 'https://io.cgy.design/icon/qy-pms',
                        dark: 'https://io.cgy.design/icon/qy-pms-dark',
                    },
                },*/
            },
        })

        //租户列表 转为 select-options[]
        const isoSelectOptions = computed<{ label: string; value: string | number }[]>(
            (): { label: string; value: string | number }[] => {
                const isoids = Object.keys(isos)
                let opts = []
                for (const isoid of isoids) {
                    const isoi = isos[isoid]
                    if (!isoi) continue
                    opts.push({
                        label: isoi.name,
                        value: isoi.iso,
                    })
                }
                return opts
            },
        )

        //当前租户iso
        const iso = ref<string>('')
        //当前租户信息
        const currentIsoInfo = computed(() => isos[iso.value] || null)
        //外部设置 iso 仅在用户登录成功后，设置一次
        const setCurrentIso = (ciso: string): boolean => {
            if (isoIsSetted.value) return false
            if (iso.value === ciso || !isos?.[ciso]) return false
            iso.value = ciso
            isoIsSetted.value = true
            return true
        }
        //标记已经设置过 currentIso
        const isoIsSetted = ref<boolean>(false)

        //记录上一次成功登录的 账号信息
        //账号 uuid
        const lastAccountId = ref<string>('')
        //记录上一次登录成功的 账号name 将显示在 loginForm 中
        const lastAccountName = ref<string>('')
        //账号 token
        const lastToken = ref<string>('')
        //设置 uuid|token 仅在登录成功后设置一次
        const setLastAccount = (uuid: string, token: string): boolean => {
            if (lastAccountIsSetted.value) return false
            lastAccountId.value = uuid
            lastToken.value = token
            lastLoginError.value = {
                tryTimes: 0,
                lastTryOut: 0,
            }
            lastAccountIsSetted.value = true
            return true
        }
        //标记 已经设置过 lastAccount
        const lastAccountIsSetted = ref<boolean>(false)

        //登录错误
        const lastLoginError = ref<Record<string, any>>({
            tryTimes: 0,
            lastTryOut: 0,
        })
        const maxLoginTryTimes = 5
        const setLoginTryTimes = (): boolean => {
            //尝试次数自增
            lastLoginError.value.tryTimes += 1
            //已达最大尝试次数
            if (lastLoginError.value.tryTimes >= maxLoginTryTimes) {
                const now = new Date()
                lastLoginError.value.lastTryOut = now.getTime()
                return false
            }
            return true
        }
        //检查是否允许继续尝试
        const tryCoolingDown = 5 * 60 * 1000
        const canLoginTry = (): boolean => {
            if (lastLoginError.value.tryTimes < maxLoginTryTimes) return true
            const now = new Date()
            const ms = now.getTime()
            const lms = lastLoginError.value.lastTryOut
            if (lms <= 0) {
                lastLoginError.value.lastTryOut = ms
                return false
            } else {
                //每次登录超出尝试次数后，冷却时间 5 min
                //const coolingDown = 5 * 60 * 1000
                if (ms - lms >= tryCoolingDown) {
                    lastLoginError.value = {
                        tryTimes: 0,
                        lastTryOut: 0,
                    }
                    return true
                }
                return false
            }
        }

        //每次请求之前需要的 依赖数据
        const requestBase = computed((): { baseUrl: string; token: string } | null => {
            if (
                currentIsoInfo.value === null ||
                !currentIsoInfo.value.baseUrl ||
                currentIsoInfo.value.baseUrl === ''
            )
                return null
            //if (lastToken.value === '') return null
            return {
                baseUrl: currentIsoInfo.value.baseUrl,
                token: lastToken.value,
            }
        })

        //是否需要显示执行登录操作
        const needLogin = computed<boolean>((): boolean => {
            return (
                currentIsoInfo.value === null ||
                lastAccountId.value === '' ||
                lastToken.value === ''
            )
        })

        //自动为 持久化数据 生成带有 dv:iso:uuid:- 前缀的 key
        const persistKey = (subkey: string): string => {
            let key = ['dv']
            if (iso.value !== '' && isos[iso.value]) {
                key.push(iso.value)
            }
            if (lastAccountId.value && lastAccountId.value !== '') {
                key.push(lastAccountId.value)
            }
            if (subkey !== '') {
                key.push(subkey)
            }
            return key.join(':')
        }

        //初始化 store
        const initStore = (app: App, options: Record<string, any> = {}): void => {
            if (inited.value) return

            //自动更新
            const dvUpdate = globalThis.DvApp.config.globalProperties.$dvUpdate
            if (dvUpdate?.updateStore) dvUpdate.updateStore('root')

            //install
            if (options?.root) updateStore(options.root)

            inited.value = true
        }

        //自动更新接口返回 对应数据后，写入 store
        const updateStore = (updata?: DvRemoteRootConfig): void => {
            if (updata?.isos) updateIsos(updata.isos)
        }
        //自动更新各项数据
        const updateIsos = (_isos?: Record<string, DvIsoInfo>): void => {
            if (!_isos || !dvIs.nemobj(_isos)) return
            for (const ik in _isos) {
                if (!_isos?.[ik] || !dvIs.nemobj(_isos[ik])) continue
                if (isos?.[ik]) {
                    isos[ik] = dvExtend(isos[ik], _isos[ik])
                } else {
                    isos[ik] = _isos[ik]
                }
            }
        }

        return {
            inited,

            isos,
            isoSelectOptions,

            iso,
            currentIsoInfo,
            setCurrentIso,

            lastAccountId,
            lastAccountName,
            lastToken,
            setLastAccount,

            lastLoginError,
            maxLoginTryTimes,
            setLoginTryTimes,
            tryCoolingDown,
            canLoginTry,

            requestBase,

            needLogin,

            persistKey,

            initStore,
            updateStore,
        }
    },
    {
        //pinia-plugin-persistedstate 插件参数
        persist: {
            //dvRoot store 使用固定 key
            key: 'dv:dvRoot',
            //储存项目
            pick: ['iso', 'lastAccountId', 'lastAccountName', 'lastToken', 'lastLoginError'],
        },
    },
)

//!! 返回 store 类型
export type DvRootStore = ReturnType<typeof useDvRootStore>
