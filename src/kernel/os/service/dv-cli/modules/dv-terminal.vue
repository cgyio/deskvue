<script setup lang="ts">
/**
 * Deskvue kernel
 * 内核服务组件模块 DvTerminal 终端，输入输出缓冲区 /sys/buffer 的显示界面
 * 被 内核服务 DvCliKernelService 和 系统程序 DvShell 调用
 */

import {
    ref,
    computed,
    watch,
    onMounted,
    onUnmounted,
    nextTick,
    inject,
    type ComputedRef,
    type ShallowRef,
} from 'vue'
import { dvTriggerKernelError } from '../../../../error'
import type {
    DvDirInode,
    DvFsInodeCreateOptions,
    DvFsInodeMemStruct,
    DvFsLsItem,
    DvFsMemStruct,
    DvFsProgramMeta,
    DvInodeHandler,
    DvProcess,
    DvProgramRegInode,
    DvRegInode,
    useDvFsIpath,
} from '../../../../fs'
import {
    useDvOsProvide,
    type DvIoBuffer,
    type DvIoBufferConfig,
    type DvIoOutputRow,
} from '../../../utils'

defineOptions({
    name: 'DvTerminal',
})

//DvOs provide
const osInjects = useDvOsProvide()
const { stageHook, logo, env } = osInjects

//props
export interface DvTerminalProps {
    fsize?: number
    tabw?: number
}
const props = withDefaults(defineProps<DvTerminalProps>(), {})

//ioBuffer
const ioBuffer = computed<DvIoBuffer | undefined>(() => env.cli?.ioBuffer.value)
//ioConfig
const ioConfig = computed<DvIoBufferConfig | undefined>(() => env.cli?.ioConfig.value)
//props
const fsizeProp = computed<number>(() => {
    return props.fsize === undefined ? (ioConfig.value?.fsize ?? 14) : props.fsize
})
const tabwProp = computed<number>(() => {
    return props.tabw === undefined ? (ioConfig.value?.tabw ?? 14) : props.tabw
})

//buffer html
const bufferHtml = computed<string>(() => {
    const html: string[] = []
    if (!ioBuffer.value || ioBuffer.value.length <= 0) return ''
    for (const row of ioBuffer.value) {
        //output
        if ((row as DvIoOutputRow).cells !== undefined) {
            const out = row as DvIoOutputRow
            if (out.html && out.html !== '') {
                html.push(out.html)
            } else {
                html.push('<div class="dv-buffer-row"></div>')
            }
        }
    }
    //ready 阶段后，显示 用户输入光标
    html.push('<div class="dv-buffer-row"><span class="dv-buffer-cell cursor"></span></div>')
    return html.join('')
})
</script>
<template>
    <div
        class="dv-terminal"
        :style="{
            '--dv-term-fsz': `${fsizeProp}px`,
        }"
        v-html="bufferHtml"
    ></div>
</template>
