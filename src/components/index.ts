/**
 * Deskvue 系统 Vue 组件库
 *
 * dv-* 系列组件默认注册为全局组件
 *
 * !! defineOptions 包含 programMeta{} 参数的组件，将被 Deskvue 内核作为 program 挂载到文件系统
 *      programMeta.isService === true     挂载到 /sys/service 目录下
 *      普通 program                        挂载到 /program 目录下
 */

import { type App } from 'vue'
import { type DvFsProgramMeta } from '@/kernel'

//!! 依次 import dv-* 系列组件
import DvCliService from './dv-cli-service/index.vue'
import DvUacService from './dv-uac-service/index.vue'
import DvDesktop from './dv-desktop/index.vue'

//Deskvue 全局组件库注册表
export const dvComponents = {
    DvCliService,
    DvUacService,

    DvDesktop,
}
//dv-* 组件名类型
export type DvComponentName = keyof typeof dvComponents
export const dvComponentNames: DvComponentName[] = Object.keys(dvComponents) as DvComponentName[]

//全局注册 dv-* 系列组件
export const setupDvComponents = (app: App<Element>): void => {
    //!! 收集所有定义为 program | service 的组件
    const programs: Record<string, DvFsProgramMeta> = {}
    const services: Record<string, DvFsProgramMeta> = {}

    dvComponentNames.forEach((compName: DvComponentName) => {
        const def = dvComponents[compName]
        //全局注册组件
        app.component(compName as string, def)
        //收集 程序服务组件
        if (def.programMeta) {
            const meta: DvFsProgramMeta = def.programMeta
            if (meta.isService === true) {
                services[compName] = meta
            } else {
                programs[compName] = meta
            }
        }
    })

    //!! 将所有 program 组件注入到 app.config.globalProperties.$programs{} 中
    app.config.globalProperties.$programs = {
        sys: { programs, services },
        //准备业务库 程序与服务 的容器
        lib: {
            programs: {},
            services: {},
        },
    }
}
