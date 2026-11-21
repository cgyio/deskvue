/**
 * Deskvue kernel
 * 由 由所有需要 inject 根组件 DvOs provide(DV_OS_PROVIDE) 的数据的 组件使用
 *
 * 自动导入有效的 根组件 provide 数据
 */

import {
    //ref,
    //computed,
    //type ComputedRef,
    //type Ref,
    //type UnwrapRef,
    //isRef,
    inject as vueInject,
    //type InjectionKey,
} from 'vue'
import { DV_OS_PROVIDE, type DvOsProvide } from '../types'

export const useDvOsProvide = () => {
    const injects = vueInject<DvOsProvide>(DV_OS_PROVIDE, null as unknown as DvOsProvide)
    return injects
}
