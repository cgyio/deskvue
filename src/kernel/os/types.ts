/**
 * DvOs 根组件 provide 类型
 */

import type { InjectionKey, ComputedRef, Ref, ShallowReactive, WritableComputedRef } from 'vue'
import {
    useDvServiceWatcher,
    type DvOsServiceInfo,
    type DvOsServiceExposed,
    useDvIoBuffer,
    type DvIoBuffer,
    type DvLogoProvide,
} from './utils'
import type { DvConfigDefine } from '../config'
import type { DvSessionStruct, DvInodeHandler, DvProcess } from '../fs'
import type { DvKernelStageHook } from '../utils'
import { type DvOsEnvCli } from './service'

//DvOs 根组件 provide 的 全局环境变量数据 env 结构
export interface DvOsEnv {
    //!! 这里的数据是由 启动后的 各对应的 service 服务程序运行时添加的
    //!! TS 类型定义仅覆盖 内核服务 和 系统服务程序，
    //!! 对于外部的业务服务，以及用户自行安装的服务程序，如果向 env 输出数据，则无法获取类型定义
    cli?: DvOsEnvCli
    uac?: {
        [K: string]: any
    }
    gui?: {
        [K: string]: any
    }

    [K: string]: any
}

//DvOs provide 数据类型
export interface DvOsProvide {
    stage: Readonly<Ref<string>>
    stageHook: DvKernelStageHook

    //服务守卫
    service: DvOsServiceExposed

    //services: Ref<Record<string, DvOsServiceInfo>>
    //serviceSequence: ComputedRef<string[]>
    //serviceWatcher: ReturnType<typeof useDvServiceWatcher>
    //serviceMounted: (srvn: string) => void
    //isServiceMounted: (srvn: string) => boolean

    //全局环境变量
    //!! shallowReactive：根属性响应式，且不会解包嵌套的 ref/computed
    env: ShallowReactive<DvOsEnv>

    install: (hdl: string | DvInodeHandler<'DvExtRegInode'>) => Promise<boolean>

    //ioBuffer: ComputedRef<DvIoBuffer>
    //sysConfig: ComputedRef<DvConfigDefine>
    //userSession: ComputedRef<DvSessionStruct | undefined>

    isDark: WritableComputedRef<boolean>
    toggleDark: (to?: boolean) => Promise<void>
    logo: ComputedRef<DvLogoProvide>
}

export const DV_OS_PROVIDE: InjectionKey<DvOsProvide> = Symbol('DvOs')
