/**
 * DvOs 根组件 provide 类型
 */

import type { InjectionKey, ComputedRef, Ref, WritableComputedRef } from 'vue'
import {
    useDvServiceWatcher,
    type DvOsServiceInfo,
    useDvIoBuffer,
    type DvIoBuffer,
    type DvLogoProvide,
} from './utils'
import type { DvConfigDefine } from '../config'
import type { DvFsSessionIcache, DvInodeHandler, DvProcess } from '../fs'
import type { DvKernelStageHook } from '../utils'

//DvOs provide 数据类型
export interface DvOsProvide {
    stage: Readonly<Ref<string>>
    stageHook: DvKernelStageHook

    services: Ref<Record<string, DvOsServiceInfo>>
    serviceSequence: ComputedRef<string[]>
    serviceWatcher: ReturnType<typeof useDvServiceWatcher>
    install: (hdl: string | DvInodeHandler<'DvExtRegInode'>) => Promise<boolean>

    ioBuffer: ComputedRef<DvIoBuffer>
    sysConfig: ComputedRef<DvConfigDefine>
    userSession: ComputedRef<DvFsSessionIcache | undefined>

    isDark: WritableComputedRef<boolean>
    toggleDark: (to?: boolean) => Promise<void>
    logo: ComputedRef<DvLogoProvide>
}

export const DV_OS_PROVIDE: InjectionKey<DvOsProvide> = Symbol('DvOs')
