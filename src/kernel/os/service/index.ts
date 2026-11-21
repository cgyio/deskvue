/**
 * Deskvue kernel
 * 定义 系统内核服务程序组件，这些服务在内核启动后必须正确运行，缺少任意一个将导致内核崩溃
 * !! 这些服务同样纳入 FS 文件系统的统一接口，对应的文件节点保存在 /sys/service
 *
 * os-initing 阶段 按顺序将这些服务组件 注册到全局，并将组件定义收集到：
 *      globalThis.DvApp.config.globalProperties.$service = {
 *          DvKernelFooService: { ... defineComponent ... },
 *          ...
 *      }
 *
 * os-mounting 阶段 将这些服务对应的文件节点 挂载到 dvMem.fs.sys.service.kernel 路径下
 *
 * fs-ready 阶段 在所有需要自启动的 服务程序启动之前，先按顺序启动这些内核服务
 */

import { type App } from 'vue'

//!! 内核服务 系列组件
import DvCliService from './dv-cli/index.vue'
import DvFlushService from './dv-flush/index.vue'
import DvPmService from './dv-pm/index.vue'
import DvUacService from './dv-uac/index.vue'

//Deskvue 内核服务 组件库注册表
//!! 启动顺序 按 这里定义的顺序
export const dvKernelServices = {
    DvCliService,
    DvFlushService,
    DvPmService,
    DvUacService,
}
//内核服务 组件名类型
export type DvKernelServiceName = keyof typeof dvKernelServices
export const dvKernelServiceNames: DvKernelServiceName[] = Object.keys(
    dvKernelServices,
) as DvKernelServiceName[]

//全局注册 内核服务 系列组件
export const setupDvKernelServices = (app: App<Element>): void => {
    dvKernelServiceNames.forEach((compName: DvKernelServiceName) => {
        const def = dvKernelServices[compName]
        //全局注册组件
        app.component(compName as string, def)
    })
}

//导出类型
export type * from './dv-cli/index.vue'
export type * from './dv-flush/index.vue'
export type * from './dv-pm/index.vue'
export type * from './dv-uac/index.vue'
