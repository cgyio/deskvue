<script setup lang="ts">
/**
 * Deskvue kernel
 * 内核服务 DvFlushService 内核刷盘服务
 */
import { ref, computed } from 'vue'
import { type DvFsProgramMeta, useDvProgram, useDvOsProvide } from '@/kernel'
import { dvWait } from '@/utils'

const srvn = 'DvFlushService'

defineOptions({
    name: srvn,
    programMeta: {
        name: srvn,
        title: '内核刷盘服务',
        desc: 'Deskvue 系统的内核刷盘服务',
        isService: true,
        mimes: [],
        gui: {},
    } as DvFsProgramMeta,
})

//props
export interface DvFlushServiceProps {
    pid: string
}
const props = withDefaults(defineProps<DvFlushServiceProps>(), {})

//DvOs provide
const osInjects = useDvOsProvide()
const { env, service } = osInjects

//hooks
const dvProgram = useDvProgram(() => props)
const { sysCall, callProgram, callService } = dvProgram

//生命周期
const afterProgramMounted = async (): Promise<void> => {
    await callService('cli', 'ioPrint', `${srvn}<{{tab x3}}>`, {
        isKernel: true,
    })
    await dvWait(100)
    await callService('cli', 'ioPrintExtend', '<{{.green::<OK>}}>')
}
const beforeProgramUnmount = async (): Promise<boolean> => {
    return true
}

//defineExpose 向外部暴露此服务的 接口方法
export interface DvFlushServiceExposed {
    //!! 服务程序应暴露 sysCall 以便外部程序调用此服务的功能
    sysCall: (cmd: string, ...args: any[]) => any
    afterProgramMounted: () => Promise<void>
    beforeProgramUnmount: () => Promise<boolean>
}
defineExpose<DvFlushServiceExposed>({
    sysCall,
    afterProgramMounted,
    beforeProgramUnmount,
})
</script>
<template></template>
