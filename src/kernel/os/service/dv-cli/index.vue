<script setup lang="ts">
/**
 * DvCliKernelService 命令行服务
 * 内核级别的 service，全局单例，自启动，早于用户登录
 *
 */
import { ref, computed, inject, onMounted, nextTick } from 'vue'
import { dvTriggerKernelError } from '../../../error/index.ts'
import { type DvFsProgramMeta } from '../../../fs/index.ts'
import { DV_OS_PROVIDE, type DvOsProvide } from '../../types.ts'
import {
    useDvProgram,
    type DvProgramComponentProps,
    useDvIoBuffer,
    type DvIoBuffer,
    type DvIoBufferConfig,
} from '../../utils'
import DvKernelUi from '../../modules/dv-kernel-ui.vue'

defineOptions({
    name: 'DvCliKernelService',
    programMeta: {
        name: 'DvCliKernelService',
        title: '命令行服务',
        desc: 'Deskvue 系统的命令行服务',
        isService: true,
        mimes: ['*.cli'],
    } as DvFsProgramMeta,
})

//根组件 props，通过 start 启动方法第二参数 options.os{} 传入
export interface DvOsProps extends DvProgramComponentProps {
    //!! 所有 program 组件必须定义
    pid: string
}
const props = withDefaults(defineProps<DvOsProps>(), {})

//
//私有内存结构
export interface DvCliServiceMemStruct extends PlainObject {
    pid: string
    //是否全屏显示 terminal
    fullscreen: boolean
}

//hook
const dvProgram = useDvProgram<DvCliServiceMemStruct>(() => props)
const { pid, ipath, inode, handler, callCtx, memory, sysCall, ioBuffer, sysConfig } = dvProgram
const { ioConfig, print: ioPrint, input: ioInput } = useDvIoBuffer(() => dvProgram)

//inject
const osInjects = inject(DV_OS_PROVIDE, {} as DvOsProvide)
const { stage, stageHook, isDark, logo } = osInjects

//onMounted|onUnmounted
onMounted(async () => {
    await nextTick()

    //构建私有内存结构
    //if (!memory.value?.terminal) memory.value.terminal = { ...(sysConfig.value?.service.cli ?? {}) }
    //if (!memory.value?.buffer) memory.value.buffer = []
    memory.value.fullscreen = false

    //
})
</script>
<template>
    <!--<DvKernelUi height="50vh">
        <div
            v-if="stageHook.stageBefore('os-ready') || memory.fullscreen"
            class="dv-terminal full-screen"
        >
            <div class="buffer logo">
                <img :src="logoExpand" style="height: 48px; width: auto" />
            </div>
            <div class="buffer">
                <span class="cell primary-cell">DvCliService</span>
            </div>
            <div class="buffer">
                <span class="cell cursor"></span>
            </div>
        </div>
    </DvKernelUi>-->
</template>
