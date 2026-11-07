/**
 * Deskvue 库 账号信息 store
 */

import { type App, ref, reactive, readonly, computed } from 'vue'
import { defineStore } from 'pinia'
import type { DvThisApiReturn } from '@/types/apis'
import { useDvConfigStore } from './dv-config'
import { useDvRootStore } from './dv-root'
import { useDvApisStore } from './dv-apis'
import { useDvRuntimeStore } from './dv-runtime'
import { useDvDbsStore } from './dv-dbs'
import { dvSystemShortcuts } from '@components/dv-system-apps'
import {
    type DvWindowProps,
    type DvWindowMeta,
} from '@components/dv-win-service/modules/dv-window.vue'
import { DvBusinessError } from '@utils/error/business-error'
import { dvWait, dvIs } from '@utils/core'
import { useDvUi } from '@utils/composable'
import { md5 } from 'js-md5'

//定义 account 账号信息数据类型
export interface DvAccountInfo {
    uuid: string
    name: string
    avatar?: string
}

/**
 * 定义某个 组件|操作 的 uac 权限控制参数类型
 */
export type DvUacValidator = (dvAccount: DvAccountStore) => boolean
export interface DvUacRule {
    roles?: string[] //以 ! 开头表示否定
    auths?: string[] //以 ! 开头表示否定
    logic?: 'any' | 'all' //定义使用 hasAnyRole|Auth 或 hasAllRole|Auth
}
export interface DvUacRules {
    rules?: DvUacRule[]
    logic?: 'any' | 'all' //定义 rules 多条规则之间使用 || 或 &&
}

//快捷方式信息类型
export interface DvShortcut {
    at: 'desktop' | 'taskbar' | 'all' //这个快捷方式放在哪
    component?: string //已全局注册的系统组件或业务组件
    props?: Record<string, any> //窗口的启动参数 props
    cmd?: string //或者将某个具体的命令(包含完整的启动参数 props)，添加为快捷方式
    title?: string //快捷方式名称，不指定则使用组件的名称+可能存在的参数
    icon?: string //快捷方式图标，不指定则使用组件图标
    iconProps?: Record<string, any>

    occuShape?: string //桌面快捷方式需要占用的格子尺寸 XxY 默认 1x1

    //桌面快捷方式，在桌面网格中的 y行|x列 序号，首次渲染时会自动生成并持久化
    occuX?: number
    occuY?: number
    occuRect?: Record<string, any>
}

//桌面小组件信息类型
export interface DvWidget {
    component?: string //已全局注册的系统组件或业务组件
    props?: Record<string, any> //窗口的启动参数 props
    //cmd?: string //或者将某个具体的命令(包含完整的启动参数 props)，添加为快捷方式
    title?: string //快捷方式名称，不指定则使用组件的名称+可能存在的参数
    icon?: string //快捷方式图标，不指定则使用组件图标
    iconProps?: Record<string, any>

    occuShape?: string //桌面小组件需要占用的格子尺寸 XxY 默认 4x2

    //桌面快捷方式，在桌面网格中的 y行|x列 序号，首次渲染时会自动生成并持久化
    occuX?: number
    occuY?: number
    occuRect?: Record<string, any>
}

//可外部配置的（通过 install options 或 update 更新数据 配置的）数据
export interface DvRemoteAccountConfig {
    [K: string]: any
}

export const useDvAccountStore = defineStore(
    'dvAccount',
    () => {
        /**
         * !! dvAccountStore 只能在 用户成功登录后才可以首次 useDvAccountStore()
         * 通过检查 dvRuntime.isLogin
         * 如果 useDvAccountStore() 时，用户还未成功登录，将报错
         */
        if (useDvRuntimeStore().isLogin !== true) {
            globalThis.dvTriggerError(
                new DvBusinessError('在用户还未成功登录时，无法初始化 dvAccountStore', {
                    cause: useDvAccountStore,
                }),
                //!! 需要终止
                true,
                null,
            )
        }

        //登录成功后，合并账号数据
        const initAfterLoginOk = async (
            rtnToken: string,
            accInfo: DvThisApiReturn<'uacAccount'>,
        ): Promise<void> => {
            //账号数据
            token.value = rtnToken
            const { uuid, name, role_list, auth_list } = accInfo
            info.uuid = uuid
            info.name = name
            roles.value.splice(0)
            roles.value.push(...role_list)
            auths.value.splice(0)
            auths.value.push(...auth_list)

            //登录成功后，从 dvRoot 同步 iso 项目隔离标记
            iso.value = useDvRootStore().iso

            //账号的个性化配置，使用 dvConfigStore 中的参数作为默认参数
            /*const dft = useDvConfigStore().defaultUiConfig
            //依次处理账号的 个性化配置，没有则使用 默认值填充
            for (const dk in dft) {
                if (!config?.[dk]) {
                    //默认值填充
                    config[dk] = dft[dk]
                }
            }
            await dvWait(100)*/

            //执行 dvRuntime.initAfterLoginOk
            await useDvRuntimeStore().initAfterLoginOk()

            //执行 dvApis.initAfterLoginOk
            await useDvApisStore().initAfterLoginOk()

            //执行 dvDbs.initAfterLoginOk
            await useDvDbsStore().initAfterLoginOk()
        }

        //账号信息
        const info = reactive<DvAccountInfo>({
            uuid: '',
            name: '未登录',
            avatar: '',
        })
        //iso
        const iso = ref<string>('')

        /**
         * 账号 uac 相关
         */
        //token 缓存
        const token = ref<string>('')
        //roles 角色列表
        const roles = ref<string[]>([])
        //auths 权限列表
        const auths = ref<string[]>([])
        //判断用户是否 super 用户
        const isSuper = computed(() => roles.value.includes(`${iso.value}:super`))
        /**
         * 判断账号是否拥有角色
         * @param {String|String[]} role 要判断的角色，可以是一组
         * @param {String} logic 如果传入一组 role，则判断 any|all 默认 any
         * @return {Boolean} 返回是否拥有角色
         */
        const hasRole = (role: string | string[], logic: 'any' | 'all' = 'any'): boolean => {
            //Super 用户
            if (isSuper.value) return true

            //自动为 role 角色添加 iso 前缀
            const prefix = (r: string): string => {
                r = r.trim()
                if (r.includes(':')) return r
                return `${iso.value}:${r}`
            }

            if (typeof role === 'string') return roles.value.includes(prefix(role))
            //多权限判断
            if (logic === 'any') {
                return role.some((item) => roles.value.includes(prefix(item)))
            } else {
                return role.every((item) => roles.value.includes(prefix(item)))
            }
        }
        //语法糖
        const hasAnyRole = (...role: string[]) => hasRole(role)
        const hasAllRole = (...role: string[]) => hasRole(role, 'all')
        /**
         * 判断账号是否拥有权限
         * @param {String|String[]} auth 要判断的权限，可以是一组
         * @param {String} logic 如果传入一组 auth，则判断 any|all 默认 any
         * @return {Boolean} 返回是否拥有权限
         */
        const hasAuth = (auth: string | string[], logic: 'any' | 'all' = 'any'): boolean => {
            //Super 用户
            if (isSuper.value || auths.value.includes('*')) return true
            if (typeof auth === 'string') return auths.value.includes(auth)
            //多权限判断
            if (logic === 'any') {
                return auth.some((item) => auths.value.includes(item))
            } else {
                return auth.every((item) => auths.value.includes(item))
            }
        }
        //语法糖
        const hasAnyAuth = (...auth: string[]) => hasAuth(auth)
        const hasAllAuth = (...auth: string[]) => hasAuth(auth, 'all')
        //外部调用 权鉴操作
        const uacValidate = (uac: DvUacValidator | DvUacRules): boolean => {
            //任何权鉴操作，用户必须已登录
            if (useDvRuntimeStore().isLogin !== true) return false

            //传入的 uac 定义是一个 方法
            if (typeof uac === 'function') {
                const self = useDvAccountStore()
                return uac(self)
            }

            //传入了具体的 roles|auths 定义
            const { rules, logic: rulesLogic } = uac as DvUacRules
            //没有任何 uac 规则要求，直接返回 true
            if (!rules || rules.length <= 0) return true

            //准备结果，rulesLogic 默认 any
            let result = rulesLogic === 'all' ? true : false

            // 处理 roles[] | auths[] 数组中可能存在的 ! 前缀
            const fix = (list: string[]): { has: string[]; except: string[] } => {
                const has: string[] = []
                const except: string[] = []
                for (let li of list) {
                    li = li.trim()
                    if (li === '') continue
                    if (li.startsWith('!')) {
                        except.push(li.substring(1).trim())
                    } else {
                        has.push(li)
                    }
                }
                return { has, except }
            }

            //依次处理每条规则
            let ignores = 0
            for (const rule of rules) {
                const { roles: iRoles, auths: iAuths, logic: iLogic } = rule
                if ((!iRoles || iRoles.length <= 0) && (!iAuths || iAuths.length <= 0)) {
                    //空规则，跳过
                    ignores++
                    continue
                }
                //准备 此条规则的 计算结果
                let iResult = true
                //计算规则
                if (iRoles && iRoles.length > 0) {
                    const { has, except } = fix(iRoles)
                    if (has.length > 0) {
                        //iLogic 默认 any
                        if (iLogic === 'all') {
                            iResult = iResult && hasAllRole(...has)
                        } else {
                            iResult = iResult && hasAnyRole(...has)
                        }
                    }
                    if (except.length > 0) {
                        iResult = iResult && !hasAnyRole(...except)
                    }
                }
                if (iAuths && iAuths.length > 0) {
                    const { has, except } = fix(iAuths)
                    if (has.length > 0) {
                        //iLogic 默认 any
                        if (iLogic === 'all') {
                            iResult = iResult && hasAllAuth(...has)
                        } else {
                            iResult = iResult && hasAnyAuth(...has)
                        }
                    }
                    if (except.length > 0) {
                        iResult = iResult && !hasAnyAuth(...except)
                    }
                }

                //汇总到 外部结果
                if (rulesLogic === 'all') {
                    if (iResult === false) return false
                    result = result && iResult
                } else {
                    if (iResult === true) return true
                    result = result || iResult
                }
            }

            //针对所有 rule 都是空规则的情况，表示不进行权限控制，返回 true
            if (ignores >= rules.length) return true
            return result
        }
        //远程权鉴
        const uacRemoteValidate = async (
            target: string | Record<string, any>,
        ): Promise<boolean> => {
            //TODO:
            return false
        }

        /**
         * 账号的 个性化数据
         */
        //账号的个性化配置
        const config = reactive<Record<string, any>>({})
        //快捷方式列表
        const shortcuts = reactive<Record<string, DvShortcut>>({})
        //@cmd account.addShortcut 向 桌面|任务栏 添加快捷方式
        const addShortcut = (sckey: string = '', ...scs: DvShortcut[]): boolean => {
            //用户必须已经登录
            const dvRuntime = useDvRuntimeStore()
            if (dvRuntime.isLogin !== true) return false
            //空内容
            if (scs.length <= 0) return true
            //app
            const app = globalThis.DvApp
            //ui
            const dvUi = useDvUi()
            //依次添加
            for (const sc of scs) {
                const component = sc?.component

                //TODO: 添加 cmd 命令行为 快捷方式
                if (!component) {
                    const cmd = sc?.cmd
                    if (!cmd) continue
                    //TODO：解析命令，取得目标组件定义，保存对应参数...
                    continue
                }

                //添加 系统组件|业务组件 为快捷方式
                const def = app.component(component)
                //不是全局注册的组件
                if (!def) continue

                //获取 窗口启动参数
                const props = (sc?.props ?? {}) as DvWindowProps & DvWindowMeta
                //桌面快捷方式 只能从窗口创建，因此 窗口 props 必须存在
                if (!props?.windowId || props.windowId === '') continue
                //从 启动参数中获取 title,icon,iconProps
                let title = props?.title ?? sc?.title ?? component
                let icon = props?.icon ?? sc?.icon ?? 'md-round-shortcut'
                let iconProps = props?.iconProps ?? sc?.iconProps ?? {}

                //获取窗口实例的 当前 meta
                const winIns = dvRuntime.windows[props.windowId]
                if (winIns) {
                    const meta = winIns.meta
                    if (meta?.title) title = meta.title
                    if (meta?.icon) icon = meta.icon
                    if (meta?.iconProps) iconProps = meta.iconProps
                }

                //添加到 shortcut 列表
                const scdef: DvShortcut = {
                    at: sc.at,
                    component,
                    props,
                    title,
                    icon,
                    iconProps,
                }

                //shortcut key
                if (!sckey || sckey === '') {
                    //sckey = `dv_sc_${md5(JSON.stringify(props))}`
                    sckey = `dv_sc_${props.windowId.substring(7)}`
                }

                //已存在的 shortcut
                if (shortcuts?.[sckey] !== undefined) continue

                //在 桌面网格中 自动排布此快捷方式
                scdef.occuShape = '1x1'
                const rect = dvUi.autoArrangeGridItem('1x1')
                if (!rect) {
                    //自动排布失败，可能是桌面空间不够了，取消添加快捷方式
                    continue
                }
                //自动排布的 occuX|Y|Rect 写入持久化数据
                scdef.occuX = rect.occuX
                scdef.occuY = rect.occuY
                scdef.occuRect = rect

                //写入 store
                shortcuts[sckey] = scdef
            }

            return true
        }
        //@cmd account.delShortcut 删除快捷方式
        const delShortcut = (sckey: string): boolean => {
            //用户必须已经登录
            if (useDvRuntimeStore().isLogin !== true) return false
            //sckey 对应的快捷方式不存在
            if (!shortcuts?.[sckey]) return true

            const sci = shortcuts[sckey]
            const xidx = sci?.occuX ?? -1
            const yidx = sci?.occuY ?? -1
            if (xidx >= 0 && yidx >= 0) {
                //解除桌面网格占用
                useDvUi().releaseGrid(xidx, yidx, '1x1')
            }

            //删除
            delete shortcuts[sckey]

            return true
        }
        //在桌面被选中的 shortcutId[]
        const desktopSelectedShortcuts = ref<string[]>([])
        //标记被选中的 shortcut 正在被批量拖拽
        const shortcutsIsDragging = ref<boolean>(false)

        //任务栏快速启动列表
        const tasklaunches = ref<string[]>(['DvLauncher', 'DvSettings'])
        //添加任意窗口 到 任务栏快速启动
        const addTasklaunches = (...components: string[]): void => {
            for (const comp of components) {
                if (tasklaunches.value.includes(comp)) continue
                const compDef = globalThis.DvApp.component(comp)
                if (!compDef) continue
                tasklaunches.value.push(comp)
            }
        }
        //从任务栏快速启动 删除
        const delTasklaunches = (...components: string[]): void => {
            for (const comp of components) {
                if (!tasklaunches.value.includes(comp)) continue
                const idx = tasklaunches.value.indexOf(comp)
                if (idx < 0) continue
                tasklaunches.value.splice(idx, 1)
            }
        }

        //桌面小组件列表
        const widgets = reactive<Record<string, DvWidget>>({})

        //已开启的 DvWindow 窗口组件的 参数，用于再次登录时自动开启窗口
        const windows = reactive<Record<string, DvWindowProps>>({})
        //新建窗口时，插入持久化列表
        const windowOpen = (winId: string, winProps: DvWindowProps): boolean => {
            if (winId !== '' && !windows?.[winId]) {
                windows[winId] = winProps
                return true
            }
            return false
        }
        //从持久化的 窗口列表中删除
        const windowClose = (winId: string): boolean => {
            if (windows?.[winId]) {
                Reflect.deleteProperty(windows, winId)
                return true
            }
            return false
        }

        //锁屏密码，需要持久化
        const screenLockPswd = ref<string>('')
        //锁屏状态保存在用户 store 中，需要持久化
        const screenLocked = ref<boolean>(false)

        //初始化 store
        const initStore = (app: App, options: Record<string, any> = {}): void => {
            //自动更新
            //useDvUpdateStore().updateStore()
        }

        //自动更新接口返回 对应数据后，写入 store
        const updateStore = (updata?: Record<string, any>): void => {}

        return {
            initAfterLoginOk,
            info,

            token,
            roles,
            isSuper,
            auths,

            hasRole,
            hasAnyRole,
            hasAllRole,
            hasAuth,
            hasAnyAuth,
            hasAllAuth,
            uacValidate,
            uacRemoteValidate,

            config,
            shortcuts,
            addShortcut,
            delShortcut,
            desktopSelectedShortcuts,
            shortcutsIsDragging,
            tasklaunches,
            addTasklaunches,
            delTasklaunches,
            widgets,
            windows,
            windowOpen,
            windowClose,

            screenLockPswd,
            screenLocked,

            initStore,
            updateStore,
        }
    },
    {
        persist: true,
    },
)

//!! 返回 store 类型
export type DvAccountStore = ReturnType<typeof useDvAccountStore>
