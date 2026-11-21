<script setup lang="ts">
/**
 * DvCliService 命令行服务
 * 内核级别的 service，全局单例，自启动，早于用户登录
 *
 */
import { ref, computed, inject, onMounted, nextTick, onUnmounted, type ComputedRef } from 'vue'
import { dvTriggerKernelError } from '../../../error/index.ts'
import { type DvFsProgramMeta } from '../../../fs/index.ts'
import { useDvOsProvide } from '../../utils'
import {
    useDvProgram,
    type DvProgramComponentProps,
    useDvIoBuffer,
    type DvIoBuffer,
    type DvIoBufferConfig,
    type DvIoInputOptions,
    type DvIoPrintOptions,
} from '../../utils'
import DvKernelUi from '../../modules/dv-kernel-ui.vue'
import DvTerminal from './modules/dv-terminal.vue'
import { dvWait } from '@/utils/core.ts'

//服务名称
const srvn = 'DvCliService'

defineOptions({
    name: srvn,
    programMeta: {
        name: srvn,
        title: '命令行服务',
        desc: 'Deskvue 系统的命令行服务',
        isService: true,
        mimes: ['*.cli'],
    } as DvFsProgramMeta,
})

//DvCliService 内核服务向全局环境变量 env 中输出的 环境数据结构
export interface DvOsEnvCli {
    //ioBuffer 只读的 输入输出缓冲区内容
    ioBuffer: ComputedRef<DvIoBuffer>
    //terminal 终端程序显示参数
    ioConfig: ComputedRef<DvIoBufferConfig>

    [K: string]: any
}

//根组件 props，通过 start 启动方法第二参数 options.os{} 传入
export interface DvCliServiceProps extends DvProgramComponentProps {
    //!! 所有 program 组件必须定义
    pid: string
}
const props = withDefaults(defineProps<DvCliServiceProps>(), {})

//DvOs provide
const osInjects = useDvOsProvide()
const { stage, stageHook, service, env } = osInjects

//私有内存结构
export interface DvCliServiceMemStruct extends PlainObject {
    pid: string
    //是否全屏显示 terminal
    fullscreen: boolean
}

//hook
const dvProgram = useDvProgram<DvCliServiceMemStruct>(() => props)
const { pid, memory, initMemory, ioBuffer, sysCall } = dvProgram
const {
    ioConfig,
    print: ioPrint,
    printExtend: ioPrintExtend,
    input: ioInput,
} = useDvIoBuffer(() => dvProgram)

//程序自有状态
//serviceReady
const srvReady = computed<boolean>(() => service.isMounted(srvn))

//生命周期
//组件实例挂载完成后，相当于 onMounted
const afterProgramMounted = async (): Promise<void> => {
    //创建环境变量 env.cli
    env.cli = { ioBuffer, ioConfig }

    //构建私有内存结构
    await initMemory({
        fullscreen: false,
    } as DvCliServiceMemStruct)

    //向 ioBuffer 输出初始内容
    await ioPrint('Deskvue Kernel starting ...')
    await ioPrint('')
    await ioPrint('Services Starting')
    await ioPrint(`${srvn}<{{tab x5}}>`, { isKernel: true })
    await dvWait(100)
    await ioPrintExtend('<{{.green::<OK>}}>')
}
//组件实例卸载之前，必须返回 boolean
const beforeProgramUnmount = async (): Promise<boolean> => {
    return true
}
//程序组件内部不要定义 onMounted|onUnmounted
//onMounted(async () => {})
//onUnmounted(async () => {})

//defineExpose 向外部暴露此内核服务的 接口方法
export interface DvCliServiceExposed {
    //!! 服务程序，应对外暴露 sysCall 以便外部程序调用此服务
    sysCall: (cmd: string, ...args: any[]) => any
    afterProgramMounted: () => Promise<void>
    beforeProgramUnmount: () => Promise<boolean>
    ioInput: (origin: string, opts?: DvIoInputOptions | undefined) => Promise<void>
    ioPrint: (origin: string, opts?: DvIoPrintOptions | undefined) => Promise<void>
    ioPrintExtend: (origin: string, opts?: DvIoPrintOptions | undefined) => Promise<void>
}
defineExpose<DvCliServiceExposed>({
    sysCall,
    afterProgramMounted,
    beforeProgramUnmount,

    ioInput,
    ioPrint,
    ioPrintExtend,
})
</script>
<template>
    <div class="dv-fullscreen-terminal">
        <DvTerminal v-if="srvReady"></DvTerminal>
    </div>
</template>
