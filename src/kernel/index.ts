/**
 * Deskvue kernel 系统内核
 * 在浏览器的单次页面会话中，模拟 Linux 系统内核的部分行为
 *
 * Deskvue 是基于 Vue3 + pinia 构建的前端框架，是 Spf(Simple PHP Framework) 后端框架的配套前端组件系统
 * Spf + Deskvue 是完全基于 生产型企业的管理系统后台需求 开发的一套解决方案，主要用于：
 *  0   生产型企业的 生产管理系统 PMS(Production Management System) ：
 *          物料品种信息、采购计算、采购跟踪、库存、出入库；
 *          成品品种信息、定制品种、合规化数据（标签、配料 等）、配方管理（修订、版本 等）、成品库存、出入库、发货与配送；
 *          生产计划、自动排产、自动计算物料清单、生产步骤可视化、步骤负责人、出入库联动、合规化批生产记录；
 *          订单创建、自动分批、对接生产流程；
 *          以及配套的：
 *              员工信息、员工组管理（部门、车间、工段、班、组）、员工角色权限；
 *              供应商管理、资质、审计；
 *              客户管理、合规化信息、定制信息；
 *              财务相关的 物料与成品的定期库存盘点、成本核算（按时间、品种 等）；
 *              设备设施信息登记、合规化管理（设备维护保养记录、台账等）
 *  1   生产型企业线上直销的 支撑系统 OMS(Orders Management System)，支撑自建的订货小程序、各大电商平台的后台商品数据配套 等：
 *          商品品种信息、套餐搭配、折扣系统、卡券；
 *          底层直接对接 PMS 系统的成品品种信息、成品库存信息、复用 PMS 的发货与配送管理能力；
 *          配套的：
 *              线上客户信息、配送信息、购物车；
 *              订单信息、订单流程、可视化；
 *  2   其他企业管理需求：
 *          文档系统；审批流程；公告与通知；HR 管理（员工信息登记、入职、停职、转岗 等）；
 *          非生产使用的物料品种信息、采购、库存、出入库；
 *
 *
 */

import { createApp, ref, type App, type Ref } from 'vue'
import { setupDvGlobalErrorHandler, DvKernelError, dvTriggerKernelError } from './error'
import DvOs from './os/index.vue'
import type { DvOsProps } from './os/index.vue'
import { sysCall } from './apis'
import { useDvKernelStage, type DvKernelStageHook } from './utils'
import { start as fsStart, type DvFsInitOption, sysCall as fsSysCall } from './fs'
import { setupDvKernelServices } from './os/service/index.ts'
import { plugin, type DvPluginOption } from './plugin'
import { dvIs, dvWait, dvCamel, dvKabab, dvTrimAny } from '@/utils'

//定义 内核初始化参数结构
export interface DvKernelStartOption {
    //DvOs 根组件 props
    os?: Partial<DvOsProps>
    //FS 文件系统初始化参数
    fs?: Partial<DvFsInitOption>
    //Plugin 插件的 install 参数
    plugin?: Partial<DvPluginOption>
    //各系统服务程序组件的 启动 props
    service?: Record<string, PlainObject>

    [K: string]: any
}

//定义 globalThis.DvKernel 内核对象结构
export interface DvKernelGlobal {
    //内核状态机
    stage: DvKernelStageHook
    //将启动参数 响应式缓存
    options: Ref<DvKernelStartOption>
    //DvOs 组件启动 props 临时挂载，响应式数据
    //osProps: Ref<Partial<DvOsProps>>
    //内核错误收集列表
    errors: DvKernelError[]
    //对外暴露的 sysCall 内核接口调用入口
    sysCall: (cmd: string, ...args: any[]) => any

    //其他待扩展
    [K: string]: any
}

//定义 Deskvue kernel 内核启动方法
export const start = async (
    el: string = '#app',
    options?: DvKernelStartOption,
): Promise<App<Element>> => {
    //  0   全局错误处理
    setupDvGlobalErrorHandler()

    let app: App
    const g = globalThis
    try {
        //  1   构造 globalThis.DvKernel 内核对象
        if (g.DvKernel !== undefined) {
            throw new DvKernelError('内核不能重复初始化')
        } else {
            g.DvKernel = {
                //!! 默认 stage = booting
                stage: useDvKernelStage(),
                options: ref<DvKernelStartOption>(options ?? {}),
                //响应式挂载 DvOs 组件启动 props
                //osProps: ref<Partial<DvOsProps>>(options?.os ?? {}),
                errors: [],
                //全局可用的 内核方法
                sysCall,
            }
            //单独绑定 sysCall 到 globalThis.DvSysCall
            g.DvSysCall = sysCall
            await dvWait(10)
            //booting -> os-start
            g.DvKernel.stage.stageNext()
            await dvWait(10)
        }

        const gdk = g.DvKernel
        const stage = gdk.stage

        //  2   os-start：createApp(DvOs) 创建 Vue 全局根 app
        //      后续的 pinia 初始化需要 app 实例
        if (g.DvApp) {
            //!! 已经创建了根实例，内核状态机时序错误，panic
            throw new DvKernelError('发生内核错误，Vue 根实例重复创建')
        }
        //!! DvOs 根组件 props 必须定义在 options.os
        if (!gdk.options.value?.os) gdk.options.value.os = {}
        const app = createApp(DvOs, gdk.options.value.os)
        //暴露 app 实例到全局
        g.DvApp = app
        //DvOs 注册到全局，/sys/prog0 指向了此组件，需要读取其 programMeta
        app.component('DvOs', DvOs)
        await dvWait(10)
        //内核状态 os-start -> fs-initing
        stage.stageNext()
        await dvWait(10)

        //  3   fs-initing：FS 文件系统初始化开始
        //!! FS 文件系统的外部初始化参数必须定义在 options.fs
        const fsStartOk = await fsStart(app, (options?.fs ?? {}) as DvFsInitOption)
        if (!fsStartOk) {
            //!! 文件系统初始化失败
            throw new DvKernelError('发生内核错误，文件系统初始化失败')
        }
        //内核状态 fs-initing -> os-initing
        stage.stageNext()
        await dvWait(10)

        //  4   os-initing：Vue plugin install 以及 业务库注册
        //!! 注册系统内核服务组件
        setupDvKernelServices(app)
        //!! Deskvue plugin 的 install 参数必须定义在 options.plugin
        app.use(plugin, (options?.plugin ?? {}) as DvPluginOption)
        await dvWait(50)
        //在 plugin-install 以及 业务库的 plugin-install 方法中，已经提取了 程序和服务组件
        //!! 保存在 g.DvApp.config.globalProperties.$programs.sys|lib.programs|services{} 中
        const gps = app.config.globalProperties.$programs
        if (!gps || !dvIs.nemobj(gps)) {
            //!! 没有任何 程序和服务，一定不可能，报错
            throw new DvKernelError('发生内核错误，未收集到任何程序和服务')
        }
        //内核状态 os-initing -> os-mounting
        stage.stageNext()
        await dvWait(10)

        //!! panic 测试
        //throw new DvKernelError('手动模拟内核崩溃', { level: 'PANIC' })

        //  5   os-mounting：DvOs 根组件挂载
        app.mount(el)
        //!! 后续的 内核启动阶段推进 转移到 DvOs 组件内部

        return app
    } catch (e: any) {
        dvTriggerKernelError(e, 'PANIC')
    }

    return {} as App<Element>
}

//全局获取根组件

//导出 Deskvue kernel
//error
export * from './error'

//DvOs 根组件 相关导出
export * from './os'

//FS 文件系统 相关导出
export * from './fs'

//导出 DvConfigDefine 系统配置参数结构，以及原始配置
export * from './config'

//DV_PROVIDE
export { DV_PROVIDE, type DvProvide } from './plugin'

//utils
export * from './utils'
