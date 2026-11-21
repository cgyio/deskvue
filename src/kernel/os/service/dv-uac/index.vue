<script setup lang="ts">
/**
 * DvUacService 用户权限系统服务
 * 内核级别的 service，全局单例，自启动，早于用户登录
 */
import { ref, computed, onMounted, nextTick } from 'vue'
import type { DvFsProgramMeta } from '../../../fs'
import { useDvProgram, useDvOsProvide, type DvProgramComponentProps } from '../../utils'
import { dvUntil, dvWait } from '@/utils'

const srvn = 'DvUacService'

defineOptions({
    name: srvn,
    programMeta: {
        name: srvn,
        title: '用户服务',
        desc: 'Deskvue 系统的用户权限服务',
        isService: true,
        mimes: ['*.ss', '*.prof'],
        dependency: ['DvCliService'],
    } as DvFsProgramMeta,
})

//根组件 props，通过 start 启动方法第二参数 options.os{} 传入
export interface DvUacServiceProps extends DvProgramComponentProps {
    //!! 所有 program 组件必须定义
    pid: string
}
const props = withDefaults(defineProps<DvUacServiceProps>(), {})

//DvOs provide
const osInjects = useDvOsProvide()
const { service, env } = osInjects

//hooks
const dvProgram = useDvProgram(() => props)
const { sysCall, callService } = dvProgram

//生命周期
//组件实例挂载完成后，相当于 onMounted，此时所有依赖服务一定已经就绪
const afterProgramMounted = async (): Promise<void> => {
    await callService('DvCliService', 'ioPrint', `${srvn}<{{tab x5}}>`, {
        isKernel: true,
    })
    await dvWait(100)
    await callService('cli', 'ioPrintExtend', '<{{.green::<OK>}}>')
}
//组件实例卸载之前，必须返回 boolean
const beforeProgramUnmount = async (): Promise<boolean> => {
    return true
}
//程序组件内部不要定义 onMounted|onUnmounted
//onMounted(async () => {})
//onUnmounted(async () => {})

//defineExpose 向外部暴露此内核服务的 接口方法
export interface DvUacServiceExposed {
    sysCall: (cmd: string, ...args: any[]) => any
    afterProgramMounted: () => Promise<void>
    beforeProgramUnmount: () => Promise<boolean>
}
defineExpose<DvUacServiceExposed>({
    sysCall,
    afterProgramMounted,
    beforeProgramUnmount,
})
</script>
<template></template>
