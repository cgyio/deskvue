<script setup lang="ts">
/**
 * DvWinService 系统窗口服务
 * 系统服务 service，全局单例，自启动，早于用户登录
 */
import { ref, computed } from 'vue'
import { type DvFsProgramMeta, useDvProgram, useDvOsProvide } from '@/kernel'
import { dvWait } from '@/utils'

const srvn = 'DvWinService'

defineOptions({
    name: srvn,
    programMeta: {
        name: srvn,
        title: '窗口服务',
        desc: 'Deskvue 系统的窗口服务',
        isService: true,
        mimes: [],
        dependency: ['DvGuiService'],
        gui: {},
    } as DvFsProgramMeta,
})

//props
export interface DvWinServiceProps {
    pid: string
}
const props = withDefaults(defineProps<DvWinServiceProps>(), {})

//DvOs provide
const osInjects = useDvOsProvide()
const { env, service } = osInjects

//hooks
const dvProgram = useDvProgram(() => props)
const { memory, sysCall, callProgram, callService } = dvProgram

//生命周期
const afterProgramMounted = async (): Promise<void> => {
    await callService('DvCliService', 'ioPrint', `${srvn}<{{tab x5}}>`, {
        isKernel: true,
    })
    await callService('DvCliService', 'ioPrintExtend', '<{{.green::<OK>}}>')
}
const beforeProgramUnmount = async (): Promise<boolean> => {
    return true
}

//defineExpose 向外部暴露此服务的 接口方法
export interface DvWinServiceExposed {
    //!! 服务程序应暴露 sysCall 以便外部程序调用此服务的功能
    sysCall: (cmd: string, ...args: any[]) => any
    afterProgramMounted: () => Promise<void>
    beforeProgramUnmount: () => Promise<boolean>
}
defineExpose<DvWinServiceExposed>({
    sysCall,
    afterProgramMounted,
    beforeProgramUnmount,
})
</script>
<template></template>
