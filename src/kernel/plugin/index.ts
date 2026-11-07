/**
 * Deskvue kernel
 * Deskvue 系统的 vue-plugin 定义
 *
 * Deskvue 插件 install 流程：
 *  0   将 dv-* 系列组件注册为全局组件
 *  1   注册自定义指令
 *  2   注册全局方法  app.provide(DV_PROVIDE, { ... })
 *  3   注入业务组件库  通过 options.libs{} 参数传入
 *   !! 业务组件库必须通过 CDN 方式引入，必须挂载到全局 window.FooBar，其结构必须包含：
 *          window.FooBar.plugin    用于 app.use(FooBar.plugin) 其内部将所有业务组件自动注册为 异步组件
 *       !! window.FooBar.setup()   必须 async 用于在 Desktop 启动阶段，自动初始化这个业务组件库（初始化|更新 store 等）
 *   !! 业务组件库 plugin install 过程中，注册全局组件时，必须将 业务程序 和 业务服务 组件筛选并提取到：
 *          app.config.globalProperties.$programs.lib.programs|services = {
 *              compName: comp.options.programMeta
 *          }
 *
 */

import { type App, type Plugin, type InjectionKey, type ShallowRef, provide } from 'vue'
import DvOs from '../os/index.vue'
import { setupDvComponents } from '@/components'
import { dvWait } from '@utils/core'

//定义通用的 业务组件库 plugin 的 install options 类型
export interface DvBzPluginOption {
    [k: string]: any
}
//定义 Deskvue 业务组件库 setup 方法类型
export type DvBzSetup = (app: App<Element>) => Promise<void>
//定义 Deskvue 业务库 plugin 类型
export type DvBzPlugin = Plugin<DvBzPluginOption>
//定义 Deskvue 业务组件库的 iife 包结构类型
export interface DvBzLib {
    plugin: DvBzPlugin
    options?: DvBzPluginOption
    //可选：业务组件库可以定义一个 async setup 方法(初始化依赖，根据账号权限生成可用组件列表，等)
    setup?: DvBzSetup
    //其他可选
    [k: string]: any
}
//定义 插件的 install 参数结构
export interface DvPluginOption {
    libs?: Record<string, DvBzLib>
    [K: string]: any
}

//要 app.provide 到全局的 属性 | 方法
export interface DvProvide {
    //app: App
}
export const DV_PROVIDE: InjectionKey<DvProvide> = Symbol('Deskvue')

//!! 业务组件库导入
//在 Deskvue 插件安装阶段，执行业务组件库注入操作
//!! 收集并返回 这些业务组件库中可能存在的 setup 方法
const injectDvBzLibs = (app: App<Element>, libs: Record<string, DvBzLib>): DvBzSetup[] => {
    const keys = Object.keys(libs)
    if (keys.length <= 0) return []
    const setups: DvBzSetup[] = []
    for (const key of keys) {
        const item = libs[key]
        if (!item || !item.plugin) continue
        //应用业务组件库
        app.use(item.plugin, item.options ?? {})
        //如果有 setup 方法，则收集
        if (typeof item?.setup === 'function') {
            setups.push(item.setup as DvBzSetup)
        }
    }
    //返回收集到的 setup
    return setups
}
//在 Deskvue 启动阶段用户登录后，执行收集到的 业务组件库的 setup
const setupDvBzLibs = async (app: App<Element>): Promise<void> => {
    const setups: DvBzSetup[] = app.config.globalProperties.$bzLibSetups
    if (!setups || setups.length <= 0) return
    for (const setup of setups) {
        if (typeof setup !== 'function') continue
        await setup(app)
    }
    await dvWait(10)
    //清除 setups 数组
    delete app.config.globalProperties.$bzLibSetups
    //清除 setupBzLibs 方法
    delete app.config.globalProperties.$setupBzLibs
    await dvWait(10)
}

export const plugin = {
    install(app: App, options: DvPluginOption = {}) {
        // 0    dv-* 系列组件注册为全局组件
        setupDvComponents(app)

        // 1    注册全局自定义指令
        //setupDvDirectives(app)

        // 2    注册全局方法
        app.provide(DV_PROVIDE, {
            //app,
        })

        // 3    注入业务组件库，收集 业务库 setup 方法，缓存到 app.config.globalProperties.$dvBzSetups[] 中
        if (options?.libs) {
            const setups: DvBzSetup[] = injectDvBzLibs(app, options.libs)
            //如果存在 setups 数组，将 setups 数组 以及 setupBzLibs 方法 进行全局挂载
            if (setups.length > 0) {
                app.config.globalProperties.$bzLibSetups = setups
                app.config.globalProperties.$setupBzLibs = setupDvBzLibs
            }
        }
    },
}
