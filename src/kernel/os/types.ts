/**
 * DvOs 根组件 provide 类型
 */

import type { InjectionKey, ComputedRef, Ref, WritableComputedRef } from 'vue'

//DvOs provide 数据类型
export interface DvOsProvide {
    stage: Readonly<Ref<string>>

    isDark: WritableComputedRef<boolean>
    toggleDark: (to?: boolean) => Promise<void>
}

export const DV_OS_PROVIDE: InjectionKey<DvOsProvide> = Symbol('DvOs')
